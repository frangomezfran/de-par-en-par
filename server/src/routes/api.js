import { Router } from 'express';
import path from 'node:path';
import { verifyPasscode } from '../auth.js';
import {
  CANONICAL_CONTAINERS,
  VALID_WEATHER,
  VALID_DAYTIME,
  VALID_SEASONS,
  VALID_MOODS,
  VALID_STAGES,
  VALID_SPECIAL_DATES,
  VALID_AUDIENCE,
  VALID_VISIBILITY
} from '../db.js';
import {
  createUploader,
  finalizeUpload,
  cleanupTempFile,
  checkUploadSizes,
  removeMedia,
  UPLOAD_FIELDS,
  MAX_GALLERY
} from '../upload.js';
import { commentsLimiter, MemoryRateLimiter } from '../rateLimit.js';
import { lookup, downloadCover, LOOKUP_CONTAINERS } from '../lookup.js';

const lookupLimiter = new MemoryRateLimiter(60 * 1000, 30);

/** Calificación con medias estrellas: 0,5 a 5 */
export function parseRating(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') return required ? { error: 'Falta la calificación.' } : { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0.5 || n > 5 || !Number.isInteger(n * 2)) {
    return { error: 'La calificación va de media estrella a 5 estrellas.' };
  }
  return { value: n };
}

const parseArrayField = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return val.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
};

/** Lee y valida los campos de un ítem que vienen en el multipart. Devuelve { data } o { error }. */
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
    ['specialDates', VALID_SPECIAL_DATES, 'La fecha especial']
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

