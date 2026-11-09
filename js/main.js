// Точка входу: вхід з ключем і дисклеймер (E2), сесія гри з Ведучим (E3).
import { castFromManifest, renderDrafts, renderScene, renderCards, renderEnemy, renderHud, renderLog, renderHeroes, renderInventory, setBusy, setStatus } from "./ui/screen.js?v=20261109-1826";
import { askForKey, showDisclaimer, openMenu, askConfirm, DISCLAIMER_VERSION } from "./ui/modals.js?v=20261109-1826";
import { loadAdventure, loadSkill } from "./engine/content.js?v=20261109-1826";
import { DEFAULT_MODEL, transcribe } from "./engine/gemini.js?v=20261109-1826";
import { rollDie } from "./engine/dice.js?v=20261109-1826";
import { askRoll, showRollInScene, markRollResult, hideRollInScene, showCritical } from "./ui/dice.js?v=20261109-1826";
import { showFinale } from "./ui/finale.js?v=20261109-1826";
import { Game } from "./engine/game.js?v=20261109-1826";
import * as store from "./engine/storage.js?v=20261109-1826";
import { speech } from "./ui/speech.js?v=20261109-1826";
import { soundSettings } from "./ui/sound.js?v=20261109-1826";
import { createRecorder } from "./ui/voice.js?v=20261109-1826";
import { openInventory } from "./ui/inventory.js?v=20261109-1826";
import { askResume, openArchive } from "./ui/archive.js?v=20261109-1826";
import * as archive from "./engine/archive.js?v=20261109-1826";

const ADVENTURE = "content/adventures/adventure_1_v4";
const SKILL = "content/skill/gamemaster.md";
const MAIN_IMAGE = /^(BG|EV)-/;      // фон сцени і ключові моменти 16:9
const CARD_IMAGE = /^(NP|IT|EN)-/;   // персонажі, вороги й предмети 1:1 — карткою поверх сцени
const ENEMY_IMAGE = /^EN-/;          // у бою портрет ворога лишається на екрані (Z-29)

let content, skill, cast, game;
let view = 0;
let active = null;
let busy = false;

const $ = (id) => document.getElementById(id);

// Портрет ворога видно від сцени входу в арену до кінця бою: останній показаний EN-*.
function currentEnemy() {
  const order = Object.keys(content.manifest.blocks);
  const from = order.indexOf(content.manifest.context.boss_from);
  const b = game.state.block;
  const inBoss = from >= 0 && order.indexOf(b) >= from && !content.manifest.blocks[b]?.insert && b !== content.manifest.finale?.block;
  if (!inBoss || game.state.boss_phase === "done") return null;
  for (let i = game.stages.length - 1; i >= 0; i--) {
    const img = game.stages[i].show.find((id) => ENEMY_IMAGE.test(id));
    if (img) return img;
  }
  return null;
}

function currentImage() {
  for (let i = game.stages.length - 1; i >= 0; i--) {
    const img = game.stages[i].show.find((id) => MAIN_IMAGE.test(id));
    if (img) return img;
  }
  return "LB-PH-a";
}

function draw() {
  const s = game.state;
  const aw = game.awaiting ?? { type: "answer", hero: "any" };
  const heroIds = cast.heroes.map((h) => h.id);
  // Z-36: відповісти може і той, до кого звертається Ведучий, навіть якщо застосунок ще не переніс його в сцену.
  const lastCta = game.stages.at(-1)?.callToAction?.hero;
  const addressed = [aw.hero, lastCta].flatMap((h) => (h === "both" || h === "any" ? heroIds : heroIds.includes(h) ? [h] : []));
  const speakers = [...new Set([...s.participants, ...addressed])];
  if (!active || !(speakers.includes(active) || (active === "both" && speakers.length >= 2))) active = speakers[0] ?? heroIds[0];
  renderScene(currentImage());
  renderEnemy(currentEnemy());
  renderHud({ stars: s.stars, starsMax: content.manifest.rules.stars_max, shield: s.boss_phase && s.boss_phase !== "done" ? s.shield : null, shieldMax: content.manifest.rules.shield });
  renderLog(cast, game.stages, view);
  updateReplayButton();
  $("log-latest").hidden = view >= game.stages.length - 1;
  renderHeroes(cast, { active, awaited: aw.type === "answer" ? aw.hero : null, participants: speakers }, (hero) => { active = hero; draw(); });
  renderInventory(s.inventory);
  const rollBtn = $("roll");
  rollBtn.hidden = aw.type !== "roll" || busy;
  rollBtn.classList.toggle("is-waiting", aw.type === "roll" && !busy);
  if (aw.type === "roll") rollBtn.textContent = `🎲 Кидок: ${heroName(game.rollHero)}`;
  renderDrafts(cast, game.drafts, view >= game.stages.length - 1 && !busy);
  $("send").disabled = busy || game.finished;
  $("pass").disabled = busy || game.finished;
  $("input").disabled = busy || game.finished;
}

