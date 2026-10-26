import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FILTER_KEYS,
  parseFilters,
  toSearchParams,
  applyFilters,
  facetOptions,
  activeFilterCount
} from '../filters.js';

test('parseFilters: devuelve todas las claves con sort=az por defecto', () => {
  const result = parseFilters('');
  for (const key of FILTER_KEYS) {
    assert.ok(key in result, `La clave ${key} debe estar presente en parseFilters`);
  }
  assert.equal(result.sort, 'az');
  assert.equal(result.genre, null);
  assert.equal(result.decade, null);
  assert.equal(result.weather, null);
  assert.equal(result.daytime, null);
  assert.equal(result.mood, null);
  assert.equal(result.stage, null);
  assert.equal(result.date, null);
  assert.equal(result.tag, null);
  assert.equal(result.q, null);
});

test('parseFilters y toSearchParams: roundtrip con filtros activos', () => {
  const initial = {
    sort: 'za',
    genre: 'rock',
    decade: '1990s',
    weather: 'lluvioso',
    daytime: 'nocturno',
    mood: 'melancolico',
    stage: 'adolescencia',
    date: 'halloween',
    tag: 'musica',
    q: 'charly garcia'
  };

  const searchParams = toSearchParams(initial);
  const parsed = parseFilters(searchParams);

  assert.deepEqual(parsed, initial);
});

test('toSearchParams: omite nulos, vacíos y sort=az', () => {
  const filters = {
    sort: 'az',
    genre: 'drama',
    decade: null,
    weather: '',
    mood: undefined
  };

  const params = toSearchParams(filters);
  assert.equal(params.get('sort'), null);
  assert.equal(params.get('genre'), 'drama');
  assert.equal(params.get('decade'), null);
  assert.equal(params.get('weather'), null);
  assert.equal(params.get('mood'), null);
});

test('activeFilterCount: cuenta filtros sin incluir sort', () => {
  assert.equal(activeFilterCount({ sort: 'za' }), 0);
  assert.equal(activeFilterCount({ sort: 'az', genre: 'rock', mood: 'alegre' }), 2);
  assert.equal(activeFilterCount({ genre: '', decade: null }), 0);
  assert.equal(activeFilterCount({ q: 'nemo', sort: 'anio-desc' }), 1);
});

test('applyFilters: dimensiones individuales (genre, decade, weather, mood, stage, date, tag)', () => {
  const sampleItems = [
    {
      id: '1',
      title: 'Toy Story',
      year: 1995,
      genres: ['animacion', 'aventura'],
      weather: ['soleado'],
      daytime: 'diurno',
      moods: ['divertido', 'alegre'],
      stages: ['primeros-anios'],
      specialDates: ['cumple-amelia'],
      tags: ['cine']
    },
    {
      id: '2',
      title: 'El Padrino',
      year: 1972,
      genres: ['drama', 'crimen'],
      weather: ['lluvioso'],
      daytime: 'nocturno',
      moods: ['nostalgico'],
      stages: ['adolescencia'],
      specialDates: ['halloween'],
      tags: ['clasico']
    }
  ];

  assert.equal(applyFilters(sampleItems, { genre: 'animacion' }).length, 1);
  assert.equal(applyFilters(sampleItems, { genre: 'animacion' })[0].id, '1');

  assert.equal(applyFilters(sampleItems, { decade: '1990s' }).length, 1);
  assert.equal(applyFilters(sampleItems, { decade: '1990s' })[0].id, '1');
  assert.equal(applyFilters(sampleItems, { decade: '1970s' })[0].id, '2');

  assert.equal(applyFilters(sampleItems, { weather: 'lluvioso' }).length, 1);
  assert.equal(applyFilters(sampleItems, { weather: 'lluvioso' })[0].id, '2');

  assert.equal(applyFilters(sampleItems, { mood: 'nostalgico' }).length, 1);
  assert.equal(applyFilters(sampleItems, { mood: 'nostalgico' })[0].id, '2');

  assert.equal(applyFilters(sampleItems, { stage: 'primeros-anios' }).length, 1);
  assert.equal(applyFilters(sampleItems, { stage: 'primeros-anios' })[0].id, '1');

  assert.equal(applyFilters(sampleItems, { date: 'cumple-amelia' }).length, 1);
  assert.equal(applyFilters(sampleItems, { date: 'cumple-amelia' })[0].id, '1');

  assert.equal(applyFilters(sampleItems, { tag: 'clasico' }).length, 1);
  assert.equal(applyFilters(sampleItems, { tag: 'clasico' })[0].id, '2');
});

test("applyFilters: regla daytime 'cualquiera'", () => {
  const items = [
    { id: '1', title: 'Sol', daytime: 'diurno' },
    { id: '2', title: 'Luna', daytime: 'nocturno' },
    { id: '3', title: 'Siempre', daytime: 'cualquiera' }
  ];

  // Filtro diurno debe devolver 'diurno' y 'cualquiera'
  const diurnoResult = applyFilters(items, { daytime: 'diurno' });
  assert.equal(diurnoResult.length, 2);
  assert.deepEqual(diurnoResult.map(i => i.id).sort(), ['1', '3']);

  // Filtro nocturno debe devolver 'nocturno' y 'cualquiera'
  const nocturnoResult = applyFilters(items, { daytime: 'nocturno' });
  assert.equal(nocturnoResult.length, 2);
  assert.deepEqual(nocturnoResult.map(i => i.id).sort(), ['2', '3']);

  // Filtro cualquiera debe devolver todos los ítems
  const cualquieraResult = applyFilters(items, { daytime: 'cualquiera' });
  assert.equal(cualquieraResult.length, 3);
});

