/* Popup — list + detail + TMDB search, TV first, persistent prefs */

const STATUS_CFG = {
  watching: { label: 'Watching', color: '#00b894' },
  completed: { label: 'Completed', color: '#6c5ce7' },
  on_hold: { label: 'On-Hold', color: '#fdcb6e' },
  dropped: { label: 'Dropped', color: '#e17055' },
  plan_to_watch: { label: 'Plan to Watch', color: '#a29bfe' },
  all: { label: 'All', color: 'linear-gradient(135deg,#00b894,#6c5ce7,#e17055)' },
};

let pFilter = 'watching', pType = 'all', pSort = 'dateUpdated', pView = 'list', pQuery = '';
let pMode = 'list';
let pReturnMode = 'list';
let pSearchTimeout = null;
let pRecCache = { html: '', summary: '', filters: null, results: [] };

document.addEventListener('DOMContentLoaded', async () => {
  await Store.load();
  const apiKey = Store.getApiKey();
  if (apiKey) TMDB.setKey(apiKey);
  const omdbKey = Store.getOmdbKey ? Store.getOmdbKey() : '';
  if (omdbKey && window.OMDB) OMDB.setKey(omdbKey);
  applyPopupTheme();
  restorePrefs();
  renderList();

  document.getElementById('pOpenTab').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); window.close();
  });
  document.getElementById('pSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + '#settings' }); window.close();
  });
  document.getElementById('pClose').addEventListener('click', () => window.close());

  // Diary view
  document.getElementById('pDiaryBtn').addEventListener('click', () => enterDiaryMode());
  document.getElementById('pRecBtn').addEventListener('click', () => enterRecommendationsMode());

  // Back — returns to the previous popup view when possible
  document.getElementById('pBack').addEventListener('click', () => {
    if (pMode === 'detail' && pReturnMode === 'recommendations') enterRecommendationsMode(false);
    else goBackToList();
  });

  // + Add New button — enters TMDB search mode
  document.getElementById('pAddNew').addEventListener('click', () => {
    enterTMDBMode();
  });

  // Type toggle
  document.querySelectorAll('.p-type').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.p-type').forEach(t => t.classList.remove('active'));
    b.classList.add('active'); pType = b.dataset.type; savePrefs(); renderList();
  }));

  // Custom status dropdown
  initStatusDropdown();

  // Sort custom dropdown
  initSortDropdown();

  // View toggle
  document.querySelectorAll('.p-view').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.p-view').forEach(v => v.classList.remove('active'));
    b.classList.add('active'); pView = b.dataset.view; savePrefs(); renderList();
  }));

  // Local list filter (the main search bar)
  document.getElementById('pSearch').addEventListener('input', (e) => {
    pQuery = e.target.value.trim().toLowerCase();
    renderList();
  });

  // TMDB search input (the dedicated bar)
  const tmdbInput = document.getElementById('pTmdbSearch');
  tmdbInput.addEventListener('input', (e) => {
    clearTimeout(pSearchTimeout);
    const q = e.target.value.trim();
    if (!q) {
      document.getElementById('pList').innerHTML = '<div class="p-search-msg">Type to search TMDB for movies and TV shows</div>';
      return;
    }
    if (q.length >= 2 && TMDB.getKey()) {
      document.getElementById('pList').innerHTML = '<div class="p-search-msg">Searching...</div>';
      pSearchTimeout = setTimeout(() => searchTMDB(q), 350);
    }
  });
  tmdbInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = tmdbInput.value.trim();
      if (q.length >= 2 && TMDB.getKey()) { clearTimeout(pSearchTimeout); searchTMDB(q); }
    }
    if (e.key === 'Escape') goBackToList();
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.p-status-dd')) closeStatusDD('pStatusDD');
    if (!e.target.closest('.p-sort-dd')) closeSortDD();
    document.querySelectorAll('.pd-status-dd.open').forEach(dd => {
      if (!dd.contains(e.target)) { dd.classList.remove('open'); dd.querySelector('.pd-dd-menu').classList.add('hidden'); }
    });
  });
});

/* ═══════════════════════════════════════════
   PREFS PERSISTENCE
   ═══════════════════════════════════════════ */

function savePrefs() {
  Store.setPopupPrefs({ filter: pFilter, type: pType, sort: pSort, view: pView });
}

function restorePrefs() {
  const p = Store.getPopupPrefs();
  if (!p) return;
  if (p.filter) { pFilter = p.filter; setStatusDD(pFilter); }
  if (p.type) {
    pType = p.type;
    document.querySelectorAll('.p-type').forEach(b => b.classList.toggle('active', b.dataset.type === pType));
  }
  if (p.sort) {
    pSort = p.sort;
    setSortDD(pSort);
  }
  if (p.view) {
    pView = p.view;
    document.querySelectorAll('.p-view').forEach(b => b.classList.toggle('active', b.dataset.view === pView));
  }
}

/* ═══════════════════════════════════════════
   CUSTOM STATUS DROPDOWN
   ═══════════════════════════════════════════ */

function initStatusDropdown() {
  const btn = document.getElementById('pStatusBtn');
  const dd = document.getElementById('pStatusDD');
  const menu = document.getElementById('pStatusMenu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) { closeStatusDD('pStatusDD'); }
    else { menu.classList.remove('hidden'); dd.classList.add('open'); }
  });

  menu.querySelectorAll('.p-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      const val = item.dataset.val;
      pFilter = val;
      setStatusDD(val);
      closeStatusDD('pStatusDD');
      savePrefs();
      renderList();
    });
  });
}

function setStatusDD(val) {
  const cfg = STATUS_CFG[val] || STATUS_CFG.watching;
  document.getElementById('pStatusLabel').textContent = cfg.label;
  const dot = document.getElementById('pStatusDot');
  dot.style.background = cfg.color;
  // Update active state
  document.querySelectorAll('#pStatusMenu .p-dd-item').forEach(it => {
    it.classList.toggle('active', it.dataset.val === val);
  });
}

function closeStatusDD(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  dd.classList.remove('open');
  const menu = dd.querySelector('.p-dd-menu, .pd-dd-menu');
  if (menu) menu.classList.add('hidden');
}

/* ═══════════════════════════════════════════
   CUSTOM SORT DROPDOWN
   ═══════════════════════════════════════════ */

const SORT_LABELS = { dateUpdated: 'Updated', dateAdded: 'Added', title: 'A-Z', year: 'Year' };

function initSortDropdown() {
  const btn = document.getElementById('pSortBtn');
  const dd = document.getElementById('pSortDD');
  const menu = document.getElementById('pSortMenu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) { closeSortDD(); } else { menu.classList.remove('hidden'); dd.classList.add('open'); }
  });

  menu.querySelectorAll('.p-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      pSort = item.dataset.val;
      setSortDD(pSort);
      closeSortDD();
      savePrefs();
      renderList();
    });
  });
}

function setSortDD(val) {
  document.getElementById('pSortLabel').textContent = SORT_LABELS[val] || val;
  document.querySelectorAll('#pSortMenu .p-dd-item').forEach(it => {
    it.classList.toggle('active', it.dataset.val === val);
  });
}

function closeSortDD() {
  const dd = document.getElementById('pSortDD');
  const menu = document.getElementById('pSortMenu');
  if (dd) dd.classList.remove('open');
  if (menu) menu.classList.add('hidden');
}

/* ═══════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════ */

function goBackToList() {
  pMode = 'list';
  pReturnMode = 'list';
  document.getElementById('pBack').classList.add('hidden');
  document.getElementById('pControls').classList.remove('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pSearch').parentElement.classList.remove('hidden');
  document.getElementById('pAddNew').classList.remove('hidden');
  document.getElementById('pDiaryBtn').classList.remove('hidden');
  document.getElementById('pRecBtn').classList.remove('hidden');
  document.getElementById('pTmdbSearch').value = '';
  document.getElementById('pSearch').value = '';
  pQuery = '';
  document.getElementById('pEmpty').classList.add('hidden');
  renderList();
}

function enterDiaryMode() {
  pMode = 'diary';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pSearch').parentElement.classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pRecBtn').classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  renderPopupDiary();
}