// Іконка кнопки читання на видимому етапі: 🔊 — зараз читається (натиснути — зупинити), 🔇 — тиша (натиснути — читати спочатку).
function updateReplayButton() {
  const btn = document.querySelector("[data-replay]");
  if (!btn) return;
  const on = speech.speakingKey === view;
  btn.textContent = on ? "🔊" : "🔇";
  btn.classList.toggle("is-speaking", on);
  btn.setAttribute("aria-label", on ? "Зупинити читання" : "Прочитати ще раз");
}

// Що озвучується: розповідь, а заклик до дії — останнім (Z-01).
const spoken = (stage) => [...stage.narration, ...(stage.callToAction?.text ? [{ voice: "narrator", text: stage.callToAction.text }] : [])];

// Фінал (Z-20): окремий запит фінальної промови → фінальний екран → архів.
async function finish() {
  setBusy(true); setStatus("Ведучий дописує останню сторінку історії…");
  try {
    if (!game.epilogue) await game.finale();
  } catch (e) {
    console.error(e);
    setStatus("Не вдалося отримати фінальну промову.", { retry: () => finish() });
    setBusy(false);
    return;
  }
  // Z-45: фінальний екран — лише коли диктор дочитав останню сцену, і після короткої паузи.
  const lastKey = game.stages.length - 1;
  if (speech.speakingKey === lastKey) {
    setStatus("Ведучий завершує історію…");
    await new Promise((done) => speech.onChange((key) => { if (key !== lastKey) done(); }));
  }
  await new Promise((r) => setTimeout(r, 1500));
  setBusy(false); setStatus("");
  if (!game.archived) { archive.add(game.toJSON(), { title: content.manifest.title, finished: true }); game.archived = true; }
  store.save("session", game.toJSON());
  speech.stop();
  showFinale({ manifest: content.manifest, game, onNewGame: () => newGame(), onArchive: () => openArchive({ cast, title: content.manifest.title, onExportCurrent: exportCurrent }) });
}

const exportCurrent = () => archive.download(game.toJSON(), archive.fileName({ adventure: content.manifest.adventure, endedAt: new Date().toISOString() }));

function afterStage(stage) {
  view = game.stages.length - 1;
  const aw = stage.awaiting;
  if (aw.type === "answer" && aw.hero !== "any") active = aw.hero;
  store.save("session", game.toJSON());

  // Картки: ворог у бою вже видно портретом, тому карткою — лише поза боєм.
  const cards = stage.show.filter((id) => CARD_IMAGE.test(id) && !(ENEMY_IMAGE.test(id) && currentEnemy()));
  if (cards.length) renderCards(cards.slice(0, 3));
  draw();
}

async function run(action) {
  busy = true; setBusy(true); setStatus("Ведучий думає…"); draw();
  try {
    const stage = await action();
    if (stage.rolls.length) markRollResult(stage.rolls[0].success);
    afterStage(stage);
    speech.speak(spoken(stage), { key: game.stages.length - 1 });
    if (game.finished) await finish();
    setStatus("");
  } catch (e) {
    console.error(e);
    setStatus(errorText(e), { retry: () => run(() => game.retry()) });
  } finally {
    busy = false; setBusy(false); draw();
  }
}

