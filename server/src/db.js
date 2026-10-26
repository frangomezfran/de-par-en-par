import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

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
  'actividades'
];

/** Versión del esquema/datos (PRAGMA user_version). Ver migrate(). */
export const SCHEMA_VERSION = 2;

export const VALID_VISIBILITY = ['publico', 'privado'];

export const VALID_WEATHER = [
  'soleado',
  'nublado',
  'lluvioso',
  'tormenta',
  'nevado',
  'niebla'
];

export const VALID_DAYTIME = ['diurno', 'nocturno', 'cualquiera'];

export const VALID_SEASONS = ['verano', 'otono', 'invierno', 'primavera'];

export const VALID_MOODS = [
  'alegre',
  'tierno',
  'nostalgico',
  'melancolico',
  'tranquilo',
  'energico',
  'divertido',
  'valiente'
];

export const VALID_STAGES = [
  'embarazo',
  'bebe',
  'primeros-anios',
  'ninez',
  'adolescencia',
  'siempre'
];

export const VALID_SPECIAL_DATES = [
  'cumple-amelia',
  'cumple-mariana',
  'cumple-franco',
  'navidad',
  'anio-nuevo',
  'halloween'
];

export const VALID_AUDIENCE = ['ATP', '+13', '+16', '+18'];

export function slugify(str) {
  if (!str) return 'item';
  const clean = String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return clean || 'item';
}

export function normalizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Checks if a /media/ file exists in DATA_DIR/media.
 */
export function checkMediaExists(urlPath, dataDir) {
  if (!urlPath || typeof urlPath !== 'string') return false;
  if (!urlPath.startsWith('/media/')) return true; // keep non-/media URLs
  const relativePart = urlPath.slice('/media/'.length);
  const safeRelative = path.normalize(relativePart).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(dataDir, 'media', safeRelative);
  return fs.existsSync(fullPath);
}

/**
 * Formats a raw database row into an Item object matching contract §4,
 * verifying cover and gallery media existence and adding decade and commentCount.
 */
export function formatItemOutput(row, dataDir) {
  if (!row) return null;

  const parseJsonArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const cover = row.cover && checkMediaExists(row.cover, dataDir) ? row.cover : null;
  const rawGallery = parseJsonArray(row.gallery);
  const gallery = rawGallery.filter((url) => checkMediaExists(url, dataDir));

  const year = row.year !== null && row.year !== undefined ? Number(row.year) : null;
  const decade = year !== null && !isNaN(year) ? `${Math.floor(year / 10) * 10}s` : null;

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
    audio: row.audio && checkMediaExists(row.audio, dataDir) ? row.audio : null,
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
    commentCount: row.commentCount !== undefined ? Number(row.commentCount) : 0
  };
}

