async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.details?.map((d) => d.message).join('; ');
    throw new Error(detail || data?.error?.message || `Request failed (${res.status})`);
  }
  return data;
}

const BASE = '/api/transcriptions';

export const api = {
  config: () => request('GET', '/api/config'),
  list: ({ q = '', source = '', page = 1, pageSize = 10 } = {}) => {
    const params = new URLSearchParams({ page, pageSize });
    if (q) params.set('q', q);
    if (source) params.set('source', source);
    return request('GET', `${BASE}?${params}`);
  },
  get: (id) => request('GET', `${BASE}/${id}`),
  create: (data) => request('POST', BASE, data),
  update: (id, data) => request('PATCH', `${BASE}/${id}`, data),
  remove: (id) => request('DELETE', `${BASE}/${id}`),
};
