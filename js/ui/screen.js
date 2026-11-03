// Відмальовування основного екрана: сцена, ⭐ і щит, журнал етапів, перемикач героїв, віджет інвентарю.
// Елементи універсальні: імена, картки героїв і голоси приходять з маніфесту пригоди (cast), а не з коду.

const IMG = (id) => `content/images/${id}.jpg`;
const $ = (id) => document.getElementById(id);

// Склад сесії: герої в порядку слотів і голоси персонажів.
// heroes: [{ id, name, card }], voices: { voiceId: name }, jointCard: ID картки «Разом».
export function castFromManifest(manifest) {
  const heroes = Object.entries(manifest.heroes).map(([id, h]) => ({ id, name: h.name, card: h.cards?.[0] }));
  const jointCard = manifest.client_images?.joint_roll_fx?.[0];
  return { heroes, voices: manifest.voices ?? {}, jointCard };
}

const JOINT = "both";
const slotLabel = (i) => (i === null ? "Разом" : `Герой ${i + 1}`);
const nameOf = (cast, hero) => hero === JOINT ? "Разом" : cast.heroes.find((h) => h.id === hero)?.name ?? "Помічник ведучого";
const slotClass = (cast, hero) => hero === JOINT ? "both" : (i => i < 0 ? "any" : `h${i + 1}`)(cast.heroes.findIndex((h) => h.id === hero));

export function renderScene(imageId) {
  const img = $("scene-image");
  if (!imageId || img.dataset.id === imageId) return;
  img.dataset.id = imageId;
  img.onerror = () => { img.onerror = null; img.src = IMG("LB-PH-a"); };
  img.src = IMG(imageId);
}

export function renderHud({ stars, starsMax = 3, shield, shieldMax = 3 }) {
  $("stars").innerHTML = Array.from({ length: starsMax }, (_, i) => `<span class="${i < stars ? "" : "is-lost"}">⭐</span>`).join("");
  const sh = $("shield");
  sh.hidden = shield == null;
  if (shield != null) sh.innerHTML = Array.from({ length: shieldMax }, (_, i) => `<span class="${i < shield ? "" : "is-lost"}">🟡</span>`).join("");
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function renderLog(cast, stages, index) {
  $("log-counter").textContent = stages.length ? `Етап ${index + 1} з ${stages.length}` : "";
  $("log-prev").disabled = index <= 0;
  $("log-next").disabled = index >= stages.length - 1;
  const st = stages[index];
  if (!st) { $("log-body").innerHTML = ""; return; }
  const msgs = st.messages.map((m) =>
    `<p class="msg msg--${slotClass(cast, m.hero)}"><span class="msg__who">${esc(nameOf(cast, m.hero))}</span><br>${esc(m.text)}</p>`);
  const rolls = st.rolls.map((r) =>
    `<p class="msg msg--${slotClass(cast, r.hero)}"><span class="msg__who">${esc(nameOf(cast, r.hero))}</span> <span class="msg__roll">🎲 ${r.value}</span></p>`);
  const narration = st.narration.map((f) => f.voice === "narrator"
    ? `<p>${esc(f.text)}</p>`
    : `<p><span class="gm__speaker">${esc(cast.voices[f.voice] ?? "")}:</span> ${esc(f.text)}</p>`);
  const gm = st.narration.length
    ? `<div class="gm"><button class="icon-btn gm__replay" data-replay aria-label="Озвучити ще раз">🔊</button>${narration.join("")}</div>`
    : "";
  $("log-body").innerHTML = [...msgs, ...rolls, gm].join("");
}

// Перемикач: слоти «Герой 1», «Герой 2», «Разом»; підписи під іконками — імена героїв цієї сесії.
export function renderHeroes(cast, { active, awaited, participants }, onPick) {
  const box = $("heroes");
  box.innerHTML = "";
  const slots = [...cast.heroes.map((h, i) => ({ ...h, slot: i })), { id: JOINT, name: "Разом", card: cast.jointCard, slot: null }];
  for (const h of slots) {
    const allowed = h.id === JOINT ? participants.length >= 2 : participants.includes(h.id);
    const b = document.createElement("button");
    b.className = `hero hero--${h.slot === null ? "both" : `h${h.slot + 1}`}${h.id === active ? " is-active" : ""}${h.id === awaited ? " is-awaited" : ""}`;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(h.id === active));
    b.setAttribute("aria-label", `${slotLabel(h.slot)}: ${h.name}`);
    b.disabled = !allowed;
    b.innerHTML = `<img src="${IMG(h.card)}" alt=""><span>${esc(h.name)}</span>`;
    b.addEventListener("click", () => onPick(h.id));
    box.append(b);
  }
}

export function renderInventory(items) {
  const icons = items.map((id) => `<img class="inventory__item" src="${IMG(id)}" alt="">`).join("");
  $("inventory").innerHTML = `<span class="inventory__label">🎒</span>${icons || '<span class="inventory__empty">порожньо</span>'}`;
}

// Картка персонажа чи предмета поверх сцени на кілька секунд.
let cardTimer;
export function renderCard(imageId) {
  const el = $("scene-card");
  el.src = IMG(imageId);
  el.hidden = false;
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

// Очікування Ведучого: сцена тьмяніє, по ній пливуть іскри (D-26).
export function setBusy(on) {
  $("scene-image").classList.toggle("is-dim", on);
  $("sparkles").hidden = !on;
}

// Рядок стану під журналом: «Ведучий думає…», повтори, помилки з кнопкою «Спробувати ще раз».
export function setStatus(text, { retry } = {}) {
  const el = $("status");
  el.hidden = !text;
  el.innerHTML = text ? `<span>${esc(text)}</span>` : "";
  if (retry) {
    const b = document.createElement("button");
    b.className = "btn btn--primary";
    b.textContent = "Спробувати ще раз";
    b.addEventListener("click", retry);
    el.append(b);
  }
}
