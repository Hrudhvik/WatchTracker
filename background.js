// Shared recommender for extension pages/content scripts. Best-effort: if a script fails
// to load, the fetch proxy and widget fallback still work.
try { importScripts('store.js', 'tmdb.js', 'sync.js', 'recommendations.js'); } catch (e) { console.warn('Background libraries unavailable', e); }

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

  if (msg.type === 'watchtracker:recommend') {
    (async () => {
      try {
        if (typeof Store === 'undefined' || typeof TMDB === 'undefined' || typeof Recommendations === 'undefined') {
          throw new Error('Recommendation engine is not available in the background worker.');
        }
        await Store.load();
        TMDB.setKey(Store.getApiKey());
        const filters = {
          source: 'new',
          type: 'movie',
          style: msg.filters?.style || 'random',
          count: Number(msg.filters?.count || 1),
          genre: msg.filters?.genre || '',
          language: msg.filters?.language || '',
          decade: msg.filters?.decade || '',
          minTmdbRating: msg.filters?.minTmdbRating || msg.filters?.rating || '',
          libraryMode: msg.filters?.includeWatched ? 'include_library' : 'new_only',
        };
        const result = await Recommendations.suggest(filters);
        sendResponse({ ok: true, body: result });
      } catch (err) {
        sendResponse({ ok: false, status: 0, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (msg.type === 'watchtracker:run-sync-now') {
    (async () => {
      const result = await runWatchTrackerBackgroundSync('manual', msg.source || 'all');
      sendResponse({ ok: !result.errors?.length, body: result });
    })();
    return true;
  }

  if (msg.type === 'watchtracker:refresh-sync-alarm') {
    (async () => {
      await ensureWatchTrackerAlarm();
      sendResponse({ ok: true });
    })();
    return true;
  }

});

async function ensureWatchTrackerAlarm() {
  try {
    const data = await chrome.storage.local.get(['syncConfig']);
    const mins = Number(data.syncConfig?.syncInterval || 0);
    await chrome.alarms.clear('watchtracker-sync');
    if (mins > 0) {
      // Chrome may clamp very small intervals; sync settings UI should still show the user value.
      chrome.alarms.create('watchtracker-sync', { periodInMinutes: Math.max(1, mins) });
    }
  } catch (err) {
    console.warn('[WatchTracker] Could not set auto-sync alarm', err);
  }
}

async function runWatchTrackerBackgroundSync(reason = 'alarm', source = 'all') {
  const startedAt = new Date().toISOString();
  const summary = { reason, source, startedAt, finishedAt: '', added: 0, updated: 0, skipped: 0, diaryAdded: 0, sources: {}, errors: [] };
  try {
    if (typeof Store === 'undefined' || typeof SyncEngine === 'undefined') throw new Error('Sync engine is not loaded in background worker.');
    await Store.load();
    if (Store.dedupeDiary) Store.dedupeDiary();
    await SyncEngine.loadConfig();
    if (typeof MalOAuth !== 'undefined') await MalOAuth.load();

    const cfg = SyncEngine.getConfig();
    const entries = [];

    if ((source === 'all' || source === 'letterboxd') && cfg.letterboxd) {
      try {
        const lb = await SyncEngine.syncLetterboxd(cfg.letterboxd);
        summary.sources.letterboxd = lb.length;
        entries.push(...lb);
      } catch (err) {
        summary.errors.push(`Letterboxd: ${err.message || String(err)}`);
      }
    }

    const canUseOfficialMal = typeof MalOAuth !== 'undefined' && MalOAuth.isLoggedIn && MalOAuth.isLoggedIn();
    if ((source === 'all' || source === 'mal') && canUseOfficialMal) {
      try {
        const mal = await MalOAuth.fetchAnimeList();
        summary.sources.mal = mal.length;
        entries.push(...mal);
      } catch (err) {
        summary.errors.push(`MAL OAuth: ${err.message || String(err)}`);
      }
    } else if ((source === 'all' || source === 'mal') && cfg.mal) {
      try {
        const mal = await SyncEngine.syncMal(cfg.mal);
        summary.sources.mal = mal.length;
        entries.push(...mal);
      } catch (err) {
        summary.errors.push(`MAL: ${err.message || String(err)}`);
      }
    }

    if (entries.length) {
      const matched = await SyncEngine.matchToTmdb(entries);
      const results = Array.isArray(matched) ? matched : (matched.results || []);
      const stats = await SyncEngine.applySyncResults(results, 'merge');
      Object.assign(summary, {
        added: stats.added || 0,
        updated: stats.updated || 0,
        skipped: stats.skipped || 0,
        diaryAdded: stats.diaryAdded || 0,
      });
      if (Store.dedupeDiary) summary.dedupe = Store.dedupeDiary();
    }

    summary.finishedAt = new Date().toISOString();
    await chrome.storage.local.set({ lastBackgroundSync: summary, lastBackgroundSyncError: null });
    return summary;
  } catch (err) {
    summary.finishedAt = new Date().toISOString();
    summary.errors.push(err.message || String(err));
    await chrome.storage.local.set({ lastBackgroundSync: summary, lastBackgroundSyncError: summary });
    return summary;
  }
}

// ─── Alarm: real periodic sync while the popup/full app tab is closed ───
chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name !== 'watchtracker-sync') return;
  await runWatchTrackerBackgroundSync('alarm');
});

chrome.runtime.onInstalled?.addListener(async () => {
  const existing = await chrome.storage.local.get(['letterboxdWidgetEnabled']);
  if (typeof existing.letterboxdWidgetEnabled === 'undefined') {
    await chrome.storage.local.set({ letterboxdWidgetEnabled: true });
  }
  chrome.tabs?.query?.({ url: ['https://letterboxd.com/'] }, tabs => {
    for (const tab of tabs || []) injectLetterboxdWidget(tab.id, tab.url);
  });
  await ensureWatchTrackerAlarm();
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
  ensureWatchTrackerAlarm();
  chrome.tabs?.query?.({ url: ['https://letterboxd.com/'] }, tabs => {
    for (const tab of tabs || []) injectLetterboxdWidget(tab.id, tab.url);
  });
});

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.syncConfig) ensureWatchTrackerAlarm();
  if (!changes.letterboxdWidgetEnabled) return;
  chrome.tabs?.query?.({ url: ['https://letterboxd.com/'] }, tabs => {
    for (const tab of tabs || []) injectLetterboxdWidget(tab.id, tab.url);
  });
});
