/**
 * Sensor Claiming Flow
 *
 * POST /api/v1/sensors/claim/start
 *   Opens a 30-second claim window for button-press detection (WS69, WH31).
 *   Returns { claim_id }
 *
 * GET /api/v1/sensors/claim/:claim_id
 *   Polls for button-press burst result.
 *   Returns { status: 'waiting'|'claimed'|'timeout', sensor?: Sensor }
 *
 * GET /api/v1/sensors/claim/candidates
 *   Returns ALL unclaimed sensors currently heard by the device, with their
 *   latest reading snapshot. Used for the "scan for existing sensors" phase.
 *   Returns { candidates: ScanCandidate[] }
 *
 * POST /api/v1/sensors/claim/confirm
 *   Confirms any sensor by rf_id (used for scan-phase WS69/WH31 and WH51).
 *   Body: { rf_id: string, name?: string }
 *   Returns { sensor: Sensor }
 *
 * GET /api/v1/sensors/claim/wh51/candidates  (kept for backwards compat)
 *   Returns only WH51 unclaimed candidates with soil reading snapshot.
 *
 * POST /api/v1/sensors/claim/wh51/confirm  (kept for backwards compat)
 *   Confirms a WH51 by rf_id.
 */

import { nanoid } from 'nanoid';
import { jsonResponse, errorResponse } from '../lib/http';
import { getUserIdFromSession } from './auth';
import type { Env } from '../types/env';

interface ClaimWindow {
  device_id: string;
  sensor_type: string;
  created_at: number;
  claimed_rf_id: string | null;
}

interface Sensor {
  id: string;
  sensor_type: string;
  name: string;
  rf_id: string | null;
}

interface SensorRow {
  id: string;
  rf_id: string;
  sensor_type: string;
  name: string | null;
  battery_pct: number | null;
  last_seen_at: number | null;
  snap_temp_c: number | null;
  snap_humidity_pct: number | null;
  snap_wind_avg_ms: number | null;
  snap_wind_dir_deg: number | null;
  snap_rain_mm: number | null;
  snap_soil_moisture_pct: number | null;
  snap_soil_temp_c: number | null;
}

// ── Button-press claiming (WS69, WH31) ───────────────────────────────────────

