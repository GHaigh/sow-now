/**
 * /api/v1/varieties — variety search and planting predictions
 *
 * GET  /api/v1/varieties?crop_key=tomato&q=gardener
 *   Search varieties by crop and optional name query.
 *   Returns { varieties: Variety[] }
 *
 * GET  /api/v1/varieties/:id/predict
 *   Returns a full planting plan for a variety, personalised to this user's
 *   GDD history and climate zone.
 *   Returns { plan: PlantingPlan }
 *
 * POST /api/v1/varieties
 *   Submit a community variety (stored as unverified).
 *   Body: { crop_key, name, gdd_to_harvest_min, gdd_to_harvest_max, supplier?, description? }
 *   Returns { variety: Variety }
 */

import { jsonResponse, errorResponse } from '../lib/http';
import { requireTier } from '../lib/tier';
import { getUserIdFromSession } from './auth';
import { generatePlantingPlan, buildGddProfile } from '../lib/planner';
import type { Env } from '../types/env';

interface VarietyRow {
  id:                    string;
  crop_key:              string;
  name:                  string;
  supplier:              string | null;
  gdd_to_harvest_min:    number;
  gdd_to_harvest_max:    number;
  gdd_to_germinate_min:  number | null;
  gdd_to_germinate_max:  number | null;
  base_temp_c:           number;
  days_to_harvest_min:   number | null;
  days_to_harvest_max:   number | null;
  start_indoors_weeks:   number | null;
  sow_method:            'indoor' | 'direct' | 'either';
  determinate:           number | null;
  description:           string | null;
  verified:              number;
}

export async function handleVarieties(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // /api/v1/varieties/:id/predict
  const varietyId = pathParts[3] ?? null;
  const isPredict = pathParts[4] === 'predict';

  if (request.method === 'GET' && !varietyId) {
    return searchVarieties(request, env);
  }
  if (request.method === 'GET' && varietyId && isPredict) {
    const tierError = await requireTier(userId, 'grower', env, request);
    if (tierError) return tierError;
    return predictForVariety(varietyId, userId, request, env);
  }
  if (request.method === 'POST' && !varietyId) {
    return submitCommunityVariety(userId, request, env, ctx);
  }

  return errorResponse(405, 'Method not allowed');
}

// ── GET /api/v1/varieties ─────────────────────────────────────────────────────

async function searchVarieties(request: Request, env: Env): Promise<Response> {
  const url    = new URL(request.url);
  const cropKey = url.searchParams.get('crop_key');
  const query   = url.searchParams.get('q')?.trim() ?? '';

  if (!cropKey) return errorResponse(400, 'crop_key required');

  let sql: string;
  let bindings: unknown[];

  if (query.length >= 2) {
    sql = `
      SELECT id, crop_key, name, supplier, gdd_to_harvest_min, gdd_to_harvest_max,
             base_temp_c, days_to_harvest_min, days_to_harvest_max,
             start_indoors_weeks, sow_method, determinate, description, verified
      FROM varieties
      WHERE crop_key = ? AND name LIKE ?
      ORDER BY verified DESC, name ASC
      LIMIT 30
    `;
    bindings = [cropKey, `%${query}%`];
  } else {
    sql = `
      SELECT id, crop_key, name, supplier, gdd_to_harvest_min, gdd_to_harvest_max,
             base_temp_c, days_to_harvest_min, days_to_harvest_max,
             start_indoors_weeks, sow_method, determinate, description, verified
      FROM varieties
      WHERE crop_key = ?
      ORDER BY verified DESC, name ASC
      LIMIT 50
    `;
    bindings = [cropKey];
  }

  const { results } = await env.DB.prepare(sql).bind(...bindings).all<VarietyRow>();
  return jsonResponse({ varieties: results }, 200, request);
}

// ── GET /api/v1/varieties/:id/predict ────────────────────────────────────────

async function predictForVariety(
  varietyId: string,
  userId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  // Fetch variety
  const variety = await env.DB.prepare(`
    SELECT id, crop_key, name, supplier, gdd_to_harvest_min, gdd_to_harvest_max,
           gdd_to_germinate_min, gdd_to_germinate_max,
           base_temp_c, start_indoors_weeks, sow_method
    FROM varieties WHERE id = ?
  `).bind(varietyId).first<VarietyRow>();

  if (!variety) return errorResponse(404, 'Variety not found');

  // Fetch user climate zone
  const user = await env.DB.prepare(
    'SELECT climate_zone FROM users WHERE id = ?',
  ).bind(userId).first<{ climate_zone: string | null }>();

  const climateZone = user?.climate_zone ?? 'uk-midlands';

  // Fetch last 90 days of gdd_daily for this user
  const cutoff = Math.floor(Date.now() / 1000) - (90 * 86400);
  const { results: gddRows } = await env.DB.prepare(`
    SELECT date, zone, gdd FROM gdd_daily
    WHERE user_id = ? AND unixepoch(date) >= ?
    ORDER BY date ASC
  `).bind(userId, cutoff).all<{ date: string; zone: string; gdd: number }>();

  const gddProfile = buildGddProfile(gddRows, climateZone);
  const plan = generatePlantingPlan(variety, gddProfile);

  // Serialise dates to ISO strings for JSON
  const serialised = {
    ...plan,
    sow_date:           plan.sow_date?.toISOString().slice(0, 10) ?? null,
    move_to_greenhouse: plan.move_to_greenhouse?.toISOString().slice(0, 10) ?? null,
    plant_out_date:     plan.plant_out_date?.toISOString().slice(0, 10) ?? null,
    harvest_date_min:   plan.harvest_date_min?.toISOString().slice(0, 10) ?? null,
    harvest_date_max:   plan.harvest_date_max?.toISOString().slice(0, 10) ?? null,
  };

  return jsonResponse({ plan: serialised, variety, climate_zone: climateZone }, 200, request);
}

// ── POST /api/v1/varieties ────────────────────────────────────────────────────

async function submitCommunityVariety(
  userId: string,
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  const required = ['crop_key', 'name', 'gdd_to_harvest_min', 'gdd_to_harvest_max'];
  for (const field of required) {
    if (!body[field]) return errorResponse(400, `${field} required`);
  }

  // Validate crop_key
  const ref = await env.DB.prepare(
    'SELECT crop_key, base_temp_c FROM crops_reference WHERE crop_key = ?',
  ).bind(body['crop_key']).first<{ crop_key: string; base_temp_c: number }>();
  if (!ref) return errorResponse(400, 'Unknown crop_key');

  // Check not a duplicate
  const existing = await env.DB.prepare(
    'SELECT id FROM varieties WHERE crop_key = ? AND name = ?',
  ).bind(body['crop_key'], body['name']).first<{ id: string }>();
  if (existing) return errorResponse(409, 'A variety with this name already exists');

  const id = `${body['crop_key']}-${String(body['name']).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}`;

  await env.DB.prepare(`
    INSERT INTO varieties (
      id, crop_key, name, supplier,
      gdd_to_harvest_min, gdd_to_harvest_max,
      base_temp_c, sow_method, description,
      verified, submitted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    id,
    body['crop_key'] as string,
    body['name'] as string,
    (body['supplier'] as string | null) ?? null,
    Number(body['gdd_to_harvest_min']),
    Number(body['gdd_to_harvest_max']),
    ref.base_temp_c,
    (body['sow_method'] as string) ?? 'indoor',
    (body['description'] as string | null) ?? null,
    userId,
  ).run();

  return jsonResponse({ ok: true, id }, 201, request);
}
