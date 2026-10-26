import { useState } from 'react'
import { likeItem } from '../lib/api.js'

/** "Me gusta": uno por persona cada tanto (lo controla el servidor) */
export default function LikeButton({ itemId, initial = 0 }) {
  const [likes, setLikes] = useState(initial)
  const [state, setState] = useState('idle') // idle | sending | done | repeat | error
  const [msg, setMsg] = useState('')

  async function like() {
    if (state === 'sending') return
    setState('sending')
    try {
      const res = await likeItem(itemId)
      setLikes(res.likes)
      setState('done')
      setMsg('')
    } catch (err) {
      if (err.status === 429 && err.likes !== undefined) {
        setLikes(err.likes)
        setState('repeat')
      } else {
        setState('error')
      }
      setMsg(err.message)
    }
  }

  const liked = state === 'done' || state === 'repeat'

  return (
    <p className="like">
      <button type="button" className={`like__btn${liked ? ' is-liked' : ''}`} onClick={like} aria-pressed={liked} disabled={state === 'sending'}>
        <span aria-hidden="true">{liked ? '♥' : '♡'}</span> me gusta
      </button>{' '}
      <span className="like__count">({likes})</span>
      {msg && (
        <span className="like__msg" role="status">
          {' '}
          {msg}
        </span>
      )}
    </p>
  )
}
