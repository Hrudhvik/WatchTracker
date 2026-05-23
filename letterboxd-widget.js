(() => {
  const isLetterboxdHomePage = () => (
    window.location.protocol === 'https:' &&
    window.location.hostname === 'letterboxd.com' &&
    window.location.pathname === '/'
  );

  if (!isLetterboxdHomePage()) {
    try {
      document.getElementById('wt-letterboxd-dice')?.remove();
      document.getElementById('wt-letterboxd-widget')?.remove();
    } catch (_) {}
    return;
  }

  const WIDGET_VERSION = '3.3.2';
  if (window.__watchTrackerLetterboxdWidgetVersion === WIDGET_VERSION) return;

  // Older builds left a boolean flag on the page. Remove their DOM and allow this
  // newer styled widget to mount instead of silently keeping the old teal button.
  try {
    document.getElementById('wt-letterboxd-dice')?.remove();
    document.getElementById('wt-letterboxd-widget')?.remove();
  } catch (_) {}

  window.__watchTrackerLetterboxdWidget = true;
  window.__watchTrackerLetterboxdWidgetVersion = WIDGET_VERSION;

  const GENRES = {
    Action: 28,
    Adventure: 12,
    Animation: 16,
    Comedy: 35,
    Crime: 80,
    Documentary: 99,
    Drama: 18,
    Family: 10751,
    Fantasy: 14,
    History: 36,
    Horror: 27,
    Music: 10402,
    Mystery: 9648,
    Romance: 10749,
    'Science Fiction': 878,
    'TV Movie': 10770,
    Thriller: 53,
    War: 10752,
    Western: 37,
  };

  const GENRE_NAMES_BY_ID = Object.fromEntries(Object.entries(GENRES).map(([name, id]) => [id, name]));
  const DECADES = [
    { label: 'Any year', value: '' },
    { label: '2020s', value: '2020s', gte: '2020-01-01', lte: '2029-12-31' },
    { label: '2010s', value: '2010s', gte: '2010-01-01', lte: '2019-12-31' },
    { label: '2000s', value: '2000s', gte: '2000-01-01', lte: '2009-12-31' },
    { label: '1990s', value: '1990s', gte: '1990-01-01', lte: '1999-12-31' },
    { label: '1980s', value: '1980s', gte: '1980-01-01', lte: '1989-12-31' },
    { label: '1970s', value: '1970s', gte: '1970-01-01', lte: '1979-12-31' },
    { label: '1960s', value: '1960s', gte: '1960-01-01', lte: '1969-12-31' },
    { label: '1950s', value: '1950s', gte: '1950-01-01', lte: '1959-12-31' },
    { label: '1940s', value: '1940s', gte: '1940-01-01', lte: '1949-12-31' },
    { label: '1930s', value: '1930s', gte: '1930-01-01', lte: '1939-12-31' },
    { label: '1920s', value: '1920s', gte: '1920-01-01', lte: '1929-12-31' },
    { label: '1910s', value: '1910s', gte: '1910-01-01', lte: '1919-12-31' },
    { label: '1900s', value: '1900s', gte: '1900-01-01', lte: '1909-12-31' },
    { label: 'Before 1900', value: 'pre1900', lte: '1899-12-31' },
  ];
  const DECADE_BY_VALUE = Object.fromEntries(DECADES.map(decade => [decade.value, decade]));


  const LANGUAGE_ALIASES = {
    english: 'en', hindi: 'hi', telugu: 'te', telgu: 'te', telegu: 'te', tamil: 'ta', malayalam: 'ml', malayam: 'ml', malyalam: 'ml', kannada: 'kn', kanada: 'kn', bengali: 'bn', bangla: 'bn', marathi: 'mr', punjabi: 'pa', gujarati: 'gu', urdu: 'ur', odia: 'or', oriya: 'or', assamese: 'as', nepali: 'ne', sinhala: 'si', japanese: 'ja', korean: 'ko', chinese: 'zh', mandarin: 'zh', cantonese: 'cn', thai: 'th', indonesian: 'id', malay: 'ms', tagalog: 'tl', filipino: 'tl', vietnamese: 'vi', french: 'fr', spanish: 'es', italian: 'it', german: 'de', portuguese: 'pt', russian: 'ru', turkish: 'tr', arabic: 'ar', persian: 'fa', farsi: 'fa', hebrew: 'he'
  };

  const STORAGE_KEYS = {
    enabled: 'letterboxdWidgetEnabled',
    shown: 'watchtracker-letterboxd-shown-v2',
    prefs: 'watchtracker-letterboxd-prefs-v2',
  };

  let mounted = false;
  let diceButton = null;
  let widget = null;

  const posterUrl = path => path ? `https://image.tmdb.org/t/p/w185${path}` : '';
  const backdropUrl = path => path ? `https://image.tmdb.org/t/p/w300${path}` : '';
  const letterboxdTmdbUrl = id => `https://letterboxd.com/tmdb/${id}/`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
  const clampRating = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return String(Math.min(10, Math.max(0, n)));
  };

  function normalizeLanguage(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const paren = raw.match(/\(([a-z]{2})\)$/i);
    if (paren) return paren[1].toLowerCase();
    const key = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (LANGUAGE_ALIASES[key]) return LANGUAGE_ALIASES[key];
    if (/^[a-z]{2}$/i.test(raw)) return raw.toLowerCase();
    return key;
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || '') || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function clearSuggestionMemory() {
    const prefixes = [
      'watchtracker-letterboxd-shown',
      'wt-letterboxd-shown',
    ];

    for (const storage of [sessionStorage, localStorage]) {
      try {
        for (const key of Object.keys(storage)) {
          if (prefixes.some(prefix => key.startsWith(prefix))) storage.removeItem(key);
        }
      } catch (_) {}
    }

    try { sessionStorage.removeItem(STORAGE_KEYS.shown); } catch (_) {}
    try { localStorage.removeItem(STORAGE_KEYS.shown); } catch (_) {}
  }

  function filterKey(filters) {
    return [filters.genre || 'any', filters.language || 'any', filters.rating || 'any', filters.decade || 'any-year', filters.includeWatched ? 'include-watched' : 'unwatched-only'].join('|');
  }

  function getShown(filters) {
    const all = readJson(STORAGE_KEYS.shown, {});
    return new Set(all[filterKey(filters)] || []);
  }

  function rememberShown(filters, movieId) {
    const all = readJson(STORAGE_KEYS.shown, {});
    const key = filterKey(filters);
    const list = Array.isArray(all[key]) ? all[key] : [];
    all[key] = [movieId, ...list.filter(id => id !== movieId)].slice(0, 200);
    writeJson(STORAGE_KEYS.shown, all);
  }

  function savePrefs(filters) {
    writeJson(STORAGE_KEYS.prefs, filters);
  }

  function loadPrefs() {
    return readJson(STORAGE_KEYS.prefs, { genre: '', language: '', rating: '7', decade: '', includeWatched: false });
  }

  function getWatchedMovieIds() {
    return new Promise(resolve => {
      chrome.storage.local.get(['movies', 'diary'], data => {
        const ids = new Set();
        const addId = item => {
          const raw = item?.tmdbId ?? item?.id;
          const id = Number(raw);
          if (Number.isFinite(id) && id > 0) ids.add(id);
        };

        (Array.isArray(data.movies) ? data.movies : []).forEach(addId);
        (Array.isArray(data.diary) ? data.diary : [])
          .filter(entry => !entry?.type || entry.type === 'movie')
          .forEach(addId);

        resolve(ids);
      });
    });
  }

  function bgFetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'fetch', url }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || `Request failed (${response?.status || 0})`));
          return;
        }
        resolve(response.body);
      });
    });
  }

  function getApiKey() {
    return new Promise(resolve => {
      chrome.storage.local.get(['apiKey'], data => resolve(data.apiKey || ''));
    });
  }

  function getEnabled() {
    return new Promise(resolve => {
      chrome.storage.local.get([STORAGE_KEYS.enabled], data => {
        resolve(data[STORAGE_KEYS.enabled] !== false);
      });
    });
  }

  function randomInt(maxExclusive) {
    const max = Math.max(0, Math.floor(Number(maxExclusive) || 0));
    if (max <= 1) return 0;
    try {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0] % max;
    } catch (_) {
      return Math.floor(Math.random() * max);
    }
  }

  function randomChoice(items, fallback = '') {
    return items?.length ? items[randomInt(items.length)] : fallback;
  }

  function buildDiscoverUrl(apiKey, filters, page = 1, sortBy = 'popularity.desc') {
    const url = new URL('https://api.themoviedb.org/3/discover/movie');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('include_adult', 'false');
    url.searchParams.set('include_video', 'false');
    url.searchParams.set('sort_by', sortBy);
    url.searchParams.set('page', String(page));
    url.searchParams.set('vote_count.gte', filters.language ? '0' : '20');
    if (filters.genre) url.searchParams.set('with_genres', String(GENRES[filters.genre]));
    if (filters.language) url.searchParams.set('with_original_language', filters.language);
    if (filters.rating) url.searchParams.set('vote_average.gte', String(filters.rating));
    const decade = DECADE_BY_VALUE[filters.decade || ''];
    if (decade?.gte) url.searchParams.set('primary_release_date.gte', decade.gte);
    if (decade?.lte) url.searchParams.set('primary_release_date.lte', decade.lte);
    return url.toString();
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function validMovie(movie) {
    return movie && movie.id && movie.title && !movie.adult && movie.vote_average > 0;
  }

  async function suggestMovie(filters) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('Add your TMDB API key in WatchTracker settings first.');

    const watchedIds = filters.includeWatched ? new Set() : await getWatchedMovieIds();
    const shown = getShown(filters);
    const sortOptions = [
      'popularity.desc',
      'vote_average.desc',
      'vote_count.desc',
      'primary_release_date.desc',
      'revenue.desc',
    ];
    const chosenSorts = shuffle(sortOptions).slice(0, 3);
    const pool = [];

    const collectCandidates = results => {
      for (const movie of results || []) {
        if (!validMovie(movie)) continue;
        if (!filters.includeWatched && watchedIds.has(Number(movie.id))) continue;
        if (shown.has(movie.id)) continue;
        if (!pool.some(existing => existing.id === movie.id)) pool.push(movie);
      }
    };

    for (const sortBy of chosenSorts) {
      const first = await bgFetch(buildDiscoverUrl(apiKey, filters, 1, sortBy));
      const totalPages = Math.min(Number(first.total_pages || 1), 500);
      collectCandidates(first.results);

      const pageLimit = Math.min(totalPages, filters.language ? 80 : 120);
      const pages = shuffle(Array.from({ length: pageLimit }, (_, i) => i + 1)).filter(page => page !== 1).slice(0, 5);
      for (const page of pages) {
        const data = await bgFetch(buildDiscoverUrl(apiKey, filters, page, sortBy));
        collectCandidates(data.results);
      }

      if (pool.length >= 20) break;
    }

    if (pool.length) return randomChoice(pool);

    // If the tab memory has hidden every candidate, clear only this filter's shown
    // list and try a small fresh sample so Reset is not required to recover.
    const all = readJson(STORAGE_KEYS.shown, {});
    delete all[filterKey(filters)];
    writeJson(STORAGE_KEYS.shown, all);
    const retrySort = randomChoice(sortOptions, 'popularity.desc');
    const retryFirst = await bgFetch(buildDiscoverUrl(apiKey, filters, 1, retrySort));
    const totalPages = Math.min(Number(retryFirst.total_pages || 1), 500);
    const retryPage = totalPages > 1 ? 1 + randomInt(Math.min(totalPages, 120)) : 1;
    const retryData = retryPage === 1 ? retryFirst : await bgFetch(buildDiscoverUrl(apiKey, filters, retryPage, retrySort));
    const retryPool = (retryData.results || []).filter(validMovie).filter(movie => filters.includeWatched || !watchedIds.has(Number(movie.id)));
    return randomChoice(retryPool, null);
  }

  function mountWidget() {
    if (mounted) return;
    mounted = true;

    diceButton = document.createElement('button');
    diceButton.id = 'wt-letterboxd-dice';
    diceButton.type = 'button';
    diceButton.title = 'WatchTracker random movie';
    diceButton.setAttribute('aria-label', 'Open WatchTracker random movie picker');
    diceButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"></rect><circle cx="8.5" cy="8.5" r="1" fill="currentColor" stroke="none"></circle><circle cx="15.5" cy="8.5" r="1" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"></circle><circle cx="8.5" cy="15.5" r="1" fill="currentColor" stroke="none"></circle><circle cx="15.5" cy="15.5" r="1" fill="currentColor" stroke="none"></circle></svg>';
    // Inline critical positioning so the button is visible even if CSS injection is delayed.
    diceButton.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483646;width:44px;height:44px;border-radius:999px;border:1px solid rgba(0,224,84,.55);background:#00c030;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px rgba(0,0,0,.46),inset 0 0 0 1px rgba(255,255,255,.06);cursor:pointer;padding:0;appearance:none;-webkit-appearance:none;font-size:0;line-height:0;';

    widget = document.createElement('section');
    widget.id = 'wt-letterboxd-widget';
    widget.hidden = true;
    widget.style.cssText = 'position:fixed;right:24px;bottom:78px;z-index:2147483647;width:min(365px,calc(100vw - 32px));max-height:none;overflow:visible;border:1px solid rgba(153,170,187,.18);border-radius:14px;background:#14181c;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.62);';

    const genreOptions = ['<option value="">Any genre</option>']
      .concat(Object.keys(GENRES).map(genre => `<option value="${genre}">${genre}</option>`))
      .join('');
    const decadeOptions = DECADES
      .map(decade => `<option value="${decade.value}">${decade.label}</option>`)
      .join('');

    widget.innerHTML = `
      <div class="wt-lb-inner">
        <div class="wt-lb-head">
          <div>
            <div class="wt-lb-kicker">WatchTracker</div>
            <div class="wt-lb-title">Surprise movie</div>
            <div class="wt-lb-subtitle">Find a random Letterboxd-friendly pick.</div>
          </div>
          <button class="wt-lb-close" type="button" aria-label="Close">×</button>
        </div>

        <div class="wt-lb-grid">
        <div class="wt-lb-field">
          <label for="wt-lb-genre">Genre</label>
          <select id="wt-lb-genre">${genreOptions}</select>
        </div>
        <div class="wt-lb-field">
          <label for="wt-lb-decade">Year</label>
          <select id="wt-lb-decade">${decadeOptions}</select>
        </div>
        <div class="wt-lb-row">
          <div class="wt-lb-field">
            <label for="wt-lb-language">Language</label>
            <input id="wt-lb-language" placeholder="English or en">
          </div>
          <div class="wt-lb-field">
            <label for="wt-lb-rating">Min rating</label>
            <input id="wt-lb-rating" type="number" min="0" max="10" step="0.1" placeholder="7.0">
          </div>
        </div>
        <label class="wt-lb-check">
          <input id="wt-lb-include-watched" type="checkbox">
          <span>Include already watched</span>
        </label>
      </div>

        <div class="wt-lb-actions">
          <button class="wt-lb-primary" type="button">Surprise</button>
          <button class="wt-lb-secondary" type="button" title="Clear suggestion memory">Reset memory</button>
        </div>
        <div class="wt-lb-status" role="status"></div>
        <div class="wt-lb-result"></div>
      </div>
    `;

    (document.body || document.documentElement).append(diceButton, widget);

    const prefs = loadPrefs();
    const genreInput = widget.querySelector('#wt-lb-genre');
    const decadeInput = widget.querySelector('#wt-lb-decade');
    const languageInput = widget.querySelector('#wt-lb-language');
    const ratingInput = widget.querySelector('#wt-lb-rating');
    const includeWatchedInput = widget.querySelector('#wt-lb-include-watched');
    const surpriseBtn = widget.querySelector('.wt-lb-primary');
    const resetBtn = widget.querySelector('.wt-lb-secondary');
    const closeBtn = widget.querySelector('.wt-lb-close');
    const status = widget.querySelector('.wt-lb-status');
    const result = widget.querySelector('.wt-lb-result');

    genreInput.value = GENRES[prefs.genre] ? prefs.genre : '';
    decadeInput.value = DECADE_BY_VALUE[prefs.decade] ? prefs.decade : '';
    languageInput.value = prefs.languageLabel || prefs.language || '';
    ratingInput.value = prefs.rating || '7';
    includeWatchedInput.checked = Boolean(prefs.includeWatched);

    const readFilters = () => ({
      genre: genreInput.value,
      decade: decadeInput.value,
      language: normalizeLanguage(languageInput.value),
      languageLabel: languageInput.value.trim(),
      rating: clampRating(ratingInput.value),
      includeWatched: includeWatchedInput.checked,
    });

    const renderMovie = movie => {
      const year = movie.release_date ? movie.release_date.slice(0, 4) : 'N/A';
      const rating = Number(movie.vote_average || 0).toFixed(1);
      const title = escapeHtml(movie.title);
      const overview = escapeHtml(movie.overview || 'No overview available.');
      const genreText = (movie.genre_ids || []).map(id => GENRE_NAMES_BY_ID[id]).filter(Boolean).slice(0, 3).join(', ') || 'Movie';
      const language = movie.original_language ? movie.original_language.toUpperCase() : 'N/A';
      const goUrl = letterboxdTmdbUrl(movie.id);
      result.innerHTML = `
        <article class="wt-lb-card">
          ${movie.poster_path ? `<img class="wt-lb-poster" src="${posterUrl(movie.poster_path)}" alt="${title} poster">` : '<div class="wt-lb-poster" aria-hidden="true"></div>'}
          <div class="wt-lb-card-body">
            <div class="wt-lb-movie-title">${title}</div>
            <div class="wt-lb-meta">${escapeHtml(year)} · ${escapeHtml(language)} · TMDB ${rating}/10</div>
            <div class="wt-lb-tags">${escapeHtml(genreText)}</div>
            <div class="wt-lb-overview">${overview}</div>
            <a class="wt-lb-go" href="${goUrl}">Go</a>
          </div>
        </article>
      `;
    };

    const runSuggest = async () => {
      const filters = readFilters();
      savePrefs(filters);
      surpriseBtn.disabled = true;
      status.textContent = filters.includeWatched
        ? 'Finding a movie…'
        : 'Finding an unwatched movie…';
      try {
        const movie = await suggestMovie(filters);
        if (!movie) throw new Error(filters.includeWatched ? 'No movie matched those filters. Try a lower rating or fewer filters.' : 'No unwatched movie matched those filters. Try including already watched movies, lowering the rating, or using fewer filters.');
        rememberShown(filters, movie.id);
        renderMovie(movie);
        status.textContent = 'Surprise ready.';
      } catch (error) {
        status.textContent = error.message || 'Could not fetch a suggestion.';
      } finally {
        surpriseBtn.disabled = false;
      }
    };

    diceButton.addEventListener('click', () => {
      widget.hidden = !widget.hidden;
      diceButton.setAttribute('aria-expanded', String(!widget.hidden));
      if (!widget.hidden) setTimeout(() => genreInput.focus(), 0);
    });
    closeBtn.addEventListener('click', () => { widget.hidden = true; diceButton.setAttribute('aria-expanded', 'false'); });
    surpriseBtn.addEventListener('click', runSuggest);
    resetBtn.addEventListener('click', () => {
      clearSuggestionMemory();
      try { sessionStorage.removeItem(STORAGE_KEYS.prefs); } catch (_) {}
      genreInput.value = '';
      decadeInput.value = '';
      languageInput.value = '';
      ratingInput.value = '';
      includeWatchedInput.checked = false;
      result.innerHTML = '';
      status.textContent = 'Inputs, result, and temporary suggestion memory cleared.';
      resetBtn.textContent = 'Cleared';
      window.setTimeout(() => { resetBtn.textContent = 'Reset memory'; }, 1200);
    });
    widget.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('input, select')) runSuggest();
      if (event.key === 'Escape') { widget.hidden = true; diceButton.setAttribute('aria-expanded', 'false'); }
    });
  }

  function unmountWidget() {
    mounted = false;
    diceButton?.remove();
    widget?.remove();
    diceButton = null;
    widget = null;
  }

  async function init() {
    if (await getEnabled()) mountWidget();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.enabled]) return;
    const enabled = changes[STORAGE_KEYS.enabled].newValue !== false;
    if (enabled) mountWidget();
    else unmountWidget();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
