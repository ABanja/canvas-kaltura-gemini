import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../lib/settings.js';
import { listModels } from '../lib/gemini.js';

const $ = (id) => document.getElementById(id);
const fields = {
  apiKey: $('apiKey'),
  model: $('model'),
  temperature: $('temperature'),
  preferredLanguage: $('preferredLanguage'),
  maxUploadMb: $('maxUploadMb'),
  extraInstructions: $('extraInstructions'),
  customDomains: $('customDomains')
};

const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/i;

function setHint(el, text, kind = '') {
  el.textContent = text;
  el.className = `hint ${kind}`;
}

function parseDomains(text) {
  const domains = [];
  const invalid = [];
  for (const raw of text.split(/[\s,]+/)) {
    const d = raw
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (!d) continue;
    if (DOMAIN_RE.test(d)) domains.push(d);
    else invalid.push(raw);
  }
  return { domains: [...new Set(domains)], invalid };
}

async function load() {
  const s = await getSettings();
  fields.apiKey.value = s.apiKey;
  fields.model.value = s.model;
  fields.temperature.value = String(s.temperature);
  fields.preferredLanguage.value = s.preferredLanguage;
  fields.maxUploadMb.value = String(s.maxUploadMb);
  fields.extraInstructions.value = s.extraInstructions;
  fields.customDomains.value = s.customDomains.join('\n');
  $('temperatureValue').textContent = String(s.temperature);
}

$('toggleKey').addEventListener('click', () => {
  const show = fields.apiKey.type === 'password';
  fields.apiKey.type = show ? 'text' : 'password';
  $('toggleKey').textContent = show ? 'Hide' : 'Show';
});

fields.temperature.addEventListener('input', () => {
  $('temperatureValue').textContent = fields.temperature.value;
});

$('testKey').addEventListener('click', async () => {
  const status = $('testStatus');
  const apiKey = fields.apiKey.value.trim();
  if (!apiKey) {
    setHint(status, 'Enter an API key first.', 'error');
    return;
  }
  setHint(status, 'Checking…');
  try {
    const models = await listModels(apiKey);
    $('modelList').replaceChildren(
      ...models.map((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.label = m.displayName;
        return opt;
      })
    );
    const current = fields.model.value.trim();
    const known = models.some((m) => m.id === current);
    setHint(
      status,
      `Key works. ${models.length} models available${known ? '' : ` — note: “${current}” is not one of them`}. Click the model box to pick one.`,
      known ? 'ok' : 'error'
    );
  } catch (err) {
    setHint(status, `Key check failed: ${err.message}`, 'error');
  }
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('saveStatus');
  const { domains, invalid } = parseDomains(fields.customDomains.value);
  if (invalid.length) {
    setHint(status, `Not a valid domain: ${invalid.join(', ')}`, 'error');
    return;
  }

  // Must run first, while the click still counts as a user gesture.
  let granted = true;
  if (domains.length) {
    granted = await chrome.permissions
      .request({ origins: domains.map((d) => `https://${d}/*`) })
      .catch(() => false);
  }

  const maxUploadMb = Math.min(2000, Math.max(10, Number(fields.maxUploadMb.value) || DEFAULT_SETTINGS.maxUploadMb));
  await saveSettings({
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim().replace(/^models\//, '') || DEFAULT_SETTINGS.model,
    temperature: Number(fields.temperature.value),
    preferredLanguage: fields.preferredLanguage.value.trim(),
    maxUploadMb,
    extraInstructions: fields.extraInstructions.value,
    customDomains: domains
  });
  fields.maxUploadMb.value = String(maxUploadMb);
  fields.customDomains.value = domains.join('\n');
  setHint(
    status,
    granted ? 'Saved.' : 'Saved, but access to the extra domains was not granted, so they will be ignored.',
    granted ? 'ok' : 'error'
  );
});

load();
