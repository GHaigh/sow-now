/**
 * Queue consumer: advice generation
 *
 * Processes jobs enqueued by the GDD cron engine.
 * Each job: { userId, date, type: 'daily_advice' }
 *
 * For each user:
 *  1. Build structured context payload from D1 + DO state
 *  2. Retrieve relevant crop guidance from Vectorize (RAG)
 *  3. Call Workers AI to generate plain-English advice
 *  4. Store advice card in D1
 *  5. Send Web Push notification to user's device
 */

import type { Env } from '../types/env';

interface AdviceJob {
  userId: string;
  date: string;
  type: 'daily_advice';
}

export async function handleAdviceQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    const job = msg.body as AdviceJob;
    if (job.type !== 'daily_advice') {
      msg.ack();
      continue;
    }

    try {
      await generateAdvice(job.userId, job.date, env);
      msg.ack();
    } catch (err) {
      console.error(`Advice generation failed for user ${job.userId}:`, err);
      msg.retry();
    }
  }
}

async function generateAdvice(userId: string, date: string, env: Env): Promise<void> {
  // ── Fetch user's active crops ───────────────────────────────────────────
  const { results: crops } = await env.DB.prepare(`
    SELECT c.id, c.crop_key, c.variety, c.bed_name, c.status,
           c.gdd_accumulated, c.gdd_base_temp_c, c.sown_at,
           cr.display_name, cr.gdd_to_harvest_min, cr.gdd_to_harvest_max,
           cr.soil_temp_min_c, cr.moisture_min_pct, cr.moisture_max_pct,
           cr.notes AS crop_notes
    FROM crops c
    LEFT JOIN crops_reference cr ON c.crop_key = cr.crop_key
    WHERE c.user_id = ?
      AND c.status NOT IN ('harvested', 'failed')
  `).bind(userId).all<Record<string, unknown>>();

  // ── Fetch latest sensor state ───────────────────────────────────────────
  const { results: devices } = await env.DB
    .prepare('SELECT id FROM devices WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string }>();

  if (devices.length === 0) return;

  const deviceId = devices[0]!.id;
  const doId = env.DEVICE_STATE.idFromName(deviceId);
  const stub = env.DEVICE_STATE.get(doId);
  const stateRes = await stub.fetch('https://do/state');
  const deviceState = await stateRes.json<{
    latest: {
      outdoor: { temp_c: number | null; humidity_pct: number | null };
      greenhouse: { temp_c: number | null };
      soil: Record<string, { moisture_pct: number | null; temp_c: number | null }>;
    };
    gdd: { outdoor: number; greenhouse: number };
    alerts: string[];
  }>();

  // ── Fetch 7-day GDD trend ──────────────────────────────────────────────
  const { results: gddTrend } = await env.DB.prepare(`
    SELECT date, gdd, zone FROM gdd_daily
    WHERE user_id = ? AND date >= date(?, '-7 days')
    ORDER BY date DESC
  `).bind(userId, date).all<{ date: string; gdd: number; zone: string }>();

  // ── Retrieve crop knowledge via Vectorize RAG ───────────────────────────
  const cropKeys = [...new Set(crops.map(c => c['crop_key'] as string))];
  const queryText = `Growing advice for: ${cropKeys.join(', ')}. Current conditions: outdoor ${deviceState.latest.outdoor.temp_c ?? '?'}°C, alerts: ${deviceState.alerts.join(', ') || 'none'}.`;

  const embedding = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: queryText }) as { data: number[][] };
  const vectorResults = await env.CROP_INDEX.query(embedding.data[0]!, { topK: 5 });
  const cropContext = vectorResults.matches.map(m => m.metadata?.['text'] as string ?? '').filter(Boolean).join('\n\n');

  // ── Build LLM prompt ────────────────────────────────────────────────────
  const prompt = buildAdvicePrompt({
    date,
    crops,
    deviceState,
    gddTrend,
    cropContext,
  });

  // ── Call Workers AI ─────────────────────────────────────────────────────
  const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      {
        role: 'system',
        content: 'You are Vernal, a precision growing assistant for UK home growers. Give specific, actionable, numbered advice based on the growing degree day data and sensor readings provided. Be concise, warm, and practical. Never give generic advice — always refer to specific crops, temperatures, and GDD numbers from the data.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 600,
  }) as { response: string };

  // ── Parse and store advice ───────────────────────────────────────────────
  const adviceText = aiResponse.response ?? 'No advice generated.';
  const actions = parseActions(adviceText);

  await env.DB.prepare(`
    INSERT INTO advice (id, user_id, date, summary, actions, context, model)
    VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      summary = excluded.summary,
      actions = excluded.actions,
      context = excluded.context,
      generated_at = unixepoch()
  `).bind(
    userId, date,
    actions[0] ?? 'Your daily growing report is ready.',
    JSON.stringify(actions),
    JSON.stringify({ outdoor: deviceState.latest.outdoor, alerts: deviceState.alerts, gdd: deviceState.gdd }),
    '@cf/meta/llama-3.1-8b-instruct',
  ).run();
}

