import path from 'node:path';
import fs from 'node:fs';
import { AmeliaDb } from './db.js';

let dataDir;
if (process.env.DATA_DIR) {
  dataDir = path.resolve(process.env.DATA_DIR);
} else if (fs.existsSync(path.resolve(process.cwd(), 'data'))) {
  dataDir = path.resolve(process.cwd(), 'data');
} else if (fs.existsSync(path.resolve(process.cwd(), '../data'))) {
  dataDir = path.resolve(process.cwd(), '../data');
} else {
  dataDir = path.resolve(import.meta.dirname, '../../data');
}

const dbPath = path.join(dataDir, 'amelia.db');
console.log(`[Reseed] Reseeding database at: ${dbPath}`);

const db = new AmeliaDb(dbPath, dataDir);
db.reseed();

const row = db.db.prepare('SELECT COUNT(*) as count FROM items').get();
console.log(`[Reseed] Complete. Total items in DB: ${row.count}. Comments and likes preserved.`);
db.close();
