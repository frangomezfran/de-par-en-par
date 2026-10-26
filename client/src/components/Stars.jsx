import { useId, useState } from 'react'

/** "4,5 estrellas" */
export const starsText = (v) => `${String(v).replace('.', ',')} ${v === 1 ? 'estrella' : 'estrellas'}`

/** Estrellas con medias: 4.5 -> ★★★★⯪ (la mitad se pinta con un recorte) */
export function StarRating({ value, className = '' }) {
  if (value === null || value === undefined) return null
  const v = Math.max(0, Math.min(5, Number(value)))
  return (
    <span className={`stars ${className}`} role="img" aria-label={starsText(v)} title={starsText(v)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = v >= n ? 1 : v >= n - 0.5 ? 0.5 : 0
        return (
          <span key={n} className="stars__star" aria-hidden="true">
            <span className="stars__bg">★</span>
            <span className="stars__fg" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </span>
        )
      })}
    </span>
  )
}

/**
 * Selector de 0,5 a 5 estrellas: cada estrella tiene dos mitades.
 * Accesible: es un grupo de radios (flechas del teclado para moverse).
 */
export function StarInput({ value, onChange, label = 'Calificación', allowEmpty = false }) {
  const [hover, setHover] = useState(null)
  const name = useId()
  const shown = hover ?? value ?? 0
  const steps = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

  return (
    <fieldset className="star-input" onMouseLeave={() => setHover(null)}>
      <legend>{label}</legend>
      <div className="star-input__row">
        <span className="star-input__stars">
          {steps.map((s) => (
            <label key={s} className={`star-input__half star-input__half--${s % 1 ? 'left' : 'right'}${shown >= s ? ' is-on' : ''}`} onMouseEnter={() => setHover(s)}>
              <input type="radio" name={name} value={s} checked={value === s} onChange={() => onChange(s)} />
              <span className="sr-only">{starsText(s)}</span>
            </label>
          ))}
        </span>
        <span className="star-input__value" aria-hidden="true">
          {value ? starsText(value) : 'sin calificar'}
        </span>
        {allowEmpty && value ? (
          <button type="button" className="link-btn" onClick={() => onChange(null)}>
            sacar
          </button>
        ) : null}
      </div>
    </fieldset>
  )
}
