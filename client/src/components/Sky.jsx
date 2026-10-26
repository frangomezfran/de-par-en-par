/**
 * Cielo que se ve por la ventana. Solo cambia la vista; nunca se muestra la
 * temperatura ni ningún papelito con datos.
 *
 * Si hay una festividad (Halloween, Navidad, Año Nuevo, cumpleaños) la ventana
 * la "simula" con una capa encima del cielo real.
 *
 * @param {{ condition?: string, isDay?: boolean, mini?: boolean, festivity?: string|null, className?: string }} props
 */
export default function Sky({ condition = 'soleado', isDay = true, mini = false, festivity = null, className = '' }) {
  const c = condition || 'soleado'
  const time = isDay ? 'day' : 'night'
  const cloudy = c !== 'soleado'
  const clearish = c === 'soleado' || c === 'nublado'

  return (
    <div
      className={`sky sky--${c} sky--${time}${mini ? ' sky--mini' : ''} ${className}`}
      aria-hidden="true"
    >
      {!isDay && clearish && <span className="sky__stars" />}
      {isDay && clearish && <span className="sky__sun" />}
      {!isDay && clearish && <span className="sky__moon" />}

      <span className="sky__clouds">
        <span className="sky__cloud sky__cloud--a" />
        <span className="sky__cloud sky__cloud--b" />
        {cloudy && <span className="sky__cloud sky__cloud--c" />}
        {cloudy && <span className="sky__cloud sky__cloud--d" />}
      </span>

      <span className="sky__roofs" />

      {(c === 'lluvioso' || c === 'tormenta') && (
        <>
          <span className="sky__rain sky__rain--far" />
          <span className="sky__rain" />
        </>
      )}
      {c === 'tormenta' && <span className="sky__flash" />}
      {c === 'nevado' && (
        <>
          <span className="sky__snow sky__snow--far" />
          <span className="sky__snow" />
        </>
      )}
      {c === 'niebla' && (
        <>
          <span className="sky__fog" />
          <span className="sky__fog sky__fog--b" />
        </>
      )}

      {festivity && <Festivity kind={festivity} />}

      <span className="sky__glass" />
    </div>
  )
}

function Festivity({ kind }) {
  const birthday = kind.startsWith('cumple-')
  return (
    <span className={`fest fest--${birthday ? 'cumple' : kind} fest--${kind}`}>
      {kind === 'halloween' && (
        <>
          <span className="fest__moon" />
          <span className="fest__bat fest__bat--a" />
          <span className="fest__bat fest__bat--b" />
          <span className="fest__bat fest__bat--c" />
        </>
      )}
      {kind === 'navidad' && (
        <>
          <span className="fest__wire" />
          <span className="fest__lights" />
          <span className="fest__lights fest__lights--alt" />
        </>
      )}
      {kind === 'anio-nuevo' && (
        <>
          <span className="fest__burst fest__burst--a" />
          <span className="fest__burst fest__burst--b" />
          <span className="fest__burst fest__burst--c" />
        </>
      )}
      {birthday && (
        <>
          <span className="fest__balloon fest__balloon--a" />
          <span className="fest__balloon fest__balloon--b" />
          <span className="fest__balloon fest__balloon--c" />
          <span className="fest__confetti" />
        </>
      )}
    </span>
  )
}
