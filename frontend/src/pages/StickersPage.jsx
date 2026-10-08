import { useEffect, useState } from 'react'
import { api, formatDateTime } from '../api.js'
import NumberStepper from '../components/NumberStepper.jsx'
import { ChoosePrinter, PrinterStatus, PrintJobs, usePrintQueue } from '../components/PrintQueue.jsx'
import { ShopPicker } from '../components/SearchPicker.jsx'
import StickerPreview, { FONTS } from '../components/StickerPreview.jsx'

const PAPERS = [
  { value: 'sticker', label: 'Same as the sticker (custom size)' },
  { value: 'A4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  { value: 'A5', label: 'A5 (148 × 210 mm)', w: 148, h: 210 },
  { value: 'A6', label: 'A6 (105 × 148 mm)', w: 105, h: 148 },
  { value: 'letter', label: 'Letter (216 × 279 mm)', w: 215.9, h: 279.4 },
]
const SETUP_FIELDS = ['width_mm', 'height_mm', 'paper', 'offset_x_mm', 'offset_y_mm', 'tray']
const sameLayout = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export default function StickersPage() {
  const queue = usePrintQueue()
  const [shops, setShops] = useState([])
  const [settings, setSettings] = useState(null)
  const [shopId, setShopId] = useState('')
  const [copies, setCopies] = useState('1')
  const [draft, setDraft] = useState(null) // layout being edited
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.listShops(), api.stickerSettings()])
      .then(([sh, st]) => {
        setShops(sh)
        setSettings(st)
        setDraft(st.default_layout)
      })
      .catch((e) => setError(e.message))
  }, [])

  const shop = shops.find((s) => String(s.id) === shopId)
  const custom = Boolean(shop?.sticker_layout)
  // The saved layout this shop prints with: its own, or the standard one.
  const savedLayout = settings && (custom ? shop.sticker_layout : settings.default_layout)
  const dirty = draft && savedLayout && !sameLayout(draft, savedLayout)
  const usingStandard = shops.filter((s) => !s.sticker_layout).length

  function confirmDiscard() {
    return !dirty || confirm('You have unsaved layout changes. Discard them?')
  }

  function pickShop(id) {
    if (String(id) === shopId || !confirmDiscard()) return
    const s = shops.find((x) => String(x.id) === String(id))
    setShopId(String(id))
    setDraft(s?.sticker_layout || settings.default_layout)
    setMessage('')
    setError('')
  }

  async function run(fn, ok) {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await fn()
      if (ok) setMessage(ok)
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveLayout() {
    if (custom) {
      await run(async () => {
        const s = await api.setShopStickerLayout(shop.id, draft)
        setShops((list) => list.map((x) => (x.id === s.id ? s : x)))
      }, `Layout for ${shop.name} saved.`)
    } else {
      await run(async () => {
        const st = await api.saveStickerSettings({ ...pick(settings, SETUP_FIELDS), default_layout: draft })
        setSettings(st)
      }, 'Standard layout saved.')
    }
  }

  async function setMode(wantCustom) {
    if (!shop || wantCustom === custom) return
    if (wantCustom) {
      // Start from the current standard layout; saved right away so it sticks.
      await run(async () => {
        const s = await api.setShopStickerLayout(shop.id, draft)
        setShops((list) => list.map((x) => (x.id === s.id ? s : x)))
      }, `${shop.name} now has its own layout. Adjust it and press Save.`)
    } else {
      if (!confirm(`Remove the own layout for ${shop.name} and use the standard layout?`)) return
      await run(async () => {
        const s = await api.setShopStickerLayout(shop.id, null)
        setShops((list) => list.map((x) => (x.id === s.id ? s : x)))
        setDraft(settings.default_layout)
      }, `${shop.name} uses the standard layout again.`)
    }
  }

  const copiesN = Math.max(1, Math.min(200, parseInt(copies, 10) || 1))
  const canPrint = shop && !dirty

  if (!settings || !draft) {
    return <section className="card">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</section>
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Glass-with-care stickers</h2>
          <PrinterStatus status={queue.status} use="stickers" />
        </div>

        <div className="sticker-layout">
          <div className="sticker-controls">
            <label className="field">
              <span>Medical shop (printed after "To,")</span>
              <ShopPicker shops={shops} value={shopId} onChange={pickShop} />
            </label>

            <div className="row print-row">
              <label className="field inline">
                <span>Copies</span>
                <NumberStepper label="copies" value={copies} min={1} max={200} onChange={setCopies} />
              </label>
              <button
                className="primary"
                disabled={!canPrint}
                onClick={() => queue.submit(() => api.printStickers(shop.id, copiesN))}
                title={dirty ? 'Save or undo your layout changes first' : undefined}
              >
                Print {copiesN} sticker{copiesN > 1 ? 's' : ''}
              </button>
              <button
                className="secondary"
                disabled={!canPrint}
                onClick={() => queue.submit(() => api.printStickerTest(shop.id))}
                title="Prints the sticker outline and the name on plain paper, to check alignment"
              >
                Alignment test
              </button>
            </div>
            {!shop && <p className="muted small">Pick a medical shop to print. You can adjust the layout first.</p>}
            {shop && dirty && <p className="notice small">Save or undo your layout changes before printing.</p>}
            <PrintJobs queue={queue} />
            {queue.status && <ChoosePrinter status={queue.status} use="stickers" onSaved={queue.refresh} />}

            <LayoutEditor
              layout={draft}
              onChange={setDraft}
              sticker={settings}
              heading={
                shop ? (
                  <div className="layout-mode">
                    <label className="checkbox">
                      <input type="radio" checked={!custom} onChange={() => setMode(false)} disabled={busy} /> Standard
                      layout
                    </label>
                    <label className="checkbox">
                      <input type="radio" checked={custom} onChange={() => setMode(true)} disabled={busy} /> Own layout
                      for {shop.name}
                    </label>
                  </div>
                ) : (
                  <p className="muted small">Editing the standard layout. Pick a shop to give it its own layout.</p>
                )
              }
              note={
                !custom &&
                `The standard layout is used by ${usingStandard} shop${usingStandard === 1 ? '' : 's'} without their own layout.`
              }
            />
            <div className="actions">
              <button className="primary" onClick={saveLayout} disabled={!dirty || busy}>
                {custom ? `Save layout for ${shop.name}` : 'Save standard layout'}
              </button>
              <button className="link" onClick={() => setDraft(savedLayout)} disabled={!dirty}>
                Undo changes
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            {message && <p className="success">{message}</p>}
          </div>

          <div className="sticker-side">
            <StickerPreview
              sticker={settings}
              layout={draft}
              onChange={setDraft}
              text={shop?.name || 'Medical shop name'}
              background={settings.background}
            />
            <p className="muted small">
              Drag the dashed box to move the name, or its corner to resize it. Only the name is printed. The sticker
              picture is just for the preview.
            </p>
          </div>
        </div>
      </section>

      <StickerSetup settings={settings} onSaved={setSettings} />
    </>
  )
}

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]))

