import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'

const TRANSPORTER_FIELDS = [
  { name: 'code', label: 'Transporter ID', required: true },
  { name: 'name', label: 'Name', required: true },
  { name: 'phone', label: 'Phone' },
]

const SHOP_FIELDS = [
  { name: 'name', label: 'Shop name', required: true },
  { name: 'area', label: 'Area / Town' },
  { name: 'phone', label: 'Phone' },
]

export default function ManagePage() {
  const isAdmin = useAuth().user.role === 'admin' // only admins can delete
  return (
    <div className="manage">
      <CrudSection
        title="Transporters"
        fields={TRANSPORTER_FIELDS}
        list={api.listTransporters}
        create={api.createTransporter}
        update={api.updateTransporter}
        remove={isAdmin ? api.deleteTransporter : null}
      />
      <CrudSection
        title="Medical Shops"
        fields={SHOP_FIELDS}
        list={api.listShops}
        create={api.createShop}
        update={api.updateShop}
        remove={isAdmin ? api.deleteShop : null}
      />
    </div>
  )
}

const emptyForm = (fields) => Object.fromEntries(fields.map((f) => [f.name, '']))

function CrudSection({ title, fields, list, create, update, remove }) {
  const [items, setItems] = useState([])
  const [form, setForm] = useState(() => emptyForm(fields))
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = () => list().then(setItems).catch((e) => setError(e.message))

  useEffect(() => {
    reload()
  }, [])

  function resetForm() {
    setForm(emptyForm(fields))
    setEditingId(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const missing = fields.find((f) => f.required && !form[f.name].trim())
    if (missing) return setError(`${missing.label} is required.`)
    setBusy(true)
    try {
      if (editingId) await update(editingId, form)
      else await create(form)
      resetForm()
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(item) {
    setError('')
    setEditingId(item.id)
    setForm(Object.fromEntries(fields.map((f) => [f.name, item[f.name] ?? ''])))
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}"?`)) return
    setError('')
    try {
      await remove(item.id)
      if (editingId === item.id) resetForm()
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = q
    ? items.filter((it) => fields.some((f) => String(it[f.name] ?? '').toLowerCase().includes(q)))
    : items

  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="muted">{items.length} total</span>
      </div>

      <form className="crud-form" onSubmit={handleSubmit}>
        {fields.map((f) => (
          <label key={f.name} className="field">
            <span>
              {f.label}
              {f.required && ' *'}
            </span>
            <input value={form[f.name]} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
          </label>
        ))}
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {editingId ? 'Update' : 'Add'}
          </button>
          {editingId && (
            <button type="button" className="link" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {items.length > 0 && (
        <input className="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      )}

      <table className="list">
        <thead>
          <tr>
            {fields.map((f) => (
              <th key={f.name}>{f.label}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((it) => (
            <tr key={it.id} className={editingId === it.id ? 'editing' : undefined}>
              {fields.map((f) => (
                <td key={f.name}>{it[f.name]}</td>
              ))}
              <td className="row-actions">
                <button className="link" onClick={() => startEdit(it)}>
                  Edit
                </button>
                {remove && (
                  <button className="link danger" onClick={() => handleDelete(it)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={fields.length + 1} className="muted">
                {items.length ? 'No matches.' : 'Nothing added yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
