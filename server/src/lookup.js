/**
 * Asistente de búsqueda para el alta de ítems.
 * Fuentes públicas sin API key:
 *   - iTunes Search (música)
 *   - Wikipedia en inglés (películas: afiche + dirección)
 *   - TVmaze (series)
 *   - Open Library (libros)
 *   - Wikipedia (juegos, flores, actividades, café)
 *   - OpenStreetMap / Nominatim (cafeterías)
 *   - Open Food Facts (marcas de café, con foto del paquete)
 *   - Catálogo propio de cafés de especialidad y preparaciones
 *
 * Todas devuelven sugerencias con la misma forma:
 * { source, kind, title, originalTitle, year, creators[], cast[], genres[], cover, description, place, url, tags[] }
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'Deparenpar/2.0 (https://deparenpar.com.ar; proyecto familiar)';
const TIMEOUT = 8000;

/** Hosts de los que el servidor acepta descargar portadas (evita SSRF) */
export const COVER_HOSTS = [
  /(^|\.)mzstatic\.com$/,
  /^covers\.openlibrary\.org$/,
  /(^|\.)archive\.org$/,
  /^static\.tvmaze\.com$/,
  /^upload\.wikimedia\.org$/,
  /^images\.openfoodfacts\.org$/,
];

export function isAllowedCoverUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && COVER_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const year = (s) => {
  const m = String(s ?? '').match(/\b(1[89]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
};
const stripHtml = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 400) => (s && s.length > n ? `${s.slice(0, s.lastIndexOf(' ', n))}…` : s || '');

const GENRES_ES = {
  action: 'acción', adventure: 'aventura', animation: 'animación', anime: 'anime', biography: 'biografía',
  children: 'infantil', "children's music": 'música infantil', comedy: 'comedia', crime: 'policial',
  documentary: 'documental', drama: 'drama', family: 'familiar', fantasy: 'fantasía', history: 'histórica',
  horror: 'terror', legal: 'judicial', medical: 'médica', music: 'música', musical: 'musical', mystery: 'misterio',
  romance: 'romance', 'science-fiction': 'ciencia ficción', 'science fiction': 'ciencia ficción', 'sci-fi': 'ciencia ficción',
  sports: 'deportes', supernatural: 'sobrenatural', thriller: 'suspenso', war: 'bélica', western: 'western',
  espionage: 'espionaje', food: 'cocina', travel: 'viajes', nature: 'naturaleza', 'reality': 'reality',
  rock: 'rock', pop: 'pop', alternative: 'alternativa', electronic: 'electrónica', dance: 'dance', 'hip-hop/rap': 'hip hop',
  'hip-hop': 'hip hop', rap: 'rap', jazz: 'jazz', classical: 'clásica', soundtrack: 'banda sonora', latino: 'latina',
  latin: 'latina', 'pop latino': 'pop latino', 'rock y alternativo': 'rock alternativo', metal: 'metal', 'hard rock': 'hard rock',
  country: 'country', 'r&b/soul': 'R&B', blues: 'blues', reggae: 'reggae', folk: 'folk', 'singer/songwriter': 'cantautor',
  fiction: 'ficción', 'juvenile fiction': 'juvenil', poetry: 'poesía', 'short stories': 'cuentos', comics: 'historieta',
  'graphic novels': 'novela gráfica', 'fairy tales': 'cuentos de hadas', 'love stories': 'romance',
};

/** "Science-Fiction" -> "ciencia ficción"; "película de comedia" -> "comedia" */
export function genreEs(g) {
  if (!g) return null;
  const clean = String(g)
    .trim()
    .replace(/^(película|cine|serie|género|videojuego|novela|música|álbum) (de |del )?/i, '')
    .replace(/^juego de /i, '');
  return GENRES_ES[clean.toLowerCase()] ?? clean.charAt(0).toLowerCase() + clean.slice(1);
}

const genresEs = (list, max = 4) => [...new Set((list ?? []).map(genreEs).filter(Boolean))].slice(0, max);

function base(partial) {
  return {
    source: '',
    kind: '',
    title: '',
    originalTitle: null,
    year: null,
    creators: [],
    cast: [],
    genres: [],
    cover: null,
    description: '',
    place: null,
    url: null,
    tags: [],
    ...partial,
  };
}

// ---------- Música (Wikipedia + Wikidata: canciones y álbumes) ----------

const MUSIC_RE =
  /\b(song|single|track|ballad|instrumental|composition|album|ep|lp|soundtrack|record|canción|cancion|sencillo|tema musical|balada|álbum|disco|banda sonora|grabación)\b/i;

const ALBUM_QIDS = new Set(['Q482994', 'Q208569', 'Q209939', 'Q222910', 'Q169930', 'Q24672048']);
const SONG_QIDS = new Set(['Q7366', 'Q134556', 'Q105543609', 'Q2188189', 'Q207628']);

function guessArtistFromText(desc = '') {
  const en = desc.match(
    /\b(?:song|single|track|ballad|album|ep|record) by (?:the [a-z -]+? (?:band|group|duo) )?([A-Z0-9][\p{L}\p{N}.'& -]{1,45}?)(?:[,.;()]| from | released | recorded | written |$)/iu,
  );
  if (en) return [en[1].trim()];
  const es = desc.match(
    /\b(?:canción|sencillo|balada|tema|álbum|disco)(?: [a-záéíóúñ]+){0,3} (?:de (?:la banda|el grupo|el dúo|el músico|la cantante|el cantante) [a-záéíóúñ ]+? |de )([A-ZÁÉÍÓÚÑ0-9][\p{L}\p{N}.'& -]{1,45}?)(?:[,.;()]| incluido| lanzado| publicado| grabado| del álbum|$)/u,
  );
  return es ? [es[1].trim()] : [];
}

async function music(q) {
  const [esSongs, enSongs, esAlbums, enAlbums] = await Promise.allSettled([
    wiki(q, { lang: 'es', suffix: 'canción', kind: 'canción', limit: 5 }),
    wiki(q, { lang: 'en', suffix: 'song', kind: 'canción', limit: 6 }),
    wiki(q, { lang: 'es', suffix: 'álbum', kind: 'álbum', limit: 4 }),
    wiki(q, { lang: 'en', suffix: 'album', kind: 'álbum', limit: 4 }),
  ]);

  const raw = [
    ...(esSongs.value ?? []),
    ...(enSongs.value ?? []),
    ...(esAlbums.value ?? []),
    ...(enAlbums.value ?? []),
  ].filter(
    (r) =>
      MUSIC_RE.test(r.description) &&
      !/desambiguaci|disambiguation|puede referirse|may refer to/i.test(`${r.url} ${r.description}`),
  );

  // Unificar artículos repetidos entre Wikipedia en español e inglés (mismo QID)
  const byQid = new Map();
  const merged = [];
  for (const r of raw) {
    const item = {
      ...r,
      creators: guessArtistFromText(r.description),
      tags: [r.kind === 'álbum' ? 'album' : 'cancion'],
    };
    if (item.qid && byQid.has(item.qid)) {
      const prev = byQid.get(item.qid);
      if (!prev.cover && item.cover) prev.cover = item.cover;
      if (!prev.year && item.year) prev.year = item.year;
      if (!prev.creators.length && item.creators.length) prev.creators = item.creators;
      continue;
    }
    if (item.qid) byQid.set(item.qid, item);
    merged.push(item);
  }

  try {
    return await enrichWithWikidata(merged, { creators: ['P175', 'P86'], genres: 'P136' });
  } catch {
    return merged;
  }
}

// ---------- Wikidata: elenco, dirección y géneros en español ----------

const WIKIDATA = 'https://www.wikidata.org/w/api.php';

async function wikidataEntities(ids, props) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: ids.slice(i, i + 50).join('|'),
      props,
      languages: 'es|en',
      origin: '*',
    });
    Object.assign(out, (await getJson(`${WIKIDATA}?${params}`)).entities ?? {});
  }
  return out;
}

const label = (e) => e?.labels?.es?.value ?? e?.labels?.en?.value ?? null;

/**
 * Completa resultados de Wikipedia con datos de Wikidata.
 * spec: { creators: 'P57', cast: 'P161', genres: 'P136' }  (propiedad por campo)
 * También usa el título en español (etiqueta de Wikidata) si existe.
 */
async function enrichWithWikidata(results, spec, limits = { creators: 3, cast: 8, genres: 4 }) {
  const qids = results.map((r) => r.qid).filter(Boolean);
  if (!qids.length) return results;
  const entities = await wikidataEntities(qids, 'claims|labels');
  const refs = new Set();
  const picks = {};
  for (const q of qids) {
    const claims = entities[q]?.claims ?? {};
    picks[q] = {};
    for (const [field, props] of Object.entries(spec)) {
      // la primera propiedad con datos (ej. elenco: actores P161 o voces P725)
      const prop = [].concat(props).find((pp) => claims[pp]?.length) ?? [].concat(props)[0];
      const ids = (claims[prop] ?? [])
        .map((c) => c.mainsnak?.datavalue?.value?.id)
        .filter(Boolean)
        .slice(0, limits[field] ?? 4);
      picks[q][field] = ids;
      ids.forEach((id) => refs.add(id));
    }
  }
  const labels = refs.size ? await wikidataEntities([...refs], 'labels') : {};
  return results.map((r) => {
    if (!r.qid || !entities[r.qid]) return r;
    const out = { ...r };
    const claims = entities[r.qid].claims ?? {};
    const es = entities[r.qid].labels?.es?.value?.replace(/\s*\([^)]*\)$/, '');
    if (es) {
      out.originalTitle = r.title;
      out.title = es;
    }
    if (!out.year) {
      const pubTime = claims.P577?.[0]?.mainsnak?.datavalue?.value?.time;
      if (pubTime) out.year = year(pubTime);
    }
    if (r.kind === 'canción' || r.kind === 'álbum') {
      const types = (claims.P31 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
      if (types.some((t) => ALBUM_QIDS.has(t))) {
        out.kind = 'álbum';
        out.tags = ['album'];
      } else if (types.some((t) => SONG_QIDS.has(t))) {
        out.kind = 'canción';
        out.tags = ['cancion'];
      }
    }
    for (const field of Object.keys(spec)) {
      // géneros: solo los que tienen nombre en español (los demás suelen ser jerga en inglés)
      const names = picks[r.qid][field]
        .map((id) => (field === 'genres' ? labels[id]?.labels?.es?.value?.replace(/ en el cine$/, '') : label(labels[id])))
        .filter(Boolean);
      if (names.length) out[field] = field === 'genres' ? genresEs(names) : names;
    }
    return out;
  });
}

// ---------- Películas (Wikipedia + Wikidata) ----------
// (la búsqueda de películas de iTunes dejó de devolver resultados)

async function movies(q) {
  const list = (await wiki(q, { lang: 'en', suffix: 'film', kind: 'película' })).filter(
    (m) => /film/i.test(m.description) || /film/i.test(m.originalTitle),
  );
  const withDirector = list.map((m) => {
    const dir = m.description.match(/directed by ([A-Z][\p{L}.' -]+?)(?:,| and | from | with |\.|$)/u);
    return { ...m, creators: dir ? [dir[1].trim()] : [] };
  });
  try {
    return await enrichWithWikidata(withDirector, { creators: 'P57', cast: ['P161', 'P725'], genres: 'P136' });
  } catch {
    return withDirector;
  }
}

// ---------- Series (TVmaze: géneros, creadores y elenco) ----------

async function shows(q) {
  const list = (await getJson(`https://api.tvmaze.com/search/shows?${new URLSearchParams({ q })}`)).slice(0, 6);
  const details = await Promise.allSettled(
    list.map(({ show }) => getJson(`https://api.tvmaze.com/shows/${show.id}?embed[]=cast&embed[]=crew`)),
  );
  return list.map(({ show }, i) => {
    const emb = details[i].value?._embedded ?? {};
    const creators = [...new Set((emb.crew ?? []).filter((c) => /creator/i.test(c.type)).map((c) => c.person?.name))].filter(Boolean);
    const cast = (emb.cast ?? []).slice(0, 8).map((c) => c.person?.name).filter(Boolean);
    return base({
      source: 'TVmaze',
      kind: 'serie',
      title: show.name,
      originalTitle: show.name,
      year: year(show.premiered),
      creators: creators.slice(0, 3),
      cast,
      genres: genresEs(show.genres),
      cover: show.image?.original ?? show.image?.medium ?? null,
      description: clip(stripHtml(show.summary)),
      url: show.url,
    });
  });
}

// ---------- Libros (Open Library) ----------

async function books(q) {
  const data = await getJson(
    `https://openlibrary.org/search.json?${new URLSearchParams({ q, limit: '8', fields: 'key,title,author_name,first_publish_year,cover_i,subject' })}`,
  );
  return (data.docs ?? []).map((d) =>
    base({
      source: 'Open Library',
      kind: 'libro',
      title: d.title,
      originalTitle: d.title,
      year: d.first_publish_year ?? null,
      creators: (d.author_name ?? []).slice(0, 3),
      // los temas de Open Library son muy ruidosos: solo los géneros conocidos
      genres: genresEs((d.subject ?? []).filter((x) => GENRES_ES[x.toLowerCase()]), 3),
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
      url: d.key ? `https://openlibrary.org${d.key}` : null,
    }),
  );
}

// ---------- Wikipedia ----------

async function wiki(q, { lang = 'es', suffix = '', kind = '', limit = 6 } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${q} ${suffix}`.trim(),
    gsrlimit: String(limit),
    prop: 'pageimages|description|extracts|pageprops',
    ppprop: 'wikibase_item',
    piprop: 'thumbnail',
    pithumbsize: '800',
    pilicense: 'any',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    redirects: '1',
    origin: '*',
  });
  const data = await getJson(`https://${lang}.wikipedia.org/w/api.php?${params}`);
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map((p) =>
    base({
      source: `Wikipedia (${lang})`,
      kind,
      title: p.title.replace(/\s*\([^)]*\)$/, ''),
      originalTitle: p.title.replace(/\s*\([^)]*\)$/, ''),
      year: year(p.description) ?? year(p.extract),
      cover: p.thumbnail?.source ? p.thumbnail.source.split('?')[0] : null,
      description: clip(p.extract || p.description || ''),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      qid: p.pageprops?.wikibase_item ?? null,
    }),
  );
}

async function games(q) {
  const [en, es] = await Promise.allSettled([
    wiki(q, { lang: 'en', suffix: 'video game', kind: 'juego' }),
    wiki(q, { lang: 'es', suffix: 'videojuego', kind: 'juego', limit: 3 }),
  ]);
  const list = [...(en.value ?? []), ...(es.value ?? [])];
  try {
    // desarrolladora y géneros
    return await enrichWithWikidata(list, { creators: 'P178', genres: 'P136' });
  } catch {
    return list;
  }
}

// ---------- Café ----------

/** Cafés de especialidad (origen) y preparaciones: datos generales, sin inventar marcas */
const COFFEE_CATALOG = [
  ['Geisha', 'Panamá (Boquete)', 'origen', 'Variedad muy floral, con notas de jazmín y bergamota.'],
  ['Yirgacheffe', 'Etiopía', 'origen', 'Lavado, cítrico y floral; clásico de los cafés etíopes.'],
  ['Sidamo', 'Etiopía', 'origen', 'Dulce, con notas a frutos rojos y cacao.'],
  ['Kenya AA', 'Kenia', 'origen', 'Acidez brillante, notas a grosella y pomelo.'],
  ['Huila', 'Colombia', 'origen', 'Equilibrado, dulce, con notas a caramelo y frutas.'],
  ['Antigua', 'Guatemala', 'origen', 'Cuerpo medio, chocolate y especias.'],
  ['Tarrazú', 'Costa Rica', 'origen', 'Limpio y brillante, notas a miel y cítricos.'],
  ['Blue Mountain', 'Jamaica', 'origen', 'Suave y equilibrado, de altura.'],
  ['Kona', 'Hawái', 'origen', 'Suave, cuerpo medio, notas a nuez.'],
  ['Mandheling', 'Sumatra (Indonesia)', 'origen', 'Cuerpo alto, terroso y especiado.'],
  ['Cerrado Mineiro', 'Brasil', 'origen', 'Dulce, nuez y chocolate; base de muchos blends.'],
  ['Cajamarca', 'Perú', 'origen', 'Suave, notas a panela y frutos secos.'],
  ['Espresso', null, 'preparacion', 'Extracción corta a presión, base de casi todo.'],
  ['Ristretto', null, 'preparacion', 'Espresso más corto y concentrado.'],
  ['Cortado', null, 'preparacion', 'Espresso con un poquito de leche.'],
  ['Lágrima', null, 'preparacion', 'Leche caliente con apenas unas gotas de café.'],
  ['Café con leche', null, 'preparacion', 'Mitad café, mitad leche: el de la merienda.'],
  ['Capuchino', null, 'preparacion', 'Espresso, leche y mucha espuma.'],
  ['Flat white', null, 'preparacion', 'Doble espresso con leche texturizada fina.'],
  ['Latte', null, 'preparacion', 'Espresso con bastante leche y poca espuma.'],
  ['Macchiato', null, 'preparacion', 'Espresso "manchado" con espuma de leche.'],
  ['V60', null, 'preparacion', 'Filtrado manual en cono; resalta lo floral.'],
  ['Chemex', null, 'preparacion', 'Filtrado con papel grueso; taza muy limpia.'],
  ['Prensa francesa', null, 'preparacion', 'Inmersión; más cuerpo y aceites.'],
  ['AeroPress', null, 'preparacion', 'Inmersión con presión; versátil y rápido.'],
  ['Moka (cafetera italiana)', null, 'preparacion', 'El de la cocina de casa, intenso.'],
  ['Cold brew', null, 'preparacion', 'Extracción en frío durante horas; dulce y suave.'],
];

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function coffeeCatalog(q) {
  const n = norm(q);
  return COFFEE_CATALOG.filter(([name, origin]) => norm(name).includes(n) || norm(origin).includes(n)).map(
    ([name, origin, type, description]) =>
      base({
        source: 'Catálogo de café',
        kind: type === 'origen' ? 'café de especialidad' : 'preparación',
        title: name,
        originalTitle: name,
        place: origin,
        description,
        tags: [type === 'origen' ? 'grano' : 'preparacion'],
      }),
  );
}

async function coffeeShops(q) {
  const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '8', 'accept-language': 'es' });
  const list = await getJson(`https://nominatim.openstreetmap.org/search?${params}`);
  return list
    .filter((p) => ['cafe', 'coffee_shop', 'restaurant', 'bakery'].includes(p.type) || p.category === 'amenity' || p.category === 'shop')
    .slice(0, 6)
    .map((p) => {
      const a = p.address ?? {};
      const city = a.city ?? a.town ?? a.village ?? a.state ?? '';
      const street = [a.road, a.house_number].filter(Boolean).join(' ');
      return base({
        source: 'OpenStreetMap',
        kind: 'cafetería',
        title: p.name || q,
        originalTitle: p.name || q,
        place: [street, city, a.country].filter(Boolean).join(', '),
        description: p.display_name,
        url: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`,
        tags: ['cafeteria'],
      });
    });
}

async function coffeeBrands(q) {
  const params = new URLSearchParams({ q, page_size: '12', fields: 'product_name,brands,image_front_url,categories_tags,quantity' });
  const data = await getJson(`https://search.openfoodfacts.org/search?${params}`);
  return (data.hits ?? [])
    .filter((p) => (p.categories_tags ?? []).some((c) => c.includes('coffee')))
    .slice(0, 6)
    .map((p) => {
      const brand = Array.isArray(p.brands) ? p.brands[0] : p.brands;
      return base({
        source: 'Open Food Facts',
        kind: 'marca de café',
        title: [brand, p.product_name].filter(Boolean).join(' — '),
        originalTitle: p.product_name || brand,
        creators: brand ? [brand] : [],
        cover: p.image_front_url ?? null,
        tags: ['marca'],
      });
    });
}

async function coffee(q) {
  const [brands, shops] = await Promise.allSettled([coffeeBrands(q), coffeeShops(q)]);
  return [...coffeeCatalog(q), ...(brands.value ?? []), ...(shops.value ?? [])];
}

// ---------- Ruteo ----------

const PROVIDERS = {
  musica: music,
  peliculas: movies,
  series: shows,
  libros: books,
  juegos: games,
  cafe: coffee,
  flores: (q) => wiki(q, { kind: 'flor' }),
  actividades: (q) => wiki(q, { kind: 'actividad' }),
  moodboard: (q) => wiki(q, { kind: 'idea' }),
};

export const LOOKUP_CONTAINERS = Object.keys(PROVIDERS);

export async function lookup(container, q) {
  const fn = PROVIDERS[container];
  if (!fn) return [];
  const results = await fn(q);
  // sin duplicados por título + año, y primero lo que más se parece a lo buscado
  const seen = new Set();
  const nq = norm(q);
  const score = (r) => {
    const t = norm(r.title);
    if (t === nq) return 0;
    if (t.startsWith(nq) || nq.startsWith(t)) return 1;
    if (t.includes(nq) || nq.includes(t)) return 2;
    return 3;
  };
  return results
    .filter((r) => {
      const k = `${norm(r.title)}|${r.year ?? ''}|${r.kind}|${norm(r.creators?.[0] ?? '')}`;
      if (!r.title || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map(({ r }) => {
      const { qid, ...rest } = r;
      return rest;
    });
}

/**
 * Descarga una portada elegida en el asistente a DATA_DIR/media/<room>/<container>/.
 * Devuelve la ruta /media/... o null.
 */
export async function downloadCover(url, targetDir, publicPrefix) {
  if (!isAllowedCoverUrl(url)) return null;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok || !isAllowedCoverUrl(res.url)) return null;
  const type = res.headers.get('content-type') ?? '';
  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('jpeg') || type.includes('jpg') ? '.jpg' : null;
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024 || buf.length < 500) return null;
  mkdirSync(targetDir, { recursive: true });
  const name = `lookup-${Date.now()}${ext}`;
  writeFileSync(join(targetDir, name), buf);
  return `${publicPrefix}/${name}`;
}
