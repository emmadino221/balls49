const historyApi = import.meta.env.VITE_HISTORY_API_URL || '/api/public-history';
export const API_BASE = historyApi.replace(/\/public-history(?:\?.*)?$/, '');

export async function apiRequest(path, options = {}) {
  const { onResponse, ...requestOptions } = options;
  const headers = { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) };
  const response = await fetch(`${API_BASE}${path}`, { ...requestOptions, headers, cache: 'no-store', credentials: 'include' });
  onResponse?.(response);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
