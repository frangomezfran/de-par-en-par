import { useState } from 'react'

function excerpt(text = '', max = 160) {
  if (text.length <= max) return text
  return `${text.slice(0, text.lastIndexOf(' ', max))}…`
}

/**
 * Imagen grande de un ítem en el archivo. Si no tiene portada (notas, ideas del
 * corcho) se muestra la nota misma como una ficha escrita a mano.
 */
export default function Cover({ item, className = '', eager = false, onLoad, onBroken }) {
  const [broken, setBroken] = useState(false)

  if (!item.cover || broken) {
    return (
      <span className={`notecard ${className}`} aria-hidden="true">
        <span className="notecard__title">{item.title}</span>
        <span className="notecard__text">{excerpt(item.body || item.ownerNote || '')}</span>
      </span>
    )
  }

  return (
    <img
      className={`cover ${className}`}
      src={item.cover}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable="false"
      onLoad={onLoad}
      onError={() => {
        setBroken(true)
        onBroken?.()
      }}
    />
  )
}
