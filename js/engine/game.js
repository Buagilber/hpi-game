// Ігрова сесія: цикл етапу «повідомлення або кидок → запит до Ведучого → відповідь → стан і журнал».
import { buildSystem, buildSchema } from "./context.js";
import { generate, responseText } from "./gemini.js";
import { newState, publicState, applyResponse, sanitizeNarration } from "./state.js";
import { resolveRoll, criticalImage } from "./dice.js";

const KEEP_EXCHANGES = 8; // скільки останніх обмінів тримати в історії запиту: стан у запиті — джерело правди
const JSON_REMINDER = "Попередня відповідь не була валідним JSON за схемою. Поверни лише JSON за схемою.";

export class Game {
  constructor({ content, skill, key, model, saved = null }) {
    this.content = content;           // { manifest, texts }
    this.skill = skill;
    this.key = key;
    this.model = model;
    this.state = saved?.state ?? newState(content.manifest);
    this.stages = saved?.stages ?? [];   // журнал етапів для екрана
    this.turns = saved?.turns ?? [];     // історія для моделі
    this.turnsUsed = saved?.turnsUsed ?? 0;
    this.awaiting = saved?.awaiting ?? null;
    this.lastCritImage = saved?.lastCritImage ?? null;
    this.archived = saved?.archived ?? false;
    this.drafts = saved?.drafts ?? [];   // репліки героїв, ще не передані Ведучому (Z-03)
    this.pending = null;                 // запит, що не отримав відповіді (для «Спробувати ще раз»)
    this.onStatus = () => {};
  }

  get manifest() { return this.content.manifest; }
  get finished() { return this.awaiting?.type === "end"; }

  toJSON() {
    const { state, stages, turns, turnsUsed, awaiting, lastCritImage, archived, drafts } = this;
    return { version: 1, adventure: this.manifest.adventure, state, stages, turns, turnsUsed, awaiting, lastCritImage, archived, drafts };
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

  async #exchange(input, extra = {}, isRetry = false) {
    const m = this.manifest;
    const blockBefore = this.state.block;
    const request = { stage: this.stages.length, turns_used: this.turnsUsed, block: blockBefore, ...input, state: publicState(this.state) };
    this.pending = { input, extra };
    const system = buildSystem({ skill: this.skill, ...this.content }, blockBefore, this.turnsUsed);
    const schema = buildSchema(m, blockBefore);
    const userTurn = { role: "user", parts: [{ text: JSON.stringify(request) }] };
    const history = this.turns.slice(-2 * KEEP_EXCHANGES);

    let resp, raw, latency, attempt = 0;
    for (;;) {
      const contents = attempt === 0 ? [...history, userTurn] : [...history, userTurn, { role: "user", parts: [{ text: JSON_REMINDER }] }];
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
      latency = out.latency;
      raw = responseText(out.data);
      try { resp = JSON.parse(raw); break; } catch {
        if (attempt++ >= 1) { const e = new Error("Ведучий відповів у неправильному форматі"); e.kind = "bad_format"; throw e; }
        this.onStatus({ kind: "format_retry" });
      }
    }

    const { narration, notes } = sanitizeNarration(resp.narration, m);
    const { issues, fx } = applyResponse(m, this.state, resp, { blockBefore, messages: input.messages });
    this.awaiting = resp.await ?? { type: "answer", hero: "any" };
    const stage = {
      messages: input.messages,
      rolls: input.rolls,
      critImage: extra.critImage ?? null,
      narration,
      show: resp.show ?? [],
      fx,
      scene: this.state.block,
      awaiting: this.awaiting,
      note: resp.gm_note ?? "",
      issues: [...notes, ...issues],
      latency: Math.round(latency * 10) / 10,
      at: new Date().toISOString(),
      retried: isRetry,
    };
    this.stages.push(stage);
    this.turns.push(userTurn, { role: "model", parts: [{ text: raw }] });
    this.pending = null;
    return stage;
  }
}
