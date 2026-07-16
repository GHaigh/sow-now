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
 *       sensor_type: 'weather_station' | 'soil' | 'greenhouse',
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
 *       battery_pct?: number,
 *     },
 *     ...
 *   ]
 * }
 */

import { verifyDeviceToken } from '../lib/auth';
import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

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
  let body: { readings?: unknown[] };
  try {
    body = await request.json() as { readings?: unknown[] };
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

  // ── Update device last_seen ──────────────────────────────────────────────
  ctx.waitUntil(
    env.DB
      .prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), deviceId)
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
    if (sensorType !== 'weather_station' && sensorType !== 'soil' && sensorType !== 'greenhouse') continue;

    const rfId = r['sensor_rf_id'] as string;

    // Upsert sensor (insert if new RF ID seen for this device)
    stmts.push(
      env.DB.prepare(`
        INSERT INTO sensors (id, device_id, user_id, rf_id, sensor_type, last_seen_at)
        VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, rf_id) DO UPDATE SET
          last_seen_at = excluded.last_seen_at,
          battery_pct  = COALESCE(?, battery_pct)
      `).bind(
        device.id, device.user_id, rfId, sensorType,
        Math.floor(Date.now() / 1000),
        (r['battery_pct'] as number | null) ?? null,
      ),
    );

    // Insert reading row — look up sensor_id by rf_id + device_id
    stmts.push(
      env.DB.prepare(`
        INSERT INTO readings (
          sensor_id, device_id, user_id, recorded_at,
          temp_c, humidity_pct, pressure_hpa,
          wind_avg_ms, wind_max_ms, wind_dir_deg,
          rain_mm, uv_index, solar_lux,
          soil_moisture_pct, soil_temp_c,
          greenhouse_temp_c, greenhouse_humidity_pct
        )
        SELECT
          s.id, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?
        FROM sensors s
        WHERE s.device_id = ? AND s.rf_id = ?
      `).bind(
        device.id, device.user_id, r['recorded_at'] as number,
        (r['temp_c'] as number | null) ?? null,
        (r['humidity_pct'] as number | null) ?? null,
        (r['pressure_hpa'] as number | null) ?? null,
        (r['wind_avg_ms'] as number | null) ?? null,
        (r['wind_max_ms'] as number | null) ?? null,
        (r['wind_dir_deg'] as number | null) ?? null,
        (r['rain_mm'] as number | null) ?? null,
        (r['uv_index'] as number | null) ?? null,
        (r['solar_lux'] as number | null) ?? null,
        (r['soil_moisture_pct'] as number | null) ?? null,
        (r['soil_temp_c'] as number | null) ?? null,
        (r['greenhouse_temp_c'] as number | null) ?? null,
        (r['greenhouse_humidity_pct'] as number | null) ?? null,
        device.id, rfId,
      ),
    );
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

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
