const $ = (id) => document.getElementById(id);
const promptEl = $('prompt');
const startBtn = $('start');
const modesEl = $('modes');
const waitEl = $('wait');
const outcomeEl = $('outcome');
const answerEl = $('answer');
const statusEl = $('wait-status');
const againBtn = $('again');
const teachPanel = $('teachPanel');
const teachBody = $('teachBody');
const gamePanel = $('gamePanel');
const gameBody = $('gameBody');
const sonicPanel = $('sonicPanel');
const sonicBody = $('sonicBody');
const breadcrumbs = $('breadcrumbs');
const toastEl = $('toast');

const API = (path) => new URL(path, document.baseURI).pathname;
const signinLink = $('signin');
if (signinLink) {
  const next = encodeURIComponent(location.pathname.replace(/^\/space\/[^/]+\/preview\/[^/]+\/?/, '') || '/');
  signinLink.href = './auth/login?next=' + next;
  signinLink.textContent = 'Sign in with Commons';
  fetch('./api/me')
    .then((r) => r.json())
    .then((me) => {
      if (me && me.sub) {
        signinLink.textContent = me.name ? 'Signed in · ' + me.name : 'Signed in';
        signinLink.href = './auth/logout';
      }
    })
    .catch(() => { /* anonymous ok */ });
}

let active = new Set(['minimal']);
let running = false;

function setStartDisabled() {
  startBtn.disabled = !promptEl.value.trim() || running;
}

promptEl.addEventListener('input', setStartDisabled);
startBtn.addEventListener('click', startRun);
againBtn.addEventListener('click', () => {
  outcomeEl.hidden = true;
  waitEl.hidden = true;
  answerEl.textContent = '';
  running = false;
  promptEl.value = '';
  setStartDisabled();
  promptEl.focus();
});

modesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode');
  if (!btn || running) return;
  const mode = btn.dataset.mode;
  if (mode === 'minimal') {
    active = new Set(['minimal']);
  } else {
    active.delete('minimal');
    if (active.has(mode)) {
      active.delete(mode);
    } else {
      active.add(mode);
    }
  }
  document.querySelectorAll('.mode').forEach((m) => {
    const on = m.dataset.mode === 'minimal' ? active.has('minimal') : active.has(m.dataset.mode);
    m.classList.toggle('active', on);
  });
  notify('Waiter mode: ' + (active.has('minimal') ? 'Minimal' : [...active].join(', ')));
});

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
}

function playNote(note) {
  ensureAudio();
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 260 + note * 45;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  } catch (e) { /* audio unavailable */ }
}

function pitchChime() {
  ensureAudio();
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 523.25;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.9);
  } catch (e) { /* ignore */ }
}

function notify(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(notify._t);
  notify._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function showWait(teach, game, bread, sonic) {
  teachPanel.hidden = !teach;
  gamePanel.hidden = !game;
  sonicPanel.hidden = !sonic;
  breadcrumbs.hidden = !bread;
  teachBody.textContent = '';
  gameBody.innerHTML = '';
  sonicBody.textContent = '';
  breadcrumbs.innerHTML = '';
  statusEl.textContent = 'Preparing…';
}

async function startRun() {
  const q = promptEl.value.trim();
  if (!q || running) return;
  running = true;
  setStartDisabled();

  const useTeach = active.has('teach');
  const useGame = active.has('game');
  const useBread = active.has('breadcrumbs');
  const useSonic = active.has('sonification');

  outcomeEl.hidden = true;
  answerEl.textContent = '';
  waitEl.hidden = false;
  showWait(useTeach, useGame, useBread, useSonic);

  let res;
  try {
    res = await fetch(API('./api/respond'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q, modes: [...active] }),
    });
  } catch (err) {
    finishError('Network error: ' + err.message);
    return;
  }

  if (!res.ok || !res.body) {
    let msg = 'Request failed (' + res.status + ')';
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch (e) { /* ignore */ }
    finishError(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streaming = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith('data:')) {
        let evt;
        try { evt = JSON.parse(chunk.slice(5)); } catch (e) { continue; }
        handleEvent(evt, () => { streaming = false; });
      }
    }
  }

  running = false;
  setStartDisabled();
}

function finishError(msg) {
  running = false;
  waitEl.hidden = true;
  setStartDisabled();
  notify('Error: ' + msg);
}

function handleEvent(evt) {
  switch (evt.type) {
    case 'step': {
      const el = document.createElement('div');
      el.className = 'crumb';
      const lbl = document.createElement('strong');
      lbl.textContent = '· ' + evt.label;
      el.appendChild(lbl);
      if (evt.detail) {
        el.appendChild(document.createTextNode(' — ' + evt.detail));
      }
      breadcrumbs.appendChild(el);
      statusEl.textContent = evt.label;
      break;
    }
    case 'teach':
      teachBody.textContent = evt.text;
      statusEl.textContent = 'Teach Me loaded';
      break;
    case 'game':
      renderGame(evt.questions || []);
      statusEl.textContent = 'Trivia loaded';
      break;
    case 'sonic':
      if (evt.action === 'start') {
        sonicBody.textContent = '♪ generative tone — listen while you wait';
        playNote(8);
      } else if (evt.action === 'stop') {
        sonicBody.textContent = '♪ answer ready';
        playChime();
      } else if (evt.note) {
        playNote(evt.note);
      }
      break;
    case 'token':
      if (outcomeEl.hidden) outcomeEl.hidden = false;
      answerEl.textContent += evt.text;
      statusEl.textContent = 'Streaming answer…';
      break;
    case 'done':
      statusEl.textContent = 'Answer complete';
      waitEl.hidden = true;
      break;
    case 'error':
      finishError(evt.error);
      break;
  }
}

function renderGame(questions) {
  gameBody.innerHTML = '';
  if (!Array.isArray(questions) || !questions.length) return;
  questions.forEach((qa, qi) => {
    const opts = Array.isArray(qa.options) ? qa.options : [];
    const box = document.createElement('div');
    box.className = 'trivia';
    const qh = document.createElement('div');
    qh.className = 'trivia-q';
    qh.textContent = (qi + 1) + '. ' + (qa.question || '');
    box.appendChild(qh);

    opts.forEach((opt, oi) => {
      const lab = document.createElement('label');
      lab.className = 'trivia-opt';
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 't' + qi;
      inp.value = oi;
      inp.addEventListener('change', () => {
        lab.classList.remove('correct', 'wrong');
        if (String(oi) === String(qa.answer)) {
          lab.classList.add('correct');
          notify('Correct! ✓');
        } else {
          lab.classList.add('wrong');
          const right = opts[Number(qa.answer)];
          notify('Not quite — ' + (right || 'answer unknown'));
        }
      });
      lab.appendChild(inp);
      lab.appendChild(document.createTextNode(' ' + opt));
      box.appendChild(lab);
    });
    gameBody.appendChild(box);
  });
}

function playChime() { playNote(9); playNote(12); }
