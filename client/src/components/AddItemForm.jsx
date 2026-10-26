import { useEffect, useMemo, useRef, useState } from 'react'
import { createItem, deleteItem, lookupMedia, updateItem } from '../lib/api.js'
import { suggestClassification } from '../lib/classify.js'
import { currentFestivity } from '../lib/specialDates.js'
import useSession from '../lib/session.js'
import {
  CONTAINERS,
  DAYTIME_LABELS,
  MOOD_LABELS,
  SEASON_LABELS,
  SPECIAL_DATE_LABELS,
  STAGE_LABELS,
  TAG_LABELS,
  TAGS_BY_CONTAINER,
  WEATHER_LABELS,
} from '../lib/labels.js'
import { CONTAINER_VIEW, ROOM_NAMES } from './containerMeta.js'
import { StarInput } from './Stars.jsx'

const MAX_GALLERY = 3

const EMPTY = {
  title: '',
  originalTitle: '',
  year: '',
  creators: '',
  cast: '',
  genres: '',
  tags: [],
  date: '',
  place: '',
  body: '',
  ownerNote: '',
  weather: [],
  daytime: 'cualquiera',
  seasons: [],
  moods: [],
  stages: [],
  specialDates: [],
  audience: 'ATP',
  rating: 5,
  visibility: 'publico',
  videoUrl: '',
  coverUrl: null,
}

/** Ítem existente -> estado del formulario */
function fromItem(item) {
  return {
    ...EMPTY,
    title: item.title ?? '',
    originalTitle: item.originalTitle ?? '',
    year: item.year ? String(item.year) : '',
    creators: (item.creators ?? []).join(', '),
    cast: (item.cast ?? []).join(', '),
    genres: (item.genres ?? []).join(', '),
    tags: item.tags ?? [],
    date: item.date ?? '',
    place: item.place ?? '',
    body: item.body ?? '',
    ownerNote: item.ownerNote ?? '',
    weather: item.weather ?? [],
    daytime: item.daytime ?? 'cualquiera',
    seasons: item.seasons ?? [],
    moods: item.moods ?? [],
    stages: item.stages ?? [],
    specialDates: item.specialDates ?? [],
    audience: item.audience ?? 'ATP',
    rating: item.rating ?? 5,
    visibility: item.visibility ?? 'publico',
    videoUrl: item.videoUrl ?? '',
  }
}

