import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getStats } from '../lib/api.js'
import { CONTAINERS, MOOD_LABELS, WEATHER_LABELS } from '../lib/labels.js'
import { ROOM_NAMES } from './containerMeta.js'

const GROUPS = [
  { key: 'byDecade', filter: 'decade', title: 'Por década', labels: null, limit: 8 },
  { key: 'byGenre', filter: 'genre', title: 'Géneros', labels: null, limit: 6 },
  { key: 'byMood', filter: 'mood', title: 'Para qué ánimo', labels: MOOD_LABELS, limit: 6 },
  { key: 'byWeather', filter: 'weather', title: 'Para qué clima', labels: WEATHER_LABELS, limit: 6 },
]

function BarList({ title, rows, labels, onPick }) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <figure className="bars">
      <figcaption className="bars__title">{title}</figcaption>
      <ul>
        {rows.map((r) => {
          const label = labels?.[r.key] ?? r.key
          return (
            <li key={r.key}>
              <button type="button" className="bars__row" onClick={() => onPick(r.key)} title={`${label}: ${r.count} — tocá para filtrar`}>
                <span className="bars__label">{label}</span>
                <span className="bars__track" aria-hidden="true">
                  <span className="bars__fill" style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
                <span className="bars__value">{r.count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

/** Estadísticas + comparativa con la otra pieza */
export default function StatsPanel({ roomId, container, onPick }) {
  const [stats, setStats] = useState(null)
  const statsContainer = container === 'ventana' ? undefined : container

  useEffect(() => {
    let alive = true
    setStats(null)
    getStats({ room: roomId, container: statsContainer })
      .then((s) => alive && setStats(s))
      .catch(() => alive && setStats({ error: true }))
    return () => {
      alive = false
    }
  }, [roomId, statsContainer])

  if (!stats) return <p className="stats__loading">Sumando…</p>
  if (stats.error) return <p className="stats__loading">No pude contar nada ahora. Probá en un ratito.</p>

  const other = stats.compare?.roomId
  const what = statsContainer ? CONTAINERS[statsContainer].label.toLowerCase() : 'cosas en total'

  return (
    <section className="stats" aria-label="Estadísticas y comparativas">
      <p className="stats__hero">
        <span className="stats__number">{stats.total}</span>
        <span>
          {what} en la pieza de {ROOM_NAMES[roomId]}
          {stats.compare && (
            <>
              {' '}
              · {ROOM_NAMES[other]} tiene {stats.compare.total}
            </>
          )}
        </span>
      </p>

      <div className="stats__grid">
        {GROUPS.map(({ key, filter, title, labels, limit }) =>
          stats[key]?.length ? (
            <BarList key={key} title={title} labels={labels} rows={stats[key].slice(0, limit)} onPick={(value) => onPick(filter, value)} />
          ) : null,
        )}
      </div>

      {stats.shared?.length > 0 && (
        <p className="stats__shared">
          Lo que tienen los dos:{' '}
          {stats.shared.map((s, i) => (
            <span key={s.otherId}>
              {i > 0 && ', '}
              <Link to={`/room/${other}/${s.otherContainer}/${s.otherId}`}>{s.title}</Link>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
