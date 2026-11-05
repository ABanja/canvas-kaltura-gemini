// Kaltura API v3 helpers. Requests use the Kaltura Session (KS) that the player
// itself was given, so they only reach what the signed-in student can already see.
// Without one, a widget session is started (works for publicly viewable entries).

export const DEFAULT_SERVICE_URL = 'https://cdnapisec.kaltura.com/api_v3';
const ASSET_STATUS_READY = 2;

export class KalturaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KalturaError';
  }
}

function serviceUrlFor(player) {
  return player.serviceUrl || DEFAULT_SERVICE_URL;
}

async function call(player, service, action, params = {}, signal) {
  const url = `${serviceUrlFor(player)}/service/${service}/action/${action}`;
  const body = new URLSearchParams({ format: '1', ...params });
  const res = await fetch(url, { method: 'POST', body, signal });
  if (!res.ok) throw new KalturaError(`Kaltura ${service}.${action} failed (HTTP ${res.status}).`);
  const json = await res.json();
  if (json && json.objectType === 'KalturaAPIException') {
    throw new KalturaError(`Kaltura: ${json.message || json.code}`);
  }
  return json;
}

/** Returns a KS for the player, starting a widget session if the player had none. */
export async function ensureKs(player, signal) {
  if (player.ks) return player.ks;
  if (!player.partnerId) throw new KalturaError('Could not determine the Kaltura partner ID.');
  const result = await call(player, 'session', 'startWidgetSession', { widgetId: `_${player.partnerId}` }, signal);
  player.ks = result.ks;
  return player.ks;
}

/** Caption assets on the entry: [{ id, language, label, format, isDefault }]. */
export async function listCaptionAssets(player, signal) {
  const ks = await ensureKs(player, signal);
  const result = await call(
    player,
    'caption_captionasset',
    'list',
    { ks, 'filter:objectType': 'KalturaAssetFilter', 'filter:entryIdEqual': player.entryId, 'pager:pageSize': '100' },
    signal
  );
  return (result.objects || [])
    .filter((a) => a.status === undefined || a.status === ASSET_STATUS_READY)
    .map((a) => ({
      assetId: a.id,
      language: a.language || a.languageCode || '',
      label: a.label || a.language || 'Captions',
      format: String(a.format || ''),
      isDefault: a.isDefault === true || a.isDefault === 1
    }));
}

/** Raw caption file text (SRT, WebVTT or DFXP) for a track from the player or the API. */
export async function fetchCaptionText(player, track, signal) {
  let url;
  if (track.url) {
    url = track.url;
  } else {
    const ks = await ensureKs(player, signal);
    const params = new URLSearchParams({ captionAssetId: track.assetId, ks });
    url = `${serviceUrlFor(player)}/service/caption_captionasset/action/serve?${params}`;
  }
  if (!/^https:\/\//i.test(url)) throw new KalturaError('Refusing to load captions over an insecure URL.');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new KalturaError(`Could not download captions (HTTP ${res.status}).`);
  const text = await res.text();
  if (/"objectType"\s*:\s*"KalturaAPIException"/.test(text)) {
    throw new KalturaError('Kaltura refused access to these captions.');
  }
  return text;
}

/** Entry metadata (name, description, duration), best effort. */
export async function getEntry(player, signal) {
  const ks = await ensureKs(player, signal);
  const entry = await call(player, 'baseentry', 'get', { ks, entryId: player.entryId }, signal);
  return { name: entry.name || null, description: entry.description || null, duration: entry.duration || null };
}

/** Picks the smallest ready MP4 rendition, preferring ones that have video. */
export async function findSmallestMp4Flavor(player, signal) {
  const ks = await ensureKs(player, signal);
  const result = await call(
    player,
    'flavorasset',
    'list',
    { ks, 'filter:entryIdEqual': player.entryId, 'pager:pageSize': '100' },
    signal
  );
  const candidates = (result.objects || []).filter(
    (f) =>
      f.status === ASSET_STATUS_READY &&
      f.size > 0 &&
      (String(f.fileExt).toLowerCase() === 'mp4' || /mp4|isom|qt/i.test(String(f.containerFormat || '')))
  );
  if (!candidates.length) throw new KalturaError('No downloadable MP4 version of this video was found.');
  candidates.sort((a, b) => (b.height > 0) - (a.height > 0) || a.size - b.size);
  const f = candidates[0];
  return { flavorId: f.id, sizeBytes: f.size * 1024, height: f.height || 0 };
}

export async function getFlavorUrl(player, flavorId, signal) {
  const ks = await ensureKs(player, signal);
  const url = await call(player, 'flavorasset', 'getUrl', { ks, id: flavorId }, signal);
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new KalturaError('Kaltura did not return a download URL for this video.');
  }
  return url.replace(/^http:/i, 'https:');
}