test('applyFilters: búsqueda q case/diacritics-insensitive en todos los campos', () => {
  const items = [
    {
      id: '1',
      title: 'Canción Animal',
      originalTitle: 'Cancion Animal',
      creators: ['Gustavo Cerati'],
      cast: ['Zeta Bosio', 'Charly Alberti'],
      body: 'Un clásico de Soda',
      ownerNote: 'Lo escuchábamos en el auto.'
    },
    {
      id: '2',
      title: 'Rayuela',
      originalTitle: 'Hopscotch',
      creators: ['Julio Cortázar'],
      cast: [],
      body: 'Novela experimental',
      ownerNote: 'Para cuando seas más grande.'
    }
  ];

  // Búsqueda sin tilde encuentra texto con tilde
  assert.equal(applyFilters(items, { q: 'cancion' }).length, 1);
  assert.equal(applyFilters(items, { q: 'cancion' })[0].id, '1');

  // Búsqueda con tilde encuentra texto sin tilde
  assert.equal(applyFilters(items, { q: 'CORTÁZAR' }).length, 1);
  assert.equal(applyFilters(items, { q: 'CORTÁZAR' })[0].id, '2');

  // Búsqueda en creadores
  assert.equal(applyFilters(items, { q: 'cerati' })[0].id, '1');

  // Búsqueda en elenco
  assert.equal(applyFilters(items, { q: 'alberti' })[0].id, '1');

  // Búsqueda en ownerNote
  assert.equal(applyFilters(items, { q: 'auto' })[0].id, '1');

  // Búsqueda en body
  assert.equal(applyFilters(items, { q: 'novela' })[0].id, '2');
});

test('applyFilters: ordenamientos az, za, anio-asc, anio-desc, recientes con años nulos al final', () => {
  const items = [
    { id: 'b', title: 'Bicicleta', year: 2010, createdAt: '2026-01-01T10:00:00Z' },
    { id: 'a', title: 'Árbol', year: null, createdAt: '2026-01-03T10:00:00Z' },
    { id: 'c', title: 'Casa', year: 1990, createdAt: '2026-01-02T10:00:00Z' }
  ];

  // az (español base: Árbol -> Bicicleta -> Casa)
  const az = applyFilters(items, { sort: 'az' });
  assert.deepEqual(az.map(i => i.id), ['a', 'b', 'c']);

  // za
  const za = applyFilters(items, { sort: 'za' });
  assert.deepEqual(za.map(i => i.id), ['c', 'b', 'a']);

  // anio-asc: 1990 (c), 2010 (b), null (a)
  const anioAsc = applyFilters(items, { sort: 'anio-asc' });
  assert.deepEqual(anioAsc.map(i => i.id), ['c', 'b', 'a']);

  // anio-desc: 2010 (b), 1990 (c), null (a)
  const anioDesc = applyFilters(items, { sort: 'anio-desc' });
  assert.deepEqual(anioDesc.map(i => i.id), ['b', 'c', 'a']);

  // recientes: 2026-01-03 (a), 2026-01-02 (c), 2026-01-01 (b)
  const recientes = applyFilters(items, { sort: 'recientes' });
  assert.deepEqual(recientes.map(i => i.id), ['a', 'c', 'b']);
});

test('facetOptions: conteos, solo valores presentes, décadas cronológicas y otros por count desc', () => {
  const items = [
    {
      id: '1',
      genres: ['rock', 'pop'],
      year: 2005,
      weather: ['soleado'],
      daytime: 'diurno',
      moods: ['alegre']
    },
    {
      id: '2',
      genres: ['rock'],
      year: 1995,
      weather: ['soleado', 'nublado'],
      daytime: 'diurno',
      moods: ['alegre']
    },
    {
      id: '3',
      genres: ['jazz'],
      year: 1980,
      weather: ['nublado'],
      daytime: 'nocturno',
      moods: ['melancolico']
    }
  ];

  const facets = facetOptions(items);

  // Género: rock (2), jazz (1), pop (1) - ordenados por count desc, luego label asc
  assert.equal(facets.genre[0].value, 'rock');
  assert.equal(facets.genre[0].count, 2);
  assert.equal(facets.genre[1].value, 'jazz');
  assert.equal(facets.genre[1].count, 1);
  assert.equal(facets.genre[2].value, 'pop');
  assert.equal(facets.genre[2].count, 1);

  // Décadas: 1980s, 1990s, 2000s ordenadas cronológicamente
  assert.deepEqual(facets.decade.map(d => d.value), ['1980s', '1990s', '2000s']);

  // Clima: soleado (2), nublado (2) con etiquetas de labels.js
  assert.equal(facets.weather[0].label, 'Nublado');
  assert.equal(facets.weather[1].label, 'Soleado');
  assert.equal(facets.weather[0].count, 2);
  assert.equal(facets.weather[1].count, 2);
});