function renderPopupDiary() {
  const el = document.getElementById('pList');
  const diary = Store.getDiary();
  if (!diary.length) {
    el.innerHTML = '<div class="p-search-msg">No diary entries yet. Log a watch from any title\'s detail page.</div>';
    return;
  }

  const movies = Store.getMovies();
  const tvshows = Store.getTvShows();
  const actLabels = { completed: 'Completed', rewatch: 'Rewatched', watched: 'Watched', watched_episodes: 'Watched eps', started: 'Started', session: 'Session' };

  // Enrich diary entries with poster fallback from store
  const enriched = diary.map(e => {
    if (e.posterPath) return e;
    const m = e.type === 'movie' ? movies.find(x => x.tmdbId === e.tmdbId) : tvshows.find(x => x.tmdbId === e.tmdbId);
    return { ...e, posterPath: m ? m.posterPath : null };
  });

  // Group by date
  const grouped = {};
  enriched.forEach(e => { const d = e.date || 'Unknown'; if (!grouped[d]) grouped[d] = []; grouped[d].push(e); });

  let html = '<div class="pd-diary-tl">';
  Object.keys(grouped).sort((a, b) => b.localeCompare(a)).forEach(date => {
    const dateObj = new Date(date + 'T12:00:00');
    const valid = !isNaN(dateObj.getTime());
    const dayNum = valid ? dateObj.getDate() : '?';
    const mon = valid ? dateObj.toLocaleDateString('en-US', { month: 'short' }) : '';
    const dayName = valid ? dateObj.toLocaleDateString('en-US', { weekday: 'short' }) : '';

    html += `<div class="pd-tl-day"><div class="pd-tl-marker"><div class="pd-tl-num">${dayNum}</div><div class="pd-tl-mon">${mon}</div><div class="pd-tl-dn">${dayName}</div></div><div class="pd-tl-entries">`;

    grouped[date].forEach(e => {
      const poster = TMDB.poster(e.posterPath, 'w92');
      const act = actLabels[e.action] || e.action || 'Logged';
      const rating = e.rating ? ` · ★ ${e.rating}/10` : '';
      const season = e.season ? ` · S${e.season}` : '';

      html += `<div class="pd-tl-entry" data-tmdb="${e.tmdbId}" data-type="${e.type}">
        <div class="pd-tl-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${e.type === 'movie' ? 'MOV' : 'TV'}</div>`}</div>
        <div class="pd-tl-info">
          <div class="pd-tl-title">${esc(e.title)}</div>
          <div class="pd-tl-meta">${act}${season}${rating}</div>
          ${e.notes ? `<div class="pd-tl-notes">${esc(e.notes).substring(0, 60)}</div>` : ''}
        </div>
        <div class="pd-tl-actions">
          <button class="pd-tl-edit" data-ts="${e.timestamp || ''}">Edit</button>
          <button class="pd-tl-del" data-tmdb="${e.tmdbId}" data-ts="${e.timestamp || ''}">Remove</button>
        </div>
      </div>`;
    });

    html += '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;

  // Bind clicks
  el.querySelectorAll('.pd-tl-entry').forEach(entry => {
    entry.addEventListener('click', (ev) => {
      if (ev.target.closest('.pd-tl-edit') || ev.target.closest('.pd-tl-del')) return;
      showDetail(parseInt(entry.dataset.tmdb), entry.dataset.type);
    });
  });
  el.querySelectorAll('.pd-tl-edit').forEach(btn => {
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); popupEditDiaryEntry(btn.dataset.ts); });
  });
  el.querySelectorAll('.pd-tl-del').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm('Remove this entry?')) {
        Store.removeDiaryEntry(parseInt(btn.closest('.pd-tl-entry').dataset.tmdb), btn.dataset.ts);
        renderPopupDiary();
      }
    });
  });
}

function enterTMDBMode() {
  pMode = 'search';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.remove('hidden');
  document.getElementById('pSearch').parentElement.classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pRecBtn').classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Type to search TMDB for movies and TV shows</div>';
  setTimeout(() => document.getElementById('pTmdbSearch').focus(), 50);
}


function enterRecommendationsMode(reset = false) {
  pMode = 'recommendations';
  pReturnMode = 'list';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pSearch').parentElement.classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pRecBtn').classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  const el = document.getElementById('pList');
  if (!reset && pRecCache.html) {
    el.innerHTML = pRecCache.html;
    bindPopupRecommendationEvents();
    return;
  }
  el.innerHTML = popupRecommendationShell();
  bindPopupRecommendationEvents();
}

function popupRecommendationShell() {
  const languageOptions = POPUP_REC_LANGUAGES.map(([code, name]) => `<option value="${esc(name)} (${esc(code)})"></option>`).join('');
  return `<div class="pr-wrap">
    <div class="pr-head">
      <div><div class="pr-title">Recommendations</div><div class="pr-sub">Quick picks from your tracker or TMDB.</div></div>
    </div>
    <div class="pr-panel">
      <div class="pr-row"><label>Source</label><select id="prSource"><option value="new">Something new</option><option value="plan_to_watch">From Plan to Watch</option><option value="completed">From Completed</option><option value="library">From My Library</option></select></div>
      <div class="pr-grid2">
        <div class="pr-row"><label>Picks</label><select id="prCount"><option>1</option><option selected>3</option><option>5</option><option>10</option></select></div>
        <div class="pr-row"><label>Type</label><select id="prType"><option value="movie" selected>Movies</option><option value="tv">TV Shows</option><option value="both">Movies + TV</option></select></div>
      </div>
      <div class="pr-grid2">
        <div class="pr-row"><label>Style</label><select id="prStyle"><option value="best" selected>Closest match</option><option value="because">Similar favorites</option><option value="hidden">Hidden gems</option><option value="popular">Popular</option><option value="wild">Surprise me</option><option value="random">Random by filters</option></select></div>
        <div class="pr-row"><label>Genre</label><select id="prGenre">${popupGenreOptions()}</select></div>
      </div>
      <div class="pr-grid2">
        <div class="pr-row"><label>TMDB rating</label><select id="prTmdbRating"><option value="">Any</option><option value="6">6+</option><option value="7">7+</option><option value="8">8+</option><option value="9">9+</option></select></div>
        <div class="pr-row"><label>Library</label><select id="prLibrary"><option value="new_only">New only</option><option value="not_completed">Not completed</option><option value="include_library">Allow saved</option></select></div>
      </div>
      <div class="pr-row"><label>Language</label><input id="prLanguage" list="prLanguageList" type="search" placeholder="Any language, e.g. Telugu, Tamil"><datalist id="prLanguageList">${languageOptions}</datalist></div>
      <button id="prSuggest" class="pr-primary">Suggest</button>
    </div>
    <div id="prSummary" class="pr-summary"></div>
    <div id="prResults" class="pr-empty">Choose filters and tap Suggest.</div>
  </div>`;
}

function bindPopupRecommendationEvents() {
  const root = document.getElementById('pList');
  const btn = root.querySelector('#prSuggest');
  if (btn) btn.addEventListener('click', popupSuggestRecommendations);
  root.querySelectorAll('[data-pr-card]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      showDetail(Number(card.dataset.id), card.dataset.type, 'recommendations');
    });
  });
  root.querySelectorAll('[data-pr-add]').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); await popupAddRecommendation(btn); });
  });
}

async function popupSuggestRecommendations() {
  if (!TMDB.getKey() && document.getElementById('prSource').value === 'new') {
    document.getElementById('prResults').innerHTML = '<div class="pr-empty">Set your TMDB API key in Settings first.</div>';
    return;
  }
  const btn = document.getElementById('prSuggest');
  const results = document.getElementById('prResults');
  const summary = document.getElementById('prSummary');
  btn.disabled = true; btn.textContent = 'Finding...';
  results.className = 'pr-empty';
  results.innerHTML = 'Finding picks...';
  try {
    const filters = {
      source: document.getElementById('prSource').value,
      count: Number(document.getElementById('prCount').value),
      type: document.getElementById('prType').value,
      style: document.getElementById('prStyle')?.value || 'best',
      libraryMode: document.getElementById('prLibrary').value,
      genre: document.getElementById('prGenre')?.value || '',
      language: popupLanguageCode(document.getElementById('prLanguage').value),
      minTmdbRating: document.getElementById('prTmdbRating').value,
      minMyRating: '',
      decade: '',
    };
    const data = await Recommendations.suggest(filters);
    const items = data.results || [];
    summary.textContent = items.length ? `${items.length} pick${items.length === 1 ? '' : 's'}${filters.style === 'random' ? ' · random by filters' : ''}${filters.genre ? ' · ' + filters.genre : ''}${filters.language ? ' · ' + popupLanguageName(filters.language) : ''}` : '';
    results.className = items.length ? 'pr-results' : 'pr-empty';
    results.innerHTML = items.length ? items.map((m, i) => popupRecommendationCard(m, i)).join('') : 'No matches found. Try Random by filters, Any rating, or clear Genre/Language.';
    pRecCache = { html: document.getElementById('pList').innerHTML, summary: summary.textContent, filters, results: items };
    bindPopupRecommendationEvents();
  } catch (err) {
    results.className = 'pr-empty';
    results.innerHTML = `Could not load recommendations: ${esc(err.message || String(err))}`;
  } finally {
    btn.disabled = false; btn.textContent = 'Suggest';
  }
}

function popupRecommendationCard(m, i) {
  const poster = TMDB.poster(m.posterPath, 'w92');
  const inList = m.mediaType === 'movie' ? Store.hasMovie(m.tmdbId) : Store.hasTvShow(m.tmdbId);
  const status = m.watchStatus ? String(m.watchStatus).replace(/_/g, ' ') : '';
  const language = m.originalLanguage ? popupLanguageName(m.originalLanguage) : '';
  const imdb = m.imdbRating ? `IMDb ${Number(m.imdbRating).toFixed(1)}` : '';
  const meta = [m.mediaType === 'movie' ? 'Movie' : 'TV', m.year || '', m.voteAverage ? `TMDB ${Number(m.voteAverage).toFixed(1)}` : '', imdb, language].filter(Boolean).join(' · ');
  const desc = String(m.overview || '').replace(/\s+/g, ' ').trim().slice(0, 130);
  const action = inList ? `<span class="pr-saved">${esc(status || 'Saved')}</span>` : `<button class="pr-add" data-pr-add data-id="${m.tmdbId}" data-type="${m.mediaType}">Add</button>`;
  return `<article class="pr-card" data-pr-card data-id="${m.tmdbId}" data-type="${m.mediaType}">
    <div class="pr-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${m.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}</div>
    <div class="pr-info"><div class="pr-kicker">#${i + 1}</div><div class="pr-name">${esc(m.title)}</div><div class="pr-meta">${esc(meta)}</div>${desc ? `<div class="pr-desc">${esc(desc)}</div>` : ''}<div class="pr-actions">${action}</div></div>
  </article>`;
}

async function popupAddRecommendation(btn) {
  const id = Number(btn.dataset.id);
  const type = btn.dataset.type;
  btn.disabled = true; btn.textContent = 'Adding...';
  try {
    const rec = (pRecCache?.results || []).find(x => Number(x.tmdbId) === id && x.mediaType === type) || {};
    if (type === 'movie') {
      const d = await TMDB.movieDetails(id);
      Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.release_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.imdb_id || '', runtime: d.runtime || 0, genres: (d.genres || []).map(g => g.name), originalLanguage: d.original_language || '', watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
      Store.addActivity({ tmdbId: d.id, title: d.title, type: 'movie', posterPath: d.poster_path, action: 'added', detail: 'Added from popup recommendations', timestamp: new Date().toISOString() });
    } else {
      const d = await TMDB.tvDetails(id);
      const ss = (d.seasons || []).filter(s => s.season_number > 0);
      Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.first_air_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.external_ids?.imdb_id || '', totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0, genres: (d.genres || []).map(g => g.name), originalLanguage: d.original_language || '', watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s => ({ seasonNumber: s.season_number, episodeCount: s.episode_count || 0, episodesWatched: 0, posterPath: s.poster_path })), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
      Store.addActivity({ tmdbId: d.id, title: d.name, type: 'tv', posterPath: d.poster_path, action: 'added', detail: 'Added from popup recommendations', timestamp: new Date().toISOString() });
    }
    btn.outerHTML = '<span class="pr-saved">Saved</span>';
    pRecCache.html = document.getElementById('pList').innerHTML;
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Add';
  }
}

function popupGenreOptions() {
  const local = new Set();
  try { Store.getAll().forEach(i => (i.genres || []).forEach(g => local.add(g))); } catch (_) {}
  const fallback = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
  const genres = [...new Set([...local, ...fallback])].filter(Boolean).sort((a,b) => a.localeCompare(b));
  return `<option value="">Any genre</option>${genres.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}`;
}

const POPUP_REC_LANGUAGES = [
  ['en','English'], ['hi','Hindi'], ['te','Telugu'], ['ta','Tamil'], ['ml','Malayalam'], ['kn','Kannada'], ['bn','Bengali'], ['mr','Marathi'], ['pa','Punjabi'], ['gu','Gujarati'], ['ur','Urdu'], ['or','Odia'], ['as','Assamese'], ['ne','Nepali'], ['si','Sinhala'],
  ['ja','Japanese'], ['ko','Korean'], ['zh','Mandarin / Chinese'], ['cn','Cantonese'], ['th','Thai'], ['id','Indonesian'], ['ms','Malay'], ['tl','Filipino / Tagalog'], ['vi','Vietnamese'], ['fr','French'], ['es','Spanish'], ['it','Italian'], ['de','German'], ['pt','Portuguese'], ['ru','Russian'], ['tr','Turkish'], ['ar','Arabic'], ['fa','Persian']
];
function popupLanguageCode(value = '') {
  const v = String(value || '').trim(); if (!v) return '';
  const paren = v.match(/\(([a-z]{2})\)$/i); if (paren) return paren[1].toLowerCase();
  const found = POPUP_REC_LANGUAGES.find(([c,n]) => c.toLowerCase() === v.toLowerCase() || n.toLowerCase() === v.toLowerCase());
  if (found) return found[0];
  return Recommendations.normalizeLanguage ? Recommendations.normalizeLanguage(v) : v.toLowerCase();
}
function popupLanguageName(code = '') {
  const found = POPUP_REC_LANGUAGES.find(([c]) => c === code);
  return found ? found[1] : String(code || '').toUpperCase();
}

/* ═══════════════════════════════════════════
   THEME
   ═══════════════════════════════════════════ */

function applyPopupTheme() {
  const t = Store.getTheme();
  if (!t) return;
  const r = document.documentElement.style;
  let p;
  if (t.preset) {
    const presets = {
      default: { bg0: '#0e1015', bg1: '#151820', bg2: '#1c2030', bg3: '#242a3a', accent: '#6c5ce7', accentL: '#a29bfe', text0: '#f0f2f5', text1: '#9ba0b5', text2: '#5c6180' },
      midnight: { bg0: '#161b22', bg1: '#1c2129', bg2: '#21262d', bg3: '#30363d', accent: '#58a6ff', accentL: '#79c0ff', text0: '#e6edf3', text1: '#b1bac4', text2: '#6e7681' },
      ocean: { bg0: '#112240', bg1: '#162b50', bg2: '#1d3a6a', bg3: '#254980', accent: '#64ffda', accentL: '#88ffea', text0: '#e6f1ff', text1: '#a8c0d8', text2: '#607b96' },
      forest: { bg0: '#132413', bg1: '#1a2e1a', bg2: '#223b22', bg3: '#2d4a2d', accent: '#4ade80', accentL: '#86efac', text0: '#ecfdf5', text1: '#a7cfb0', text2: '#5c8a6a' },
      sunset: { bg0: '#2d1515', bg1: '#3a1e1e', bg2: '#4a2828', bg3: '#5c3535', accent: '#f97316', accentL: '#fb923c', text0: '#fef2f2', text1: '#d4a0a0', text2: '#8a5555' },
      sakura: { bg0: '#2a1525', bg1: '#351c30', bg2: '#42243d', bg3: '#522e4d', accent: '#f472b6', accentL: '#f9a8d4', text0: '#fdf2f8', text1: '#d4a0c0', text2: '#8a5578' },
      nord: { bg0: '#3b4252', bg1: '#434c5e', bg2: '#4c566a', bg3: '#5a6478', accent: '#88c0d0', accentL: '#8fbcbb', text0: '#eceff4', text1: '#d8dee9', text2: '#81a1c1' },
      light: { bg0: '#e8e8ed', bg1: '#dddde3', bg2: '#d0d0d8', bg3: '#c0c0cc', accent: '#6c5ce7', accentL: '#5a4bd4', text0: '#1a1a2e', text1: '#333355', text2: '#666688' },
    };
    p = presets[t.preset];
  } else if (t.custom) {
    p = { bg0: t.custom.bg0, bg1: t.custom.bg1, bg2: t.custom.bg2, bg3: t.custom.bg3, accent: t.custom.accent, accentL: t.custom.accentL, text0: t.custom.text0, text1: t.custom.text1, text2: t.custom.text2 };
  }
  if (p) {
    r.setProperty('--pbg-0', p.bg0); r.setProperty('--pbg-1', p.bg1);
    r.setProperty('--pbg-2', p.bg2); r.setProperty('--pbg-3', p.bg3);
    r.setProperty('--paccent', p.accent); r.setProperty('--paccent-l', p.accentL);
    r.setProperty('--ptext-0', p.text0); r.setProperty('--ptext-1', p.text1);
    r.setProperty('--ptext-2', p.text2);
    document.body.style.background = p.bg0;
  }
}

/* ═══════════════════════════════════════════
   LIST VIEW
   ═══════════════════════════════════════════ */

function renderList() {
  let items = [
    ...Store.getTvShows().map(t => ({ ...t, mediaType: 'tv' })),
    ...Store.getMovies().map(m => ({ ...m, mediaType: 'movie' })),
  ];
  if (pFilter !== 'all') items = items.filter(i => i.watchStatus === pFilter);
  if (pType !== 'all') items = items.filter(i => i.mediaType === pType);
  if (pQuery) items = items.filter(i => i.title.toLowerCase().includes(pQuery));

  const typePri = (i) => i.mediaType === 'tv' ? 0 : 1;
  switch (pSort) {
    case 'title': items.sort((a, b) => a.title.localeCompare(b.title) || typePri(a) - typePri(b)); break;
    case 'year': items.sort((a, b) => (b.year || 0) - (a.year || 0) || typePri(a) - typePri(b)); break;
    case 'dateAdded': items.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded) || typePri(a) - typePri(b)); break;
    default: items.sort((a, b) => new Date(b.dateUpdated || b.dateAdded) - new Date(a.dateUpdated || a.dateAdded) || typePri(a) - typePri(b));
  }

  const el = document.getElementById('pList');
  const empty = document.getElementById('pEmpty');
  if (!items.length) { el.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const fc = { watching: 'fill-watching', completed: 'fill-completed', plan_to_watch: 'fill-plan', on_hold: 'fill-hold', dropped: 'fill-dropped' };

  if (pView === 'grid') {
    el.innerHTML = `<div class="p-grid">${items.map(i => {
      const img = TMDB.poster(i.posterPath, 'w185');
      const pct = getPct(i); const f = fc[i.watchStatus] || 'fill-plan';
      return `<div class="p-grid-card" data-tmdb="${i.tmdbId}" data-type="${i.mediaType}">
        <div class="p-grid-poster">${img ? `<img src="${img}">` : `<div class="p-poster-ph">${i.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}
          <div class="p-grid-bar"><div class="p-grid-bar-fill ${f}" style="width:${pct}%"></div></div>
        </div><div class="p-grid-title">${esc(i.title)}</div></div>`;
    }).join('')}</div>`;
  } else {
    el.innerHTML = items.map(i => {
      const img = TMDB.poster(i.posterPath, 'w92');
      const pct = getPct(i); const f = fc[i.watchStatus] || 'fill-plan';
      const eps = getEps(i); const score = i.voteAverage ? i.voteAverage.toFixed(1) : '';
      return `<div class="p-item" data-tmdb="${i.tmdbId}" data-type="${i.mediaType}">
        <div class="p-poster">${img ? `<img src="${img}">` : `<div class="p-poster-ph">${i.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}</div>
        <div class="p-info"><div class="p-title">${esc(i.title)}</div>
          <div class="p-meta">${i.mediaType === 'movie' ? 'Movie' : 'TV'} · ${i.year || ''}</div>
          <div class="p-bar-wrap"><div class="p-bar"><div class="p-bar-fill ${f}" style="width:${pct}%"></div></div></div></div>
        <div class="p-right">${eps ? `<div class="p-eps">${eps}</div>` : ''}${score ? `<div class="p-score">${score}</div>` : ''}</div></div>`;
    }).join('');
  }

  el.querySelectorAll('[data-tmdb]').forEach(c => c.addEventListener('click', () => {
    showDetail(parseInt(c.dataset.tmdb), c.dataset.type);
  }));
}

/* ═══════════════════════════════════════════
   DETAIL VIEW — custom status dropdown + eps + remove
   ═══════════════════════════════════════════ */

function buildStatusDropdownHTML(currentVal, idPrefix) {
  const entries = [
    { val: 'watching', label: 'Watching', color: '#00b894' },
    { val: 'completed', label: 'Completed', color: '#6c5ce7' },
    { val: 'on_hold', label: 'On-Hold', color: '#fdcb6e' },
    { val: 'dropped', label: 'Dropped', color: '#e17055' },
    { val: 'plan_to_watch', label: 'Plan to Watch', color: '#a29bfe' },
  ];
  const cur = entries.find(e => e.val === currentVal) || entries[0];
  return `<div class="pd-status-dd" id="${idPrefix}DD">
    <div class="pd-status-btn" id="${idPrefix}Btn">
      <span class="p-dd-dot" id="${idPrefix}Dot" style="background:${cur.color}"></span>
      <span class="pd-status-btn-label" id="${idPrefix}Label">${cur.label}</span>
      <span class="p-dd-arrow">&#9662;</span>
    </div>
    <div class="pd-dd-menu hidden" id="${idPrefix}Menu">
      ${entries.map(e => `<div class="p-dd-item ${e.val === currentVal ? 'active' : ''}" data-val="${e.val}"><span class="p-dd-dot" style="background:${e.color}"></span>${e.label}</div>`).join('')}
    </div>
  </div>`;
}

function bindDetailStatusDD(idPrefix, tmdbId, mediaType, title, posterPath) {
  const dd = document.getElementById(`${idPrefix}DD`);
  const btn = document.getElementById(`${idPrefix}Btn`);
  const menu = document.getElementById(`${idPrefix}Menu`);
  if (!dd || !btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) { dd.classList.remove('open'); menu.classList.add('hidden'); }
    else { menu.classList.remove('hidden'); dd.classList.add('open'); }
  });

  menu.querySelectorAll('.p-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      const val = item.dataset.val;
      const cfg = { watching: { l: 'Watching', c: '#00b894' }, completed: { l: 'Completed', c: '#6c5ce7' }, on_hold: { l: 'On-Hold', c: '#fdcb6e' }, dropped: { l: 'Dropped', c: '#e17055' }, plan_to_watch: { l: 'Plan to Watch', c: '#a29bfe' } };
      const c = cfg[val] || cfg.watching;
      document.getElementById(`${idPrefix}Label`).textContent = c.l;
      document.getElementById(`${idPrefix}Dot`).style.background = c.c;
      menu.querySelectorAll('.p-dd-item').forEach(i => i.classList.toggle('active', i.dataset.val === val));
      dd.classList.remove('open'); menu.classList.add('hidden');

      const isM = mediaType === 'movie';
      const show = !isM ? Store.getTvShow(tmdbId) : null;
      const isAnimeEntry = show && show.sourceTag === 'anime' && show.malId;
      if (isAnimeEntry) Store.updateTvShowByMalId(show.malId, { watchStatus: val });
      else if (isM) Store.updateMovie(tmdbId, { watchStatus: val });
      else Store.updateTvShow(tmdbId, { watchStatus: val });
      Store.addActivity({ tmdbId, title, type: mediaType, posterPath, action: 'status_change', detail: `Changed to ${c.l}`, timestamp: new Date().toISOString() });
    });
  });
}

async function showDetail(tmdbId, mediaType, returnMode = 'list') {
  pMode = 'detail';
  pReturnMode = returnMode || 'list';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pSearch').parentElement.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pRecBtn').classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');

  const isM = mediaType === 'movie';
  let stored = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
  const el = document.getElementById('pList');

  // If not found, diary entry may have a stale tmdbId — recover by title
  if (!stored) {
    const diaryEntry = Store.getDiary().find(d => d.tmdbId === tmdbId && d.type === mediaType);
    if (diaryEntry && diaryEntry.title) {
      const titleLower = diaryEntry.title.toLowerCase();
      const all = Store.getAll();
      const match = all.find(x => x.mediaType === mediaType && (x.title || '').toLowerCase() === titleLower);
      if (match) {
        Store.migrateTmdbId(tmdbId, match.tmdbId, mediaType);
        tmdbId = match.tmdbId;
        stored = match.mediaType === 'movie' ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
      }
    }
  }

  if (!stored) { showTMDBDetail(tmdbId, mediaType, pReturnMode); return; }

  el.innerHTML = '<div class="p-search-msg">Loading...</div>';

  const isAnime = stored.sourceTag === 'anime';
  const poster = TMDB.poster(stored.posterPath, 'w185');
  const genres = (stored.genres || []).slice(0, 4);
  const score = stored.voteAverage ? stored.voteAverage.toFixed(1) : '—';
  const scoreLabel = isAnime ? 'MAL' : 'TMDB';

  let seasonHtml = '';
  if (!isM) {
    const ss = stored.seasons || [];
    const totalEps = ss.reduce((s, x) => s + (x.episodeCount || 0), 0);
    const watchedEps = ss.reduce((s, x) => s + (x.episodesWatched || 0), 0);

    if (isAnime) {
      // Anime: single flat episode counter
      seasonHtml = `<div class="pd-section"><div class="pd-section-label">Episode Progress (${watchedEps}/${totalEps || '?'})</div>
        ${ss.map(s => {
        const w = s.episodesWatched || 0, t = s.episodeCount || 0;
        const unknownTotal = t === 0 && w > 0;
        const pct = unknownTotal ? 90 : (t > 0 ? Math.round(w / t * 100) : 0);
        const epDisplay = unknownTotal ? `${w}/?` : `${w}/${t}`;
        const metaEps = unknownTotal ? '? eps' : `${t} eps`;
        const barColor = stored.watchStatus === 'completed' ? 'var(--pcompleted)' : stored.watchStatus === 'on_hold' ? 'var(--phold)' : stored.watchStatus === 'dropped' ? 'var(--pdropped)' : 'var(--pwatching)';
        return `<div class="pd-ep-row"><span class="pd-ep-label">${esc(stored.title)} (${metaEps})</span>
            <div class="pd-ep-counter"><button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="dec">-</button>
              <input class="pd-ep-input" data-sn="${s.seasonNumber}" type="number" value="${w}" min="0" ${t > 0 ? `max="${t}"` : ''} style="width:${String(epDisplay).length * 8 + 16}px;">
              <span class="pd-ep-total">/ ${t || '?'}</span>
              <button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="inc">+</button></div>
          </div><div class="pd-season-bar"><div class="pd-season-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
      }).join('')}</div>`;
    } else {
      // TMDB TV: per-season progress with per-season status dropdown
      const seasonStatuses = stored.seasonStatuses || {};
      const seasonStatusColors = { watching:'#00b894', completed:'#6c5ce7', on_hold:'#fdcb6e', dropped:'#e17055', plan_to_watch:'#a29bfe', not_started:'#5c6180' };
      const ssOpts = [
        { val:'not_started', label:'—' }, { val:'watching', label:'Watching' },
        { val:'completed', label:'Completed' }, { val:'on_hold', label:'On-Hold' },
        { val:'dropped', label:'Dropped' }, { val:'plan_to_watch', label:'Plan' },
      ];
      seasonHtml = `<div class="pd-section"><div class="pd-section-label">Episode Progress (${watchedEps}/${totalEps || '?'})</div>
        ${ss.map(s => {
        const w = s.episodesWatched || 0, t = s.episodeCount || 0;
        const unknownTotal = t === 0 && w > 0;
        const pct = unknownTotal ? 90 : (t > 0 ? Math.round(w / t * 100) : 0);
        const sStatus = seasonStatuses[s.seasonNumber] || (w >= t && t > 0 ? 'completed' : w > 0 ? 'watching' : 'not_started');
        const sColor = seasonStatusColors[sStatus] || '#5c6180';
        const barColor = sColor;
        const epDisplay = unknownTotal ? `${w}/?` : `${w}/${t}`;
        const metaEps = unknownTotal ? '? eps' : `${t} eps`;
        return `<div class="pd-ep-row"><span class="pd-ep-label">S${s.seasonNumber} (${metaEps})</span>
            <select class="pd-season-status-select" data-sn="${s.seasonNumber}" style="color:${sColor};border-color:${sColor}40;">
              ${ssOpts.map(o => `<option value="${o.val}" ${o.val===sStatus?'selected':''}>${o.label}</option>`).join('')}
            </select>
            <div class="pd-ep-counter"><button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="dec">-</button>
              <input class="pd-ep-input" data-sn="${s.seasonNumber}" type="number" value="${w}" min="0" ${t > 0 ? `max="${t}"` : ''} style="width:${String(epDisplay).length * 8 + 16}px;">
              <span class="pd-ep-total">/ ${t || '?'}</span>
              <button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="inc">+</button></div>
          </div><div class="pd-season-bar"><div class="pd-season-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
      }).join('')}</div>`;
    }
  }

  let movieInfo;
  if (isM) {
    const rt = stored.runtime ? `${Math.floor(stored.runtime / 60)}h ${stored.runtime % 60}m` : '';
    movieInfo = [stored.year, rt].filter(Boolean).join(' · ');
  } else if (isAnime) {
    movieInfo = [stored.year, `${stored.totalEpisodes || '?'} Eps`].filter(Boolean).join(' · ');
  } else {
    const ss = stored.seasons || [];
    movieInfo = [stored.year, `${stored.totalSeasons || ss.length} Seasons`, `${stored.totalEpisodes || '?'} Eps`].filter(Boolean).join(' · ');
  }

  // Fetch extra details: Jikan-first for anime, TMDB for others
  let overview = '';
  let imdbId = stored.imdbId || null;
  let castHtml = '';
  let relatedHtml = '';

  if (isAnime && stored.malId) {
    // Fetch from Jikan
    try {
      const res = await fetch(`https://api.jikan.moe/v4/anime/${stored.malId}/full`);
      if (res.ok) {
        const jData = await res.json();
        const anime = jData?.data;
        if (anime) {
          overview = (anime.synopsis || '').substring(0, 250) + ((anime.synopsis || '').length > 250 ? '...' : '');

          // Build related anime section
          const validRelTypes = ['Prequel', 'Sequel', 'Parent Story', 'Side Story', 'Spin-off', 'Alternative Version'];
          const rels = [];
          for (const rel of (anime.relations || [])) {
            if (!validRelTypes.includes(rel.relation)) continue;
            for (const entry of (rel.entry || [])) {
              if (entry.type !== 'anime') continue;
              rels.push({ malId: entry.mal_id, title: entry.name || '', relation: rel.relation });
            }
          }
          if (rels.length) {
            const relOrder = ['Prequel', 'Sequel', 'Parent Story', 'Side Story', 'Spin-off', 'Alternative Version'];
            rels.sort((a, b) => (relOrder.indexOf(a.relation) === -1 ? 99 : relOrder.indexOf(a.relation)) - (relOrder.indexOf(b.relation) === -1 ? 99 : relOrder.indexOf(b.relation)));
            relatedHtml = `<div class="pd-section"><div class="pd-section-label">Related</div><div class="pd-related-list">${rels.map(r => {
              const inStore = Store.getTvShowByMalId(r.malId) || Store.getMovies().find(m => m.malId === r.malId);
              const dotColor = inStore ? ({ completed:'var(--pwatching)', watching:'var(--paccent-l)', dropped:'var(--pdropped)' }[inStore.watchStatus] || 'var(--ptext-2)') : 'transparent';
              return `<div class="pd-related-card" data-rel-mal="${r.malId}">
                <span class="pd-related-type">${esc(r.relation)}</span>
                <span class="pd-related-dot" style="background:${dotColor};${dotColor === 'transparent' ? 'border:1.5px solid var(--ptext-2);' : ''}"></span>
                <span class="pd-related-title">${esc(r.title)}</span>
              </div>`;
            }).join('')}</div></div>`;
          }
        }
      }
    } catch (e) { /* non-fatal */ }

    // Supplement with TMDB data for cast
    const tmdbFallbackId = stored.malTmdbId || (tmdbId > 0 ? tmdbId : null);
    if (tmdbFallbackId && TMDB.getKey()) {
      try {
        const d = isM ? await TMDB.movieDetails(tmdbFallbackId) : await TMDB.tvDetails(tmdbFallbackId);
        if (!overview && d.overview) overview = (d.overview || '').substring(0, 250) + ((d.overview || '').length > 250 ? '...' : '');
        if (!imdbId) imdbId = isM ? (d.imdb_id || null) : (d.external_ids?.imdb_id || null);
        const cast = (d.credits?.cast || []).slice(0, 6);
        if (cast.length) {
          castHtml = `<div class="pd-section"><div class="pd-section-label">Cast</div><div class="pd-cast-row">${cast.map(c => {
            const ph = TMDB.profile(c.profile_path, 'w92');
            return `<div class="pd-cast-card">${ph ? `<img src="${ph}" class="pd-cast-img">` : `<div class="pd-cast-ph"></div>`}<div class="pd-cast-name">${esc(c.name)}</div><div class="pd-cast-char">${esc(c.character || '')}</div></div>`;
          }).join('')}</div></div>`;
        }
      } catch (e) { /* non-fatal */ }
    }
  } else if (TMDB.getKey() && tmdbId > 0) {
    try {
      const d = isM ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId);
      overview = (d.overview || '').substring(0, 250) + ((d.overview || '').length > 250 ? '...' : '');
      if (!imdbId) {
        imdbId = isM ? (d.imdb_id || null) : (d.external_ids?.imdb_id || null);
        if (imdbId) {
          if (isM) Store.updateMovie(tmdbId, { imdbId });
          else Store.updateTvShow(tmdbId, { imdbId });
        }
      }
      const cast = (d.credits?.cast || []).slice(0, 6);
      if (cast.length) {
        castHtml = `<div class="pd-section"><div class="pd-section-label">Cast</div><div class="pd-cast-row">${cast.map(c => {
          const ph = TMDB.profile(c.profile_path, 'w92');
          return `<div class="pd-cast-card">${ph ? `<img src="${ph}" class="pd-cast-img">` : `<div class="pd-cast-ph"></div>`}<div class="pd-cast-name">${esc(c.name)}</div><div class="pd-cast-char">${esc(c.character || '')}</div></div>`;
        }).join('')}</div></div>`;
      }
    } catch (e) { /* non-fatal, just skip extras */ }
  }

  el.innerHTML = `<div class="pd-wrap">
    <div class="pd-hero">
      <div class="pd-poster">${poster ? `<img src="${poster}">` : `<div class="pd-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div>
      <div class="pd-info">
        <div class="pd-title">${esc(stored.title)}</div>
        <div class="pd-sub">${movieInfo}</div>
        <div class="pd-genres">${genres.map(g => `<span class="pd-genre-tag">${esc(g)}</span>`).join('')}</div>
        <div class="pd-stats">
          <div><div class="pd-stat-val gold">${score}</div><div class="pd-stat-label">${scoreLabel}</div></div>
          ${stored.rewatchCount ? `<div><div class="pd-stat-val">${stored.rewatchCount}</div><div class="pd-stat-label">Rewatches</div></div>` : ''}
        </div>
        <div class="pd-links">
          ${!isAnime ? `<a href="https://www.themoviedb.org/${isM ? 'movie' : 'tv'}/${Math.abs(tmdbId)}" target="_blank">&#8599; TMDB</a>` : ''}
          ${isM && tmdbId > 0 ? `<a href="https://letterboxd.com/tmdb/${Math.abs(tmdbId)}/" target="_blank">&#8599; Letterboxd</a>` : ''}
          ${imdbId ? `<a href="https://www.imdb.com/title/${imdbId}" target="_blank">&#8599; IMDb</a>` : ''}
          ${stored.malId ? `<a href="https://myanimelist.net/anime/${stored.malId}" target="_blank">&#8599; MAL</a>` : ''}
        </div>
      </div>
    </div>
    ${overview ? `<div class="pd-overview">${esc(overview)}</div>` : ''}
    ${castHtml}
    <div class="pd-section"><div class="pd-section-label">Status</div>
      ${buildStatusDropdownHTML(stored.watchStatus, 'pdSt')}
    </div>
    ${seasonHtml}
    <div class="pd-actions">
      <button class="pd-btn pd-btn-open" id="pdOpenFull">Full Details</button>
      <button class="pd-btn pd-btn-diary" id="pdDiaryLog">Diary</button>
      <button class="pd-btn pd-btn-remove" id="pdRemove">Remove</button>
    </div>
    ${relatedHtml}
  </div>`;

  // Bind custom status dropdown
  bindDetailStatusDD('pdSt', tmdbId, mediaType, stored.title, stored.posterPath);

  // Episode +/- (in-place update, no re-render)
  const updateEpInPlace = (sn, newVal) => {
    const show = Store.getTvShow(tmdbId); if (!show) return;
    const isAnimeEntry = show.sourceTag === 'anime' && show.malId;
    const ss = show.seasons || [];
    const s = ss.find(x => x.seasonNumber === sn); if (!s) return;
    const t = s.episodeCount || 0;
    const clamped = t > 0 ? Math.max(0, Math.min(newVal, t)) : Math.max(0, newVal);
    s.episodesWatched = clamped;

    const seasonStatuses = show.seasonStatuses || {};
    const sDone = clamped >= t && t > 0;
    if (sDone && (!seasonStatuses[sn] || seasonStatuses[sn] === 'watching' || seasonStatuses[sn] === 'not_started')) {
      seasonStatuses[sn] = 'completed';
      const nextS = ss.find(x => x.seasonNumber === sn + 1);
      if (nextS && (!seasonStatuses[sn+1] || seasonStatuses[sn+1] === 'not_started')) seasonStatuses[sn+1] = 'watching';
    } else if (clamped > 0 && !sDone && (!seasonStatuses[sn] || seasonStatuses[sn] === 'not_started')) {
      seasonStatuses[sn] = 'watching';
    }
    const allDone = ss.every(x => x.episodesWatched >= (x.episodeCount || 0) && (x.episodeCount || 0) > 0);
    const anyStarted = ss.some(x => x.episodesWatched > 0);
    let ns = show.watchStatus;
    if (allDone) ns = 'completed';
    else if (anyStarted && ns === 'plan_to_watch') ns = 'watching';
    if (isAnimeEntry) Store.updateTvShowByMalId(show.malId, { seasons: ss, watchStatus: ns });
    else Store.updateTvShow(tmdbId, { seasons: ss, watchStatus: ns, seasonStatuses });

    // In-place DOM update
    const input = el.querySelector(`.pd-ep-input[data-sn="${sn}"]`);
    if (input && input !== document.activeElement) input.value = clamped;
    const unknownTotal = t === 0 && clamped > 0;
    const pct = unknownTotal ? 90 : (t > 0 ? Math.round(clamped / t * 100) : 0);
    const bar = el.querySelector(`.pd-season-bar-fill`);
    // Find the bar that corresponds to this season
    const rows = el.querySelectorAll('.pd-ep-row');
    rows.forEach((row, i) => {
      const rowSn = row.querySelector('.pd-ep-btn')?.dataset.sn;
      if (parseInt(rowSn) === sn) {
        const barEl = row.nextElementSibling?.querySelector('.pd-season-bar-fill');
        if (barEl) barEl.style.width = `${pct}%`;
      }
    });
  };

  el.querySelectorAll('.pd-ep-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sn = parseInt(btn.dataset.sn), act = btn.dataset.act;
      const show = Store.getTvShow(tmdbId); if (!show) return;
      const ss = show.seasons || [];
      const s = ss.find(x => x.seasonNumber === sn); if (!s) return;
      const t = s.episodeCount || 0;
      let newVal = s.episodesWatched || 0;
      if (act === 'inc') newVal++;
      else if (act === 'dec') newVal--;
      else return;
      updateEpInPlace(sn, newVal);
    });
  });

  // Editable episode input
  el.querySelectorAll('.pd-ep-input').forEach(input => {
    input.addEventListener('change', () => {
      const sn = parseInt(input.dataset.sn);
      const val = parseInt(input.value) || 0;
      updateEpInPlace(sn, val);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { input.blur(); }
    });
  });

  // Per-season status select dropdown (TMDB TV only)
  el.querySelectorAll('.pd-season-status-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const sn = parseInt(sel.dataset.sn);
      const val = sel.value;
      const show = Store.getTvShow(tmdbId); if (!show) return;
      const ss = show.seasons || [];
      const seasonStatuses = show.seasonStatuses || {};
      seasonStatuses[sn] = val;
      // Cascade logic
      let newShowStatus = show.watchStatus;
      if (val === 'dropped') newShowStatus = 'dropped';
      else if (val === 'on_hold') newShowStatus = 'on_hold';
      else if (val === 'completed') {
        const nextS = ss.find(x => x.seasonNumber === sn + 1);
        if (nextS && (!seasonStatuses[sn+1] || seasonStatuses[sn+1] === 'not_started')) seasonStatuses[sn+1] = 'watching';
        const allCompleted = ss.every(x => (seasonStatuses[x.seasonNumber] || 'not_started') === 'completed');
        newShowStatus = allCompleted ? 'completed' : 'watching';
      } else if (val === 'watching') newShowStatus = 'watching';
      Store.updateTvShow(tmdbId, { seasonStatuses, watchStatus: newShowStatus });
      showDetail(tmdbId, mediaType);
    });
  });

  // Related anime navigation
  el.querySelectorAll('.pd-related-card').forEach(card => {
    card.addEventListener('click', () => {
      const relMal = parseInt(card.dataset.relMal);
      const inStore = Store.getTvShowByMalId(relMal) || Store.getMovies().find(m => m.malId === relMal);
      if (inStore) {
        showDetail(inStore.tmdbId, inStore.mediaType || 'tv');
      } else {
        // Not in library — open full dashboard to the anime detail page
        chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-tv-${-relMal}` });
        window.close();
      }
    });
  });

  el.querySelector('#pdOpenFull').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-${mediaType}-${tmdbId}` }); window.close();
  });

  el.querySelector('#pdDiaryLog')?.addEventListener('click', () => {
    popupDiaryLogModal(tmdbId, mediaType, stored.title, stored.posterPath);
  });

  el.querySelector('#pdRemove').addEventListener('click', () => {
    if (confirm(`Remove "${stored.title}" from your list?`)) {
      if (isM) Store.deleteMovie(tmdbId); else Store.deleteTvShow(tmdbId);
      Store.addActivity({ tmdbId, title: stored.title, type: mediaType, posterPath: stored.posterPath, action: 'removed', detail: 'Removed from list', timestamp: new Date().toISOString() });
      goBackToList();
    }
  });
}

/* ═══════════════════════════════════════════
   TMDB SEARCH
   ═══════════════════════════════════════════ */

async function searchTMDB(query) {
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Searching TMDB...</div>';

  try {
    const results = await TMDB.search(query);
    if (!results.length) { el.innerHTML = '<div class="p-search-msg">No results found</div>'; return; }
    results.sort((a, b) => (a.media_type === 'tv' ? 0 : 1) - (b.media_type === 'tv' ? 0 : 1));

    el.innerHTML = results.slice(0, 12).map(r => {
      const isM = r.media_type === 'movie';
      const title = isM ? r.title : r.name;
      const yr = ((isM ? r.release_date : r.first_air_date) || '').substring(0, 4);
      const poster = TMDB.poster(r.poster_path, 'w92');
      const inList = isM ? Store.hasMovie(r.id) : Store.hasTvShow(r.id);
      return `<div class="p-search-item" data-id="${r.id}" data-type="${r.media_type}">
        <div class="p-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div>
        <div class="p-search-info"><div class="p-search-title">${esc(title)}</div>
          <div class="p-search-sub">${yr}${r.vote_average ? ` · ${r.vote_average.toFixed(1)}` : ''}</div></div>
        <span class="p-search-type p-search-type-${isM ? 'movie' : 'tv'}">${isM ? 'Movie' : 'TV'}</span>
        ${inList ? `<button class="p-add-btn added" disabled>Added</button>` : `<button class="p-add-btn" data-action="add">+ Add</button>`}
      </div>`;
    }).join('');

    el.querySelectorAll('.p-search-item').forEach(item => {
      const addBtn = item.querySelector('[data-action="add"]');
      if (addBtn) {
        addBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(item.dataset.id), type = item.dataset.type;
          addBtn.textContent = '...'; addBtn.disabled = true;
          try {
            if (type === 'movie') {
              const d = await TMDB.movieDetails(id);
              Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.release_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.imdb_id || '', runtime: d.runtime || 0, genres: (d.genres || []).map(g => g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
              Store.addActivity({ tmdbId: d.id, title: d.title, type: 'movie', posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: new Date().toISOString() });
            } else {
              const d = await TMDB.tvDetails(id);
              const ss = (d.seasons || []).filter(s => s.season_number > 0);
              Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.first_air_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.external_ids?.imdb_id || '', totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0, genres: (d.genres || []).map(g => g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s => ({ seasonNumber: s.season_number, episodeCount: s.episode_count || 0, episodesWatched: 0, posterPath: s.poster_path })), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
              Store.addActivity({ tmdbId: d.id, title: d.name, type: 'tv', posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: new Date().toISOString() });
            }
            addBtn.textContent = 'Added'; addBtn.classList.add('added');
          } catch (err) { addBtn.textContent = 'Error'; setTimeout(() => { addBtn.textContent = '+ Add'; addBtn.disabled = false; }, 1500); }
        });
      }
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="add"]') || e.target.closest('.p-add-btn')) return;
        showTMDBDetail(parseInt(item.dataset.id), item.dataset.type);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="p-search-msg" style="color:var(--pdropped)">Error: ${err.message}</div>`;
  }
}

