/**
 * GET /api/v1/sensors
 *
 * Returns the list of sensors for the authenticated user's device,
 * along with the device status. Used by the Sensors page and onboarding.
 */

import { jsonResponse, errorResponse } from '../lib/http';
import { getUserIdFromSession } from './auth';
import type { Env } from '../types/env';

export async function handleSensors(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  // Get user's primary device
  const device = await env.DB.prepare(`
    SELECT id, name, last_seen_at, firmware_version
    FROM devices WHERE user_id = ? LIMIT 1
  `).bind(userId).first<{
    id: string; name: string;
    last_seen_at: number | null; firmware_version: string | null;
  }>();

  if (!device) {
    return jsonResponse({ device: null, sensors: [] }, 200, request);
  }

  const isOnline = device.last_seen_at != null
    && (Math.floor(Date.now() / 1000) - device.last_seen_at) < 600;

  const { results: sensors } = await env.DB.prepare(`
    SELECT id, sensor_type, name, battery_pct, last_seen_at, rf_id
    FROM sensors
    WHERE device_id = ?
    ORDER BY sensor_type, created_at
  `).bind(device.id).all<{
    id: string; sensor_type: string; name: string;
    battery_pct: number | null; last_seen_at: number | null; rf_id: string | null;
  }>();

  return jsonResponse({
    device: {
      id: device.id,
      name: device.name,
      online: isOnline,
      last_seen_at: device.last_seen_at,
      firmware_version: device.firmware_version,
    },
    sensors,
  }, 200, request);
}
