/**
 * HTTP surface for the engine. Used by the dashboard and the report CLI to fetch saved
 * sessions / analyses without needing the live WebSocket.
 */

import express from 'express';
import type { Express, Request, Response } from 'express';
import { config } from '../config.js';
import { store } from '../storage/sqlite.js';

export function buildHttpApp(): Express {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: '0.1.0' });
  });

  app.get('/api/sessions/:id', (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params.id) ? (req.params.id[0] ?? '') : (req.params.id ?? '');
    const data = store.loadSession(sessionId);
    if (!data.session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json({ session: data.session, analyses: data.analyses });
  });

  return app;
}

export function startHttp(): void {
  const app = buildHttpApp();
  app.listen(config.http.port, () => {
    // logged via main
  });
}