async function showTMDBDetail(tmdbId, mediaType, returnMode = 'list') {
  pMode = 'detail';
  pReturnMode = returnMode || 'list';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pSearch').parentElement.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pRecBtn').classList.add('hidden');
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Loading...</div>';

  const isM = mediaType === 'movie';
  try {
    const d = isM ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId);
    const title = isM ? d.title : d.name;
    const year = (isM ? d.release_date : d.first_air_date || '').substring(0, 4);
    const poster = TMDB.poster(d.poster_path, 'w185');
    const genres = (d.genres || []).slice(0, 4);
    const score = d.vote_average ? d.vote_average.toFixed(1) : '—';
    const overview = (d.overview || '').substring(0, 250) + ((d.overview || '').length > 250 ? '...' : '');
    const inList = isM ? Store.hasMovie(d.id) : Store.hasTvShow(d.id);
    const imdbId = isM ? (d.imdb_id || null) : (d.external_ids?.imdb_id || null);
    const subInfo = isM
      ? [year, d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : '', d.status].filter(Boolean).join(' · ')
      : [year, `${d.number_of_seasons || '?'} Seasons`, `${d.number_of_episodes || '?'} Eps`, d.status].filter(Boolean).join(' · ');

    const cast = (d.credits?.cast || []).slice(0, 6);
    const castHtml = cast.length ? `<div class="pd-section"><div class="pd-section-label">Cast</div><div class="pd-cast-row">${cast.map(c => {
      const ph = TMDB.profile(c.profile_path, 'w92');
      return `<div class="pd-cast-card">${ph ? `<img src="${ph}" class="pd-cast-img">` : `<div class="pd-cast-ph"></div>`}<div class="pd-cast-name">${esc(c.name)}</div><div class="pd-cast-char">${esc(c.character || '')}</div></div>`;
    }).join('')}</div></div>` : '';

    el.innerHTML = `<div class="pd-wrap">
      <div class="pd-hero">
        <div class="pd-poster">${poster ? `<img src="${poster}">` : `<div class="pd-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div>
        <div class="pd-info">
          <div class="pd-title">${esc(title)}</div>
          <div class="pd-sub">${subInfo}</div>
          <div class="pd-genres">${genres.map(g => `<span class="pd-genre-tag">${esc(g.name)}</span>`).join('')}</div>
          <div class="pd-stats">
            <div><div class="pd-stat-val gold">${score}</div><div class="pd-stat-label">TMDB</div></div>
            ${d.popularity ? `<div><div class="pd-stat-val">${Math.round(d.popularity)}</div><div class="pd-stat-label">Popularity</div></div>` : ''}
          </div>
        </div>
      </div>
      ${overview ? `<div class="pd-overview">${esc(overview)}</div>` : ''}
      ${castHtml}
      <div class="pd-actions">
        ${inList ? `<button class="pd-btn pd-btn-open" id="pdOpenFull">View in Dashboard</button>`
        : `<button class="pd-btn pd-btn-add" id="pdAdd">+ Add to List</button>`}
      </div>
      <div class="pd-links">
        <a href="https://www.themoviedb.org/${isM ? 'movie' : 'tv'}/${d.id}" target="_blank">&#8599; TMDB</a>
        ${isM ? `<a href="https://letterboxd.com/tmdb/${d.id}/" target="_blank">&#8599; Letterboxd</a>` : ''}
        ${imdbId ? `<a href="https://www.imdb.com/title/${imdbId}" target="_blank">&#8599; IMDb</a>` : ''}
      </div>
    </div>`;

    if (!inList) {
      el.querySelector('#pdAdd').addEventListener('click', async () => {
        const btn = el.querySelector('#pdAdd'); btn.textContent = 'Adding...'; btn.disabled = true;
        try {
          if (isM) Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt(year) || 0, voteAverage: d.vote_average || 0, runtime: d.runtime || 0, genres: genres.map(g => g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
          else { const ss = (d.seasons || []).filter(s => s.season_number > 0); Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt(year) || 0, voteAverage: d.vote_average || 0, totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0, genres: genres.map(g => g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s => ({ seasonNumber: s.season_number, episodeCount: s.episode_count || 0, episodesWatched: 0, posterPath: s.poster_path })), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() }); }
          Store.addActivity({ tmdbId: d.id, title, type: mediaType, posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: new Date().toISOString() });
          showDetail(d.id, mediaType, pReturnMode);
        } catch (err) { btn.textContent = 'Error'; }
      });
    } else {
      el.querySelector('#pdOpenFull').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-${mediaType}-${tmdbId}` }); window.close();
      });
    }
  } catch (err) {
    el.innerHTML = `<div class="p-search-msg" style="color:var(--pdropped)">Failed: ${err.message}</div>`;
  }
}

