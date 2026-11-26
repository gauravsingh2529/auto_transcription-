# Speech to Text: Real-time Multilingual Transcription

Speak Hindi, English, or a mix of both (Hinglish) and watch the words appear as you talk.
Every session is saved to PostgreSQL and shown in a dashboard where you can create, read, update and delete it.

**Stack:** Node.js 20+ · Express 5 · `ws` · PostgreSQL · Gemini Live API · vanilla JS (no build step)

---

## Quick start

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL and GEMINI_API_KEY
npm start                   # creates the DB if missing, runs migrations, serves on :3000
```

Open http://localhost:3000. Use Chrome or Edge for microphone access.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | e.g. `postgres://postgres:<password>@localhost:5432/transcription_db` |
| `GEMINI_API_KEY` | Free key from https://aistudio.google.com/apikey. If empty, only the browser engine is offered. |
| `GEMINI_LIVE_MODEL` | Live model id (default `gemini-3.1-flash-live-preview`) |
| `GEMINI_RESPONSE_MODALITY` | `AUDIO` for native-audio models, `TEXT` for half-cascade models |
| `GEMINI_LANGUAGE_CODES` | Language hints, default `hi-IN,en-IN` for code-mixed speech |

```bash
npm test          # 25 unit + integration tests; no DB or API key needed
npm run migrate   # run migrations only
```

---

## Architecture

```
 Browser                                   Node.js server                          External
┌──────────────────────────┐   WebSocket   ┌──────────────────────────────┐  WSS   ┌─────────────┐
│ Mic → AudioWorklet       │  PCM16 16kHz  │ ws gateway (TranscriptionSession)│──────▶│ Gemini Live │
│  (downsample, 100ms)     │──────────────▶│  • state machine per socket    │◀──────│  input      │
│                          │◀──────────────│  • buffers until setupComplete │ text  │  transcription
│ Live view (interim/final)│  JSON deltas  │  • persists on stop/disconnect │       └─────────────┘
│ History dashboard (CRUD) │──── REST ────▶│ routes → controller → service → repository ──▶ PostgreSQL
│ TTS: speechSynthesis     │               └──────────────────────────────┘
└──────────────────────────┘
```

```
src/
  server.js                 composition root, graceful shutdown
  app.js                    Express app, helmet/CSP, static files
  config/                   validated env config
  db/                       pool, auto-create DB, versioned SQL migrations
  repositories/             SQL only (parameterised, whitelisted update columns)
  services/                 business rules (title derivation, 404s, pagination)
  controllers/ routes/      thin HTTP layer
  middleware/               zod validation, central error handler
  stt/geminiLive.provider.js  Gemini Live adapter (EventEmitter)
  ws/transcription.gateway.js real-time session handling
public/                     UI: AudioWorklet, engines, dashboard
tests/                      node:test unit + integration (fake repo, fake STT)
```

### Key design decisions

- **The server relays audio to Gemini; the browser never talks to Gemini directly.** The API key stays on the server, and the server is the single owner of the transcript, so it saves even if the tab closes mid-sentence.
- **The browser converts audio before sending.** An AudioWorklet resamples the mic to 16 kHz PCM16 off the main thread and sends 100 ms binary frames. That is about 32 KB/s, with no base64 between browser and server.
- **Hinglish support.** Gemini's `inputAudioTranscription` is given `languageCodes: ['hi-IN','en-IN']`. Each detected `languageCode` is stored on the row.
- **Low latency.** `interimInputTranscription` is shown in grey as a hypothesis that can be replaced; committed `inputTranscription` deltas are appended.
- **The STT engine is pluggable.** Both engines share one interface. If there is no API key, the browser Web Speech API (`hi-IN`) works as a fallback and the client saves through REST.
- **Robustness.**
  - Audio is buffered until Gemini sends `setupComplete`.
  - On stop, the server sends `audioStreamEnd` and waits for a quiet period so trailing words aren't lost.
  - Sessions stop at 14 minutes, under Gemini's ~15-minute limit.
  - A WS heartbeat drops dead connections.
  - The Gemini session can't leak if the user stops while it is still connecting.
- **Security.**
  - Parameterised SQL and escaped `ILIKE` wildcards.
  - Strict zod schemas that reject unknown fields.
  - Helmet CSP and payload size limits.
  - The UI renders data with `textContent` only, so stored text can't inject HTML.
- **TTS** uses the browser's built-in `speechSynthesis` (free, no key). It picks a Hindi voice for Devanagari text.

### REST API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/transcriptions?q=&source=&page=&pageSize=` | search + filter + pagination |
| GET | `/api/transcriptions/:id` | |
| POST | `/api/transcriptions` | `{ text, title?, language?, source?, durationMs? }` |
| PATCH/PUT | `/api/transcriptions/:id` | `{ title?, text?, language? }` |
| DELETE | `/api/transcriptions/:id` | 204 |
| GET | `/api/health` | DB liveness |
| GET | `/api/config` | which engines are available (no secrets) |

### WebSocket protocol (`/ws/transcribe`)

Client → server: `{"type":"start"}`, then binary PCM frames, then `{"type":"stop"}`
Server → client: `started`, `interim`, `transcript`, `turn`, `saved`, `stopped`, `error`

---

## Known limitations / next steps

- No authentication or per-user ownership. Next steps: add a `user_id` column plus JWT, and rate-limit WS connections.
- Gemini session resumption (`sessionResumption`) for recordings longer than 15 minutes.
- A self-hosted engine (e.g. `faster-whisper` / `whisper.cpp` streaming server) behind the same provider interface. Add it in `src/stt/`; the gateway is engine-agnostic.
- Open-source TTS (e.g. Piper with Hindi voices) as a server endpoint instead of the browser voices.
- Full-text search: a `pg_trgm` GIN index once history grows beyond what `ILIKE` handles well.