function errorText(e) {
  return ({
    daily_limit: "Денний ліміт запитів вичерпано. Гру збережено — можна продовжити пізніше.",
    rate_limit: "Ведучий захекався: забагато запитів поспіль. Спробуйте ще раз за хвилину.",
    unavailable: "Сервіс Gemini перевантажений. Спробуйте ще раз трохи згодом.",
    network: "Немає зв'язку з Gemini. Перевірте інтернет.",
    invalid_key: "Ключ більше не працює. Відкрийте меню і введіть новий.",
    bad_format: "Ведучий збився з думки. Спробуйте ще раз.",
  })[e.kind] ?? "Щось пішло не так. Спробуйте ще раз.";
}

// Чернетки (Z-03): ➤ додає репліку активного героя в чергу, «Передати хід» надсилає всю чергу Ведучому одним запитом.
function addDraft(e) {
  e?.preventDefault();
  const text = $("input").value.trim();
  if (!text || busy || game.finished) return false;
  game.drafts.push({ hero: active, text });
  $("input").value = "";
  store.save("session", game.toJSON());
  draw();
  return true;
}

async function passTurn() {
  if (busy || game.finished) return;
  addDraft();
  if (!game.drafts.length) return;
  // Z-10: Ведучий чекав відповіді від обох, а в черзі репліки лише одного героя — м'яко нагадати.
  const aw = game.awaiting;
  const voices = new Set(game.drafts.map((d) => d.hero));
  if (aw?.type === "answer" && aw.hero === "both" && game.state.participants.length > 1 && !voices.has("both") && voices.size < game.state.participants.length) {
    // Ігрове вікно (без статі в тексті): аватар героя, що ще не відповів.
    const silent = game.state.participants.filter((h) => !voices.has(h));
    const yes = await askConfirm({
      title: `${silent.map(heroName).join(" і ")} ще мовчить`,
      text: "Ведучий чекав відповіді від обох героїв. Дати слово ще й цьому герою чи передати хід уже зараз?",
      image: cast.heroes.find((x) => x.id === silent[0])?.card,
      ok: "Передати хід",
      cancel: "Зачекати",
    });
    if (!yes) return;
  }
  const messages = [...game.drafts];
  speech.stop();
  hideRollInScene();
  run(async () => {
    const stage = await game.sendMessages(messages);
    game.drafts = [];
    return stage;
  });
}

function removeLastDraft() {
  game.drafts.pop();
  store.save("session", game.toJSON());
  draw();
}

// Кидок (E4): модалка → анімація → число у сцені → критична картинка (поки Ведучий думає) → підсвітка після відповіді.
async function roll() {
  if (busy) return;
  speech.stop();
  const value = await askRoll({ who: heroName(game.rollHero), roll: rollDie });
  if (value === null) { $("input").focus(); return; }
  showRollInScene(value);
  addDraft();
  const messages = [...game.drafts];
  run(async () => {
    const stage = await game.sendRoll(value, ({ result, critImage }) => { showCritical({ critical: result.critical, image: critImage }); }, messages);
    game.drafts = [];
    return stage;
  });
}

// Слова гри для розпізнавання голосу: імена, здібності, NPC, предмети з маніфесту.
function vocabulary() {
  const m = content.manifest;
  const heroes = Object.values(m.heroes).flatMap((h) => [h.name, h.base, h.super]);
  const voices = Object.entries(m.voices).filter(([id]) => id !== "narrator").map(([, n]) => n);
  return [...new Set([...heroes, ...voices, ...Object.values(m.items).map((i) => i.name), ...(m.vocabulary ?? [])])];
}

const heroName = (id) => id === "both" ? "Разом" : cast.heroes.find((h) => h.id === id)?.name ?? "";

async function newGame() {
  if (game?.stages.length && !game.archived) archive.add(game.toJSON(), { title: content.manifest.title, finished: game.finished });
  store.remove("session");
  game = new Game({ content, skill, key: store.load("apiKey"), model: DEFAULT_MODEL });
  game.onStatus = onStatus;
  view = 0; active = null;
  draw();
  await run(() => game.start());
}

function onStatus(ev) {
  if (ev.kind === "retry") setStatus(`Ведучий набирає повітря… (спроба ${ev.attempt + 1}, ${ev.wait} с)`);
  if (ev.kind === "format_retry") setStatus("Ведучий перечитує свої нотатки…");
}

