export const shopLabel = (s) => (s.area ? `${s.name} — ${s.area}` : s.name)
export const transporterLabel = (t) => `${t.code} — ${t.name}`

// "2026-10-08" -> "08/10/2026"
export function formatDate(iso) {
  if (!iso) return ''
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

// Empty input counts as 0; anything else must be a whole number >= 0 (else NaN).
export const qty = (v) => (String(v ?? '').trim() === '' ? 0 : /^\d+$/.test(String(v).trim()) ? Number(v) : NaN)
