import { getSettings, saveSettings } from '../lib/settings.js';
import { streamGenerate, uploadFile, isModelUnavailableError, pickReplacementModel } from '../lib/gemini.js';
import * as kaltura from '../lib/kaltura.js';
import { parseCaptions, cuesToTranscript, transcriptToText, formatTimestamp } from '../lib/captions.js';
import { renderMarkdown } from '../lib/markdown.js';

const $ = (id) => document.getElementById(id);
const els = {
  openOptions: $('openOptions'),
  keyWarning: $('keyWarning'),
  keyLink: $('keyLink'),
  rescan: $('rescan'),
  videoSelect: $('videoSelect'),
  noVideos: $('noVideos'),
  sourceControls: $('sourceControls'),
  captionSelect: $('captionSelect'),
  loadTranscript: $('loadTranscript'),
  uploadVideo: $('uploadVideo'),
  sourceStatus: $('sourceStatus'),
  transcriptDetails: $('transcriptDetails'),
  transcript: $('transcript'),
  actions: $('actions'),
  chat: $('chat'),
  composer: $('composer'),
  prompt: $('prompt'),
  send: $('send'),
  stop: $('stop'),
  clearChat: $('clearChat')
};

const UPLOAD_LABEL = 'Send the video itself to Gemini';

const QUICK_PROMPTS = {
  summary:
    'Summarize this video. Start with a 2–3 sentence overview, then list the main points as bullets, each with the timestamp where it is covered.',
  chapters:
    'Break this video into chapters. For each chapter give its start timestamp, a short title and a one-sentence description.',
  study:
    'Create a study guide for this video: the key concepts with clear explanations, important definitions or formulas, and the examples the speaker uses. Cite timestamps.',
  quiz:
    'Quiz me on this video with 5 multiple-choice questions (A–D) of increasing difficulty. Do not reveal the answers until the end, where you list each answer with a brief explanation and the timestamp where it is covered.'
};

const QUICK_LABELS = {
  summary: 'Summarize this video',
  chapters: 'Break it into chapters',
  study: 'Make a study guide',
  quiz: 'Quiz me'
};

const state = {
  windowId: null,
  tabId: null,
  players: [],
  selectedKey: null,
  // key -> { tracks, trackError, entry, context, history, messages }
  sessions: new Map(),
  settings: null,
  abort: null,
  sourceBusy: false,
  uploadArmed: null
};

// ---------------------------------------------------------------- helpers

function currentPlayer() {
  return state.players.find((p) => p.key === state.selectedKey) || null;
}

function session(key = state.selectedKey) {
  if (!key) return null;
  if (!state.sessions.has(key)) {
    state.sessions.set(key, { tracks: null, trackError: null, entry: null, context: null, history: [], messages: [] });
  }
  return state.sessions.get(key);
}

function setStatus(text, kind = '', key = state.selectedKey) {
  if (key !== state.selectedKey) return;
  els.sourceStatus.textContent = text;
  els.sourceStatus.className = `status ${kind}`;
}

function requireKey() {
  if (state.settings.apiKey) return true;
  els.keyWarning.hidden = false;
  els.keyWarning.scrollIntoView({ behavior: 'smooth' });
  return false;
}

function friendlyError(err) {
  const msg = (err && err.message) || String(err);
  if (err && err.name === 'GeminiError') {
    if (err.status === 400 && /api key/i.test(msg)) return 'Gemini rejected your API key. Check it in Settings.';
    if (err.status === 403) return `Gemini denied access: ${msg}`;
    if (err.status === 404) return `${msg} — pick a different model in Settings.`;
    if (err.status === 429) return 'Gemini rate limit or quota reached. Wait a moment, or check your quota in Google AI Studio.';
  }
  return msg;
}

function sendCommand(player, cmd, extra = {}) {
  return chrome.tabs
    .sendMessage(player.tabId, { type: 'KGA_COMMAND', cmd, playerId: player.playerId, ...extra }, { frameId: player.frameId })
    .then((res) => res || { ok: false, error: 'No response from the video frame.' })
    .catch(() => ({ ok: false, error: 'The video frame is not reachable. Try reloading the Canvas page.' }));
}

function seek(seconds) {
  const player = currentPlayer();
  if (!player) return;
  sendCommand(player, 'seek', { time: seconds }).then((res) => {
    if (!res.ok) setStatus(`Could not jump to ${formatTimestamp(seconds)}: ${res.error}`, 'error');
  });
}

// ---------------------------------------------------------------- chat rendering

