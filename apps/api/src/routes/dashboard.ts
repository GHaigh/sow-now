import { getUserIdFromSession } from './auth';
/**
 * GET /api/v1/dashboard
 *
 * Returns the current GDD state, latest sensor readings, active crops,
 * and any pending alerts for the authenticated user.
 *
 * Auth: user session JWT in Authorization header.
 */

import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

export async function handleDashboard(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  // ── Fetch user's devices ───────────────────────────────────────────────
  const { results: devices } = await env.DB
    .prepare('SELECT id, name, last_seen_at, firmware_version FROM devices WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string; name: string; last_seen_at: number | null; firmware_version: string | null }>();

  if (devices.length === 0) {
    return jsonResponse({ devices: [], gdd: null, sensors: [], crops: [], alerts: [] });
  }

  const device = devices[0]!;

  // ── Live state from Durable Object ────────────────────────────────────
  const doId = env.DEVICE_STATE.idFromName(device.id);
  const stub = env.DEVICE_STATE.get(doId);
  const stateRes = await stub.fetch('https://do/state');
  const deviceState = await stateRes.json<{
    latest: {
      outdoor: Record<string, unknown>;
      greenhouse: Record<string, unknown>;
      soil: Record<string, unknown>;
    };
    gdd: { outdoor: number; greenhouse: number; season_start: string };
    alerts: string[];
    updated_at: number;
  }>();

  // ── Active crops with GDD progress ───────────────────────────────────
  const { results: crops } = await env.DB.prepare(`
    SELECT
      c.id, c.crop_key, c.variety, c.bed_name, c.status,
      c.gdd_accumulated, c.gdd_base_temp_c, c.sown_at,
      cr.display_name, cr.gdd_to_harvest_min, cr.gdd_to_harvest_max,
      cr.soil_temp_min_c
    FROM crops c
    LEFT JOIN crops_reference cr ON c.crop_key = cr.crop_key
    WHERE c.user_id = ?
      AND c.status NOT IN ('harvested', 'failed')
    ORDER BY c.created_at DESC
  `).bind(userId).all<Record<string, unknown>>();

  // ── Last 7 days GDD trend for chart ──────────────────────────────────
  const { results: gddTrend } = await env.DB.prepare(`
    SELECT date, SUM(gdd) AS gdd, zone
    FROM gdd_daily
    WHERE user_id = ?
      AND date >= date('now', '-7 days')
    GROUP BY date, zone
    ORDER BY date ASC
  `).bind(userId).all<{ date: string; gdd: number; zone: string }>();

  return jsonResponse({
    device: {
      id: device.id,
      name: device.name,
      last_seen_at: device.last_seen_at,
      firmware_version: device.firmware_version,
      online: device.last_seen_at != null && (Date.now() / 1000 - device.last_seen_at) < 600,
    },
    latest: deviceState.latest,
    gdd: deviceState.gdd,
    gdd_trend: gddTrend,
    crops,
    alerts: deviceState.alerts,
  }, 200, request);
}

