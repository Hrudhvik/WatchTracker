/* ═══════════════════════════════════════════
   WatchTracker v3 — Main App Controller
   ═══════════════════════════════════════════ */

let currentView = 'watchlist';

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function toast(msg) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; }, 2400);
  setTimeout(() => t.remove(), 2700);
}

const App = {
  showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    const page = document.getElementById(`page-${name}`);
    if (page) page.classList.add('active-page');
    if (name === 'watchlist') ListUI.render();
    else if (name === 'profile') ProfileUI.render();
    else if (name === 'diary') DiaryUI.render();
  },
  refreshCounts() {
    const total = Store.getMovies().length + Store.getTvShows().length;
    document.getElementById('totalCount').textContent = total;
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  await Store.load();

  const key = Store.getApiKey();
  if (key) { TMDB.setKey(key); document.getElementById('apiKeyInput').value = key; }

  App.refreshCounts();
  ListUI.init();
  ListUI.render();

  // Apply saved theme
  ThemeEngine.init();

  // Hash routing from popup
  const hash = window.location.hash;
  if (hash === '#settings') {
    document.getElementById('settingsModal').classList.remove('hidden');
  } else if (hash.startsWith('#detail-')) {
    const parts = hash.replace('#detail-', '').split('-');
    const type = parts[0], id = parseInt(parts[1]);
    if (id && type) DetailUI.open(id, type);
  }

  if (!key) document.getElementById('settingsModal').classList.remove('hidden');


  // ─── Sidebar Nav ───
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      App.showPage(currentView);
    });
  });

  // ─── Search Overlay ───
  const overlay = document.getElementById('searchOverlay');
  const overlayInput = document.getElementById('overlaySearchInput');
  const overlayResults = document.getElementById('overlayResults');
  const sidebarInput = document.getElementById('globalSearch');
  let searchTimeout = null;

  function openSearch() {
    overlay.classList.remove('hidden');
    overlayInput.value = '';
    overlayResults.innerHTML = '<div class="overlay-msg">Type to search TMDB for movies and TV shows</div>';
    setTimeout(() => overlayInput.focus(), 50);
  }
  function closeSearch() { overlay.classList.add('hidden'); overlayInput.value = ''; overlayResults.innerHTML = ''; }

  sidebarInput.addEventListener('focus', () => { openSearch(); sidebarInput.blur(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape') {
      if (!overlay.classList.contains('hidden')) closeSearch();
      if (!document.getElementById('settingsModal').classList.contains('hidden')) document.getElementById('settingsModal').classList.add('hidden');
    }
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });

  overlayInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = overlayInput.value.trim();
    if (!query) { overlayResults.innerHTML = '<div class="overlay-msg">Type to search TMDB for movies and TV shows</div>'; return; }
    if (!TMDB.getKey()) { overlayResults.innerHTML = '<div class="overlay-msg">Set your TMDB API key in Settings first</div>'; return; }
    overlayResults.innerHTML = '<div class="overlay-msg">Searching...</div>';

    searchTimeout = setTimeout(async () => {
      try {
        const results = await TMDB.search(query);
        if (!results.length) { overlayResults.innerHTML = '<div class="overlay-msg">No results found</div>'; return; }

        overlayResults.innerHTML = results.slice(0, 10).map(r => {
          const isM = r.media_type === 'movie';
          const title = isM ? r.title : r.name;
          const date = isM ? r.release_date : r.first_air_date;
          const yr = (date || '').substring(0, 4);
          const poster = TMDB.poster(r.poster_path, 'w92');
          const inList = isM ? Store.hasMovie(r.id) : Store.hasTvShow(r.id);
          return `
            <div class="overlay-result-item" data-id="${r.id}" data-type="${r.media_type}">
              ${poster ? `<img src="${poster}">` : `<img src="" style="background:var(--bg-3);">`}
              <div class="overlay-result-info">
                <div class="overlay-result-title">${esc(title)}</div>
                <div class="overlay-result-sub">${yr}${r.vote_average ? ` · ${r.vote_average.toFixed(1)}` : ''}</div>
              </div>
              <span class="overlay-type-badge overlay-type-${isM ? 'movie' : 'tv'}">${isM ? 'Movie' : 'TV'}</span>
              ${inList ? `<button class="overlay-add-btn added" disabled>In List</button>` : `<button class="overlay-add-btn" data-action="quick-add">+ Add</button>`}
            </div>`;
        }).join('');

        overlayResults.querySelectorAll('.overlay-result-item').forEach(item => {
          const addBtn = item.querySelector('[data-action="quick-add"]');
          if (addBtn) {
            addBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const id = parseInt(item.dataset.id), type = item.dataset.type;
              try {
                if (type === 'movie') {
                  const d = await TMDB.movieDetails(id);
                  Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.release_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, runtime: d.runtime || 0, genres: (d.genres || []).map(g => g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
                  Store.addActivity({ tmdbId: d.id, title: d.title, type: 'movie', posterPath: d.poster_path, action: 'added', detail: 'Added to list', timestamp: new Date().toISOString() });
                  toast(`Added "${d.title}"`);
                } else {
                  const d = await TMDB.tvDetails(id);
                  const ss = (d.seasons || []).filter(s => s.season_number > 0);
                  Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.first_air_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0, genres: (d.genres || []).map(g => g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s => ({ seasonNumber: s.season_number, episodeCount: s.episode_count || 0, episodesWatched: 0, posterPath: s.poster_path })), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
                  Store.addActivity({ tmdbId: d.id, title: d.name, type: 'tv', posterPath: d.poster_path, action: 'added', detail: 'Added to list', timestamp: new Date().toISOString() });
                  toast(`Added "${d.name}"`);
                }
                App.refreshCounts();
                addBtn.textContent = 'In List'; addBtn.classList.add('added'); addBtn.disabled = true;
              } catch (err) { toast('Failed: ' + err.message); }
            });
          }
          item.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="quick-add"]')) return;
            closeSearch();
            DetailUI.open(parseInt(item.dataset.id), item.dataset.type);
          });
        });
      } catch (err) { overlayResults.innerHTML = `<div class="overlay-msg" style="color:var(--dropped)">Error: ${err.message}</div>`; }
    }, 350);
  });

  // ─── Settings ───
  document.getElementById('settingsBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.remove('hidden'));
  document.getElementById('closeSettings').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
  document.getElementById('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') document.getElementById('settingsModal').classList.add('hidden'); });

  document.getElementById('saveApiKey').addEventListener('click', () => {
    const k = document.getElementById('apiKeyInput').value.trim();
    if (!k) { toast('Enter an API key'); return; }
    Store.setApiKey(k); TMDB.setKey(k); toast('API key saved!');
    document.getElementById('settingsModal').classList.add('hidden');
  });

  document.getElementById('toggleKeyVis').addEventListener('click', () => {
    const inp = document.getElementById('apiKeyInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('toggleMalKeyVis').addEventListener('click', () => {
    const inp = document.getElementById('malClientId');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([Store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `watchtracker-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    toast('Full backup exported');
  });

  document.getElementById('exportCSVBtn').addEventListener('click', () => {
    const csv = ImportExport.exportWatchlistCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `watchtracker-watchlist-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast('Watchlist CSV exported');
  });

  document.getElementById('exportDiaryCSVBtn').addEventListener('click', () => {
    const csv = ImportExport.exportDiaryCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `watchtracker-diary-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast('Diary CSV exported');
  });

  document.getElementById('exportLetterboxdBtn').addEventListener('click', () => {
    const csv = ImportExport.exportLetterboxdCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `letterboxd-import-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast('Letterboxd-compatible CSV exported');
  });

  // ─── JSON Import ───
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (mode === 'replace' && !confirm('This will replace ALL your data. Continue?')) return;
        const c = Store.importAll(reader.result, mode);
        App.refreshCounts(); ListUI.render();
        toast(`Imported: ${c.movies} movies, ${c.tvshows} TV shows, ${c.diary} diary entries`);
      } catch { toast('Import failed — invalid JSON file'); }
    };
    reader.readAsText(file); e.target.value = '';
  });


  // ═══════════════════════════════════════════
  // IMPORT / SYNC TASK QUEUE — one job at a time
  // ═══════════════════════════════════════════
  const _taskQueue = [];
  let _taskRunning = false;
  const _importSyncBtns = ['importLetterboxdBtn', 'importMalXmlBtn', 'lbSyncBtn', 'malSyncBtn', 'importBtn'];

  function _disableImportBtns() {
    _importSyncBtns.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = true; el.classList.add('btn-disabled'); }
    });
  }
  function _enableImportBtns() {
    _importSyncBtns.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = false; el.classList.remove('btn-disabled'); }
    });
  }

  async function enqueueTask(label, taskFn) {
    if (_taskRunning) {
      toast('Another import/sync is in progress — please wait');
      return;
    }
    _taskRunning = true;
    _disableImportBtns();
    window.addEventListener('beforeunload', _beforeUnloadWarn);
    showSyncProgress(label);
    try {
      await taskFn();
      SyncEngine.clearImportState();
    } catch (err) {
      // Show the error if the task didn't already toast it
      console.error('[WatchTracker]', label, 'failed:', err);
    } finally {
      hideSyncProgress();
      _taskRunning = false;
      _enableImportBtns();
      window.removeEventListener('beforeunload', _beforeUnloadWarn);
      App.refreshCounts();
      ListUI.render();
    }
  }

  function _beforeUnloadWarn(e) {
    e.preventDefault();
    e.returnValue = '';
  }

  // ─── Resume pending import if tab was closed mid-apply ───
  (async () => {
    const pending = await SyncEngine.getPendingImport();
    if (pending && pending.results && pending.results.length) {
      const age = Date.now() - new Date(pending.savedAt).getTime();
      // Only resume if saved less than 1 hour ago
      if (age < 60 * 60 * 1000) {
        const doResume = confirm(`A ${pending.label} import was interrupted. Resume applying ${pending.results.length} matched entries?`);
        if (doResume) {
          await enqueueTask('Resuming ' + pending.label, async () => {
            updateSyncProgress(5, `Resuming ${pending.results.length} entries...`);
            const stats = await SyncEngine.applySyncResults(pending.results, pending.mode || 'merge', (i, t, title) => {
              updateSyncProgress(5 + (i / t * 95), `Adding: ${title} (${i}/${t})`);
            });
            toast(`Resumed: +${stats.added} added, ${stats.updated} updated, ${stats.skipped} skipped`);
          });
        } else {
          SyncEngine.clearImportState();
        }
      } else {
        SyncEngine.clearImportState();
      }
    }
  })();

  // ─── Letterboxd CSV/ZIP Import ───
  document.getElementById('importLetterboxdBtn').addEventListener('click', () => document.getElementById('importLbCsvFile').click());
  document.getElementById('importLbCsvFile').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files); if (!files.length) return;
    e.target.value = '';
    if (!TMDB.getKey()) { toast('Set your TMDB API key first'); return; }

    await enqueueTask('Importing Letterboxd', async () => {
      try {
        await ImportExport.processLetterboxdFiles(files, (c, t, msg) => {
          updateSyncProgress(Math.floor((c / t) * 100), msg);
        });
        toast('Letterboxd import complete!');
      } catch (err) {
        toast('Letterboxd import failed: ' + err.message);
      }
    });
  });

  // ─── MAL XML Import (supports .xml and .gz) ───
  document.getElementById('importMalXmlBtn').addEventListener('click', () => document.getElementById('importMalXmlFile').click());
  document.getElementById('importMalXmlFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    if (!TMDB.getKey()) { toast('Set your TMDB API key first'); return; }

    await enqueueTask('Importing MAL', async () => {
      updateSyncProgress(2, 'Reading file...');
      const entries = await ImportExport.parseMalFile(file);
      if (!entries.length) { toast('No entries found in XML'); return; }
      const movieCount = entries.filter(e => e.type === 'movie').length;
      const tvCount = entries.filter(e => e.type === 'tv').length;
      updateSyncProgress(5, `Parsed ${entries.length} entries (${tvCount} TV, ${movieCount} movies). Matching...`);
      const { results, matched } = await SyncEngine.matchToTmdb(entries, (i, t, title) => {
        updateSyncProgress(5 + (i / t * 70), `Matching: ${title} (${i}/${t})`);
      });
      // Save state so apply can resume if tab is closed
      SyncEngine.saveImportState('MAL', results, 'merge');
      updateSyncProgress(75, `Matched ${matched}/${entries.length}. Applying to library...`);
      const stats = await SyncEngine.applySyncResults(results, 'merge', (i, t, title) => {
        updateSyncProgress(75 + (i / t * 25), `Adding: ${title} (${i}/${t})`);
      });
      toast(`MAL: +${stats.added} added, ${stats.updated} updated, ${stats.skipped} skipped`);
    });
  });

  // ─── Clear All Data ───
  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (_taskRunning) { toast('Wait for the current import to finish'); return; }
    if (!confirm('Are you sure? This will permanently delete ALL your data.')) return;
    if (!confirm('Really? This cannot be undone.')) return;
    Store.clearAll();
    App.refreshCounts(); ListUI.render();
    toast('All data cleared');
  });


  // ─── Data Management Accordion ───
  document.getElementById('dataToggle').addEventListener('click', () => {
    const panel = document.getElementById('dataPanel');
    const arrow = document.getElementById('dataArrow');
    panel.classList.toggle('open');
    arrow.classList.toggle('open');
  });

  // ─── External Sync ───
  document.getElementById('syncToggle').addEventListener('click', () => {
    const panel = document.getElementById('syncPanel');
    const arrow = document.getElementById('syncArrow');
    panel.classList.toggle('open');
    arrow.classList.toggle('open');
  });

  // Load sync config
  await SyncEngine.loadConfig();
  await MalOAuth.load();
  const syncCfg = SyncEngine.getConfig();
  document.getElementById('lbUsername').value = syncCfg.letterboxd || '';
  document.getElementById('syncInterval').value = syncCfg.syncInterval || '0';
  document.getElementById('malEnglishTitles').checked = syncCfg.malUseEnglishTitles || false;
  document.getElementById('malClientId').value = MalOAuth.getClientId() || '';
  document.getElementById('malRedirectUri').textContent = MalOAuth.getRedirectUri();
  updateMalLoginState();
  updateSyncTimestamps();

  // Save usernames & interval
  document.getElementById('saveUsernames').addEventListener('click', () => {
    SyncEngine.setLetterboxd(document.getElementById('lbUsername').value);
    SyncEngine.setSyncInterval(parseInt(document.getElementById('syncInterval').value) || 0);
    toast('Sync settings saved');
  });

  // English titles checkbox
  document.getElementById('malEnglishTitles').addEventListener('change', (e) => {
    SyncEngine.setMalUseEnglishTitles(e.target.checked);
  });

  // Letterboxd Sync
  document.getElementById('lbSyncBtn').addEventListener('click', async () => {
    const username = document.getElementById('lbUsername').value.trim();
    if (!username) { toast('Enter your Letterboxd username'); return; }
    if (!TMDB.getKey()) { toast('Set your TMDB API key first'); return; }
    SyncEngine.setLetterboxd(username);
    const statusEl = document.getElementById('lbSyncStatus');

    await enqueueTask('Syncing Letterboxd', async () => {
      statusEl.textContent = 'Syncing...';
      statusEl.className = 'sync-status syncing';
      try {
        updateSyncProgress(10, 'Fetching Letterboxd RSS feed...');
        const entries = await SyncEngine.syncLetterboxd(username);
        if (!entries.length) { statusEl.textContent = 'No entries'; statusEl.className = 'sync-status'; toast('No entries in Letterboxd feed'); return; }
        updateSyncProgress(20, `Found ${entries.length} entries. Matching to TMDB...`);
        const { results, matched } = await SyncEngine.matchToTmdb(entries, (i, t, title) => {
          updateSyncProgress(20 + (i / t * 55), `Matching: ${title} (${i}/${t})`);
        });
        updateSyncProgress(75, `Matched ${matched}/${entries.length}. Applying to library...`);
        SyncEngine.saveImportState('Letterboxd', results, 'merge');
        const stats = await SyncEngine.applySyncResults(results, 'merge', (i, t, title) => {
          updateSyncProgress(75 + (i / t * 25), `Adding: ${title} (${i}/${t})`);
        });
        statusEl.textContent = 'Synced';
        statusEl.className = 'sync-status synced';
        updateSyncTimestamps();
        toast(`Letterboxd: +${stats.added} added, ${stats.diaryAdded} diary entries`);
      } catch (err) {
        statusEl.textContent = 'Error';
        statusEl.className = 'sync-status sync-error';
        toast('Letterboxd sync: ' + (err.message || 'Unknown error'));
      }
    });
  });

  // MAL Client ID — save on change
  document.getElementById('malClientId').addEventListener('change', () => {
    MalOAuth.setClientId(document.getElementById('malClientId').value);
  });

  // MAL Login
  document.getElementById('malLoginBtn').addEventListener('click', async () => {
    const clientId = document.getElementById('malClientId').value.trim();
    if (!clientId) { toast('Enter your MAL Client ID first'); return; }
    MalOAuth.setClientId(clientId);
    const statusEl = document.getElementById('malSyncStatus');
    try {
      statusEl.textContent = 'Logging in...';
      statusEl.className = 'sync-status syncing';
      const username = await MalOAuth.login();
      statusEl.textContent = 'Logged in';
      statusEl.className = 'sync-status synced';
      toast('Logged in to MAL as ' + username);
      updateMalLoginState();
    } catch (err) {
      statusEl.textContent = 'Login failed';
      statusEl.className = 'sync-status sync-error';
      toast('MAL login failed: ' + err.message);
    }
  });

  // MAL Logout
  document.getElementById('malLogoutBtn').addEventListener('click', () => {
    MalOAuth.logout();
    document.getElementById('malSyncStatus').textContent = '';
    document.getElementById('malSyncStatus').className = 'sync-status';
    updateMalLoginState();
    toast('Logged out of MAL');
  });

  function updateMalLoginState() {
    const loggedIn = MalOAuth.isLoggedIn();
    document.getElementById('malLoginBtn').style.display = loggedIn ? 'none' : '';
    document.getElementById('malLogoutBtn').style.display = loggedIn ? '' : 'none';
    document.getElementById('malSyncBtn').disabled = !loggedIn;
    document.getElementById('malSyncBtn').classList.toggle('btn-disabled', !loggedIn);
    const infoEl = document.getElementById('malUserInfo');
    if (loggedIn) {
      infoEl.style.display = 'block';
      // Fetch username
      MalOAuth._getUsername().then(name => {
        document.getElementById('malUserLabel').textContent = 'Connected as: ' + name;
      }).catch(() => {});
    } else {
      infoEl.style.display = 'none';
    }
  }

  // MAL Sync (OAuth-based)
  document.getElementById('malSyncBtn').addEventListener('click', async () => {
    if (!MalOAuth.isLoggedIn()) { toast('Login to MAL first'); return; }
    if (!TMDB.getKey()) { toast('Set your TMDB API key first'); return; }
    const statusEl = document.getElementById('malSyncStatus');

    await enqueueTask('Syncing MAL', async () => {
      statusEl.textContent = 'Syncing...';
      statusEl.className = 'sync-status syncing';
      try {
        updateSyncProgress(10, 'Fetching anime list from MAL...');
        console.log('[WatchTracker] Fetching MAL animelist via OAuth API');
        const entries = await MalOAuth.fetchAnimeList((count) => {
          updateSyncProgress(10, `Fetched ${count} entries from MAL...`);
        });
        console.log('[WatchTracker] MAL entries:', entries.length);
        if (!entries.length) { statusEl.textContent = 'No entries'; statusEl.className = 'sync-status'; toast('No entries found on MAL'); return; }
        updateSyncProgress(25, `Found ${entries.length} entries. Matching to TMDB...`);
        const { results, matched } = await SyncEngine.matchToTmdb(entries, (i, t, title) => {
          updateSyncProgress(25 + (i / t * 50), `Matching: ${title} (${i}/${t})`);
        });
        console.log('[WatchTracker] TMDB matched:', matched, '/', entries.length);
        updateSyncProgress(75, `Matched ${matched}/${entries.length}. Applying to library...`);
        SyncEngine.saveImportState('MAL', results, 'merge');
        const stats = await SyncEngine.applySyncResults(results, 'merge', (i, t, title) => {
          updateSyncProgress(75 + (i / t * 25), `Adding: ${title} (${i}/${t})`);
        });
        console.log('[WatchTracker] Apply stats:', stats);
        statusEl.textContent = 'Synced';
        statusEl.className = 'sync-status synced';
        SyncEngine._config.lastSync.mal = new Date().toISOString();
        SyncEngine.saveConfig();
        updateSyncTimestamps();
        toast(`MAL: +${stats.added} added, ${stats.updated} updated`);
      } catch (err) {
        console.error('[WatchTracker] MAL sync error:', err);
        statusEl.textContent = 'Error';
        statusEl.className = 'sync-status sync-error';
        toast('MAL sync: ' + (err.message || 'Unknown error'));
      }
    });
  });

  // Sync/Import progress helpers
  function showSyncProgress(label) {
    const area = document.getElementById('syncProgressArea');
    area.classList.remove('hidden');
    area.classList.remove('progress-done');
    document.getElementById('syncProgressLabel').textContent = label || 'Working';
    updateSyncProgress(0, 'Preparing...');
  }
  function hideSyncProgress() {
    const area = document.getElementById('syncProgressArea');
    area.classList.add('progress-done');
    document.getElementById('syncProgressPct').textContent = 'Done';
    setTimeout(() => area.classList.add('hidden'), 2500);
  }
  function updateSyncProgress(pct, text) {
    const rounded = Math.min(Math.round(pct), 100);
    document.getElementById('syncProgressFill').style.width = rounded + '%';
    document.getElementById('syncProgressPct').textContent = rounded + '%';
    document.getElementById('syncProgressText').textContent = text;
  }
  function updateSyncTimestamps() {
    const cfg = SyncEngine.getConfig();
    const lbEl = document.getElementById('lbLastSync');
    const malEl = document.getElementById('malLastSync');
    if (cfg.lastSync?.letterboxd) {
      const d = new Date(cfg.lastSync.letterboxd);
      lbEl.textContent = `Last synced: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    }
    if (cfg.lastSync?.mal) {
      const d = new Date(cfg.lastSync.mal);
      malEl.textContent = `Last synced: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    }
  }

  // ─── Theme Accordion Toggle ───
  document.getElementById('themeToggle').addEventListener('click', () => {
    const panel = document.getElementById('themePanel');
    const arrow = document.getElementById('themeArrow');
    panel.classList.toggle('open');
    arrow.classList.toggle('open');
  });

  // ─── Theme Preset Swatches ───
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ThemeEngine.applyPreset(btn.dataset.theme);
    });
  });

  // ─── Custom Colors ───
  document.getElementById('applyCustomTheme').addEventListener('click', () => {
    document.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
    ThemeEngine.applyCustom({
      bg: document.getElementById('ctBg').value,
      surface: document.getElementById('ctSurface').value,
      accent: document.getElementById('ctAccent').value,
      text: document.getElementById('ctText').value,
    });
    toast('Custom theme applied');
  });

  document.getElementById('resetTheme').addEventListener('click', () => {
    document.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-theme="default"]').classList.add('active');
    ThemeEngine.applyPreset('default');
    toast('Theme reset');
  });

  // ─── Background Image ───
  document.getElementById('applyBgImage').addEventListener('click', () => {
    const url = document.getElementById('bgImageUrl').value.trim();
    if (url) { ThemeEngine.setBgImage(url); toast('Background applied'); }
  });

  document.getElementById('uploadBgImage').addEventListener('click', () => {
    document.getElementById('bgImageFile').click();
  });
  document.getElementById('bgImageFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { ThemeEngine.setBgImage(reader.result); toast('Background uploaded'); };
    reader.readAsDataURL(file);
  });

  document.getElementById('clearBgImage').addEventListener('click', () => {
    ThemeEngine.clearBgImage();
    document.getElementById('bgImageUrl').value = '';
    toast('Background cleared');
  });

  document.getElementById('bgOverlayOpacity').addEventListener('input', (e) => {
    ThemeEngine.setOverlayOpacity(parseInt(e.target.value));
  });

  document.getElementById('bgBlur').addEventListener('input', (e) => {
    ThemeEngine.setBlur(parseInt(e.target.value));
  });
});

