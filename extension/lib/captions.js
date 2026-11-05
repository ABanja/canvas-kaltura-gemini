// Caption parsing (SRT, WebVTT, DFXP/TTML) and transcript formatting.
// Pure functions with no browser APIs, so they can be unit tested in Node.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanText(s) {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "01:02:03,456", "02:03.456", "1:02:03.4" -> seconds */
export function parseClockTime(s) {
  const m = String(s)
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/);
  if (!m) return NaN;
  const [, h = '0', min, sec, frac = '0'] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(sec) + Number(`0.${frac}`);
}

function parseSrtOrVtt(text) {
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex < 0) continue;
    const [startRaw, rest] = lines[timingIndex].split('-->');
    const endRaw = rest.trim().split(/\s+/)[0];
    const start = parseClockTime(startRaw);
    const end = parseClockTime(endRaw);
    const body = cleanText(lines.slice(timingIndex + 1).join(' '));
    if (Number.isFinite(start) && body) cues.push({ start, end: Number.isFinite(end) ? end : start, text: body });
  }
  return cues;
}

function parseTtmlTime(value, tickRate) {
  if (!value) return NaN;
  const v = value.trim();
  const offset = v.match(/^([\d.]+)(h|m|s|ms|t)$/);
  if (offset) {
    const n = Number(offset[1]);
    switch (offset[2]) {
      case 'h':
        return n * 3600;
      case 'm':
        return n * 60;
      case 's':
        return n;
      case 'ms':
        return n / 1000;
      case 't':
        return n / tickRate;
    }
  }
  // hh:mm:ss(.fff) or hh:mm:ss:frames (frames ignored)
  const clock = v.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)(?::\d+)?$/);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  return NaN;
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function parseDfxp(text) {
  const tickRateMatch = text.match(/ttp:tickRate\s*=\s*"(\d+)"/i);
  const tickRate = tickRateMatch ? Number(tickRateMatch[1]) : 10000000;
  const cues = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(text))) {
    const start = parseTtmlTime(attr(m[1], 'begin'), tickRate);
    let end = parseTtmlTime(attr(m[1], 'end'), tickRate);
    const dur = parseTtmlTime(attr(m[1], 'dur'), tickRate);
    if (!Number.isFinite(end) && Number.isFinite(dur)) end = start + dur;
    const body = cleanText(m[2]);
    if (Number.isFinite(start) && body) cues.push({ start, end: Number.isFinite(end) ? end : start, text: body });
  }
  return cues;
}

/** Parses SRT, WebVTT or DFXP text into [{ start, end, text }] sorted by start. */
export function parseCaptions(raw) {
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = /<tt[\s>]/i.test(text) ? parseDfxp(text) : parseSrtOrVtt(text);
  cues.sort((a, b) => a.start - b.start);
  // Drop exact repeats that roll-up style captions produce.
  return cues.filter((c, i) => i === 0 || c.text !== cues[i - 1].text);
}

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "1:15" -> 75, "1:02:05" -> 3725 */
export function parseTimestamp(str) {
  const parts = String(str).split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Groups cues into paragraphs of roughly `blockSeconds`, each prefixed with its
 * start time, which keeps timestamps citable while saving tokens.
 */
export function cuesToTranscript(cues, blockSeconds = 20) {
  const blocks = [];
  let current = null;
  for (const cue of cues) {
    if (!current || cue.start - current.start >= blockSeconds) {
      current = { start: cue.start, texts: [] };
      blocks.push(current);
    }
    current.texts.push(cue.text);
  }
  return blocks.map((b) => ({ start: b.start, text: b.texts.join(' ') }));
}

export function transcriptToText(blocks) {
  return blocks.map((b) => `[${formatTimestamp(b.start)}] ${b.text}`).join('\n');
}
