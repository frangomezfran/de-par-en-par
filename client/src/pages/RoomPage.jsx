import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import Sky from '../components/Sky.jsx'
import useWeather from '../lib/useWeather.js'
import useSession, { logout } from '../lib/session.js'
import { currentFestivity } from '../lib/specialDates.js'
import { ROOM_PLACE } from '../lib/place.js'
import mariana from '../rooms/mariana.json'
import franco from '../rooms/franco.json'

const ROOMS = {
  mariana: { name: 'Mariana', scene: mariana },
  franco: { name: 'Franco', scene: franco },
}

/** Objeto clickeable de la escena -> adónde lleva (la lámpara es interruptor) */
const OBJECT_CONTAINER = {
  diario: 'diario',
  fotos: 'fotos',
  espejo: 'espejo', // coincidencias entre las dos piezas
  flores: 'flores',
  cafe: 'cafe',
  juegos: 'juegos',
  moodboard: 'moodboard',
  musica: 'musica',
  libros: 'libros',
  series: 'series', // la tele con su mueble
  peliculas: 'peliculas', // la pila de VHS
  actividades: 'actividades',
}

const NAMES = {
  diario: 'el cuaderno',
  fotos: 'la cámara de fotos',
  espejo: 'el espejo de mano',
  flores: 'el florero',
  cafe: 'la taza de café',
  juegos: 'la computadora',
  moodboard: 'el corcho',
  musica: 'el reproductor de música',
  libros: 'la biblioteca',
  series: 'el televisor',
  peliculas: 'la pila de VHS',
  actividades: 'la mochila con la raqueta',
}

const pctOf = (v, total) => `${(v / total) * 100}%`

