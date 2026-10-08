import { useLayoutEffect, useRef, useState } from 'react'
import sampleSticker from '../assets/glass-sticker.jpg'

export const FONTS = ['Arial', 'Arial Black', 'Calibri', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New']
const PT_TO_MM = 25.4 / 72
const MIN_BOX_MM = 5

const round = (v) => Math.round(v * 2) / 2 // positions snap to 0.5 mm
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * The sticker drawn to scale, with the shop name where it will print.
 * Drag the dashed box to move it; drag its corner handle to resize it.
 * Long names shrink the same way as on the printed page (0.5 pt steps, min 4 pt).
 */
export default function StickerPreview({ sticker, layout, text, onChange, background }) {
  const frameRef = useRef(null)
  const nameRef = useRef(null)
  const [scale, setScale] = useState(4) // px per mm, from the available width
  const [fittedPt, setFittedPt] = useState(layout.font_size_pt)
  const drag = useRef(null)

  useLayoutEffect(() => {
    const el = frameRef.current?.parentElement
    if (!el) return
    const update = () => setScale(Math.max(1, Math.min(el.clientWidth / sticker.width_mm, 8)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sticker.width_mm])

  // Same shrink-to-fit as the printed page.
  useLayoutEffect(() => {
    const el = nameRef.current
    if (!el) return
    let size = layout.font_size_pt
    el.style.fontSize = `${size * PT_TO_MM * scale}px`
    if (layout.shrink_to_fit) {
      while ((el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5) && size > 4) {
        size -= 0.5
        el.style.fontSize = `${size * PT_TO_MM * scale}px`
      }
    }
    setFittedPt(size)
  }, [layout, text, scale])

  function startDrag(e, mode) {
    if (!onChange) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: { ...layout } }
  }

  function onMove(e) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / scale
    const dy = (e.clientY - d.startY) / scale
    const s = d.start
    if (d.mode === 'move') {
      onChange({
        ...layout,
        x_mm: round(clamp(s.x_mm + dx, 0, sticker.width_mm - s.width_mm)),
        y_mm: round(clamp(s.y_mm + dy, 0, sticker.height_mm - s.height_mm)),
      })
    } else {
      onChange({
        ...layout,
        width_mm: round(clamp(s.width_mm + dx, MIN_BOX_MM, sticker.width_mm - s.x_mm)),
        height_mm: round(clamp(s.height_mm + dy, MIN_BOX_MM, sticker.height_mm - s.y_mm)),
      })
    }
  }

  const endDrag = () => (drag.current = null)
  const px = (mm) => `${mm * scale}px`
  const justify = { left: 'flex-start', center: 'center', right: 'flex-end' }[layout.align]

  return (
    <div className="sticker-wrap">
      <div
        ref={frameRef}
        className="sticker"
        style={{ width: px(sticker.width_mm), height: px(sticker.height_mm) }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* An uploaded photo, else the built-in photo of the Kapila Pharma sticker. */}
        <img className="sticker-bg" src={background || sampleSticker} alt="" draggable={false} />
        <div
          className={onChange ? 'name-box editable' : 'name-box'}
          style={{
            left: px(layout.x_mm),
            top: px(layout.y_mm),
            width: px(layout.width_mm),
            height: px(layout.height_mm),
          }}
          onPointerDown={(e) => startDrag(e, 'move')}
          title={onChange ? 'Drag to move' : undefined}
        >
          <div
            ref={nameRef}
            className="name-text"
            style={{
              fontFamily: `'${layout.font_family}', Arial, sans-serif`,
              fontWeight: layout.bold ? 700 : 400,
              justifyContent: justify,
              textAlign: layout.align,
            }}
          >
            {text}
          </div>
          {onChange && (
            <span className="resize-handle" onPointerDown={(e) => startDrag(e, 'resize')} title="Drag to resize" />
          )}
        </div>
      </div>
      <div className="sticker-caption muted small">
        {sticker.width_mm} × {sticker.height_mm} mm
        {layout.shrink_to_fit && fittedPt < layout.font_size_pt && ` · name shrunk to ${fittedPt} pt to fit`}
      </div>
    </div>
  )
}
