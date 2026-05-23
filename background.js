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
  const existing = await chrome.storage.local.get(['letterboxdWidgetEnabled']);
  if (typeof existing.letterboxdWidgetEnabled === 'undefined') {
    await chrome.storage.local.set({ letterboxdWidgetEnabled: true });
  }
  chrome.tabs?.query?.({ url: ['https://letterboxd.com/'] }, tabs => {
    for (const tab of tabs || []) injectLetterboxdWidget(tab.id, tab.url);
  });
  const data = await chrome.storage.local.get(['syncConfig']);
  const config = data.syncConfig;
  if (config?.syncInterval > 0) {
    chrome.alarms.create('watchtracker-sync', { periodInMinutes: config.syncInterval });
  }
});


// ─── Letterboxd dice widget fallback injector ───
// Content scripts normally inject the widget. This fallback makes the dice appear
// even when the user enables/reloads the extension while Letterboxd is already open.
async function injectLetterboxdWidget(tabId, url) {
  try {
    if (!url || !/^https:\/\/letterboxd\.com\/?(?:[?#].*)?$/i.test(url)) return;
    const { letterboxdWidgetEnabled } = await chrome.storage.local.get(['letterboxdWidgetEnabled']);
    if (letterboxdWidgetEnabled === false) return;
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['letterboxd-widget.css'] }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId }, files: ['letterboxd-widget.js'] }).catch(() => {});
  } catch (_) {}
}

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete') injectLetterboxdWidget(tabId, tab.url || changeInfo.url);
});

chrome.tabs?.onActivated?.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    injectLetterboxdWidget(tabId, tab.url);
  } catch (_) {}
});

chrome.runtime?.onStartup?.addListener(() => {
  chrome.tabs?.query?.({ url: ['https://letterboxd.com/'] }, tabs => {
    for (const tab of tabs || []) injectLetterboxdWidget(tab.id, tab.url);
  });
});

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.letterboxdWidgetEnabled) return;
  chrome.tabs?.query?.({ url: ['https://letterboxd.com/'] }, tabs => {
    for (const tab of tabs || []) injectLetterboxdWidget(tab.id, tab.url);
  });
});
