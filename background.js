/* ═══════════════════════════════════════════
   Background Service Worker — Fetch Proxy + Auto Sync
   All cross-origin fetches go through here to bypass CORS.
   ═══════════════════════════════════════════ */

// ─── Fetch Proxy: extension pages send messages here ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch') {
    (async () => {
      try {
        const res = await fetch(msg.url, msg.options || {});
        const contentType = res.headers.get('content-type') || '';
        let body;
        if (contentType.includes('json')) {
          body = await res.json();
        } else {
          body = await res.text();
        }
        sendResponse({ ok: res.ok, status: res.status, body });
      } catch (err) {
        sendResponse({ ok: false, status: 0, error: err.message });
      }
    })();
    return true; // keep message channel open for async response
  }
});

// ─── Alarm: periodic sync reminder ───
chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name !== 'watchtracker-sync') return;
  // Alarm fires but no badge — sync happens when user opens the app
});

chrome.runtime.onInstalled?.addListener(async () => {
  const data = await chrome.storage.local.get(['syncConfig']);
  const config = data.syncConfig;
  if (config?.syncInterval > 0) {
    chrome.alarms.create('watchtracker-sync', { periodInMinutes: config.syncInterval });
  }
});