export async function handleClaimStart(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const device = await env.DB.prepare(`
    SELECT id FROM devices WHERE user_id = ? LIMIT 1
  `).bind(userId).first<{ id: string }>();

  if (!device) return errorResponse(404, 'Device not found');

  let body: { sensor_type?: unknown };
  try {
    body = await request.json() as { sensor_type?: unknown };
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  const sensorType = body.sensor_type;
  if (typeof sensorType !== 'string' || !['soil', 'greenhouse', 'indoor'].includes(sensorType)) {
    return errorResponse(400, 'sensor_type required (soil, greenhouse, or indoor)');
  }

  const claimId = nanoid();
  const claimWindow: ClaimWindow = {
    device_id: device.id,
    sensor_type: sensorType,
    created_at: Math.floor(Date.now() / 1000),
    claimed_rf_id: null,
  };

  await env.CLAIM_WINDOWS.put(
    `claim:${claimId}`,
    JSON.stringify(claimWindow),
    { expirationTtl: 30 },
  );

  return jsonResponse({ claim_id: claimId }, 200, request);
}

export async function handleClaimPoll(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const claimId = pathParts[pathParts.length - 1];

  if (typeof claimId !== 'string' || claimId.length === 0) {
    return errorResponse(400, 'claim_id required');
  }

  const claimWindowJson = await env.CLAIM_WINDOWS.get(`claim:${claimId}`);
  if (!claimWindowJson) {
    return jsonResponse({ status: 'timeout', sensor: null }, 200, request);
  }

  const claimWindow: ClaimWindow = JSON.parse(claimWindowJson);

  if (claimWindow.claimed_rf_id) {
    const sensor = await env.DB.prepare(`
      SELECT id, sensor_type, name, rf_id
      FROM sensors
      WHERE device_id = ? AND rf_id = ? AND user_id = ?
      LIMIT 1
    `).bind(
      claimWindow.device_id,
      claimWindow.claimed_rf_id,
      userId,
    ).first<Sensor>();

    if (sensor) {
      return jsonResponse({ status: 'claimed', sensor }, 200, request);
    }
  }

  return jsonResponse({ status: 'waiting', sensor: null }, 200, request);
}

// ── Scan-for-existing: all unclaimed sensors ──────────────────────────────────

/**
 * GET /api/v1/sensors/claim/candidates
 *
 * Returns every sensor currently heard by the device that has not yet been
 * claimed (name IS NULL or empty), along with its latest reading snapshot.
 *
 * The UI uses this during the 5-minute "scan for existing sensors" phase.
 * Each sensor type exposes the readings most useful for customer recognition:
 *   WS69  → temp, humidity, wind, rain
 *   WH31  → temp, humidity
 *   WH51  → soil moisture, soil temp, last-4 of RF ID
 */
export async function handleCandidates(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const device = await env.DB.prepare(`
    SELECT id FROM devices WHERE user_id = ? LIMIT 1
  `).bind(userId).first<{ id: string }>();

  if (!device) return errorResponse(404, 'Device not found');

  const { results } = await env.DB.prepare(`
    SELECT rf_id, sensor_type, name, battery_pct, last_seen_at,
           snap_temp_c, snap_humidity_pct,
           snap_wind_avg_ms, snap_wind_dir_deg, snap_rain_mm,
           snap_soil_moisture_pct, snap_soil_temp_c
    FROM sensors
    WHERE device_id = ? AND (name IS NULL OR name = '')
    ORDER BY sensor_type, last_seen_at DESC
  `).bind(device.id).all<SensorRow>();

  const candidates = results.map(row => candidateFromRow(row));

  return jsonResponse({ candidates }, 200, request);
}

/**
 * POST /api/v1/sensors/claim/confirm
 *
 * Confirms any sensor (WS69, WH31, or WH51) by rf_id.
 * Sets a default name on the sensor row to mark it as claimed.
 * An optional `name` field lets the customer set their own name in one step.
 *
 * Body: { rf_id: string, name?: string }
 */
export async function handleConfirm(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const device = await env.DB.prepare(`
    SELECT id FROM devices WHERE user_id = ? LIMIT 1
  `).bind(userId).first<{ id: string }>();

  if (!device) return errorResponse(404, 'Device not found');

  let body: { rf_id?: unknown; name?: unknown };
  try {
    body = await request.json() as { rf_id?: unknown; name?: unknown };
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  const rfId = body.rf_id;
  if (typeof rfId !== 'string' || rfId.length === 0) {
    return errorResponse(400, 'rf_id required');
  }

  const customName = typeof body.name === 'string' && body.name.trim().length > 0
    ? body.name.trim()
    : null;

  const existing = await env.DB.prepare(`
    SELECT id, rf_id, sensor_type, name
    FROM sensors
    WHERE device_id = ? AND user_id = ? AND rf_id = ?
    LIMIT 1
  `).bind(device.id, userId, rfId).first<Sensor>();

  if (!existing) {
    return errorResponse(404, 'Sensor not found — make sure it is powered on and within range');
  }

  // If already claimed and no new name provided, return as-is
  if (existing.name && !customName) {
    return jsonResponse({ sensor: existing }, 200, request);
  }

  const defaultNames: Record<string, string> = {
    soil:      'Soil Sensor',
    greenhouse: 'Greenhouse',
    indoor:    'Indoor Sensor',
  };
  const name = customName ?? defaultNames[existing.sensor_type] ?? 'Sensor';

  await env.DB.prepare(`
    UPDATE sensors SET name = ? WHERE id = ?
  `).bind(name, existing.id).run();

  return jsonResponse({ sensor: { ...existing, name } }, 200, request);
}

// ── WH51 — RF ID list claiming (kept for backwards compatibility) ─────────────

/**
 * GET /api/v1/sensors/claim/wh51/candidates
 * Returns unclaimed WH51 sensors with soil reading snapshot + last-4 ID.
 */
export async function handleWH51Candidates(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const device = await env.DB.prepare(`
    SELECT id FROM devices WHERE user_id = ? LIMIT 1
  `).bind(userId).first<{ id: string }>();

  if (!device) return errorResponse(404, 'Device not found');

  const { results } = await env.DB.prepare(`
    SELECT rf_id, last_seen_at, snap_soil_moisture_pct, snap_soil_temp_c, battery_pct
    FROM sensors
    WHERE device_id = ? AND sensor_type = 'soil' AND (name IS NULL OR name = '')
    ORDER BY last_seen_at DESC
  `).bind(device.id).all<Pick<SensorRow, 'rf_id' | 'last_seen_at' | 'snap_soil_moisture_pct' | 'snap_soil_temp_c' | 'battery_pct'>>();

  const candidates = results.map(row => ({
    rf_id:               row.rf_id,
    last4:               row.rf_id.slice(-4).toUpperCase(),
    last_seen_at:        row.last_seen_at,
    soil_moisture_pct:   row.snap_soil_moisture_pct,
    soil_temp_c:         row.snap_soil_temp_c,
    battery_pct:         row.battery_pct,
  }));

  return jsonResponse({ candidates }, 200, request);
}

/**
 * POST /api/v1/sensors/claim/wh51/confirm
 * Confirms a WH51 by rf_id.
 */
export async function handleWH51Confirm(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Delegate to the generic confirm handler
  return handleConfirm(request, env, ctx);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function candidateFromRow(row: SensorRow) {
  const base = {
    rf_id:        row.rf_id,
    sensor_type:  row.sensor_type,
    last_seen_at: row.last_seen_at,
    battery_pct:  row.battery_pct,
  };

  if (row.sensor_type === 'soil') {
    return {
      ...base,
      last4:             row.rf_id.slice(-4).toUpperCase(),
      soil_moisture_pct: row.snap_soil_moisture_pct,
      soil_temp_c:       row.snap_soil_temp_c,
    };
  }

  // greenhouse / indoor
  return {
    ...base,
    temp_c:       row.snap_temp_c,
    humidity_pct: row.snap_humidity_pct,
  };
}
