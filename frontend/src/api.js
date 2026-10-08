export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    // Session ended (idle timeout, logged out elsewhere, account disabled…).
    window.dispatchEvent(new Event('auth:expired'))
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.detail
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg.replace(/^Value error, /, '')).join(', ')
      : detail || `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }
  return data
}

const query = (params) => {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null),
  ).toString()
  return q ? `?${q}` : ''
}

export const api = {
  authStatus: () => request('GET', '/auth/status'),
  setup: (body) => request('POST', '/auth/setup', body),
  register: (body) => request('POST', '/auth/register', body),
  login: (username, password) => request('POST', '/auth/login', { username, password, client: 'web' }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  changePassword: (current_password, new_password) =>
    request('POST', '/auth/password', { current_password, new_password }),

  listUsers: () => request('GET', '/users'),
  createUser: (u) => request('POST', '/users', u),
  updateUser: (id, u) => request('PUT', `/users/${id}`, u),
  resetPassword: (id, password) => request('POST', `/users/${id}/password`, { password }),
  approveUser: (id) => request('POST', `/users/${id}/approve`),
  rejectUser: (id) => request('POST', `/users/${id}/reject`),

  today: () => request('GET', '/today'),

  listTransporters: () => request('GET', '/transporters'),
  createTransporter: (t) => request('POST', '/transporters', t),
  updateTransporter: (id, t) => request('PUT', `/transporters/${id}`, t),
  deleteTransporter: (id) => request('DELETE', `/transporters/${id}`),

  listShops: () => request('GET', '/shops'),
  createShop: (s) => request('POST', '/shops', s),
  updateShop: (id, s) => request('PUT', `/shops/${id}`, s),
  deleteShop: (id) => request('DELETE', `/shops/${id}`),

  setShopStickerLayout: (shopId, layout) => request('PUT', `/shops/${shopId}/sticker-layout`, { layout }),

  stickerSettings: () => request('GET', '/stickers/settings'),
  saveStickerSettings: (s) => request('PUT', '/stickers/settings', s),
  saveStickerBackground: (image) => request('PUT', '/stickers/background', { image }),
  printStickers: (shopId, copies) => request('POST', '/print/stickers', { shop_id: shopId, copies }),
  printStickerTest: (shopId) => request('POST', '/print/sticker-test', { shop_id: shopId }),

  listDispatches: (params = {}) => request('GET', `/dispatches${query(params)}`),
  getTodayDispatch: (transporterId) => request('GET', `/dispatches/today/${transporterId}`),
  saveTodayDispatch: (transporterId, items, expectedVersion, autoSaved = false) =>
    request('PUT', `/dispatches/today/${transporterId}`, {
      items,
      expected_version: expectedVersion,
      auto_saved: autoSaved,
    }),
  deleteDispatch: (id) => request('DELETE', `/dispatches/${id}`),

  printDispatch: (dispatchId) => request('POST', `/print/dispatch/${dispatchId}`),
  printDaily: (date) => request('POST', '/print/daily', { date }),
  printJob: (id) => request('GET', `/print/jobs/${id}`),
  cancelPrintJob: (id) => request('POST', `/print/jobs/${id}/cancel`),
  printStatus: () => request('GET', '/print/status'),
  printTest: () => request('POST', '/print/test'),
  printJobs: (params) => request('GET', `/print/jobs${query(params)}`),
  reprintJob: (id) => request('POST', `/print/jobs/${id}/reprint`),
  // use: 'lists' (dispatch lists, test pages) or 'stickers'
  choosePrinter: (printer, use = 'lists') => request('PUT', '/print/settings', { printer, use }),

  activitySummary: (params) => request('GET', `/activity/summary${query(params)}`),
  activityLog: (params) => request('GET', `/activity/log${query(params)}`),
}

export const shopLabel = (s) => (s.area ? `${s.name} — ${s.area}` : s.name)
export const transporterLabel = (t) => `${t.code} — ${t.name}`

export function formatDate(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// "2026-10-08 13:45:00" -> "08/10/2026 13:45"
export function formatDateTime(s) {
  if (!s) return ''
  return `${formatDate(s.slice(0, 10))} ${s.slice(11, 16)}`
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
