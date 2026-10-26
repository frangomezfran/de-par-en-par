/**
 * Etiquetas y diccionarios canónicos de la aplicación Amelia.
 * Basado en las secciones §3 y §6 del contrato técnico.
 */

export const CONTAINERS = {
  peliculas: { label: 'Películas', object: 'la pila de VHS' },
  series: { label: 'Series', object: 'el televisor' },
  libros: { label: 'Libros', object: 'la biblioteca' },
  musica: { label: 'Música', object: 'el reproductor' },
  juegos: { label: 'Juegos', object: 'la computadora' },
  flores: { label: 'Flores', object: 'el florero' },
  cafe: { label: 'Café', object: 'la taza' },
  moodboard: { label: 'Moodboard', object: 'el corcho' },
  fotos: { label: 'Fotos', object: 'la cámara' },
  diario: { label: 'Notas', object: 'el cuaderno' },
  actividades: { label: 'Actividades', object: 'la mochila' },
  ventana: { label: 'Para un día así', object: 'la ventana' },
  espejo: { label: 'Coincidencias', object: 'el espejo' }
};

export const WEATHER_LABELS = {
  soleado: 'Soleado',
  nublado: 'Nublado',
  lluvioso: 'Lluvioso',
  tormenta: 'Tormenta',
  nevado: 'Nevado',
  niebla: 'Niebla'
};

export const DAYTIME_LABELS = {
  diurno: 'De día',
  nocturno: 'De noche',
  cualquiera: 'A cualquier hora'
};

export const MOOD_LABELS = {
  alegre: 'Alegre',
  tierno: 'Tierno',
  nostalgico: 'Nostálgico',
  melancolico: 'Melancólico',
  tranquilo: 'Tranquilo',
  energico: 'Enérgico',
  divertido: 'Divertido',
  valiente: 'Valiente'
};

export const STAGE_LABELS = {
  embarazo: 'Antes de que llegaras',
  bebe: 'Cuando eras bebé',
  'primeros-anios': 'Primeros años',
  ninez: 'Niñez',
  adolescencia: 'Adolescencia',
  siempre: 'Para siempre'
};

export const SPECIAL_DATE_LABELS = {
  'cumple-amelia': 'Cumple de Amelia',
  'cumple-mariana': 'Cumple de Mariana',
  'cumple-franco': 'Cumple de Franco',
  navidad: 'Navidad',
  'anio-nuevo': 'Año Nuevo',
  halloween: 'Halloween'
};

export const SEASON_LABELS = {
  verano: 'Verano',
  otono: 'Otoño',
  invierno: 'Invierno',
  primavera: 'Primavera'
};

export const SORT_LABELS = {
  az: 'A → Z',
  za: 'Z → A',
  'anio-asc': 'Más viejas primero',
  'anio-desc': 'Más nuevas primero',
  recientes: 'Agregadas hace poco'
};

export const TAG_LABELS = {
  // moodboard
  moda: 'Moda',
  comida: 'Comida',
  autos: 'Autos',
  observaciones: 'Observaciones',
  comparativas: 'Comparativas',
  // series
  video: 'Video',
  // música
  album: 'Álbum',
  cancion: 'Canción',
  // café
  grano: 'Café de especialidad',
  marca: 'Marca',
  preparacion: 'Preparación',
  cafeteria: 'Cafetería'
};

/** Etiquetas que se ofrecen al agregar algo en cada contenedor */
export const TAGS_BY_CONTAINER = {
  series: ['video'],
  musica: ['album', 'cancion'],
  cafe: ['grano', 'marca', 'preparacion', 'cafeteria'],
  moodboard: ['moda', 'comida', 'autos', 'observaciones', 'comparativas']
};

export const AUDIENCE_LABELS = {
  ATP: 'ATP',
  '+13': '+13',
  '+16': '+16',
  '+18': '+18'
};
