// Збереження (D-27): поточна сесія, архів завершених і перерваних ігор, експорт/імпорт у JSON.
// Архів зберігає журнал етапів і стан (без сирої історії моделі), щоб уміщатися в localStorage.
import * as store from "./storage.js?v=20261109-1826";

const LIMIT = 30; // найстаріші записи витісняються, щоб не переповнити сховище браузера

export function list() {
  return store.load("archive", []);
}

export function add(session, { title, finished }) {
  const entry = {
    id: `${Date.now()}`,
    adventure: session.adventure,
    title,
    finished,
    startedAt: session.stages[0]?.at ?? new Date().toISOString(),
    endedAt: session.stages.at(-1)?.at ?? new Date().toISOString(),
    stages: session.stages,
    state: session.state,
  };
  const all = [entry, ...list()].slice(0, LIMIT);
  if (!store.save("archive", all)) store.save("archive", all.slice(0, Math.ceil(LIMIT / 3)));
  return entry;
}

export function remove(id) {
  store.save("archive", list().filter((e) => e.id !== id));
}

export function get(id) {
  return list().find((e) => e.id === id) ?? null;
}

// Файл для резервної копії чи звіту сценаристу.
export function download(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Імпорт: приймає файл поточної сесії (Game.toJSON) або запис архіву.
export async function importFile(file, title) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.stages) || !data.state) throw new Error("Це не файл гри");
  return add(data, { title, finished: data.awaiting?.type === "end" || data.finished === true });
}

export const fileName = (entry) => `hpi-${entry.adventure}-${(entry.endedAt ?? new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-")}.json`;
