import { api } from './api.js'

// One unsaved entry-screen list per user, kept in this browser so it survives
// switching tabs, an idle logout, or the browser closing.
// Shape: { date, transporterId, transporterLabel, rows: [{shopId, boxes, bags, remarks}], baseVersion, updatedAt }

const key = (userId) => `bd.draft.${userId}`

export function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(key(userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveDraft(userId, draft) {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ ...draft, updatedAt: Date.now() }))
  } catch {
    // storage unavailable (private mode etc.) — the draft just won't survive a reload
  }
}

export function clearDraft(userId) {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    // ignore
  }
}

// Empty input counts as 0; anything else must be a whole number >= 0 (else NaN).
export const qty = (v) => (String(v ?? '').trim() === '' ? 0 : /^\d+$/.test(String(v).trim()) ? Number(v) : NaN)

// Rows that can actually be saved: a shop picked and at least 1 box or 1 carry bag.
export function savableItems(rows) {
  const seen = new Set()
  const items = []
  for (const r of rows) {
    const boxes = qty(r.boxes)
    const bags = qty(r.bags)
    if (!r.shopId || seen.has(r.shopId) || Number.isNaN(boxes) || Number.isNaN(bags) || boxes + bags === 0) continue
    seen.add(r.shopId)
    items.push({ shop_id: Number(r.shopId), boxes, carry_bags: bags, remarks: (r.remarks || '').trim() })
  }
  return items
}

/**
 * Save the user's stored draft (used right before an idle logout).
 * Returns one of: 'none' | 'saved' | 'nothing-to-save' | 'stale' | 'conflict' | 'failed'.
 */
export async function autoSaveDraft(userId) {
  const draft = loadDraft(userId)
  if (!draft) return 'none'
  try {
    const { date } = await api.today()
    if (draft.date !== date) {
      clearDraft(userId) // drafts are only kept for the day they were made
      return 'stale'
    }
    const items = savableItems(draft.rows)
    if (items.length === 0) return 'nothing-to-save'
    await api.saveTodayDispatch(draft.transporterId, items, draft.baseVersion, true)
    clearDraft(userId)
    return 'saved'
  } catch (e) {
    return e.status === 409 ? 'conflict' : 'failed'
  }
}
