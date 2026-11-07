// Стан гри: створення, перевірка відповіді Ведучого, застосування змін, запобіжники.
// Стан — джерело правди: Ведучий отримує його в кожному запиті, а застосунок не дає порушити правила.

export function newState(manifest) {
  return { ...structuredClone(manifest.start_state), plan: { ok: 0, broken: false } };
}

// Стан, який бачить Ведучий (без службового лічильника плану).
export function publicState(state) {
  const { plan, ...rest } = state;
  return rest;
}

const ID_IN_TEXT = /\b(BG|NP|EN|EV|IT|LB)-[0-9A-Za-z-]+|\[Показати[^\]]*\]/g;
const SERVICE = /[⭐🟡]|\(\s*[+−-]\d\s*⭐?\s*\)/g;
// Символи, яких не має бути в українському тексті для дітей (збої генерації: арабиця, CJK тощо).
const FOREIGN = /[؀-ۿ֐-׿฀-๿぀-ヿ㐀-鿿가-힯]+/g;

// Коди сцен і Спогадів (S3А, F2, V1, M1…) — з маніфесту; латинська й кирилична «А/Б/В» вважаються однаковими.
const LOOKALIKE = { A: "[AА]", B: "[BБ]", "А": "[AА]", "Б": "[BБ]", "В": "[BВ]" };
function codePattern(manifest) {
  const blocks = Object.keys(manifest?.blocks ?? {}).map((c) => [...c].map((ch) => LOOKALIKE[ch] ?? ch).join(""));
  const alts = [...blocks, "M\\d"].join("|");
  // Код у дужках разом із дужками, або окремий код як слово.
  return new RegExp(`\\s*\\(\\s*(?:${alts})\\s*\\)|(?<![\\p{L}\\d])(?:${alts})(?![\\p{L}\\d])`, "gu");
}

// Прибирає службове з тексту розповіді; повертає перелік зауважень для журналу.
export function sanitizeNarration(narration, manifest) {
  const notes = [];
  const codes = codePattern(manifest);
  const clean = (narration ?? []).map((f) => {
    let t = String(f.text ?? "");
    if (codes && t.search(codes) >= 0) { notes.push("коди сцен прибрано"); t = t.replace(codes, ""); }
    if (t.search(ID_IN_TEXT) >= 0) notes.push("ID у тексті прибрано");
    if (t.search(FOREIGN) >= 0) notes.push("чужі символи прибрано");
    t = t.replace(ID_IN_TEXT, "").replace(SERVICE, "").replace(FOREIGN, "").replace(/\s{2,}/g, " ").replace(/\s+([?!.,:;])/g, "$1").trim();
    return { voice: f.voice, text: t };
  }).filter((f) => f.text);
  return { narration: clean, notes };
}

// Чи згадали гравці суперздібність героя в репліках цього етапу (запобіжник D-45).
// Порівнюємо без урахування «о/а» і закінчень: діти й помічник часто кажуть «Катаклізм» замість «Котаклізм».
const norm = (s) => s.toLowerCase().replace(/о/g, "а").replace(/[ʼ'’]/g, "");
function superMentioned(manifest, hero, messages) {
  const name = norm(manifest.heroes[hero]?.super ?? "");
  const stem = name.slice(0, Math.max(4, name.length - 2));
  return messages.some((m) => norm(m.text).includes(stem));
}

// Застосовує state_changes відповіді. Повертає { issues, fx } — зауваження і ефекти, які показує застосунок.
export function applyResponse(manifest, state, resp, { blockBefore, messages }) {
  const issues = [];
  const fx = [];
  const ch = resp.state_changes ?? {};
  const blocks = manifest.blocks;
  const inBoss = blocks[blockBefore]?.boss || blocks[resp.scene]?.boss;

  for (const it of ch.items_remove ?? []) {
    if (state.inventory.includes(it)) state.inventory = state.inventory.filter((x) => x !== it);
    else issues.push(`знято відсутній предмет ${it}`);
  }
  for (const it of ch.items_add ?? []) {
    if (!manifest.items[it] || state.inventory.includes(it)) continue;
    state.inventory.push(it);
    for (const b of manifest.bonuses) {
      if (b.requires_item === it && b.uses === 1 && !state.prepared.includes(b.id)) state.prepared.push(b.id);
    }
  }

  let stars = ch.stars_delta ?? 0;
  if (stars < 0 && !inBoss) { issues.push("⭐ поза боєм не знімаються (D-49)"); stars = 0; }
  if (stars < -1) { issues.push("не більше −1 ⭐ за етап"); stars = -1; }
  state.stars = Math.max(0, Math.min(manifest.rules.stars_max, state.stars + stars));

  let shield = ch.shield_delta ?? 0;
  if (shield < 0 && !inBoss) { issues.push("щит поза боєм не змінюється"); shield = 0; }
  state.shield = Math.max(0, Math.min(manifest.rules.shield, state.shield + shield));
  if (ch.boss_phase) state.boss_phase = ch.boss_phase;

  for (const h of ch.super_used ?? []) {
    if (state.super_used.includes(h)) { issues.push(`суперздібність ${h} уже використана (D-45)`); continue; }
    if (!superMentioned(manifest, h, messages)) { issues.push(`суперздібність ${h} не згадана гравцями — не зараховано`); continue; }
    state.super_used.push(h);
    fx.push(manifest.heroes[h].super_fx);
  }

  for (const p of ch.prepared_add ?? []) {
    if (manifest.bonuses.some((b) => b.id === p) && !state.prepared.includes(p)) state.prepared.push(p);
  }
  // Згорання заготовок: за виходом із блоку та за завершенням фази.
  for (const b of manifest.bonuses) {
    if (!state.prepared.includes(b.id)) continue;
    const leftBlock = b.expires_on_leave && blockBefore === b.expires_on_leave && resp.scene !== b.expires_on_leave;
    const phaseOver = b.expires_on_phase_end && state.boss_phase && state.boss_phase !== b.expires_on_phase_end && Object.keys(blocks).indexOf(state.boss_phase) > Object.keys(blocks).indexOf(b.expires_on_phase_end);
    if (leftBlock || phaseOver || (b.expires_on_phase_end && state.boss_phase === "done")) state.prepared = state.prepared.filter((p) => p !== b.id);
  }

  if (blocks[resp.scene]) state.block = resp.scene;
  if (resp.participants?.length) state.participants = resp.participants;
  return { issues, fx };
}
