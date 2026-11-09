// Стан гри: створення, перевірка відповіді Ведучого, застосування змін, запобіжники.
// Стан — джерело правди: Ведучий отримує його в кожному запиті, а застосунок не дає порушити правила
// (умови нагород, закриття фаз боса, хаб, місце кожного героя — Z-10, Z-13, Z-16, Z-18).

export function newState(manifest) {
  const s = structuredClone(manifest.start_state);
  return {
    ...s,
    positions: Object.fromEntries((s.participants ?? Object.keys(manifest.heroes)).map((h) => [h, s.block])),
    item_sources: {},
    events: [],
    hub_done: [],
    phase: { id: null, successes: 0, stages: 0 },
    plan: { ok: 0, broken: false },
  };
}

// Старі збереження (до v4.1) — доповнюємо полями, яких там не було.
export function upgradeState(manifest, state) {
  const base = newState(manifest);
  for (const k of ["positions", "item_sources", "events", "hub_done", "phase"]) state[k] ??= base[k];
  if (!Object.keys(state.positions).length) state.positions = Object.fromEntries(state.participants.map((h) => [h, state.block]));
  return state;
}

const memoryCount = (manifest, inv) => inv.filter((id) => manifest.items[id]?.memory).length;
const heroName = (manifest, h) => manifest.heroes[h]?.name ?? h;

// Стан, який бачить Ведучий: предмети з назвами й тим, де їх отримано; чого ще немає; хто де; прогрес хабу й фази; останні події.
export function publicState(manifest, state) {
  const obtained = state.inventory.map((id) => ({ id, name: manifest.items[id]?.name, from: state.item_sources[id] ?? "?" }));
  const notObtained = Object.entries(manifest.items).filter(([id]) => !state.inventory.includes(id)).map(([id, i]) => ({ id, name: i.name }));
  return {
    block: state.block,
    participants: state.participants,
    positions: Object.fromEntries(Object.entries(state.positions).map(([h, b]) => [heroName(manifest, h), b])),
    stars: state.stars,
    shield: state.shield,
    boss_phase: state.boss_phase,
    super_used: state.super_used.map((h) => `${heroName(manifest, h)}: ${manifest.heroes[h]?.super}`),
    prepared: state.prepared.map((p) => manifest.bonuses.find((b) => b.id === p)?.name ?? p),
    spark_pending: state.spark_pending,
    items_obtained: obtained,
    items_not_obtained: notObtained,
    hub_rooms_done: state.hub_done,
    phase_progress: state.phase.id ? { phase: state.phase.id, successes: state.phase.successes, stages: state.phase.stages } : null,
    events: state.events.slice(-15),
  };
}

// ---------- текст ----------
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

export function cleanText(text, manifest, notes = []) {
  let t = String(text ?? "");
  const codes = codePattern(manifest);
  if (t.search(codes) >= 0) { notes.push("коди сцен прибрано"); t = t.replace(codes, ""); }
  if (t.search(ID_IN_TEXT) >= 0) notes.push("ID у тексті прибрано");
  if (t.search(FOREIGN) >= 0) notes.push("чужі символи прибрано");
  return t.replace(ID_IN_TEXT, "").replace(SERVICE, "").replace(FOREIGN, "").replace(/\s{2,}/g, " ").replace(/\s+([?!.,:;])/g, "$1").trim();
}

// Прибирає службове з тексту розповіді; повертає перелік зауважень для журналу.
export function sanitizeNarration(narration, manifest) {
  const notes = [];
  const clean = (narration ?? []).map((f) => ({ voice: f.voice, text: cleanText(f.text, manifest, notes) })).filter((f) => f.text);
  return { narration: clean, notes };
}