/* ═══════════════════════════════════════════
   POPUP DIARY — Log Modal + Edit Modal
   ═══════════════════════════════════════════ */

function popupDiaryLogModal(tmdbId, mediaType, title, posterPath) {
  const today = new Date().toISOString().substring(0, 10);
  const poster = TMDB.poster(posterPath, 'w185');
  const isM = mediaType === 'movie';
  const st = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
  const sOpts = !isM && st ? (st.seasons || []).map(s => `<option value="${s.seasonNumber}">S${s.seasonNumber}</option>`).join('') : '';

  // History
  const entries = Store.getDiary().filter(d => d.tmdbId === tmdbId && d.type === mediaType);
  const aL = { completed: 'Completed', rewatch: 'Rewatched', watched: 'Watched', watched_episodes: 'Watched eps', started: 'Started', session: 'Session' };
  const histHtml = entries.length ? `<div class="pdl-hist"><div class="pdl-hist-head">Diary History (${entries.length})</div>${entries.map(de => {
    const a = aL[de.action] || de.action; const r = de.rating ? ` · ★${de.rating}` : ''; const s = de.season ? ` · S${de.season}` : '';
    return `<div class="pdl-hrow"><div class="pdl-hinfo"><span class="pdl-hdate">${de.date || '—'}</span> <span class="pdl-hact">${a}${s}${r}</span></div><button class="pdl-hedit" data-ts="${de.timestamp}">Edit</button><button class="pdl-hdel" data-tmdb="${de.tmdbId}" data-ts="${de.timestamp}">Remove</button></div>`;
  }).join('')}</div>` : '';

  const html = `<div class="pdl-overlay" id="pdlModal"><div class="pdl-box"><div class="pdl-header"><span>Log Diary</span><button class="pdl-close" id="pdlX">&#10005;</button></div><div class="pdl-body">
    <div class="pdl-hero"><div class="pdl-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div><div><div class="pdl-name">${esc(title)}</div></div></div>
    <div class="pdl-form">
      <div class="pdl-row"><label>Date</label><input type="date" id="pdlDate" value="${today}" class="pdl-inp"></div>
      <div class="pdl-row2">
        <div class="pdl-row" style="flex:1;"><label>Action</label><select id="pdlAction" class="pdl-inp"><option value="watched">Watched</option><option value="rewatch">Rewatched</option></select></div>
        <div class="pdl-row" style="flex:1;"><label>Rating</label><select id="pdlRating" class="pdl-inp"><option value="0">— None —</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}">★ ${n}/10</option>`).join('')}</select></div>
      </div>
      ${!isM ? `<div class="pdl-row"><label>Season</label><select id="pdlSeason" class="pdl-inp"><option value="">All</option>${sOpts}</select></div>` : ''}
      <div class="pdl-row"><label>Notes</label><textarea id="pdlNotes" class="pdl-inp pdl-ta" rows="2" placeholder="Quick thoughts..."></textarea></div>
      <button class="pdl-save" id="pdlSave">Save Entry</button>
    </div>
    ${histHtml}
  </div></div></div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const m = document.getElementById('pdlModal');
  const close = () => m.remove();
  m.querySelector('#pdlX').addEventListener('click', close);
  m.addEventListener('click', e => { if (e.target === m) close(); });

  m.querySelectorAll('.pdl-hedit').forEach(b => { b.addEventListener('click', () => { close(); popupEditDiaryEntry(b.dataset.ts); }); });
  m.querySelectorAll('.pdl-hdel').forEach(b => { b.addEventListener('click', () => { if (confirm('Remove?')) { Store.removeDiaryEntry(parseInt(b.dataset.tmdb), b.dataset.ts); close(); popupDiaryLogModal(tmdbId, mediaType, title, posterPath); } }); });

  m.querySelector('#pdlSave').addEventListener('click', () => {
    const date = m.querySelector('#pdlDate').value; if (!date) return;
    const action = m.querySelector('#pdlAction').value;
    const notes = m.querySelector('#pdlNotes').value.trim();
    const rating = parseInt(m.querySelector('#pdlRating').value) || null;
    const season = !isM && m.querySelector('#pdlSeason') ? parseInt(m.querySelector('#pdlSeason').value) || null : null;
    Store.addDiaryEntry({ tmdbId, title, type: mediaType, posterPath, date, action, notes, rating, mood: null, episodes: null, season, timestamp: new Date().toISOString() });
    close();
    if (pMode === 'diary') renderPopupDiary();
    else showDetail(tmdbId, mediaType);
  });
}

