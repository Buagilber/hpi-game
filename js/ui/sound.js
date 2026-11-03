// Звуки кубика, синтезовані через WebAudio: без файлів і ліцензій (T-09). Справжні звуки — пізніше (D-28).

let ctx;
let enabled = true;
export const soundSettings = {
  get enabled() { return enabled; },
  set enabled(v) { enabled = v; },
};

function audio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = "sine", gain = 0.18, slideTo } = {}) {
  const a = audio();
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime + start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + start + dur);
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + dur + 0.05);
}

function click(start, gain = 0.25) {
  const a = audio();
  const len = Math.floor(a.sampleRate * 0.03);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800 + Math.random() * 1500;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + start);
}

const effects = {
  // Торохтіння кубика: серія клацань, що сповільнюються.
  roll(duration = 1.1) {
    let t = 0, step = 0.05;
    while (t < duration) { click(t, 0.18 + Math.random() * 0.12); t += step; step *= 1.12; }
  },
  land() { click(0, 0.4); tone(180, 0, 0.12, { type: "triangle", gain: 0.12 }); },
  spark() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, { type: "triangle" })); },
  funnyFail() { tone(392, 0, 0.25, { type: "square", gain: 0.08, slideTo: 300 }); tone(300, 0.25, 0.45, { type: "square", gain: 0.08, slideTo: 150 }); },
  success() { tone(660, 0, 0.15, { type: "triangle" }); tone(880, 0.12, 0.25, { type: "triangle" }); },
  fail() { tone(330, 0, 0.3, { type: "sine", gain: 0.12, slideTo: 260 }); },
};

// Кожен ефект мовчить, коли звуки вимкнено в меню.
export const sound = Object.fromEntries(Object.entries(effects).map(([k, fn]) => [k, (...a) => { if (enabled) fn(...a); }]));
