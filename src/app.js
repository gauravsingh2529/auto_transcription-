import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createTranscriptionRouter } from './routes/transcription.routes.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ service }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Same-origin WebSocket for the live transcription stream.
          'connect-src': ["'self'", 'ws:', 'wss:'],
        },
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await service.health();
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  // Lets the UI decide which STT engines to offer without exposing secrets.
  app.get('/api/config', (_req, res) => {
    res.json({
      engines: {
        geminiLive: { enabled: Boolean(config.gemini.apiKey), model: config.gemini.model },
        webSpeech: { enabled: true },
      },
      wsPath: config.ws.path,
      maxSessionMs: config.ws.maxSessionMs,
    });
  });

  app.use('/api/transcriptions', createTranscriptionRouter(service));
  app.use('/api', notFoundHandler);

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: config.isProduction ? '1h' : 0 }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
