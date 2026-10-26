import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import ArchiveLayout from '../components/ArchiveLayout.jsx'
import Cover from '../components/Cover.jsx'
import LikeButton from '../components/LikeButton.jsx'
import Guestbook from '../components/Guestbook.jsx'
import AddItemForm from '../components/AddItemForm.jsx'
import { StarRating, starsText } from '../components/Stars.jsx'
import { CONTAINER_VIEW, OTHER_ROOM, ROOM_CONTAINERS, ROOM_NAMES, canEdit, inventoryCodes, metaLine } from '../components/containerMeta.js'
import {
  CONTAINERS,
  DAYTIME_LABELS,
  MOOD_LABELS,
  SEASON_LABELS,
  SPECIAL_DATE_LABELS,
  STAGE_LABELS,
  TAG_LABELS,
  WEATHER_LABELS,
} from '../lib/labels.js'
import { getItem, getItems } from '../lib/api.js'
import useSession from '../lib/session.js'

// 'audiovisual' es de la segunda iteración (películas + series juntas): se acepta y se redirige
const LEGACY = new Set(['audiovisual'])

const norm = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** Solo se embebe YouTube (nada de URLs arbitrarias en un iframe) */
function safeEmbed(url) {
  return /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[\w-]{11}/.test(url ?? '') ? url : null
}

/** Reproductor del mp3 con los controles del archivo: play | pause | stop y el porcentaje */
function AudioControls({ src, title }) {
  const audio = useRef(null)
  const [state, setState] = useState({ playing: false, pct: 0 })

  return (
    <p className="detail__controls">
      <audio
        ref={audio}
        src={src}
        preload="none"
        onTimeUpdate={(e) => {
          const a = e.currentTarget
          setState((s) => ({ ...s, pct: a.duration ? Math.round((a.currentTime / a.duration) * 100) : 0 }))
        }}
        onPlay={() => setState((s) => ({ ...s, playing: true }))}
        onPause={() => setState((s) => ({ ...s, playing: false }))}
        onEnded={() => setState({ playing: false, pct: 100 })}
      />
      <span className="sr-only">Audio de {title}: </span>
      <button type="button" onClick={() => audio.current?.play()}>
        play
      </button>{' '}
      |{' '}
      <button type="button" onClick={() => audio.current?.pause()} disabled={!state.playing}>
        pause
      </button>{' '}
      |{' '}
      <button
        type="button"
        onClick={() => {
          if (!audio.current) return
          audio.current.pause()
          audio.current.currentTime = 0
          setState({ playing: false, pct: 0 })
        }}
      >
        stop
      </button>
      <span className="detail__pct" aria-live="off">
        {' '}
        {state.pct}%
      </span>
    </p>
  )
}

