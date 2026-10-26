import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(rootDir, 'data', 'amelia.db');
const outPath = path.join(rootDir, 'worker', 'seed.local.sql');

if (!fs.existsSync(dbPath)) {
  console.error(`[export-local-db] No se encontró ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

function sqlVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const lines = [];

const items = db.prepare('SELECT * FROM items').all();
for (const r of items) {
  lines.push(
    `INSERT OR REPLACE INTO items (id, roomId, container, title, originalTitle, year, cover, creators, [cast], genres, audience, weather, daytime, seasons, moods, stages, specialDates, tags, rating, ownerNote, body, date, place, gallery, videoUrl, likes, addedBy, visibility, audio, createdAt) VALUES (${[
      r.id, r.roomId, r.container, r.title, r.originalTitle, r.year, r.cover,
      r.creators, r.cast, r.genres, r.audience, r.weather, r.daytime,
      r.seasons, r.moods, r.stages, r.specialDates, r.tags, r.rating,
      r.ownerNote, r.body, r.date, r.place, r.gallery, r.videoUrl,
      r.likes ?? 0, r.addedBy, r.visibility ?? 'publico', r.audio ?? null, r.createdAt
    ].map(sqlVal).join(', ')});`
  );
}

const comments = db.prepare('SELECT * FROM comments ORDER BY id ASC').all();
for (const c of comments) {
  lines.push(
    `INSERT OR REPLACE INTO comments (id, itemId, author, body, rating, createdAt) VALUES (${[
      c.id, c.itemId, c.author, c.body, c.rating ?? null, c.createdAt
    ].map(sqlVal).join(', ')});`
  );
}

const likes = db.prepare('SELECT * FROM likes_log').all();
for (const l of likes) {
  lines.push(
    `INSERT INTO likes_log (item_id, ip, created_at) VALUES (${[
      l.item_id, l.ip, l.created_at
    ].map(sqlVal).join(', ')});`
  );
}

db.close();

fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
console.log(`[export-local-db] Exportados ${items.length} items, ${comments.length} comentarios y ${likes.length} likes a ${outPath}`);
