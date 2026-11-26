import { api } from './api.js';
import { GeminiLiveEngine, WebSpeechEngine } from './engines.js';
import { tts } from './tts.js';
import { $, copyText, debounce, el, enableRipples, formatDate, formatDuration, toast } from './ui.js';
import { SilenceDetector } from './silence.js';
import { Visualizer } from './visualizer.js';

const state = {
  config: null,
  engine: null,
  recording: false,
  autoStopped: false,
  committed: '',
  interim: '',
  startedAt: 0,
  timer: 0,
  languages: new Set(),
  history: { q: '', source: '', page: 1, pageSize: 10, totalPages: 1, loadedOnce: false },
  editingId: null,
};

enableRipples();

/* ------------------------------------------------------------------ tabs */
const indicator = $('.tab-indicator');
function moveIndicator() {
  const active = $('.tab.active');
  if (!active) return;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.transform = `translateX(${active.offsetLeft}px)`;
}

function showView(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  moveIndicator();
  if (name === 'history') loadHistory();
}
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    history.replaceState(null, '', t.dataset.view === 'live' ? location.pathname : '#history');
    showView(t.dataset.view);
  }),
);
window.addEventListener('resize', moveIndicator);
document.fonts?.ready.then(moveIndicator);

/* ------------------------------------------------------------------ live */
const recordBtn = $('#record');
const stage = $('#mic-stage');
const liveCard = $('.live-card');
const statusEl = $('#status');
const statusChip = $('#status-chip');
const transcriptEl = $('#transcript');

const viz = new Visualizer($('#viz'), {
  onLevel: (level) => stage.style.setProperty('--level', level.toFixed(3)),
});

/* ---------------------------------------------- auto-save on silence */
const LISTENING_TEXT = 'Listening — Hindi, English or both';
const PREFS_KEY = 'stt.autosave';
const autosaveEl = $('#autosave');
const silenceMsEl = $('#silence-ms');
const countdownArc = $('#countdown-arc');

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (typeof p.enabled === 'boolean') autosaveEl.checked = p.enabled;
    if (p.ms && silenceMsEl.querySelector(`option[value="${Number(p.ms)}"]`)) silenceMsEl.value = String(p.ms);
  } catch {
    /* corrupted prefs: keep defaults */
  }
  silenceMsEl.disabled = !autosaveEl.checked;
}
function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ enabled: autosaveEl.checked, ms: Number(silenceMsEl.value) }));
}

const silence = new SilenceDetector({
  onTick: (remaining, msLeft) => {
    const counting = remaining !== null && state.recording;
    if (counting) {
      countdownArc.style.strokeDashoffset = String(100 - remaining * 100);
      statusEl.textContent = `Pause detected — saving in ${Math.ceil(msLeft / 1000)}s…`;
    } else if (stage.classList.contains('counting') && state.recording) {
      statusEl.textContent = LISTENING_TEXT; // user started talking again
    }
    stage.classList.toggle('counting', counting);
  },
  onSilence: () => {
    if (!state.recording) return;
    state.autoStopped = true;
    stopRecording('Silence detected — saving…');
  },
});

function syncSilenceDetector() {
  if (state.recording && autosaveEl.checked) silence.start(Number(silenceMsEl.value));
  else silence.stop();
}

autosaveEl.addEventListener('change', () => {
  silenceMsEl.disabled = !autosaveEl.checked;
  savePrefs();
  syncSilenceDetector(); // can be toggled mid-recording
});
silenceMsEl.addEventListener('change', () => {
  savePrefs();
  syncSilenceDetector();
});
loadPrefs();

// Persistent transcript nodes: we append to them so only *new* words animate in.
const committedEl = el('span', { class: 'committed' });
const interimEl = el('span', { class: 'interim' });
const caretEl = el('span', { class: 'caret', 'aria-hidden': 'true' });

/** state: idle | connecting | live | done | error */
function setStatus(text, kind = 'idle') {
  statusEl.textContent = text;
  // Re-trigger the shake animation on repeated errors.
  statusChip.dataset.state = '';
  void statusChip.offsetWidth;
  statusChip.dataset.state = kind;
}

function placeholder() {
  return state.recording
    ? el('span', { class: 'placeholder' }, 'Listening… start speaking')
    : el(
        'span',
        { class: 'placeholder' },
        'Tap the mic and speak — try ',
        el('em', {}, '“Aaj ka meeting 5 baje hai, please remind me.”'),
      );
}

