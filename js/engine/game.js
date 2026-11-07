// Ігрова сесія: цикл етапу «повідомлення або кидок → запит до Ведучого → відповідь → стан і журнал».
import { buildSystem, buildSchema } from "./context.js?v=20261107-2223";
import { generate, responseText } from "./gemini.js?v=20261107-2223";
import { newState, upgradeState, publicState, checkResponse, applyResponse, sanitizeNarration, cleanText } from "./state.js?v=20261107-2223";
import { resolveRoll, criticalImage } from "./dice.js?v=20261107-2223";

const KEEP_EXCHANGES = 8; // скільки останніх обмінів тримати в історії запиту: стан у запиті — джерело правди
const JSON_REMINDER = "Попередня відповідь не була валідним JSON за схемою. Поверни лише JSON за схемою.";

export class Game {
  constructor({ content, skill, key, model, saved = null }) {
    this.content = content;           // { manifest, texts }
    this.skill = skill;
    this.key = key;
    this.model = model;
    this.state = saved?.state ? upgradeState(content.manifest, saved.state) : newState(content.manifest);
    this.stages = saved?.stages ?? [];   // журнал етапів для екрана
    this.turns = saved?.turns ?? [];     // історія для моделі
    this.turnsUsed = saved?.turnsUsed ?? 0;
    this.awaiting = saved?.awaiting ?? null;
    this.lastCritImage = saved?.lastCritImage ?? null;
    this.archived = saved?.archived ?? false;
    this.drafts = saved?.drafts ?? [];
    this.epilogue = saved?.epilogue ?? null;   // фінальна промова Ведучого (Z-20)   // репліки героїв, ще не передані Ведучому (Z-03)
    this.pending = null;                 // запит, що не отримав відповіді (для «Спробувати ще раз»)
    this.onStatus = () => {};
  }

  get manifest() { return this.content.manifest; }
  get finished() { return this.awaiting?.type === "end"; }

  toJSON() {
    const { state, stages, turns, turnsUsed, awaiting, lastCritImage, archived, drafts, epilogue } = this;
    return { version: 1, adventure: this.manifest.adventure, state, stages, turns, turnsUsed, awaiting, lastCritImage, archived, drafts, epilogue };
  }

  start() {
    const names = Object.values(this.manifest.heroes).map((h) => h.name).join(" і ");
    return this.#exchange({ messages: [{ hero: "any", text: `Починаємо гру! Герої: ${names}.` }], rolls: [] });
  }

  sendMessages(messages) {
    this.turnsUsed += 1;
    return this.#exchange({ messages, rolls: [] });
  }

  get rollHero() {
    const h = this.awaiting?.hero;
    return ["both", ...Object.keys(this.manifest.heroes)].includes(h) ? h : "both";
  }

  // Кидок: число на кубику → розрахунок бонусів і успіху на клієнті (D-46) → результат Ведучому.
  // onResolved({ result, critImage }) викликається до запиту: застосунок показує критичну картинку, поки Ведучий думає.
  async sendRoll(value, onResolved, messages = []) {
    const result = resolveRoll(this.manifest, this.state, this.rollHero, this.awaiting?.roll, value);
    const critImage = criticalImage(this.manifest, result, this.lastCritImage);
    if (critImage) this.lastCritImage = critImage;
    await onResolved?.({ result, critImage });
    return this.#exchange({ messages, rolls: [result] }, { critImage });
  }

  retry() {
    if (!this.pending) throw new Error("Немає запиту для повтору");
    const { input, extra } = this.pending;
    return this.#exchange(input, extra, true);
  }