function popupEditDiaryEntry(timestamp) {
  const entry = Store.getDiaryEntry(timestamp);
  if (!entry) return;
  const isM = entry.type === 'movie';

  const html = `<div class="pdl-overlay" id="pdleModal"><div class="pdl-box"><div class="pdl-header"><span>Edit Entry</span><button class="pdl-close" id="pdleX">&#10005;</button></div><div class="pdl-body"><div class="pdl-form">
    <div class="pdl-row"><label>Date</label><input type="date" id="pdleDate" value="${entry.date || ''}" class="pdl-inp"></div>
    <div class="pdl-row2">
      <div class="pdl-row" style="flex:1;"><label>Action</label><select id="pdleAction" class="pdl-inp"><option value="watched" ${entry.action === 'watched' ? 'selected' : ''}>Watched</option><option value="rewatch" ${entry.action === 'rewatch' ? 'selected' : ''}>Rewatched</option></select></div>
      <div class="pdl-row" style="flex:1;"><label>Rating</label><select id="pdleRating" class="pdl-inp"><option value="0">— None —</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}" ${entry.rating === n ? 'selected' : ''}>★ ${n}/10</option>`).join('')}</select></div>
    </div>
    <div class="pdl-row"><label>Notes</label><textarea id="pdleNotes" class="pdl-inp pdl-ta" rows="2">${esc(entry.notes || '')}</textarea></div>
    <div style="display:flex;gap:6px;"><button class="pdl-save" id="pdleSave" style="flex:1;">Save</button><button class="pdl-back" id="pdleBack">Back</button></div>
  </div></div></div></div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const m = document.getElementById('pdleModal');
  const close = () => m.remove();
  m.querySelector('#pdleX').addEventListener('click', close);
  m.querySelector('#pdleBack').addEventListener('click', () => { close(); if (pMode === 'diary') renderPopupDiary(); });

  m.querySelector('#pdleSave').addEventListener('click', () => {
    Store.updateDiaryEntry(timestamp, {
      date: m.querySelector('#pdleDate').value,
      action: m.querySelector('#pdleAction').value,
      rating: parseInt(m.querySelector('#pdleRating').value) || null,
      notes: m.querySelector('#pdleNotes').value.trim(),
    });
    close();
    if (pMode === 'diary') renderPopupDiary();
  });
}

/* ─── Helpers ─── */
function getPct(i) {
  if (i.mediaType === 'tv') {
    const ss = i.seasons || []; const w = ss.reduce((s, se) => s + (se.episodesWatched || 0), 0);
    const t = ss.reduce((s, se) => s + (se.episodeCount || 0), 0);
    return t === 0 && w > 0 ? 90 : (t > 0 ? Math.round(w / t * 100) : 0);
  }
  return i.watchStatus === 'completed' ? 100 : i.watchStatus === 'watching' ? 40 : 0;
}
function getEps(i) {
  if (i.mediaType !== 'tv') return '';
  const ss = i.seasons || []; const w = ss.reduce((s, se) => s + (se.episodesWatched || 0), 0);
  const t = ss.reduce((s, se) => s + (se.episodeCount || 0), 0);
  return `${w}<span class="p-eps-total">/${t || '?'}</span>`;
}
function esc(s) { if (!s) return ''; const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }
