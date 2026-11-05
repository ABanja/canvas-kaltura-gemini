// Runs in the page's own JavaScript world (world: "MAIN") inside Kaltura player
// frames, which is the only place the player objects are reachable. It reports the
// players it finds and executes seek/state commands. It talks to
// kaltura-content.js through DOM CustomEvents carrying JSON strings, because
// object payloads do not survive the crossing between JavaScript worlds.
(() => {
  if (window.__kgaBridgeLoaded) return;
  window.__kgaBridgeLoaded = true;

  const EVT_HELLO = 'kga:hello';
  const EVT_PLAYERS = 'kga:players';
  const EVT_COMMAND = 'kga:command';
  const EVT_RESPONSE = 'kga:response';
  const SCAN_INTERVAL_MS = 2000;

  const ENTRY_RE = /entry_?id[=/]([0-9]_[a-z0-9]{8})/i;
  const PARTNER_RE = /(?:\/p\/|partner_?id[=/]|wid[=/]_)(\d+)/i;

  let adapters = [];
  let lastJson = '';

  function safe(fn, fallback = null) {
    try {
      const value = fn();
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function urlPartnerId() {
    const m = decodeURIComponent(location.href).match(PARTNER_RE);
    return m ? m[1] : null;
  }

  function normalizeServiceUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let u = url.trim();
    if (u.startsWith('//')) u = 'https:' + u;
    if (!/^https:\/\//i.test(u)) return null;
    u = u.replace(/\/+$/, '');
    if (!/\/api_v3$/i.test(u)) u += '/api_v3';
    return u;
  }

  function looksLikeKs(value) {
    return typeof value === 'string' && value.length > 20 && !value.startsWith('{');
  }

  function firstVideo() {
    return document.querySelector('video');
  }

  // Kaltura Player v7 (PlayKit JS). KalturaPlayer.getPlayers() returns {targetId: player}.
  function playkitAdapters() {
    const map = safe(() => window.KalturaPlayer.getPlayers());
    if (!map || typeof map !== 'object') return [];
    return Object.entries(map)
      .filter(([, p]) => p)
      .map(([targetId, p]) => ({
        id: `v7:${targetId}`,
        describe() {
          const cfg = safe(() => p.config, {});
          const provider = cfg.provider || {};
          const sources = safe(() => p.sources) || cfg.sources || {};
          const metadata = sources.metadata || {};
          const captions = Array.isArray(sources.captions) ? sources.captions : [];
          return {
            kind: 'playkit',
            entryId: sources.id || null,
            partnerId: provider.partnerId ? String(provider.partnerId) : urlPartnerId(),
            ks: looksLikeKs(provider.ks) ? provider.ks : null,
            serviceUrl: normalizeServiceUrl(safe(() => provider.env.serviceUrl)),
            title: metadata.name || document.title || null,
            description: metadata.description || null,
            duration: Number(safe(() => p.duration)) || Number(sources.duration) || null,
            captions: captions
              .filter((c) => c && typeof c.url === 'string' && /^https:/i.test(c.url))
              .map((c) => ({
                url: c.url,
                language: c.language || '',
                label: c.label || c.language || 'Captions',
                format: c.type || ''
              }))
          };
        },
        getTime: () => Number(p.currentTime) || 0,
        seek(t) {
          p.currentTime = t;
        }
      }));
  }

  // Legacy Kaltura HTML5 player (html5lib / "v2") iframe embeds.
  function html5libAdapters() {
    const data = window.kalturaIframePackageData;
    const meta = safe(() => data.entryResult.meta);
    if (!meta || !meta.id) return [];
    const el = () => (data.playerId && document.getElementById(data.playerId)) || null;
    return [
      {
        id: `v2:${data.playerId || 'player'}`,
        describe() {
          const ks = safe(() => el().evaluate('{configProxy.flashvars.ks}'));
          return {
            kind: 'html5lib',
            entryId: meta.id,
            partnerId: meta.partnerId ? String(meta.partnerId) : urlPartnerId(),
            ks: looksLikeKs(ks) ? ks : null,
            serviceUrl: normalizeServiceUrl(safe(() => window.mw.getConfig('Kaltura.ServiceUrl'))),
            title: meta.name || document.title || null,
            description: meta.description || null,
            duration: Number(meta.duration) || null,
            captions: []
          };
        },
        getTime() {
          const t = Number(safe(() => el().evaluate('{video.player.currentTime}')));
          return Number.isFinite(t) ? t : Number(safe(() => firstVideo().currentTime, 0));
        },
        seek(t) {
          const player = el();
          if (player && typeof player.sendNotification === 'function') {
            player.sendNotification('doSeek', t);
          } else if (firstVideo()) {
            firstVideo().currentTime = t;
          }
        }
      }
    ];
  }

  // Last resort: a plain <video> element in a frame whose URL names a Kaltura entry.
  function genericAdapters() {
    const video = firstVideo();
    const m = decodeURIComponent(location.href).match(ENTRY_RE);
    if (!video || !m) return [];
    return [
      {
        id: 'html5:video',
        describe: () => ({
          kind: 'html5',
          entryId: m[1],
          partnerId: urlPartnerId(),
          ks: null,
          serviceUrl: null,
          title: document.title || null,
          description: null,
          duration: Number(video.duration) || null,
          captions: []
        }),
        getTime: () => Number(video.currentTime) || 0,
        seek(t) {
          video.currentTime = t;
        }
      }
    ];
  }

  function scan() {
    let found = playkitAdapters();
    if (!found.length) found = html5libAdapters();
    if (!found.length) found = genericAdapters();
    adapters = found;

    const players = found
      .map((a) => ({ playerId: a.id, ...safe(() => a.describe(), {}) }))
      .filter((p) => p.entryId);
    const json = JSON.stringify(players);
    if (json !== lastJson) {
      lastJson = json;
      document.dispatchEvent(new CustomEvent(EVT_PLAYERS, { detail: json }));
    }
  }

  function respond(id, result) {
    document.dispatchEvent(new CustomEvent(EVT_RESPONSE, { detail: JSON.stringify({ id, ...result }) }));
  }

  document.addEventListener(EVT_HELLO, () => {
    lastJson = '';
    scan();
  });

  document.addEventListener(EVT_COMMAND, (event) => {
    let msg;
    try {
      msg = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.cmd === 'rescan') {
      lastJson = '';
      scan();
      respond(msg.id, { ok: true });
      return;
    }

    const adapter = adapters.find((a) => a.id === msg.playerId) || adapters[0];
    if (!adapter) {
      respond(msg.id, { ok: false, error: 'Player not found in this frame.' });
      return;
    }
    try {
      if (msg.cmd === 'seek') {
        const t = Number(msg.time);
        if (!Number.isFinite(t) || t < 0) throw new Error('Invalid time.');
        adapter.seek(t);
        respond(msg.id, { ok: true });
      } else if (msg.cmd === 'state') {
        respond(msg.id, { ok: true, currentTime: adapter.getTime() });
      } else {
        respond(msg.id, { ok: false, error: `Unknown command: ${msg.cmd}` });
      }
    } catch (err) {
      respond(msg.id, { ok: false, error: String((err && err.message) || err) });
    }
  });

  scan();
  setInterval(scan, SCAN_INTERVAL_MS);
})();
