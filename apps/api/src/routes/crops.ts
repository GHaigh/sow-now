import { getUserIdFromSession } from './auth';
/**
 * /api/v1/crops — CRUD for user's crop planting plan
 *
 * GET    /api/v1/crops          — list all crops
 * POST   /api/v1/crops          — add a crop
 * PATCH  /api/v1/crops/:id      — update crop status / notes
 * DELETE /api/v1/crops/:id      — remove a crop
 */

import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

export async function handleCrops(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

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
    SELECT c.id, c.crop_key, c.variety, c.bed_name, c.status,
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

  // Validate crop_key exists in reference table
  const ref = await env.DB.prepare(
    'SELECT crop_key, base_temp_c FROM crops_reference WHERE crop_key = ?',
  ).bind(body['crop_key']).first<{ crop_key: string; base_temp_c: number }>();

  if (!ref) return errorResponse(400, 'Unknown crop_key');

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  await env.DB.prepare(`
    INSERT INTO crops (id, user_id, crop_key, variety, bed_name, status, gdd_base_temp_c, sown_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId,
    body['crop_key'] as string,
    (body['variety'] as string | null) ?? null,
    (body['bed_name'] as string | null) ?? null,
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
  const allowed = ['status', 'notes', 'bed_name', 'variety', 'sown_at', 'germinated_at', 'transplanted_at', 'harvested_at'] as const;
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

async function getUserIdFromSession(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return env.SESSIONS.get(`session:${token}`);
}
