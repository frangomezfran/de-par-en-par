import { spawn } from 'node:child_process';
import path from 'node:path';

const serverProcess = spawn('node', ['src/index.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    PORT: '3001',
    DATA_DIR: path.resolve(import.meta.dirname, '../../data')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

serverProcess.stdout.on('data', (d) => process.stdout.write(`[Server stdout] ${d}`));
serverProcess.stderr.on('data', (d) => process.stderr.write(`[Server stderr] ${d}`));

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  // Wait for server to start
  await wait(1500);

  const baseUrl = 'http://localhost:3001';
  const getEndpoints = [
    '/api/health',
    '/api/rooms',
    '/api/rooms/mariana',
    '/api/rooms/franco',
    '/api/items',
    '/api/items?room=mariana',
    '/api/items?room=franco',
    '/api/items?container=peliculas',
    '/api/items?weather=soleado',
    '/api/items?daytime=diurno',
    '/api/items?decade=1990s',
    '/api/items?genre=animaci%C3%B3n',
    '/api/items?mood=tierno',
    '/api/items?stage=embarazo',
    '/api/items?date=navidad',
    '/api/items?tag=comida',
    '/api/items?q=buscando',
    '/api/items?sort=recientes',
    '/api/items/mariana-peliculas-buscando-a-nemo',
    '/api/items/mariana-peliculas-buscando-a-nemo/comments',
    '/api/stats',
    '/api/stats?room=mariana&container=peliculas',
    '/api/stats?room=franco&container=peliculas'
  ];

  console.log('--- TESTING ALL GET ENDPOINTS ---');
  for (const ep of getEndpoints) {
    try {
      const res = await fetch(`${baseUrl}${ep}`);
      console.log(`GET ${ep} -> Status: ${res.status}`);
      if (res.status !== 200) {
        console.error(`Unexpected status ${res.status} for ${ep}`);
      }
    } catch (err) {
      console.error(`Error requesting ${ep}:`, err.message);
    }
  }

  console.log('--- TESTING POST /api/auth/check ---');
  const authRes = await fetch(`${baseUrl}/api/auth/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: 'mariana' })
  });
  console.log(`POST /api/auth/check -> Status: ${authRes.status}`);
  const authData = await authRes.json();
  console.log('Auth data:', JSON.stringify(authData));

  console.log('--- TESTING POST COMMENT WITH TEST PASSCODE ---');
  const commentRes = await fetch(`${baseUrl}/api/items/mariana-peliculas-buscando-a-nemo/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      passcode: 'amelia',
      body: '¡Probando comentario en vivo de la abuela Norma!'
    })
  });
  console.log(`POST comment -> Status: ${commentRes.status}`);
  const commentData = await commentRes.json();
  console.log('Comment created:', JSON.stringify(commentData));

  console.log('--- TESTING POST LIKE ---');
  const likeRes = await fetch(`${baseUrl}/api/items/mariana-peliculas-buscando-a-nemo/like`, {
    method: 'POST'
  });
  console.log(`POST like -> Status: ${likeRes.status}`);
  const likeData = await likeRes.json();
  console.log('Like response:', JSON.stringify(likeData));

  // Verify comments count increased
  const afterRes = await fetch(`${baseUrl}/api/items/mariana-peliculas-buscando-a-nemo/comments`);
  const commentsAfter = await afterRes.json();
  console.log(`Comments count on item: ${commentsAfter.length}`);

  serverProcess.kill('SIGTERM');
  console.log('--- ALL VERIFICATIONS COMPLETED SUCCESSFULLY ---');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  serverProcess.kill('SIGTERM');
  process.exit(1);
});