function messageElement(msg) {
  const el = document.createElement('div');
  el.className = `msg ${msg.role}${msg.pending ? ' pending' : ''}`;
  if (msg.role === 'model') el.innerHTML = renderMarkdown(msg.text);
  else el.textContent = msg.text;
  return el;
}

function nearBottom() {
  const c = els.chat;
  return c.scrollHeight - c.scrollTop - c.clientHeight < 60;
}

function addMessage(sess, role, text, extra = {}) {
  const msg = { role, text, ...extra };
  sess.messages.push(msg);
  if (sess === session()) {
    const stick = nearBottom();
    msg.el = messageElement(msg);
    els.chat.append(msg.el);
    if (stick || role === 'user') els.chat.scrollTop = els.chat.scrollHeight;
  }
  return msg;
}

function updateMessage(msg) {
  if (!msg.el || !msg.el.isConnected) return;
  const stick = nearBottom();
  const el = messageElement(msg);
  msg.el.replaceWith(el);
  msg.el = el;
  if (stick) els.chat.scrollTop = els.chat.scrollHeight;
}

function renderChat() {
  els.chat.replaceChildren();
  const sess = session();
  if (!sess) return;
  for (const msg of sess.messages) {
    msg.el = messageElement(msg);
    els.chat.append(msg.el);
  }
  els.chat.scrollTop = els.chat.scrollHeight;
}

function setGenerating(on) {
  els.send.hidden = on;
  els.stop.hidden = !on;
  for (const b of els.actions.querySelectorAll('button')) b.disabled = on;
}

// ---------------------------------------------------------------- players

async function setTab(tabId) {
  state.tabId = tabId;
  const key = `tab:${tabId}`;
  const { [key]: registry = {} } = await chrome.storage.session.get(key);
  if (state.tabId === tabId) setPlayers(registry);
}

function setPlayers(registry) {
  state.players = Object.entries(registry).map(([k, p]) => ({ ...p, key: `${p.tabId}:${k}` }));

  els.videoSelect.replaceChildren(
    ...state.players.map((p) => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = p.title || `Kaltura entry ${p.entryId}`;
      return opt;
    })
  );
  const hasPlayers = state.players.length > 0;
  els.videoSelect.hidden = !hasPlayers;
  els.noVideos.hidden = hasPlayers;
  els.sourceControls.hidden = !hasPlayers;

  if (!hasPlayers) {
    state.selectedKey = null;
    renderChat();
    return;
  }
  if (state.players.some((p) => p.key === state.selectedKey)) {
    els.videoSelect.value = state.selectedKey;
    // Retry discovery if the player has since exposed caption tracks.
    const sess = session();
    if (sess.tracks && !sess.tracks.length && currentPlayer().captions?.length && !state.sourceBusy) {
      sess.tracks = null;
      discoverTracks();
    }
  } else {
    selectPlayer(state.players[0].key);
  }
}

function selectPlayer(key) {
  state.selectedKey = key;
  state.uploadArmed = null;
  els.videoSelect.value = key;
  renderChat();
  const sess = session();
  if (!sess.tracks) discoverTracks();
  else renderSource();
}

function pickPreferredTrack(tracks) {
  const pref = (state.settings.preferredLanguage || '').trim().toLowerCase();
  if (pref) {
    const match = tracks.find((t) => {
      const lang = String(t.language).toLowerCase();
      return lang === pref || lang.startsWith(pref) || String(t.label).toLowerCase().includes(pref);
    });
    if (match) return match;
  }
  return tracks.find((t) => t.isDefault) || tracks[0];
}

async function discoverTracks() {
  const key = state.selectedKey;
  const player = currentPlayer();
  const sess = session();
  if (!player) return;

  state.sourceBusy = true;
  renderSource();
  setStatus('Looking for captions…');

  let tracks = (player.captions || []).map((c) => ({ ...c }));
  sess.trackError = null;
  if (!tracks.length) {
    try {
      tracks = await kaltura.listCaptionAssets(player);
    } catch (err) {
      sess.trackError = friendlyError(err);
    }
  }
  sess.tracks = tracks;
  kaltura
    .getEntry(player)
    .then((entry) => {
      sess.entry = entry;
    })
    .catch(() => {});

  state.sourceBusy = false;
  if (tracks.length && !sess.context) {
    await loadTranscript(key, pickPreferredTrack(tracks));
  } else if (state.selectedKey === key) {
    renderSource();
  }
}

