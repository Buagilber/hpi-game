// Фінальний екран (Z-20, Z-34): один екран поверх гри, як остання сторінка книги.
// Текст фінальної промови прокручується всередині картки синхронно з диктором; коли диктор закінчив —
// з'являються яскраві моменти й знахідки героїв (горизонтальна стрічка). Кнопки завжди внизу картки.
import { esc } from "./screen.js?v=20261107-2210";
import { speech } from "./speech.js?v=20261107-2210";

const IMG = (id) => `content/images/${id}.jpg`;

export function showFinale({ manifest, game, onNewGame, onArchive }) {
  document.querySelector(".finale")?.remove();
  const ep = game.epilogue;
  const bg = manifest.client_images?.finale_bg ?? [];
  const items = game.state.inventory.filter((id) => manifest.items[id]);
  const root = document.createElement("div");
  root.className = "finale";
  root.innerHTML = `
    <div class="finale__card" role="dialog" aria-modal="true" aria-label="Кінець історії">
      <header class="finale__head">
        <div class="finale__kicker">${esc(manifest.title)}</div>
        <h1 class="finale__title">${esc(ep.title)}</h1>
      </header>
      <div class="finale__scroll">
        <div class="finale__text">${ep.epilogue.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
        <div class="finale__end">Кінець</div>
        <div class="finale__after" hidden>
          ${ep.highlights.length ? `<div class="finale__highlights"><h3>Найяскравіше в пригоді</h3><ul>${ep.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
          <div class="finale__found">
            <h3>Знахідки героїв <span>${"⭐".repeat(game.state.stars)}</span></h3>
            <div class="finale__strip">${items.map((id) => `<figure><img src="${IMG(id)}" alt=""><figcaption>${esc(manifest.items[id].name)}</figcaption></figure>`).join("") || "<p>Цього разу без знахідок</p>"}</div>
          </div>
        </div>
      </div>
      <footer class="finale__actions">
        <button class="btn" data-act="read">🔊 Прочитати ще раз</button>
        <button class="btn" data-act="archive">Архів ігор</button>
        <button class="btn btn--primary" data-act="new">Нова гра</button>
        <button class="btn" data-act="close">Закрити</button>
      </footer>
    </div>`;
  document.body.append(root);
  document.body.classList.add("has-finale");

  // Фон: універсальне фінальне зображення Бібліотеки, а поки його немає — запасні з маніфесту.
  const tryBg = (i) => {
    if (i >= bg.length) return;
    const probe = new Image();
    probe.onload = () => { root.style.backgroundImage = `url(${IMG(bg[i])})`; };
    probe.onerror = () => tryBg(i + 1);
    probe.src = IMG(bg[i]);
  };
  tryBg(0);

  const scroller = root.querySelector(".finale__scroll");
  const after = root.querySelector(".finale__after");
  const paragraphs = [...root.querySelectorAll(".finale__text p")];
  const reveal = () => {
    if (!after.hidden) return;
    after.hidden = false;
    requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }));
  };
  const read = (force) => {
    const fragments = [{ voice: "narrator", text: ep.title }, ...ep.epilogue.map((t) => ({ voice: "narrator", text: t }))];
    // Прокрутка за диктором: пропорційно до номера речення.
    speech.speak(fragments, {
      force,
      key: "finale",
      onProgress: (i, n) => {
        const p = paragraphs[Math.min(paragraphs.length - 1, Math.floor((i / n) * paragraphs.length))];
        p?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
    if (speech.speakingKey !== "finale") reveal(); // озвучення вимкнене чи недоступне — показати все одразу
  };
  speech.onChange((key) => { if (key === null && document.body.contains(root)) reveal(); });
  read(false);

  const close = () => { speech.stop(); root.remove(); document.body.classList.remove("has-finale"); };
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "read") read(true);
    if (act === "archive") onArchive();
    if (act === "new") { close(); onNewGame(); }
    if (act === "close") close();
  });
}
