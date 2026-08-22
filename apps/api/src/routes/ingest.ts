/**
 * POST /api/v1/ingest
 *
 * Receives batched sensor readings from a Vernal hub every 5 minutes.
 * Auth: device JWT in Authorization header.
 *
 * Request body (JSON):
 * {
 *   readings: [
 *     {
 *       sensor_rf_id: string,
 *       sensor_type: 'weather_station' | 'soil' | 'greenhouse' | 'indoor',
 *       recorded_at: number,   // unix timestamp (Pi clock)
 *       // weather station fields (optional):
 *       temp_c?: number,
 *       humidity_pct?: number,
 *       pressure_hpa?: number,
 *       wind_avg_ms?: number,
 *       wind_max_ms?: number,
 *       wind_dir_deg?: number,
 *       rain_mm?: number,
 *       uv_index?: number,
 *       solar_lux?: number,
 *       // soil / greenhouse fields (optional):
 *       soil_moisture_pct?: number,
 *       soil_temp_c?: number,
 *       greenhouse_temp_c?: number,
 *       greenhouse_humidity_pct?: number,
 *       indoor_temp_c?: number,
 *       indoor_humidity_pct?: number,
 *       battery_pct?: number,
 *     },
 *     ...
 *   ]
 * }
 */

import { verifyDeviceToken } from '../lib/auth';
import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

interface ClaimWindow {
  device_id: string;
  sensor_type: string;
  created_at: number;
  claimed_rf_id: string | null;
}

