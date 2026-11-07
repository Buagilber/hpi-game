// Озвучення розповіді Ведучого голосом браузера (D-17, D-29: у MVP один голос).
// Читається лише текст розповіді — без ID, значків і службових рядків (D-07).

const synth = window.speechSynthesis;
let voice = null;
let enabled = true;
let speakingKey = null;          // який текст зараз читається (номер етапу) — для іконки кнопки 🔊/🔇
let listeners = [];
let run = 0;                     // номер поточного читання: події від скасованого читання не чіпають іконку
const notify = () => listeners.forEach((fn) => fn(speakingKey));

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

  get speakingKey() { return speakingKey; },
  onChange(fn) { listeners.push(fn); },

  stop() {
    run += 1;
    synth?.cancel();
    if (speakingKey !== null) { speakingKey = null; notify(); }
  },

  // fragments: [{ voice, text }] — читаємо по реченнях: довгі фрази в деяких браузерах обриваються.
  // onProgress(i, total) — коли починає звучати речення i (для автопрокрутки фінального тексту).
  speak(fragments, { force = false, key = null, onProgress = null } = {}) {
    if (!synth || (!enabled && !force)) return;
    synth.cancel();
    const sentences = fragments
      .flatMap((f) => f.text.match(/[^.!?…]+[.!?…]*["»]?\s*/g) ?? [f.text])
      .map((s) => s.trim())
      .filter(Boolean);
    const myRun = ++run;
    speakingKey = key;
    notify();
    sentences.forEach((s, i) => {
      const u = new SpeechSynthesisUtterance(s);
      u.lang = "uk-UA";
      if (voice) u.voice = voice;
      u.rate = 0.95;
      if (onProgress) u.onstart = () => { if (run === myRun) onProgress(i, sentences.length); };
      if (i === sentences.length - 1) u.onend = () => { if (run === myRun) { speakingKey = null; notify(); } };
      synth.speak(u);
    });
  },
};