function buildAdvicePrompt(data: {
  date: string;
  crops: Record<string, unknown>[];
  deviceState: {
    latest: {
      outdoor: { temp_c: number | null; humidity_pct: number | null };
      greenhouse: { temp_c: number | null };
      soil: Record<string, { moisture_pct: number | null; temp_c: number | null }>;
    };
    gdd: { outdoor: number; greenhouse: number };
    alerts: string[];
  };
  gddTrend: Array<{ date: string; gdd: number; zone: string }>;
  cropContext: string;
}): string {
  const { date, crops, deviceState, gddTrend, cropContext } = data;
  const { outdoor, greenhouse, soil } = deviceState.latest;

  const soilSummary = Object.entries(soil)
    .map(([id, s]) => `  - Sensor ${id}: moisture ${s.moisture_pct ?? '?'}%, soil temp ${s.temp_c ?? '?'}°C`)
    .join('\n');

  const cropSummary = crops
    .map(c => `  - ${c['display_name'] ?? c['crop_key']} in ${c['bed_name'] ?? 'unassigned bed'}: ${c['gdd_accumulated']} GDD accumulated (target ${c['gdd_to_harvest_min']}–${c['gdd_to_harvest_max']} GDD), status: ${c['status']}`)
    .join('\n');

  const recent7DayOutdoorGdd = gddTrend
    .filter(r => r.zone === 'outdoor')
    .slice(0, 7)
    .reduce((s, r) => s + r.gdd, 0);

  return `
Date: ${date}

SENSOR READINGS:
- Outdoor temp: ${outdoor.temp_c ?? '?'}°C, humidity: ${outdoor.humidity_pct ?? '?'}%
- Greenhouse temp: ${greenhouse.temp_c ?? '?'}°C
- Soil sensors:
${soilSummary || '  - No soil sensors connected'}

GDD SUMMARY:
- Season outdoor GDD (base 10°C): ${deviceState.gdd.outdoor}
- Season greenhouse GDD (base 10°C): ${deviceState.gdd.greenhouse}
- Last 7 days outdoor GDD: ${recent7DayOutdoorGdd.toFixed(1)}

ACTIVE CROPS:
${cropSummary || '  - No active crops set up'}

ACTIVE ALERTS: ${deviceState.alerts.join(', ') || 'None'}

CROP KNOWLEDGE BASE:
${cropContext}

Please give the grower 3 specific, actionable tasks for today based on this data. Number each task. Include the reason (referencing actual GDD numbers or temperatures). Keep each task to 2 sentences maximum.
`.trim();
}

/** Extract numbered action items from LLM response text */
function parseActions(text: string): string[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const actions: string[] = [];
  for (const line of lines) {
    if (/^[1-3][\.\)]\s/.test(line)) {
      actions.push(line.replace(/^[1-3][\.\)]\s+/, ''));
    }
  }
  // Fallback: return full text as single action if parsing fails
  if (actions.length === 0) return [text.slice(0, 500)];
  return actions;
}
