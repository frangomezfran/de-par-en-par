import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import ArchiveLayout from '../components/ArchiveLayout.jsx'
import FilterBar from '../components/FilterBar.jsx'
import StatsPanel from '../components/StatsPanel.jsx'
import AddItemForm from '../components/AddItemForm.jsx'
import Cover from '../components/Cover.jsx'
import { ROOM_CONTAINERS, ROOM_NAMES, canAdd, metaLine } from '../components/containerMeta.js'
import useSession from '../lib/session.js'
import { CONTAINERS, DAYTIME_LABELS, SPECIAL_DATE_LABELS, WEATHER_LABELS } from '../lib/labels.js'
import { getItems } from '../lib/api.js'
import { applyFilters, facetOptions, parseFilters, toSearchParams } from '../lib/filters.js'
import useWeather from '../lib/useWeather.js'
import { ROOM_PLACE } from '../lib/place.js'

/** Proporción de la caja: la de la imagen, con topes (afiche 2:3 a foto 3:2) */
const MIN_RATIO = 2 / 3
const MAX_RATIO = 3 / 2
const NOTE_RATIO = 1 // las notas sin foto: ficha cuadrada

/**
 * Tarjeta del listado. Ocupa dos filas compartidas de la grilla (imagen y datos):
 * la imagen se apoya abajo, así los títulos de una misma fila quedan alineados.
 */
function Card({ item }) {
  const location = useLocation()
  const [ratio, setRatio] = useState(item.cover ? 3 / 4 : NOTE_RATIO)
  const to = `/room/${item.roomId}/${item.container}/${item.id}`
  const state = { from: location.pathname + location.search }
  return (
    <>
      <div className="card__visual">
        <Link to={to} state={state} className="card__action">
          Ver
        </Link>
        <Link to={to} state={state} className="card__img" tabIndex={-1} aria-hidden="true" style={{ aspectRatio: ratio }}>
          <Cover
            item={item}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget
              if (w && h) setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, w / h)))
            }}
            onBroken={() => setRatio(NOTE_RATIO)}
          />
        </Link>
      </div>
      <p className="card__meta">
        {item.visibility === 'privado' && <span className="card__private">Privado · </span>}
        <span className="card__title">{item.title}</span>
        {metaLine(item) && <> — {metaLine(item)}</>}
      </p>
    </>
  )
}

export default function ContainerPage() {
  const { roomId, container } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { weather } = useWeather({ lat: ROOM_PLACE.lat, lon: ROOM_PLACE.lon })
  const session = useSession()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [showStats, setShowStats] = useState(false)

  const valid = Boolean(ROOM_NAMES[roomId] && (ROOM_CONTAINERS[roomId]?.includes(container) || container === 'ventana'))
  const isWindow = container === 'ventana'
  const name = ROOM_NAMES[roomId]
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  // La ventana sin parámetros (entrada directa) usa el cielo de ahora
  const effective = useMemo(() => {
    const explicit = ['weather', 'daytime', 'date'].some((k) => searchParams.has(k)) || searchParams.has('todo')
    if (!isWindow || !weather || explicit) return filters
    return { ...filters, weather: weather.condition, daytime: weather.isDay ? 'diurno' : 'nocturno' }
  }, [filters, isWindow, weather, searchParams])

  useEffect(() => {
    if (valid) document.title = `${CONTAINERS[container].label} · Favoritos de ${name}`
  }, [valid, container, name])

  const load = useCallback(() => {
    setError('')
    return getItems({ room: roomId, container: isWindow ? undefined : container })
      .then((list) => setItems(isWindow ? list.filter((i) => ROOM_CONTAINERS[roomId].includes(i.container)) : list))
      .catch((e) => setError(e.message))
  }, [roomId, container, isWindow])

  useEffect(() => {
    if (!valid) return
    setItems(null)
    load()
  }, [valid, load])

  const shown = useMemo(() => applyFilters(items ?? [], effective), [items, effective])
  const facets = useMemo(() => facetOptions(items ?? []), [items])

  const update = useCallback(
    (next) => {
      const params = toSearchParams(next)
      // ?cielo= / ?noche= / ?fiesta= son overrides de prueba: se conservan
      for (const k of ['cielo', 'noche', 'fiesta']) if (searchParams.has(k)) params.set(k, searchParams.get(k))
      if (isWindow && !next.weather && !next.date && !next.daytime) params.set('todo', '1')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams, isWindow],
  )

  const setFilter = (key, value) => update({ ...effective, [key]: value || null })
  const clear = () => update({ sort: effective.sort })

  if (!valid) return <Navigate to={ROOM_NAMES[roomId] ? `/room/${roomId}` : '/'} replace />

  const groups = isWindow
    ? ROOM_CONTAINERS[roomId].map((c) => ({ container: c, items: shown.filter((i) => i.container === c) })).filter((g) => g.items.length)
    : [{ container, items: shown }]

  const windowContext = [
    effective.date && SPECIAL_DATE_LABELS[effective.date],
    effective.weather && WEATHER_LABELS[effective.weather],
    effective.daytime && DAYTIME_LABELS[effective.daytime],
  ].filter(Boolean)

  return (
    <ArchiveLayout
      roomId={roomId}
      title={CONTAINERS[container].label}
      onAdd={isWindow ? undefined : () => setAdding(true)}
      aside={<FilterBar filters={effective} facets={facets} onChange={setFilter} onClear={clear} />}
    >
      <div className="archive__toolbar">
        <h1 className="archive__h1">
          {CONTAINERS[container].label}
          {isWindow && windowContext.length > 0 && (
            <span className="archive__context">
              {' '}
              — {windowContext.join(', ')} en {ROOM_PLACE.city}
            </span>
          )}
        </h1>
        <p className="archive__count" aria-live="polite">
          {items ? (shown.length === items.length ? `${items.length} en total` : `${shown.length} de ${items.length}`) : ''}
          {' · '}
          <button type="button" className="archive__link-btn" aria-expanded={showStats} onClick={() => setShowStats((v) => !v)}>
            {showStats ? 'ocultar estadísticas' : 'estadísticas'}
          </button>
        </p>
      </div>

      {showStats && <StatsPanel roomId={roomId} container={container} onPick={setFilter} />}

      {error && (
        <div className="archive__empty">
          <p>No pude traer las cosas de {name}: {error}</p>
          <button type="button" className="btn" onClick={load}>
            Probar de nuevo
          </button>
        </div>
      )}

      {!error && items === null && <p className="archive__empty">Cargando…</p>}

      {!error && items && shown.length === 0 && (
        <div className="archive__empty">
          <p>{items.length === 0 ? 'Todavía no hay nada acá.' : 'Con esos filtros no aparece nada.'}</p>
          {items.length > 0 ? (
            <button type="button" className="btn" onClick={clear}>
              Sacar filtros
            </button>
          ) : (
            !isWindow &&
            canAdd(session, roomId) && (
              <button type="button" className="btn" onClick={() => setAdding(true)}>
                Agregar lo primero
              </button>
            )
          )}
        </div>
      )}

      {groups.map((g) => (
        <section key={g.container} className="archive__group" aria-label={CONTAINERS[g.container].label}>
          {isWindow && <h2 className="archive__h2">{CONTAINERS[g.container].label}</h2>}
          <ul className="cards">
            {g.items.map((item) => (
              <li key={item.id} className="card">
                <Card item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {adding && (
        <AddItemForm
          roomId={roomId}
          container={container}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            load()
          }}
        />
      )}
    </ArchiveLayout>
  )
}
