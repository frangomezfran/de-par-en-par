import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { AmeliaDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { parseUsers } from '../src/auth.js';

const ROOT_DATA = path.resolve(import.meta.dirname, '../../data');

let tempDir;
let server;
let baseUrl;
let db;

test.before(async () => {
  tempDir = path.join(os.tmpdir(), `amelia-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT_DATA, 'rooms.json'), path.join(tempDir, 'rooms.json'));
  fs.copyFileSync(path.join(ROOT_DATA, 'items.json'), path.join(tempDir, 'items.json'));

  // una portada existente para probar la resolución de media
  const dummyMedia = path.join(tempDir, 'media', 'mariana', 'peliculas');
  fs.mkdirSync(dummyMedia, { recursive: true });
  fs.writeFileSync(path.join(dummyMedia, 'buscando-a-nemo.jpg'), 'fake-image-bytes');

  db = new AmeliaDb(path.join(tempDir, 'test.db'), tempDir);
  db.seedIfEmpty();
  const passcodes = parseUsers('Mariana:mariana,Franco:franco,Amelia:amelia,Visita:visita:readonly', db.getRooms());
  const app = createApp({ db, dataDir: tempDir, passcodes, clientDist: null });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    db?.close();
  } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function api(p, options = {}, pass) {
  const headers = { ...(options.headers || {}) };
  if (pass) headers['X-Amelia-Pass'] = pass;
  const res = await fetch(`${baseUrl}${p}`, { ...options, headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function itemForm(fields, files = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const [field, list] of Object.entries(files)) {
    for (const [name, type, bytes] of list) f.append(field, new Blob([bytes ?? 'x'.repeat(600)], { type }), name);
  }
  return f;
}

test('GET /api/health', async () => {
  const { status, data } = await api('/api/health');
  assert.equal(status, 200);
  assert.deepEqual(data, { ok: true });
});

test('GET /api/rooms/:roomId: películas y series separadas, café existe', async () => {
  const { status, data } = await api('/api/rooms/mariana');
  assert.equal(status, 200);
  const slugs = data.containers.map((c) => c.slug);
  assert.ok(slugs.includes('peliculas') && slugs.includes('series') && slugs.includes('cafe'));
  assert.ok(!slugs.includes('audiovisual'));
  assert.equal(data.containers.find((c) => c.slug === 'peliculas').count, 10);
  assert.equal(data.containers.find((c) => c.slug === 'series').count, 4);
  assert.equal((await api('/api/rooms/inexistente')).status, 404);
});

test('GET /api/items: media, década, autor, visibilidad', async () => {
  const { status, data } = await api('/api/items?room=mariana&container=peliculas');
  assert.equal(status, 200);
  assert.equal(data.length, 10);
  const nemo = data.find((i) => i.id === 'mariana-peliculas-buscando-a-nemo');
  assert.equal(nemo.cover, '/media/mariana/peliculas/buscando-a-nemo.jpg');
  assert.equal(nemo.decade, '2000s');
  assert.equal(nemo.addedBy, 'Mariana');
  assert.equal(nemo.visibility, 'publico');
  assert.deepEqual(nemo.tags, []);
  const harry = data.find((i) => i.id === 'mariana-peliculas-harry-potter-y-la-piedra-filosofal');
  assert.equal(harry.cover, null);
});

test('GET /api/items: filtros y orden', async () => {
  for (const item of (await api('/api/items?daytime=diurno')).data) {
    assert.ok(item.daytime === 'diurno' || item.daytime === 'cualquiera');
  }
  for (const item of (await api('/api/items?decade=1990s')).data) assert.ok(item.year >= 1990 && item.year <= 1999);
  for (const item of (await api('/api/items?date=navidad')).data) assert.ok(item.specialDates.includes('navidad'));
  assert.ok((await api('/api/items?q=DORY')).data.some((i) => i.id === 'mariana-peliculas-buscando-a-nemo'));
  assert.equal((await api('/api/items?container=ventana&room=mariana')).data.length, 38);

  const az = (await api('/api/items?room=mariana&container=peliculas&sort=az')).data.map((i) => i.title);
  assert.deepEqual(az, [...az].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));
  const desc = (await api('/api/items?room=mariana&container=peliculas&sort=anio-desc')).data;
  for (let i = 0; i < desc.length - 1; i++) assert.ok(desc[i].year >= desc[i + 1].year);
});

test('comentarios: solo la otra persona, con estrellas de media a cinco', async () => {
  const itemId = 'mariana-peliculas-buscando-a-nemo';
  const post = (body) => api(`/api/items/${itemId}/comments`, json(body));

  assert.equal((await post({ passcode: 'falsa', body: 'Hola' })).status, 401);
  // Mariana no comenta lo suyo; Amelia no comenta
  assert.equal((await post({ passcode: 'mariana', body: 'Hola' })).status, 403);
  const amelia = await post({ passcode: 'amelia', body: 'Hola' });
  assert.equal(amelia.status, 403);
  assert.match(amelia.data.error, /Franco/);
  // validaciones
  assert.equal((await post({ passcode: 'franco', body: '   ' })).status, 400);
  assert.equal((await post({ passcode: 'franco', body: 'a'.repeat(1001) })).status, 400);
  for (const rating of [0, 5.5, 3.3, 'mucho']) {
    assert.equal((await post({ passcode: 'franco', body: 'ok', rating })).status, 400, `rating ${rating}`);
  }
  // Franco comenta con 4 estrellas y media
  const ok = await post({ passcode: 'franco', body: 'Lloré con Marlin.', rating: 4.5 });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.author, 'Franco');
  assert.equal(ok.data.rating, 4.5);
  // sin calificación también vale
  assert.equal((await post({ passcode: 'franco', body: 'Y Dory es la mejor.' })).status, 201);

  const list = await api(`/api/items/${itemId}/comments`);
  assert.equal(list.data.length, 2);
  assert.equal(list.data[0].rating, 4.5);
  assert.equal(list.data[1].rating, null);
  assert.equal((await api(`/api/items/${itemId}`)).data.commentCount, 2);
});

test('POST /api/items/:id/like: 200 y después 429', async () => {
  const itemId = 'franco-peliculas-volver-al-futuro';
  const first = await api(`/api/items/${itemId}/like`, { method: 'POST' });
  assert.equal(first.status, 200);
  assert.equal(first.data.likes, 1);
  const second = await api(`/api/items/${itemId}/like`, { method: 'POST' });
  assert.equal(second.status, 429);
  assert.equal(second.data.likes, 1);
});

test('POST /api/auth/check', async () => {
  const fam = await api('/api/auth/check', json({ passcode: 'amelia' }));
  assert.deepEqual(fam.data, { name: 'Amelia', role: 'familia' });
  const owner = await api('/api/auth/check', json({ passcode: 'franco' }));
  assert.deepEqual(owner.data, { name: 'Franco', role: 'owner', roomId: 'franco' });
  const ro = await api('/api/auth/check', json({ passcode: 'visita' }));
  assert.deepEqual(ro.data, { name: 'Visita', role: 'readonly' });
  assert.equal((await api('/api/auth/check', json({ passcode: 'invalido' }))).status, 401);
});

test('readonly (visita): puede leer lo público pero no dar me gusta ni modificar nada', async () => {
  const itemId = 'mariana-peliculas-buscando-a-nemo';
  assert.equal((await api('/api/items?room=mariana&container=peliculas', {}, 'visita')).status, 200);
  assert.equal((await api(`/api/items/${itemId}`, {}, 'visita')).status, 200);
  assert.equal((await api(`/api/items/${itemId}/like`, { method: 'POST' }, 'visita')).status, 403);
  assert.equal((await api(`/api/items/${itemId}/comments`, json({ passcode: 'visita', body: 'Hola' }), 'visita')).status, 403);
  assert.equal(
    (await api('/api/items', { method: 'POST', body: itemForm({ roomId: 'mariana', container: 'peliculas', title: 'Test', passcode: 'visita' }) }, 'visita')).status,
    403,
  );
  assert.equal((await api(`/api/items/${itemId}`, { method: 'DELETE' }, 'visita')).status, 403);
  assert.equal((await api('/api/lookup?container=peliculas&q=nemo', {}, 'visita')).status, 403);
});

test('GET /api/stats: compara con la otra pieza', async () => {
  const { data } = await api('/api/stats?room=mariana&container=peliculas');
  assert.equal(data.total, 10);
  assert.deepEqual(data.compare, { roomId: 'franco', total: 10 });
  const toy = data.shared.find((s) => s.title === 'Toy Story');
  assert.equal(toy.otherId, 'franco-peliculas-toy-story');
  assert.equal(toy.otherContainer, 'peliculas');
});

test('POST /api/items: cada dueño solo en su pieza, con galería, mp3 y privacidad', async () => {
  const base = { roomId: 'mariana', container: 'peliculas', title: 'Amélie' };
  const post = (fields, files, pass) => api('/api/items', { method: 'POST', body: itemForm(fields, files) }, pass);

  assert.equal((await post({ ...base, passcode: 'nada' })).status, 401);
  // Franco no agrega en la pieza de Mariana; Amelia no agrega
  const franco = await post({ ...base, passcode: 'franco' });
  assert.equal(franco.status, 403);
  assert.match(franco.data.error, /Solo Mariana/);
  assert.equal((await post({ ...base, passcode: 'amelia' })).status, 403);
  // contenedores inválidos
  for (const container of ['ventana', 'audiovisual']) {
    assert.equal((await post({ ...base, container, passcode: 'mariana' })).status, 400);
  }
  // calificación inválida
  assert.equal((await post({ ...base, passcode: 'mariana', rating: '4.2' })).status, 400);
  // más de 3 fotos extra
  const four = [1, 2, 3, 4].map((n) => [`f${n}.jpg`, 'image/jpeg']);
  assert.equal((await post({ ...base, passcode: 'mariana' }, { gallery: four })).status, 400);
  // el audio tiene que ser mp3
  assert.equal((await post({ ...base, passcode: 'mariana' }, { audio: [['tema.wav', 'audio/wav']] })).status, 400);

  // alta completa: privada, 3,5 estrellas, 3 fotos y un mp3
  const ok = await post(
    {
      ...base,
      passcode: 'mariana',
      year: '2001',
      creators: ['Jean-Pierre Jeunet'],
      cast: ['Audrey Tautou'],
      genres: ['comedia', 'romance'],
      rating: '3.5',
      visibility: 'privado',
      specialDates: ['cumple-mariana'],
    },
    {
      cover: [['tapa.jpg', 'image/jpeg']],
      gallery: [1, 2, 3].map((n) => [`foto${n}.jpg`, 'image/jpeg']),
      audio: [['vals.mp3', 'audio/mpeg']],
    },
  );
  assert.equal(ok.status, 201);
  const it = ok.data;
  assert.equal(it.id, 'mariana-peliculas-amelie');
  assert.equal(it.addedBy, 'Mariana');
  assert.equal(it.rating, 3.5);
  assert.equal(it.visibility, 'privado');
  assert.match(it.cover, /^\/media\/mariana\/peliculas\/cover-/);
  assert.equal(it.gallery.length, 3);
  assert.match(it.audio, /^\/media\/mariana\/peliculas\/audio-.*\.mp3$/);
  assert.deepEqual(it.cast, ['Audrey Tautou']);

  // notas: "Escribió" es quien la agrega; URLs de portada fuera de la lista se ignoran
  const note = await post({
    roomId: 'franco',
    container: 'diario',
    title: 'Hoy',
    body: 'Sin rueditas.',
    passcode: 'franco',
    coverUrl: 'http://169.254.169.254/latest/meta-data',
  });
  assert.equal(note.status, 201);
  assert.deepEqual(note.data.creators, ['Franco']);
  assert.equal(note.data.cover, null);
});

test('privados: solo los ven Mariana y Franco', async () => {
  const id = 'mariana-peliculas-amelie';
  const count = async (pass) => (await api('/api/items?room=mariana&container=peliculas', {}, pass)).data.length;
  assert.equal(await count(), 10);
  assert.equal(await count('amelia'), 10);
  assert.equal(await count('franco'), 11);
  assert.equal(await count('mariana'), 11);
  assert.equal((await api(`/api/items/${id}`, {}, 'amelia')).status, 404);
  assert.equal((await api(`/api/items/${id}`, {}, 'franco')).status, 200);
  assert.equal((await api(`/api/items/${id}/comments`)).status, 404);
  assert.equal((await api('/api/stats?room=mariana&container=peliculas', {}, 'amelia')).data.total, 10);
  assert.equal((await api('/api/stats?room=mariana&container=peliculas', {}, 'franco')).data.total, 11);
});

test('PUT y DELETE: solo quien lo agregó', async () => {
  const id = 'mariana-peliculas-amelie';
  const put = (fields, files, pass) => api(`/api/items/${id}`, { method: 'PUT', body: itemForm(fields, files) }, pass);

  assert.equal((await put({ title: 'X' }, {}, 'franco')).status, 403);
  assert.equal((await put({ title: '' }, {}, 'mariana')).status, 400);

  const before = (await api(`/api/items/${id}`, {}, 'mariana')).data;
  const keep = [before.gallery[0]];
  const res = await put({ title: 'Amélie (2001)', rating: '5', visibility: 'publico', keepGallery: keep, removeAudio: '1' }, {
    gallery: [['nueva.jpg', 'image/jpeg']],
  }, 'mariana');
  assert.equal(res.status, 200);
  assert.equal(res.data.title, 'Amélie (2001)');
  assert.equal(res.data.rating, 5);
  assert.equal(res.data.visibility, 'publico');
  assert.equal(res.data.gallery.length, 2);
  assert.equal(res.data.gallery[0], keep[0]);
  assert.equal(res.data.audio, null);
  assert.deepEqual(res.data.cast, ['Audrey Tautou']); // lo que no se manda no cambia
  // el archivo de la foto sacada se borró del disco
  const removed = before.gallery[1].replace('/media/', '');
  assert.equal(fs.existsSync(path.join(tempDir, 'media', removed)), false);

  // los ítems de ejemplo los agregó su dueño: Franco no puede tocar los de Mariana
  assert.equal((await api('/api/items/mariana-peliculas-el-padrino', { method: 'DELETE' }, 'franco')).status, 403);
  assert.equal((await api(`/api/items/${id}`, { method: 'DELETE' }, 'franco')).status, 403);
  assert.equal((await api(`/api/items/${id}`, { method: 'DELETE' }, 'mariana')).status, 200);
  assert.equal((await api(`/api/items/${id}`, {}, 'mariana')).status, 404);
});

test('GET /api/coincidences: lo que está en las dos piezas', async () => {
  const { status, data } = await api('/api/coincidences');
  assert.equal(status, 200);
  const toy = data.find((c) => c.mariana.item.title === 'Toy Story');
  assert.ok(toy);
  assert.equal(toy.franco.item.id, 'franco-peliculas-toy-story');
  assert.ok(Array.isArray(toy.mariana.comments));
});

function oldDb(dir, version, rows) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(tempDir, 'rooms.json'), path.join(dir, 'rooms.json'));
  fs.copyFileSync(path.join(tempDir, 'items.json'), path.join(dir, 'items.json'));
  const file = path.join(dir, 'old.db');
  const raw = new DatabaseSync(file);
  raw.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, roomId TEXT NOT NULL, container TEXT NOT NULL, title TEXT NOT NULL,
    originalTitle TEXT, year INTEGER, cover TEXT, creators TEXT, [cast] TEXT, genres TEXT, audience TEXT, weather TEXT,
    daytime TEXT, seasons TEXT, moods TEXT, stages TEXT, specialDates TEXT, tags TEXT, rating INTEGER, ownerNote TEXT,
    body TEXT, date TEXT, place TEXT, gallery TEXT, videoUrl TEXT, likes INTEGER DEFAULT 0, ${version >= 1 ? 'addedBy TEXT,' : ''} createdAt TEXT NOT NULL);
    CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, itemId TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, createdAt TEXT NOT NULL);
    PRAGMA user_version = ${version};`);
  const ins = raw.prepare(
    "INSERT INTO items (id, roomId, container, title, tags, specialDates, likes, createdAt) VALUES (?, ?, ?, ?, ?, '[]', ?, '2026-01-01')",
  );
  for (const r of rows) ins.run(...r);
  raw.prepare("INSERT INTO comments (itemId, author, body, createdAt) VALUES (?, 'Abuela', 'hola', '2026-01-02')").run(rows[0][0]);
  raw.close();
  return file;
}

test('migración desde v0: conserva datos y termina en películas/series', () => {
  const dir = path.join(tempDir, 'v0');
  const file = oldDb(dir, 0, [
    ['mariana-peliculas-buscando-a-nemo', 'mariana', 'peliculas', 'Buscando a Nemo', '[]', 3],
    ['franco-series-los-simpson', 'franco', 'series', 'Los Simpson', '[]', 0],
  ]);
  const m = new AmeliaDb(file, dir);
  const nemo = m.getItemById('mariana-peliculas-buscando-a-nemo');
  assert.equal(nemo.container, 'peliculas');
  assert.deepEqual(nemo.tags, []);
  assert.equal(nemo.likes, 3);
  assert.equal(nemo.addedBy, 'Mariana');
  assert.equal(nemo.visibility, 'publico');
  assert.ok(nemo.specialDates.includes('cumple-amelia'));
  assert.equal(m.getItemById('franco-series-los-simpson').container, 'series');
  assert.equal(m.getComments('mariana-peliculas-buscando-a-nemo')[0].rating, null);
  m.close();
});

test('migración desde v1: audiovisual se separa por tipo y es idempotente', () => {
  const dir = path.join(tempDir, 'v1');
  const file = oldDb(dir, 1, [
    ['mariana-peliculas-buscando-a-nemo', 'mariana', 'audiovisual', 'Buscando a Nemo', '["pelicula"]', 2],
    ['franco-series-los-simpson', 'franco', 'audiovisual', 'Los Simpson', '["serie"]', 0],
    ['franco-audiovisual-clip', 'franco', 'audiovisual', 'Un clip', '["video"]', 0],
  ]);
  const m = new AmeliaDb(file, dir);
  assert.equal(m.getItemById('mariana-peliculas-buscando-a-nemo').container, 'peliculas');
  assert.equal(m.getItemById('franco-series-los-simpson').container, 'series');
  const clip = m.getItemById('franco-audiovisual-clip');
  assert.equal(clip.container, 'series');
  assert.deepEqual(clip.tags, ['video']);
  m.close();
  const again = new AmeliaDb(file, dir);
  assert.equal(again.getItemById('mariana-peliculas-buscando-a-nemo').likes, 2);
  again.close();
});
