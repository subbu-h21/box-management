// Small fuzzy matcher for short names (shop name + area).
// Each word the user types must match the start of some word in the target,
// allowing a few typos (insert / delete / substitute / swap two letters).

const normalize = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

// Typos allowed for a typed word of this length.
const maxTypos = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : 2)

// Optimal string alignment distance (Levenshtein + adjacent swaps).
function editDistance(a, b) {
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

// How far typed word `q` is from the start of target word `t` (0 = exact prefix).
function wordDistance(q, t) {
  if (t.startsWith(q)) return 0
  let best = Infinity
  // Compare against prefixes of t around q's length, so partially typed words still match.
  for (let len = Math.max(1, q.length - 1); len <= Math.min(t.length, q.length + 1); len++) {
    best = Math.min(best, editDistance(q, t.slice(0, len)))
  }
  return best
}

// Returns a score (lower is better), or null if it doesn't match.
export function fuzzyScore(query, target) {
  const qWords = normalize(query)
  if (qWords.length === 0) return 0
  const tWords = normalize(target)
  const joined = tWords.join(' ')
  // Plain substring match anywhere is the best kind of match.
  if (joined.includes(qWords.join(' '))) return 0

  let total = 0
  for (const q of qWords) {
    let best = Infinity
    for (const t of tWords) best = Math.min(best, wordDistance(q, t))
    if (best > maxTypos(q.length)) return null
    total += best + 0.1 // small penalty so substring matches always rank first
  }
  return total
}

// Filter + rank items. `getText` returns the searchable text for an item.
export function fuzzyFilter(items, query, getText) {
  if (!query.trim()) return items
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, getText(item)) }))
    .filter((r) => r.score !== null)
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((r) => r.item)
}
