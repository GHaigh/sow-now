/**
 * /api/v1/crops — CRUD for user's crop planting plan
 *
 * GET    /api/v1/crops          — list all crops
 * POST   /api/v1/crops          — add a crop
 * PATCH  /api/v1/crops/:id      — update crop status / notes
 * DELETE /api/v1/crops/:id      — remove a crop
 *
 * Requires: grower tier or above.
 * Bed limit: grower ≤ 8 active beds; smallholder unlimited.
 */

import { jsonResponse, errorResponse } from '../lib/http';
import { requireTier } from '../lib/tier';
import { getUserIdFromSession } from './auth';
import type { Env } from '../types/env';

const GROWER_BED_LIMIT = 8;

export async function handleCrops(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const tierError = await requireTier(userId, 'grower', env, request);
  if (tierError) return tierError;

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const cropId = pathParts.length === 4 ? pathParts[3] : null;

  if (request.method === 'GET' && !cropId) {
    return getCrops(userId, env, request);
  }
  if (request.method === 'POST' && !cropId) {
    return addCrop(userId, request, env);
  }
  if (request.method === 'PATCH' && cropId) {
    return updateCrop(userId, cropId, request, env);
  }
  if (request.method === 'DELETE' && cropId) {
    return deleteCrop(userId, cropId, env, request);
  }

  return errorResponse(405, 'Method not allowed');
}

async function getCrops(userId: string, env: Env, request: Request): Promise<Response> {
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.crop_key, c.variety, c.bed_name, c.zone, c.status,
           c.gdd_accumulated, c.gdd_base_temp_c, c.sown_at, c.notes,
           cr.display_name, cr.gdd_to_harvest_min, cr.gdd_to_harvest_max
    FROM crops c
    LEFT JOIN crops_reference cr ON c.crop_key = cr.crop_key
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC
  `).bind(userId).all<Record<string, unknown>>();

  return jsonResponse(results, 200, request);
}

async function addCrop(userId: string, request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  if (!body['crop_key'] || typeof body['crop_key'] !== 'string') {
    return errorResponse(400, 'crop_key required');
  }

  // Enforce bed limit for grower tier
  const user = await env.DB.prepare(
    'SELECT tier, tier_expires_at FROM users WHERE id = ?',
  ).bind(userId).first<{ tier: string; tier_expires_at: number | null }>();

  const now = Math.floor(Date.now() / 1000);
  const effectiveTier = (user && user.tier !== 'seed' && user.tier_expires_at && user.tier_expires_at < now)
    ? 'seed'
    : (user?.tier ?? 'seed');

  if (effectiveTier === 'grower') {
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM crops WHERE user_id = ? AND status != 'harvested'",
    ).bind(userId).first<{ n: number }>();
    if ((countRow?.n ?? 0) >= GROWER_BED_LIMIT) {
      return jsonResponse(
        {
          error: 'bed_limit_reached',
          limit: GROWER_BED_LIMIT,
          message: `Grower plan supports up to ${GROWER_BED_LIMIT} active beds. Upgrade to Smallholder for unlimited beds.`,
          upgrade_url: 'https://sow-now.uk/#pricing',
        },
        403,
        request,
      );
    }
  }

  // Validate crop_key exists in reference table
  const ref = await env.DB.prepare(
    'SELECT crop_key, base_temp_c FROM crops_reference WHERE crop_key = ?',
  ).bind(body['crop_key']).first<{ crop_key: string; base_temp_c: number }>();

  if (!ref) return errorResponse(400, 'Unknown crop_key');

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  const zone = (body['zone'] as string | null) ?? 'outdoor';
  const validZones = ['outdoor', 'greenhouse', 'indoor'];
  if (!validZones.includes(zone)) return errorResponse(400, 'Invalid zone');

  await env.DB.prepare(`
    INSERT INTO crops (id, user_id, crop_key, variety, variety_id, bed_name, zone, status, gdd_base_temp_c, sown_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId,
    body['crop_key'] as string,
    (body['variety'] as string | null) ?? null,
    (body['variety_id'] as string | null) ?? null,
    (body['bed_name'] as string | null) ?? null,
    zone,
    (body['status'] as string) ?? 'planned',
    ref.base_temp_c,
    (body['sown_at'] as number | null) ?? null,
    (body['notes'] as string | null) ?? null,
  ).run();

  return jsonResponse({ ok: true, id }, 201, request);
}

async function updateCrop(
  userId: string,
  cropId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const allowed = ['status', 'notes', 'bed_name', 'zone', 'variety', 'sown_at', 'germinated_at', 'transplanted_at', 'harvested_at'] as const;
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`);
      values.push(body[key] ?? null);
    }
  }

  if (updates.length === 0) return errorResponse(400, 'No valid fields to update');

  values.push(userId, cropId);
  await env.DB.prepare(
    `UPDATE crops SET ${updates.join(', ')} WHERE user_id = ? AND id = ?`,
  ).bind(...values).run();

  return jsonResponse({ ok: true }, 200, request);
}

async function deleteCrop(userId: string, cropId: string, env: Env, request: Request): Promise<Response> {
  await env.DB.prepare('DELETE FROM crops WHERE user_id = ? AND id = ?')
    .bind(userId, cropId).run();
  return jsonResponse({ ok: true }, 200, request);
}

