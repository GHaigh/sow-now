/**
 * Web Push sending via the VAPID protocol.
 *
 * No npm dependencies — uses the Web Crypto API available in Workers.
 *
 * Implements:
 *   - VAPID JWT auth header construction (RFC 8292)
 *   - Payload encryption (RFC 8188 / aes128gcm)
 *   - POST to the push endpoint
 */

import type { Env } from '../types/env';

// ── Base64url helpers ─────────────────────────────────────────────────────────

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '=='.slice((padded.length + 3) & 3));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// ── HKDF helper ───────────────────────────────────────────────────────────────

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    ikmKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ── ECDH key agreement ────────────────────────────────────────────────────────

async function ecdhSharedSecret(
  serverPrivateKey: CryptoKey,
  clientPublicKeyBytes: Uint8Array,
): Promise<Uint8Array> {
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', $public: clientKey } as SubtleCryptoDeriveKeyAlgorithm,
    serverPrivateKey,
    256,
  );
  return new Uint8Array(shared);
}

// ── Build VAPID JWT ───────────────────────────────────────────────────────────

async function buildVapidHeader(
  endpoint: string,
  vapidPrivateKeyB64: string,
  vapidPublicKeyB64: string,
  subject: string,
): Promise<string> {
  const privateKeyBytes = b64urlDecode(vapidPrivateKeyB64);

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const origin = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 3600; // 12 h

  const header  = b64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ aud: origin, exp: expiry, sub: subject })));

  const sigInput  = new TextEncoder().encode(`${header}.${payload}`);
  const sigBuffer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, sigInput);
  const jwt = `${header}.${payload}.${b64urlEncode(sigBuffer)}`;

  return `vapid t=${jwt},k=${vapidPublicKeyB64}`;
}

// ── Encrypt push payload (aes128gcm, RFC 8188) ────────────────────────────────

async function encryptPayload(
  plaintext: string,
  clientPublicKeyB64: string,
  clientAuthB64: string,
): Promise<{ ciphertext: Uint8Array; serverPublicKeyBytes: Uint8Array; salt: Uint8Array }> {
  const enc = new TextEncoder();
  const clientPublicKeyBytes = b64urlDecode(clientPublicKeyB64);
  const clientAuth           = b64urlDecode(clientAuthB64);

  // Generate an ephemeral EC key pair for this message
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  ) as CryptoKeyPair;
  const exportedPub = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
  const serverPublicKeyBytes = new Uint8Array(exportedPub as ArrayBuffer);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // ECDH shared secret
  const sharedSecret = await ecdhSharedSecret(serverKeyPair.privateKey as CryptoKey, clientPublicKeyBytes);

  // PRK via HKDF with auth as salt
  const prk = await hkdf(sharedSecret, clientAuth, enc.encode('Content-Encoding: auth\0'), 32);

  // Key info and nonce info
  const keyInfo   = new Uint8Array([...enc.encode('Content-Encoding: aes128gcm\0'), 0x41, ...clientPublicKeyBytes, ...serverPublicKeyBytes]);
  const nonceInfo = new Uint8Array([...enc.encode('Content-Encoding: nonce\0'),     0x41, ...clientPublicKeyBytes, ...serverPublicKeyBytes]);

  const contentKey   = await hkdf(prk, salt, keyInfo,   16);
  const contentNonce = await hkdf(prk, salt, nonceInfo, 12);

  const aesKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt']);

  // Padding: 1 byte delimiter (0x02 = last record), then the plaintext
  const plaintextBytes = enc.encode(plaintext);
  const recordContent  = new Uint8Array(plaintextBytes.length + 1);
  recordContent[0] = 0x02;
  recordContent.set(plaintextBytes, 1);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: contentNonce },
    aesKey,
    recordContent,
  );

  return { ciphertext: new Uint8Array(ciphertextBuffer), serverPublicKeyBytes, salt };
}

// ── Build the full encrypted HTTP/2 push message body (RFC 8188) ──────────────

function buildPushBody(
  ciphertext: Uint8Array,
  serverPublicKeyBytes: Uint8Array,
  salt: Uint8Array,
): Uint8Array {
  // Header:
  //   salt (16 bytes) | rs (4 bytes, big-endian uint32) | idlen (1 byte) | keyid (65 bytes)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKeyBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = serverPublicKeyBytes.length;
  header.set(serverPublicKeyBytes, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header, 0);
  body.set(ciphertext, header.length);
  return body;
}

// ── Public: send a push notification ─────────────────────────────────────────

export interface PushPayload {
  title: string;
  body:  string;
  url:   string;
}

/**
 * Send a Web Push notification to a single subscriber.
 * Returns true on success, false on permanent subscription failure (410).
 * Throws on transient errors so the caller can retry.
 */
export async function sendWebPush(
  endpoint:     string,
  p256dh:       string,
  auth:         string,
  payload:      PushPayload,
  env:          Env,
): Promise<boolean> {
  const vapidHeader = await buildVapidHeader(
    endpoint,
    env.VAPID_PRIVATE_KEY,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_SUBJECT,
  );

  const { ciphertext, serverPublicKeyBytes, salt } = await encryptPayload(
    JSON.stringify(payload),
    p256dh,
    auth,
  );

  const body = buildPushBody(ciphertext, serverPublicKeyBytes, salt);

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Authorization':  vapidHeader,
      'Content-Type':   'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL':            '86400',
    },
    body,
  });

  if (res.status === 410 || res.status === 404) {
    // Subscription has expired or been revoked — caller should clean it up
    return false;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Push failed ${res.status}: ${text}`);
  }

  return true;
}
