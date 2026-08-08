/**
 * Provisioning endpoints
 *
 * POST /api/v1/provision
 *   One-time hub provisioning — called by the Vernal app when the customer
 *   scans the QR code. Binds the device to the user, issues a device JWT,
 *   and stores it so the Pi can retrieve it via the poll endpoint below.
 *
 * GET /api/v1/provision/config?device_id=<id>
 *   Polled by the Pi every few seconds after WiFi connects. Returns the
 *   device JWT once the customer has scanned the QR code, otherwise 202.
 *   The Pi writes the JWT to /etc/sow-now/config.json and starts the agent.
 *   Authenticated by the pre-burned provision token in the query string:
 *     ?device_id=<id>&token=<provision_token>
 */

import { getUserIdFromSession } from './auth';
import { issueDeviceToken } from '../lib/auth';
import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

export async function handleProvision(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // Session auth
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  let body: { token?: string };
  try {
    body = await request.json() as { token?: string };
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  if (!body.token || typeof body.token !== 'string') {
    return errorResponse(400, 'token required');
  }

  const now = Math.floor(Date.now() / 1000);

  // ── Look up provision token ──────────────────────────────────────────
  const record = await env.DB.prepare(`
    SELECT pt.token, pt.device_id, pt.used, pt.expires_at, d.serial
    FROM provision_tokens pt
    JOIN devices d ON pt.device_id = d.id
    WHERE pt.token = ?
  `).bind(body.token).first<{
    token: string;
    device_id: string;
    used: number;
    expires_at: number;
    serial: string;
  }>();

  if (!record) return errorResponse(404, 'Provisioning token not found');
  if (record.used) return errorResponse(409, 'This hub has already been provisioned');
  if (record.expires_at < now) return errorResponse(410, 'Provisioning token has expired');

  // ── Bind device to user & mark token used ────────────────────────────
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET user_id = ?, provisioned_at = ? WHERE id = ?')
      .bind(userId, now, record.device_id),
    env.DB.prepare('UPDATE provision_tokens SET used = 1 WHERE token = ?')
      .bind(body.token),
  ]);

  // ── Issue device JWT ─────────────────────────────────────────────────
  const deviceJwt = await issueDeviceToken(record.device_id, env.DEVICE_JWT_SECRET);

  // Store the JWT in KV so the Pi can retrieve it via the poll endpoint.
  // Key: provision:<device_id>  TTL: 1 hour (Pi should pick it up within seconds)
  await env.SESSIONS.put(
    `provision:${record.device_id}`,
    deviceJwt,
    { expirationTtl: 3600 },
  );

  return jsonResponse({
    ok: true,
    deviceId: record.device_id,
    serial: record.serial,
    deviceJwt,
    ingestUrl: 'https://api.sow-now.uk/api/v1/ingest',
  }, 200, request);
}

/**
 * GET /api/v1/provision/config?device_id=<id>&token=<provision_token>
 *
 * Polled by the Pi after WiFi connects. Authenticates using the pre-burned
 * provision token (proves physical possession of the device).
 *
 * Returns:
 *   202 { status: 'pending' }   — customer hasn't scanned QR yet
 *   200 { status: 'ready', device_jwt, ingest_url }  — JWT available, Pi can start
 *   410 { error }               — token expired or already used and JWT consumed
 */
export async function handleProvisionConfig(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('device_id');
  const token    = url.searchParams.get('token');

  if (!deviceId || !token) {
    return errorResponse(400, 'device_id and token required');
  }

  const now = Math.floor(Date.now() / 1000);

  // Verify the provision token matches this device and hasn't expired
  const record = await env.DB.prepare(`
    SELECT pt.used, pt.expires_at
    FROM provision_tokens pt
    WHERE pt.token = ? AND pt.device_id = ?
  `).bind(token, deviceId).first<{ used: number; expires_at: number }>();

  if (!record) return errorResponse(404, 'Token not found');
  if (record.expires_at < now) return errorResponse(410, 'Token expired');

  // Check if JWT has been issued (customer has scanned QR)
  const deviceJwt = await env.SESSIONS.get(`provision:${deviceId}`);

  if (!deviceJwt) {
    // Not yet provisioned — tell Pi to keep polling
    return jsonResponse({ status: 'pending' }, 202, request);
  }

  // JWT is ready — delete it from KV (one-time retrieval)
  await env.SESSIONS.delete(`provision:${deviceId}`);

  return jsonResponse({
    status:      'ready',
    device_jwt:  deviceJwt,
    ingest_url:  'https://api.sow-now.uk/api/v1/ingest',
  }, 200, request);
}

