// Голосовий ввід (E6, D-08, D-32): 🎤 — почати запис, ще раз — зупинити; текст потрапляє в поле вводу,
// помічник ведучого перевіряє його і надсилає сам.

const MAX_SECONDS = 60;

export function createRecorder({ button, onAudio, onError }) {
  let recorder = null;
  let chunks = [];
  let timer = null;
  let started = 0;

  const supported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (!supported) {
    button.disabled = true;
    button.title = "Цей браузер не підтримує запис голосу";
  }

  function setRecording(on) {
    button.classList.toggle("is-recording", on);
    button.setAttribute("aria-label", on ? "Зупинити запис" : "Надиктувати");
    button.textContent = on ? "⏹" : "🎤";
  }

  async function start() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Немає доступу до мікрофона. Дозвольте його в налаштуваннях браузера.");
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer);
      setRecording(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      recorder = null;
      if (performance.now() - started < 600 || !blob.size) return; // випадковий короткий натиск
      onAudio(blob);
    };
    recorder.start();
    started = performance.now();
    setRecording(true);
    timer = setInterval(() => { if (performance.now() - started > MAX_SECONDS * 1000) stop(); }, 500);
  }

  function stop() { if (recorder?.state === "recording") recorder.stop(); }

  button.addEventListener("click", () => (recorder ? stop() : start()));
  return { get recording() { return !!recorder; }, stop };
}
