/**
 * Presentación de cada contenedor en Favoritos (decisiones visuales — Claude).
 * Las etiquetas canónicas viven en lib/labels.js.
 */

export const ROOM_NAMES = { mariana: 'Mariana', franco: 'Franco' }

export const OTHER_ROOM = { mariana: 'franco', franco: 'mariana' }

/** Contenedores que existen en cada pieza (los objetos clickeables de la escena) */
export const ROOM_CONTAINERS = {
  mariana: ['peliculas', 'series', 'musica', 'libros', 'juegos', 'fotos', 'diario', 'moodboard', 'flores', 'actividades'],
  franco: ['peliculas', 'series', 'musica', 'libros', 'juegos', 'fotos', 'diario', 'moodboard', 'cafe', 'actividades'],
}

export const CONTAINER_VIEW = {
  peliculas: { code: 'PEL', creatorsLabel: 'Dirección', castLabel: 'Actúan', lookup: true, placeholder: 'Ej: Ratatouille, Romeo + Juliet…' },
  series: { code: 'SER', creatorsLabel: 'Creada por', castLabel: 'Actúan', lookup: true, placeholder: 'Ej: Twin Peaks, Breaking Bad…' },
  musica: { code: 'MUS', creatorsLabel: 'Artista', lookup: true, placeholder: 'Ej: Canción animal, Fallen…' },
  libros: { code: 'LIB', creatorsLabel: 'Autor/a', lookup: true, placeholder: 'Ej: Rayuela, Mafalda…' },
  juegos: { code: 'JUE', creatorsLabel: 'Hecho por', lookup: true, placeholder: 'Ej: Half-Life, Los Sims 2…' },
  flores: { code: 'FLO', creatorsLabel: null, lookup: true, placeholder: 'Ej: Hortensia, Jazmín…' },
  cafe: { code: 'CAF', creatorsLabel: 'Marca / casa', lookup: true, placeholder: 'Ej: Cabrales, Geisha, cortado, café Mar del Plata…' },
  moodboard: { code: 'MOO', creatorsLabel: null, lookup: true, placeholder: 'Ej: Fiat 600, chocotorta…' },
  fotos: { code: 'FOT', creatorsLabel: 'Sacada por', lookup: false },
  diario: { code: 'NOT', creatorsLabel: 'Escribió', lookup: false },
  actividades: { code: 'ACT', creatorsLabel: 'Con', lookup: true, placeholder: 'Ej: pádel, natación…' },
  ventana: { code: 'VEN', creatorsLabel: null, lookup: false },
}

/** ¿Puede esta sesión agregar en esta pieza? (cada dueño en la suya) */
export const canAdd = (session, roomId) => session?.role === 'owner' && session.roomId === roomId

/** ¿Puede comentar este ítem? (solo la otra persona: Franco en lo de Mariana y al revés) */
export const canComment = (session, item) => session?.role === 'owner' && session.roomId !== item.roomId

/** ¿Puede modificarlo? (solo quien lo agregó) */
export const canEdit = (session, item) => Boolean(session && item?.addedBy && session.name === item.addedBy)

/**
 * Número de inventario estable por pieza + contenedor, en orden de llegada:
 * MAR.PEL.001, FRA.CAF.002…
 * @param {Array} items  todos los ítems de la pieza (o del contenedor), sin filtrar
 * @returns {Map<string,string>} id -> código
 */
export function inventoryCodes(items) {
  const groups = new Map()
  for (const it of items) {
    const k = `${it.roomId}|${it.container}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(it)
  }
  const codes = new Map()
  for (const list of groups.values()) {
    list
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id))
      .forEach((it, i) => {
        const room = it.roomId.slice(0, 3).toUpperCase()
        const cont = CONTAINER_VIEW[it.container]?.code ?? it.container.slice(0, 3).toUpperCase()
        codes.set(it.id, `${room}.${cont}.${String(i + 1).padStart(3, '0')}`)
      })
  }
  return codes
}

/**
 * '2025-06-15' -> '15/6/25' (como las fichas del archivo).
 * Las fechas con hora (comentarios, en UTC) se muestran en la hora local de quien mira.
 */
export function shortDate(iso) {
  if (!iso) return ''
  const s = String(iso)
  if (s.length > 10) {
    const dt = new Date(s)
    if (!Number.isNaN(dt.getTime())) return `${dt.getDate()}/${dt.getMonth() + 1}/${String(dt.getFullYear()).slice(2)}`
  }
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  if (!y) return ''
  return `${d}/${m}/${String(y).slice(2)}`
}

/** Línea de ficha: "Autor; Lugar; fecha" */
export function metaLine(item) {
  const who = item.creators?.length ? item.creators.join(', ') : item.addedBy
  const when = item.date ? shortDate(item.date) : item.year
  return [who, item.place, when].filter(Boolean).join('; ')
}