export default function RoomPage() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const session = useSession()
  const room = ROOMS[roomId]
  const { weather } = useWeather({ lat: ROOM_PLACE.lat, lon: ROOM_PLACE.lon })
  const [lampChoice, setLampChoice] = useState(null) // null = automático (de noche prendida)
  const [hover, setHover] = useState(null)
  const [intro, setIntro] = useState(true)
  const viewport = useRef(null)
  const festivity = currentFestivity()

  useEffect(() => {
    if (room) document.title = `La pieza de ${room.name} · Amelia`
  }, [room])

  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 3800)
    return () => clearTimeout(t)
  }, [])

  // En pantallas verticales la pieza se recorre de costado: arrancamos centrados
  useLayoutEffect(() => {
    const el = viewport.current
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [roomId])

  if (!room) return <Navigate to="/" replace />

  const { scene } = room
  const W = scene.width
  const H = scene.height
  const box = ({ x, y, w, h }) => ({ left: pctOf(x, W), top: pctOf(y, H), width: pctOf(w, W), height: pctOf(h, H) })
  const rect = ([x, y, w, h]) => ({ x, y, w, h })

  const isNight = weather ? !weather.isDay : false
  const lampOn = lampChoice ?? isNight
  const lamp = scene.objects.lampara
  const [bulbX, bulbY] = lamp.bulb

  const frame = rect(scene.window.frame)
  const objects = Object.entries(scene.objects).filter(([key]) => OBJECT_CONTAINER[key])

  // La ventana filtra por el clima y la hora del momento en que se tocó
  // (o por la festividad, si hoy hay una)
  const windowHref = () => {
    const params = new URLSearchParams()
    if (festivity) params.set('date', festivity)
    else if (weather) {
      params.set('weather', weather.condition)
      params.set('daytime', weather.isDay ? 'diurno' : 'nocturno')
    }
    const qs = params.toString()
    return `/room/${roomId}/ventana${qs ? `?${qs}` : ''}`
  }

  const go = (e, href) => {
    e.preventDefault()
    navigate(href)
  }

  const hoverProps = (id) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover((cur) => (cur === id ? null : cur)),
    onFocus: () => setHover(id),
    onBlur: () => setHover((cur) => (cur === id ? null : cur)),
  })

  const stageClass = ['scene__stage', isNight && 'is-night', lampOn && 'is-lit', intro && 'is-intro', hover === 'ventana' && 'is-window-hover']
    .filter(Boolean)
    .join(' ')

  return (
    <main className="scene" data-room={roomId}>
      <h1 className="sr-only">La pieza de {room.name}</h1>

      <nav className="scene__chrome" aria-label="Navegación">
        <Link to="/" className="typed-label">
          ← al pasillo
        </Link>
        {session && (
          <button
            type="button"
            className="typed-label scene__who"
            onClick={() => {
              logout()
              navigate('/')
            }}
            title="Cerrar la sesión"
          >
            {session.name} · salir
          </button>
        )}
      </nav>

      <div className="scene__viewport" ref={viewport}>
        <div className={stageClass} style={{ '--lx': pctOf(bulbX, W), '--ly': pctOf(bulbY, H) }}>
          <img
            className="scene__base"
            src={scene.image}
            srcSet={`${scene.imageSmall} 1600w, ${scene.image} ${W}w`}
            sizes="(max-aspect-ratio: 1/1) 180vh, 100vw"
            alt=""
            draggable="false"
          />

          {/* Los dos vidrios: detrás se ve el cielo real (o la festividad) */}
          {scene.window.panes.map((p, i) => {
            const pane = rect(p)
            return (
              <span key={i} className="scene__pane" style={box(pane)} aria-hidden="true">
                <span
                  className="scene__sky"
                  style={{
                    left: pctOf(frame.x - pane.x, pane.w),
                    top: pctOf(frame.y - pane.y, pane.h),
                    width: pctOf(frame.w, pane.w),
                    height: pctOf(frame.h, pane.h),
                  }}
                >
                  <Sky condition={weather?.condition} isDay={weather ? weather.isDay : true} festivity={festivity} />
                </span>
              </span>
            )
          })}

          {objects.map(([key, o], i) => (
            <img
              key={key}
              className={`scene__obj${hover === key ? ' is-hover' : ''}`}
              style={{ ...box(o), '--i': i }}
              src={o.file}
              alt=""
              draggable="false"
              aria-hidden="true"
            />
          ))}
          <img
            className={`scene__obj scene__obj--lamp${hover === 'lampara' ? ' is-hover' : ''}`}
            style={box(lamp)}
            src={lamp.file}
            alt=""
            draggable="false"
            aria-hidden="true"
          />

          <span className="scene__night" aria-hidden="true" />
          <span className="scene__glow" aria-hidden="true" />

          {/* Zonas de clic con la silueta exacta de cada objeto (sin carteles) */}
          <svg className="scene__hits" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <a
              href={windowHref()}
              aria-label="Mirar por la ventana"
              onClick={(e) => go(e, windowHref())}
              {...hoverProps('ventana')}
            >
              <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} />
            </a>
            {objects.map(([key, o]) => (
              <a
                key={key}
                href={`/room/${roomId}/${OBJECT_CONTAINER[key]}`}
                aria-label={`Abrir ${NAMES[key]}`}
                onClick={(e) => go(e, `/room/${roomId}/${OBJECT_CONTAINER[key]}`)}
                {...hoverProps(key)}
              >
                {o.polys.map((poly, j) => (
                  <polygon key={j} points={poly.map((pt) => pt.join(',')).join(' ')} />
                ))}
              </a>
            ))}
            <a
              href="#"
              role="button"
              aria-pressed={lampOn}
              aria-label={lampOn ? 'Apagar la lámpara' : 'Prender la lámpara'}
              onClick={(e) => {
                e.preventDefault()
                setLampChoice(!lampOn)
              }}
              onKeyDown={(e) => {
                if (e.key === ' ') {
                  e.preventDefault()
                  setLampChoice(!lampOn)
                }
              }}
              {...hoverProps('lampara')}
            >
              {lamp.polys.map((poly, j) => (
                <polygon key={j} points={poly.map((pt) => pt.join(',')).join(' ')} />
              ))}
            </a>
          </svg>
        </div>
      </div>
    </main>
  )
}
