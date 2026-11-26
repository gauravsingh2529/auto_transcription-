/**
 * Text-to-speech via the browser's built-in Web Speech Synthesis (free, offline-capable
 * on most OSes). Picks a Hindi voice when the text contains Devanagari script.
 */
const DEVANAGARI = /[ऀ-ॿ]/;

export const tts = {
  supported: 'speechSynthesis' in window,

  speak(text) {
    if (!this.supported || !text?.trim()) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const lang = DEVANAGARI.test(text) ? 'hi-IN' : 'en-IN';
    u.lang = lang;
    const voices = speechSynthesis.getVoices();
    u.voice =
      voices.find((v) => v.lang === lang) ??
      voices.find((v) => v.lang.startsWith(lang.slice(0, 2))) ??
      null;
    speechSynthesis.speak(u);
  },

  stop() {
    if (this.supported) speechSynthesis.cancel();
  },
};