function renderTranscript() {
  const empty = !state.committed && !state.interim;
  transcriptEl.classList.toggle('is-empty', empty);
  if (empty) {
    transcriptEl.replaceChildren(placeholder());
  } else if (!committedEl.isConnected) {
    transcriptEl.replaceChildren(committedEl, interimEl, caretEl);
  }
  interimEl.textContent = state.interim;
  caretEl.hidden = !state.recording;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  const words = state.committed.trim().split(/\s+/).filter(Boolean).length;
  $('#counts').textContent = `${words} word${words === 1 ? '' : 's'} · ${state.committed.trim().length} chars`;
  $('#langs').replaceChildren(
    ...(state.languages.size ? ['Detected:', ...[...state.languages].map((l) => el('span', { class: 'lang-pill' }, l))] : []),
  );

  const has = Boolean(state.committed.trim());
  ['#speak-live', '#copy-live', '#clear-live'].forEach((s) => ($(s).disabled = !has || state.recording));
}

function appendCommitted(text) {
  if (!text) return;
  state.committed += text;
  committedEl.append(el('span', { class: 'chunk' }, text));
}

function resetTranscript() {
  state.committed = '';
  state.interim = '';
  state.languages.clear();
  committedEl.replaceChildren();
  renderTranscript();
}

function setRecordingUI(on) {
  state.recording = on;
  stage.classList.remove('connecting');
  stage.classList.toggle('recording', on);
  liveCard.classList.toggle('is-recording', on);
  recordBtn.setAttribute('aria-pressed', String(on));
  recordBtn.setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
  $('#engine').disabled = on;
  $('#lang').disabled = on;
  viz.setActive(on);
  clearInterval(state.timer);
  if (on) {
    state.startedAt = Date.now();
    state.timer = setInterval(() => ($('#timer').textContent = formatDuration(Date.now() - state.startedAt)), 250);
  }
  renderTranscript();
}

function createEngine() {
  return $('#engine').value === 'gemini'
    ? new GeminiLiveEngine(state.config.wsPath)
    : new WebSpeechEngine($('#lang').value);
}

async function startRecording() {
  tts.stop();
  resetTranscript();
  state.autoStopped = false;
  $('#timer').textContent = '00:00';
  recordBtn.disabled = true;
  stage.classList.add('connecting');
  setStatus('Connecting…', 'connecting');

  const engine = createEngine();
  state.engine = engine;

  engine.start({
    onStarted: () => {
      recordBtn.disabled = false;
      setRecordingUI(true);
      setStatus(LISTENING_TEXT, 'live');
      syncSilenceDetector();
    },
    onInterim: (text) => {
      if (text.trim()) silence.activity();
      state.interim = text;
      renderTranscript();
    },
    onCommit: (text, lang) => {
      if (text.trim()) silence.activity();
      state.interim = '';
      appendCommitted(text);
      if (lang) state.languages.add(lang);
      renderTranscript();
    },
    onTurn: () => {
      if (state.committed && !/\s$/.test(state.committed)) appendCommitted(' ');
    },
    onLevel: (rms) => {
      viz.push(rms);
      silence.level(rms);
    },
    onSaved: (record) => {
      toast(`Saved “${record.title}”`);
      if ($('#view-history').classList.contains('active')) loadHistory();
    },
    onError: (msg) => {
      setStatus(msg, 'error');
      toast(msg, 'error', 6000);
    },
    onStopped: () => onEngineStopped(engine),
  });
}

async function onEngineStopped(engine) {
  if (state.engine !== engine) return;
  state.engine = null;
  silence.stop();
  stage.classList.remove('counting');
  recordBtn.disabled = false;
  const durationMs = state.recording ? Date.now() - state.startedAt : 0;
  const wasRecording = state.recording;
  appendCommitted(state.interim); // keep any unfinished hypothesis
  state.interim = '';
  setRecordingUI(false);
  if (statusChip.dataset.state !== 'error') {
    const hasText = Boolean(state.committed.trim());
    const doneText = !hasText
      ? 'Nothing was heard — try again'
      : state.autoStopped
        ? 'Auto-saved after you stopped speaking'
        : 'Done — saved to history';
    setStatus(wasRecording ? doneText : 'Ready', wasRecording && hasText ? 'done' : 'idle');
  }

  // Web Speech runs in the browser, so the client persists it; Gemini is saved server-side.
  const text = state.committed.trim();
  if (!engine.savesOnServer && wasRecording && text) {
    try {
      const record = await api.create({
        text,
        source: 'web-speech',
        language: [...state.languages].join(',') || undefined,
        durationMs,
      });
      toast(`Saved “${record.title}”`);
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'error');
    }
  }
}

