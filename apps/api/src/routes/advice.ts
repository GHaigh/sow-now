/**
 * GET  /api/v1/advice/today
 *
 * Returns today's advice card for the authenticated user.
 * Falls back to the most recent available advice if today's hasn't
 * been generated yet (e.g. new user, cron not yet run).
 */

import { jsonResponse, errorResponse } from '../lib/http';
import type { Env } from '../types/env';

export async function handleAdvice(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const userId = await getUserIdFromSession(request, env);
  if (!userId) return errorResponse(401, 'Unauthorised');

  const today = new Date().toISOString().slice(0, 10);

  const advice = await env.DB.prepare(`
    SELECT id, date, summary, actions, generated_at
    FROM advice
    WHERE user_id = ?
    ORDER BY date DESC
    LIMIT 1
  `).bind(userId).first<{
    id: string;
    date: string;
    summary: string;
    actions: string;
    generated_at: number;
  }>();

  if (!advice) {
    return jsonResponse({
      date: today,
      summary: 'Setting up your growing profile…',
      actions: JSON.stringify([
        'Your first advice report will arrive tomorrow morning once your sensors have collected a full day of data.',
        'While you wait, add your crops in the Crop Planner so Vernal can tailor advice to your garden.',
      ]),
      isFirst: true,
    }, 200, request);
  }

  return jsonResponse({
    ...advice,
    actions: JSON.parse(advice.actions) as string[],
    isFresh: advice.date === today,
  }, 200, request);
}

async function getUserIdFromSession(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return env.SESSIONS.get(`session:${token}`);
}
