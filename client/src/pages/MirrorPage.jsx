import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import ArchiveLayout from '../components/ArchiveLayout.jsx'
import Cover from '../components/Cover.jsx'
import { StarRating, starsText } from '../components/Stars.jsx'
import { OTHER_ROOM, ROOM_NAMES } from '../components/containerMeta.js'
import { CONTAINERS } from '../lib/labels.js'
import { getCoincidences } from '../lib/api.js'

const stars = (v) => starsText(v)

/** Una línea que resume cómo coinciden (o no) las dos opiniones */
function summary(a, b) {
  const [na, nb] = [ROOM_NAMES[a.item.roomId], ROOM_NAMES[b.item.roomId]]
  const where =
    a.item.container === b.item.container
      ? `Los dos lo tienen en ${CONTAINERS[a.item.container]?.label.toLowerCase()}.`
      : `${na} lo guarda en ${CONTAINERS[a.item.container]?.label.toLowerCase()} y ${nb} en ${CONTAINERS[b.item.container]?.label.toLowerCase()}.`
  const ra = a.item.rating
  const rb = b.item.rating
  if (!ra || !rb) return where
  const diff = Math.abs(ra - rb)
  const verdict =
    diff === 0
      ? `Le pusieron la misma nota: ${stars(ra)} cada uno.`
      : diff <= 1
        ? `Coinciden bastante: ${na} le da ${stars(ra)} y ${nb}, ${stars(rb)}.`
        : `No piensan igual: ${na} le da ${stars(ra)} y ${nb}, ${stars(rb)}.`
  return `${where} ${verdict}`
}

/** Lo que dijo cada uno: su calificación, sus observaciones y el comentario del otro */
function Side({ side, other }) {
  const { item, comments } = side
  const owner = ROOM_NAMES[item.roomId]
  const fromOther = comments.filter((c) => c.author === ROOM_NAMES[other])
  return (
    <div className="mirror__side">
      <h3 className="mirror__who">
        {owner} <StarRating value={item.rating} />
      </h3>
      <p className="mirror__note">
        {item.ownerNote ? (
          <>
            <b>Observaciones: </b>
            {item.ownerNote}
          </>
        ) : (
          <span className="detail__muted">Sin observaciones.</span>
        )}
      </p>
      {fromOther.map((c) => (
        <p key={c.id} className="mirror__comment">
          <b>{c.author} comentó{c.rating ? ` (${stars(c.rating)})` : ''}: </b>
          {c.body}
        </p>
      ))}
      <Link to={`/room/${item.roomId}/${item.container}/${item.id}`} className="mirror__link">
        Ver en los favoritos de {owner}
      </Link>
    </div>
  )
}

/**
 * El espejo: lo que Mariana y Franco tienen en común, con lo que opina cada uno.
 */
export default function MirrorPage() {
  const { roomId } = useParams()
  const [pairs, setPairs] = useState(null)
  const [error, setError] = useState('')
  const valid = Boolean(ROOM_NAMES[roomId])

  useEffect(() => {
    if (!valid) return
    document.title = `Coincidencias · Favoritos de ${ROOM_NAMES[roomId]}`
    getCoincidences()
      .then(setPairs)
      .catch((e) => setError(e.message))
  }, [valid, roomId])

  if (!valid) return <Navigate to="/" replace />
  const other = OTHER_ROOM[roomId]

  return (
    <ArchiveLayout roomId={roomId} title="Coincidencias">
      <div className="archive__toolbar">
        <h1 className="archive__h1">
          Coincidencias <span className="archive__context">— lo que está en la pieza de {ROOM_NAMES[roomId]} y en la de {ROOM_NAMES[other]}</span>
        </h1>
        {pairs && <p className="archive__count">{pairs.length} en común</p>}
      </div>

      {error && <p className="archive__empty">No pude mirarme al espejo: {error}</p>}
      {!error && !pairs && <p className="archive__empty">Cargando…</p>}
      {pairs?.length === 0 && <p className="archive__empty">Todavía no tienen nada en común. ¡Ya va a aparecer algo!</p>}

      <ul className="mirror">
        {pairs?.map((p) => {
          const mine = p[roomId]
          const theirs = p[other]
          return (
            <li key={`${mine.item.id}|${theirs.item.id}`} className="mirror__pair">
              <div className="mirror__img">
                <Cover item={mine.item.cover ? mine.item : theirs.item} />
              </div>
              <div className="mirror__body">
                <h2 className="mirror__title">{mine.item.title}</h2>
                <p className="mirror__summary">{summary(mine, theirs)}</p>
                <div className="mirror__sides">
                  <Side side={mine} other={other} />
                  <Side side={theirs} other={roomId} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </ArchiveLayout>
  )
}
