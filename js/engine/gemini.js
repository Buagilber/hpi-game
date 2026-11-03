// Клієнт Gemini API: запити напряму з браузера з ключем користувача (D-38), повтори й класифікація помилок (D-33).

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const RETRY_DELAYS = [5, 15, 30]; // секунди між повторами

export class GeminiError extends Error {
  // kind: invalid_key | rate_limit | daily_limit | unavailable | network | bad_request
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function classify(status, text) {
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(text)) return "invalid_key";
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return /per ?day|PerDay|daily/i.test(text) ? "daily_limit" : "rate_limit";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

const sleep = (s, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, s * 1000);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
});

async function request(url, key, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { "x-goog-api-key": key, ...(init.headers ?? {}) } });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new GeminiError("network", e.message);
  }
  const text = await res.text();
  if (!res.ok) throw new GeminiError(classify(res.status, text), text.slice(0, 300), res.status);
  return JSON.parse(text);
}

// Перевірка ключа: читаємо опис моделі. Генерацію не запускає, денну квоту запитів не витрачає.
export async function checkKey(key, model = DEFAULT_MODEL) {
  await request(`${BASE}/${model}`, key);
  return true;
}

// Генерація з повторами: ліміт за хвилину, перевантаження й мережа — до 3 повторів з паузою.
// onRetry(attempt, waitSeconds, error) — щоб інтерфейс показав «Ведучий набирає повітря…».
export async function generate({ key, model = DEFAULT_MODEL, body, signal, onRetry }) {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    try {
      const data = await request(`${BASE}/${model}:generateContent`, key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      return { data, latency: (performance.now() - t0) / 1000 };
    } catch (e) {
      const retryable = e instanceof GeminiError && ["rate_limit", "unavailable", "network"].includes(e.kind);
      if (!retryable || attempt >= RETRY_DELAYS.length) throw e;
      onRetry?.(attempt + 1, RETRY_DELAYS[attempt], e);
      await sleep(RETRY_DELAYS[attempt], signal);
    }
  }
}

// Текст відповіді без «роздумів» моделі.
export function responseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
}

// Розпізнавання голосу помічника ведучого (D-32): аудіо → текст тією ж моделлю.
// hints — слова гри (імена героїв, предметів, NPC), щоб модель не плутала їх зі схожими словами.
export async function transcribe({ key, model = DEFAULT_MODEL, blob, hints = [] }) {
  const data = await blobToBase64(blob);
  const prompt = "Транскрибуй мовлення дослівно українською мовою. Поверни лише текст сказаного, без лапок і коментарів. "
    + "Якщо мовлення немає або його не чути, поверни порожній рядок."
    + (hints.length ? ` Це репліка в дитячій грі; можливі слова: ${hints.join(", ")}.` : "");
  const { data: res } = await generate({
    key,
    model,
    body: {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: blob.type.split(";")[0] || "audio/webm", data } }] }],
      generationConfig: { temperature: 0 },
    },
  });
  return responseText(res).trim().replace(/^["«]|["»]$/g, "");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
