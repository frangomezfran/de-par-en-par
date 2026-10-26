/**
 * Utilidades de filtrado, ordenamiento y facetas para ítems.
 * Basado en las secciones §3 y §6 del contrato técnico.
 */

import {
  WEATHER_LABELS,
  DAYTIME_LABELS,
  MOOD_LABELS,
  STAGE_LABELS,
  SPECIAL_DATE_LABELS,
  TAG_LABELS
} from './labels.js';

export const FILTER_KEYS = [
  'sort',
  'genre',
  'decade',
  'weather',
  'daytime',
  'mood',
  'stage',
  'date',
  'tag',
  'q'
];

/**
 * Normaliza un texto quitando acentos/diacríticos y pasando a minúsculas.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return (str || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Parsea los parámetros de búsqueda devolviendo un objeto con cada clave de FILTER_KEYS.
 * Si una clave no está presente es null (sort tiene valor por defecto 'az').
 *
 * @param {URLSearchParams|string|Object} searchParams
 * @returns {Object}
 */
export function parseFilters(searchParams) {
  let params;
  if (searchParams instanceof URLSearchParams) {
    params = searchParams;
  } else if (typeof searchParams === 'string') {
    params = new URLSearchParams(searchParams);
  } else if (searchParams && typeof searchParams === 'object') {
    params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== null && v !== undefined && v !== '') {
        params.set(k, String(v));
      }
    }
  } else {
    params = new URLSearchParams();
  }

  const result = {};
  for (const key of FILTER_KEYS) {
    const val = params.get(key);
    if (key === 'sort') {
      result[key] = val && val.trim() !== '' ? val.trim() : 'az';
    } else {
      result[key] = val && val.trim() !== '' ? val.trim() : null;
    }
  }
  return result;
}

/**
 * Convierte un objeto de filtros a URLSearchParams omitiendo nulos, cadenas vacías y sort='az'.
 *
 * @param {Object} filters
 * @returns {URLSearchParams}
 */
export function toSearchParams(filters = {}) {
  const params = new URLSearchParams();
  if (!filters) return params;

  for (const key of FILTER_KEYS) {
    const val = filters[key];
    if (val === null || val === undefined || val === '') {
      continue;
    }
    if (key === 'sort' && val === 'az') {
      continue;
    }
    params.set(key, String(val));
  }

  return params;
}

/**
 * Aplica los filtros y el orden a una lista de ítems en memoria (puro).
 *
 * @param {Array} items
 * @param {Object} [filters]
 * @returns {Array} Nueva lista filtrada y ordenada.
 */
export function applyFilters(items = [], filters = {}) {
  if (!Array.isArray(items)) return [];

  const filtered = items.filter((item) => {
    if (!item) return false;

    // Filtro por género (item.genres es un array)
    if (filters.genre) {
      if (!Array.isArray(item.genres) || !item.genres.includes(filters.genre)) {
        return false;
      }
    }

    // Filtro por década (derivada de year, ej. "1990s", o item.decade)
    if (filters.decade) {
      const itemDecade = item.decade || (item.year ? `${Math.floor(item.year / 10) * 10}s` : null);
      if (itemDecade !== filters.decade) {
        return false;
      }
    }

    // Filtro por clima (item.weather es un array)
    if (filters.weather) {
      if (!Array.isArray(item.weather) || !item.weather.includes(filters.weather)) {
        return false;
      }
    }

    // Filtro por momento del día (un ítem con 'cualquiera' matchea 'diurno' y 'nocturno')
    if (filters.daytime && filters.daytime !== 'cualquiera') {
      if (item.daytime !== 'cualquiera' && item.daytime !== filters.daytime) {
        return false;
      }
    }

    // Filtro por estado de ánimo (item.moods es un array)
    if (filters.mood) {
      if (!Array.isArray(item.moods) || !item.moods.includes(filters.mood)) {
        return false;
      }
    }

    // Filtro por etapa de crecimiento (item.stages es un array)
    if (filters.stage) {
      if (!Array.isArray(item.stages) || !item.stages.includes(filters.stage)) {
        return false;
      }
    }

    // Filtro por fecha especial (item.specialDates es un array)
    if (filters.date) {
      if (!Array.isArray(item.specialDates) || !item.specialDates.includes(filters.date)) {
        return false;
      }
    }

    // Filtro por etiqueta (item.tags es un array)
    if (filters.tag) {
      if (!Array.isArray(item.tags) || !item.tags.includes(filters.tag)) {
        return false;
      }
    }

    // Búsqueda de texto libre q (insensible a mayúsculas y acentos sobre título, originalTitle, creators, cast, body, ownerNote)
    if (filters.q && String(filters.q).trim()) {
      const qNorm = normalize(String(filters.q).trim());
      const fields = [
        item.title,
        item.originalTitle,
        ...(Array.isArray(item.creators) ? item.creators : [item.creators]),
        ...(Array.isArray(item.cast) ? item.cast : [item.cast]),
        item.body,
        item.ownerNote
      ];
      const matches = fields.some(
        (field) => field != null && normalize(String(field)).includes(qNorm)
      );
      if (!matches) {
        return false;
      }
    }

    return true;
  });

  const sortMode = filters.sort || 'az';
  return filtered.sort((a, b) => {
    if (sortMode === 'za') {
      return (b.title || '').localeCompare(a.title || '', 'es', { sensitivity: 'base' });
    }
    if (sortMode === 'anio-asc') {
      if (a.year == null && b.year == null) return 0;
      if (a.year == null) return 1;
      if (b.year == null) return -1;
      return a.year - b.year;
    }
    if (sortMode === 'anio-desc') {
      if (a.year == null && b.year == null) return 0;
      if (a.year == null) return 1;
      if (b.year == null) return -1;
      return b.year - a.year;
    }
    if (sortMode === 'recientes') {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    }
    // Default 'az'
    return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
  });
}