function renderSource() {
  const sess = session();
  if (!sess) return;
  const tracks = sess.tracks || [];

  els.captionSelect.replaceChildren(
    ...tracks.map((t, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.label && t.language && t.label !== t.language ? `${t.label} (${t.language})` : t.label || t.language;
      return opt;
    })
  );
  if (sess.context && sess.context.kind === 'transcript') {
    els.captionSelect.value = String(Math.max(0, tracks.indexOf(sess.context.track)));
  }
  els.captionSelect.parentElement.hidden = !tracks.length;
  els.captionSelect.disabled = state.sourceBusy;
  els.loadTranscript.disabled = state.sourceBusy;
  els.uploadVideo.disabled = state.sourceBusy;
  if (!state.uploadArmed) els.uploadVideo.textContent = UPLOAD_LABEL;
  els.uploadVideo.className = `full ${tracks.length ? 'secondary' : ''}`;

  renderTranscript(sess);

  if (state.sourceBusy) return;
  if (sess.context && sess.context.kind === 'transcript') {
    const mins = Math.max(1, Math.round(sess.context.duration / 60));
    setStatus(`Using the transcript “${sess.context.track.label}” (~${mins} min).`, 'ok');
  } else if (sess.context && sess.context.kind === 'video') {
    setStatus('Using the video file uploaded to Gemini.', 'ok');
  } else if (!tracks.length) {
    const why = sess.trackError ? ` (${sess.trackError})` : '';
    setStatus(`No captions found for this video${why}. You can send the video itself to Gemini instead.`);
  } else {
    setStatus('Choose a caption track and click Load.');
  }
}

function renderTranscript(sess) {
  const ctx = sess.context;
  els.transcriptDetails.hidden = !(ctx && ctx.kind === 'transcript');
  if (els.transcriptDetails.hidden) {
    els.transcript.replaceChildren();
    return;
  }
  if (els.transcript.dataset.for === ctx.id) return;
  els.transcript.dataset.for = ctx.id;
  els.transcript.replaceChildren(
    ...ctx.blocks.map((b) => {
      const p = document.createElement('p');
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'ts';
      a.dataset.t = String(Math.floor(b.start));
      a.textContent = formatTimestamp(b.start);
      p.append(a, ' ', b.text);
      return p;
    })
  );
}

async function loadTranscript(key, track) {
  const player = state.players.find((p) => p.key === key);
  const sess = session(key);
  if (!player || !track) return;

  state.sourceBusy = true;
  if (state.selectedKey === key) renderSource();
  setStatus('Downloading captions…', '', key);
  try {
    const raw = await kaltura.fetchCaptionText(player, track);
    const cues = parseCaptions(raw);
    if (!cues.length) throw new Error('The caption file was empty or in an unsupported format.');
    const blocks = cuesToTranscript(cues);
    sess.context = {
      id: `${key}:${track.assetId || track.url}`,
      kind: 'transcript',
      track,
      blocks,
      text: transcriptToText(blocks),
      duration: cues[cues.length - 1].end || player.duration || 0
    };
    sess.history = [];
    addMessage(sess, 'info', `Transcript loaded (${track.label}). Ask a question or pick a quick action.`);
  } catch (err) {
    state.sourceBusy = false;
    if (state.selectedKey === key) renderSource();
    setStatus(`Could not load captions: ${friendlyError(err)}`, 'error', key);
    return;
  }
  state.sourceBusy = false;
  if (state.selectedKey === key) renderSource();
}

async function downloadWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Blob([await res.arrayBuffer()], { type: 'video/mp4' });
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = Math.floor((received * 100) / total);
    if (pct !== lastPct) onProgress((lastPct = pct));
  }
  return new Blob(chunks, { type: 'video/mp4' });
}

