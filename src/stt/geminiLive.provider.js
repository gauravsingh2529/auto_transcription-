import { EventEmitter } from 'node:events';
import { GoogleGenAI, Modality } from '@google/genai';
import { logger } from '../utils/logger.js';

const AUDIO_MIME = 'audio/pcm;rate=16000';
const MAX_PENDING_CHUNKS = 100; // ~10 s of audio buffered while the session handshakes

const SYSTEM_INSTRUCTION =
  'You are a silent speech-to-text backend. The user is NOT talking to you. ' +
  'Never answer, comment or speak. Produce no output.';

/**
 * Streams 16 kHz mono PCM16 audio to the Gemini Live API and emits transcripts.
 *
 * Events:
 *   'interim'    (text)                 low-latency hypothesis for the current utterance
 *   'transcript' ({ text, languageCode }) committed text delta (append-only)
 *   'turn'       ()                     end of an utterance (server-side VAD)
 *   'error'      (Error)
 *   'close'      ()
 *
 * We only use the *input* transcription. The model's own reply (audio/text) is
 * discarded; the system instruction keeps it from generating much at all.
 */
export class GeminiLiveProvider extends EventEmitter {
  #ai;
  #session = null;
  #opts;
  #ready = false;
  #closed = false;
  #pending = [];
  #lastActivityAt = 0;

  constructor({ apiKey, model, responseModality = 'AUDIO', languageCodes = [] }) {
    super();
    this.#ai = new GoogleGenAI({ apiKey });
    this.#opts = { model, responseModality, languageCodes };
  }

  get name() {
    return 'gemini-live';
  }

  async connect() {
    const { model, responseModality, languageCodes } = this.#opts;
    this.#session = await this.#ai.live.connect({
      model,
      config: {
        responseModalities: [responseModality === 'TEXT' ? Modality.TEXT : Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
        inputAudioTranscription: languageCodes.length ? { languageCodes } : {},
      },
      callbacks: {
        onmessage: (msg) => this.#onMessage(msg),
        onerror: (e) => this.#emitError(new Error(e?.message || 'Gemini Live socket error')),
        onclose: (e) => this.#onClose(e),
      },
    });
    // close() was called while the handshake was in flight: don't leak the session.
    if (this.#closed) this.#session.close();
  }

  // An 'error' event with no listener crashes the process; late errors after
  // the owner detached are only logged.
  #emitError(err) {
    if (this.listenerCount('error') > 0) this.emit('error', err);
    else logger.warn('Gemini Live error after session detached', { err });
  }

  #onMessage(msg) {
    if (msg.setupComplete) {
      this.#ready = true;
      for (const chunk of this.#pending.splice(0)) this.#send(chunk);
      return;
    }

    const sc = msg.serverContent;
    if (sc) {
      if (sc.interimInputTranscription?.text) {
        this.#lastActivityAt = Date.now();
        this.emit('interim', sc.interimInputTranscription.text);
      }
      if (sc.inputTranscription?.text) {
        this.#lastActivityAt = Date.now();
        this.emit('transcript', {
          text: sc.inputTranscription.text,
          languageCode: sc.inputTranscription.languageCode ?? null,
        });
      }
      if (sc.inputTranscription?.finished || sc.turnComplete) this.emit('turn');
    }

    if (msg.goAway) logger.warn('Gemini Live goAway received', { timeLeft: msg.goAway.timeLeft });
  }

  #onClose(e) {
    const wasClosed = this.#closed;
    this.#closed = true;
    this.#ready = false;
    // 1000 = normal closure. Anything else carries a useful reason (bad key, bad model, quota).
    if (!wasClosed && e && e.code !== 1000) {
      this.#emitError(new Error(`Gemini Live closed (${e.code}): ${e.reason || 'no reason given'}`));
    }
    this.emit('close');
  }

  #send(buf) {
    this.#session.sendRealtimeInput({
      audio: { data: buf.toString('base64'), mimeType: AUDIO_MIME },
    });
  }

  /** @param {Buffer} buf little-endian PCM16 @ 16 kHz mono */
  sendAudio(buf) {
    if (this.#closed || !this.#session) return;
    if (!this.#ready) {
      if (this.#pending.length >= MAX_PENDING_CHUNKS) this.#pending.shift();
      this.#pending.push(buf);
      return;
    }
    this.#send(buf);
  }

  /**
   * Signals end of audio and waits for trailing transcription to arrive:
   * resolves after `quietMs` without new text, or after `maxWaitMs` at most.
   */
  async finish({ quietMs = 900, maxWaitMs = 3500 } = {}) {
    if (this.#closed || !this.#session) return;
    if (this.#ready) this.#session.sendRealtimeInput({ audioStreamEnd: true });

    const started = Date.now();
    this.#lastActivityAt = Math.max(this.#lastActivityAt, started);
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        const now = Date.now();
        if (this.#closed || now - this.#lastActivityAt >= quietMs || now - started >= maxWaitMs) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#session?.close();
    } catch (err) {
      logger.debug('Error closing Gemini session', err);
    }
  }
}

/** Factory so the gateway does not depend on a concrete provider. */
export function createSttProvider(geminiConfig) {
  if (!geminiConfig.apiKey) return null;
  return new GeminiLiveProvider(geminiConfig);
}
