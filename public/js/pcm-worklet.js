/**
 * AudioWorklet: runs on the audio rendering thread.
 * Downsamples mic input (usually 44.1/48 kHz float32) to 16 kHz PCM16 mono,
 * and posts ~100 ms chunks plus an RMS level for the UI meter.
 *
 * Box-filter averaging over each output window doubles as a cheap low-pass,
 * which is adequate for speech recognition input.
 */
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 ms @ 16 kHz

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // `sampleRate` is a worklet global
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outIdx = 0;
    this.sqSum = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i];
      this.count++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.sqSum += s * s;
        this.out[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;

        if (this.outIdx === CHUNK_SAMPLES) {
          const rms = Math.sqrt(this.sqSum / CHUNK_SAMPLES);
          // Transfer the buffer (zero-copy) and start a fresh one.
          this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]);
          this.out = new Int16Array(CHUNK_SAMPLES);
          this.outIdx = 0;
          this.sqSum = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