async function onUploadVideo() {
  if (!requireKey()) return;
  const key = state.selectedKey;
  const player = currentPlayer();
  const sess = session();
  if (!player) return;

  // Step 1: look up the size and ask for confirmation.
  if (!state.uploadArmed || state.uploadArmed.key !== key) {
    state.sourceBusy = true;
    renderSource();
    setStatus('Checking the video size…');
    try {
      const flavor = await kaltura.findSmallestMp4Flavor(player);
      const mb = flavor.sizeBytes / (1024 * 1024);
      state.sourceBusy = false;
      renderSource();
      if (mb > state.settings.maxUploadMb) {
        setStatus(
          `This video is about ${Math.round(mb)} MB, above your ${state.settings.maxUploadMb} MB upload limit (change it in Settings).`,
          'error'
        );
        return;
      }
      state.uploadArmed = { key, flavor };
      els.uploadVideo.textContent = `Confirm: upload ~${Math.max(1, Math.round(mb))} MB to Gemini`;
      setStatus(
        'The video will be downloaded from Kaltura and uploaded to the Gemini File API with your API key. Google deletes uploaded files after 48 hours.'
      );
    } catch (err) {
      state.sourceBusy = false;
      renderSource();
      setStatus(friendlyError(err), 'error');
    }
    return;
  }

  // Step 2: download from Kaltura and upload to Gemini.
  const { flavor } = state.uploadArmed;
  state.uploadArmed = null;
  state.sourceBusy = true;
  renderSource();
  try {
    setStatus('Getting a download link from Kaltura…', '', key);
    const url = await kaltura.getFlavorUrl(player, flavor.flavorId);
    const blob = await downloadWithProgress(url, (pct) => setStatus(`Downloading video… ${pct}%`, '', key));
    const file = await uploadFile({
      apiKey: state.settings.apiKey,
      blob,
      mimeType: 'video/mp4',
      displayName: String(player.title || player.entryId).slice(0, 120),
      onStatus: (text) => setStatus(text, '', key)
    });
    sess.context = { id: `${key}:video`, kind: 'video', fileUri: file.uri, mimeType: file.mimeType || 'video/mp4' };
    sess.history = [];
    addMessage(sess, 'info', 'Video ready. Ask a question or pick a quick action.');
    state.sourceBusy = false;
    if (state.selectedKey === key) renderSource();
  } catch (err) {
    state.sourceBusy = false;
    if (state.selectedKey === key) renderSource();
    setStatus(`Could not send the video: ${friendlyError(err)}`, 'error', key);
  }
}

// ---------------------------------------------------------------- Gemini

function buildSystemInstruction(player, sess) {
  const ctx = sess.context;
  const entry = sess.entry || {};
  const title = entry.name || player.title;
  const description = entry.description || player.description;
  const duration = entry.duration || player.duration;

  const lines = [
    'You are a study assistant inside a browser extension. A student is watching a lecture video from their Canvas course and asks you about it.',
    'Ground your answers in the video. If something is not covered in the video, say so plainly before adding general background, and label that background as such.',
    'When you refer to a moment in the video, cite its timestamp as [m:ss] or [h:mm:ss], for example [4:05]. The student can click timestamps to jump the video there.',
    'Be concise. Use Markdown with short headings and bullet lists; do not use tables.',
    '',
    `Video title: ${title || 'unknown'}`
  ];
  if (description) lines.push(`Video description: ${description}`);
  if (duration) lines.push(`Video length: ${formatTimestamp(duration)}`);
  if (state.settings.extraInstructions.trim()) {
    lines.push('', 'Additional instructions from the student:', state.settings.extraInstructions.trim());
  }
  if (ctx.kind === 'transcript') {
    lines.push(
      '',
      `The transcript below comes from the video's captions (${ctx.track.label}). Each line starts with the time it begins.`,
      '<transcript>',
      ctx.text,
      '</transcript>'
    );
  } else {
    lines.push('', 'The video file is attached to the first message of the conversation.');
  }
  return lines.join('\n');
}

async function ask(text, display = text) {
  if (state.abort || !requireKey()) return;
  const player = currentPlayer();
  const sess = session();
  if (!player || !sess) return;
  if (!sess.context) {
    addMessage(sess, 'info', 'Load a transcript (or send the video to Gemini) first.');
    return;
  }

  const parts = [{ text }];
  if (sess.context.kind === 'video' && sess.history.length === 0) {
    parts.unshift({ fileData: { mimeType: sess.context.mimeType, fileUri: sess.context.fileUri } });
  }
  sess.history.push({ role: 'user', parts });
  addMessage(sess, 'user', display);
  const reply = addMessage(sess, 'model', '', { pending: true });

  const controller = new AbortController();
  state.abort = controller;
  setGenerating(true);
  const run = async (model) => {
    const stream = streamGenerate({
      apiKey: state.settings.apiKey,
      model,
      temperature: Number(state.settings.temperature),
      systemInstruction: buildSystemInstruction(player, sess),
      contents: sess.history,
      signal: controller.signal
    });
    for await (const chunk of stream) {
      reply.text += chunk;
      updateMessage(reply);
    }
  };
  try {
    try {
      await run(state.settings.model);
    } catch (err) {
      // Google retires models over time; switch to a current one and retry once.
      if (reply.text || !isModelUnavailableError(err)) throw err;
      const oldModel = state.settings.model;
      const newModel = await pickReplacementModel(state.settings.apiKey, oldModel, err.message);
      state.settings.model = newModel;
      await saveSettings({ model: newModel });
      reply.text = `_Model “${oldModel}” is unavailable, so I switched to “${newModel}” (change it in Settings)._\n\n`;
      updateMessage(reply);
      await run(newModel);
    }
    if (!reply.text.trim()) reply.text = '_(Gemini returned an empty response.)_';
    sess.history.push({ role: 'model', parts: [{ text: reply.text }] });
  } catch (err) {
    if (err.name === 'AbortError' && reply.text) {
      reply.text += '\n\n_(stopped)_';
      sess.history.push({ role: 'model', parts: [{ text: reply.text }] });
    } else {
      sess.history.pop();
      reply.role = err.name === 'AbortError' ? 'info' : 'error';
      reply.text = err.name === 'AbortError' ? 'Stopped.' : friendlyError(err);
    }
  } finally {
    reply.pending = false;
    updateMessage(reply);
    state.abort = null;
    setGenerating(false);
  }
}

