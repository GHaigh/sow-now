#!/usr/bin/env node
/**
 * scripts/gen-vapid.mjs
 *
 * Generates a fresh VAPID key pair for Web Push.
 *
 * Usage:
 *   node scripts/gen-vapid.mjs
 *
 * Outputs the base64url-encoded public and private keys, then prints the
 * wrangler commands needed to set them as Worker secrets.
 *
 * After running:
 *  1. Copy the PUBLIC key into apps/web/src/lib/api.ts → VAPID_PUBLIC_KEY
 *  2. Run the wrangler secret commands shown below
 */

import { webcrypto } from 'node:crypto';

const keyPair = await webcrypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveKey'],
);

const pubRaw  = await webcrypto.subtle.exportKey('raw',   keyPair.publicKey);
const privDer = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);

const b64url = buf => Buffer.from(buf).toString('base64url');

const pub  = b64url(pubRaw);
const priv = b64url(privDer);

console.log('');
console.log('VAPID key pair generated');
console.log('═══════════════════════════════════════════════');
console.log('');
console.log('PUBLIC KEY (paste into apps/web/src/lib/api.ts → VAPID_PUBLIC_KEY):');
console.log(pub);
console.log('');
console.log('Run these commands to set the Worker secrets:');
console.log('');
console.log(`  echo '${pub}'  | npx wrangler secret put VAPID_PUBLIC_KEY  --config apps/api/wrangler.jsonc`);
console.log(`  echo '${priv}' | npx wrangler secret put VAPID_PRIVATE_KEY --config apps/api/wrangler.jsonc`);
console.log(`  echo 'mailto:hello@sow-now.uk' | npx wrangler secret put VAPID_SUBJECT --config apps/api/wrangler.jsonc`);
console.log('');
console.log('KEEP THE PRIVATE KEY SECRET — do not commit it.');
console.log('');
