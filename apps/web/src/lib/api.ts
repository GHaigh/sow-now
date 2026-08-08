export const API_BASE = 'https://api.sow-now.uk';
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
