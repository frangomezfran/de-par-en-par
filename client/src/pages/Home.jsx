import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import LoginDialog from '../components/LoginDialog.jsx'
import useSession from '../lib/session.js'
import { pageTitle } from '../lib/labels.js'
import lobby from '../rooms/lobby.json'

const OWNERS = { mariana: 'Mariana', franco: 'Franco' }
const OPEN_MS = 820
const pct = (v, total) => `${(v / total) * 100}%`

/** Caja de la puerta completa (hoja + marco) para el área de clic */
function doorBox(leaf) {
  const padX = leaf.w * 0.1
  const padY = leaf.h * 0.045
  return {
    left: pct(leaf.x - padX, lobby.width),
    top: pct(leaf.y - padY, lobby.height),
    width: pct(leaf.w + padX * 2, lobby.width),
    height: pct(leaf.h + padY, lobby.height),
  }
}

/** La hoja dentro de esa caja, en % de la caja */
function leafInBox(leaf) {
  const padX = leaf.w * 0.1
  const padY = leaf.h * 0.045
  return {
    left: pct(padX, leaf.w + padX * 2),
    top: pct(padY, leaf.h + padY),
    width: pct(leaf.w, leaf.w + padX * 2),
    height: pct(leaf.h, leaf.h + padY),
  }
}

/**
 * Pasillo: pared celeste, piso de madera y las dos puertas de siempre.
 * Al tocar una puerta, su dueño pide la contraseña (una sola vez por pestaña).
 */
export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const [opening, setOpening] = useState(null)
  const [asking, setAsking] = useState(OWNERS[location.state?.ask] ? location.state.ask : null)
  const next = useRef(location.state?.next ?? null)
  const timer = useRef(null)

  useEffect(() => {
    document.title = pageTitle()
    return () => clearTimeout(timer.current)
  }, [])

  const open = useCallback(
    (id) => {
      const target = next.current?.startsWith(`/room/${id}`) ? next.current : `/room/${id}`
      next.current = null
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        navigate(target)
        return
      }
      setOpening(id)
      timer.current = setTimeout(() => navigate(target), OPEN_MS)
    },
    [navigate],
  )

  const knock = (event, id) => {
    event.preventDefault()
    if (opening) return
    if (session) open(id)
    else setAsking(id)
  }

  return (
    <main className={`lobby${opening ? ' is-leaving' : ''}`}>
      <h1 className="sr-only">Deparenpar</h1>
      <div className="lobby__stage">
        <img
          className="lobby__bg"
          src={lobby.image}
          srcSet={`${lobby.imageSmall} 1600w, ${lobby.image} ${lobby.width}w`}
          sizes="(max-aspect-ratio: 1/1) 230vh, 100vw"
          alt=""
          draggable="false"
        />
        {Object.entries(OWNERS).map(([id, name]) => {
          const leaf = lobby.leaves[id]
          return (
            <a
              key={id}
              href={`/room/${id}`}
              className={`door${opening === id ? ' is-open' : ''}`}
              style={doorBox(leaf)}
              aria-label={`Entrar a la pieza de ${name}`}
              onClick={(e) => knock(e, id)}
            >
              <span className="door__hole" style={leafInBox(leaf)}>
                <span className="door__light" aria-hidden="true" />
                <img className="door__leaf" src={leaf.file} alt="" draggable="false" />
              </span>
            </a>
          )
        })}
      </div>
      <div className="lobby__flash" aria-hidden="true" />

      {asking && (
        <LoginDialog
          ownerName={OWNERS[asking]}
          onClose={() => setAsking(null)}
          onSuccess={() => {
            const id = asking
            setAsking(null)
            open(id)
          }}
        />
      )}
    </main>
  )
}
