const modeButton = document.getElementById("mode-button");
const modePopover = document.getElementById("mode-popover");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("prompt");
const responseEl = document.getElementById("response");

const MODE_ICONS = {
  minimal: "⚡",
  teach_me: "🧠",
  game: "🎮",
  breadcrumbs: "🕵️",
  sonification: "🔊",
};

let currentMode = localStorage.getItem("inbetween-mode") || "minimal";
modeButton.textContent = MODE_ICONS[currentMode];

modeButton.addEventListener("click", () => {
  const open = !modePopover.hidden;
  modePopover.hidden = open;
  modeButton.setAttribute("aria-expanded", String(!open));
});

modePopover.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  currentMode = btn.dataset.mode;
  localStorage.setItem("inbetween-mode", currentMode);
  modeButton.textContent = MODE_ICONS[currentMode];
  modePopover.hidden = true;
});

document.addEventListener("click", (e) => {
  if (!composer.contains(e.target)) modePopover.hidden = true;
});

// ---- Sonification: lightweight generative layer, no external libs ----
let audioCtx = null;
const activeOscillators = [];

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = "sine") {
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

const EVENT_TONES = {
  search: [440, 0.6, "sine"],
  reasoning: [330, 0.8, "triangle"],
  done: [660, 1.0, "sine"],
};

function sonify(eventType) {
  const tone = EVENT_TONES[eventType];
  if (tone) playTone(...tone);
}

function renderSonificationBars(active) {
  responseEl.innerHTML = `<div class="sonification-viz">${Array.from(
    { length: 12 },
    () => `<div class="sonification-bar" style="height:${active ? 8 + Math.random() * 44 : 6}px"></div>`
  ).join("")}</div><p class="placeholder">Listening to the agent's real work...</p>`;
}

// ---- Rendering per mode ----
function renderPlaceholder() {
  responseEl.innerHTML = `<p class="placeholder">Thinking...</p>`;
}

function appendBreadcrumb(note) {
  const line = document.createElement("div");
  line.className = "breadcrumb-line";
  line.textContent = note;
  responseEl.appendChild(line);
}

function renderSideCard(kind, data) {
  const card = document.createElement("div");
  card.className = "side-card";
  if (kind === "teach_me") {
    card.innerHTML = `<h3>Before your answer...</h3><p><strong>${data.concept}</strong> — ${data.explanation}</p>`;
  } else if (kind === "game") {
    card.innerHTML = `<h3>Quick one while you wait</h3>`;
    data.quiz.forEach((q) => {
      const block = document.createElement("div");
      block.innerHTML = `<p>${q.question}</p>`;
      q.options.forEach((opt, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "quiz-option";
        btn.textContent = opt;
        btn.addEventListener("click", () => {
          btn.classList.add(i === q.correctIndex ? "correct" : "incorrect");
        });
        block.appendChild(btn);
      });
      card.appendChild(block);
    });
  }
  responseEl.prepend(card);
}

function renderAnswer(answer) {
  const div = document.createElement("div");
  div.className = "answer";
  div.textContent = answer;
  responseEl.appendChild(div);
}

// ---- SSE parsing over fetch (POST bodies can't use EventSource) ----
async function streamRespond(prompt, mode) {
  const res = await fetch("/api/respond", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, mode }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handleSseChunk(chunk, mode);
    }
  }
}

function handleSseChunk(chunk, mode) {
  const lines = chunk.split("\n");
  const eventLine = lines.find((l) => l.startsWith("event:"));
  const dataLine = lines.find((l) => l.startsWith("data:"));
  if (!eventLine || !dataLine) return;

  const eventName = eventLine.replace("event:", "").trim();
  const data = JSON.parse(dataLine.replace("data:", "").trim());

  if (eventName === "side_content") {
    renderSideCard(data.kind, data);
  } else if (eventName === "step_start" && mode === "sonification") {
    sonify(data.type);
    renderSonificationBars(true);
  } else if (eventName === "step_result" && mode === "breadcrumbs") {
    appendBreadcrumb(data.note);
  } else if (eventName === "done") {
    if (mode === "sonification") sonify("done");
    if (mode !== "breadcrumbs") responseEl.innerHTML = "";
    renderAnswer(data.answer);
  } else if (eventName === "fatal_error" || eventName === "step_error") {
    appendBreadcrumb(`⚠️ ${data.message}`);
  }
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  promptInput.value = "";
  renderPlaceholder();
  try {
    await streamRespond(prompt, currentMode);
  } catch (err) {
    responseEl.innerHTML = `<p class="placeholder">Something went wrong: ${err}</p>`;
  }
});
