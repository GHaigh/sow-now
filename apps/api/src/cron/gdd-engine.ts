/**
 * Cron: GDD Engine
 * Runs daily at 05:30 UTC via wrangler.jsonc cron trigger.
 *
 * For every active user:
 *  1. Fetch yesterday's T_max / T_min from D1 (outdoor + greenhouse zones)
 *  2. Calculate daily GDD for each zone
 *  3. Write to gdd_daily table
 *  4. Update accumulated GDD on each user's active crops
 *  5. Enqueue an advice generation job per user
 */

import { calcDailyGdd, toIsoDate } from '../lib/gdd';
import type { Env } from '../types/env';

export async function runGddEngine(env: Env): Promise<void> {
  const yesterday = toIsoDate(new Date(Date.now() - 86_400_000));

  // Fetch all active users
  const { results: users } = await env.DB
    .prepare("SELECT id FROM users WHERE tier != 'deleted'")
    .all<{ id: string }>();

  for (const user of users) {
    try {
      await processUser(user.id, yesterday, env);
    } catch (err) {
      // Log but continue processing other users
      console.error(`GDD engine error for user ${user.id}:`, err);
    }
  }
}

async function processUser(userId: string, date: string, env: Env): Promise<void> {
  // ── Fetch devices for user ──────────────────────────────────────────────
  const { results: devices } = await env.DB
    .prepare('SELECT id FROM devices WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string }>();

  for (const device of devices) {
    await processDevice(userId, device.id, date, env);
  }

  // ── Enqueue advice generation job ───────────────────────────────────────
  await env.ADVICE_QUEUE.send({ userId, date, type: 'daily_advice' });
}

async function processDevice(
  userId: string,
  deviceId: string,
  date: string,
  env: Env,
): Promise<void> {
  // Outdoor GDD — from weather station readings
  const outdoorStats = await env.DB.prepare(`
    SELECT
      MAX(temp_c) AS t_max,
      MIN(temp_c) AS t_min
    FROM readings r
    JOIN sensors s ON r.sensor_id = s.id
    WHERE r.user_id = ?
      AND r.device_id = ?
      AND s.sensor_type = 'weather_station'
      AND r.recorded_at >= strftime('%s', ? || ' 00:00:00')
      AND r.recorded_at <  strftime('%s', ? || ' 23:59:59')
      AND r.temp_c IS NOT NULL
  `).bind(userId, deviceId, date, date).first<{ t_max: number | null; t_min: number | null }>();

  if (outdoorStats?.t_max != null && outdoorStats.t_min != null) {
    const gdd = calcDailyGdd(outdoorStats.t_max, outdoorStats.t_min, 10);
    await env.DB.prepare(`
      INSERT INTO gdd_daily (user_id, device_id, date, zone, base_temp_c, t_max_c, t_min_c, gdd)
      VALUES (?, ?, ?, 'outdoor', 10.0, ?, ?, ?)
      ON CONFLICT(user_id, device_id, date, zone, base_temp_c)
      DO UPDATE SET t_max_c = excluded.t_max_c, t_min_c = excluded.t_min_c, gdd = excluded.gdd
    `).bind(userId, deviceId, date, outdoorStats.t_max, outdoorStats.t_min, gdd).run();
  }

  // Greenhouse GDD — from greenhouse sensor readings
  const ghStats = await env.DB.prepare(`
    SELECT
      MAX(greenhouse_temp_c) AS t_max,
      MIN(greenhouse_temp_c) AS t_min
    FROM readings r
    JOIN sensors s ON r.sensor_id = s.id
    WHERE r.user_id = ?
      AND r.device_id = ?
      AND s.sensor_type = 'greenhouse'
      AND r.recorded_at >= strftime('%s', ? || ' 00:00:00')
      AND r.recorded_at <  strftime('%s', ? || ' 23:59:59')
      AND r.greenhouse_temp_c IS NOT NULL
  `).bind(userId, deviceId, date, date).first<{ t_max: number | null; t_min: number | null }>();

  if (ghStats?.t_max != null && ghStats.t_min != null) {
    const gdd = calcDailyGdd(ghStats.t_max, ghStats.t_min, 10);
    await env.DB.prepare(`
      INSERT INTO gdd_daily (user_id, device_id, date, zone, base_temp_c, t_max_c, t_min_c, gdd)
      VALUES (?, ?, ?, 'greenhouse', 10.0, ?, ?, ?)
      ON CONFLICT(user_id, device_id, date, zone, base_temp_c)
      DO UPDATE SET t_max_c = excluded.t_max_c, t_min_c = excluded.t_min_c, gdd = excluded.gdd
    `).bind(userId, deviceId, date, ghStats.t_max, ghStats.t_min, gdd).run();
  }

  // Indoor GDD — from indoor sensor readings (propagator / windowsill WH31 ch2+)
  const indoorStats = await env.DB.prepare(`
    SELECT
      MAX(indoor_temp_c) AS t_max,
      MIN(indoor_temp_c) AS t_min
    FROM readings r
    JOIN sensors s ON r.sensor_id = s.id
    WHERE r.user_id = ?
      AND r.device_id = ?
      AND s.sensor_type = 'indoor'
      AND r.recorded_at >= strftime('%s', ? || ' 00:00:00')
      AND r.recorded_at <  strftime('%s', ? || ' 23:59:59')
      AND r.indoor_temp_c IS NOT NULL
  `).bind(userId, deviceId, date, date).first<{ t_max: number | null; t_min: number | null }>();

  if (indoorStats?.t_max != null && indoorStats.t_min != null) {
    const gdd = calcDailyGdd(indoorStats.t_max, indoorStats.t_min, 10);
    await env.DB.prepare(`
      INSERT INTO gdd_daily (user_id, device_id, date, zone, base_temp_c, t_max_c, t_min_c, gdd)
      VALUES (?, ?, ?, 'indoor', 10.0, ?, ?, ?)
      ON CONFLICT(user_id, device_id, date, zone, base_temp_c)
      DO UPDATE SET t_max_c = excluded.t_max_c, t_min_c = excluded.t_min_c, gdd = excluded.gdd
    `).bind(userId, deviceId, date, indoorStats.t_max, indoorStats.t_min, gdd).run();
  }

  // ── Update accumulated GDD on active crops ───────────────────────────────
  // Each crop uses its own zone for GDD accumulation.
  // Defaults to 'outdoor' for crops created before zone column existed.
  const { results: crops } = await env.DB.prepare(`
    SELECT id, gdd_base_temp_c, sown_at, zone
    FROM crops
    WHERE user_id = ?
      AND status NOT IN ('harvested', 'failed', 'planned')
      AND sown_at IS NOT NULL
  `).bind(userId).all<{ id: string; gdd_base_temp_c: number; sown_at: number; zone: string }>();

  for (const crop of crops) {
    const sownDate = toIsoDate(new Date(crop.sown_at * 1000));
    const cropZone = crop.zone ?? 'outdoor';
    const { results: gddRows } = await env.DB.prepare(`
      SELECT SUM(gdd) AS total
      FROM gdd_daily
      WHERE user_id = ?
        AND device_id = ?
        AND zone = ?
        AND date >= ?
        AND base_temp_c = ?
    `).bind(userId, deviceId, cropZone, sownDate, crop.gdd_base_temp_c)
      .all<{ total: number | null }>();

    const total = gddRows[0]?.total ?? 0;
    await env.DB.prepare(
      'UPDATE crops SET gdd_accumulated = ? WHERE id = ?',
    ).bind(total, crop.id).run();
  }
}
