// Екрани збереження (D-27): «Продовжити гру?», архів ігор з переглядом журналу, експорт і імпорт.
import { openModal, askConfirm } from "./modals.js?v=20261107-2223";
import { esc } from "./screen.js?v=20261107-2223";
import * as archive from "../engine/archive.js?v=20261107-2223";

const fmt = (iso) => new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function askResume({ title, stages, savedAt }) {
  return new Promise((resolve) => {
    const { root, close } = openModal(`
      <h2>Продовжити гру?</h2>
      <p>«${esc(title)}» — збережено ${fmt(savedAt)}, етапів: ${stages}.</p>
      <div class="menu">
        <button class="btn btn--primary" data-act="continue">Продовжити</button>
        <button class="btn" data-act="new">Нова гра</button>
      </div>`);
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      close();
      resolve(act);
    });
  });
}

export function openArchive({ cast, title, onExportCurrent }) {
  const render = () => {
    const entries = archive.list();
    const rows = entries.length
      ? entries.map((e) => `
          <li class="arch-row">
            <div><b>${esc(e.title)}</b><br><span class="arch-meta">${fmt(e.endedAt)} · етапів: ${e.stages.length} · ${e.finished ? "завершено" : "перервано"}</span></div>
            <div class="arch-actions">
              <button class="btn" data-act="view" data-id="${e.id}">Переглянути</button>
              <button class="btn" data-act="export" data-id="${e.id}">Файл</button>
              <button class="btn btn--danger" data-act="delete" data-id="${e.id}" aria-label="Видалити">✕</button>
            </div>
          </li>`).join("")
      : "<p>Архів порожній. Сюди потрапляють завершені й перервані ігри.</p>";
    return `
      <h2>Архів ігор</h2>
      <div class="arch-top">
        <button class="btn" data-act="export-current">Зберегти поточну гру у файл</button>
        <label class="btn">Відкрити файл гри<input type="file" accept="application/json,.json" hidden></label>
      </div>
      <p class="arch-error" role="alert" hidden></p>
      <ul class="arch-list">${rows}</ul>
      <button class="btn" data-act="close">Закрити</button>`;
  };
  const { root, close } = openModal(render(), { className: "modal__card--wide", dismissible: true });
  const card = root.querySelector(".modal__card");
  const refresh = () => { card.innerHTML = render(); bindFile(); };
  const showError = (t) => { const el = card.querySelector(".arch-error"); el.textContent = t; el.hidden = false; };

  function bindFile() {
    card.querySelector("input[type=file]").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { await archive.importFile(file, title); refresh(); }
      catch { showError("Не вдалося відкрити файл: це не файл гри."); }
    });
  }
  bindFile();

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === "close") close();
    if (act === "export-current") onExportCurrent();
    if (act === "export") { const entry = archive.get(id); archive.download(entry, archive.fileName(entry)); }
    if (act === "delete") askConfirm({ title: "Видалити гру з архіву?", text: "Її журнал зникне назавжди.", ok: "Видалити", cancel: "Залишити", danger: true }).then((yes) => { if (yes) { archive.remove(id); refresh(); } });
    if (act === "view") viewSession(cast, archive.get(id));
  });
}

// Перегляд журналу архівної гри: усі етапи підряд, лише для читання.
function viewSession(cast, entry) {
  const name = (hero) => hero === "both" ? "Разом" : cast.heroes.find((h) => h.id === hero)?.name ?? "Помічник ведучого";
  const body = entry.stages.map((st, i) => {
    const msgs = st.messages.map((m) => `<p><b>${esc(name(m.hero))}:</b> ${esc(m.text)}</p>`).join("");
    const rolls = st.rolls.map((r) => `<p><b>${esc(name(r.hero))}:</b> 🎲 ${r.value} — ${r.success ? "вдалося" : "не вдалося"}</p>`).join("");
    const gm = st.narration.map((f) => `<p>${f.voice === "narrator" ? "" : `<b>${esc(cast.voices[f.voice] ?? "")}:</b> `}${esc(f.text)}</p>`).join("");
    return `<section class="arch-stage"><h4>Етап ${i + 1}</h4>${msgs}${rolls}<div class="gm">${gm}</div></section>`;
  }).join("");
  const { root, close } = openModal(`<h2>${esc(entry.title)}</h2><p class="arch-meta">${fmt(entry.startedAt)}</p>${body}<button class="btn" data-act="close">Закрити</button>`,
    { className: "modal__card--wide", dismissible: true });
  root.querySelector("[data-act=close]").addEventListener("click", close);
}