/**
 * Calcula las opciones de facetas disponibles a partir de una lista de ítems.
 * Solo incluye valores presentes. Décadas ordenadas cronológicamente; las demás por conteo descendente y luego etiqueta.
 *
 * @param {Array} items
 * @returns {Object} { genre, decade, weather, daytime, mood, stage, date, tag }
 */
export function facetOptions(items = []) {
  const counts = {
    genre: new Map(),
    decade: new Map(),
    weather: new Map(),
    daytime: new Map(),
    mood: new Map(),
    stage: new Map(),
    date: new Map(),
    tag: new Map()
  };

  const add = (map, val) => {
    if (val != null && val !== '') {
      map.set(val, (map.get(val) || 0) + 1);
    }
  };

  const addMany = (map, arr) => {
    if (Array.isArray(arr)) {
      for (const item of arr) add(map, item);
    } else if (arr != null && arr !== '') {
      add(map, arr);
    }
  };

  for (const item of items) {
    if (!item) continue;
    addMany(counts.genre, item.genres);
    const decade = item.decade || (item.year ? `${Math.floor(item.year / 10) * 10}s` : null);
    add(counts.decade, decade);
    addMany(counts.weather, item.weather);
    add(counts.daytime, item.daytime);
    addMany(counts.mood, item.moods);
    addMany(counts.stage, item.stages);
    addMany(counts.date, item.specialDates);
    addMany(counts.tag, item.tags);
  }

  const buildFacet = (map, labelMap = null) => {
    const list = [];
    for (const [value, count] of map.entries()) {
      const label = labelMap && labelMap[value] ? labelMap[value] : String(value);
      list.push({ value, label, count });
    }
    list.sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });
    });
    return list;
  };

  // Décadas ordenadas cronológicamente
  const decadeList = [];
  for (const [value, count] of counts.decade.entries()) {
    decadeList.push({ value, label: String(value), count });
  }
  decadeList.sort((a, b) => {
    const numA = parseInt(a.value, 10);
    const numB = parseInt(b.value, 10);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return a.value.localeCompare(b.value, 'es', { sensitivity: 'base' });
  });

  return {
    genre: buildFacet(counts.genre),
    decade: decadeList,
    weather: buildFacet(counts.weather, WEATHER_LABELS),
    daytime: buildFacet(counts.daytime, DAYTIME_LABELS),
    mood: buildFacet(counts.mood, MOOD_LABELS),
    stage: buildFacet(counts.stage, STAGE_LABELS),
    date: buildFacet(counts.date, SPECIAL_DATE_LABELS),
    tag: buildFacet(counts.tag, TAG_LABELS)
  };
}

/**
 * Devuelve el número de filtros activos (sin contar sort).
 *
 * @param {Object} filters
 * @returns {number}
 */
export function activeFilterCount(filters = {}) {
  if (!filters) return 0;
  return FILTER_KEYS.filter((key) => {
    if (key === 'sort') return false;
    const val = filters[key];
    return val !== null && val !== undefined && val !== '';
  }).length;
}
