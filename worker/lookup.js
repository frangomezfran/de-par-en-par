/**
 * Asistente de búsqueda para el alta de ítems (compatible con Cloudflare Workers).
 * Fuentes públicas sin API key:
 *   - iTunes Search (música)
 *   - Wikipedia en inglés + Wikidata (películas)
 *   - TVmaze (series)
 *   - Open Library (libros)
 *   - Wikipedia + Wikidata (juegos, flores, actividades, moodboard)
 *   - OpenStreetMap / Nominatim + Open Food Facts + catálogo propio (café)
 */

const UA = 'PaginaAmelia/2.0 (proyecto familiar)';
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
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
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
  espionage: 'espionaje', food: 'cocina', travel: 'viajes', nature: 'naturaleza', reality: 'reality',
  rock: 'rock', pop: 'pop', alternative: 'alternativa', electronic: 'electrónica', dance: 'dance', 'hip-hop/rap': 'hip hop',
  'hip-hop': 'hip hop', rap: 'rap', jazz: 'jazz', classical: 'clásica', soundtrack: 'banda sonora', latino: 'latina',
  latin: 'latina', 'pop latino': 'pop latino', 'rock y alternativo': 'rock alternativo', metal: 'metal', 'hard rock': 'hard rock',
  country: 'country', 'r&b/soul': 'R&B', blues: 'blues', reggae: 'reggae', folk: 'folk', 'singer/songwriter': 'cantautor',
  fiction: 'ficción', 'juvenile fiction': 'juvenil', poetry: 'poesía', 'short stories': 'cuentos', comics: 'historieta',
  'graphic novels': 'novela gráfica', 'fairy tales': 'cuentos de hadas', 'love stories': 'romance',
};

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

// ---------- iTunes ----------

async function itunes(q, entity, limit) {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term: q, entity, limit: String(limit), country: 'AR', lang: 'es_es' })}`;
  const data = await getJson(url);
  return data.results ?? [];
}

const art = (u, size) => (u ? u.replace(/\/\d+x\d+bb\./, `/${size}bb.`) : null);

async function music(q) {
  const [albums, songs] = await Promise.all([itunes(q, 'album', 6), itunes(q, 'song', 4)]);
  return [
    ...albums.map((a) =>
      base({
        source: 'iTunes',
        kind: 'álbum',
        title: a.collectionName,
        originalTitle: a.collectionName,
        year: year(a.releaseDate),
        creators: [a.artistName],
        genres: genresEs([a.primaryGenreName]),
        cover: art(a.artworkUrl100, '600x600'),
        url: a.collectionViewUrl,
        tags: ['album'],
      }),
    ),
    ...songs.map((s) =>
      base({
        source: 'iTunes',
        kind: 'canción',
        title: s.trackName,
        originalTitle: s.trackName,
        year: year(s.releaseDate),
        creators: [s.artistName],
        genres: genresEs([s.primaryGenreName]),
        cover: art(s.artworkUrl100, '600x600'),
        description: s.collectionName ? `Del disco «${s.collectionName}».` : '',
        url: s.trackViewUrl,
        tags: ['cancion'],
      }),
    ),
  ];
}

// ---------- Wikidata ----------

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
    const es = entities[r.qid].labels?.es?.value;
    if (es) {
      out.originalTitle = r.title;
      out.title = es;
    }
    for (const field of Object.keys(spec)) {
      const names = picks[r.qid][field]
        .map((id) => (field === 'genres' ? labels[id]?.labels?.es?.value?.replace(/ en el cine$/, '') : label(labels[id])))
        .filter(Boolean);
      if (names.length) out[field] = field === 'genres' ? genresEs(names) : names;
    }
    return out;
  });
}

// ---------- Películas ----------

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

// ---------- Series ----------

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

// ---------- Libros ----------

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
      year: year(p.description),
      cover: p.thumbnail?.source ?? null,
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
    return await enrichWithWikidata(list, { creators: 'P178', genres: 'P136' });
  } catch {
    return list;
  }
}

// ---------- Café ----------

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
    .replace(/[\u0300-\u036f]/g, '')
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
      const k = `${norm(r.title)}|${r.year ?? ''}|${r.kind}`;
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
 * Descarga una portada elegida en el asistente en memoria para guardarla en D1.
 * Devuelve { bytes, mime, ext } o null.
 */
export async function downloadCoverBytes(url) {
  if (!isAllowedCoverUrl(url)) return null;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok || !isAllowedCoverUrl(res.url)) return null;
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const ext = type.includes('png')
    ? '.png'
    : type.includes('webp')
      ? '.webp'
      : type.includes('jpeg') || type.includes('jpg')
        ? '.jpg'
        : null;
  if (!ext) return null;
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024 || bytes.byteLength < 500) return null;
  return { bytes, mime, ext };
}
