import 'dotenv/config';

const env = process.env;

const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const toList = (value) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = Object.freeze({
  env: env.NODE_ENV ?? 'development',
  isProduction: env.NODE_ENV === 'production',
  port: toInt(env.PORT, 3000),

  databaseUrl:
    env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/transcription_db',

  gemini: Object.freeze({
    apiKey: env.GEMINI_API_KEY ?? '',
    model: env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview',
    responseModality: (env.GEMINI_RESPONSE_MODALITY ?? 'AUDIO').toUpperCase(),
    languageCodes: toList(env.GEMINI_LANGUAGE_CODES ?? 'hi-IN,en-IN'),
  }),

  ws: Object.freeze({
    path: '/ws/transcribe',
    // 100 ms of 16 kHz PCM16 is 3.2 KB; 256 KB is a generous ceiling per frame.
    maxPayloadBytes: 256 * 1024,
    // Gemini Live caps audio-only sessions at ~15 minutes; stop cleanly before that.
    maxSessionMs: toInt(env.MAX_SESSION_MS, 14 * 60 * 1000),
    heartbeatMs: 30_000,
  }),
});
