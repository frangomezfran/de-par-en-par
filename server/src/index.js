import path from 'node:path';
import fs from 'node:fs';
import { AmeliaDb } from './db.js';
import { parseUsers } from './auth.js';
import { createApp } from './app.js';

// Resolve DATA_DIR
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

// Resolve CLIENT_DIST
let clientDist;
if (process.env.CLIENT_DIST) {
  clientDist = path.resolve(process.env.CLIENT_DIST);
} else if (fs.existsSync(path.resolve(process.cwd(), '../client/dist'))) {
  clientDist = path.resolve(process.cwd(), '../client/dist');
} else {
  clientDist = path.resolve(import.meta.dirname, '../../client/dist');
}

const port = Number(process.env.PORT) || 3001;
const dbPath = path.join(dataDir, 'amelia.db');

console.log(`[Server] Starting Amelia server...`);
console.log(`[Server] DATA_DIR: ${dataDir}`);
console.log(`[Server] DB_PATH: ${dbPath}`);
console.log(`[Server] CLIENT_DIST: ${clientDist} (exists: ${fs.existsSync(clientDist)})`);

// Initialize SQLite database
const db = new AmeliaDb(dbPath, dataDir);
db.seedIfEmpty();

// Usuarios (Nombre:clave). Por defecto: la clave es el nombre en minúsculas.
const rooms = db.getRooms();
const passcodes = parseUsers(process.env.USERS || 'Mariana:mariana,Franco:franco,Amelia:amelia,Visita:visita:readonly', rooms);
console.log(`[Server] Usuarios: ${[...passcodes.ownerList, ...passcodes.familyList, ...passcodes.readonlyList].map((u) => u.name).join(', ')}`);

const app = createApp({
  db,
  dataDir,
  passcodes,
  clientDist
});

const server = app.listen(port, () => {
  console.log(`[Server] Amelia server listening on http://localhost:${port}`);
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  console.log('[Server] Shutting down gracefully...');
  server.close(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
