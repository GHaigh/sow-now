/**
 * Device JWT authentication utilities.
 *
 * Each Vernal hub holds a unique JWT signed with DEVICE_JWT_SECRET.
 * Tokens are issued at provisioning time and rotated every 90 days.
 *
 * Uses the Web Crypto API (available in Cloudflare Workers runtime).
 */

const ALG = { name: 'HMAC', hash: 'SHA-256' };

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), ALG, false, ['sign', 'verify']);
}

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/** Issue a signed device JWT. Called once at provisioning time. */
export async function issueDeviceToken(
  deviceId: string,
  secret: string,
  ttlSeconds = 90 * 24 * 3600,
): Promise<string> {
  const header  = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    sub: deviceId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    aud: 'sow-now-device',
  })));
  const key  = await importKey(secret);
  const sig  = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64UrlEncode(sig)}`;
}

export interface DeviceTokenPayload {
  sub: string;   // deviceId
  iat: number;
  exp: number;
  aud: string;
}

/**
 * Verify a device JWT from the Authorization header.
 * Returns the payload on success, throws on invalid/expired token.
 */
export async function verifyDeviceToken(
  authHeader: string | null,
  secret: string,
): Promise<DeviceTokenPayload> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, payload, signature] = parts as [string, string, string];
  const key  = await importKey(secret);
  const valid = await crypto.subtle.verify(
    ALG,
    key,
    base64UrlDecode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!valid) throw new Error('Token signature invalid');

  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as DeviceTokenPayload;
  if (claims.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  if (claims.aud !== 'sow-now-device') throw new Error('Token audience mismatch');

  return claims;
}
