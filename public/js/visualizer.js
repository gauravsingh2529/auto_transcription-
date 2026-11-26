/**
 * Scrolling, mirrored bar waveform driven by mic RMS levels.
 * - push(rms) can be called at any rate; bars advance on a fixed cadence so
 *   Gemini (10 Hz chunks) and Web Speech (60 Hz meter) look the same.
 * - When idle it shows a gentle "breathing" wave so the UI never feels dead.
 */
const STEP_MS = 55;

export class Visualizer {
  #canvas;
  #ctx;
  #bars;
  #targets;
  #display;
  #pending = 0;
  #lastStep = 0;
  #active = false;
  #smoothLevel = 0;
  #colors = ['#6366f1', '#8b5cf6', '#22d3ee'];
  #onLevel;

  constructor(canvas, { bars = 56, onLevel } = {}) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#bars = bars;
    this.#targets = new Float32Array(bars);
    this.#display = new Float32Array(bars);
    this.#onLevel = onLevel;

    new ResizeObserver(() => this.#resize()).observe(canvas);
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => this.#readColors());
    this.#resize();
    requestAnimationFrame((t) => this.#frame(t));
  }

  /** Map raw RMS (speech ≈ 0.02–0.25) to a perceptual 0..1 level with a noise gate. */
  push(rms) {
    const v = Math.min(1, Math.max(0, (Math.sqrt(rms) - 0.05) * 2.4));
    this.#pending = Math.max(this.#pending, v);
  }

  setActive(on) {
    this.#active = on;
    if (!on) {
      this.#targets.fill(0);
      this.#pending = 0;
    }
  }

  #readColors() {
    const s = getComputedStyle(document.documentElement);
    this.#colors = ['--accent-2', '--accent', '--accent-3'].map((v) => s.getPropertyValue(v).trim() || '#8b5cf6');
  }

  #resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.#canvas.getBoundingClientRect();
    this.#canvas.width = Math.max(1, Math.round(width * dpr));
    this.#canvas.height = Math.max(1, Math.round(height * dpr));
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#readColors();
  }

  #frame(now) {
    if (this.#active && now - this.#lastStep >= STEP_MS) {
      this.#targets.copyWithin(0, 1);
      this.#targets[this.#bars - 1] = this.#pending;
      this.#smoothLevel = this.#smoothLevel * 0.6 + this.#pending * 0.4;
      this.#pending = 0;
      this.#lastStep = now;
    }
    if (!this.#active) this.#smoothLevel *= 0.9;
    this.#onLevel?.(this.#smoothLevel);

    const t = now / 1000;
    for (let i = 0; i < this.#bars; i++) {
      const idle = 0.06 + 0.05 * (1 + Math.sin(t * 2.2 + i * 0.32)) * (this.#active ? 0.3 : 1);
      const target = Math.max(this.#targets[i], idle);
      // Fast attack, slower release feels natural.
      const k = target > this.#display[i] ? 0.45 : 0.12;
      this.#display[i] += (target - this.#display[i]) * k;
    }
    this.#draw();
    requestAnimationFrame((ts) => this.#frame(ts));
  }

  #draw() {
    const ctx = this.#ctx;
    const { width: w, height: h } = this.#canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, w, h);

    const gap = 3;
    const barW = Math.max(2, (w - gap * (this.#bars - 1)) / this.#bars);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, this.#colors[0]);
    grad.addColorStop(0.5, this.#colors[1]);
    grad.addColorStop(1, this.#colors[2]);
    ctx.fillStyle = grad;

    for (let i = 0; i < this.#bars; i++) {
      // Fade bars toward the edges for a soft vignette.
      const edge = Math.sin((Math.PI * (i + 0.5)) / this.#bars);
      ctx.globalAlpha = 0.25 + 0.75 * edge;
      const bh = Math.max(3, this.#display[i] * h * 0.95);
      const x = i * (barW + gap);
      const y = (h - bh) / 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, barW / 2);
      else ctx.rect(x, y, barW, bh);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
