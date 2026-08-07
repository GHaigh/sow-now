#!/usr/bin/env node
/**
 * manufacture-hub.mjs
 * Creates a new Sow Now hub device in D1 and writes a ready-to-use config.json.
 *
 * Usage:
 *   DEVICE_JWT_SECRET=<secret> node scripts/manufacture-hub.mjs sn-001
 *
 * Requires:
 *   - wrangler login already completed (same account as production)
 *   - DEVICE_JWT_SECRET env var (matches the secret set in Cloudflare Workers)
 *
 * Output:
 *   - Device + provision token inserted into production D1
 *   - config.json printed to stdout and saved to scripts/output/sn-001.config.json
 */

import { execSync }  from 'child_process';
import { createHmac } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────────
const serial = process.argv[2];
if (!serial) {
  console.error('Usage: DEVICE_JWT_SECRET=<secret> node scripts/manufacture-hub.mjs <serial>');
  console.error('Example: DEVICE_JWT_SECRET=abc123 node scripts/manufacture-hub.mjs sn-001');
  process.exit(1);
}

const JWT_SECRET = process.env.DEVICE_JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Error: DEVICE_JWT_SECRET environment variable is required.');
  console.error('Find it with: wrangler secret list --config apps/api/wrangler.jsonc');
  console.error('Then: DEVICE_JWT_SECRET=<value> node scripts/manufacture-hub.mjs sn-001');
  process.exit(1);
}

// ── IDs ───────────────────────────────────────────────────────────────────────
const deviceId      = `dev-${serial}`;
const provisionToken = `prov-${serial}-${Date.now()}`;
const expiresAt     = Math.floor(Date.now() / 1000) + (365 * 24 * 3600); // 1 year

// ── Insert into D1 ────────────────────────────────────────────────────────────
console.log(`\n🌱 Manufacturing hub: ${serial}`);
console.log(`   device_id: ${deviceId}`);

const sql = [
  `INSERT INTO devices (id, serial, name) VALUES ('${deviceId}', '${serial.toUpperCase()}', 'Sow Now Hub ${serial.toUpperCase()}');`,
  `INSERT INTO provision_tokens (token, device_id, expires_at) VALUES ('${provisionToken}', '${deviceId}', ${expiresAt});`,
].join(' ');

try {
  execSync(
    `npx wrangler d1 execute vernal-db --remote --config apps/api/wrangler.jsonc --command "${sql}"`,
    { stdio: 'inherit', cwd: join(__dirname, '..') },
  );
} catch {
  console.error('\n✗ Failed to insert into D1. Is wrangler logged in?');
  process.exit(1);
}

// ── Issue device JWT (HS256, matches auth.ts) ─────────────────────────────────
function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const header  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = base64url(JSON.stringify({
  sub: deviceId,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (90 * 24 * 3600), // 90 days
  aud: 'sow-now-device',
}));

const sig = createHmac('sha256', JWT_SECRET)
  .update(`${header}.${payload}`)
  .digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const deviceJwt = `${header}.${payload}.${sig}`;

// ── Write config.json ─────────────────────────────────────────────────────────
const config = {
  device_id:         deviceId,
  device_jwt:        deviceJwt,
  ingest_url:        'https://api.sow-now.uk/api/v1/ingest',
  db_path:           '/var/lib/sow-now/readings.db',
  upload_interval_s: 300,
  rtl433_cmd:        '/usr/local/bin/rtl_433',
  ws_frequency_hz:   868000000,
};

const outDir = join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${serial}.config.json`);
writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n');

console.log('\n✅ Done.\n');
console.log('── config.json ──────────────────────────────────────────');
console.log(JSON.stringify(config, null, 2));
console.log('─────────────────────────────────────────────────────────');
console.log(`\nSaved to: scripts/output/${serial}.config.json`);
console.log(`\nCopy to the Pi with:`);
console.log(`  scp scripts/output/${serial}.config.json pi@${serial}.local:/tmp/config.json`);
console.log(`  ssh pi@${serial}.local "sudo mv /tmp/config.json /etc/sow-now/config.json && sudo chown sownow:sownow /etc/sow-now/config.json && sudo chmod 600 /etc/sow-now/config.json"`);
