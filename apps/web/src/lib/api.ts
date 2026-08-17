export const API_BASE = 'https://api.sow-now.uk';
// VAPID public key — matches VAPID_PUBLIC_KEY secret set on the Worker.
// Re-generate with: node scripts/gen-vapid.mjs
export const VAPID_PUBLIC_KEY = 'BK7rMJB0nnAtHm_w_oarwocEntTr5Vgh9V7v68kUBw88jDWYfM623H_6LERQgJl6_vUNsmQoIYiBnKTf-Yl-DMw';
const API = API_BASE;

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('session_token');
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function apiStream(path: string, onMessage: (data: unknown) => void): () => void {
  const token = localStorage.getItem('session_token');
  const url = `${API}${path}`;
  const sse = new EventSource(token ? `${url}?token=${token}` : url);
  sse.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data as string)); } catch { /* ignore */ }
  };
  return () => sse.close();
}

export async function startSensorClaim(sensorType: string): Promise<string> {
  const data = await apiFetch<{ claim_id: string }>(
    '/api/v1/sensors/claim/start',
    { method: 'POST', body: JSON.stringify({ sensor_type: sensorType }) },
  );
  return data.claim_id;
}

export async function pollSensorClaim(claimId: string): Promise<{
  status: 'waiting' | 'claimed' | 'timeout';
  sensor?: { id: string; sensor_type: string; name: string; rf_id: string | null };
}> {
  return apiFetch(`/api/v1/sensors/claim/${claimId}`);
}

// ── Scan-for-existing candidates ─────────────────────────────────────────────

export interface ScanCandidate {
  rf_id: string;
  sensor_type: 'weather_station' | 'soil' | 'greenhouse' | 'indoor';
  last_seen_at: number | null;
  battery_pct: number | null;
  // WS69
  temp_c?: number | null;
  humidity_pct?: number | null;
  wind_avg_ms?: number | null;
  wind_dir_deg?: number | null;
  rain_mm?: number | null;
  // WH51
  last4?: string;
  soil_moisture_pct?: number | null;
  soil_temp_c?: number | null;
}

export async function fetchScanCandidates(): Promise<ScanCandidate[]> {
  const data = await apiFetch<{ candidates: ScanCandidate[] }>(
    '/api/v1/sensors/claim/candidates',
  );
  return data.candidates;
}

export async function renameSensor(id: string, name: string): Promise<void> {
  await apiFetch(`/api/v1/sensors/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function confirmClaim(rfId: string, name?: string): Promise<{
  id: string; sensor_type: string; name: string; rf_id: string | null;
}> {
  const data = await apiFetch<{ sensor: { id: string; sensor_type: string; name: string; rf_id: string | null } }>(
    '/api/v1/sensors/claim/confirm',
    { method: 'POST', body: JSON.stringify({ rf_id: rfId, name }) },
  );
  return data.sensor;
}

// ── Varieties + planting predictions ─────────────────────────────────────────

export interface Variety {
  id:                   string;
  crop_key:             string;
  name:                 string;
  supplier:             string | null;
  gdd_to_harvest_min:   number;
  gdd_to_harvest_max:   number;
  base_temp_c:          number;
  days_to_harvest_min:  number | null;
  days_to_harvest_max:  number | null;
  start_indoors_weeks:  number | null;
  sow_method:           'indoor' | 'direct' | 'either';
  determinate:          number | null;
  description:          string | null;
  verified:             number;
}

export interface PlantingPlan {
  variety_name:         string;
  crop_key:             string;
  sow_date:             string | null;
  sow_location:         'indoor' | 'direct';
  move_to_greenhouse:   string | null;
  plant_out_date:       string | null;
  harvest_date_min:     string | null;
  harvest_date_max:     string | null;
  viable:               boolean;
  viability_note:       string | null;
  gdd_needed:           number;
  season_gdd_available: number;
}

export async function searchVarieties(cropKey: string, q = ''): Promise<Variety[]> {
  const params = new URLSearchParams({ crop_key: cropKey });
  if (q.length >= 2) params.set('q', q);
  const data = await apiFetch<{ varieties: Variety[] }>(`/api/v1/varieties?${params}`);
  return data.varieties;
}

export async function predictVariety(varietyId: string): Promise<{
  plan: PlantingPlan;
  variety: Variety;
  climate_zone: string;
}> {
  return apiFetch(`/api/v1/varieties/${varietyId}/predict`);
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  await apiFetch('/api/v1/me/push-subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

export async function unsubscribePush(): Promise<void> {
  await apiFetch('/api/v1/me/push-subscribe', { method: 'DELETE' });
}

export async function submitCommunityVariety(payload: {
  crop_key: string;
  name: string;
  gdd_to_harvest_min: number;
  gdd_to_harvest_max: number;
  supplier?: string;
  description?: string;
}): Promise<{ ok: boolean; id: string }> {
  return apiFetch('/api/v1/varieties', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
