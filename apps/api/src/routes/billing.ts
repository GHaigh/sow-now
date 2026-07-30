/**
 * Billing routes — Stripe Checkout + Customer Portal
 *
 * POST /api/v1/billing/checkout   — create Checkout session (upgrade flow)
 * POST /api/v1/billing/portal     — create billing portal session (manage/cancel)
 * GET  /api/v1/billing/status     — return current tier + renewal date
 */

import { jsonResponse, errorResponse } from '../lib/http';
import { getUserIdFromSession } from './auth';
import type { Env } from '../types/env';

// Stripe API base URL
const STRIPE_API = 'https://api.stripe.com/v1';

// ── Stripe helpers ────────────────────────────────────────────────────────────

/**
 * Make an authenticated Stripe API request using the REST API directly.
 * We avoid importing the stripe npm package to keep Worker bundle size minimal.
 */
async function stripePost(env: Env, path: string, body: Record<string, string>): Promise<Response> {
  const encoded = new URLSearchParams(body).toString();
  return fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encoded,
  });
}

async function stripeGet(env: Env, path: string): Promise<Response> {
  return fetch(`${STRIPE_API}${path}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
}

/** Get or create a Stripe customer for this user. */
async function getOrCreateCustomer(userId: string, email: string, env: Env): Promise<string> {
  const user = await env.DB
    .prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ stripe_customer_id: string | null }>();

  if (user?.stripe_customer_id) return user.stripe_customer_id;

  // Create new Stripe customer
  const res = await stripePost(env, '/customers', {
    email,
    'metadata[user_id]': userId,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Stripe create customer error:', err);
    throw new Error('Failed to create Stripe customer');
  }

  const customer = await res.json() as { id: string };
  await env.DB
    .prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
    .bind(customer.id, userId)
    .run();

  return customer.id;
}

// ── POST /api/v1/billing/checkout ─────────────────────────────────────────────
async function createCheckout(request: Request, env: Env): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const body = await request.json() as { tier?: string };
  const tierRaw = body.tier;

  if (tierRaw !== 'grower' && tierRaw !== 'smallholder') {
    return errorResponse(400, 'tier must be "grower" or "smallholder"');
  }
  const tier: 'grower' | 'smallholder' = tierRaw;
  const priceId = tier === 'grower' ? env.STRIPE_PRICE_GROWER : env.STRIPE_PRICE_SMALLHOLDER;

  const user = await env.DB
    .prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();

  if (!user) return errorResponse(404, 'User not found');

  const customerId = await getOrCreateCustomer(userId, user.email, env);

  const res = await stripePost(env, '/checkout/sessions', {
    'customer': customerId,
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `https://app.sow-now.uk/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': `https://app.sow-now.uk/settings`,
    'metadata[user_id]': userId,
    'metadata[tier]': tier,
    'subscription_data[metadata][user_id]': userId,
    'subscription_data[metadata][tier]': tier,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Stripe checkout error:', err);
    return errorResponse(500, 'Failed to create checkout session');
  }

  const session = await res.json() as { url: string };
  return jsonResponse({ url: session.url }, 200, request);
}

// ── POST /api/v1/billing/portal ───────────────────────────────────────────────
async function createPortal(request: Request, env: Env): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const user = await env.DB
    .prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ stripe_customer_id: string | null }>();

  if (!user?.stripe_customer_id) {
    return errorResponse(400, 'No active subscription');
  }

  const res = await stripePost(env, '/billing_portal/sessions', {
    'customer': user.stripe_customer_id,
    'return_url': 'https://app.sow-now.uk/settings',
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Stripe portal error:', err);
    return errorResponse(500, 'Failed to create portal session');
  }

  const portal = await res.json() as { url: string };
  return jsonResponse({ url: portal.url }, 200, request);
}

// ── GET /api/v1/billing/status ────────────────────────────────────────────────
async function getBillingStatus(request: Request, env: Env): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const user = await env.DB
    .prepare('SELECT tier, tier_expires_at, stripe_customer_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ tier: string; tier_expires_at: number | null; stripe_customer_id: string | null }>();

  if (!user) return errorResponse(404, 'User not found');

  return jsonResponse({
    tier: user.tier,
    tier_expires_at: user.tier_expires_at,
    has_payment_method: user.stripe_customer_id != null,
  }, 200, request);
}

// ── Router ────────────────────────────────────────────────────────────────────
export async function handleBilling(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const path = new URL(request.url).pathname;

  if (path === '/api/v1/billing/checkout' && request.method === 'POST') {
    return createCheckout(request, env);
  }
  if (path === '/api/v1/billing/portal' && request.method === 'POST') {
    return createPortal(request, env);
  }
  if (path === '/api/v1/billing/status' && request.method === 'GET') {
    return getBillingStatus(request, env);
  }

  return errorResponse(404, 'Not found');
}
