// Фінальний екран (Z-20): як остання сторінка книги — назва історії, фінальна промова Ведучого,
// яскраві моменти, знахідки героїв і кнопки «Нова гра» / «Архів».
import { esc } from "./screen.js";
import { speech } from "./speech.js";

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
      <div class="finale__kicker">${esc(manifest.title)}</div>
      <h1 class="finale__title">${esc(ep.title)}</h1>
      <div class="finale__text">${ep.epilogue.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      <div class="finale__end">Кінець</div>
      ${ep.highlights.length ? `<div class="finale__highlights"><h3>Найяскравіше в пригоді</h3><ul>${ep.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
      <div class="finale__stats" aria-label="Знахідки героїв">
        <span>${"⭐".repeat(game.state.stars)}</span>
        ${items.map((id) => `<img src="${IMG(id)}" alt="${esc(manifest.items[id].name)}" title="${esc(manifest.items[id].name)}">`).join("")}
      </div>
      <div class="finale__actions">
        <button class="btn" data-act="read">🔊 Прочитати ще раз</button>
        <button class="btn" data-act="archive">Архів ігор</button>
        <button class="btn btn--primary" data-act="new">Нова гра</button>
        <button class="btn" data-act="close">Закрити</button>
      </div>
    </div>`;
  // Фон: універсальне фінальне зображення Бібліотеки, а поки його немає — запасні з маніфесту.
  const tryBg = (i) => {
    if (i >= bg.length) return;
    const probe = new Image();
    probe.onload = () => { root.style.backgroundImage = `url(${IMG(bg[i])})`; };
    probe.onerror = () => tryBg(i + 1);
    probe.src = IMG(bg[i]);
  };
  tryBg(0);
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "read") speech.speak([{ voice: "narrator", text: ep.title }, ...ep.epilogue.map((t) => ({ voice: "narrator", text: t }))], { force: true, key: "finale" });
    if (act === "archive") onArchive();
    if (act === "new") { speech.stop(); root.remove(); onNewGame(); }
    if (act === "close") { speech.stop(); root.remove(); }
  });
  document.body.append(root);
}
