// Isolated-world content script in Kaltura player frames. Relays player reports
// from kaltura-bridge.js to the background worker, and relays commands from the
// side panel (seek, current time) back to the bridge.
(() => {
  if (window.__kgaContentLoaded) return;
  window.__kgaContentLoaded = true;

  const COMMAND_TIMEOUT_MS = 3000;
  const pending = new Map();
  let seq = 0;
  let reportedAny = false;

  function report(players) {
    chrome.runtime
      .sendMessage({ type: 'KGA_PLAYERS', players, frameUrl: location.href })
      .catch(() => {});
  }

  document.addEventListener('kga:players', (event) => {
    let players;
    try {
      players = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (!Array.isArray(players)) return;
    // Frames without a player stay silent instead of flooding the registry.
    if (!players.length && !reportedAny) return;
    reportedAny = true;
    report(players);
  });

  document.addEventListener('kga:response', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.detail);
    } catch {
      return;
    }
    const resolve = msg && pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  function command(cmd, payload) {
    return new Promise((resolve) => {
      const id = `c${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: 'The video player did not respond.' });
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      document.dispatchEvent(
        new CustomEvent('kga:command', { detail: JSON.stringify({ id, cmd, ...payload }) })
      );
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'KGA_COMMAND') return false;
    command(msg.cmd, { playerId: msg.playerId, time: msg.time }).then(sendResponse);
    return true;
  });

  // Tell the background this frame's players are gone when it navigates away.
  window.addEventListener('pagehide', () => {
    if (reportedAny) report([]);
  });

  // Ask the bridge to (re)send its current player list, in case it scanned first.
  document.dispatchEvent(new CustomEvent('kga:hello'));
})();