function LayoutEditor({ layout, onChange, sticker, heading, note }) {
  const set = (k, v) => onChange({ ...layout, [k]: v })
  const num = (k, { min = 0, max, step = 0.5 } = {}) => (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      value={layout[k]}
      onChange={(e) => e.target.value !== '' && set(k, Number(e.target.value))}
    />
  )

  return (
    <fieldset className="layout-editor">
      <legend>Name position &amp; style</legend>
      {heading}
      <div className="grid-fields">
        <label className="field">
          <span>From left (mm)</span>
          {num('x_mm', { max: sticker.width_mm })}
        </label>
        <label className="field">
          <span>From top (mm)</span>
          {num('y_mm', { max: sticker.height_mm })}
        </label>
        <label className="field">
          <span>Box width (mm)</span>
          {num('width_mm', { min: 5, max: sticker.width_mm })}
        </label>
        <label className="field">
          <span>Box height (mm)</span>
          {num('height_mm', { min: 5, max: sticker.height_mm })}
        </label>
        <label className="field">
          <span>Font</span>
          <select value={layout.font_family} onChange={(e) => set('font_family', e.target.value)}>
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Text size (pt)</span>
          {num('font_size_pt', { min: 4, max: 200 })}
        </label>
      </div>
      <div className="row style-row">
        <div className="segmented" role="group" aria-label="Alignment">
          {['left', 'center', 'right'].map((a) => (
            <button
              key={a}
              type="button"
              className={layout.align === a ? 'on' : undefined}
              onClick={() => set('align', a)}
            >
              {a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}
            </button>
          ))}
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={layout.bold} onChange={(e) => set('bold', e.target.checked)} /> Bold
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={layout.shrink_to_fit} onChange={(e) => set('shrink_to_fit', e.target.checked)} />{' '}
          Shrink long names to fit
        </label>
      </div>
      {note && <p className="muted small">{note}</p>}
    </fieldset>
  )
}

