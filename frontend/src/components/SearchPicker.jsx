import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { shopLabel } from '../api.js'
import { fuzzyFilter } from '../fuzzy.js'

const MAX_RESULTS = 50

// Searchable dropdown with typo-tolerant matching. Items need an `id`;
// getText gives the searchable/displayed text, renderItem how a row looks in the list.
export default function SearchPicker({
  items,
  value,
  onChange,
  getText = (x) => x.name,
  renderItem = (x) => x.name,
  placeholder = 'Type to search…',
  emptyText = 'No match',
  autoFocus = false,
}) {
  const selected = items.find((s) => String(s.id) === String(value))
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const listId = useId()

  const results = useMemo(
    () => fuzzyFilter(items, query, getText).slice(0, MAX_RESULTS),
    [items, query, getText],
  )

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function choose(item) {
    onChange(String(item.id))
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) return setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && results[active]) {
        e.preventDefault()
        choose(results[active])
      }
    } else if (e.key === 'Escape') {
      setQuery('')
      setOpen(false)
    }
  }

  return (
    <div className="picker">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        placeholder={selected ? getText(selected) : placeholder}
        className={selected && !open ? 'has-value' : undefined}
        value={open ? query : selected ? getText(selected) : ''}
        onFocus={(e) => {
          setOpen(true)
          e.target.select()
        }}
        onBlur={() => {
          setQuery('')
          setOpen(false)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="picker-list" role="listbox" id={listId} ref={listRef}>
          {results.length === 0 && <li className="picker-empty">{emptyText}</li>}
          {results.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => e.preventDefault()} // keep focus so blur doesn't close first
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
            >
              {renderItem(s)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const renderShop = (s) => (
  <>
    {s.name}
    {s.area && <span className="muted"> — {s.area}</span>}
  </>
)

// Medical shop search box (New Entry rows).
export function ShopPicker({ shops, ...props }) {
  return (
    <SearchPicker
      items={shops}
      getText={shopLabel}
      renderItem={renderShop}
      placeholder="Type to search medical shop…"
      emptyText="No matching shop"
      {...props}
    />
  )
}
