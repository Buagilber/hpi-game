// Вікно інвентарю (D-13): картки предметів з літературними назвами, збільшення по натисканню,
// стан суперздібностей героїв. На гру не впливає — лише показує.
import { openModal } from "./modals.js?v=20261107-2223";
import { esc } from "./screen.js?v=20261107-2223";

const IMG = (id) => `content/images/${id}.jpg`;

export function openInventory(manifest, state) {
  const items = state.inventory.map((id) => ({ id, ...manifest.items[id] })).filter((i) => i.name);
  const cards = items.length
    ? items.map((i) => `
        <button class="inv-card" data-id="${i.id}">
          <img src="${IMG(i.id)}" alt="">
          <span>${esc(i.name)}</span>
          ${i.memory ? '<em class="inv-card__tag">Спогад</em>' : ""}
        </button>`).join("")
    : '<p class="inv-empty">Поки що порожньо. Предмети з\'являться, коли герої їх знайдуть.</p>';
  const supers = Object.entries(manifest.heroes).map(([id, h]) => {
    const used = state.super_used.includes(id);
    return `<li class="inv-super${used ? " is-used" : ""}">
      <img src="${IMG(h.cards?.[0])}" alt="">
      <span class="inv-super__hero">${esc(h.name)}</span>
      <span class="inv-super__power" aria-label="${esc(h.super)}: ${used ? "використано" : "доступна"}">${esc(h.super)}</span>
    </li>`;
  }).join("");

  const { root, close } = openModal(`
    <h2>🎒 Інвентар</h2>
    <div class="inv-grid">${cards}</div>
    <h3>Доступні суперздібності</h3>
    <ul class="inv-supers">${supers}</ul>
    <div class="inv-zoom" hidden><img alt=""><p></p></div>
    <button class="btn" data-act="close">Закрити</button>`, { className: "modal__card--wide", dismissible: true });

  const zoom = root.querySelector(".inv-zoom");
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-act=close]")) { close(); return; }
    if (e.target.closest(".inv-zoom")) { zoom.hidden = true; return; }
    const card = e.target.closest(".inv-card");
    if (!card) return;
    const item = items.find((i) => i.id === card.dataset.id);
    zoom.querySelector("img").src = IMG(item.id);
    zoom.querySelector("p").textContent = item.name;
    zoom.hidden = false;
  });
}
