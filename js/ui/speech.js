// Озвучення розповіді Ведучого голосом браузера (D-17, D-29: у MVP один голос).
// Читається лише текст розповіді — без ID, значків і службових рядків (D-07).

const synth = window.speechSynthesis;
let voice = null;
let enabled = true;

function pickVoice() {
  const voices = synth?.getVoices() ?? [];
  voice = voices.find((v) => v.lang === "uk-UA" && v.localService) ?? voices.find((v) => /^uk/i.test(v.lang)) ?? null;
}
if (synth) {
  pickVoice();
  synth.addEventListener?.("voiceschanged", pickVoice);
}

export const speech = {
  get available() { return !!synth; },
  get hasUkrainianVoice() { return !!voice; },
  get enabled() { return enabled; },
  set enabled(v) { enabled = v; if (!v) this.stop(); },

  stop() { synth?.cancel(); },

  // fragments: [{ voice, text }] — читаємо по реченнях: довгі фрази в деяких браузерах обриваються.
  speak(fragments, { force = false } = {}) {
    if (!synth || (!enabled && !force)) return;
    synth.cancel();
    const sentences = fragments
      .flatMap((f) => f.text.match(/[^.!?…]+[.!?…]*["»]?\s*/g) ?? [f.text])
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of sentences) {
      const u = new SpeechSynthesisUtterance(s);
      u.lang = "uk-UA";
      if (voice) u.voice = voice;
      u.rate = 0.95;
      synth.speak(u);
    }
  },
};
