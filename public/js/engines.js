import { MicStreamer, startLevelMeter } from './mic.js';

/*
 * Both engines expose the same interface so the Live controller is engine-agnostic:
 *
 *   start(handlers)  handlers = { onStarted, onInterim(text), onCommit(text, languageCode),
 *                                 onTurn, onLevel(rms), onSaved(record), onError(msg), onStopped }
 *   stop()
 *   savesOnServer    true when the backend persists the transcript itself
 */

/** Streams PCM over WebSocket to the Node server, which relays to Gemini Live. */
export class GeminiLiveEngine {
  savesOnServer = true;
  #ws = null;
  #mic = new MicStreamer();
  #h = {};

  constructor(wsPath) {
    this.wsPath = wsPath;
  }

  start(handlers) {
    this.#h = handlers;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${this.wsPath}`);
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'start' }));
    ws.onerror = () => this.#h.onError?.('Connection to server failed');
    ws.onclose = () => {
      this.#mic.stop();
      this.#h.onStopped?.();
    };
    ws.onmessage = async ({ data }) => {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'started':
          try {
            await this.#mic.start({
              onChunk: (pcm) => ws.readyState === WebSocket.OPEN && ws.send(pcm),
              onLevel: (rms) => this.#h.onLevel?.(rms),
            });
            this.#h.onStarted?.();
          } catch (err) {
            this.#h.onError?.(micErrorMessage(err));
            ws.close();
          }
          break;
        case 'interim':
          this.#h.onInterim?.(msg.text);
          break;
        case 'transcript':
          this.#h.onCommit?.(msg.text, msg.languageCode);
          break;
        case 'turn':
          this.#h.onTurn?.();
          break;
        case 'saved':
          this.#h.onSaved?.(msg.record);
          break;
        case 'error':
          this.#h.onError?.(msg.message);
          // Failed before streaming began (e.g. no API key): nothing to flush, just close.
          if (!this.#mic.active) ws.close();
          break;
        case 'stopped':
          ws.close(1000);
          break;
      }
    };
  }

  async stop() {
    await this.#mic.stop(); // stop capturing first so no audio races the stop message
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ type: 'stop' }));
    else this.#ws?.close();
  }
}

/** Fallback: browser-native recognition (Chrome/Edge). No key, no server audio. */
export class WebSpeechEngine {
  savesOnServer = false;
  #rec = null;
  #active = false;
  #stopMeter = null;
  #h = {};

  static isSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  constructor(lang) {
    this.lang = lang;
  }

  async start(handlers) {
    this.#h = handlers;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      handlers.onError?.('Web Speech API is not supported in this browser (try Chrome or Edge).');
      return handlers.onStopped?.();
    }

    try {
      this.#stopMeter = await startLevelMeter((rms) => this.#h.onLevel?.(rms));
    } catch (err) {
      handlers.onError?.(micErrorMessage(err));
      return handlers.onStopped?.();
    }

    const rec = new Recognition();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    this.#rec = rec;
    this.#active = true;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          this.#h.onCommit?.(`${r[0].transcript.trim()} `, this.lang);
          this.#h.onTurn?.();
        } else interim += r[0].transcript;
      }
      this.#h.onInterim?.(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.#h.onError?.(`Speech recognition error: ${e.error}`);
      this.#active = false;
    };
    // Chrome ends recognition after silence; restart while the user is still recording.
    rec.onend = () => {
      if (this.#active) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through to stop */
        }
      }
      this.#finish();
    };

    rec.start();
    this.#h.onStarted?.();
  }

  stop() {
    this.#active = false;
    this.#rec?.stop();
  }

  async #finish() {
    await this.#stopMeter?.();
    this.#stopMeter = null;
    this.#h.onStopped?.();
  }
}

function micErrorMessage(err) {
  if (err?.name === 'NotAllowedError') return 'Microphone permission denied.';
  if (err?.name === 'NotFoundError') return 'No microphone found.';
  return `Microphone error: ${err?.message ?? err}`;
}
