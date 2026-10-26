import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createApiRouter } from './routes/api.js';
import { generalPostLimiter } from './rateLimit.js';

export function createApp({ db, dataDir, passcodes, clientDist }) {
  const app = express();

  // Safely trust reverse proxy (Docker, Nginx, etc.)
  app.set('trust proxy', true);

  // Basic security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // General in-memory POST rate limiter: 120 req/min/IP
  app.use((req, res, next) => {
    if (req.method === 'POST') {
      const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
      if (!generalPostLimiter.check(clientIp)) {
        return res
          .status(429)
          .json({ error: 'Pará un poquito, probá de nuevo en unos minutos.' });
      }
    }
    next();
  });

  // JSON and URL-encoded body parsers (100kb limit)
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Static media route with 7-day cache
  const mediaDir = path.join(dataDir, 'media');
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }
  app.use('/media', express.static(mediaDir, { maxAge: '7d' }));

  // API router
  app.use('/api', createApiRouter({ db, dataDir, passcodes }));

  // SPA client static and fallback
  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/media')) {
        return next();
      }
      const indexPath = path.join(clientDist, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }

  // Fallback for non-matching API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Recurso de la API no encontrado.' });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'El formato de datos enviado no es válido.' });
    }
    console.error('[Express Error]', err);
    res.status(err.status || 500).json({
      error:
        err.message && err.status
          ? err.message
          : 'Ocurrió un error inesperado en el servidor.'
    });
  });

  return app;
}
