import { useEffect, useState } from 'react'
import { formatDateTime } from '../api.js'

// "Download Android app": the APK built on the main PC, plus the server address to type into the app.
export default function AndroidAppDialog({ onClose }) {
  const [info, setInfo] = useState(null)
  const [addresses, setAddresses] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/app/android/info').then((r) => r.json()),
      fetch('/api/server-info').then((r) => r.json()),
    ])
      .then(([i, s]) => {
        setInfo(i)
        setAddresses(s.addresses || [])
      })
      .catch(() => setError('Could not reach the server.'))
  }, [])

  // If this page was opened through a LAN address, that one certainly works from phones.
  const here = window.location.hostname
  const viaLan = here !== 'localhost' && here !== '127.0.0.1'
  const shown = viaLan ? [window.location.host, ...addresses.filter((a) => a !== window.location.host)] : addresses

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal app-dialog" role="dialog" aria-label="Android app">
        <h2>Box Dispatch for Android</h2>
        {error && <p className="error">{error}</p>}
        {info && !info.available && (
          <p className="notice">The Android app hasn't been built on this PC yet.</p>
        )}
        {info?.available && (
          <>
            <a className="primary block download-btn" href="/api/app/android" download="BoxDispatch.apk">
              Download Android app ({info.size_mb} MB)
            </a>
            <p className="muted small">
              Version {info.version || '?'}
              {info.built_at ? ` · built ${formatDateTime(info.built_at)}` : ''}
            </p>
          </>
        )}

        <h3>Server address to type in the app</h3>
        {shown.length ? (
          <ul className="addresses">
            {shown.map((a) => (
              <li key={a}>
                <code>{a}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Finding this PC's address…</p>
        )}
        {shown.length > 1 && (
          <p className="muted small">If the first one doesn't work on the phone, try the next.</p>
        )}

        <h3>How to install</h3>
        <ol className="steps">
          <li>Open this page on the phone (same Wi-Fi) and tap <b>Download</b>, or send the APK file to the phone.</li>
          <li>Open the downloaded file. If Android asks, allow <b>Install unknown apps</b> for your browser or file manager.</li>
          <li>Open <b>Box Dispatch</b>, enter the server address above, your username and password.</li>
        </ol>
        <p className="muted small">New workers can tap <b>Register</b> in the app and wait for an admin to approve them.</p>
        <div className="actions">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
