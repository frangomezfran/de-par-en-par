import { Link, useNavigate } from 'react-router-dom'
import useSession, { logout } from '../lib/session.js'
import { ROOM_NAMES, canAdd } from './containerMeta.js'

/**
 * "Favoritos de …": la estructura sobria del archivo, con los colores de cada pieza.
 * A los contenedores se entra solo desde la pieza; acá no hay atajos entre ellos.
 *
 * @param {{ roomId: string, title?: string, aside?: React.ReactNode, onAdd?: () => void, children: React.ReactNode }} props
 */
export default function ArchiveLayout({ roomId, title, aside, onAdd, children }) {
  const session = useSession()
  const navigate = useNavigate()
  const name = ROOM_NAMES[roomId]

  return (
    <div className="archive" data-room={roomId}>
      <header className="archive__head">
        <Link to={`/room/${roomId}`} className="archive__title">
          Favoritos de {name}
        </Link>
      </header>

      <div className="archive__body">
        <aside className="archive__aside">
          <nav className="archive__nav" aria-label="Navegación">
            <ul>
              <li>
                <Link to={`/room/${roomId}`}>← La pieza</Link>
              </li>
              {title && (
                <li>
                  <span className="is-current" aria-current="page">
                    {title}
                  </span>
                </li>
              )}
            </ul>
            {onAdd && canAdd(session, roomId) && (
              <button type="button" className="archive__add" onClick={onAdd}>
                + Agregar
              </button>
            )}
          </nav>

          {aside}

          {session && (
            <p className="archive__session">
              Entraste como {session.name}.{' '}
              <button
                type="button"
                className="archive__link-btn"
                onClick={() => {
                  logout()
                  navigate('/')
                }}
              >
                Salir
              </button>
            </p>
          )}
        </aside>

        <div className="archive__main">{children}</div>
      </div>
    </div>
  )
}