const splitList = (s) =>
  String(s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

function Chips({ legend, values, labels, onToggle, suggested = [], reasons = {} }) {
  return (
    <fieldset className="chips">
      <legend>{legend}</legend>
      {Object.entries(labels).map(([value, label]) => (
        <label key={value} className={`chip${suggested.includes(value) ? ' is-suggested' : ''}`}>
          <input type="checkbox" checked={values.includes(value)} onChange={() => onToggle(value)} />
          <span title={reasons[value] ? `Sugerido: ${reasons[value]}` : undefined}>{label}</span>
        </label>
      ))}
    </fieldset>
  )
}

/** Buscador en internet: trae portada, año, autor, elenco y géneros para no tipear todo */
function Assistant({ container, onPick }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState({ status: 'idle', results: [], error: '' })
  const ctrl = useRef(null)
  const view = CONTAINER_VIEW[container]

  async function search(e) {
    e?.preventDefault()
    if (q.trim().length < 2) return
    ctrl.current?.abort()
    ctrl.current = new AbortController()
    setState({ status: 'loading', results: [], error: '' })
    try {
      const results = await lookupMedia(container, q.trim(), ctrl.current.signal)
      setState({ status: 'done', results, error: '' })
    } catch (err) {
      if (err.name !== 'AbortError') setState({ status: 'error', results: [], error: err.message })
    }
  }

  return (
    <section className="assist" aria-label="Buscar en internet">
      <div className="assist__bar">
        <label className="sr-only" htmlFor="assist-q">
          Buscar en internet
        </label>
        <input
          id="assist-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search(e)}
          placeholder={view.placeholder}
        />
        <button type="button" className="btn" onClick={search}>
          Buscar
        </button>
      </div>
      <p className="assist__hint">Escribí el título y elegí el que corresponde: completo los datos y la imagen, y te sugiero cómo clasificarlo.</p>

      {state.status === 'loading' && <p className="assist__status">Buscando…</p>}
      {state.status === 'error' && <p className="assist__status assist__status--error">{state.error}</p>}
      {state.status === 'done' && state.results.length === 0 && (
        <p className="assist__status">No encontré nada con ese nombre. Probá de otra forma o completalo a mano.</p>
      )}

      {state.results.length > 0 && (
        <ul className="assist__results">
          {state.results.map((r, i) => (
            <li key={`${r.source}-${r.title}-${i}`}>
              <button
                type="button"
                className="assist__result"
                onClick={() => {
                  onPick(r)
                  setState({ status: 'idle', results: [], error: '' })
                }}
              >
                <span className="assist__thumb">{r.cover ? <img src={r.cover} alt="" loading="lazy" /> : <span>sin imagen</span>}</span>
                <span className="assist__info">
                  <b>{r.title}</b>
                  <span>{[r.kind, r.year, r.creators.join(', '), r.place].filter(Boolean).join(' · ')}</span>
                  {r.cast?.length > 0 && <span className="assist__cast">Con {r.cast.slice(0, 3).join(', ')}</span>}
                  <span className="assist__source">{r.source}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Miniaturas de archivos elegidos (para ver qué se va a subir) */
function usePreviews(files) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return urls
}

/**
 * Alta o modificación de un ítem. Como ya se entró con contraseña, no se pide
 * de nuevo: el autor queda registrado con el nombre de la sesión.
 *
 * @param {{ roomId: string, container: string, item?: object, onClose: () => void, onSaved: (item: object|null) => void }} props
 *   onSaved recibe el ítem guardado, o null si se borró.
 */
export default function AddItemForm({ roomId, container, item = null, onClose, onSaved }) {
  const session = useSession()
  const editing = Boolean(item)
  const dialog = useRef(null)
  const coverInput = useRef(null)
  const [f, setF] = useState(() => (item ? fromItem(item) : EMPTY))
  const [picked, setPicked] = useState(null)
  const [suggested, setSuggested] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  // archivos
  const [coverFile, setCoverFile] = useState(null)
  const [removeCover, setRemoveCover] = useState(false)
  const [keepGallery, setKeepGallery] = useState(item?.gallery ?? [])
  const [newGallery, setNewGallery] = useState([])
  const [audioFile, setAudioFile] = useState(null)
  const [removeAudio, setRemoveAudio] = useState(false)
  const galleryPreviews = usePreviews(newGallery)
  const [coverPreview] = usePreviews(useMemo(() => (coverFile ? [coverFile] : []), [coverFile]))

  const view = CONTAINER_VIEW[container]
  const isNote = container === 'diario'
  const isText = isNote || container === 'moodboard'
  const hasDate = ['diario', 'fotos', 'actividades'].includes(container)
  const hasPlace = ['fotos', 'actividades', 'cafe'].includes(container)
  const hasCast = container === 'peliculas' || container === 'series'
  const tagOptions = TAGS_BY_CONTAINER[container]
  const galleryRoom = MAX_GALLERY - keepGallery.length - newGallery.length

  useEffect(() => {
    const d = dialog.current
    d?.showModal()
    return () => d?.close()
  }, [])

  const set = (key, value) => setF((prev) => ({ ...prev, [key]: value }))
  const toggle = (key) => (value) =>
    setF((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value] }))

  function applySuggestion(info) {
    const s = suggestClassification({ container, roomId, ...info })
    const today = currentFestivity()
    setSuggested({ ...s, today: today && !s.specialDates.includes(today) ? today : null })
    setF((prev) => ({
      ...prev,
      weather: s.weather,
      daytime: s.daytime,
      seasons: s.seasons,
      moods: s.moods,
      stages: s.stages,
      specialDates: [...new Set([...prev.specialDates, ...s.specialDates])],
      audience: s.audience ?? prev.audience,
      tags: tagOptions ? [...new Set([...prev.tags, ...s.tags.filter((t) => tagOptions.includes(t))])] : prev.tags,
    }))
  }

  function pick(r) {
    setPicked(r)
    setF((prev) => ({
      ...prev,
      title: r.title || prev.title,
      originalTitle: r.originalTitle && r.originalTitle !== r.title ? r.originalTitle : prev.originalTitle,
      year: r.year ? String(r.year) : prev.year,
      creators: r.creators?.length ? r.creators.join(', ') : prev.creators,
      cast: r.cast?.length ? r.cast.join(', ') : prev.cast,
      genres: r.genres?.length ? r.genres.join(', ') : prev.genres,
      place: r.place || prev.place,
      coverUrl: r.cover || null,
    }))
    if (r.cover) {
      setCoverFile(null)
      setRemoveCover(false)
    }
    applySuggestion({ title: r.title, originalTitle: r.originalTitle, genres: r.genres, description: r.description, year: r.year, tags: r.tags })
  }

  function addGallery(files) {
    const list = [...files].slice(0, Math.max(0, galleryRoom))
    if (files.length > list.length) setError(`Podés sumar hasta ${MAX_GALLERY} fotos además de la principal.`)
    setNewGallery((prev) => [...prev, ...list])
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!f.title.trim()) {
      setError('Ponele un título.')
      return
    }
    const out = new FormData()
    out.set('passcode', session?.passcode ?? '')
    if (!editing) {
      out.set('roomId', roomId)
      out.set('container', container)
    }
    for (const key of ['title', 'originalTitle', 'year', 'date', 'place', 'body', 'ownerNote', 'daytime', 'visibility']) {
      out.set(key, String(f[key] ?? '').trim())
    }
    out.set('rating', String(f.rating ?? 5))
    if (!isText) out.set('audience', f.audience)
    if (!isNote) out.set('creators', JSON.stringify(splitList(f.creators)))
    out.set('cast', JSON.stringify(splitList(f.cast)))
    out.set('genres', JSON.stringify(splitList(f.genres)))
    for (const key of ['tags', 'weather', 'seasons', 'moods', 'stages', 'specialDates']) out.set(key, JSON.stringify(f[key]))
    const video = f.videoUrl.trim()
    const m = video.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/)
    out.set('videoUrl', m ? `https://www.youtube.com/embed/${m[1]}` : video)

    if (coverFile) out.set('cover', coverFile)
    else if (f.coverUrl) out.set('coverUrl', f.coverUrl)
    else if (editing && removeCover) out.set('removeCover', '1')
    for (const g of newGallery) out.append('gallery', g)
    if (editing) out.set('keepGallery', JSON.stringify(keepGallery))
    if (audioFile) out.set('audio', audioFile)
    else if (editing && removeAudio) out.set('removeAudio', '1')

    setSending(true)
    try {
      onSaved(editing ? await updateItem(item.id, out) : await createItem(out))
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  async function remove() {
    if (!window.confirm(`¿Borrar «${item.title}»? También se borran sus comentarios.`)) return
    setSending(true)
    try {
      await deleteItem(item.id)
      onSaved(null)
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  const sug = suggested ?? {}
  const currentCover = coverPreview ?? f.coverUrl ?? (editing && !removeCover ? item.cover : null)

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} aria-labelledby="add-title" data-room={roomId}>
      <form className="sheet__paper" onSubmit={submit}>
        <button type="button" className="sheet__close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
        <h2 id="add-title" className="sheet__title">
          {editing ? `Modificar «${item.title}»` : `Agregar a ${CONTAINERS[container].label}`}
        </h2>
        <p className="sheet__hint">
          En la pieza de {ROOM_NAMES[roomId]} · {editing ? 'lo modifica' : 'lo agrega'} {session?.name}
        </p>

        {view.lookup && <Assistant container={container} onPick={pick} />}

        {picked && (
          <p className="sheet__picked">
            Datos de {picked.source}
            {picked.url && (
              <>
                {' '}
                (
                <a href={picked.url} target="_blank" rel="noreferrer">
                  ver fuente
                </a>
                )
              </>
            )}
            . Revisá que esté todo bien.
          </p>
        )}

        <div className="sheet__grid">
          <div className="sheet__col">
            <label className="field">
              <span>Título</span>
              <input value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={140} />
            </label>

            {!isText && (
              <div className="field-row">
                <label className="field">
                  <span>Título original</span>
                  <input value={f.originalTitle} onChange={(e) => set('originalTitle', e.target.value)} maxLength={140} />
                </label>
                <label className="field field--short">
                  <span>Año</span>
                  <input value={f.year} onChange={(e) => set('year', e.target.value)} type="number" min="1800" max="2100" />
                </label>
              </div>
            )}

            {view.creatorsLabel && !isNote && (
              <label className="field">
                <span>{view.creatorsLabel} (separá con comas)</span>
                <input value={f.creators} onChange={(e) => set('creators', e.target.value)} />
              </label>
            )}
            {hasCast && (
              <label className="field">
                <span>Actúan (separá con comas)</span>
                <input value={f.cast} onChange={(e) => set('cast', e.target.value)} />
              </label>
            )}
            {!isText && (
              <label className="field">
                <span>Géneros (separá con comas)</span>
                <input value={f.genres} onChange={(e) => set('genres', e.target.value)} />
              </label>
            )}

            {(hasDate || hasPlace) && (
              <div className="field-row">
                {hasDate && (
                  <label className="field field--short">
                    <span>Fecha</span>
                    <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
                  </label>
                )}
                {hasPlace && (
                  <label className="field">
                    <span>Lugar</span>
                    <input value={f.place} onChange={(e) => set('place', e.target.value)} />
                  </label>
                )}
              </div>
            )}

            {isText ? (
              <label className="field">
                <span>{isNote ? 'La nota' : 'Lo que querés contar'}</span>
                <textarea value={f.body} onChange={(e) => set('body', e.target.value)} rows={7} />
              </label>
            ) : (
              <label className="field">
                <span>Observaciones</span>
                <textarea value={f.ownerNote} onChange={(e) => set('ownerNote', e.target.value)} rows={3} />
              </label>
            )}

            <label className="field">
              <span>Video de YouTube (opcional)</span>
              <input value={f.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} type="url" placeholder="https://www.youtube.com/watch?v=…" />
            </label>

            {/* Imagen principal (la del buscador o la que se suba) */}
            <div className="field">
              <span>Imagen principal</span>
              {currentCover ? (
                <div className="sheet__cover">
                  <img src={currentCover} alt="" />
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setCoverFile(null)
                      set('coverUrl', null)
                      setRemoveCover(true)
                    }}
                  >
                    quitar
                  </button>
                </div>
              ) : (
                <input
                  ref={coverInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    setCoverFile(file)
                    if (file) setRemoveCover(false)
                  }}
                />
              )}
            </div>

            {/* Hasta 3 fotos más, con menos protagonismo */}
            <div className="field">
              <span>Fotos extra (hasta {MAX_GALLERY})</span>
              {(keepGallery.length > 0 || newGallery.length > 0) && (
                <ul className="sheet__thumbs">
                  {keepGallery.map((url) => (
                    <li key={url}>
                      <img src={url} alt="" />
                      <button type="button" className="link-btn" onClick={() => setKeepGallery((prev) => prev.filter((u) => u !== url))}>
                        quitar
                      </button>
                    </li>
                  ))}
                  {newGallery.map((file, i) => (
                    <li key={`${file.name}-${i}`}>
                      <img src={galleryPreviews[i]} alt="" />
                      <button type="button" className="link-btn" onClick={() => setNewGallery((prev) => prev.filter((_, j) => j !== i))}>
                        quitar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {galleryRoom > 0 && (
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    addGallery(e.target.files ?? [])
                    e.target.value = ''
                  }}
                />
              )}
            </div>

            {/* Audio .mp3 */}
            <div className="field">
              <span>Audio (.mp3, hasta 20 MB)</span>
              {editing && item.audio && !removeAudio && !audioFile ? (
                <div className="sheet__audio">
                  <audio src={item.audio} controls preload="none" />
                  <button type="button" className="link-btn" onClick={() => setRemoveAudio(true)}>
                    quitar
                  </button>
                </div>
              ) : (
                <input type="file" accept=".mp3,audio/mpeg" onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)} />
              )}
            </div>
          </div>

          <div className="sheet__col">
            <fieldset className="chips sheet__visibility">
              <legend>¿Quién lo puede ver?</legend>
              <label className="chip">
                <input type="radio" name="visibility" checked={f.visibility === 'publico'} onChange={() => set('visibility', 'publico')} />
                <span>Público</span>
              </label>
              <label className="chip">
                <input type="radio" name="visibility" checked={f.visibility === 'privado'} onChange={() => set('visibility', 'privado')} />
                <span>Privado (solo Mariana y Franco)</span>
              </label>
            </fieldset>

            <StarInput label="Cuánto te gusta" value={f.rating} onChange={(v) => set('rating', v)} />

            <div className="sheet__classify">
              <span>Clasificación</span>
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  applySuggestion({
                    title: f.title,
                    originalTitle: f.originalTitle,
                    genres: splitList(f.genres),
                    description: `${f.body} ${f.ownerNote} ${picked?.description ?? ''}`,
                    year: Number(f.year) || null,
                    tags: f.tags,
                  })
                }
              >
                sugerir clasificación
              </button>
            </div>

            {tagOptions && (
              <Chips legend="Tipo" values={f.tags} onToggle={toggle('tags')} labels={Object.fromEntries(tagOptions.map((t) => [t, TAG_LABELS[t]]))} />
            )}

            <Chips
              legend="Fecha especial"
              values={f.specialDates}
              onToggle={toggle('specialDates')}
              labels={SPECIAL_DATE_LABELS}
              suggested={[...(sug.specialDates ?? []), ...(sug.today ? [sug.today] : [])]}
              reasons={{ ...(sug.reasons ?? {}), ...(sug.today ? { [sug.today]: 'es la fecha de hoy' } : {}) }}
            />
            {sug.specialDates?.length > 0 && (
              <p className="sheet__why">{sug.specialDates.map((d) => `${SPECIAL_DATE_LABELS[d]}: ${sug.reasons[d]}`).join(' · ')}</p>
            )}

            <Chips legend="Para qué clima" values={f.weather} onToggle={toggle('weather')} labels={WEATHER_LABELS} suggested={sug.weather} />

            <fieldset className="chips">
              <legend>Momento del día</legend>
              {Object.entries(DAYTIME_LABELS).map(([value, label]) => (
                <label key={value} className={`chip${sug.daytime === value ? ' is-suggested' : ''}`}>
                  <input type="radio" name="daytime" checked={f.daytime === value} onChange={() => set('daytime', value)} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <Chips legend="Estación" values={f.seasons} onToggle={toggle('seasons')} labels={SEASON_LABELS} suggested={sug.seasons} />
            <Chips legend="Ánimo" values={f.moods} onToggle={toggle('moods')} labels={MOOD_LABELS} suggested={sug.moods} />
            <Chips legend="Etapa de Amelia" values={f.stages} onToggle={toggle('stages')} labels={STAGE_LABELS} suggested={sug.stages} />

            {!isText && (
              <label className="field field--short">
                <span>Edad</span>
                <select value={f.audience} onChange={(e) => set('audience', e.target.value)}>
                  {['ATP', '+13', '+16', '+18'].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        {error && (
          <p className="sheet__error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet__actions">
          {editing && (
            <button type="button" className="btn btn--danger" onClick={remove} disabled={sending}>
              Borrar
            </button>
          )}
          <span className="sheet__spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={sending}>
            {sending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
