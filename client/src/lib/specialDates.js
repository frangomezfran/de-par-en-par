/**
 * Cálculo de fechas especiales, cumpleaños y estaciones del año (hemisferio sur).
 * Basado en las secciones §3 y §6 del contrato técnico.
 */

// Cumpleaños de la familia ('MM-DD')
export const FAMILY_BIRTHDAYS = {
  amelia: '06-16',
  mariana: '04-11',
  franco: '08-22'
};

/**
 * Mapeo de miembros familiares a su slug canónico de fecha especial.
 */
const BIRTHDAY_SLUGS = {
  amelia: 'cumple-amelia',
  mariana: 'cumple-mariana',
  franco: 'cumple-franco'
};

/**
 * Determina si una fecha está dentro de una ventana de días (±windowDays) de una fecha de cumpleaños ('MM-DD').
 * Soporta cambio de año (wrap-around).
 *
 * @param {Date} targetDate
 * @param {string} mmdd - Formato 'MM-DD'
 * @param {number} [windowDays=3]
 * @returns {boolean}
 */
function isWithinBirthdayWindow(targetDate, mmdd, windowDays = 3) {
  if (!mmdd || typeof mmdd !== 'string') return false;
  const parts = mmdd.split('-');
  if (parts.length !== 2) return false;

  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  if (isNaN(month) || isNaN(day)) return false;

  const currentYear = targetDate.getFullYear();
  const candidateYears = [currentYear - 1, currentYear, currentYear + 1];

  const targetMidnight = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate()
  ).getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const year of candidateYears) {
    const bdayMidnight = new Date(year, month, day).getTime();
    const diffDays = Math.round(Math.abs(targetMidnight - bdayMidnight) / ONE_DAY_MS);
    if (diffDays <= windowDays) {
      return true;
    }
  }

  return false;
}

/**
 * Devuelve los slugs de las fechas especiales activas para una fecha dada:
 * - Cumpleaños de la familia: ±3 días (si están configurados).
 * - Halloween: 25 al 31 de octubre.
 * - Navidad: 20 al 26 de diciembre.
 * - Año Nuevo: 28 de diciembre al 2 de enero (incluye cambio de año).
 *
 * @param {Date|string|number} [date=new Date()]
 * @returns {string[]} Lista de slugs activos.
 */
export function getActiveSpecialDates(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return [];

  const active = [];
  const month = d.getMonth() + 1; // 1 - 12
  const day = d.getDate();

  // 1. Cumpleaños familiares (omite los placeholders nulos)
  for (const [member, mmdd] of Object.entries(FAMILY_BIRTHDAYS)) {
    if (mmdd && isWithinBirthdayWindow(d, mmdd, 3)) {
      const slug = BIRTHDAY_SLUGS[member] || `cumple-${member}`;
      active.push(slug);
    }
  }

  // 2. Halloween: 25–31/10
  if (month === 10 && day >= 25 && day <= 31) {
    active.push('halloween');
  }

  // 3. Navidad: 20–26/12
  if (month === 12 && day >= 20 && day <= 26) {
    active.push('navidad');
  }

  // 4. Año Nuevo: 28/12–02/01 (cruza fin de año)
  if ((month === 12 && day >= 28) || (month === 1 && day <= 2)) {
    active.push('anio-nuevo');
  }

  return active;
}

/**
 * Determina la estación del año correspondiente para el hemisferio sur:
 * - Verano: 21 de diciembre al 20 de marzo.
 * - Otoño: 21 de marzo al 20 de junio.
 * - Invierno: 21 de junio al 20 de septiembre.
 * - Primavera: 21 de septiembre al 20 de diciembre.
 *
 * @param {Date|string|number} [date=new Date()]
 * @returns {'verano'|'otono'|'invierno'|'primavera'}
 */
export function getSeason(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const month = d.getMonth() + 1;
  const day = d.getDate();

  if ((month === 12 && day >= 21) || month === 1 || month === 2 || (month === 3 && day <= 20)) {
    return 'verano';
  }
  if ((month === 3 && day >= 21) || month === 4 || month === 5 || (month === 6 && day <= 20)) {
    return 'otono';
  }
  if ((month === 6 && day >= 21) || month === 7 || month === 8 || (month === 9 && day <= 20)) {
    return 'invierno';
  }
  return 'primavera';
}

/**
 * Devuelve el contexto actual consolidado (clima, momento del día, estación y fechas especiales).
 *
 * @param {Object} [weather]
 * @returns {{ weather: string|null, daytime: 'diurno'|'nocturno', season: string, specialDates: string[] }}
 */
export function currentContext(weather) {
  let daytime;
  if (weather && typeof weather.isDay === 'boolean') {
    daytime = weather.isDay ? 'diurno' : 'nocturno';
  } else {
    const hour = new Date().getHours();
    daytime = hour >= 7 && hour < 20 ? 'diurno' : 'nocturno';
  }

  return {
    weather: weather?.condition ?? null,
    daytime,
    season: getSeason(),
    specialDates: getActiveSpecialDates()
  };
}

/** Si hay varias festividades a la vez, la ventana muestra la más importante */
const FESTIVITY_PRIORITY = ['cumple-amelia', 'navidad', 'anio-nuevo', 'cumple-mariana', 'cumple-franco', 'halloween'];

/**
 * Festividad que "se ve" por la ventana hoy (o null).
 * Para probar: ?fiesta=halloween | navidad | anio-nuevo | cumple-amelia | cumple-mariana | cumple-franco
 *
 * @param {Date} [date=new Date()]
 * @returns {string|null}
 */
export function currentFestivity(date = new Date()) {
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('fiesta');
    if (forced && FESTIVITY_PRIORITY.includes(forced)) return forced;
    if (forced === 'ninguna') return null;
  }
  const active = getActiveSpecialDates(date);
  return FESTIVITY_PRIORITY.find((slug) => active.includes(slug)) ?? null;
}
