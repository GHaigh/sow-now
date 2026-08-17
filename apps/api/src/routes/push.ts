/**
 * POST /api/v1/me/push-subscribe   — save Web Push subscription
 * DELETE /api/v1/me/push-subscribe — remove Web Push subscription
 *
 * The client sends a PushSubscription JSON object (from
 * ServiceWorkerRegistration.pushManager.subscribe).
 * We store endpoint, p256dh key, and auth key on the user row.
 */

import { jsonResponse, errorResponse } from '../lib/http';
import { getUserIdFromSession } from './auth';
import type { Env } from '../types/env';

interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export async function handlePushSubscription(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  if (request.method === 'POST') {
    return subscribe(userId, request, env);
  }
  if (request.method === 'DELETE') {
    return unsubscribe(userId, env, request);
  }

  return errorResponse(405, 'Method not allowed');
}

async function subscribe(userId: string, request: Request, env: Env): Promise<Response> {
  let body: PushSubscriptionPayload;
  try {
    body = await request.json() as PushSubscriptionPayload;
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return errorResponse(400, 'endpoint, keys.p256dh, and keys.auth required');
  }

  await env.DB.prepare(`
    UPDATE users
    SET push_enabled = 1,
        push_endpoint = ?,
        push_p256dh   = ?,
        push_auth     = ?
    WHERE id = ?
  `).bind(body.endpoint, body.keys.p256dh, body.keys.auth, userId).run();

  return jsonResponse({ ok: true }, 200, request);
}

async function unsubscribe(userId: string, env: Env, request: Request): Promise<Response> {
  await env.DB.prepare(`
    UPDATE users
    SET push_enabled = 0,
        push_endpoint = NULL,
        push_p256dh   = NULL,
        push_auth     = NULL
    WHERE id = ?
  `).bind(userId).run();

  return jsonResponse({ ok: true }, 200, request);
}
