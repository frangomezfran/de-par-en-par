import { useEffect, useRef, useState } from 'react'
import { login } from '../lib/session.js'

/**
 * "El dueño te pide la contraseña": ventanita bien de los 2000 (Windows XP).
 * Al acertar, la sesión queda abierta hasta cerrar la pestaña.
 */
export default function LoginDialog({ ownerName, onClose, onSuccess }) {
  const dialog = useRef(null)
  const input = useRef(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)

  useEffect(() => {
    const d = dialog.current
    d?.showModal()
    input.current?.focus()
    return () => d?.close()
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!value.trim()) {
      input.current?.focus()
      return
    }
    setBusy(true)
    setError('')
    try {
      const who = await login(value)
      onSuccess(who)
    } catch {
      setError('La contraseña no es correcta. Probá de nuevo.')
      setShake((n) => n + 1)
      setValue('')
      setBusy(false)
      input.current?.focus()
    }
  }

  return (
    <dialog
      ref={dialog}
      className="xp"
      aria-labelledby="xp-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <form className={`xp__window${shake ? ' is-shaking' : ''}`} key={shake} onSubmit={submit}>
        <div className="xp__titlebar">
          <span className="xp__title-icon" aria-hidden="true" />
          <span id="xp-title" className="xp__title">
            La pieza de {ownerName}
          </span>
          <button type="button" className="xp__close" aria-label="Cerrar" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="xp__body">
          <div className="xp__message">
            <span className="xp__tile" aria-hidden="true">
              {ownerName[0]}
            </span>
            <p>
              <b>{ownerName}</b> te pide la contraseña para dejarte pasar a su pieza.
            </p>
          </div>

          <div className="xp__field">
            <label htmlFor="xp-pass">Contraseña:</label>
            <input
              ref={input}
              id="xp-pass"
              type="password"
              autoComplete="current-password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setError('')
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'xp-error' : undefined}
            />
            {error && (
              <span id="xp-error" className="xp__balloon" role="alert">
                <span className="xp__balloon-icon" aria-hidden="true">
                  ✕
                </span>
                {error}
              </span>
            )}
          </div>

          <p className="xp__note">La puerta queda abierta hasta que cierres esta pestaña.</p>

          <div className="xp__buttons">
            <button type="submit" className="xp__btn xp__btn--default" disabled={busy}>
              Aceptar
            </button>
            <button type="button" className="xp__btn" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </div>
      </form>
    </dialog>
  )
}