async function onQuickAction(action) {
  if (action !== 'now') {
    ask(QUICK_PROMPTS[action], QUICK_LABELS[action]);
    return;
  }
  const player = currentPlayer();
  if (!player) return;
  const res = await sendCommand(player, 'state');
  if (!res.ok) {
    addMessage(session(), 'error', `Couldn't read the playback position: ${res.error}`);
    return;
  }
  const ts = formatTimestamp(res.currentTime);
  ask(
    `I'm at ${ts} in the video. Explain what is being discussed right now: briefly recap the preceding minute for context, then explain the current point in simple terms.`,
    `Explain what's happening at ${ts}`
  );
}

async function rescan() {
  if (state.tabId == null) return;
  const tabId = state.tabId;
  // Inject into frames that loaded before the extension was installed or updated.
  // Frames we lack permission for are skipped; scripts guard against double-loading.
  const target = { tabId, allFrames: true };
  await chrome.scripting
    .executeScript({ target, files: ['content/kaltura-bridge.js'], world: 'MAIN' })
    .catch(() => {});
  await chrome.scripting.executeScript({ target, files: ['content/kaltura-content.js'] }).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: 'KGA_COMMAND', cmd: 'rescan' }).catch(() => {});

  const sess = session();
  if (sess && !sess.context && !state.sourceBusy) {
    sess.tracks = null;
    discoverTracks();
  }
}

// ---------------------------------------------------------------- wiring

function openOptions(e) {
  e?.preventDefault();
  chrome.runtime.openOptionsPage();
}

function wireEvents() {
  els.openOptions.addEventListener('click', openOptions);
  els.keyLink.addEventListener('click', openOptions);
  els.rescan.addEventListener('click', rescan);
  els.videoSelect.addEventListener('change', () => selectPlayer(els.videoSelect.value));
  els.loadTranscript.addEventListener('click', () => {
    const sess = session();
    const track = sess && sess.tracks && sess.tracks[Number(els.captionSelect.value)];
    if (track) loadTranscript(state.selectedKey, track);
  });
  els.uploadVideo.addEventListener('click', onUploadVideo);

  els.actions.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (button) onQuickAction(button.dataset.action);
  });

  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.prompt.value.trim();
    if (!text || state.abort) return;
    els.prompt.value = '';
    ask(text);
  });
  els.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.composer.requestSubmit();
    }
  });
  els.stop.addEventListener('click', () => state.abort?.abort());
  els.clearChat.addEventListener('click', () => {
    const sess = session();
    if (!sess || state.abort) return;
    sess.history = [];
    sess.messages = [];
    renderChat();
  });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a.ts');
    if (!link) return;
    e.preventDefault();
    seek(Number(link.dataset.t));
  });

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId === state.windowId) setTab(tabId);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && state.tabId != null) {
      const change = changes[`tab:${state.tabId}`];
      if (change) setPlayers(change.newValue || {});
    } else if (area === 'local') {
      getSettings().then((s) => {
        state.settings = s;
        els.keyWarning.hidden = Boolean(s.apiKey);
      });
    }
  });
}

async function init() {
  state.settings = await getSettings();
  els.keyWarning.hidden = Boolean(state.settings.apiKey);
  wireEvents();
  const win = await chrome.windows.getCurrent();
  state.windowId = win.id;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (tab) await setTab(tab.id);
}

init();