/** Imagen principal grande + hasta 3 fotos más chicas; video aparte si hay */
function Media({ item }) {
  const video = safeEmbed(item.videoUrl)
  const [showVideo, setShowVideo] = useState(false)
  const [current, setCurrent] = useState(null) // foto extra mirada en grande

  return (
    <figure className="detail__media">
      {item.audio && <AudioControls src={item.audio} title={item.title} />}
      {video && (
        <p className="detail__controls">
          <button type="button" onClick={() => setShowVideo((v) => !v)}>
            {showVideo ? 'cerrar video' : 'ver video'}
          </button>
        </p>
      )}

      <div className="detail__frame">
        {showVideo ? (
          <iframe
            src={`${video}?autoplay=1&rel=0`}
            title={`Video de ${item.title}`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : current ? (
          <img className="cover" src={current} alt={`Otra foto de ${item.title}`} />
        ) : (
          <Cover item={item} eager />
        )}
      </div>

      {item.gallery?.length > 0 && (
        <ul className="detail__gallery" aria-label="Más fotos">
          {current && (
            <li>
              <button type="button" className="detail__thumb detail__thumb--back" onClick={() => setCurrent(null)}>
                ← principal
              </button>
            </li>
          )}
          {item.gallery.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                className={`detail__thumb${current === src ? ' is-current' : ''}`}
                onClick={() => {
                  setShowVideo(false)
                  setCurrent(src)
                }}
                aria-label={`Ver la foto ${i + 1} en grande`}
              >
                <img src={src} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

export default function ItemPage() {
  const { roomId, container, itemId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')
  const [siblings, setSiblings] = useState([])
  const [twin, setTwin] = useState(null)
  const [editing, setEditing] = useState(false)

  const valid = Boolean(ROOM_NAMES[roomId] && (CONTAINERS[container] || LEGACY.has(container)) && container !== 'ventana')
  const name = ROOM_NAMES[roomId]

  useEffect(() => {
    if (!valid) return
    let alive = true
    setItem(null)
    setError('')
    setTwin(null)
    getItem(itemId)
      .then((it) => {
        if (!alive) return
        setItem(it)
        document.title = `${it.title} · Favoritos de ${ROOM_NAMES[it.roomId]}`
        // ¿También está en la otra pieza? (comparativa)
        const keys = [norm(it.originalTitle), norm(it.title)].filter(Boolean)
        getItems({ room: OTHER_ROOM[it.roomId], container: it.container })
          .then((list) => {
            const match = list.find((o) => keys.includes(norm(o.originalTitle)) || keys.includes(norm(o.title)))
            if (alive) setTwin(match ?? null)
          })
          .catch(() => {})
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [valid, itemId])

  useEffect(() => {
    if (!item) return
    let alive = true
    getItems({ room: item.roomId, container: item.container })
      .then((list) => alive && setSiblings(list))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [item])

  const code = useMemo(() => (item ? inventoryCodes(siblings.length ? siblings : [item]).get(item.id) : ''), [item, siblings])

  if (!valid) return <Navigate to={ROOM_NAMES[roomId] ? `/room/${roomId}` : '/'} replace />
  // URL vieja: se lleva a la dirección correcta
  if (item && (item.container !== container || item.roomId !== roomId)) {
    return <Navigate to={`/room/${item.roomId}/${item.container}/${item.id}`} replace />
  }

  const current = item?.container ?? container
  const base = `/room/${roomId}/${current}`
  const back = location.state?.from ?? base
  const title = CONTAINERS[current]?.label

  if (error || !item) {
    return (
      <ArchiveLayout roomId={roomId} title={title}>
        <p className="archive__empty">
          {error ? (
            <>
              No encontré eso en los favoritos de {name}. <Link to={base}>Volver</Link>
            </>
          ) : (
            'Cargando…'
          )}
        </p>
      </ArchiveLayout>
    )
  }

  const view = CONTAINER_VIEW[item.container]
  const idx = siblings.findIndex((s) => s.id === item.id)
  const prev = idx > 0 ? siblings[idx - 1] : null
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null
  const list = (values, labels) => values.map((v) => labels[v] ?? v).join(', ')
  const isNote = item.container === 'diario'
  const author = isNote ? item.creators[0] ?? item.addedBy : item.addedBy

  // Ficha: los datos finos (columna izquierda)
  const facts = [
    ['N.º de inventario', code],
    ['Visibilidad', item.visibility === 'privado' ? 'Privado (solo Mariana y Franco)' : null],
    ['Tipo', item.tags.filter((t) => TAG_LABELS[t]).map((t) => TAG_LABELS[t]).join(', ')],
    ['Año', item.year],
    [view.creatorsLabel, !isNote && item.creators.join(', ')],
    [view.castLabel, item.cast.join(', ')],
    ['Géneros', item.genres.join(', ')],
    ['Lugar', item.place],
    ['Edad', item.audience],
    ['Clima', list(item.weather, WEATHER_LABELS)],
    ['Momento', item.daytime && DAYTIME_LABELS[item.daytime]],
    ['Estación', list(item.seasons, SEASON_LABELS)],
    ['Ánimo', list(item.moods, MOOD_LABELS)],
    ['Etapa', list(item.stages, STAGE_LABELS)],
    ['Fechas especiales', list(item.specialDates, SPECIAL_DATE_LABELS)],
    ['Calificación', item.rating ? <StarRating value={item.rating} /> : null],
    [isNote ? 'Escribió' : 'Lo agregó', author],
  ].filter(([k, v]) => k && v)

  const tagged = [
    ...item.genres.map((g) => ['genre', g, g]),
    ...item.moods.map((m) => ['mood', m, MOOD_LABELS[m]]),
    ...item.weather.map((w) => ['weather', w, WEATHER_LABELS[w]]),
    ...item.specialDates.map((d) => ['date', d, SPECIAL_DATE_LABELS[d]]),
    ...item.stages.map((s) => ['stage', s, STAGE_LABELS[s]]),
  ]

  const paragraphs = (item.body || '').split(/\n{2,}/).filter(Boolean)

  return (
    <ArchiveLayout
      roomId={roomId}
      title={title}
      aside={
        <section className="facts" aria-label="Ficha">
          <h2 className="keywords__title">Ficha</h2>
          <dl>
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}:</dt> <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      }
    >
      <p className="detail__back">
        <Link to={back}>← {title}</Link>
        {canEdit(session, item) && (
          <button type="button" className="archive__link-btn detail__edit" onClick={() => setEditing(true)}>
            Modificar
          </button>
        )}
      </p>

      <article className="detail">
        <div className="detail__text">
          <p className="detail__code">{code}</p>
          <h1 className="detail__title">{item.title}</h1>
          {item.originalTitle && norm(item.originalTitle) !== norm(item.title) && <p className="detail__original">{item.originalTitle}</p>}
          <p className="detail__meta">{metaLine({ ...item, creators: isNote ? [author] : item.creators })}</p>
          {item.rating ? (
            <p className="detail__rating">
              <StarRating value={item.rating} /> <span className="sr-only">{starsText(item.rating)}</span>
            </p>
          ) : null}

          {paragraphs.map((p, i) => (
            <p key={i} className="detail__p">
              {p}
            </p>
          ))}

          {item.ownerNote && (
            <p className="detail__p detail__note">
              <span className="detail__note-who">Observaciones: </span>
              {item.ownerNote}
            </p>
          )}

          {!paragraphs.length && !item.ownerNote && <p className="detail__p detail__muted">Sin observaciones por ahora.</p>}
        </div>

        <div className="detail__side">
          <Media key={item.id} item={item} />

          {tagged.length > 0 && (
            <p className="detail__tagged">
              Etiquetado:{' '}
              {tagged.map(([key, value, label], i) => (
                <span key={`${key}-${value}`}>
                  {i > 0 && ', '}
                  <Link to={`${base}?${key}=${encodeURIComponent(value)}`}>{label}</Link>
                </span>
              ))}
            </p>
          )}

          {twin && ROOM_CONTAINERS[twin.roomId]?.includes(twin.container) && (
            <p className="detail__twin">
              {ROOM_NAMES[twin.roomId]} también lo tiene:{' '}
              <Link to={`/room/${twin.roomId}/${twin.container}/${twin.id}`}>verlo en sus favoritos</Link>
            </p>
          )}
        </div>
      </article>

      <div className="detail__bottom">
        <LikeButton key={item.id} itemId={item.id} initial={item.likes} />
        <Guestbook key={`c-${item.id}`} item={item} />

        {(prev || next) && (
          <nav className="detail__pager" aria-label="Anterior y siguiente">
            {prev ? (
              <Link to={`${base}/${prev.id}`} state={location.state}>
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`${base}/${next.id}`} state={location.state}>
                {next.title} →
              </Link>
            )}
          </nav>
        )}
      </div>

      {editing && (
        <AddItemForm
          roomId={item.roomId}
          container={item.container}
          item={item}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false)
            if (saved) setItem(saved)
            else navigate(base, { replace: true })
          }}
        />
      )}
    </ArchiveLayout>
  )
}
