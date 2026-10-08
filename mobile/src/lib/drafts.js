import AsyncStorage from '@react-native-async-storage/async-storage'
import { qty } from './format'

// One unsaved New Entry list per user, kept on the phone so it survives closing the app.
// Shape: { date, transporterId, transporterLabel, rows: [{shopId, boxes, bags, remarks}], baseVersion, updatedAt }
const key = (userId) => `bd.draft.${userId}`

export async function loadDraft(userId) {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function saveDraft(userId, draft) {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify({ ...draft, updatedAt: Date.now() }))
  } catch {
    // storage full / unavailable: the draft just won't survive closing the app
  }
}

export async function clearDraft(userId) {
  try {
    await AsyncStorage.removeItem(key(userId))
  } catch {
    // ignore
  }
}

// Rows that can be saved: a shop picked and at least 1 box or 1 carry bag.
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