export class AmeliaDb {
  constructor(dbPath, dataDir) {
    this.dbPath = dbPath;
    this.dataDir = dataDir;
    this.db = new DatabaseSync(dbPath);

    // Register custom function for case- and diacritics-insensitive search
    this.db.function('normalize_text', (str) => normalizeText(str));

    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
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
        rating INTEGER,
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
      );

      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        itemId TEXT NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        rating REAL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS likes_log (
        item_id TEXT NOT NULL,
        ip TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_items_room_container ON items (roomId, container);
      CREATE INDEX IF NOT EXISTS idx_comments_item_id ON comments (itemId);
      CREATE INDEX IF NOT EXISTS idx_likes_log_item_ip ON likes_log (item_id, ip);
    `);
    this.migrate();
  }

  /**
   * Migraciones de bases ya existentes, paso a paso. No borran nada de lo cargado.
   *  v1 (segunda iteración): columna addedBy; películas + series => "audiovisual";
   *      festividades de los ítems de ejemplo según data/items.json.
   *  v2 (tercera iteración): "audiovisual" se vuelve a separar en "peliculas" (pila de
   *      VHS) y "series" (tele); columnas visibility (publico/privado) y audio (mp3);
   *      calificación con estrellas en los comentarios.
   */
  migrate() {
    const version = Number(this.db.prepare('PRAGMA user_version').get().user_version) || 0;
    if (version >= SCHEMA_VERSION) return;
    const columns = (table) => this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const parseTags = (raw) => {
      try {
        const t = JSON.parse(raw || '[]');
        return Array.isArray(t) ? t : [];
      } catch {
        return [];
      }
    };

    this.db.exec('BEGIN TRANSACTION');
    try {
      if (version < 1) {
        if (!columns('items').includes('addedBy')) this.db.exec('ALTER TABLE items ADD COLUMN addedBy TEXT');
        for (const room of this.getRooms()) {
          this.db.prepare('UPDATE items SET addedBy = ? WHERE roomId = ? AND addedBy IS NULL').run(room.name, room.id);
        }
        for (const [old, tag] of [['peliculas', 'pelicula'], ['series', 'serie']]) {
          const rows = this.db.prepare('SELECT id, tags FROM items WHERE container = ?').all(old);
          const upd = this.db.prepare("UPDATE items SET container = 'audiovisual', tags = ? WHERE id = ?");
          for (const r of rows) upd.run(JSON.stringify([...new Set([tag, ...parseTags(r.tags)])]), r.id);
        }
        const seedPath = path.join(this.dataDir, 'items.json');
        if (fs.existsSync(seedPath)) {
          const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
          const upd = this.db.prepare('UPDATE items SET specialDates = ? WHERE id = ?');
          for (const it of seed) upd.run(JSON.stringify(it.specialDates || []), it.id);
        }
      }

      if (version < 2) {
        const itemCols = columns('items');
        if (!itemCols.includes('visibility')) this.db.exec("ALTER TABLE items ADD COLUMN visibility TEXT DEFAULT 'publico'");
        if (!itemCols.includes('audio')) this.db.exec('ALTER TABLE items ADD COLUMN audio TEXT');
        if (!columns('comments').includes('rating')) this.db.exec('ALTER TABLE comments ADD COLUMN rating REAL');
        this.db.exec("UPDATE items SET visibility = 'publico' WHERE visibility IS NULL");
        // la tele (series y videos) y la pila de VHS (películas) vuelven a ser contenedores distintos
        const rows = this.db.prepare("SELECT id, tags FROM items WHERE container = 'audiovisual'").all();
        const upd = this.db.prepare('UPDATE items SET container = ?, tags = ? WHERE id = ?');
        for (const r of rows) {
          const tags = parseTags(r.tags);
          const container = tags.includes('serie') || tags.includes('video') ? 'series' : 'peliculas';
          upd.run(container, JSON.stringify(tags.filter((t) => t !== 'pelicula' && t !== 'serie')), r.id);
        }
      }

      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.db.exec('COMMIT');
      console.log(`[AmeliaDb] Esquema en v${SCHEMA_VERSION}.`);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  seedIfEmpty() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM items').get();
    if (row && row.count === 0) {
      this.seedFromItemsJson();
    }
  }

  seedFromItemsJson() {
    const itemsJsonPath = path.join(this.dataDir, 'items.json');
    if (!fs.existsSync(itemsJsonPath)) {
      console.warn(`[AmeliaDb] items.json not found at ${itemsJsonPath}`);
      return;
    }

    const raw = fs.readFileSync(itemsJsonPath, 'utf-8');
    const items = JSON.parse(raw);

    const insertStmt = this.db.prepare(`
      INSERT INTO items (
        id, roomId, container, title, originalTitle, year, cover,
        creators, [cast], genres, audience, weather, daytime,
        seasons, moods, stages, specialDates, tags, rating,
        ownerNote, body, date, place, gallery, videoUrl, likes, addedBy, visibility, audio, createdAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        insertStmt.run(
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
          item.addedBy || null,
          item.visibility === 'privado' ? 'privado' : 'publico',
          item.audio || null,
          item.createdAt || new Date().toISOString()
        );
      }
      this.db.exec('COMMIT');
      console.log(`[AmeliaDb] Seeded ${items.length} items successfully.`);
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.error('[AmeliaDb] Error seeding items:', err);
      throw err;
    }
  }

  reseed() {
    this.db.exec('DELETE FROM items');
    this.seedFromItemsJson();
  }

  getRooms() {
    const roomsPath = path.join(this.dataDir, 'rooms.json');
    if (!fs.existsSync(roomsPath)) return [];
    try {
      const raw = fs.readFileSync(roomsPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  getRoom(roomId) {
    const rooms = this.getRooms();
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return null;

    const counts = this.db
      .prepare('SELECT container, COUNT(*) as count FROM items WHERE roomId = ? GROUP BY container')
      .all(roomId);
    const countMap = new Map(counts.map((c) => [c.container, Number(c.count)]));

    const containers = CANONICAL_CONTAINERS.map((slug) => ({
      slug,
      count: countMap.get(slug) || 0
    }));

    return {
      ...room,
      containers
    };
  }

  getItems(filters = {}) {
    let sql = `
      SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.itemId = i.id) as commentCount
      FROM items i
      WHERE 1=1
    `;
    const params = [];

    // Los privados solo los ven los dueños de las piezas
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

    if (filters.weather) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(i.weather) WHERE value = ?)`;
      params.push(filters.weather);
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
        const endYear = startYear + 9;
        sql += ` AND i.year IS NOT NULL AND i.year >= ? AND i.year <= ?`;
        params.push(startYear, endYear);
      }
    }

    if (filters.genre) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(i.genres) WHERE normalize_text(value) = normalize_text(?))`;
      params.push(filters.genre);
    }

    if (filters.mood) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(i.moods) WHERE value = ?)`;
      params.push(filters.mood);
    }

    if (filters.stage) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(i.stages) WHERE value = ?)`;
      params.push(filters.stage);
    }

    if (filters.date) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(i.specialDates) WHERE value = ?)`;
      params.push(filters.date);
    }

    if (filters.tag) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(i.tags) WHERE value = ?)`;
      params.push(filters.tag);
    }

    if (filters.q) {
      sql += ` AND normalize_text(i.title || ' ' || coalesce(i.originalTitle, '') || ' ' || i.creators || ' ' || i.[cast] || ' ' || coalesce(i.ownerNote, '') || ' ' || coalesce(i.body, '')) LIKE '%' || normalize_text(?) || '%'`;
      params.push(filters.q);
    }

    switch (filters.sort) {
      case 'za':
        sql += ` ORDER BY normalize_text(i.title) DESC`;
        break;
      case 'anio-asc':
        sql += ` ORDER BY (CASE WHEN i.year IS NULL THEN 1 ELSE 0 END) ASC, i.year ASC, normalize_text(i.title) ASC`;
        break;
      case 'anio-desc':
        sql += ` ORDER BY (CASE WHEN i.year IS NULL THEN 1 ELSE 0 END) ASC, i.year DESC, normalize_text(i.title) ASC`;
        break;
      case 'recientes':
        sql += ` ORDER BY i.createdAt DESC, i.id ASC`;
        break;
      case 'az':
      default:
        sql += ` ORDER BY normalize_text(i.title) ASC`;
        break;
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => formatItemOutput(r, this.dataDir));
  }

  getItemById(id) {
    const row = this.db
      .prepare(`
        SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.itemId = i.id) as commentCount
        FROM items i
        WHERE i.id = ?
      `)
      .get(id);
    if (!row) return null;
    return formatItemOutput(row, this.dataDir);
  }

  getComments(itemId) {
    // Return comments ascending by id / createdAt
    return this.db
      .prepare('SELECT id, itemId, author, body, rating, createdAt FROM comments WHERE itemId = ? ORDER BY id ASC')
      .all(itemId);
  }

  addComment(itemId, author, body, rating = null) {
    const createdAt = new Date().toISOString();
    const res = this.db
      .prepare('INSERT INTO comments (itemId, author, body, rating, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(itemId, author, body, rating, createdAt);
    return {
      id: Number(res.lastInsertRowid),
      itemId,
      author,
      body,
      rating,
      createdAt
    };
  }

  addLike(itemId, ip) {
    const item = this.db.prepare('SELECT likes FROM items WHERE id = ?').get(itemId);
    if (!item) return { notFound: true };

    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    const existing = this.db
      .prepare('SELECT 1 FROM likes_log WHERE item_id = ? AND ip = ? AND created_at > ? LIMIT 1')
      .get(itemId, ip, twelveHoursAgo);

    if (existing) {
      return {
        alreadyLiked: true,
        likes: Number(item.likes)
      };
    }

    this.db.prepare('INSERT INTO likes_log (item_id, ip, created_at) VALUES (?, ?, ?)').run(
      itemId,
      ip,
      Date.now()
    );
    this.db.prepare('UPDATE items SET likes = likes + 1 WHERE id = ?').run(itemId);

    const updated = this.db.prepare('SELECT likes FROM items WHERE id = ?').get(itemId);
    return {
      alreadyLiked: false,
      likes: Number(updated.likes)
    };
  }

  createItem(itemData) {
    const {
      roomId,
      container,
      title,
      originalTitle = null,
      year = null,
      cover = null,
      creators = [],
      cast = [],
      genres = [],
      audience = null,
      weather = [],
      daytime = null,
      seasons = [],
      moods = [],
      stages = [],
      specialDates = [],
      tags = [],
      rating = 5,
      ownerNote = '',
      body = '',
      date = null,
      place = null,
      gallery = [],
      videoUrl = null,
      addedBy = null,
      visibility = 'publico',
      audio = null
    } = itemData;

    // Generate unique ID: <roomId>-<container>-<slug(title)>[-n]
    const baseSlug = slugify(title);
    let candidateId = `${roomId}-${container}-${baseSlug}`;
    let counter = 2;
    while (this.db.prepare('SELECT 1 FROM items WHERE id = ?').get(candidateId)) {
      candidateId = `${roomId}-${container}-${baseSlug}-${counter}`;
      counter++;
    }

    const createdAt = new Date().toISOString();
    const parsedYear = year !== null && year !== undefined && year !== '' ? Number(year) : null;
    const parsedRating = rating !== null && rating !== undefined ? Number(rating) : 5;

    this.db
      .prepare(`
        INSERT INTO items (
          id, roomId, container, title, originalTitle, year, cover,
          creators, [cast], genres, audience, weather, daytime,
          seasons, moods, stages, specialDates, tags, rating,
          ownerNote, body, date, place, gallery, videoUrl, likes, addedBy, visibility, audio, createdAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)
      .run(
        candidateId,
        roomId,
        container,
        title,
        originalTitle,
        parsedYear,
        cover,
        JSON.stringify(Array.isArray(creators) ? creators : []),
        JSON.stringify(Array.isArray(cast) ? cast : []),
        JSON.stringify(Array.isArray(genres) ? genres : []),
        audience,
        JSON.stringify(Array.isArray(weather) ? weather : []),
        daytime,
        JSON.stringify(Array.isArray(seasons) ? seasons : []),
        JSON.stringify(Array.isArray(moods) ? moods : []),
        JSON.stringify(Array.isArray(stages) ? stages : []),
        JSON.stringify(Array.isArray(specialDates) ? specialDates : []),
        JSON.stringify(Array.isArray(tags) ? tags : []),
        parsedRating,
        ownerNote,
        body,
        date,
        place,
        JSON.stringify(Array.isArray(gallery) ? gallery : []),
        videoUrl,
        0,
        addedBy,
        visibility === 'privado' ? 'privado' : 'publico',
        audio,
        createdAt
      );

    return this.getItemById(candidateId);
  }

  getStats({ room, container, includePrivate = false } = {}) {
    let whereSql = includePrivate ? '1=1' : "(visibility IS NULL OR visibility != 'privado')";
    const params = [];

    if (room) {
      whereSql += ' AND roomId = ?';
      params.push(room);
    }
    if (container && container !== 'ventana') {
      whereSql += ' AND container = ?';
      params.push(container);
    }

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM items WHERE ${whereSql}`)
      .get(...params);
    const total = totalRow ? Number(totalRow.count) : 0;

    const byDecade = this.db
      .prepare(`
        SELECT ((year / 10) * 10) || 's' as key, COUNT(*) as count
        FROM items
        WHERE ${whereSql} AND year IS NOT NULL
        GROUP BY (year / 10)
        ORDER BY year ASC
      `)
      .all(...params)
      .map((r) => ({ key: r.key, count: Number(r.count) }));

    const byGenre = this.db
      .prepare(`
        SELECT value as key, COUNT(*) as count
        FROM items, json_each(items.genres)
        WHERE ${whereSql}
        GROUP BY value
        ORDER BY count DESC, key ASC
      `)
      .all(...params)
      .map((r) => ({ key: r.key, count: Number(r.count) }));

    const byMood = this.db
      .prepare(`
        SELECT value as key, COUNT(*) as count
        FROM items, json_each(items.moods)
        WHERE ${whereSql}
        GROUP BY value
        ORDER BY count DESC, key ASC
      `)
      .all(...params)
      .map((r) => ({ key: r.key, count: Number(r.count) }));

    const byWeather = this.db
      .prepare(`
        SELECT value as key, COUNT(*) as count
        FROM items, json_each(items.weather)
        WHERE ${whereSql}
        GROUP BY value
        ORDER BY count DESC, key ASC
      `)
      .all(...params)
      .map((r) => ({ key: r.key, count: Number(r.count) }));

    // compare = mismo contenedor en la otra habitación
    let compare = null;
    let otherRoom = null;
    if (room === 'mariana') otherRoom = 'franco';
    else if (room === 'franco') otherRoom = 'mariana';

    if (otherRoom) {
      let compWhere = includePrivate ? 'roomId = ?' : "roomId = ? AND (visibility IS NULL OR visibility != 'privado')";
      const compParams = [otherRoom];
      if (container && container !== 'ventana') {
        compWhere += ' AND container = ?';
        compParams.push(container);
      }
      const compRow = this.db
        .prepare(`SELECT COUNT(*) as count FROM items WHERE ${compWhere}`)
        .get(...compParams);
      compare = {
        roomId: otherRoom,
        total: compRow ? Number(compRow.count) : 0
      };
    }

    // shared = títulos (case-insensitive por originalTitle o title) presentes en ambas
    let shared = [];
    if (otherRoom) {
      let sharedSql = `
        SELECT i1.title as title, i2.id as otherId, i2.container as otherContainer
        FROM items i1
        JOIN items i2 ON i2.roomId = ?
          AND (
            (i1.originalTitle IS NOT NULL AND i2.originalTitle IS NOT NULL AND normalize_text(i1.originalTitle) = normalize_text(i2.originalTitle))
            OR normalize_text(i1.title) = normalize_text(i2.title)
          )
        WHERE i1.roomId = ?${includePrivate ? '' : " AND (i1.visibility IS NULL OR i1.visibility != 'privado') AND (i2.visibility IS NULL OR i2.visibility != 'privado')"}
      `;
      const sharedParams = [otherRoom, room];
      if (container && container !== 'ventana') {
        sharedSql += ` AND i1.container = ? AND i2.container = ?`;
        sharedParams.push(container, container);
      }
      shared = this.db.prepare(sharedSql).all(...sharedParams);
    } else {
      let sharedSql = `
        SELECT i1.title as title, i2.id as otherId, i2.container as otherContainer
        FROM items i1
        JOIN items i2 ON i2.roomId = 'franco'
          AND (
            (i1.originalTitle IS NOT NULL AND i2.originalTitle IS NOT NULL AND normalize_text(i1.originalTitle) = normalize_text(i2.originalTitle))
            OR normalize_text(i1.title) = normalize_text(i2.title)
          )
        WHERE i1.roomId = 'mariana'${includePrivate ? '' : " AND (i1.visibility IS NULL OR i1.visibility != 'privado') AND (i2.visibility IS NULL OR i2.visibility != 'privado')"}
      `;
      const sharedParams = [];
      if (container && container !== 'ventana') {
        sharedSql += ` AND i1.container = ? AND i2.container = ?`;
        sharedParams.push(container, container);
      }
      shared = this.db.prepare(sharedSql).all(...sharedParams);
    }

    return {
      total,
      byDecade,
      byGenre,
      byMood,
      byWeather,
      compare,
      shared
    };
  }

  /** Actualiza un ítem existente (solo los campos que vengan). Devuelve el ítem actualizado. */
  updateItem(id, data) {
    const json = new Set(['creators', 'cast', 'genres', 'weather', 'seasons', 'moods', 'stages', 'specialDates', 'tags', 'gallery']);
    const allowed = [
      'title', 'originalTitle', 'year', 'cover', 'creators', 'cast', 'genres', 'audience', 'weather', 'daytime',
      'seasons', 'moods', 'stages', 'specialDates', 'tags', 'rating', 'ownerNote', 'body', 'date', 'place',
      'gallery', 'videoUrl', 'visibility', 'audio'
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (!(key in data)) continue;
      let v = data[key];
      if (json.has(key)) v = JSON.stringify(Array.isArray(v) ? v : []);
      if (key === 'year') v = v === null || v === '' || v === undefined ? null : Number(v);
      if (key === 'rating') v = v === null || v === '' || v === undefined ? 5 : Number(v);
      if (key === 'visibility') v = v === 'privado' ? 'privado' : 'publico';
      sets.push(`${key === 'cast' ? '[cast]' : key} = ?`);
      params.push(v === undefined ? null : v);
    }
    if (sets.length) this.db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return this.getItemById(id);
  }

  /** Borra un ítem con sus comentarios y "me gusta" */
  deleteItem(id) {
    this.db.prepare('DELETE FROM comments WHERE itemId = ?').run(id);
    this.db.prepare('DELETE FROM likes_log WHERE item_id = ?').run(id);
    return this.db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
  }

  /**
   * Coincidencias entre las dos piezas (el espejo): mismo título o título original,
   * sin importar el contenedor. Para cada lado: el ítem (con su nota y su calificación)
   * y los comentarios que dejó la otra persona.
   */
  getCoincidences({ includePrivate = false } = {}) {
    const priv = includePrivate
      ? ''
      : " AND (a.visibility IS NULL OR a.visibility != 'privado') AND (b.visibility IS NULL OR b.visibility != 'privado')";
    const rows = this.db
      .prepare(`
        SELECT a.id AS aId, b.id AS bId
        FROM items a
        JOIN items b ON b.roomId = 'franco'
          AND (
            normalize_text(a.title) = normalize_text(b.title)
            OR (coalesce(a.originalTitle, '') != '' AND normalize_text(a.originalTitle) = normalize_text(coalesce(nullif(b.originalTitle, ''), b.title)))
            OR (coalesce(b.originalTitle, '') != '' AND normalize_text(b.originalTitle) = normalize_text(a.title))
          )
        WHERE a.roomId = 'mariana'${priv}
        ORDER BY normalize_text(a.title)
      `)
      .all();
    const side = (id) => ({ item: this.getItemById(id), comments: this.getComments(id) });
    return rows.map((r) => ({ mariana: side(r.aId), franco: side(r.bId) }));
  }

  close() {
    this.db.close();
  }
}
