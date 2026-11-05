// Small, safe Markdown renderer for model output. All text is HTML-escaped
// before any markup is added, so model output can never inject HTML.
// Timestamps such as 12:34 or 1:02:03 become links that seek the video.

import { parseTimestamp } from './captions.js';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:[0-5]\d\b/g;

export function linkTimestamps(escapedHtml) {
  return escapedHtml.replace(TIMESTAMP_RE, (ts) => {
    const seconds = parseTimestamp(ts);
    return Number.isFinite(seconds) ? `<a href="#" class="ts" data-t="${seconds}">${ts}</a>` : ts;
  });
}

function inline(text) {
  let s = escapeHtml(text);
  const codeSpans = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = linkTimestamps(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`);
}

export function renderMarkdown(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let html = '';
  let para = [];
  let list = null;
  let inCode = false;
  let code = [];

  const flushPara = () => {
    if (para.length) html += `<p>${inline(para.join(' '))}</p>`;
    para = [];
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
        code = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    let m;
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) {
      flushPara();
      closeList();
      const level = Math.min(6, m[1].length + 2);
      html += `<h${level}>${inline(m[2])}</h${level}>`;
    } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushPara();
      closeList();
      html += '<hr>';
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        html += '<ul>';
        list = 'ul';
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        html += Number(m[1]) === 1 ? '<ol>' : `<ol start="${Number(m[1])}">`;
        list = 'ol';
      }
      html += `<li>${inline(m[2])}</li>`;
    } else if (/^\s*>\s?/.test(line)) {
      flushPara();
      closeList();
      html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`;
    } else if (list && /^\s{2,}\S/.test(line)) {
      // Indented continuation (e.g. quiz answer options) stays inside the list item.
      html = html.replace(/<\/li>$/, `<br>${inline(line.trim())}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  if (inCode) html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
  flushPara();
  closeList();
  return html;
}
