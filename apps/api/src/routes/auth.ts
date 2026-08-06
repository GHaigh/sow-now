/**
 * Auth routes
 *
 * POST /api/v1/auth/magic-link   — send a sign-in email
 * GET  /api/v1/auth/verify       — verify token from email link, issue session
 * POST /api/v1/auth/logout       — invalidate session
 * GET  /api/v1/me                — return current user profile
 * PATCH /api/v1/me/location      — update postcode / climate zone
 */

import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

// Session TTL: 30 days
const SESSION_TTL_S = 30 * 24 * 3600;
// Magic link token TTL: 15 minutes
const MAGIC_LINK_TTL_S = 15 * 60;

export async function handleAuth(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/v1/auth/magic-link' && request.method === 'POST') {
    return sendMagicLink(request, env, ctx);
  }
  if (path === '/api/v1/auth/verify' && request.method === 'GET') {
    return verifyMagicLink(request, env);
  }
  if (path === '/api/v1/auth/logout' && request.method === 'POST') {
    return logout(request, env);
  }
  if (path === '/api/v1/me' && request.method === 'GET') {
    return getMe(request, env);
  }
  if (path === '/api/v1/me/location' && request.method === 'PATCH') {
    return updateLocation(request, env);
  }

  return errorResponse(404, 'Not found');
}

// ── POST /api/v1/auth/magic-link ─────────────────────────────────────────────
async function sendMagicLink(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.json() as { email?: string };
  const email = body.email?.toLowerCase().trim();

  if (!email || !isValidEmail(email)) {
    return errorResponse(400, 'Valid email required');
  }

  // Upsert user
  const userId = await upsertUser(email, env);

  // Generate magic link token
  const token = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL_S;

  await env.SESSIONS.put(
    `magic:${token}`,
    JSON.stringify({ userId, email }),
    { expirationTtl: MAGIC_LINK_TTL_S },
  );

  // Send email via Cloudflare Email Workers (or log in dev)
  const magicUrl = `https://app.sow-now.uk/auth/verify?token=${token}`;

  ctx.waitUntil(sendEmail(email, magicUrl, env));

  // Always return success — don't reveal whether email exists
  return jsonResponse({ ok: true, message: 'Sign-in link sent' }, 200, request);
}

// ── GET /api/v1/auth/verify?token=xxx ────────────────────────────────────────
async function verifyMagicLink(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return errorResponse(400, 'Token required', request);

  const raw = await env.SESSIONS.get(`magic:${token}`);
  if (!raw) return errorResponse(401, 'Sign-in link has expired or already been used', request);

  const { userId } = JSON.parse(raw) as { userId: string };

  // Consume the magic link token immediately (one-time use)
  await env.SESSIONS.delete(`magic:${token}`);

  // Issue a session token
  const sessionToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await env.SESSIONS.put(
    `session:${sessionToken}`,
    userId,
    { expirationTtl: SESSION_TTL_S },
  );

  // Return session token as JSON — client handles navigation
  return jsonResponse({ ok: true, sessionToken }, 200, request);
}

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
async function logout(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    await env.SESSIONS.delete(`session:${auth.slice(7)}`);
  }
  return jsonResponse({ ok: true }, 200, request);
}

// ── GET /api/v1/me ────────────────────────────────────────────────────────────
export async function getMe(request: Request, env: Env): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const user = await env.DB.prepare(`
    SELECT id, email, tier, postcode_prefix, timezone, push_enabled
    FROM users WHERE id = ?
  `).bind(userId).first<{
    id: string; email: string; tier: string;
    postcode_prefix: string | null; timezone: string; push_enabled: number;
  }>();

  if (!user) return errorResponse(404, 'User not found');

  // Check if user has a provisioned device
  const device = await env.DB
    .prepare('SELECT id FROM devices WHERE user_id = ? AND provisioned_at IS NOT NULL LIMIT 1')
    .bind(userId)
    .first<{ id: string }>();

  return jsonResponse({
    id: user.id,
    email: user.email,
    tier: user.tier,
    postcode_prefix: user.postcode_prefix,
    timezone: user.timezone,
    push_enabled: user.push_enabled === 1,
    deviceProvisioned: device != null,
  }, 200, request);
}

