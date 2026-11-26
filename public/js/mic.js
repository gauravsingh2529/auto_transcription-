/** Captures the microphone and yields 16 kHz PCM16 chunks via an AudioWorklet. */
export class MicStreamer {
  #stream = null;
  #ctx = null;
  #node = null;

  get active() {
    return this.#ctx !== null;
  }

  async start({ onChunk, onLevel }) {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.#ctx = new AudioContext();
    await this.#ctx.audioWorklet.addModule('/js/pcm-worklet.js');

    const source = this.#ctx.createMediaStreamSource(this.#stream);
    this.#node = new AudioWorkletNode(this.#ctx, 'pcm-capture');
    this.#node.port.onmessage = ({ data }) => {
      onChunk?.(data.pcm);
      onLevel?.(data.rms);
    };

    // Route through a muted gain so the graph is "pulled" without echoing the mic.
    const mute = this.#ctx.createGain();
    mute.gain.value = 0;
    source.connect(this.#node).connect(mute).connect(this.#ctx.destination);
  }

  async stop() {
    this.#node?.port.close();
    this.#node?.disconnect();
    this.#stream?.getTracks().forEach((t) => t.stop());
    await this.#ctx?.close().catch(() => {});
    this.#node = this.#stream = this.#ctx = null;
  }
}

/** Shared mic level helper for engines that don't stream PCM (Web Speech). */
export async function startLevelMeter(onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sq = 0;
    for (const v of buf) sq += v * v;
    onLevel(Math.sqrt(sq / buf.length));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return async () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
  };
}
