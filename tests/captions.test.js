import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCaptions,
  parseClockTime,
  formatTimestamp,
  parseTimestamp,
  cuesToTranscript,
  transcriptToText
} from '../extension/lib/captions.js';

test('parses SRT', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>class</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nToday: entropy &amp; heat\r\n';
  assert.deepEqual(parseCaptions(srt), [
    { start: 1, end: 3.5, text: 'Hello class' },
    { start: 4, end: 6, text: 'Today: entropy & heat' }
  ]);
});

test('parses WebVTT with header, settings and short timestamps', () => {
  const vtt = 'WEBVTT\n\nNOTE a comment\n\n00:01.000 --> 00:02.000 align:start\n<v Prof>First line\nsecond line</v>\n\n1:00:00.000 --> 1:00:01.000\nAn hour in\n';
  assert.deepEqual(parseCaptions(vtt), [
    { start: 1, end: 2, text: 'First line second line' },
    { start: 3600, end: 3601, text: 'An hour in' }
  ]);
});

test('parses DFXP with clock, offset and tick times', () => {
  const dfxp = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" ttp:tickRate="10000000"><body><div>
  <p begin="00:00:01.500" end="00:00:02.000">One<br/>two</p>
  <p begin="3s" dur="1s">Three</p>
  <p begin="40000000t" end="50000000t">Four</p>
</div></body></tt>`;
  assert.deepEqual(parseCaptions(dfxp), [
    { start: 1.5, end: 2, text: 'One two' },
    { start: 3, end: 4, text: 'Three' },
    { start: 4, end: 5, text: 'Four' }
  ]);
});

test('drops consecutive duplicate cues', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nSame\n\n2\n00:00:02,000 --> 00:00:03,000\nSame\n';
  assert.equal(parseCaptions(srt).length, 1);
});

test('time helpers round-trip', () => {
  assert.equal(parseClockTime('01:02:03,250'), 3723.25);
  assert.equal(formatTimestamp(75), '1:15');
  assert.equal(formatTimestamp(3725.9), '1:02:05');
  assert.equal(parseTimestamp('1:15'), 75);
  assert.equal(parseTimestamp('1:02:05'), 3725);
  assert.ok(Number.isNaN(parseTimestamp('abc')));
});

test('groups cues into timestamped blocks', () => {
  const cues = [
    { start: 0, end: 5, text: 'a' },
    { start: 10, end: 15, text: 'b' },
    { start: 25, end: 30, text: 'c' }
  ];
  const blocks = cuesToTranscript(cues, 20);
  assert.deepEqual(blocks, [
    { start: 0, text: 'a b' },
    { start: 25, text: 'c' }
  ]);
  assert.equal(transcriptToText(blocks), '[0:00] a b\n[0:25] c');
});
