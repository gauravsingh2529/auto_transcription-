import { WebSocketServer } from 'ws';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/*
 * Wire protocol (one recording session per socket at a time)
 *
 *  client -> server
 *    {"type":"start"}            open an STT session
 *    <binary>                    PCM16 LE, 16 kHz, mono (~100 ms per frame)
 *    {"type":"stop"}             flush, persist, close the STT session
 *
 *  server -> client
 *    {"type":"started"}                       STT ready, begin streaming audio
 *    {"type":"interim","text"}                low-latency hypothesis (replaceable)
 *    {"type":"transcript","text","languageCode"}  committed delta (append)
 *    {"type":"turn"}                          utterance boundary
 *    {"type":"saved","record"}                persisted row
 *    {"type":"stopped"}                       session finished
 *    {"type":"error","message"}
 */

const State = Object.freeze({ IDLE: 'idle', STARTING: 'starting', STREAMING: 'streaming', STOPPING: 'stopping' });

class TranscriptionSession {
  #ws;
  #service;
  #createStt;
  #log;
  #state = State.IDLE;
  #stt = null;
  #text = '';
  #languages = new Set();
  #startedAt = 0;
  #maxTimer = null;

  constructor(ws, { service, createStt, log }) {
    this.#ws = ws;
    this.#service = service;
    this.#createStt = createStt;
    this.#log = log;

    ws.on('message', (data, isBinary) => this.#onMessage(data, isBinary));
    ws.on('close', () => this.#onSocketClose());
    ws.on('error', (err) => this.#log.warn('Client socket error', { err }));
  }

  #send(payload) {
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify(payload));
  }

  #fail(message) {
    this.#send({ type: 'error', message });
  }

  #onMessage(data, isBinary) {
    if (isBinary) {
      if (this.#state === State.STREAMING) this.#stt.sendAudio(data);
      return; // audio outside a session is silently dropped
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return this.#fail('Invalid JSON control message');
    }

    switch (msg?.type) {
      case 'start':
        return void this.#start();
      case 'stop':
        return void this.#stop({ persist: true });
      default:
        return this.#fail(`Unknown message type: ${msg?.type}`);
    }
  }

  async #start() {
    if (this.#state !== State.IDLE) return this.#fail('A session is already active');

    const stt = this.#createStt();
    if (!stt) {
      return this.#fail('Gemini Live is not configured on the server (set GEMINI_API_KEY). Use the Browser engine instead.');
    }

    this.#state = State.STARTING;
    this.#stt = stt;
    this.#text = '';
    this.#languages.clear();

    stt.on('interim', (text) => this.#send({ type: 'interim', text }));
    stt.on('transcript', ({ text, languageCode }) => {
      this.#text += text;
      if (languageCode) this.#languages.add(languageCode);
      this.#send({ type: 'transcript', text, languageCode });
    });
    stt.on('turn', () => this.#send({ type: 'turn' }));
    stt.on('error', (err) => {
      this.#log.error('STT provider error', { err });
      this.#fail(err.message);
      void this.#stop({ persist: true });
    });

    try {
      await stt.connect();
    } catch (err) {
      this.#log.error('Failed to connect STT provider', { err });
      this.#fail(`Could not connect to speech service: ${err.message}`);
      this.#reset();
      return;
    }

    // The socket may have closed, or stop() been called, while we were connecting.
    if (this.#state !== State.STARTING || this.#stt !== stt) {
      stt.close();
      return;
    }

    this.#state = State.STREAMING;
    this.#startedAt = Date.now();
    this.#maxTimer = setTimeout(() => {
      this.#fail('Maximum session length reached; saved what was captured.');
      void this.#stop({ persist: true });
    }, config.ws.maxSessionMs);
    this.#send({ type: 'started', provider: stt.name });
    this.#log.info('Transcription session started', { provider: stt.name });
  }

  async #stop({ persist }) {
    if (this.#state === State.IDLE || this.#state === State.STOPPING) return;
    const wasStreaming = this.#state === State.STREAMING;
    this.#state = State.STOPPING;
    clearTimeout(this.#maxTimer);

    const stt = this.#stt;
    try {
      if (wasStreaming) await stt.finish();
    } catch (err) {
      this.#log.warn('Error while flushing STT', { err });
    } finally {
      stt.close();
    }

    if (persist) await this.#persist(wasStreaming ? Date.now() - this.#startedAt : 0);
    this.#send({ type: 'stopped' });
    this.#reset();
  }

  async #persist(durationMs) {
    const text = this.#text.trim();
    if (!text) return;
    try {
      const record = await this.#service.create({
        text,
        source: 'gemini-live',
        language: [...this.#languages].join(',') || null,
        durationMs,
      });
      this.#send({ type: 'saved', record });
      this.#log.info('Transcription saved', { id: record.id, chars: text.length });
    } catch (err) {
      this.#log.error('Failed to persist transcription', { err });
      this.#fail('Transcription could not be saved to the database');
    }
  }

  #reset() {
    this.#stt?.removeAllListeners();
    this.#stt = null;
    this.#state = State.IDLE;
  }

  #onSocketClose() {
    // Browser tab closed mid-recording: still keep what we captured.
    void this.#stop({ persist: true });
  }
}

export function attachTranscriptionGateway(server, { service, createStt }) {
  const wss = new WebSocketServer({
    server,
    path: config.ws.path,
    maxPayload: config.ws.maxPayloadBytes,
  });

  let seq = 0;
  wss.on('connection', (ws, req) => {
    const conn = ++seq;
    const log = {
      info: (m, x) => logger.info(m, { conn, ...x }),
      warn: (m, x) => logger.warn(m, { conn, ...x }),
      error: (m, x) => logger.error(m, { conn, ...x }),
    };
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    log.info('WebSocket connected', { ip: req.socket.remoteAddress });
    new TranscriptionSession(ws, { service, createStt, log });
  });

  // Heartbeat: drop half-open connections (laptop sleep, network loss).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, config.ws.heartbeatMs);
  heartbeat.unref(); // never keep the process alive just for heartbeats
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
