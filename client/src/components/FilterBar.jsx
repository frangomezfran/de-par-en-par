import { SORT_LABELS } from '../lib/labels.js'
import { activeFilterCount } from '../lib/filters.js'

const FACETS = [
  { key: 'tag', label: 'Tipo' },
  { key: 'genre', label: 'Géneros' },
  { key: 'decade', label: 'Décadas' },
  { key: 'date', label: 'Fechas especiales' },
  { key: 'weather', label: 'Clima' },
  { key: 'daytime', label: 'Momento' },
  { key: 'mood', label: 'Ánimo' },
  { key: 'stage', label: 'Etapa' },
]

/**
 * Filtros como "palabras clave" en la columna izquierda: palabras rojas que se
 * tocan para filtrar; la elegida queda en negro con una ×.
 */
export default function FilterBar({ filters, facets, onChange, onClear }) {
  const active = activeFilterCount(filters)

  return (
    <section className="keywords" aria-label="Filtrar y ordenar">
      <label className="keywords__search">
        <span className="keywords__title">Buscar</span>
        <input
          type="search"
          value={filters.q ?? ''}
          onChange={(e) => onChange('q', e.target.value || null)}
          placeholder="título, autor…"
        />
      </label>

      <div className="keywords__group">
        <h2 className="keywords__title">Orden</h2>
        <p className="keywords__words">
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filters.sort === value ? 'is-active' : undefined}
              aria-pressed={filters.sort === value}
              onClick={() => onChange('sort', value)}
            >
              {label}
            </button>
          ))}
        </p>
      </div>

      {FACETS.map(({ key, label }) => {
        const options = facets[key] ?? []
        const current = filters[key]
        if (!options.length && !current) return null
        return (
          <div key={key} className="keywords__group">
            <h2 className="keywords__title">{label}</h2>
            <p className="keywords__words">
              {options.map((o) => {
                const on = current === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={on ? 'is-active' : undefined}
                    aria-pressed={on}
                    title={`${o.count}`}
                    onClick={() => onChange(key, on ? null : o.value)}
                  >
                    {/* espacios duros: cada palabra clave se corta entera al final de línea */}
                    {String(o.label).replace(/ /g, '\u00a0')}
                    {on && <span aria-hidden="true">{'\u00a0'}×</span>}
                  </button>
                )
              })}
            </p>
          </div>
        )
      })}

      {active > 0 && (
        <button type="button" className="keywords__clear" onClick={onClear}>
          Sacar filtros ({active})
        </button>
      )}
    </section>
  )
}
