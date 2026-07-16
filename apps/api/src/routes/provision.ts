/**
 * POST /api/v1/provision
 *
 * One-time hub provisioning endpoint.
 * Called by the Vernal app when the user scans the QR code on their hub.
 *
 * Request body:
 * {
 *   token: string,    // QR provisioning token from the box
 *   userId: string,   // authenticated user's ID
 * }
 *
 * On success:
 * - Marks token as used
 * - Binds device to user account
 * - Issues a device JWT (returned once — hub stores it securely)
 * - Returns device config
 */

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

  return jsonResponse({
    ok: true,
    deviceId: record.device_id,
    serial: record.serial,
    deviceJwt,   // Returned once — hub must store this securely
    ingestUrl: 'https://api.vernal.app/api/v1/ingest',
  }, 200, request);
}

async function getUserIdFromSession(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return env.SESSIONS.get(`session:${token}`);
}
