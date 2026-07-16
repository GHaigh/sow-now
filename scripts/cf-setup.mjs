#!/usr/bin/env node
// scripts/cf-setup.mjs
// Run once: node ./scripts/cf-setup.mjs
// Creates all Cloudflare resources needed for Vernal.
// Requires: wrangler login already completed.

import { execSync } from 'child_process';

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
    if (out) console.log(out.trim());
    return out;
  } catch (e) {
    console.error(`✗ Failed: ${e.stderr || e.message}`);
    process.exit(1);
  }
}

function runJson(cmd) {
  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  return JSON.parse(raw);
}

console.log('🌱 Vernal — Cloudflare resource setup\n');

// ── D1 Database ──────────────────────────────────────────────────────────────
console.log('── Creating D1 database...');
run('wrangler d1 create vernal-db');

// ── KV Namespace ─────────────────────────────────────────────────────────────
console.log('\n── Creating KV namespace for sessions...');
run('wrangler kv namespace create vernal-sessions');

// ── Queue ─────────────────────────────────────────────────────────────────────
console.log('\n── Creating advice queue...');
run('wrangler queues create vernal-advice-queue');

// ── Vectorize index ──────────────────────────────────────────────────────────
console.log('\n── Creating Vectorize index for crop knowledge base...');
run('wrangler vectorize create vernal-crops --dimensions 768 --metric cosine');

console.log(`
✅ Cloudflare resources created.

Next steps:
1. Copy the database_id, namespace_id values printed above into:
   apps/api/wrangler.jsonc  (replace the placeholder IDs)

2. Apply migrations:
   npm run db:migrate:local   (local dev)
   npm run db:migrate         (production)

3. Seed crop reference data:
   npm run db:seed:local

4. Set secrets (interactive — do NOT paste into shell history):
   wrangler secret put DEVICE_JWT_SECRET   --config apps/api/wrangler.jsonc
   wrangler secret put VAPID_PRIVATE_KEY   --config apps/api/wrangler.jsonc
`);
