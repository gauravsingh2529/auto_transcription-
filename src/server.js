import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { ensureDatabase, runMigrations } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createTranscriptionRepository } from './repositories/transcription.repository.js';
import { createTranscriptionService } from './services/transcription.service.js';
import { createSttProvider } from './stt/geminiLive.provider.js';
import { logger } from './utils/logger.js';
import { attachTranscriptionGateway } from './ws/transcription.gateway.js';

async function main() {
  await ensureDatabase();
  await runMigrations();

  // Composition root: wire concrete dependencies together in one place.
  const repository = createTranscriptionRepository(pool);
  const service = createTranscriptionService(repository);
  const app = createApp({ service });
  const server = http.createServer(app);
  const wss = attachTranscriptionGateway(server, {
    service,
    createStt: () => createSttProvider(config.gemini),
  });

  server.listen(config.port, () => {
    logger.info('Server listening', {
      url: `http://localhost:${config.port}`,
      geminiLive: config.gemini.apiKey ? config.gemini.model : 'disabled (no GEMINI_API_KEY)',
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    // Closing client sockets triggers each session's persist-on-close path.
    for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    wss.close();
    server.close();
    setTimeout(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    }, 4000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
