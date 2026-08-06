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
