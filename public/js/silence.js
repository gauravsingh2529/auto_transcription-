/**
 * End-of-speech detector used for "auto-save when the user stops speaking".
 *
 * Activity = mic level above `threshold` OR a new transcript event. Listening for
 * transcript events too means a pause while the STT engine is still emitting text
 * doesn't count as silence.
 *
 * The detector only arms after the first activity, so the user can take their time
 * before starting to speak. No DOM dependencies, and the clock can be injected,
 * so it is unit-testable in Node (see tests/silence.test.js).
 */
export class SilenceDetector {
  #timeoutMs = 3000;
  #threshold;
  #onTick;
  #onSilence;
  #now;
  #armed = false;
  #fired = false;
  #lastActivity = 0;
  #timer = null;

  /**
   * @param {object} o
   * @param {number}   [o.threshold=0.02]  raw RMS treated as speech (quiet room ≈ 0.005, speech ≈ 0.05+)
   * @param {number}   [o.graceMs=700]     silence shorter than this is a normal pause; no countdown shown
   * @param {(remaining: number|null, msLeft: number) => void} [o.onTick]  remaining 1→0 while counting down, null otherwise
   * @param {() => void} o.onSilence      fired once per session
   * @param {() => number} [o.now]
   */
  constructor({ threshold = 0.02, graceMs = 700, onTick, onSilence, now = () => performance.now() }) {
    this.#threshold = threshold;
    this.graceMs = graceMs;
    this.#onTick = onTick;
    this.#onSilence = onSilence;
    this.#now = now;
  }

  get running() {
    return this.#timer !== null;
  }

  start(timeoutMs, { autoTick = true } = {}) {
    this.stop();
    this.#timeoutMs = timeoutMs;
    this.#armed = false;
    this.#fired = false;
    this.#lastActivity = this.#now();
    if (autoTick) this.#timer = setInterval(() => this.tick(), 100);
    else this.#timer = 0; // manual ticking (tests)
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#onTick?.(null, 0);
  }

  /** Feed raw RMS from the mic. */
  level(rms) {
    if (rms >= this.#threshold) this.activity();
  }

  /** Something was heard or transcribed. */
  activity() {
    if (this.#timer === null) return;
    this.#armed = true;
    this.#lastActivity = this.#now();
  }

  tick() {
    if (this.#timer === null || this.#fired) return;
    if (!this.#armed) return this.#onTick?.(null, 0);

    const silentFor = this.#now() - this.#lastActivity;
    if (silentFor >= this.#timeoutMs) {
      this.#fired = true;
      this.stop();
      this.#onSilence();
      return;
    }
    if (silentFor < this.graceMs) return this.#onTick?.(null, 0);

    const window = this.#timeoutMs - this.graceMs;
    const msLeft = this.#timeoutMs - silentFor;
    this.#onTick?.(Math.max(0, msLeft / window), msLeft);
  }
}