// ---------- перевірка відповіді ----------
// Чи згадали гравці суперздібність героя в репліках цього етапу (запобіжник D-45).
// Порівнюємо без урахування «о/а» і закінчень: діти й помічник часто кажуть «Катаклізм» замість «Котаклізм».
const norm = (s) => s.toLowerCase().replace(/о/g, "а").replace(/[ʼ'’]/g, "");
function superMentioned(manifest, hero, messages) {
  const name = norm(manifest.heroes[hero]?.super ?? "");
  const stem = name.slice(0, Math.max(4, name.length - 2));
  return messages.some((m) => norm(m.text).includes(stem));
}

function reachableFrom(manifest, block) {
  const b = manifest.blocks[block];
  return b ? [block, ...b.exits] : [];
}

// Успіхи кидків цього етапу, що зараховуються у фазу (спільний успіх = 2, Z-16). Захист фазу не закриває (Z-43).
function stageSuccesses(manifest, ctx, cond) {
  if (!ctx.rollTags?.length || ctx.rollKind === "defense") return 0;
  const tags = new Set(ctx.rollTags);
  if (!(cond.tags ?? []).every((t) => tags.has(t))) return 0;
  if (cond.tags_any && !cond.tags_any.some((t) => tags.has(t))) return 0;
  return ctx.rolls.filter((r) => r.success).reduce((n, r) => n + (r.hero === "both" ? manifest.rules.joint_success_counts ?? 2 : 1), 0);
}

// Повертає { violations, drop } без зміни стану. drop — що застосунок не прийме, якщо Ведучий не виправиться.
export function checkResponse(manifest, state, resp, ctx) {
  const v = [];
  const drop = { items: new Set(), prepared: new Set(), remove: new Set(), supers: new Set(), close: false, scene: false, consult: false, roll: false };
  const ch = resp.state_changes ?? {};
  const blocks = manifest.blocks;
  const before = ctx.blockBefore;

  // Суперздібності: раз за гру і лише коли гравці її назвали.
  const validSupers = [];
  for (const h of ch.super_used ?? []) {
    if (state.super_used.includes(h)) { v.push(`${heroName(manifest, h)} уже використав(-ла) суперздібність — вдруге не можна`); drop.supers.add(h); }
    else if (!superMentioned(manifest, h, ctx.messages)) { v.push(`гравці не застосовували суперздібність «${manifest.heroes[h]?.super}» — не позначай її і не описуй`); drop.supers.add(h); }
    else validSupers.push(h);
  }
  const rolledSuccess = ctx.rolls.some((r) => r.success);

  // Z-22: режим уточнення не рухає сюжет.
  if (resp.mode === "consult") {
    const changed = ["items_add", "items_remove", "super_used", "prepared_add"].some((k) => ch[k]?.length) || ch.stars_delta || ch.shield_delta || (ch.boss_phase && ch.boss_phase !== state.boss_phase);
    if (changed || resp.scene !== before || resp.await?.type === "roll") {
      v.push("mode=consult (гравці лише уточнюють): не змінюй стан і сцену й не проси кидок — відповідай на питання з «Деталей сцени» і спитай, що вони вирішують; якщо гравці вже ухвалили рішення — став mode=act");
      drop.consult = true; drop.scene = true;
    }
  }
  // Z-24: після провалу той самий герой не кидає одразу знову — спершу нова ситуація і вибір гравців.
  const aw = resp.await;
  if (aw?.type === "roll" && ctx.rolls.some((r) => !r.success && r.hero === aw.hero)) {
    v.push(`${aw.hero === "both" ? "герої щойно провалили спільний кидок" : `${heroName(manifest, aw.hero)} щойно провалив(-ла) кидок`} — не проси кидок знову: опиши нову ситуацію після провалу і спитай, що вони робитимуть (інший герой може діяти з кидком)`);
    drop.roll = true;
  }
  // Z-33: до кидка — лише спроба, без слів успіху (результат ще невідомий).
  if (aw?.type === "roll") {
    const pre = [...(resp.narration ?? []).filter((f) => f.voice === "narrator").map((f) => f.text), resp.call_to_action?.text ?? ""].join(" ");
    const hit = pre.match(/(?<![\p{L}])(вправн|спритн|влучн|успішн|блискуч)\p{L}*/iu);
    if (hit) v.push(`до кидка результат ще невідомий — прибери «${hit[0].trim()}»: опиши спробу і напругу, а що вийшло — після кидка`);
  }
  // ⭐ після цього етапу (для Підкріплення «коли скрутно», Z-28).
  const inBossNow = blocks[before]?.boss || blocks[resp.scene]?.boss;
  const starsAfter = Math.max(0, state.stars + (inBossNow ? Math.max(-1, Math.min(0, ch.stars_delta ?? 0)) : 0));

  // Предмети, що знімаються, мають бути в інвентарі.
  for (const it of ch.items_remove ?? []) if (!state.inventory.includes(it)) { v.push(`предмета «${manifest.items[it]?.name ?? it}» немає в інвентарі`); drop.remove.add(it); }

  // Нагороди лише за виконаної умови блоку (Z-13, Z-18, Z-19).
  const rewardsOf = (b) => blocks[b]?.rewards ?? [];
  const candidates = [...new Set([before, resp.scene])];
  const invAfter = [...state.inventory];
  const okReward = (r) => {
    if (r.unless_has && invAfter.includes(r.unless_has)) return `«${manifest.items[r.item]?.name ?? r.prepared}» — не та нагорода: «${manifest.items[r.unless_has].name}» вже є`;
    if (r.requires && !invAfter.includes(r.requires)) return `«${manifest.items[r.item]?.name}» видається лише якщо є «${manifest.items[r.requires].name}», а її немає`;
    if (r.when === "roll" && !rolledSuccess && !validSupers.length) return `«${manifest.items[r.item]?.name ?? r.prepared}» — лише після успішного кидка чи суперздібності; спершу попроси кидок`;
    if (r.when === "low_stars" && starsAfter > (r.max_stars ?? 1)) return `«${manifest.items[r.item]?.name}» — Софі кидає лише тоді, коли в команди лишилась ${r.max_stars ?? 1} ⭐ (зараз ${starsAfter})`;
    if (r.when === "fallback" && memoryCount(manifest, invAfter) >= (r.min_memories_below ?? 2)) return `«${manifest.items[r.item]?.name}» — лише якщо Спогадів менше ${r.min_memories_below}`;
    return null;
  };
  for (const it of ch.items_add ?? []) {
    if (state.inventory.includes(it)) continue;
    const rules = candidates.flatMap((b) => rewardsOf(b).filter((r) => r.item === it));
    if (!rules.length) { v.push(`«${manifest.items[it]?.name ?? it}» не можна отримати в цій сцені`); drop.items.add(it); continue; }
    const reasons = rules.map(okReward);
    if (reasons.every(Boolean)) { v.push(reasons[0]); drop.items.add(it); } else invAfter.push(it);
  }
  for (const p of ch.prepared_add ?? []) {
    const rules = candidates.flatMap((b) => rewardsOf(b).filter((r) => r.prepared === p));
    if (!rules.length || rules.map(okReward).every(Boolean)) { v.push(`заготовку «${manifest.bonuses.find((b) => b.id === p)?.name ?? p}» тут не заробити`); drop.prepared.add(p); }
  }

  // Закриття фази боса — лише за умовою з маніфесту, або за таймаутом (Z-16).
  const closing = (ch.shield_delta ?? 0) < 0 || (ch.boss_phase && ch.boss_phase !== state.boss_phase && blocks[before]?.boss);
  if (closing && blocks[before]?.boss) {
    const conds = blocks[before].close ?? [];
    const memories = memoryCount(manifest, invAfter);
    const ok = !conds.length || conds.some((c) => {
      if (c.super) return validSupers.includes(c.super);
      if (c.min_memories && memories < c.min_memories) return false;
      if (c.successes) return state.phase.successes + stageSuccesses(manifest, ctx, c) >= c.successes;
      return false;
    }) || state.phase.stages + 1 >= (manifest.rules.phase_timeout_stages ?? 5);
    if (!ok) { v.push(`фазу ще не закрито: потрібен шлях із таблиці «закриває фазу» (зараз успіхів ${state.phase.successes}); продовжуй бій — ворог діє`); drop.close = true; }
  } else if ((ch.shield_delta ?? 0) < 0) {
    v.push("щит знімається лише в бою з босом"); drop.close = true;
  }

  // Хаб: до сцени після хабу — лише коли зараховано потрібну кількість кімнат.
  const hub = manifest.hub;
  if (hub && resp.scene === hub.exit && before !== hub.exit) {
    const done = new Set(state.hub_done);
    if (hub.rooms.includes(before) && (rolledSuccess || validSupers.length || [...invAfter].length > state.inventory.length)) done.add(before);
    if (done.size < hub.required && ctx.turnsUsed < (hub.shortcut_after_turns ?? 99)) {
      v.push(`зараховано кімнат: ${done.size} з ${hub.required} — герої ще мають обрати кімнату`);
      drop.scene = true;
    }
  }

  // Жодних «телепортів»: герой приходить у сцену лише звідти, звідки до неї є вихід (Z-10).
  if (!drop.scene) {
    for (const h of resp.participants ?? []) {
      const pos = state.positions[h];
      if (pos && pos !== resp.scene && !reachableFrom(manifest, pos).includes(resp.scene)) {
        v.push(`${heroName(manifest, h)} зараз у сцені ${pos} і не може одразу опинитися в ${resp.scene}: спершу заверши його/її шлях або спитай, що він/вона робить`);
        drop.scene = true;
      }
    }
  }
  return { violations: v, drop };
}

// ---------- застосування ----------
// Застосовує відповідь з урахуванням drop. Повертає { issues, fx } — зауваження і ефекти, які показує застосунок.
export function applyResponse(manifest, state, resp, ctx, drop = null) {
  drop ??= checkResponse(manifest, state, resp, ctx).drop;
  const issues = [];
  const fx = [];
  const ch = drop.consult ? {} : resp.state_changes ?? {};
  const blocks = manifest.blocks;
  const before = ctx.blockBefore;
  const inBoss = blocks[before]?.boss || blocks[resp.scene]?.boss;
  const scene = drop.scene || !blocks[resp.scene] ? before : resp.scene;
  const event = (text) => state.events.push(`${before}: ${text}`);

  for (const r of ctx.rolls) event(`кидок ${r.hero === "both" ? "разом" : heroName(manifest, r.hero)} ${r.value} — ${r.success ? "успіх" : "провал"}`);

  for (const it of ch.items_remove ?? []) {
    if (drop.remove.has(it)) continue;
    state.inventory = state.inventory.filter((x) => x !== it);
    event(`використано «${manifest.items[it]?.name}»`);
  }
  for (const it of ch.items_add ?? []) {
    if (drop.items.has(it) || !manifest.items[it] || state.inventory.includes(it)) continue;
    state.inventory.push(it);
    state.item_sources[it] = before;
    event(`отримано «${manifest.items[it].name}»`);
    for (const b of manifest.bonuses) {
      if (b.requires_item === it && b.uses === 1 && !state.prepared.includes(b.id)) state.prepared.push(b.id);
    }
  }

  let stars = ch.stars_delta ?? 0;
  if (stars < 0 && !inBoss) { issues.push("⭐ поза боєм не знімаються (D-49)"); stars = 0; }
  if (stars < -1) { issues.push("не більше −1 ⭐ за етап"); stars = -1; }
  state.stars = Math.max(0, Math.min(manifest.rules.stars_max, state.stars + stars));

  // Фаза боса: лічильник успіхів і етапів, закриття.
  if (blocks[before]?.boss) {
    if (state.phase.id !== before) state.phase = { id: before, successes: 0, stages: 0 };
    state.phase.stages += 1;
    for (const c of blocks[before].close ?? []) if (c.successes) { state.phase.successes += stageSuccesses(manifest, ctx, c); break; }
  }
  if (!drop.close) {
    const shield = Math.min(0, ch.shield_delta ?? 0);
    if (shield < 0 && inBoss) { state.shield = Math.max(0, state.shield + shield); event("фазу закрито"); }
    if (ch.boss_phase && ch.boss_phase !== state.boss_phase) {
      state.boss_phase = ch.boss_phase;
      state.phase = { id: blocks[ch.boss_phase] ? ch.boss_phase : null, successes: 0, stages: 0 };
    }
  }

  for (const h of ch.super_used ?? []) {
    if (drop.supers.has(h)) continue;
    state.super_used.push(h);
    fx.push(manifest.heroes[h].super_fx);
    event(`${heroName(manifest, h)} застосував(-ла) «${manifest.heroes[h].super}»`);
  }

  for (const p of ch.prepared_add ?? []) {
    if (drop.prepared.has(p)) continue;
    if (manifest.bonuses.some((b) => b.id === p) && !state.prepared.includes(p)) state.prepared.push(p);
  }
  // Згорання заготовок: за виходом із блоку та за завершенням фази.
  for (const b of manifest.bonuses) {
    if (!state.prepared.includes(b.id)) continue;
    const leftBlock = b.expires_on_leave && before === b.expires_on_leave && scene !== b.expires_on_leave;
    const order = Object.keys(blocks);
    const phaseOver = b.expires_on_phase_end && state.boss_phase && (state.boss_phase === "done" || order.indexOf(state.boss_phase) > order.indexOf(b.expires_on_phase_end));
    if (leftBlock || phaseOver) state.prepared = state.prepared.filter((p) => p !== b.id);
  }

  // Хаб: кімната зараховується, коли в ній отримано нагороду або вирішено виклик.
  const hub = manifest.hub;
  if (hub?.rooms.includes(before) && !state.hub_done.includes(before)) {
    const rewarded = (ch.items_add ?? []).some((it) => !drop.items.has(it)) || ctx.rolls.some((r) => r.success) || (ch.super_used ?? []).some((h) => !drop.supers.has(h));
    if (rewarded) { state.hub_done.push(before); event("кімнату зараховано"); }
  }

  if (scene !== before) event(`перехід у ${scene}`);
  state.block = scene;
  if (!drop.scene && resp.participants?.length) {
    state.participants = resp.participants;
    for (const h of resp.participants) state.positions[h] = scene;
  }
  state.events = state.events.slice(-40);
  return { issues, fx };
}
