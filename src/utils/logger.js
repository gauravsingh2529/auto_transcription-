// Minimal structured (JSON-lines) logger. Swap for pino in a larger deployment.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

function serialize(meta) {
  if (!meta) return {};
  if (meta instanceof Error) return { err: meta.message, stack: meta.stack };
  if (meta.err instanceof Error) return { ...meta, err: meta.err.message, stack: meta.err.stack };
  return meta;
}

function write(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...serialize(meta) });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
