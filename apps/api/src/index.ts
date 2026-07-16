/**
 * Vernal API — Cloudflare Worker entry point
 *
 * Routes:
 *   POST /api/v1/ingest          — hub sensor data uplink (device JWT auth)
 *   POST /api/v1/provision       — one-time hub provisioning (QR token)
 *   GET  /api/v1/readings/live   — SSE live sensor stream (user JWT auth)
 *   GET  /api/v1/dashboard       — current GDD + sensor snapshot
 *   GET  /api/v1/advice/today    — today's advice card
 *   GET  /api/v1/crops           — user's crop list
 *   POST /api/v1/crops           — add a crop
 *   PATCH /api/v1/crops/:id      — update crop status
 *
 * Scheduled (cron 30 5 * * *):
 *   GDD engine + advice generation
 */

import { handleIngest }       from './routes/ingest';
import { handleProvision }    from './routes/provision';
import { handleLiveReadings } from './routes/live';
import { handleDashboard }    from './routes/dashboard';
import { handleAdvice }       from './routes/advice';
import { handleCrops }        from './routes/crops';
import { handleAdviceQueue }  from './queue/advice-consumer';
import { runGddEngine }       from './cron/gdd-engine';
import { corsHeaders, errorResponse } from './lib/http';
import type { Env }           from './types/env';

export { DeviceStateDO } from './durable-objects/device-state';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── Device routes (device JWT auth) ──────────────────────────────────
      if (path === '/api/v1/ingest' && request.method === 'POST') {
        return handleIngest(request, env, ctx);
      }
      if (path === '/api/v1/provision' && request.method === 'POST') {
        return handleProvision(request, env, ctx);
      }

      // ── User routes (user session auth) ──────────────────────────────────
      if (path === '/api/v1/readings/live' && request.method === 'GET') {
        return handleLiveReadings(request, env, ctx);
      }
      if (path === '/api/v1/dashboard' && request.method === 'GET') {
        return handleDashboard(request, env, ctx);
      }
      if (path === '/api/v1/advice/today' && request.method === 'GET') {
        return handleAdvice(request, env, ctx);
      }
      if (path.startsWith('/api/v1/crops')) {
        return handleCrops(request, env, ctx);
      }

      return errorResponse(404, 'Not found');
    } catch (err) {
      // Log full error server-side; return generic message to client
      console.error('Unhandled error:', err);
      return errorResponse(500, 'Internal server error');
    }
  },

  // ── Cron: GDD engine runs at 05:30 UTC daily ─────────────────────────────
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runGddEngine(env));
  },

  // ── Queue consumer: advice generation jobs ────────────────────────────────
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await handleAdviceQueue(batch, env);
  },
} satisfies ExportedHandler<Env>;