export function createApiRouter({ db, dataDir, passcodes }) {
  const router = Router();
  const uploader = createUploader(dataDir);
  const rooms = () => db.getRooms();
  const roomName = (id) => rooms().find((r) => r.id === id)?.name ?? id;

  // Quién está mirando (encabezado X-Amelia-Pass con la clave de la sesión)
  router.use((req, res, next) => {
    req.viewer = verifyPasscode(req.get('x-amelia-pass'), passcodes);
    next();
  });
  // Lo privado solo lo ven los dueños de las piezas (Mariana y Franco)
  const seesPrivate = (req) => req.viewer?.role === 'owner';
  const visible = (req, item) => item && (item.visibility !== 'privado' || seesPrivate(req));

  /** Multer con los 3 campos de archivo + validación de tamaños */
  const withUploads = (req, res, next) => {
    uploader.fields(UPLOAD_FIELDS)(req, res, (err) => {
      if (err) {
        cleanupTempFile(req);
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo es demasiado pesado (máximo 20 MB para audio, 8 MB para imágenes).' });
        if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: `Podés subir una portada, hasta ${MAX_GALLERY} fotos más y un mp3.` });
        }
        return res.status(err.status || 400).json({ error: err.message || 'Error al subir el archivo.' });
      }
      const sizeError = checkUploadSizes(req);
      if (sizeError) {
        cleanupTempFile(req);
        return res.status(400).json({ error: sizeError });
      }
      next();
    });
  };

  const fileOf = (req, field) => req.files?.[field]?.[0] ?? null;
  const filesOf = (req, field) => req.files?.[field] ?? [];

  // GET /api/health
  router.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  // GET /api/rooms
  router.get('/rooms', (req, res) => {
    res.json(rooms());
  });

  // GET /api/rooms/:roomId
  router.get('/rooms/:roomId', (req, res) => {
    const room = db.getRoom(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'No encontramos esa habitación.' });
    res.json(room);
  });

  // GET /api/items
  router.get('/items', (req, res) => {
    const { room, container, weather, daytime, decade, genre, mood, stage, date, tag, q, sort } = req.query;
    res.json(
      db.getItems({ room, container, weather, daytime, decade, genre, mood, stage, date, tag, q, sort, includePrivate: seesPrivate(req) })
    );
  });

  // GET /api/items/:id
  router.get('/items/:id', (req, res) => {
    const item = db.getItemById(req.params.id);
    if (!visible(req, item)) return res.status(404).json({ error: 'No encontramos ese ítem.' });
    res.json(item);
  });

  // GET /api/items/:id/comments
  router.get('/items/:id/comments', (req, res) => {
    const item = db.getItemById(req.params.id);
    if (!visible(req, item)) return res.status(404).json({ error: 'No encontramos ese ítem.' });
    res.json(db.getComments(req.params.id));
  });

  // POST /api/items/:id/comments  { passcode, body, rating? }
  // Comenta solo la otra persona: Franco en lo de Mariana y Mariana en lo de Franco.
  router.post('/items/:id/comments', (req, res) => {
    const item = db.getItemById(req.params.id);
    const auth = verifyPasscode(req.body?.passcode, passcodes) ?? req.viewer;
    if (!visible({ viewer: auth }, item)) return res.status(404).json({ error: 'No encontramos ese ítem.' });
    if (!auth) return res.status(401).json({ error: 'Tu sesión no es válida. Volvé a entrar desde el pasillo.' });
    if (auth.role !== 'owner' || auth.roomId === item.roomId) {
      const other = rooms().find((r) => r.id !== item.roomId);
      return res.status(403).json({ error: `Las cosas de ${roomName(item.roomId)} solo las puede comentar ${other?.name ?? 'la otra persona'}.` });
    }

    const { body } = req.body || {};
    if (!body || typeof body !== 'string' || body.trim().length === 0 || body.length > 1000) {
      return res.status(400).json({ error: 'El comentario no puede estar vacío ni tener más de 1000 caracteres.' });
    }
    const rating = parseRating(req.body.rating);
    if (rating.error) return res.status(400).json({ error: rating.error });

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    if (!commentsLimiter.check(clientIp)) {
      return res.status(429).json({ error: 'Pará un poquito, probá de nuevo en unos minutos.' });
    }
    res.status(201).json(db.addComment(item.id, auth.name, body.trim(), rating.value));
  });

  // POST /api/items/:id/like
  router.post('/items/:id/like', (req, res) => {
    if (req.viewer?.role === 'readonly') {
      return res.status(403).json({ error: 'Tu usuario es de solo lectura.' });
    }
    if (!visible(req, db.getItemById(req.params.id))) return res.status(404).json({ error: 'No encontramos ese ítem.' });
    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const result = db.addLike(req.params.id, clientIp);
    if (result.notFound) return res.status(404).json({ error: 'No encontramos ese ítem.' });
    if (result.alreadyLiked) return res.status(429).json({ error: 'Ya le diste me gusta a esto hace poco.', likes: result.likes });
    res.json({ likes: result.likes });
  });

  // POST /api/auth/check
  router.post('/auth/check', (req, res) => {
    const auth = verifyPasscode(req.body?.passcode, passcodes);
    if (!auth) return res.status(401).json({ error: 'Ese código no es válido. Pedíselo a Mariana o a Franco.' });
    res.json(auth.roomId ? { name: auth.name, role: auth.role, roomId: auth.roomId } : { name: auth.name, role: auth.role });
  });

  /** Guarda la portada (archivo o imagen del asistente) y devuelve la ruta /media o undefined */
  async function resolveCover(req, roomId, container) {
    const file = fileOf(req, 'cover');
    if (file) return finalizeUpload(file, dataDir, roomId, container, 'cover');
    if (typeof req.body.coverUrl === 'string' && req.body.coverUrl.trim()) {
      try {
        return await downloadCover(req.body.coverUrl.trim(), path.join(dataDir, 'media', roomId, container), `/media/${roomId}/${container}`);
      } catch (err) {
        console.warn('[API] No se pudo descargar la portada:', err.message);
      }
    }
    return undefined;
  }

  // POST /api/items (multipart) — cada dueño agrega solo en su propia pieza
  router.post('/items', withUploads, async (req, res) => {
    const { roomId, container } = req.body || {};
    const auth = verifyPasscode(req.body?.passcode, passcodes) ?? req.viewer;
    if (!auth) {
      cleanupTempFile(req);
      return res.status(401).json({ error: 'Tu sesión no es válida. Volvé a entrar desde el pasillo.' });
    }
    if (!rooms().some((r) => r.id === roomId)) {
      cleanupTempFile(req);
      return res.status(400).json({ error: 'Esa habitación no existe.' });
    }
    if (auth.role !== 'owner' || auth.roomId !== roomId) {
      cleanupTempFile(req);
      return res.status(403).json({ error: `Solo ${roomName(roomId)} puede agregar cosas en su pieza.` });
    }
    if (!CANONICAL_CONTAINERS.includes(container)) {
      cleanupTempFile(req);
      return res.status(400).json({ error: 'El contenedor no es válido.' });
    }
    const { data, error } = readItemFields(req.body);
    if (error) {
      cleanupTempFile(req);
      return res.status(400).json({ error });
    }

    try {
      data.cover = (await resolveCover(req, roomId, container)) ?? null;
      data.gallery = filesOf(req, 'gallery')
        .slice(0, MAX_GALLERY)
        .map((f) => finalizeUpload(f, dataDir, roomId, container, 'gallery'))
        .filter(Boolean);
      const audio = fileOf(req, 'audio');
      data.audio = audio ? finalizeUpload(audio, dataDir, roomId, container, 'audio') : null;
      // en las notas, "Escribió" es quien la agrega
      if (container === 'diario' && data.creators.length === 0) data.creators = [auth.name];
      res.status(201).json(db.createItem({ ...data, roomId, container, addedBy: auth.name }));
    } catch (err) {
      cleanupTempFile(req);
      console.error('[API] Error creating item:', err);
      res.status(500).json({ error: 'No se pudo guardar el ítem.' });
    }
  });

  /** Solo quien agregó el ítem lo puede modificar o borrar */
  function ownItem(req, res) {
    const item = db.getItemById(req.params.id);
    const auth = verifyPasscode(req.body?.passcode, passcodes) ?? req.viewer;
    if (!visible({ viewer: auth }, item)) {
      res.status(404).json({ error: 'No encontramos ese ítem.' });
      return null;
    }
    if (!auth) {
      res.status(401).json({ error: 'Tu sesión no es válida. Volvé a entrar desde el pasillo.' });
      return null;
    }
    if (item.addedBy !== auth.name) {
      res.status(403).json({ error: `Esto lo agregó ${item.addedBy ?? 'otra persona'}: solo esa persona lo puede modificar.` });
      return null;
    }
    return { item, auth };
  }

  // PUT /api/items/:id (multipart) — modificar
  //   keepGallery: JSON con las fotos que quedan · removeCover / removeAudio: "1"
  router.put('/items/:id', withUploads, async (req, res) => {
    const own = ownItem(req, res);
    if (!own) return cleanupTempFile(req);
    const { item } = own;
    const { data, error } = readItemFields(req.body, { partial: true });
    if (error) {
      cleanupTempFile(req);
      return res.status(400).json({ error });
    }

    try {
      const cover = await resolveCover(req, item.roomId, item.container);
      if (cover) {
        removeMedia(item.cover, dataDir);
        data.cover = cover;
      } else if (req.body.removeCover === '1') {
        removeMedia(item.cover, dataDir);
        data.cover = null;
      }

      if (req.body.keepGallery !== undefined || filesOf(req, 'gallery').length) {
        const keep = parseArrayField(req.body.keepGallery).filter((u) => item.gallery.includes(u));
        for (const old of item.gallery) if (!keep.includes(old)) removeMedia(old, dataDir);
        const added = filesOf(req, 'gallery')
          .slice(0, Math.max(0, MAX_GALLERY - keep.length))
          .map((f) => finalizeUpload(f, dataDir, item.roomId, item.container, 'gallery'))
          .filter(Boolean);
        cleanupTempFile(req);
        data.gallery = [...keep, ...added].slice(0, MAX_GALLERY);
      }

      const audio = fileOf(req, 'audio');
      if (audio) {
        removeMedia(item.audio, dataDir);
        data.audio = finalizeUpload(audio, dataDir, item.roomId, item.container, 'audio');
      } else if (req.body.removeAudio === '1') {
        removeMedia(item.audio, dataDir);
        data.audio = null;
      }

      res.json(db.updateItem(item.id, data));
    } catch (err) {
      cleanupTempFile(req);
      console.error('[API] Error updating item:', err);
      res.status(500).json({ error: 'No se pudo guardar el cambio.' });
    }
  });

  // DELETE /api/items/:id
  router.delete('/items/:id', (req, res) => {
    const own = ownItem(req, res);
    if (!own) return;
    const { item } = own;
    db.deleteItem(item.id);
    for (const url of [item.cover, item.audio, ...item.gallery]) removeMedia(url, dataDir);
    res.json({ ok: true });
  });

  // GET /api/lookup?container=&q=  (asistente del alta)
  router.get('/lookup', async (req, res) => {
    if (req.viewer?.role === 'readonly') {
      return res.status(403).json({ error: 'Tu usuario es de solo lectura.' });
    }
    const container = String(req.query.container || '');
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (!LOOKUP_CONTAINERS.includes(container) || q.length < 2) return res.json([]);
    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    if (!lookupLimiter.check(clientIp)) {
      return res.status(429).json({ error: 'Muchas búsquedas seguidas. Esperá un minutito.' });
    }
    try {
      res.json(await lookup(container, q));
    } catch (err) {
      console.warn('[API] lookup:', err.message);
      res.status(502).json({ error: 'No pude buscar en internet ahora. Probá de nuevo o completalo a mano.' });
    }
  });

  // GET /api/stats
  router.get('/stats', (req, res) => {
    const { room, container } = req.query;
    res.json(db.getStats({ room, container, includePrivate: seesPrivate(req) }));
  });

  // GET /api/coincidences — lo que está en las dos piezas (el espejo)
  router.get('/coincidences', (req, res) => {
    res.json(db.getCoincidences({ includePrivate: seesPrivate(req) }));
  });

  return router;
}
