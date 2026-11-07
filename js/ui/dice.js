// Модалка кубика (D-05, D-20): одна кнопка для героя чи спільного кидка, анімація, звук.
// Число на кубику лишається у вікні сцени; критична картинка — поверх сцени (D-21).
import { openModal } from "./modals.js?v=20261107-2210";
import { sound } from "./sound.js?v=20261107-2210";

const IMG = (id) => `content/images/${id}.jpg`;
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

export function dieFace(value) {
  return `<div class="die" data-value="${value}" aria-label="На кубику ${value}">${
    Array.from({ length: 9 }, (_, i) => `<span class="${PIPS[value].includes(i + 1) ? "pip" : ""}"></span>`).join("")}</div>`;
}

// Відкриває модалку. Повертає Promise: число на кубику або null, якщо гравці закрили вікно, щоб написати.
export function askRoll({ who, roll }) {
  return new Promise((resolve) => {
    const { root, close } = openModal(`
      <div class="dice-modal">
        <button class="icon-btn dice-modal__close" data-act="cancel" aria-label="Закрити без кидка">✕</button>
        <h2>Кидок: ${who}</h2>
        <div class="dice-modal__stage">${dieFace(6)}</div>
        <div class="dice-modal__actions">
          <button class="btn btn--primary btn--big" data-act="roll">🎲 Кинути</button>
          <p class="dice-modal__hint">Результат кидка одразу побачить Ведучий. Хочете спершу щось уточнити чи передумали — закрийте вікно ✕ і напишіть репліку.</p>
        </div>
      </div>`, { className: "modal__card--dice" });
    let rolling = false;
    root.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act || rolling) return;
      if (act === "cancel") { close(); resolve(null); return; }
      rolling = true;
      root.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      const value = roll();
      await animate(root.querySelector(".dice-modal__stage"), value);
      close();
      resolve(value);
    });
  });
}

async function animate(stage, value) {
  sound.roll(1.1);
  const start = performance.now();
  let delay = 50;
  while (performance.now() - start < 1100) {
    const face = 1 + Math.floor(Math.random() * 6);
    stage.innerHTML = dieFace(face);
    stage.firstElementChild.style.transform = `rotate(${Math.random() * 60 - 30}deg) scale(${0.9 + Math.random() * 0.15})`;
    await wait(delay);
    delay *= 1.15;
  }
  stage.innerHTML = dieFace(value);
  stage.firstElementChild.classList.add("die--landed");
  sound.land();
  await wait(700);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Число на кубику у вікні сцени; підсвітка «вдалося / ні» — коли відповів Ведучий (D-19).
export function showRollInScene(value) {
  const el = document.getElementById("roll-result");
  el.innerHTML = dieFace(value);
  el.className = "scene__roll";
  el.hidden = false;
}

export function markRollResult(success) {
  const el = document.getElementById("roll-result");
  if (el.hidden) return;
  el.classList.add(success ? "is-success" : "is-fail");
  (success ? sound.success : sound.fail)();
}

export function hideRollInScene() {
  document.getElementById("roll-result").hidden = true;
}

// Критична картинка поверх сцени ~2,5 с, натискання — пропустити.
export function showCritical({ critical, image }) {
  return new Promise((resolve) => {
    if (critical !== "spark" && critical !== "funny_fail") { resolve(); return; }
    const scene = document.querySelector(".scene");
    const box = document.createElement("div");
    box.className = `crit crit--${critical}`;
    const label = critical === "spark" ? "Іскра!" : "Ой-ой!";
    const emoji = critical === "spark" ? "✨" : "🙈";
    box.innerHTML = `${image ? `<img src="${IMG(image)}" alt="">` : ""}<div class="crit__label">${label}</div>`;
    const img = box.querySelector("img");
    if (img) img.onerror = () => img.replaceWith(Object.assign(document.createElement("div"), { className: "crit__emoji", textContent: emoji }));
    else box.insertAdjacentHTML("afterbegin", `<div class="crit__emoji">${emoji}</div>`);
    scene.append(box);
    (critical === "spark" ? sound.spark : sound.funnyFail)();
    const done = () => { clearTimeout(t); box.remove(); resolve(); };
    const t = setTimeout(done, 2500);
    box.addEventListener("click", done);
  });
}