/** Single stop path for the button, the Space key and silence detection. */
async function stopRecording(message = 'Finishing up…') {
  if (!state.recording || recordBtn.disabled) return;
  silence.stop();
  stage.classList.remove('counting');
  recordBtn.disabled = true;
  stage.classList.add('connecting');
  setStatus(message, 'connecting');
  await state.engine?.stop();
}

recordBtn.addEventListener('click', async () => {
  if (state.recording) await stopRecording();
  else await startRecording();
});

// Space bar toggles recording when focus isn't in a form control.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || !$('#view-live').classList.contains('active')) return;
  if (e.target.closest('input, textarea, select, button, dialog')) return;
  e.preventDefault();
  if (!recordBtn.disabled) recordBtn.click();
});

$('#engine').addEventListener('change', () => {
  $('#lang-field').hidden = $('#engine').value !== 'webspeech';
});
$('#speak-live').addEventListener('click', () => tts.speak(state.committed));
$('#copy-live').addEventListener('click', () => copyText(state.committed.trim()));
$('#clear-live').addEventListener('click', () => {
  resetTranscript();
  $('#timer').textContent = '00:00';
  setStatus('Ready');
});

/* --------------------------------------------------------------- history */
const SOURCE = {
  'gemini-live': { label: 'Gemini Live', icon: '✦' },
  'web-speech': { label: 'Web Speech', icon: '🎙' },
  manual: { label: 'Manual', icon: '✎' },
};

const ICON_PATHS = {
  speak: 'M3 10v4h4l5 5V5L7 10H3Zm13.5 2A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  del: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
};

function iconBtn(kind, label, onclick, extra = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[kind]);
  svg.append(path);
  return el('button', { class: `btn icon ghost ${extra}`, title: label, 'aria-label': label, onclick }, svg);
}

function historyItem(r, index) {
  const src = SOURCE[r.source] ?? { label: r.source, icon: '•' };
  const li = el(
    'li',
    { class: `item src-${r.source}` },
    el('div', { class: 'avatar', 'aria-hidden': 'true' }, src.icon),
    el(
      'div',
      { class: 'item-body' },
      el(
        'div',
        { class: 'item-head' },
        el('div', { class: 'item-title', title: r.title }, r.title),
        el(
          'div',
          { class: 'item-actions' },
          iconBtn('speak', 'Read aloud', () => tts.speak(r.text)),
          iconBtn('copy', 'Copy', () => copyText(r.text)),
          iconBtn('edit', 'Edit', () => openEditor(r)),
          iconBtn('del', 'Delete', () => deleteRecord(r, li), 'danger'),
        ),
      ),
      el('p', { class: 'item-text', lang: /[ऀ-ॿ]/.test(r.text) ? 'hi' : 'en' }, r.text),
      el(
        'div',
        { class: 'item-meta' },
        el('span', { class: 'badge' }, src.label),
        el('span', {}, formatDate(r.createdAt)),
        r.durationMs ? el('span', {}, `⏱ ${formatDuration(r.durationMs)}`) : null,
        r.language ? el('span', {}, `🌐 ${r.language}`) : null,
      ),
    ),
  );
  li.style.setProperty('--i', index);
  return li;
}

function skeletonItem(i) {
  const li = el(
    'li',
    { class: 'item skeleton' },
    el('div', { class: 'avatar' }),
    el(
      'div',
      {},
      el('div', { class: 'sk-line', style: 'width:45%' }),
      el('div', { class: 'sk-line', style: 'width:92%' }),
      el('div', { class: 'sk-line', style: 'width:70%' }),
    ),
  );
  li.style.setProperty('--i', i);
  return li;
}

