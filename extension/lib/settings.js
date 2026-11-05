export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  model: 'gemini-2.5-flash',
  temperature: 0.4,
  preferredLanguage: 'en',
  maxUploadMb: 300,
  extraInstructions: '',
  customDomains: []
});

// Stored in chrome.storage.local (this device only), never storage.sync.
export function getSettings() {
  return chrome.storage.local.get({ ...DEFAULT_SETTINGS });
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}
