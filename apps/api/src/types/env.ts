/**
 * Cloudflare Worker environment bindings for Vernal API.
 * Generated shape — keep in sync with wrangler.jsonc.
 */

export interface Env {
  // ── D1 ──────────────────────────────────────────────────────────────────
  DB: D1Database;

  // ── KV ──────────────────────────────────────────────────────────────────
  SESSIONS: KVNamespace;

  // ── Queues ───────────────────────────────────────────────────────────────
  ADVICE_QUEUE: Queue;

  // ── Durable Objects ──────────────────────────────────────────────────────
  DEVICE_STATE: DurableObjectNamespace;

  // ── Workers AI ───────────────────────────────────────────────────────────
  AI: Ai;

  // ── Vectorize ────────────────────────────────────────────────────────────
  CROP_INDEX: VectorizeIndex;

  // ── Secrets (set via wrangler secret put) ────────────────────────────────
  DEVICE_JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;

  // ── Vars ─────────────────────────────────────────────────────────────────
  ENVIRONMENT: string;
}