let historyRequest = 0;
async function loadHistory() {
  const h = state.history;
  const reqId = ++historyRequest; // ignore stale responses from fast typing
  if (!h.loadedOnce) {
    $('#history-list').replaceChildren(...[0, 1, 2].map(skeletonItem));
    $('#history-empty').hidden = true;
  }
  try {
    const { items, pagination } = await api.list(h);
    if (reqId !== historyRequest) return;
    if (items.length === 0 && h.page > 1 && pagination.total > 0) {
      h.page = pagination.totalPages;
      return loadHistory();
    }
    h.loadedOnce = true;
    h.totalPages = pagination.totalPages;
    $('#history-list').replaceChildren(...items.map(historyItem));
    $('#history-empty').hidden = items.length > 0;
    $('#history-sub').textContent =
      pagination.total === 0
        ? 'All your saved sessions'
        : `${pagination.total} saved session${pagination.total === 1 ? '' : 's'}${h.q ? ` matching “${h.q}”` : ''}`;
    $('#page-info').textContent = `Page ${pagination.page} of ${pagination.totalPages}`;
    $('#prev').disabled = h.page <= 1;
    $('#next').disabled = h.page >= h.totalPages;
  } catch (err) {
    if (reqId !== historyRequest) return;
    $('#history-list').replaceChildren();
    toast(`Could not load history: ${err.message}`, 'error');
  }
}

async function deleteRecord(r, li) {
  if (!confirm(`Delete “${r.title}”? This cannot be undone.`)) return;
  try {
    await api.remove(r.id);
    li.classList.add('removing');
    await new Promise((res) => {
      li.addEventListener('animationend', res, { once: true });
      setTimeout(res, 500);
    });
    toast('Deleted');
    loadHistory();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const editor = $('#editor');
function openEditor(record = null) {
  state.editingId = record?.id ?? null;
  $('#editor-title').textContent = record ? 'Edit transcription' : 'New transcription';
  $('#f-title').value = record?.title ?? '';
  $('#f-text').value = record?.text ?? '';
  $('#f-language').value = record?.language ?? '';
  $('#editor-error').hidden = true;
  editor.showModal();
  $('#f-text').focus();
}

$('#editor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: $('#f-title').value.trim() || undefined,
    text: $('#f-text').value,
    language: $('#f-language').value.trim() || undefined,
  };
  try {
    if (state.editingId) await api.update(state.editingId, payload);
    else await api.create({ ...payload, source: 'manual' });
    editor.close();
    toast(state.editingId ? 'Updated' : 'Created');
    loadHistory();
  } catch (err) {
    $('#editor-error').textContent = err.message;
    $('#editor-error').hidden = false;
  }
});
$('#editor-cancel').addEventListener('click', () => editor.close());
// Click on the backdrop closes the dialog.
editor.addEventListener('click', (e) => {
  if (e.target === editor) editor.close();
});
$('#new-btn').addEventListener('click', () => openEditor());

$('#search').addEventListener(
  'input',
  debounce((e) => {
    state.history.q = e.target.value.trim();
    state.history.page = 1;
    loadHistory();
  }, 300),
);
$('#source-filter').addEventListener('change', (e) => {
  state.history.source = e.target.value;
  state.history.page = 1;
  loadHistory();
});
$('#prev').addEventListener('click', () => {
  state.history.page -= 1;
  loadHistory();
});
$('#next').addEventListener('click', () => {
  state.history.page += 1;
  loadHistory();
});

/* ------------------------------------------------------------------ init */
async function init() {
  if (location.hash === '#history') showView('history');
  moveIndicator();
  renderTranscript();
  try {
    state.config = await api.config();
  } catch {
    setStatus('Server unreachable', 'error');
    recordBtn.disabled = true;
    return;
  }
  const gemini = state.config.engines.geminiLive;
  const engineSel = $('#engine');
  const gOpt = engineSel.querySelector('[value="gemini"]');
  const wOpt = engineSel.querySelector('[value="webspeech"]');
  if (!gemini.enabled) {
    gOpt.textContent = 'Gemini Live (no API key on server)';
    gOpt.disabled = true;
    engineSel.value = 'webspeech';
  } else {
    gOpt.textContent = `Gemini Live · ${gemini.model}`;
  }
  if (!WebSpeechEngine.isSupported()) {
    wOpt.textContent = 'Browser Web Speech (unsupported here)';
    wOpt.disabled = true;
  }
  engineSel.dispatchEvent(new Event('change'));
  setStatus('Ready — tap the mic or press Space');
}

init();
