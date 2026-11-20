import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ensureSeeded } from './src/db/seed.ts';
import { publicRouter } from './src/server/routes/public.ts';
import { authRouter } from './src/server/routes/auth.ts';
import { studentRouter } from './src/server/routes/student.ts';
import { examsRouter } from './src/server/routes/exams.ts';
import { adminRouter } from './src/server/routes/admin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    }),
  );
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  // Serve generated and uploaded visual assets reliably in both dev and production
  app.use('/src/assets/images', express.static(path.join(__dirname, 'src/assets/images')));
  app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Lazy idempotent DB seed on first API request (never eager at module import time)
  app.use('/api', async (_req, res, next) => {
    try {
      await ensureSeeded();
      return next();
    } catch (error) {
      console.error('Lazy seed middleware error:', error);
      return res.status(503).json({ error: 'قاعدة البيانات قيد التجهيز، يرجى المحاولة بعد ثوانٍ' });
    }
  });

  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/student', studentRouter);
  app.use('/api/exams', examsRouter);
  app.use('/api/admin', adminRouter);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // When HMR/WS is disabled in proxied preview environments, Vite 8 still injects /@vite/client
    // which attempts to connect to a WebSocket on port 24678. Serve a clean WebSocket-free client
    // implementing the exact style/HMR exports without opening any socket.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Physics LMS Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
