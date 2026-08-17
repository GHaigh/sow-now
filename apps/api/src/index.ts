/**
 * Vernal API — Cloudflare Worker entry point
 *
 * Routes:
 *   POST /api/v1/ingest          — hub sensor data uplink (device JWT auth)
 *   POST /api/v1/provision       — one-time hub provisioning (QR token)
 *   GET  /api/v1/readings/live   — SSE live sensor stream (user JWT auth)
 *   GET  /api/v1/dashboard       — current GDD + sensor snapshot
 *   GET  /api/v1/advice/today    — today's advice card
 *   GET  /api/v1/crops                    — user's crop list
 *   POST /api/v1/crops                    — add a crop
 *   PATCH /api/v1/crops/:id               — update crop status
 *   DELETE /api/v1/crops/:id              — remove a crop
 *   GET  /api/v1/varieties?crop_key=tomato — search varieties
 *   GET  /api/v1/varieties/:id/predict    — planting plan for a variety
 *   POST /api/v1/varieties                — submit community variety
 *   POST /api/v1/sensors/claim/start      — start a sensor claim window
 *   GET  /api/v1/sensors/claim/:id        — poll for claim result
 *   PATCH /api/v1/me/location             — update postcode / climate zone
 *   POST   /api/v1/me/push-subscribe      — register Web Push subscription
 *   DELETE /api/v1/me/push-subscribe      — remove Web Push subscription
 *
 * Scheduled (cron 30 5 * * *):
 *   GDD engine + advice generation
 */

import { handleIngest }          from './routes/ingest';
import { handleProvision, handleProvisionConfig } from './routes/provision';
import { handleLiveReadings }    from './routes/live';
import { handleDashboard }       from './routes/dashboard';
import { handleAdvice }          from './routes/advice';
import { handleCrops }           from './routes/crops';
import { handleAuth, getMe }     from './routes/auth';
import { handleSensors }         from './routes/sensors';
import { handleClaimStart, handleClaimPoll, handleCandidates, handleConfirm, handleWH51Candidates, handleWH51Confirm } from './routes/claim';
import { handleVarieties }        from './routes/varieties';
import { handlePushSubscription } from './routes/push';
import { handleBilling }         from './routes/billing';
import { handleStripeWebhook }   from './routes/stripe-webhook';
import { handleAdviceQueue }     from './queue/advice-consumer';
import { runGddEngine }          from './cron/gdd-engine';
import { corsHeaders, errorResponse } from './lib/http';
import type { Env }              from './types/env';

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
      // ── Auth routes (public) ──────────────────────────────────────────────
      if (path.startsWith('/api/v1/auth') || path === '/api/v1/me') {
        return handleAuth(request, env, ctx);
      }

      // ── Device routes (device JWT auth) ──────────────────────────────────
      if (path === '/api/v1/ingest' && request.method === 'POST') {
        return handleIngest(request, env, ctx);
      }
      if (path === '/api/v1/provision' && request.method === 'POST') {
        return handleProvision(request, env, ctx);
      }
      if (path === '/api/v1/provision/config' && request.method === 'GET') {
        return handleProvisionConfig(request, env, ctx);
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
      if (path === '/api/v1/sensors' && request.method === 'GET') {
        return handleSensors(request, env, ctx);
      }
      if (path.startsWith('/api/v1/sensors/') && request.method === 'PATCH') {
        return handleSensors(request, env, ctx);
      }
      if (path === '/api/v1/sensors/claim/start' && request.method === 'POST') {
        return handleClaimStart(request, env, ctx);
      }
      if (path === '/api/v1/sensors/claim/candidates' && request.method === 'GET') {
        return handleCandidates(request, env, ctx);
      }
      if (path === '/api/v1/sensors/claim/confirm' && request.method === 'POST') {
        return handleConfirm(request, env, ctx);
      }
      if (path === '/api/v1/sensors/claim/wh51/candidates' && request.method === 'GET') {
        return handleWH51Candidates(request, env, ctx);
      }
      if (path === '/api/v1/sensors/claim/wh51/confirm' && request.method === 'POST') {
        return handleWH51Confirm(request, env, ctx);
      }
      if (path.startsWith('/api/v1/sensors/claim/') && request.method === 'GET') {
        return handleClaimPoll(request, env, ctx);
      }

      // ── Varieties + planting predictions ─────────────────────────────────
      if (path.startsWith('/api/v1/varieties')) {
        return handleVarieties(request, env, ctx);
      }

      // ── Push subscription ─────────────────────────────────────────────────
      if (path === '/api/v1/me/push-subscribe') {
        return handlePushSubscription(request, env, ctx);
      }

      // ── Billing routes (user session auth) ───────────────────────────────
      if (path.startsWith('/api/v1/billing')) {
        return handleBilling(request, env, ctx);
      }

      // ── Stripe webhook (Stripe signature auth — no user session) ─────────
      if (path === '/api/v1/webhooks/stripe' && request.method === 'POST') {
        return handleStripeWebhook(request, env, ctx);
      }

      return errorResponse(404, 'Not found', request);
    } catch (err) {
      // Log full error server-side; return generic message to client
      console.error('Unhandled error:', err);
      return errorResponse(500, 'Internal server error', request);
    }
  },

  // ── Cron: GDD engine runs at 05:30 UTC daily ─────────────────────────────
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runGddEngine(env));
  },

  // ── Queue consumer: advice generation jobs ────────────────────────────────
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await handleAdviceQueue(batch, env);
  },
} satisfies ExportedHandler<Env>;