  // Один запит до Ведучого з повторами: невалідний JSON — нагадування про формат; порушення правил — відмова з поясненням (до 2 разів).
  async #ask({ system, schema, history, userTurn, extraTurns = [] }) {
    let attempt = 0;
    for (;;) {
      const contents = [...history, userTurn, ...extraTurns, ...(attempt ? [{ role: "user", parts: [{ text: JSON_REMINDER }] }] : [])];
      const out = await generate({
        key: this.key,
        model: this.model,
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.9 },
        },
        onRetry: (n, wait) => this.onStatus({ kind: "retry", attempt: n, wait }),
      });
      const raw = responseText(out.data);
      try { return { resp: JSON.parse(raw), raw, latency: out.latency }; } catch {
        if (attempt++ >= 1) { const e = new Error("Ведучий відповів у неправильному форматі"); e.kind = "bad_format"; throw e; }
        this.onStatus({ kind: "format_retry" });
      }
    }
  }

  async #exchange(input, extra = {}, isRetry = false) {
    const m = this.manifest;
    const blockBefore = this.state.block;
    const awaitingBefore = this.awaiting;
    const request = { stage: this.stages.length, turns_used: this.turnsUsed, block: blockBefore, ...input, state: publicState(m, this.state) };
    this.pending = { input, extra };
    const system = buildSystem({ skill: this.skill, ...this.content }, blockBefore, this.turnsUsed);
    const schema = buildSchema(m, blockBefore);
    const userTurn = { role: "user", parts: [{ text: JSON.stringify(request) }] };
    const history = this.turns.slice(-2 * KEEP_EXCHANGES);
    const ctx = { blockBefore, messages: input.messages, rolls: input.rolls, rollTags: input.rolls.length ? awaitingBefore?.roll?.tags ?? [] : [], turnsUsed: this.turnsUsed };

    // Відповідь, що порушує правила (нагорода без умови, фаза без умови, хаб, «телепорт»), повертаємо Ведучому з поясненням.
    let { resp, raw, latency } = await this.#ask({ system, schema, history, userTurn });
    let check = checkResponse(m, this.state, resp, ctx);
    const rejected = [];
    for (let round = 0; check.violations.length && round < 2; round++) {
      rejected.push(...check.violations);
      this.onStatus({ kind: "rule_retry" });
      const note = `Застосунок відхилив твою відповідь: ${check.violations.join("; ")}. Перепиши відповідь з тим самим змістом подій, але без цих порушень.`;
      ({ resp, raw, latency } = await this.#ask({ system, schema, history, userTurn, extraTurns: [{ role: "model", parts: [{ text: raw }] }, { role: "user", parts: [{ text: note }] }] }));
      check = checkResponse(m, this.state, resp, ctx);
    }

    const { narration, notes } = sanitizeNarration(resp.narration, m);
    const { issues, fx } = applyResponse(m, this.state, resp, ctx, check.drop);
    const cta = resp.call_to_action?.text ? { hero: resp.call_to_action.hero, text: cleanText(resp.call_to_action.text, m, notes) } : null;
    this.awaiting = resp.await ?? { type: "answer", hero: "any" };
    if (this.awaiting.type === "roll" && (check.drop.roll || check.drop.consult)) this.awaiting = { type: "answer", hero: this.awaiting.hero };
    const stage = {
      messages: input.messages,
      rolls: input.rolls,
      critImage: extra.critImage ?? null,
      narration,
      callToAction: cta,
      show: resp.show ?? [],
      fx,
      scene: this.state.block,
      awaiting: this.awaiting,
      note: resp.gm_note ?? "",
      issues: [...notes, ...issues, ...rejected.map((r) => `відхилено: ${r}`), ...check.violations.map((r) => `не прийнято: ${r}`)],
      latency: Math.round(latency * 10) / 10,
      at: new Date().toISOString(),
      retried: isRetry,
    };
    this.stages.push(stage);
    this.turns.push(userTurn, { role: "model", parts: [{ text: raw }] });
    this.pending = null;
    return stage;
  }

  // Фінальна промова (Z-20): окремий запит після завершення гри — підсумок шляху героїв за журналом подій, як кінець книги.
  async finale() {
    const m = this.manifest;
    const lastWords = this.stages.at(-1)?.messages.map((x) => x.text).join(" ") ?? "";
    const prompt = [
      this.content.texts[m.blocks[m.finale?.block ?? "S7"]?.file] ?? "",
      "Гру завершено. Напиши фінальну промову Ведучого за розділом «Фінальна промова» блоку фіналу.",
      `Події гри (лише з них бери факти): ${JSON.stringify(this.state.events)}`,
      `Отримані предмети: ${this.state.inventory.map((id) => m.items[id]?.name).join(", ") || "жодних"}. Використані суперздібності: ${this.state.super_used.map((h) => m.heroes[h].super).join(", ") || "жодних"}.`,
      `Що гравцям найбільше запам'яталося: «${lastWords}».`,
      "Поверни JSON: title — коротка назва історії; epilogue — 3–5 абзаців казкової кінцівки українською, без кодів сцен і чисел правил; highlights — 3–5 коротких яскравих моментів пригоди.",
    ].join("\n\n");
    const schema = { type: "OBJECT", properties: { title: { type: "STRING" }, epilogue: { type: "ARRAY", items: { type: "STRING" } }, highlights: { type: "ARRAY", items: { type: "STRING" } } }, required: ["title", "epilogue", "highlights"] };
    const { resp } = await this.#ask({ system: this.skill, schema, history: [], userTurn: { role: "user", parts: [{ text: prompt }] } });
    const notes = [];
    this.epilogue = {
      title: cleanText(resp.title, m, notes),
      epilogue: (resp.epilogue ?? []).map((p) => cleanText(p, m, notes)).filter(Boolean),
      highlights: (resp.highlights ?? []).map((p) => cleanText(p, m, notes)).filter(Boolean),
    };
    return this.epilogue;
  }
}
