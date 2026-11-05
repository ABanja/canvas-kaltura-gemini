// Service worker: keeps a per-tab registry of detected Kaltura players in
// chrome.storage.session (the side panel reads it from there), opens the side
// panel from the toolbar button, and registers content scripts for any extra
// Kaltura domains the user has granted access to.

const CUSTOM_SCRIPT_IDS = ['kga-bridge-custom', 'kga-content-custom'];
const tabKey = (tabId) => `tab:${tabId}`;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Serialize registry writes so reports from several frames can't clobber each other.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch(console.error);
  return queue;
}

async function updateFramePlayers(tabId, frameId, frameUrl, players) {
  const key = tabKey(tabId);
  const { [key]: current = {} } = await chrome.storage.session.get(key);
  const next = {};
  for (const [k, v] of Object.entries(current)) {
    if (v.frameId !== frameId) next[k] = v;
  }
  for (const p of players) {
    if (!p || typeof p.entryId !== 'string' || typeof p.playerId !== 'string') continue;
    next[`${frameId}:${p.playerId}`] = { ...p, frameId, tabId, frameUrl, updatedAt: Date.now() };
  }
  if (Object.keys(next).length) {
    await chrome.storage.session.set({ [key]: next });
  } else {
    await chrome.storage.session.remove(key);
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'KGA_PLAYERS' && sender.tab && Array.isArray(msg.players)) {
    const { id: tabId } = sender.tab;
    enqueue(() => updateFramePlayers(tabId, sender.frameId ?? 0, msg.frameUrl, msg.players));
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    enqueue(() => chrome.storage.session.remove(tabKey(tabId)));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => chrome.storage.session.remove(tabKey(tabId)));
});

// ---- Extra Kaltura domains (e.g. a university's branded MediaSpace/KAF host) ----

async function syncCustomContentScripts() {
  const { customDomains = [] } = await chrome.storage.local.get('customDomains');
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: CUSTOM_SCRIPT_IDS });
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  }

  const matches = [];
  for (const domain of customDomains) {
    const origin = `https://${domain}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
  }
  if (!matches.length) return;

  await chrome.scripting.registerContentScripts([
    {
      id: CUSTOM_SCRIPT_IDS[0],
      matches,
      js: ['content/kaltura-bridge.js'],
      world: 'MAIN',
      allFrames: true,
      runAt: 'document_idle'
    },
    {
      id: CUSTOM_SCRIPT_IDS[1],
      matches,
      js: ['content/kaltura-content.js'],
      allFrames: true,
      runAt: 'document_idle'
    }
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  syncCustomContentScripts().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.customDomains) {
    syncCustomContentScripts().catch(console.error);
  }
});

chrome.permissions.onRemoved.addListener(() => {
  syncCustomContentScripts().catch(console.error);
});
