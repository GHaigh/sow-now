/**
 * Tier gating — requireTier() middleware helper
 *
 * Usage in route handlers:
 *
 *   const userId = await getUserIdFromSession(request, env);
 *   if (!userId) return errorResponse(401, 'Unauthorised');
 *
 *   const tierError = await requireTier(userId, 'grower', env, request);
 *   if (tierError) return tierError;
 *
 * Tier hierarchy: seed < grower < smallholder
 */

import { jsonResponse, errorResponse } from './http';
import type { Env } from '../types/env';

const TIER_RANK: Record<string, number> = {
  seed:        0,
  grower:      1,
  smallholder: 2,
};

/**
 * Check if the user's tier meets the required minimum tier.
 * Returns null if access is allowed, or a 403 Response if not.
 */
export async function requireTier(
  userId: string,
  minTier: 'grower' | 'smallholder',
  env: Env,
  request: Request,
): Promise<Response | null> {
  const user = await env.DB
    .prepare('SELECT tier, tier_expires_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ tier: string; tier_expires_at: number | null }>();

  if (!user) return errorResponse(401, 'Unauthorised');

  const now = Math.floor(Date.now() / 1000);

  // Check if paid tier has expired
  const effectiveTier = (user.tier !== 'seed' && user.tier_expires_at && user.tier_expires_at < now)
    ? 'seed'
    : user.tier;

  const userRank = TIER_RANK[effectiveTier] ?? 0;
  const minRank  = TIER_RANK[minTier] ?? 1;

  if (userRank < minRank) {
    return jsonResponse(
      {
        error: 'subscription_required',
        required_tier: minTier,
        current_tier: effectiveTier,
        upgrade_url: 'https://sow-now.uk/#pricing',
      },
      403,
      request,
    );
  }

  return null;
}
