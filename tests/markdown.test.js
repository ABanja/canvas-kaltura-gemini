import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, linkTimestamps } from '../extension/lib/markdown.js';

test('escapes HTML in model output', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> **bold**');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('renders headings, lists and code', () => {
  const html = renderMarkdown('## Title\n- one\n- two\n\n3. three\n\n```\n<b>x</b>\n```');
  assert.ok(html.includes('<h4>Title</h4>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(html.includes('<ol start="3"><li>three</li></ol>'));
  assert.ok(html.includes('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>'));
});

test('keeps indented lines inside list items', () => {
  const html = renderMarkdown('1. Question?\n   A. yes\n   B. no');
  assert.ok(html.includes('<li>Question?<br>A. yes<br>B. no</li>'));
});

test('links timestamps', () => {
  assert.equal(linkTimestamps('see 4:05'), 'see <a href="#" class="ts" data-t="245">4:05</a>');
  assert.ok(linkTimestamps('[1:02:03]').includes('data-t="3723"'));
  assert.equal(linkTimestamps('ratio 3:75'), 'ratio 3:75');
});
