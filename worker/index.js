import crypto from 'node:crypto';
import roomsData from '../data/rooms.json';
import seedItems from '../data/items.json';
import staticMediaList from './generated-static-media.json';
import { lookup, downloadCoverBytes, LOOKUP_CONTAINERS } from './lookup.js';

const STATIC_MEDIA_SET = new Set(staticMediaList);
const CHUNK_SIZE = 900 * 1024; // 900 KB por bloque (< límite de 2 MB por fila en D1)
const MAX_RANGE_SPAN = 4 * CHUNK_SIZE; // ~3.6 MB por respuesta parcial en streaming de audio

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3'];
const AUDIO_EXT = ['.mp3'];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_GALLERY = 3;

export const CANONICAL_CONTAINERS = [
  'peliculas',
  'series',
  'libros',
  'musica',
  'juegos',
  'flores',
  'cafe',
  'moodboard',
  'fotos',
  'diario',
  'actividades',
];

export const VALID_VISIBILITY = ['publico', 'privado'];
export const VALID_WEATHER = ['soleado', 'nublado', 'lluvioso', 'tormenta', 'nevado', 'niebla'];
export const VALID_DAYTIME = ['diurno', 'nocturno', 'cualquiera'];
export const VALID_SEASONS = ['verano', 'otono', 'invierno', 'primavera'];
export const VALID_MOODS = ['alegre', 'tierno', 'nostalgico', 'melancolico', 'tranquilo', 'energico', 'divertido', 'valiente'];
export const VALID_STAGES = ['embarazo', 'bebe', 'primeros-anios', 'ninez', 'adolescencia', 'siempre'];
export const VALID_SPECIAL_DATES = ['cumple-amelia', 'cumple-mariana', 'cumple-franco', 'navidad', 'anio-nuevo', 'halloween'];
export const VALID_AUDIENCE = ['ATP', '+13', '+16', '+18'];

// ---------- Rate Limiter (sin timers en scope global para Workers) ----------

class WorkerRateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();
  }

  check(ip) {
    if (!ip) return true;
    const now = Date.now();
    const cutoff = now - this.windowMs;
    if (this.hits.size > 250) {
      for (const [k, ts] of this.hits.entries()) {
        const valid = ts.filter((t) => t > cutoff);
        if (valid.length === 0) this.hits.delete(k);
        else this.hits.set(k, valid);
      }
    }
    const recent = (this.hits.get(ip) || []).filter((t) => t > cutoff);
    if (recent.length >= this.maxRequests) {
      this.hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(ip, recent);
    return true;
  }
}

const generalPostLimiter = new WorkerRateLimiter(60 * 1000, 120);
const commentsLimiter = new WorkerRateLimiter(10 * 60 * 1000, 5);
const lookupLimiter = new WorkerRateLimiter(60 * 1000, 30);

// ---------- Utilidades de texto y seguridad ----------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-XSS-Protection': '1; mode=block',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...SECURITY_HEADERS,
    },
  });
}

function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

function slugify(str) {
  if (!str) return 'item';
  const clean = String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return clean || 'item';
}

function normalizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function cmpCodepoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNorm(a, b) {
  return cmpCodepoint(normalizeText(a), normalizeText(b));
}

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function parseUsers(raw = '', rooms = []) {
  const byName = new Map(rooms.map((r) => [String(r.name).toLowerCase(), r.id]));
  const familyList = [];
  const ownerList = [];
  const readonlyList = [];
  const clean = (raw || '').replace(/^["']|["']$/g, '').trim();
  for (const pair of clean.split(',')) {
    let entry = pair.trim();
    let isReadonly = false;
    if (/:readonly$/i.test(entry)) {
      isReadonly = true;
      entry = entry.replace(/:readonly$/i, '').trim();
    }
    const idx = entry.indexOf(':');
    if (idx === -1) continue;
    const name = entry.slice(0, idx).trim();
    const code = entry.slice(idx + 1).trim();
    if (!name || !code) continue;
    const roomId = byName.get(name.toLowerCase());
    if (isReadonly) readonlyList.push({ name, code });
    else if (roomId) ownerList.push({ roomId, name, code });
    else familyList.push({ name, code });
  }
  return { familyList, ownerList, readonlyList };
}

function verifyPasscode(passcode, { familyList = [], ownerList = [], readonlyList = [] } = {}) {
  if (!passcode || typeof passcode !== 'string') return null;
  const trimmed = passcode.trim();
  if (!trimmed) return null;
  for (const o of ownerList) {
    if (timingSafeEqualStrings(trimmed, o.code)) {
      return { name: o.name, role: 'owner', roomId: o.roomId };
    }
  }
  for (const f of familyList) {
    if (timingSafeEqualStrings(trimmed, f.code)) {
      return { name: f.name, role: 'familia' };
    }
  }
  for (const r of readonlyList) {
    if (timingSafeEqualStrings(trimmed, r.code)) {
      return { name: r.name, role: 'readonly' };
    }
  }
  return null;
}

// ---------- Inicialización de D1 ----------

let dbInitPromise = null;

async function ensureDbReady(db) {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          roomId TEXT NOT NULL,
          container TEXT NOT NULL,
          title TEXT NOT NULL,
          originalTitle TEXT,
          year INTEGER,
          cover TEXT,
          creators TEXT,
          [cast] TEXT,
          genres TEXT,
          audience TEXT,
          weather TEXT,
          daytime TEXT,
          seasons TEXT,
          moods TEXT,
          stages TEXT,
          specialDates TEXT,
          tags TEXT,
          rating REAL,
          ownerNote TEXT,
          body TEXT,
          date TEXT,
          place TEXT,
          gallery TEXT,
          videoUrl TEXT,
          likes INTEGER DEFAULT 0,
          addedBy TEXT,
          visibility TEXT DEFAULT 'publico',
          audio TEXT,
          createdAt TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          itemId TEXT NOT NULL,
          author TEXT NOT NULL,
          body TEXT NOT NULL,
          rating REAL,
          createdAt TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS likes_log (
          item_id TEXT NOT NULL,
          ip TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS media_files (
          path TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          chunks INTEGER NOT NULL,
          createdAt TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS media_chunks (
          path TEXT NOT NULL,
          idx INTEGER NOT NULL,
          data BLOB NOT NULL,
          PRIMARY KEY (path, idx)
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_items_room_container ON items (roomId, container)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_comments_item_id ON comments (itemId)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_likes_log_item_ip ON likes_log (item_id, ip)`),
      ]);

      const countRow = await db.prepare('SELECT COUNT(*) as count FROM items').first();
      if (!countRow || Number(countRow.count) === 0) {
        const stmt = db.prepare(`INSERT OR IGNORE INTO items (
          id, roomId, container, title, originalTitle, year, cover,
          creators, [cast], genres, audience, weather, daytime,
          seasons, moods, stages, specialDates, tags, rating,
          ownerNote, body, date, place, gallery, videoUrl, likes, addedBy, visibility, audio, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

        for (let i = 0; i < seedItems.length; i += 20) {
          const batch = seedItems.slice(i, i + 20).map((item) =>
            stmt.bind(
              item.id,
              item.roomId,
              item.container,
              item.title,
              item.originalTitle || null,
              item.year !== undefined && item.year !== null ? Number(item.year) : null,
              item.cover || null,
              JSON.stringify(item.creators || []),
              JSON.stringify(item.cast || []),
              JSON.stringify(item.genres || []),
              item.audience || null,
              JSON.stringify(item.weather || []),
              item.daytime || null,
              JSON.stringify(item.seasons || []),
              JSON.stringify(item.moods || []),
              JSON.stringify(item.stages || []),
              JSON.stringify(item.specialDates || []),
              JSON.stringify(item.tags || []),
              item.rating !== undefined && item.rating !== null ? Number(item.rating) : 5,
              item.ownerNote || '',
              item.body || '',
              item.date || null,
              item.place || null,
              JSON.stringify(item.gallery || []),
              item.videoUrl || null,
              item.likes || 0,
              item.addedBy || (item.roomId === 'mariana' ? 'Mariana' : 'Franco'),
              item.visibility === 'privado' ? 'privado' : 'publico',
              item.audio || null,
              item.createdAt || new Date().toISOString()
            )
          );
          if (batch.length) await db.batch(batch);
        }
      }
    })().catch((err) => {
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

// ---------- Almacenamiento y entrega de /media en D1 + Static Assets ----------

function toUint8Array(val) {
  if (val instanceof Uint8Array) return val;
  if (val instanceof ArrayBuffer) return new Uint8Array(val);
  if (ArrayBuffer.isView(val)) return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  if (Array.isArray(val)) return Uint8Array.from(val);
  return new Uint8Array(0);
}

async function getDynamicMediaSet(db) {
  const { results } = await db.prepare('SELECT path FROM media_files').all();
  return new Set((results || []).map((r) => r.path));
}

function checkMediaExists(urlPath, dynamicMediaSet) {
  if (!urlPath || typeof urlPath !== 'string') return false;
  if (!urlPath.startsWith('/media/')) return true;
  return STATIC_MEDIA_SET.has(urlPath) || dynamicMediaSet.has(urlPath);
}

async function saveMediaToD1(db, urlPath, bytes, mime) {
  const totalChunks = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE));
  const now = new Date().toISOString();

  await db.batch([
    db.prepare('DELETE FROM media_chunks WHERE path = ?').bind(urlPath),
    db
      .prepare('INSERT OR REPLACE INTO media_files (path, mime, size, chunks, createdAt) VALUES (?, ?, ?, ?, ?)')
      .bind(urlPath, mime, bytes.byteLength, totalChunks, now),
  ]);

  const chunkStmts = [];
  for (let i = 0; i < totalChunks; i++) {
    const slice = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    chunkStmts.push(
      db.prepare('INSERT INTO media_chunks (path, idx, data) VALUES (?, ?, ?)').bind(urlPath, i, slice.buffer)
    );
  }

  for (let i = 0; i < chunkStmts.length; i += 4) {
    await db.batch(chunkStmts.slice(i, i + 4));
  }

  return urlPath;
}

async function removeMediaFromD1(db, urlPath) {
  if (!urlPath || typeof urlPath !== 'string' || !urlPath.startsWith('/media/')) return;
  const baseName = urlPath.split('/').pop() || '';
  if (!/^(upload|lookup|cover|gallery|audio)-/.test(baseName)) return;
  await db.batch([
    db.prepare('DELETE FROM media_chunks WHERE path = ?').bind(urlPath),
    db.prepare('DELETE FROM media_files WHERE path = ?').bind(urlPath),
  ]);
}

async function serveMedia(request, env, rawPathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: SECURITY_HEADERS });
  }

  await ensureDbReady(env.DB);

  let urlPath = rawPathname;
  try {
    urlPath = decodeURIComponent(rawPathname);
  } catch {}

  const meta = await env.DB.prepare('SELECT mime, size, chunks FROM media_files WHERE path = ?')
    .bind(urlPath)
    .first();

  if (meta) {
    const total = Number(meta.size) || 0;
    const baseHeaders = {
      'Content-Type': meta.mime || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=604800',
      ...SECURITY_HEADERS,
    };

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(total) },
      });
    }

    if (total === 0) {
      return new Response(new Uint8Array(0), {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': '0' },
      });
    }

    const rangeHeader = request.headers.get('range');
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      if (m) {
        let start;
        let end;
        if (m[1] === '' && m[2] !== '') {
          const suffix = parseInt(m[2], 10);
          start = Math.max(0, total - suffix);
          end = total - 1;
        } else {
          start = m[1] !== '' ? parseInt(m[1], 10) : 0;
          end = m[2] !== '' ? Math.min(total - 1, parseInt(m[2], 10)) : Math.min(total - 1, start + MAX_RANGE_SPAN - 1);
        }

        if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= total || start > end) {
          return new Response(null, {
            status: 416,
            headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
          });
        }

        const firstChunk = Math.floor(start / CHUNK_SIZE);
        const lastChunk = Math.floor(end / CHUNK_SIZE);
        const { results } = await env.DB.prepare(
          'SELECT idx, data FROM media_chunks WHERE path = ? AND idx >= ? AND idx <= ? ORDER BY idx ASC'
        )
          .bind(urlPath, firstChunk, lastChunk)
          .all();

        const length = end - start + 1;
        const out = new Uint8Array(length);
        let written = 0;

        for (const row of results || []) {
          const chunkIdx = Number(row.idx);
          const chunkStart = chunkIdx * CHUNK_SIZE;
          const bytes = toUint8Array(row.data);
          const copyFrom = Math.max(0, start - chunkStart);
          const copyTo = Math.min(bytes.byteLength, end - chunkStart + 1);
          if (copyTo > copyFrom) {
            const slice = bytes.subarray(copyFrom, copyTo);
            out.set(slice, written);
            written += slice.byteLength;
          }
        }

        return new Response(out.subarray(0, written), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${start + written - 1}/${total}`,
            'Content-Length': String(written),
          },
        });
      }
    }

    const totalChunks = Number(meta.chunks) || 1;
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let idx = 0; idx < totalChunks; idx++) {
            const row = await env.DB.prepare('SELECT data FROM media_chunks WHERE path = ? AND idx = ?')
              .bind(urlPath, idx)
              .first();
            if (row && row.data) {
              controller.enqueue(toUint8Array(row.data));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) },
    });
  }

  // Fallback a los archivos estáticos empaquetados desde data/media -> client/dist/media
  if (!STATIC_MEDIA_SET.has(urlPath) && !STATIC_MEDIA_SET.has(rawPathname)) {
    return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
  }

  const assetRes = await env.ASSETS.fetch(request);
  const ct = assetRes.headers.get('content-type') || '';
  if (!assetRes.ok || ct.includes('text/html')) {
    return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
  }

  const headers = new Headers(assetRes.headers);
  headers.set('Cache-Control', 'public, max-age=604800');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);

  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers,
  });
}

// ---------- Formateo y consultas de negocio ----------

function parseJsonArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatItemOutput(row, dynamicMediaSet) {
  if (!row) return null;

  const cover = row.cover && checkMediaExists(row.cover, dynamicMediaSet) ? row.cover : null;
  const rawGallery = parseJsonArray(row.gallery);
  const gallery = rawGallery.filter((u) => checkMediaExists(u, dynamicMediaSet));
  const audio = row.audio && checkMediaExists(row.audio, dynamicMediaSet) ? row.audio : null;

  const year = row.year !== null && row.year !== undefined ? Number(row.year) : null;
  const decade = year !== null && !Number.isNaN(year) ? `${Math.floor(year / 10) * 10}s` : null;

  return {
    id: row.id,
    roomId: row.roomId,
    container: row.container,
    title: row.title,
    originalTitle: row.originalTitle || null,
    year,
    cover,
    creators: parseJsonArray(row.creators),
    cast: parseJsonArray(row.cast),
    genres: parseJsonArray(row.genres),
    audience: row.audience || null,
    weather: parseJsonArray(row.weather),
    daytime: row.daytime || null,
    seasons: parseJsonArray(row.seasons),
    moods: parseJsonArray(row.moods),
    stages: parseJsonArray(row.stages),
    specialDates: parseJsonArray(row.specialDates),
    tags: parseJsonArray(row.tags),
    rating: row.rating !== null && row.rating !== undefined ? Number(row.rating) : 5,
    visibility: row.visibility === 'privado' ? 'privado' : 'publico',
    audio,
    ownerNote: row.ownerNote || '',
    body: row.body || '',
    date: row.date || null,
    place: row.place || null,
    gallery,
    videoUrl: row.videoUrl || null,
    likes: Number(row.likes) || 0,
    addedBy: row.addedBy || null,
    createdAt: row.createdAt,
    decade,
    commentCount: row.commentCount !== undefined ? Number(row.commentCount) : 0,
  };
}

async function getItemById(db, id, dynamicMediaSet = null) {
  const row = await db
    .prepare(
      `SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.itemId = i.id) as commentCount
       FROM items i WHERE i.id = ?`
    )
    .bind(id)
    .first();
  if (!row) return null;
  const dynSet = dynamicMediaSet ?? (await getDynamicMediaSet(db));
  return formatItemOutput(row, dynSet);
}

async function getItems(db, filters = {}) {
  let sql = `
    SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.itemId = i.id) as commentCount
    FROM items i
    WHERE 1=1
  `;
  const params = [];

  if (!filters.includePrivate) {
    sql += ` AND (i.visibility IS NULL OR i.visibility != 'privado')`;
  }
  if (filters.room) {
    sql += ` AND i.roomId = ?`;
    params.push(filters.room);
  }
  if (filters.container && filters.container !== 'ventana') {
    sql += ` AND i.container = ?`;
    params.push(filters.container);
  }
  if (filters.daytime) {
    if (filters.daytime === 'diurno') {
      sql += ` AND (i.daytime = 'diurno' OR i.daytime = 'cualquiera')`;
    } else if (filters.daytime === 'nocturno') {
      sql += ` AND (i.daytime = 'nocturno' OR i.daytime = 'cualquiera')`;
    } else if (filters.daytime === 'cualquiera') {
      sql += ` AND i.daytime = 'cualquiera'`;
    } else {
      sql += ` AND i.daytime = ?`;
      params.push(filters.daytime);
    }
  }
  if (filters.decade) {
    const match = String(filters.decade).match(/\d{4}/);
    if (match) {
      const startYear = parseInt(match[0], 10);
      sql += ` AND i.year IS NOT NULL AND i.year >= ? AND i.year <= ?`;
      params.push(startYear, startYear + 9);
    }
  }

  const [{ results }, dynSet] = await Promise.all([
    db.prepare(sql).bind(...params).all(),
    getDynamicMediaSet(db),
  ]);

  let items = (results || []).map((r) => formatItemOutput(r, dynSet));

  if (filters.weather) {
    items = items.filter((it) => it.weather.includes(filters.weather));
  }
  if (filters.genre) {
    const ng = normalizeText(filters.genre);
    items = items.filter((it) => it.genres.some((g) => normalizeText(g) === ng));
  }
  if (filters.mood) {
    items = items.filter((it) => it.moods.includes(filters.mood));
  }
  if (filters.stage) {
    items = items.filter((it) => it.stages.includes(filters.stage));
  }
  if (filters.date) {
    items = items.filter((it) => it.specialDates.includes(filters.date));
  }
  if (filters.tag) {
    items = items.filter((it) => it.tags.includes(filters.tag));
  }
  if (filters.q) {
    const nq = normalizeText(filters.q);
    items = items.filter((it) => {
      const haystack = normalizeText(
        `${it.title} ${it.originalTitle || ''} ${JSON.stringify(it.creators)} ${JSON.stringify(it.cast)} ${it.ownerNote || ''} ${it.body || ''}`
      );
      return haystack.includes(nq);
    });
  }

  switch (filters.sort) {
    case 'za':
      items.sort((a, b) => cmpNorm(b.title, a.title));
      break;
    case 'anio-asc':
      items.sort((a, b) => {
        const na = a.year === null ? 1 : 0;
        const nb = b.year === null ? 1 : 0;
        if (na !== nb) return na - nb;
        if (a.year !== b.year) return (a.year ?? 0) - (b.year ?? 0);
        return cmpNorm(a.title, b.title);
      });
      break;
    case 'anio-desc':
      items.sort((a, b) => {
        const na = a.year === null ? 1 : 0;
        const nb = b.year === null ? 1 : 0;
        if (na !== nb) return na - nb;
        if (a.year !== b.year) return (b.year ?? 0) - (a.year ?? 0);
        return cmpNorm(a.title, b.title);
      });
      break;
    case 'recientes':
      items.sort((a, b) => cmpCodepoint(b.createdAt || '', a.createdAt || '') || cmpCodepoint(a.id, b.id));
      break;
    case 'az':
    default:
      items.sort((a, b) => cmpNorm(a.title, b.title));
      break;
  }

  return items;
}

async function getStats(db, { room, container, includePrivate = false } = {}) {
  const { results } = await db
    .prepare('SELECT id, roomId, container, title, originalTitle, year, genres, moods, weather, visibility FROM items')
    .all();

  const vis = (results || []).filter((r) => includePrivate || r.visibility !== 'privado');
  const filterByContainer = Boolean(container && container !== 'ventana');

  const mainItems = vis.filter(
    (r) => (!room || r.roomId === room) && (!filterByContainer || r.container === container)
  );

  const total = mainItems.length;

  const decMap = new Map();
  const genreMap = new Map();
  const moodMap = new Map();
  const weatherMap = new Map();

  for (const r of mainItems) {
    if (r.year !== null && r.year !== undefined) {
      const dec = Math.floor(Number(r.year) / 10) * 10;
      if (!Number.isNaN(dec)) {
        decMap.set(dec, (decMap.get(dec) || 0) + 1);
      }
    }
    for (const g of parseJsonArray(r.genres)) genreMap.set(g, (genreMap.get(g) || 0) + 1);
    for (const m of parseJsonArray(r.moods)) moodMap.set(m, (moodMap.get(m) || 0) + 1);
    for (const w of parseJsonArray(r.weather)) weatherMap.set(w, (weatherMap.get(w) || 0) + 1);
  }

  const byDecade = [...decMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dec, count]) => ({ key: `${dec}s`, count }));

  const sortFreq = (map) =>
    [...map.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || cmpCodepoint(a.key, b.key));

  const byGenre = sortFreq(genreMap);
  const byMood = sortFreq(moodMap);
  const byWeather = sortFreq(weatherMap);

  let compare = null;
  const otherRoom = room === 'mariana' ? 'franco' : room === 'franco' ? 'mariana' : null;
  if (otherRoom) {
    const compCount = vis.filter(
      (r) => r.roomId === otherRoom && (!filterByContainer || r.container === container)
    ).length;
    compare = { roomId: otherRoom, total: compCount };
  }

  const leftRoom = otherRoom ? room : 'mariana';
  const rightRoom = otherRoom ? otherRoom : 'franco';
  const leftItems = vis.filter((r) => r.roomId === leftRoom && (!filterByContainer || r.container === container));
  const rightItems = vis.filter((r) => r.roomId === rightRoom && (!filterByContainer || r.container === container));

  const shared = [];
  for (const i1 of leftItems) {
    const t1 = normalizeText(i1.title);
    const o1 = i1.originalTitle ? normalizeText(i1.originalTitle) : null;
    for (const i2 of rightItems) {
      const t2 = normalizeText(i2.title);
      const o2 = i2.originalTitle ? normalizeText(i2.originalTitle) : null;
      if ((o1 && o2 && o1 === o2) || t1 === t2) {
        shared.push({ title: i1.title, otherId: i2.id, otherContainer: i2.container });
      }
    }
  }

  return { total, byDecade, byGenre, byMood, byWeather, compare, shared };
}

async function getCoincidences(db, { includePrivate = false } = {}) {
  const privSql = includePrivate ? '' : " WHERE (i.visibility IS NULL OR i.visibility != 'privado')";
  const [{ results: rawRows }, { results: allComments }, dynSet] = await Promise.all([
    db
      .prepare(
        `SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.itemId = i.id) as commentCount
         FROM items i${privSql}`
      )
      .all(),
    db.prepare('SELECT id, itemId, author, body, rating, createdAt FROM comments ORDER BY id ASC').all(),
    getDynamicMediaSet(db),
  ]);

  const commentsByItem = new Map();
  for (const c of allComments || []) {
    const list = commentsByItem.get(c.itemId) || [];
    list.push(c);
    commentsByItem.set(c.itemId, list);
  }

  const formatted = (rawRows || []).map((r) => formatItemOutput(r, dynSet));
  const marianaItems = formatted.filter((it) => it.roomId === 'mariana').sort((a, b) => cmpNorm(a.title, b.title));
  const francoItems = formatted.filter((it) => it.roomId === 'franco');

  const pairs = [];
  for (const a of marianaItems) {
    const aTitle = normalizeText(a.title);
    const aOrig = a.originalTitle ? normalizeText(a.originalTitle) : '';
    for (const b of francoItems) {
      const bTitle = normalizeText(b.title);
      const bOrig = b.originalTitle ? normalizeText(b.originalTitle) : '';
      const matched =
        aTitle === bTitle ||
        (aOrig !== '' && aOrig === (bOrig || bTitle)) ||
        (bOrig !== '' && bOrig === aTitle);
      if (matched) {
        pairs.push({
          mariana: { item: a, comments: commentsByItem.get(a.id) || [] },
          franco: { item: b, comments: commentsByItem.get(b.id) || [] },
        });
      }
    }
  }

  return pairs;
}

// ---------- Validación y subida de ítems ----------

function parseRating(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    return required ? { error: 'Falta la calificación.' } : { value: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0.5 || n > 5 || !Number.isInteger(n * 2)) {
    return { error: 'La calificación va de media estrella a 5 estrellas.' };
  }
  return { value: n };
}

function parseArrayField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function readItemFields(body, { partial = false } = {}) {
  const data = {};
  const has = (k) => body[k] !== undefined;
  const text = (k) => (typeof body[k] === 'string' ? body[k].trim() : '');

  if (!partial || has('title')) {
    if (!text('title')) return { error: 'El título es obligatorio.' };
    data.title = text('title');
  }
  for (const k of ['originalTitle', 'ownerNote', 'body', 'date', 'place', 'videoUrl']) {
    if (!partial || has(k)) data[k] = text(k) || (k === 'ownerNote' || k === 'body' ? '' : null);
  }
  if (!partial || has('year')) data.year = text('year') ? Number(text('year')) : null;
  for (const k of ['creators', 'cast', 'genres', 'tags']) {
    if (!partial || has(k)) data[k] = parseArrayField(body[k]);
  }

  const enums = [
    ['weather', VALID_WEATHER, 'El clima'],
    ['seasons', VALID_SEASONS, 'La estación'],
    ['moods', VALID_MOODS, 'El estado de ánimo'],
    ['stages', VALID_STAGES, 'La etapa'],
    ['specialDates', VALID_SPECIAL_DATES, 'La fecha especial'],
  ];
  for (const [k, valid, label] of enums) {
    if (partial && !has(k)) continue;
    const list = parseArrayField(body[k]);
    const bad = list.find((v) => !valid.includes(v));
    if (bad) return { error: `${label} "${bad}" no es válido.` };
    data[k] = list;
  }

  if (!partial || has('daytime')) {
    const d = text('daytime') || null;
    if (d && !VALID_DAYTIME.includes(d)) return { error: 'El momento del día no es válido.' };
    data.daytime = d;
  }
  if (!partial || has('audience')) {
    const a = text('audience') || null;
    if (a && !VALID_AUDIENCE.includes(a)) return { error: 'La clasificación de edad no es válida.' };
    data.audience = a;
  }
  if (!partial || has('visibility')) {
    const v = text('visibility') || 'publico';
    if (!VALID_VISIBILITY.includes(v)) return { error: 'La visibilidad tiene que ser pública o privada.' };
    data.visibility = v;
  }
  if (!partial || has('rating')) {
    const r = parseRating(body.rating);
    if (r.error) return { error: r.error };
    data.rating = r.value ?? 5;
  }
  return { data };
}

function getExtLower(filename = '') {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

async function parseMultipartOrJson(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    let form;
    try {
      form = await request.formData();
    } catch {
      return { error: 'Error al subir el archivo.' };
    }
    const body = {};
    const files = { cover: [], gallery: [], audio: [] };

    for (const [key, val] of form.entries()) {
      if (typeof val === 'string') {
        if (body[key] === undefined) body[key] = val;
        else if (Array.isArray(body[key])) body[key].push(val);
        else body[key] = [body[key], val];
      } else if (val && typeof val.arrayBuffer === 'function') {
        if (!val.name && val.size === 0) continue;
        if (!(key in files)) {
          return { error: `Podés subir una portada, hasta ${MAX_GALLERY} fotos más y un mp3.` };
        }
        const maxCount = key === 'gallery' ? MAX_GALLERY : 1;
        if (files[key].length >= maxCount) {
          return { error: `Podés subir una portada, hasta ${MAX_GALLERY} fotos más y un mp3.` };
        }
        const ext = getExtLower(val.name);
        const mime = (val.type || '').toLowerCase();
        const isAudio = key === 'audio';
        const okType = isAudio
          ? AUDIO_TYPES.includes(mime) || AUDIO_EXT.includes(ext)
          : IMAGE_TYPES.includes(mime) || IMAGE_EXT.includes(ext);
        if (!okType) {
          return {
            error: isAudio
              ? 'El audio tiene que ser un archivo .mp3.'
              : 'Formato de imagen no soportado. Usá JPG, PNG o WEBP.',
          };
        }
        if (val.size > MAX_AUDIO_BYTES) {
          return { error: 'El archivo es demasiado pesado (máximo 20 MB para audio, 8 MB para imágenes).' };
        }
        if (!isAudio && val.size > MAX_IMAGE_BYTES) {
          return { error: 'Cada imagen puede pesar hasta 8 MB.' };
        }
        files[key].push(val);
      }
    }
    return { body, files };
  }

  const body = await readJsonSafe(request);
  if (body === null) return { error: 'El formato de datos enviado no es válido.' };
  return { body, files: { cover: [], gallery: [], audio: [] } };
}

async function readJsonSafe(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function storeUploadedFile(db, file, roomId, container, prefix) {
  const rawExt = getExtLower(file.name);
  const isAudio = prefix === 'audio';
  const ext = rawExt || (isAudio ? '.mp3' : '.jpg');
  const mime =
    file.type ||
    (ext === '.mp3'
      ? 'audio/mpeg'
      : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg');

  const filename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e4)}${ext}`;
  const urlPath = `/media/${roomId}/${container}/${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await saveMediaToD1(db, urlPath, bytes, mime);
  return urlPath;
}

async function resolveCover(db, files, body, roomId, container) {
  const coverFile = files.cover?.[0];
  if (coverFile) return storeUploadedFile(db, coverFile, roomId, container, 'cover');
  if (typeof body.coverUrl === 'string' && body.coverUrl.trim()) {
    try {
      const downloaded = await downloadCoverBytes(body.coverUrl.trim());
      if (downloaded) {
        const urlPath = `/media/${roomId}/${container}/lookup-${Date.now()}${downloaded.ext}`;
        await saveMediaToD1(db, urlPath, downloaded.bytes, downloaded.mime);
        return urlPath;
      }
    } catch (err) {
      console.warn('[Worker] No se pudo descargar la portada:', err.message);
    }
  }
  return undefined;
}

// ---------- Router principal de la API ----------

async function handleApi(request, env, url) {
  await ensureDbReady(env.DB);

  const clientIp = getClientIp(request);
  if (request.method === 'POST' && !generalPostLimiter.check(clientIp)) {
    return jsonRes({ error: 'Pará un poquito, probá de nuevo en unos minutos.' }, 429);
  }

  const passcodes = parseUsers(env.USERS || 'Mariana:mariana,Franco:franco,Amelia:amelia,Visita:visita:readonly', roomsData);
  const viewer = verifyPasscode(request.headers.get('x-amelia-pass'), passcodes);
  const seesPrivate = viewer?.role === 'owner';
  const isVisible = (v, item) => Boolean(item && (item.visibility !== 'privado' || v?.role === 'owner'));
  const roomName = (id) => roomsData.find((r) => r.id === id)?.name ?? id;

  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  // GET /api/health
  if (method === 'GET' && path === '/api/health') {
    return jsonRes({ ok: true });
  }

  // GET /api/rooms
  if (method === 'GET' && path === '/api/rooms') {
    return jsonRes(roomsData);
  }

  // GET /api/rooms/:roomId
  const roomMatch = path.match(/^\/api\/rooms\/([^/]+)$/);
  if (method === 'GET' && roomMatch) {
    const roomId = decodeURIComponent(roomMatch[1]);
    const room = roomsData.find((r) => r.id === roomId);
    if (!room) return jsonRes({ error: 'No encontramos esa habitación.' }, 404);
    const { results } = await env.DB.prepare(
      'SELECT container, COUNT(*) as count FROM items WHERE roomId = ? GROUP BY container'
    )
      .bind(roomId)
      .all();
    const countMap = new Map((results || []).map((c) => [c.container, Number(c.count)]));
    const containers = CANONICAL_CONTAINERS.map((slug) => ({
      slug,
      count: countMap.get(slug) || 0,
    }));
    return jsonRes({ ...room, containers });
  }

  // POST /api/auth/check
  if (method === 'POST' && path === '/api/auth/check') {
    const body = await readJsonSafe(request);
    if (body === null) return jsonRes({ error: 'El formato de datos enviado no es válido.' }, 400);
    const auth = verifyPasscode(body?.passcode, passcodes);
    if (!auth) return jsonRes({ error: 'Ese código no es válido. Pedíselo a Mariana o a Franco.' }, 401);
    return jsonRes(auth.roomId ? { name: auth.name, role: auth.role, roomId: auth.roomId } : { name: auth.name, role: auth.role });
  }

  // GET /api/lookup
  if (method === 'GET' && path === '/api/lookup') {
    if (viewer?.role === 'readonly') return jsonRes({ error: 'Tu usuario es de solo lectura.' }, 403);
    const container = String(url.searchParams.get('container') || '');
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
    if (!LOOKUP_CONTAINERS.includes(container) || q.length < 2) return jsonRes([]);
    if (!lookupLimiter.check(clientIp)) {
      return jsonRes({ error: 'Muchas búsquedas seguidas. Esperá un minutito.' }, 429);
    }
    try {
      return jsonRes(await lookup(container, q));
    } catch (err) {
      console.warn('[Worker] lookup:', err.message);
      return jsonRes({ error: 'No pude buscar en internet ahora. Probá de nuevo o completalo a mano.' }, 502);
    }
  }

  // GET /api/stats
  if (method === 'GET' && path === '/api/stats') {
    const room = url.searchParams.get('room') || undefined;
    const container = url.searchParams.get('container') || undefined;
    return jsonRes(await getStats(env.DB, { room, container, includePrivate: seesPrivate }));
  }

  // GET /api/coincidences
  if (method === 'GET' && path === '/api/coincidences') {
    return jsonRes(await getCoincidences(env.DB, { includePrivate: seesPrivate }));
  }

  // GET /api/items
  if (method === 'GET' && path === '/api/items') {
    const p = (k) => url.searchParams.get(k) || undefined;
    const items = await getItems(env.DB, {
      room: p('room'),
      container: p('container'),
      weather: p('weather'),
      daytime: p('daytime'),
      decade: p('decade'),
      genre: p('genre'),
      mood: p('mood'),
      stage: p('stage'),
      date: p('date'),
      tag: p('tag'),
      q: p('q'),
      sort: p('sort'),
      includePrivate: seesPrivate,
    });
    return jsonRes(items);
  }

  // POST /api/items
  if (method === 'POST' && path === '/api/items') {
    const parsed = await parseMultipartOrJson(request);
    if (parsed.error) return jsonRes({ error: parsed.error }, 400);
    const { body, files } = parsed;
    const { roomId, container } = body;
    const auth = verifyPasscode(body?.passcode, passcodes) ?? viewer;

    if (!auth) return jsonRes({ error: 'Tu sesión no es válida. Volvé a entrar desde el pasillo.' }, 401);
    if (!roomsData.some((r) => r.id === roomId)) return jsonRes({ error: 'Esa habitación no existe.' }, 400);
    if (auth.role !== 'owner' || auth.roomId !== roomId) {
      return jsonRes({ error: `Solo ${roomName(roomId)} puede agregar cosas en su pieza.` }, 403);
    }
    if (!CANONICAL_CONTAINERS.includes(container)) return jsonRes({ error: 'El contenedor no es válido.' }, 400);

    const { data, error } = readItemFields(body);
    if (error) return jsonRes({ error }, 400);

    try {
      data.cover = (await resolveCover(env.DB, files, body, roomId, container)) ?? null;
      const galleryUrls = [];
      for (const gf of (files.gallery || []).slice(0, MAX_GALLERY)) {
        galleryUrls.push(await storeUploadedFile(env.DB, gf, roomId, container, 'gallery'));
      }
      data.gallery = galleryUrls;
      const audioFile = files.audio?.[0];
      data.audio = audioFile ? await storeUploadedFile(env.DB, audioFile, roomId, container, 'audio') : null;
      if (container === 'diario' && data.creators.length === 0) data.creators = [auth.name];

      const baseSlug = slugify(data.title);
      let candidateId = `${roomId}-${container}-${baseSlug}`;
      let counter = 2;
      while (await env.DB.prepare('SELECT 1 FROM items WHERE id = ?').bind(candidateId).first()) {
        candidateId = `${roomId}-${container}-${baseSlug}-${counter}`;
        counter++;
      }

      const createdAt = new Date().toISOString();
      const parsedYear = data.year !== null && data.year !== undefined && data.year !== '' ? Number(data.year) : null;
      const parsedRating = data.rating !== null && data.rating !== undefined ? Number(data.rating) : 5;

      await env.DB.prepare(
        `INSERT INTO items (
          id, roomId, container, title, originalTitle, year, cover,
          creators, [cast], genres, audience, weather, daytime,
          seasons, moods, stages, specialDates, tags, rating,
          ownerNote, body, date, place, gallery, videoUrl, likes, addedBy, visibility, audio, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          candidateId,
          roomId,
          container,
          data.title,
          data.originalTitle ?? null,
          parsedYear,
          data.cover,
          JSON.stringify(data.creators || []),
          JSON.stringify(data.cast || []),
          JSON.stringify(data.genres || []),
          data.audience ?? null,
          JSON.stringify(data.weather || []),
          data.daytime ?? null,
          JSON.stringify(data.seasons || []),
          JSON.stringify(data.moods || []),
          JSON.stringify(data.stages || []),
          JSON.stringify(data.specialDates || []),
          JSON.stringify(data.tags || []),
          parsedRating,
          data.ownerNote ?? '',
          data.body ?? '',
          data.date ?? null,
          data.place ?? null,
          JSON.stringify(data.gallery || []),
          data.videoUrl ?? null,
          0,
          auth.name,
          data.visibility === 'privado' ? 'privado' : 'publico',
          data.audio,
          createdAt
        )
        .run();

      const created = await getItemById(env.DB, candidateId);
      return jsonRes(created, 201);
    } catch (err) {
      console.error('[Worker] Error creating item:', err);
      return jsonRes({ error: 'No se pudo guardar el ítem.' }, 500);
    }
  }

  // Rutas /api/items/:id/comments y /api/items/:id/like
  const itemSubMatch = path.match(/^\/api\/items\/([^/]+)\/(comments|like)$/);
  if (itemSubMatch) {
    const itemId = decodeURIComponent(itemSubMatch[1]);
    const sub = itemSubMatch[2];

    if (sub === 'comments' && method === 'GET') {
      const item = await getItemById(env.DB, itemId);
      if (!isVisible(viewer, item)) return jsonRes({ error: 'No encontramos ese ítem.' }, 404);
      const { results } = await env.DB.prepare(
        'SELECT id, itemId, author, body, rating, createdAt FROM comments WHERE itemId = ? ORDER BY id ASC'
      )
        .bind(itemId)
        .all();
      return jsonRes(results || []);
    }

    if (sub === 'comments' && method === 'POST') {
      const reqBody = await readJsonSafe(request);
      if (reqBody === null) return jsonRes({ error: 'El formato de datos enviado no es válido.' }, 400);
      const item = await getItemById(env.DB, itemId);
      const auth = verifyPasscode(reqBody?.passcode, passcodes) ?? viewer;
      if (!isVisible(auth, item)) return jsonRes({ error: 'No encontramos ese ítem.' }, 404);
      if (!auth) return jsonRes({ error: 'Tu sesión no es válida. Volvé a entrar desde el pasillo.' }, 401);
      if (auth.role !== 'owner' || auth.roomId === item.roomId) {
        const other = roomsData.find((r) => r.id !== item.roomId);
        return jsonRes(
          { error: `Las cosas de ${roomName(item.roomId)} solo las puede comentar ${other?.name ?? 'la otra persona'}.` },
          403
        );
      }

      const commentText = reqBody?.body;
      if (!commentText || typeof commentText !== 'string' || commentText.trim().length === 0 || commentText.length > 1000) {
        return jsonRes({ error: 'El comentario no puede estar vacío ni tener más de 1000 caracteres.' }, 400);
      }
      const rating = parseRating(reqBody.rating);
      if (rating.error) return jsonRes({ error: rating.error }, 400);

      if (!commentsLimiter.check(clientIp)) {
        return jsonRes({ error: 'Pará un poquito, probá de nuevo en unos minutos.' }, 429);
      }

      const createdAt = new Date().toISOString();
      const res = await env.DB.prepare(
        'INSERT INTO comments (itemId, author, body, rating, createdAt) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(item.id, auth.name, commentText.trim(), rating.value, createdAt)
        .run();

      return jsonRes(
        {
          id: Number(res.meta?.last_row_id),
          itemId: item.id,
          author: auth.name,
          body: commentText.trim(),
          rating: rating.value,
          createdAt,
        },
        201
      );
    }

    if (sub === 'like' && method === 'POST') {
      if (viewer?.role === 'readonly') return jsonRes({ error: 'Tu usuario es de solo lectura.' }, 403);
      const item = await getItemById(env.DB, itemId);
      if (!isVisible(viewer, item)) return jsonRes({ error: 'No encontramos ese ítem.' }, 404);

      const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
      const existing = await env.DB.prepare(
        'SELECT 1 FROM likes_log WHERE item_id = ? AND ip = ? AND created_at > ? LIMIT 1'
      )
        .bind(itemId, clientIp, twelveHoursAgo)
        .first();

      if (existing) {
        return jsonRes({ error: 'Ya le diste me gusta a esto hace poco.', likes: item.likes }, 429);
      }

      await env.DB.batch([
        env.DB.prepare('INSERT INTO likes_log (item_id, ip, created_at) VALUES (?, ?, ?)').bind(itemId, clientIp, Date.now()),
        env.DB.prepare('UPDATE items SET likes = likes + 1 WHERE id = ?').bind(itemId),
      ]);

      const updated = await env.DB.prepare('SELECT likes FROM items WHERE id = ?').bind(itemId).first();
      return jsonRes({ likes: Number(updated?.likes) || 0 });
    }
  }

  // Rutas /api/items/:id (GET, PUT, DELETE)
  const itemMatch = path.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch) {
    const itemId = decodeURIComponent(itemMatch[1]);

    if (method === 'GET') {
      const item = await getItemById(env.DB, itemId);
      if (!isVisible(viewer, item)) return jsonRes({ error: 'No encontramos ese ítem.' }, 404);
      return jsonRes(item);
    }

    if (method === 'PUT') {
      const parsed = await parseMultipartOrJson(request);
      if (parsed.error) return jsonRes({ error: parsed.error }, 400);
      const { body, files } = parsed;

      const item = await getItemById(env.DB, itemId);
      const auth = verifyPasscode(body?.passcode, passcodes) ?? viewer;
      if (!isVisible(auth, item)) return jsonRes({ error: 'No encontramos ese ítem.' }, 404);
      if (!auth) return jsonRes({ error: 'Tu sesión no es válida. Volvé a entrar desde el pasillo.' }, 401);
      if (item.addedBy !== auth.name) {
        return jsonRes(
          { error: `Esto lo agregó ${item.addedBy ?? 'otra persona'}: solo esa persona lo puede modificar.` },
          403
        );
      }

      const { data, error } = readItemFields(body, { partial: true });
      if (error) return jsonRes({ error }, 400);

      try {
        const newCover = await resolveCover(env.DB, files, body, item.roomId, item.container);
        if (newCover) {
          await removeMediaFromD1(env.DB, item.cover);
          data.cover = newCover;
        } else if (body.removeCover === '1') {
          await removeMediaFromD1(env.DB, item.cover);
          data.cover = null;
        }

        if (body.keepGallery !== undefined || (files.gallery && files.gallery.length > 0)) {
          const keep = parseArrayField(body.keepGallery).filter((u) => item.gallery.includes(u));
          for (const old of item.gallery) {
            if (!keep.includes(old)) await removeMediaFromD1(env.DB, old);
          }
          const added = [];
          const slots = Math.max(0, MAX_GALLERY - keep.length);
          for (const gf of (files.gallery || []).slice(0, slots)) {
            added.push(await storeUploadedFile(env.DB, gf, item.roomId, item.container, 'gallery'));
          }
          data.gallery = [...keep, ...added].slice(0, MAX_GALLERY);
        }

        const audioFile = files.audio?.[0];
        if (audioFile) {
          await removeMediaFromD1(env.DB, item.audio);
          data.audio = await storeUploadedFile(env.DB, audioFile, item.roomId, item.container, 'audio');
        } else if (body.removeAudio === '1') {
          await removeMediaFromD1(env.DB, item.audio);
          data.audio = null;
        }

        const jsonCols = new Set(['creators', 'cast', 'genres', 'weather', 'seasons', 'moods', 'stages', 'specialDates', 'tags', 'gallery']);
        const allowed = [
          'title', 'originalTitle', 'year', 'cover', 'creators', 'cast', 'genres', 'audience', 'weather', 'daytime',
          'seasons', 'moods', 'stages', 'specialDates', 'tags', 'rating', 'ownerNote', 'body', 'date', 'place',
          'gallery', 'videoUrl', 'visibility', 'audio',
        ];
        const sets = [];
        const params = [];
        for (const key of allowed) {
          if (!(key in data)) continue;
          let v = data[key];
          if (jsonCols.has(key)) v = JSON.stringify(Array.isArray(v) ? v : []);
          if (key === 'year') v = v === null || v === '' || v === undefined ? null : Number(v);
          if (key === 'rating') v = v === null || v === '' || v === undefined ? 5 : Number(v);
          if (key === 'visibility') v = v === 'privado' ? 'privado' : 'publico';
          sets.push(`${key === 'cast' ? '[cast]' : key} = ?`);
          params.push(v === undefined ? null : v);
        }
        if (sets.length > 0) {
          await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...params, item.id).run();
        }
        return jsonRes(await getItemById(env.DB, item.id));
      } catch (err) {
        console.error('[Worker] Error updating item:', err);
        return jsonRes({ error: 'No se pudo guardar el cambio.' }, 500);
      }
    }

    if (method === 'DELETE') {
      const reqBody = await readJsonSafe(request);
      const item = await getItemById(env.DB, itemId);
      const auth = verifyPasscode(reqBody?.passcode, passcodes) ?? viewer;
      if (!isVisible(auth, item)) return jsonRes({ error: 'No encontramos ese ítem.' }, 404);
      if (!auth) return jsonRes({ error: 'Tu sesión no es válida. Volvé a entrar desde el pasillo.' }, 401);
      if (item.addedBy !== auth.name) {
        return jsonRes(
          { error: `Esto lo agregó ${item.addedBy ?? 'otra persona'}: solo esa persona lo puede modificar.` },
          403
        );
      }

      await env.DB.batch([
        env.DB.prepare('DELETE FROM comments WHERE itemId = ?').bind(item.id),
        env.DB.prepare('DELETE FROM likes_log WHERE item_id = ?').bind(item.id),
        env.DB.prepare('DELETE FROM items WHERE id = ?').bind(item.id),
      ]);

      for (const u of [item.cover, item.audio, ...item.gallery]) {
        await removeMediaFromD1(env.DB, u);
      }

      return jsonRes({ ok: true });
    }
  }

  return jsonRes({ error: 'Recurso de la API no encontrado.' }, 404);
}

// ---------- Entrypoint del Cloudflare Worker ----------

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return await handleApi(request, env, url);
      }
      if (url.pathname.startsWith('/media/')) {
        return await serveMedia(request, env, url.pathname);
      }
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error('[Worker Uncaught Error]', err);
      return jsonRes({ error: 'Ocurrió un error inesperado en el servidor.' }, 500);
    }
  },
};