async function ensureAccess(reason) {
  if (!store.load("apiKey")) store.save("apiKey", await askForKey({ reason }));
  if (store.load("disclaimerVersion") !== DISCLAIMER_VERSION) {
    await showDisclaimer({ requireAccept: true });
    store.save("disclaimerVersion", DISCLAIMER_VERSION);
  }
}

async function main() {
  [content, skill] = await Promise.all([loadAdventure(ADVENTURE), loadSkill(SKILL)]);
  cast = castFromManifest(content.manifest);
  document.title = content.manifest.title;

  $("log-prev").addEventListener("click", () => { view = Math.max(0, view - 1); draw(); });
  $("log-next").addEventListener("click", () => { view = Math.min(game.stages.length - 1, view + 1); draw(); });
  $("composer").addEventListener("submit", addDraft);
  $("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) addDraft(e); });
  $("pass").addEventListener("click", passTurn);
  $("drafts").addEventListener("click", (e) => { if (e.target.closest("[data-remove-last]")) removeLastDraft(); });
  $("roll").addEventListener("click", roll);
  $("inventory").addEventListener("click", () => openInventory(content.manifest, game.state));
  $("log-body").addEventListener("click", (e) => {
    // 🔊 / 🔇 (Z-14): якщо цей етап зараз читається — зупинити, інакше прочитати спочатку.
    if (e.target.closest("[data-replay]")) {
      if (speech.speakingKey === view) speech.stop();
      else speech.speak(spoken(game.stages[view]), { force: true, key: view });
    }
  });
  $("log-latest").addEventListener("click", () => { view = game.stages.length - 1; draw(); });
  speech.enabled = store.load("speech", true);
  speech.onChange(() => updateReplayButton());
  soundSettings.enabled = store.load("sounds", true);
  createRecorder({
    button: $("mic"),
    onError: (text) => setStatus(text),
    onAudio: async (blob) => {
      speech.stop();
      const input = $("input");
      input.placeholder = "Розпізнаю…";
      $("mic").disabled = true;
      try {
        const text = await transcribe({ key: game.key, blob, hints: vocabulary() });
        if (text) input.value = input.value ? `${input.value} ${text}` : text;
        else setStatus("Не вдалося розібрати слова. Спробуйте ще раз або напишіть текстом.");
        input.focus();
      } catch (e) {
        setStatus("Розпізнавання не вдалося. Спробуйте ще раз або напишіть текстом.");
      } finally {
        input.placeholder = "Що роблять герої?";
        $("mic").disabled = false;
      }
    },
  });
  $("menu").addEventListener("click", () => openMenu({
    speechOn: speech.enabled,
    soundsOn: soundSettings.enabled,
    onToggleSounds: () => { soundSettings.enabled = !soundSettings.enabled; store.save("sounds", soundSettings.enabled); },
    onToggleSpeech: () => { speech.enabled = !speech.enabled; store.save("speech", speech.enabled); },
    onNewGame: () => newGame(),
    onArchive: () => openArchive({ cast, title: content.manifest.title, onExportCurrent: () => archive.download(game.toJSON(), archive.fileName({ adventure: content.manifest.adventure, endedAt: new Date().toISOString() })) }),
    onDisclaimer: () => showDisclaimer({ requireAccept: false }),
    onForgetKey: async () => { store.remove("apiKey"); await ensureAccess(); game.key = store.load("apiKey"); },
  }));

  await ensureAccess();
  const saved = store.load("session");
  const unfinished = saved?.adventure === content.manifest.adventure && saved.stages?.length && saved.awaiting?.type !== "end";
  const choice = unfinished ? await askResume({ title: content.manifest.title, stages: saved.stages.length, savedAt: saved.stages.at(-1).at }) : "new";
  if (choice === "continue") {
    game = new Game({ content, skill, key: store.load("apiKey"), model: DEFAULT_MODEL, saved });
    game.onStatus = onStatus;
    view = game.stages.length - 1;
    draw();
  } else {
    if (unfinished && !saved.archived) archive.add(saved, { title: content.manifest.title, finished: false });
    await newGame();
  }
}

main();