// ── PATCH /api/v1/me/location ─────────────────────────────────────────────────
async function updateLocation(request: Request, env: Env): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const body = await request.json() as { postcode?: string };
  const postcode = body.postcode?.toUpperCase().trim().slice(0, 4);

  if (!postcode) return errorResponse(400, 'postcode required');

  // Derive climate zone from postcode prefix
  const zone = ukClimateZone(postcode);

  await env.DB.prepare(
    'UPDATE users SET postcode_prefix = ?, climate_zone = ? WHERE id = ?',
  ).bind(postcode, zone, userId).run();

  return jsonResponse({ ok: true, postcode, zone }, 200, request);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function upsertUser(email: string, env: Env): Promise<string> {
  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();

  if (existing) return existing.id;

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.DB.prepare(
    'INSERT INTO users (id, email) VALUES (?, ?)',
  ).bind(id, email).run();
  return id;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Very rough UK climate zone from postcode prefix */
function ukClimateZone(prefix: string): string {
  const p = prefix.slice(0, 2).toUpperCase();
  const north  = ['AB','DD','DG','EH','FK','G','IV','KA','KW','KY','ML','PA','PH','TD','TD','ZE','DL','HG','LA','LS','NE','YO','CA','TS'];
  const south  = ['BN','BR','CT','EX','GU','ME','PL','PO','RH','SO','TN','TQ','TR'];
  if (north.some(n => p.startsWith(n))) return 'uk-north';
  if (south.some(s => p.startsWith(s))) return 'uk-south';
  return 'uk-midlands';
}

async function sendEmail(email: string, magicUrl: string, env: Env): Promise<void> {
  // In development / if email not configured, log the magic link
  if (!env.ENVIRONMENT || env.ENVIRONMENT !== 'production') {
    console.log(`[DEV] Magic link for ${email}: ${magicUrl}`);
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:system-ui,sans-serif;background:#f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:40px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="font-size:36px;">🌱</div>
          <div style="font-size:22px;font-weight:800;color:#166534;letter-spacing:-0.5px;">Sow Now</div>
        </td></tr>
        <tr><td style="padding-bottom:16px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">Your sign-in link</h1>
          <p style="margin:0;font-size:15px;color:#6b7280;line-height:1.6;">
            Click the button below to sign in to your Sow Now account.
            This link expires in 15 minutes and can only be used once.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:24px 0;">
          <a href="${magicUrl}"
             style="display:inline-block;background:#166534;color:#fff;text-decoration:none;
                    font-size:16px;font-weight:700;padding:14px 36px;border-radius:8px;">
            Sign in to Sow Now
          </a>
        </td></tr>
        <tr><td style="padding-top:16px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
            If you didn't request this, you can safely ignore this email.<br>
            Link: <a href="${magicUrl}" style="color:#166534;word-break:break-all;">${magicUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const text = `Sign in to Sow Now\n\nClick this link to sign in (expires in 15 minutes):\n\n${magicUrl}\n\nIf you didn't request this, ignore this email.`;

  if (!env.RESEND_API_KEY) {
    console.error('Email send failed: RESEND_API_KEY secret not set');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Sow Now <hello@sow-now.uk>',
        to: [email],
        subject: 'Your Sow Now sign-in link',
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('Email send failed:', res.status, body);
    }
  } catch (err: any) {
    // Log server-side only — do not expose delivery errors to client
    console.error('Email send failed:', err?.message);
  }
}

export async function getUserIdFromSession(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return env.SESSIONS.get(`session:${auth.slice(7)}`);
}