function StickerSetup({ settings, onSaved }) {
  const [form, setForm] = useState(() => pick(settings, SETUP_FIELDS))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = SETUP_FIELDS.some((k) => form[k] !== settings[k])
  const paper = PAPERS.find((p) => p.value === form.paper)
  const set = (k, numeric = true) => (e) =>
    setForm({ ...form, [k]: numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })

  async function save() {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      onSaved(await api.saveStickerSettings({ ...form, default_layout: settings.default_layout }))
      setMessage('Sticker setup saved.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Where to put the sticker on a bigger sheet: matches how the printer's guides hold it.
  const place = (where) => {
    if (!paper?.w) return
    const x = Math.round(((paper.w - form.width_mm) / 2) * 10) / 10
    const y = where === 'center' ? Math.round(((paper.h - form.height_mm) / 2) * 10) / 10 : 0
    setForm({ ...form, offset_x_mm: where === 'left' ? 0 : x, offset_y_mm: y })
  }

  return (
    <section className="card">
      <details>
        <summary>
          <h2>Sticker setup</h2>
          <span className="muted small">
            Size, paper, alignment and sticker photo
            {settings.updated_by_name && ` · last changed by ${settings.updated_by_name} on ${formatDateTime(settings.updated_at)}`}
          </span>
        </summary>

        <div className="grid-fields setup-fields">
          <label className="field">
            <span>Sticker width (mm)</span>
            <input type="number" step="0.5" min="10" value={form.width_mm} onChange={set('width_mm')} />
          </label>
          <label className="field">
            <span>Sticker height (mm)</span>
            <input type="number" step="0.5" min="10" value={form.height_mm} onChange={set('height_mm')} />
          </label>
          <label className="field wide">
            <span>Paper size to tell the printer</span>
            <select value={form.paper} onChange={set('paper', false)}>
              {PAPERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value === 'sticker' ? `Same as the sticker (${form.width_mm} × ${form.height_mm} mm)` : p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{form.paper === 'sticker' ? 'Shift right (mm)' : 'Sticker from left edge (mm)'}</span>
            <input type="number" step="0.5" value={form.offset_x_mm} onChange={set('offset_x_mm')} />
          </label>
          <label className="field">
            <span>{form.paper === 'sticker' ? 'Shift down (mm)' : 'Sticker from top edge (mm)'}</span>
            <input type="number" step="0.5" value={form.offset_y_mm} onChange={set('offset_y_mm')} />
          </label>
          <label className="field">
            <span>Printer tray (optional)</span>
            <input value={form.tray} onChange={set('tray', false)} placeholder="e.g. Manual Feed" />
          </label>
        </div>
        {form.paper !== 'sticker' && (
          <div className="row place-row">
            <span className="muted small">The sticker goes in the printer:</span>
            <button className="secondary" onClick={() => place('left')}>Against the left edge</button>
            <button className="secondary" onClick={() => place('top')}>Centred, at the top</button>
            <button className="secondary" onClick={() => place('center')}>In the middle</button>
          </div>
        )}
        <p className="muted small">
          <b>How to set this up:</b> enter the sticker's size, print an <b>Alignment test</b> on plain paper and hold a
          blank sticker over the dashed outline. If the whole print is shifted, adjust the shift / position above (use a
          negative number to shift left or up). If your printer refuses the custom size, choose the paper size it's
          loaded with and say where the sticker sits on it.
        </p>
        <div className="actions">
          <button className="primary" onClick={save} disabled={!dirty || busy}>
            Save setup
          </button>
          <button className="link" onClick={() => setForm(pick(settings, SETUP_FIELDS))} disabled={!dirty}>
            Undo changes
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        <StickerPhoto settings={settings} onSaved={onSaved} />
      </details>
    </section>
  )
}

const MAX_PHOTO_PX = 1600

// Shrink a photo in the browser so it stays small in the database.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, MAX_PHOTO_PX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * k)
      canvas.height = Math.round(img.height * k)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('That file is not an image the browser can read'))
    img.src = URL.createObjectURL(file)
  })
}

function StickerPhoto({ settings, onSaved }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setBusy(true)
    try {
      onSaved(await api.saveStickerBackground(await resizeImage(file)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Remove the uploaded photo and use the built-in sticker photo?')) return
    setBusy(true)
    try {
      onSaved(await api.saveStickerBackground(''))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sticker-photo">
      <h3>Sticker photo (for the preview)</h3>
      <p className="muted small">
        The preview uses a built-in photo of the sticker. For a sharper preview, upload a flat scan of a blank sticker,
        cropped to its edges. The photo is never printed.
      </p>
      <div className="row">
        <label className="secondary file-btn">
          {busy ? 'Uploading…' : settings.background ? 'Replace photo' : 'Upload photo'}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={busy} hidden />
        </label>
        {settings.background && (
          <button className="link danger" onClick={remove} disabled={busy}>
            Remove photo (use the built-in one)
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
