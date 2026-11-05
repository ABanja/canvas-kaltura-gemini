// Minimal client for the Gemini API (generativelanguage.googleapis.com), called
// directly from extension pages with the user's own API key.

const API = 'https://generativelanguage.googleapis.com';

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

function authHeaders(apiKey, extra = {}) {
  return { 'x-goog-api-key': apiKey, ...extra };
}

function modelPath(model) {
  return `models/${encodeURIComponent(String(model).replace(/^models\//, ''))}`;
}

async function errorFrom(res) {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body && body.error && body.error.message) message = body.error.message;
  } catch {
    // keep the HTTP status text
  }
  return new GeminiError(message, res.status);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/** Models usable with generateContent, e.g. [{ id: 'gemini-2.5-flash', displayName }]. */
export async function listModels(apiKey) {
  const models = [];
  let pageToken = '';
  do {
    const url = new URL(`${API}/v1beta/models`);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: authHeaders(apiKey) });
    if (!res.ok) throw await errorFrom(res);
    const body = await res.json();
    for (const m of body.models || []) {
      if ((m.supportedGenerationMethods || []).includes('generateContent')) {
        models.push({ id: m.name.replace(/^models\//, ''), displayName: m.displayName || m.name });
      }
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return models;
}

/**
 * Streams a response as text chunks.
 * `contents` uses the REST shape: [{ role: 'user' | 'model', parts: [...] }].
 */
export async function* streamGenerate({ apiKey, model, systemInstruction, contents, temperature, signal }) {
  const body = {
    contents,
    generationConfig: { temperature }
  };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

  const res = await fetch(`${API}/v1beta/${modelPath(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: authHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw await errorFrom(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r/g, '');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;

      const chunk = JSON.parse(data);
      if (chunk.error) throw new GeminiError(chunk.error.message || 'Gemini returned an error.');
      if (chunk.promptFeedback && chunk.promptFeedback.blockReason) {
        throw new GeminiError(`Gemini blocked the request (${chunk.promptFeedback.blockReason}).`);
      }
      const candidate = chunk.candidates && chunk.candidates[0];
      const parts = (candidate && candidate.content && candidate.content.parts) || [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text || '')
        .join('');
      if (text) yield text;
      const reason = candidate && candidate.finishReason;
      if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS' && reason !== 'FINISH_REASON_UNSPECIFIED') {
        yield `\n\n_(Gemini stopped the response: ${reason})_`;
      }
    }
  }
}

/**
 * Uploads a file with the Gemini File API (resumable protocol) and waits until it
 * is ready to use. Returns the File resource ({ name, uri, mimeType, state, ... }).
 */
export async function uploadFile({ apiKey, blob, mimeType, displayName, signal, onStatus }) {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: authHeaders(apiKey, {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ file: { display_name: displayName } }),
    signal
  });
  if (!start.ok) throw await errorFrom(start);
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new GeminiError('Gemini did not return an upload URL.');

  onStatus?.('Uploading video to Gemini…');
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: blob,
    signal
  });
  if (!upload.ok) throw await errorFrom(upload);
  let { file } = await upload.json();

  while (file.state === 'PROCESSING') {
    onStatus?.('Gemini is processing the video…');
    await sleep(3000, signal);
    const res = await fetch(`${API}/v1beta/${file.name}`, { headers: authHeaders(apiKey), signal });
    if (!res.ok) throw await errorFrom(res);
    file = await res.json();
  }
  if (file.state === 'FAILED') throw new GeminiError('Gemini could not process this video.');
  return file;
}
