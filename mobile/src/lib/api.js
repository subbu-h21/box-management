// Talks to the Box Dispatch server running on the main PC (same API as the website).
// The phone logs in as a "mobile" client and sends its token as "Authorization: Bearer …".

const TIMEOUT_MS = 15000

let serverUrl = ''
let token = ''
let onUnauthorized = () => {}

export function setSession(url, tok) {
  serverUrl = url
  token = tok || ''
}
export const getServerUrl = () => serverUrl
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

// "192.168.1.20:8000" -> "http://192.168.1.20:8000"
export function normalizeServerUrl(input) {
  let url = String(input || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  return url.replace(/\/+$/, '')
}

async function fetchWithTimeout(url, options, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } catch (e) {
    const reason = e.name === 'AbortError' ? 'took too long to answer' : 'could not be reached'
    throw new ApiError(
      `The server at ${url.split('/api')[0]} ${reason}. Check that this phone is on the shop Wi-Fi and the main PC is on.`,
      0,
    )
  } finally {
    clearTimeout(timer)
  }
}

async function request(method, path, body, { base = serverUrl, auth = true } = {}) {
  if (!base) throw new ApiError('Enter the server address first.', 0)
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && token) headers.Authorization = `Bearer ${token}`
  const res = await fetchWithTimeout(`${base}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && auth && token) onUnauthorized()
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.detail
    const message = Array.isArray(detail)
      ? detail.map((d) => String(d.msg).replace(/^Value error, /, '')).join(', ')
      : detail || `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }
  return data
}

const query = (params) => {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return q ? `?${q}` : ''
}

export const api = {
  // Before login the server address comes from the login form.
  authStatus: (base) => request('GET', '/auth/status', undefined, { base, auth: false }),
  login: (base, username, password) =>
    request('POST', '/auth/login', { username, password, client: 'mobile' }, { base, auth: false }),
  register: (base, body) => request('POST', '/auth/register', body, { base, auth: false }),
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

  listDispatches: (params) => request('GET', `/dispatches${query(params)}`),
  getTodayDispatch: (transporterId) => request('GET', `/dispatches/today/${transporterId}`),
  saveTodayDispatch: (transporterId, items, expectedVersion, autoSaved = false) =>
    request('PUT', `/dispatches/today/${transporterId}`, {
      items,
      expected_version: expectedVersion,
      auto_saved: autoSaved,
    }),
  deleteDispatch: (id) => request('DELETE', `/dispatches/${id}`),

  stickerSettings: () => request('GET', '/stickers/settings'),
  printStickers: (shopId, copies) => request('POST', '/print/stickers', { shop_id: shopId, copies }),
  printStickerTest: (shopId) => request('POST', '/print/sticker-test', { shop_id: shopId }),

  printDispatch: (dispatchId) => request('POST', `/print/dispatch/${dispatchId}`),
  printDaily: (date) => request('POST', '/print/daily', { date }),
  printTest: () => request('POST', '/print/test'),
  printJob: (id) => request('GET', `/print/jobs/${id}`),
  printJobs: (params) => request('GET', `/print/jobs${query(params)}`),
  cancelPrintJob: (id) => request('POST', `/print/jobs/${id}/cancel`),
  reprintJob: (id) => request('POST', `/print/jobs/${id}/reprint`),
  printStatus: () => request('GET', '/print/status'),
  choosePrinter: (printer, use = 'lists') => request('PUT', '/print/settings', { printer, use }),

  activitySummary: (params) => request('GET', `/activity/summary${query(params)}`),
  activityLog: (params) => request('GET', `/activity/log${query(params)}`),
}
