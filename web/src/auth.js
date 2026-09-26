const historyApi = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';
export const API_BASE = historyApi.replace(/\/public-history(?:\?.*)?$/, '');

export async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: 'no-store', credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