/* ═══════════════════════════════════════════
   Theme Engine — presets + custom + bg image + blur
   ═══════════════════════════════════════════ */

const ThemeEngine = {
  presets: {
    default:  { bg0:'#08090c', bg1:'#0e1015', bg2:'#151820', bg3:'#1c2030', bg4:'#242a3a', accent:'#6c5ce7', accentL:'#a29bfe', text0:'#f0f2f5', text1:'#c0c5d0', text2:'#7a8194', text3:'#4a5068', border:'rgba(255,255,255,0.06)' },
    midnight: { bg0:'#0d1117', bg1:'#161b22', bg2:'#1c2129', bg3:'#21262d', bg4:'#30363d', accent:'#58a6ff', accentL:'#79c0ff', text0:'#e6edf3', text1:'#b1bac4', text2:'#6e7681', text3:'#484f58', border:'rgba(255,255,255,0.06)' },
    ocean:    { bg0:'#0a192f', bg1:'#112240', bg2:'#162b50', bg3:'#1d3a6a', bg4:'#254980', accent:'#64ffda', accentL:'#88ffea', text0:'#e6f1ff', text1:'#a8c0d8', text2:'#607b96', text3:'#3d566e', border:'rgba(255,255,255,0.06)' },
    forest:   { bg0:'#0b1a0b', bg1:'#132413', bg2:'#1a2e1a', bg3:'#223b22', bg4:'#2d4a2d', accent:'#4ade80', accentL:'#86efac', text0:'#ecfdf5', text1:'#a7cfb0', text2:'#5c8a6a', text3:'#3a5c42', border:'rgba(255,255,255,0.06)' },
    sunset:   { bg0:'#1a0a0a', bg1:'#2d1515', bg2:'#3a1e1e', bg3:'#4a2828', bg4:'#5c3535', accent:'#f97316', accentL:'#fb923c', text0:'#fef2f2', text1:'#d4a0a0', text2:'#8a5555', text3:'#5c3535', border:'rgba(255,255,255,0.06)' },
    sakura:   { bg0:'#1a0f18', bg1:'#2a1525', bg2:'#351c30', bg3:'#42243d', bg4:'#522e4d', accent:'#f472b6', accentL:'#f9a8d4', text0:'#fdf2f8', text1:'#d4a0c0', text2:'#8a5578', text3:'#5c3550', border:'rgba(255,255,255,0.06)' },
    nord:     { bg0:'#2e3440', bg1:'#3b4252', bg2:'#434c5e', bg3:'#4c566a', bg4:'#5a6478', accent:'#88c0d0', accentL:'#8fbcbb', text0:'#eceff4', text1:'#d8dee9', text2:'#81a1c1', text3:'#5e81ac', border:'rgba(255,255,255,0.08)' },
    light:    { bg0:'#f5f5f7', bg1:'#e8e8ed', bg2:'#dddde3', bg3:'#d0d0d8', bg4:'#c0c0cc', accent:'#6c5ce7', accentL:'#5a4bd4', text0:'#1a1a2e', text1:'#333355', text2:'#666688', text3:'#9999aa', border:'rgba(0,0,0,0.08)' },
  },

  init() {
    const saved = Store.getTheme();
    if (!saved) return;
    if (saved.preset) this._apply(this.presets[saved.preset] || this.presets.default);
    else if (saved.custom) this._apply(saved.custom);
    if (saved.bgImage) this._applyBg(saved.bgImage, saved.bgOverlay || 70, saved.bgBlur || 0);
    if (saved.bgOverlay !== undefined) {
      const el = document.getElementById('bgOverlayOpacity');
      if (el) el.value = saved.bgOverlay;
    }
    if (saved.bgBlur !== undefined) {
      const el = document.getElementById('bgBlur');
      if (el) el.value = saved.bgBlur;
    }
    if (saved.preset) {
      document.querySelectorAll('.theme-swatch').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === saved.preset);
      });
    }
  },

  applyPreset(name) {
    const p = this.presets[name];
    if (!p) return;
    this._apply(p);
    const saved = Store.getTheme() || {};
    Store.setTheme({ ...saved, preset: name, custom: null });
  },

  applyCustom(c) {
    const vars = {
      bg0: c.bg, bg1: this._lighten(c.bg, 8), bg2: c.surface,
      bg3: this._lighten(c.surface, 10), bg4: this._lighten(c.surface, 20),
      accent: c.accent, accentL: this._lighten(c.accent, 20),
      text0: c.text, text1: this._darken(c.text, 15), text2: this._darken(c.text, 35),
      text3: this._darken(c.text, 55), border: 'rgba(255,255,255,0.06)',
    };
    this._apply(vars);
    const saved = Store.getTheme() || {};
    Store.setTheme({ ...saved, preset: null, custom: vars });
  },

  setBgImage(dataOrUrl) {
    const overlay = parseInt(document.getElementById('bgOverlayOpacity').value) || 70;
    const blur = parseInt(document.getElementById('bgBlur').value) || 0;
    this._applyBg(dataOrUrl, overlay, blur);
    const saved = Store.getTheme() || {};
    Store.setTheme({ ...saved, bgImage: dataOrUrl, bgOverlay: overlay, bgBlur: blur });
  },

  clearBgImage() {
    const bgEl = document.getElementById('bgImageEl');
    if (bgEl) bgEl.remove();
    const overlay = document.getElementById('bgOverlayEl');
    if (overlay) overlay.remove();
    const saved = Store.getTheme() || {};
    delete saved.bgImage;
    delete saved.bgBlur;
    Store.setTheme(saved);
  },

  setOverlayOpacity(val) {
    const overlay = document.getElementById('bgOverlayEl');
    if (overlay) overlay.style.background = `rgba(0,0,0,${val / 100})`;
    const saved = Store.getTheme() || {};
    saved.bgOverlay = val;
    Store.setTheme(saved);
  },

  setBlur(val) {
    const bgEl = document.getElementById('bgImageEl');
    if (bgEl) bgEl.style.filter = val > 0 ? `blur(${val}px)` : 'none';
    const saved = Store.getTheme() || {};
    saved.bgBlur = val;
    Store.setTheme(saved);
  },

  _apply(p) {
    const r = document.documentElement.style;
    r.setProperty('--bg-0', p.bg0);
    r.setProperty('--bg-1', p.bg1);
    r.setProperty('--bg-2', p.bg2);
    r.setProperty('--bg-3', p.bg3);
    r.setProperty('--bg-4', p.bg4);
    r.setProperty('--accent', p.accent);
    r.setProperty('--accent-light', p.accentL);
    r.setProperty('--accent-glow', p.accent + '22');
    r.setProperty('--text-0', p.text0);
    r.setProperty('--text-1', p.text1);
    r.setProperty('--text-2', p.text2);
    r.setProperty('--text-3', p.text3);
    r.setProperty('--border', p.border);
  },

  _applyBg(url, opacity, blur) {
    // Background image element (separate div so blur doesn't affect content)
    let bgEl = document.getElementById('bgImageEl');
    if (!bgEl) {
      bgEl = document.createElement('div');
      bgEl.id = 'bgImageEl';
      bgEl.style.cssText = 'position:fixed;inset:0;z-index:0;background-size:cover;background-position:center;pointer-events:none;';
      document.body.prepend(bgEl);
    }
    bgEl.style.backgroundImage = `url(${url})`;
    bgEl.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    // Slight scale to hide blur edges
    bgEl.style.transform = blur > 0 ? 'scale(1.05)' : 'none';

    // Dark overlay
    let overlay = document.getElementById('bgOverlayEl');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'bgOverlayEl';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;';
      bgEl.after(overlay);
    }
    overlay.style.background = `rgba(0,0,0,${opacity / 100})`;

    // Content above bg
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    if (sidebar) { sidebar.style.position = 'relative'; sidebar.style.zIndex = '1'; }
    if (main) { main.style.position = 'relative'; main.style.zIndex = '1'; }
  },

  _lighten(hex, pct) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((n >> 16) & 0xFF) + Math.round(2.55 * pct));
    const g = Math.min(255, ((n >> 8) & 0xFF) + Math.round(2.55 * pct));
    const b = Math.min(255, (n & 0xFF) + Math.round(2.55 * pct));
    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
  },

  _darken(hex, pct) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((n >> 16) & 0xFF) - Math.round(2.55 * pct));
    const g = Math.max(0, ((n >> 8) & 0xFF) - Math.round(2.55 * pct));
    const b = Math.max(0, (n & 0xFF) - Math.round(2.55 * pct));
    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
  },
};
