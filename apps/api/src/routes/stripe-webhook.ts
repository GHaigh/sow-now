/**
 * Stripe webhook handler
 *
 * POST /api/v1/webhooks/stripe
 *
 * Handles:
 *   checkout.session.completed      — activate subscription after first payment
 *   invoice.payment_succeeded       — renew tier_expires_at on recurring billing
 *   customer.subscription.deleted   — downgrade user to 'seed' on cancellation
 *   customer.subscription.updated   — handle plan changes (upgrade/downgrade)
 *
 * Stripe sends a Stripe-Signature header which we verify using HMAC-SHA256
 * against STRIPE_WEBHOOK_SECRET.  We use the Web Crypto API (no npm deps).
 */

import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

const TIER_MAP: Record<string, 'grower' | 'smallholder'> = {};

// ── Signature verification (Stripe v3 scheme) ─────────────────────────────────
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  // sigHeader format: t=<timestamp>,v1=<hmac>,v1=<hmac>,...
  const parts: Record<string, string[]> = {};
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (!parts[k]) parts[k] = [];
    parts[k].push(v);
  }

  const timestamp = parts['t']?.[0];
  const signatures = parts['v1'] ?? [];
  if (!timestamp || signatures.length === 0) return false;

  // Reject if timestamp is > 5 minutes old (replay protection)
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBytes = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return signatures.some(sig => sig === expected);
}

// ── Tier from Stripe price ID ─────────────────────────────────────────────────
function tierFromPriceId(priceId: string, env: Env): 'grower' | 'smallholder' | null {
  if (priceId === env.STRIPE_PRICE_GROWER)      return 'grower';
  if (priceId === env.STRIPE_PRICE_SMALLHOLDER) return 'smallholder';
  return null;
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(event: any, env: Env): Promise<void> {
  const session = event.data.object;
  const userId = session.metadata?.user_id;
  const tier   = session.metadata?.tier as 'grower' | 'smallholder' | undefined;

  if (!userId || !tier) {
    console.error('checkout.session.completed: missing metadata', session.id);
    return;
  }

  // Subscription active for 31 days from now (Stripe will send invoice.payment_succeeded to renew)
  const expiresAt = Math.floor(Date.now() / 1000) + 31 * 24 * 3600;
  const subId = session.subscription as string | undefined;

  await env.DB.prepare(
    `UPDATE users
     SET tier = ?, tier_expires_at = ?, stripe_subscription_id = ?
     WHERE id = ?`,
  ).bind(tier, expiresAt, subId ?? null, userId).run();

  console.log(`Activated tier=${tier} for user=${userId}`);
}

async function handleInvoiceSucceeded(event: any, env: Env): Promise<void> {
  const invoice = event.data.object;
  const subId   = invoice.subscription as string;

  if (!subId) return;

  // Fetch subscription to get price ID → tier
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });

  if (!res.ok) {
    console.error('Failed to fetch subscription:', subId, await res.text());
    return;
  }

  const sub = await res.json() as any;
  const priceId = sub.items?.data?.[0]?.price?.id as string | undefined;
  const userId  = sub.metadata?.user_id as string | undefined;

  if (!userId || !priceId) {
    console.error('invoice.payment_succeeded: missing metadata on subscription', subId);
    return;
  }

  const tier = tierFromPriceId(priceId, env);
  if (!tier) {
    console.error('invoice.payment_succeeded: unknown price_id', priceId);
    return;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 31 * 24 * 3600;

  await env.DB.prepare(
    `UPDATE users SET tier = ?, tier_expires_at = ? WHERE id = ?`,
  ).bind(tier, expiresAt, userId).run();

  console.log(`Renewed tier=${tier} for user=${userId} until ${expiresAt}`);
}

async function handleSubscriptionDeleted(event: any, env: Env): Promise<void> {
  const sub    = event.data.object;
  const userId = sub.metadata?.user_id as string | undefined;

  if (!userId) {
    console.error('customer.subscription.deleted: no user_id in metadata', sub.id);
    return;
  }

  await env.DB.prepare(
    `UPDATE users SET tier = 'seed', tier_expires_at = NULL, stripe_subscription_id = NULL WHERE id = ?`,
  ).bind(userId).run();

  console.log(`Downgraded user=${userId} to seed (subscription deleted)`);
}

async function handleSubscriptionUpdated(event: any, env: Env): Promise<void> {
  const sub     = event.data.object;
  const userId  = sub.metadata?.user_id as string | undefined;
  const priceId = sub.items?.data?.[0]?.price?.id as string | undefined;

  if (!userId || !priceId) return;

  const tier = tierFromPriceId(priceId, env);
  if (!tier) return;

  await env.DB.prepare(
    `UPDATE users SET tier = ? WHERE id = ?`,
  ).bind(tier, userId).run();

  console.log(`Updated tier=${tier} for user=${userId}`);
}

// ── Webhook entry point ───────────────────────────────────────────────────────
export async function handleStripeWebhook(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const payload  = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature') ?? '';

  const valid = await verifyStripeSignature(payload, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.warn('Stripe webhook: invalid signature');
    return errorResponse(400, 'Invalid signature');
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event, env);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoiceSucceeded(event, env);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event, env);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event, env);
        break;
      default:
        // Ignore unhandled event types (Stripe sends many)
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Return 200 to prevent Stripe from retrying a permanent error
    return jsonResponse({ ok: false }, 200, request);
  }

  return jsonResponse({ ok: true }, 200, request);
}
