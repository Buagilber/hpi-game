// Модальні вікна: вхід з ключем (чарівник, D-39), дисклеймер (D-25), меню.
import { checkKey } from "../engine/gemini.js?v=20261107-2223";

const IMG = (id) => `content/images/${id}.jpg`;
export const DISCLAIMER_VERSION = 1;

export function openModal(html, { className = "", dismissible = false } = {}) {
  const root = document.createElement("div");
  root.className = "modal";
  root.innerHTML = `<div class="modal__card ${className}" role="dialog" aria-modal="true">${html}</div>`;
  if (dismissible) root.addEventListener("click", (e) => { if (e.target === root) close(); });
  document.body.append(root);
  function close() { root.remove(); }
  return { root, close };
}

// Ігрове вікно підтвердження замість системного confirm(): у стилі гри, з картинкою за потреби.
export function askConfirm({ title, text, image = null, ok = "Так", cancel = "Скасувати", danger = false }) {
  return new Promise((resolve) => {
    const { root, close } = openModal(`
      <div class="confirm">
        ${image ? `<img class="confirm__img" src="${IMG(image)}" alt="">` : ""}
        <h2>${title}</h2>
        ${text ? `<p>${text}</p>` : ""}
        <div class="confirm__actions">
          <button class="btn" data-act="cancel">${cancel}</button>
          <button class="btn ${danger ? "btn--danger" : "btn--primary"}" data-act="ok">${ok}</button>
        </div>
      </div>`, { className: "modal__card--confirm" });
    root.querySelector("[data-act=ok]").focus();
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      close();
      resolve(act === "ok");
    });
  });
}

const KEY_ERRORS = {
  invalid_key: "Чарівник хитає головою: цей ключ не підходить. Перевірте, чи скопійовано його повністю.",
  network: "Не вдалося зв'язатися з Gemini. Перевірте інтернет і спробуйте ще раз.",
  rate_limit: "Ключ правильний, але зараз забагато запитів. Спробуйте за хвилину.",
  daily_limit: "Ключ правильний, але денний ліміт вичерпано. Спробуйте завтра.",
  unavailable: "Сервіс Gemini зараз перевантажений. Спробуйте трохи пізніше.",
  bad_request: "Щось пішло не так під час перевірки ключа.",
};

// Чарівник на вході: просить ключ Gemini, перевіряє його й повертає через resolve.
export function askForKey({ reason } = {}) {
  return new Promise((resolve) => {
    const { root, close } = openModal(`
      <div class="gate">
        <img class="gate__wizard" src="${IMG("LB-UI-01")}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'gate__wizard gate__wizard--emoji',textContent:'🧙'}))">
        <h1 class="gate__title">Покажи свій ключ, друже, і проходь</h1>
        ${reason ? `<p class="gate__note">${reason}</p>` : ""}
        <form class="gate__form">
          <input class="gate__input" type="password" autocomplete="off" spellcheck="false" placeholder="Ключ Gemini API" required>
          <button class="btn btn--primary" type="submit">Пройти</button>
        </form>
        <p class="gate__error" role="alert" hidden></p>
        <details class="gate__help">
          <summary>Як отримати ключ?</summary>
          <ol>
            <li>Відкрийте <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio → API keys</a> (потрібен Google-акаунт, вік 18+).</li>
            <li>Натисніть «Create API key» і скопіюйте ключ.</li>
            <li>Вставте його сюди. Ключ зберігається лише в цьому браузері.</li>
          </ol>
        </details>
      </div>`, { className: "modal__card--gate" });
    const form = root.querySelector("form");
    const input = root.querySelector("input");
    const err = root.querySelector(".gate__error");
    const btn = root.querySelector("button[type=submit]");
    input.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      btn.disabled = true; btn.textContent = "Перевіряю…"; err.hidden = true;
      try {
        await checkKey(key);
        close();
        resolve(key);
      } catch (ex) {
        err.textContent = KEY_ERRORS[ex.kind] ?? KEY_ERRORS.bad_request;
        err.hidden = false;
        root.querySelector(".modal__card").classList.remove("is-shaking");
        void root.offsetWidth;
        root.querySelector(".modal__card").classList.add("is-shaking");
      } finally {
        btn.disabled = false; btn.textContent = "Пройти";
      }
    });
  });
}

const DISCLAIMER_TEXT = `
  <h2>Перш ніж почати</h2>
  <ul class="disclaimer">
    <li>Цей застосунок — для <b>дорослих (18+)</b>: помічника ведучого, який проводить гру для дітей.</li>
    <li>Діти грають наживо поруч і з застосунком напряму не працюють. Помічник передає їхні відповіді від імені персонажів.</li>
    <li><b>Не вводьте імен, віку чи інших особистих даних дітей.</b> Пишіть лише від імені героїв.</li>
    <li>Відповіді Ведучого генерує штучний інтелект (Google Gemini) за вашим ключем. На безкоштовному тарифі Google може використовувати запити для покращення своїх сервісів.</li>
  </ul>`;

export function showDisclaimer({ requireAccept }) {
  return new Promise((resolve) => {
    const { root, close } = openModal(`${DISCLAIMER_TEXT}
      ${requireAccept
        ? `<label class="check"><input type="checkbox"> Погоджуюсь</label>
           <button class="btn btn--primary" disabled>Почати</button>`
        : `<button class="btn btn--primary">Зрозуміло</button>`}`, { dismissible: !requireAccept });
    const btn = root.querySelector("button");
    const box = root.querySelector("input[type=checkbox]");
    box?.addEventListener("change", () => { btn.disabled = !box.checked; });
    btn.addEventListener("click", () => { close(); resolve(true); });
  });
}

export function openMenu({ speechOn, onToggleSpeech, soundsOn, onToggleSounds, onNewGame, onArchive, onDisclaimer, onForgetKey }) {
  const { root, close } = openModal(`
    <h2>Меню</h2>
    <div class="menu">
      <button class="btn" data-act="new">Нова гра</button>
      <button class="btn" data-act="archive">Архів ігор</button>
      <button class="btn" data-act="speech">Озвучення: ${speechOn ? "увімкнено 🔊" : "вимкнено 🔇"}</button>
      <button class="btn" data-act="sounds">Звуки кубика: ${soundsOn ? "увімкнено 🎲" : "вимкнено 🔇"}</button>
      <button class="btn" data-act="disclaimer">Правила користування</button>
      <button class="btn btn--danger" data-act="forget">Забути ключ</button>
      <button class="btn" data-act="close">Закрити</button>
    </div>`, { dismissible: true });
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    close();
    if (act === "new") askConfirm({ title: "Почати нову гру?", text: "Поточна гра перейде в архів.", ok: "Нова гра", cancel: "Грати далі" }).then((yes) => yes && onNewGame());
    if (act === "speech") onToggleSpeech();
    if (act === "sounds") onToggleSounds();
    if (act === "archive") onArchive();
    if (act === "disclaimer") onDisclaimer();
    if (act === "forget") onForgetKey();
  });
}
