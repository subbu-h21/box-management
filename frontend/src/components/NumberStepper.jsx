// Whole-number input with − / + buttons. Empty counts as 0.
export default function NumberStepper({ value, onChange, min = 0, max = 10000, label }) {
  const n = parseInt(value, 10)
  const current = Number.isNaN(n) ? 0 : n
  const step = (delta) => onChange(String(Math.min(max, Math.max(min, current + delta))))

  return (
    <div className="stepper">
      <button type="button" onClick={() => step(-1)} disabled={current <= min} aria-label={`Decrease ${label}`} tabIndex={-1}>
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        placeholder="0"
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
      />
      <button type="button" onClick={() => step(1)} disabled={current >= max} aria-label={`Increase ${label}`} tabIndex={-1}>
        +
      </button>
    </div>
  )
}
