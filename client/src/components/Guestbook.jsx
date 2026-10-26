import { useEffect, useState } from 'react'
import { getComments, postComment } from '../lib/api.js'
import useSession from '../lib/session.js'
import { OTHER_ROOM, ROOM_NAMES, canComment, shortDate } from './containerMeta.js'
import { StarInput, StarRating } from './Stars.jsx'

/**
 * Comentarios: cada uno queda anclado con su fecha, el texto, quién lo escribió y
 * su calificación. Comenta solo la otra persona (Franco en lo de Mariana y al revés).
 */
export default function Guestbook({ item }) {
  const session = useSession()
  const [comments, setComments] = useState(null)
  const [body, setBody] = useState('')
  const [rating, setRating] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const allowed = canComment(session, item)
  const commenter = ROOM_NAMES[OTHER_ROOM[item.roomId]]

  useEffect(() => {
    let alive = true
    getComments(item.id)
      .then((c) => alive && setComments(c))
      .catch(() => alive && setComments([]))
    return () => {
      alive = false
    }
  }, [item.id])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!body.trim()) {
      setError('Escribí algo antes de comentar.')
      return
    }
    setSending(true)
    try {
      const c = await postComment(item.id, { passcode: session?.passcode, body, rating })
      setComments((prev) => [...(prev ?? []), c])
      setBody('')
      setRating(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="comments" aria-labelledby="comments-title">
      <h2 id="comments-title" className="comments__title">
        Comentarios{comments?.length ? ` (${comments.length})` : ''}
      </h2>

      {comments === null && <p className="comments__empty">Cargando…</p>}
      {comments?.length === 0 && <p className="comments__empty">Todavía no comentó nadie.</p>}

      {comments?.length > 0 && (
        <ol className="comments__list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <p className="comment__head">
                <time dateTime={c.createdAt}>{shortDate(c.createdAt)}</time>; {c.author}
                {c.rating ? (
                  <>
                    {' '}
                    <StarRating value={c.rating} />
                  </>
                ) : null}
              </p>
              <p className="comment__body">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      {allowed ? (
        <form className="comments__form" onSubmit={submit}>
          <label className="sr-only" htmlFor="comment-body">
            Tu comentario
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Escribí un comentario…"
          />
          <StarInput label="Tu calificación (opcional)" value={rating} onChange={setRating} allowEmpty />
          {error && (
            <p className="sheet__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn" disabled={sending}>
            {sending ? 'Comentando…' : `Comentar como ${session.name}`}
          </button>
        </form>
      ) : (
        <p className="comments__who">Las cosas de {ROOM_NAMES[item.roomId]} las comenta {commenter}.</p>
      )}
    </section>
  )
}
