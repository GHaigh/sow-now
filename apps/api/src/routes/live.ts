import { getUserIdFromSession } from './auth';
/**
 * GET /api/v1/readings/live
 *
 * Server-Sent Events (SSE) stream of live sensor readings.
 * Polls the Durable Object every 30 seconds and pushes latest state.
 * Clients reconnect automatically via EventSource API.
 *
 * Auth: user session JWT in Authorization header.
 */

import { errorResponse } from '../lib/http';
import type { Env } from '../types/env';

export async function handleLiveReadings(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const { results: devices } = await env.DB
    .prepare('SELECT id FROM devices WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .all<{ id: string }>();

  if (devices.length === 0) {
    return errorResponse(404, 'No device found for user');
  }

  const deviceId = devices[0]!.id;

  // SSE stream — readable stream that polls DO every 30 s
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (data: unknown) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  ctx.waitUntil(
    (async () => {
      let ticks = 0;
      const maxTicks = 60; // 60 × 30s = 30 minutes max stream lifetime

      while (ticks < maxTicks) {
        try {
          const doId = env.DEVICE_STATE.idFromName(deviceId);
          const stub = env.DEVICE_STATE.get(doId);
          const stateRes = await stub.fetch('https://do/state');
          const state = await stateRes.json<unknown>();
          await write(state);
        } catch (err) {
          console.error('SSE poll error:', err);
        }
        await new Promise(r => setTimeout(r, 30_000));
        ticks++;
      }

      // Send close event and end stream
      await writer.write(encoder.encode('event: close\ndata: {}\n\n'));
      await writer.close();
    })(),
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': 'https://sow-now.uk',
    },
  });
}

async function getUserIdFromSession(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return env.SESSIONS.get(`session:${token}`);
}