export async function handleIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  let deviceId: string;
  try {
    const claims = await verifyDeviceToken(
      request.headers.get('Authorization'),
      env.DEVICE_JWT_SECRET,
    );
    deviceId = claims.sub;
  } catch {
    return errorResponse(401, 'Unauthorised');
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { readings?: unknown[]; agent_version?: unknown };
  try {
    body = await request.json() as { readings?: unknown[]; agent_version?: unknown };
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  if (!Array.isArray(body.readings) || body.readings.length === 0) {
    return errorResponse(400, 'readings array required');
  }

  if (body.readings.length > 500) {
    return errorResponse(400, 'Maximum 500 readings per batch');
  }

  // ── Look up device & user ────────────────────────────────────────────────
  const device = await env.DB
    .prepare('SELECT id, user_id FROM devices WHERE id = ?')
    .bind(deviceId)
    .first<{ id: string; user_id: string }>();

  if (!device) return errorResponse(404, 'Device not found');

  // ── Update device last_seen + firmware_version ───────────────────────────
  const agentVersion = typeof body.agent_version === 'string' ? body.agent_version : null;
  ctx.waitUntil(
    env.DB
      .prepare('UPDATE devices SET last_seen_at = ?, firmware_version = COALESCE(?, firmware_version) WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), agentVersion, deviceId)
      .run(),
  );

  // ── Upsert sensor records & insert readings ──────────────────────────────
  const stmts: D1PreparedStatement[] = [];

  for (const raw of body.readings) {
    const r = raw as Record<string, unknown>;

    // Validate minimum required fields
    if (typeof r['sensor_rf_id'] !== 'string') continue;
    if (typeof r['recorded_at'] !== 'number') continue;
    const sensorType = r['sensor_type'];
    if (sensorType !== 'soil' && sensorType !== 'greenhouse' && sensorType !== 'indoor') continue;

    const rfId = r['sensor_rf_id'] as string;

    // Upsert sensor row; update snapshot columns for the candidates endpoint.
    stmts.push(
      env.DB.prepare(`
        INSERT INTO sensors (id, device_id, user_id, rf_id, sensor_type, last_seen_at,
          snap_temp_c, snap_humidity_pct,
          snap_soil_moisture_pct, snap_soil_temp_c)
        VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?)
        ON CONFLICT(device_id, rf_id) DO UPDATE SET
          last_seen_at           = excluded.last_seen_at,
          battery_pct            = COALESCE(?, battery_pct),
          snap_temp_c            = COALESCE(excluded.snap_temp_c,            snap_temp_c),
          snap_humidity_pct      = COALESCE(excluded.snap_humidity_pct,      snap_humidity_pct),
          snap_soil_moisture_pct = COALESCE(excluded.snap_soil_moisture_pct, snap_soil_moisture_pct),
          snap_soil_temp_c       = COALESCE(excluded.snap_soil_temp_c,       snap_soil_temp_c)
      `).bind(
        device.id, device.user_id, rfId, sensorType,
        Math.floor(Date.now() / 1000),
        (r['temp_c'] as number | null) ?? null,
        (r['humidity_pct'] as number | null) ?? null,
        (r['soil_moisture_pct'] as number | null) ?? null,
        (r['soil_temp_c'] as number | null) ?? null,
        // battery_pct for the DO UPDATE branch
        (r['battery_pct'] as number | null) ?? null,
      ),
    );

    // Insert reading row — look up sensor_id by rf_id + device_id
    stmts.push(
      env.DB.prepare(`
        INSERT INTO readings (
          sensor_id, device_id, user_id, recorded_at,
          temp_c, humidity_pct,
          soil_moisture_pct, soil_temp_c,
          greenhouse_temp_c, greenhouse_humidity_pct,
          indoor_temp_c, indoor_humidity_pct
        )
        SELECT
          s.id, ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?
        FROM sensors s
        WHERE s.device_id = ? AND s.rf_id = ?
      `).bind(
        device.id, device.user_id, r['recorded_at'] as number,
        (r['temp_c'] as number | null) ?? null,
        (r['humidity_pct'] as number | null) ?? null,
        (r['soil_moisture_pct'] as number | null) ?? null,
        (r['soil_temp_c'] as number | null) ?? null,
        (r['greenhouse_temp_c'] as number | null) ?? null,
        (r['greenhouse_humidity_pct'] as number | null) ?? null,
        (r['indoor_temp_c'] as number | null) ?? null,
        (r['indoor_humidity_pct'] as number | null) ?? null,
        device.id, rfId,
      ),
    );
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  // ── Check for active claim windows and detect bursts ──────────────────────
  ctx.waitUntil(checkAndClaimBursts(env, deviceId, body.readings));

  // ── Update Durable Object accumulator ────────────────────────────────────
  const doId = env.DEVICE_STATE.idFromName(deviceId);
  const stub = env.DEVICE_STATE.get(doId);
  ctx.waitUntil(
    stub.fetch('https://do/readings', {
      method: 'POST',
      body: JSON.stringify({ readings: body.readings }),
    }),
  );

  return jsonResponse({ ok: true, accepted: body.readings.length });
}

/**
 * Check for active claim windows and detect bursts (2+ readings from same RF ID
 * within 10 seconds). If burst detected and sensor not yet named, mark it as
 * claimed in the claim window so the polling endpoint can return it.
 */
async function checkAndClaimBursts(
  env: Env,
  deviceId: string,
  readings: unknown[],
): Promise<void> {
  try {
    // Get all active claim windows for this device
    const claimKeys = await env.CLAIM_WINDOWS.list({ prefix: 'claim:' });
    if (claimKeys.keys.length === 0) return;

    // Parse claim windows and filter by device
    const claimWindows: Array<{ key: string; window: ClaimWindow }> = [];
    for (const key of claimKeys.keys) {
      const json = await env.CLAIM_WINDOWS.get(key.name);
      if (json) {
        const claimWindow: ClaimWindow = JSON.parse(json);
        if (claimWindow.device_id === deviceId && !claimWindow.claimed_rf_id) {
          claimWindows.push({ key: key.name, window: claimWindow });
        }
      }
    }

    if (claimWindows.length === 0) return;

    // Group readings by RF ID
    const rfIdGroups: Record<string, Array<{ rf_id: string; recorded_at: number }>> = {};
    for (const raw of readings) {
      const r = raw as Record<string, unknown>;
      const rfId = r['sensor_rf_id'];
      const recordedAt = r['recorded_at'];
      if (typeof rfId === 'string' && typeof recordedAt === 'number') {
        if (!rfIdGroups[rfId]) rfIdGroups[rfId] = [];
        rfIdGroups[rfId].push({ rf_id: rfId, recorded_at: recordedAt });
      }
    }

    // Detect bursts (2+ readings within 10 seconds)
    for (const { key, window: claimWindow } of claimWindows) {
      for (const [rfId, readingsForRf] of Object.entries(rfIdGroups)) {
        if (readingsForRf.length < 2) continue;

        const times = readingsForRf.map(r => r.recorded_at).sort((a, b) => a - b);
        const timeSpan = (times[times.length - 1] ?? 0) - (times[0] ?? 0);
        if (timeSpan > 10) continue;

        // Check if sensor has already been named (claimed) by the user
        const namedSensor = await env.DB.prepare(`
          SELECT id FROM sensors
          WHERE device_id = ? AND rf_id = ? AND (name IS NOT NULL AND name != '')
          LIMIT 1
        `).bind(claimWindow.device_id, rfId).first<{ id: string }>();

        if (namedSensor) continue;

        // Burst detected on an unclaimed sensor — record in claim window
        claimWindow.claimed_rf_id = rfId;
        await env.CLAIM_WINDOWS.put(
          key,
          JSON.stringify(claimWindow),
          { expirationTtl: 30 },
        );

        // Apply a default name so the sensor appears in the poll response
        const defaultNames: Record<string, string> = {
          soil:      'Soil Sensor',
          greenhouse: 'Greenhouse',
          indoor:    'Indoor Sensor',
        };
        const defaultName = defaultNames[claimWindow.sensor_type] ?? 'Sensor';

        await env.DB.prepare(`
          UPDATE sensors SET name = ?
          WHERE device_id = ? AND rf_id = ? AND (name IS NULL OR name = '')
        `).bind(defaultName, claimWindow.device_id, rfId).run();

        break; // Only one burst per claim window
      }
    }
  } catch (err) {
    console.error('Error checking claim bursts:', err);
    // Don't fail the ingest request if burst check fails
  }
}
