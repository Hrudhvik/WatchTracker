/* ═══════════════════════════════════════════
   Store — chrome.storage.local wrapper
   ═══════════════════════════════════════════ */

const Store = {
  _data: { apiKey: '', movies: [], tvshows: [], diary: [], activity: [], theme: null, popupPrefs: null },

  async load() {
    return new Promise(resolve => {
      chrome.storage.local.get(['apiKey', 'movies', 'tvshows', 'diary', 'activity', 'theme', 'popupPrefs'], d => {
        this._data.apiKey = d.apiKey || '';
        this._data.movies = d.movies || [];
        this._data.tvshows = d.tvshows || [];
        this._data.diary = d.diary || [];
        this._data.activity = d.activity || [];
        this._data.theme = d.theme || null;
        this._data.popupPrefs = d.popupPrefs || null;
        resolve(this._data);
      });
    });
  },

  // API Key
  getApiKey() { return this._data.apiKey; },
  setApiKey(key) {
    this._data.apiKey = key;
    chrome.storage.local.set({ apiKey: key });
  },

  // ─── Movies ───
  getMovies() { return this._data.movies; },

  addMovie(item) {
    if (this._data.movies.find(m => m.tmdbId === item.tmdbId)) return false;
    this._data.movies.unshift(item);
    this._saveMovies();
    return true;
  },

  updateMovie(tmdbId, updates) {
    const idx = this._data.movies.findIndex(m => m.tmdbId === tmdbId);
    if (idx === -1) return;
    Object.assign(this._data.movies[idx], updates, { dateUpdated: new Date().toISOString() });
    this._saveMovies();
  },

  removeMovie(tmdbId) {
    this._data.movies = this._data.movies.filter(m => m.tmdbId !== tmdbId);
    this._saveMovies();
  },

  hasMovie(tmdbId) {
    return this._data.movies.some(m => m.tmdbId === tmdbId);
  },

  getMovie(tmdbId) {
    return this._data.movies.find(m => m.tmdbId === tmdbId);
  },

  _saveMovies() {
    chrome.storage.local.set({ movies: this._data.movies });
  },

  // ─── TV Shows ───
  getTvShows() { return this._data.tvshows; },

  addTvShow(item) {
    if (this._data.tvshows.find(t => t.tmdbId === item.tmdbId)) return false;
    this._data.tvshows.unshift(item);
    this._saveTvShows();
    return true;
  },

  updateTvShow(tmdbId, updates) {
    const idx = this._data.tvshows.findIndex(t => t.tmdbId === tmdbId);
    if (idx === -1) return;
    Object.assign(this._data.tvshows[idx], updates, { dateUpdated: new Date().toISOString() });
    this._saveTvShows();
  },

  removeTvShow(tmdbId) {
    this._data.tvshows = this._data.tvshows.filter(t => t.tmdbId !== tmdbId);
    this._saveTvShows();
  },

  hasTvShow(tmdbId) {
    return this._data.tvshows.some(t => t.tmdbId === tmdbId);
  },

  getTvShow(tmdbId) {
    return this._data.tvshows.find(t => t.tmdbId === tmdbId);
  },

  _saveTvShows() {
    chrome.storage.local.set({ tvshows: this._data.tvshows });
  },

  // ─── Diary (completion log) ───
  getDiary() { return this._data.diary; },

  addDiaryEntry(entry) {
    // entry: { tmdbId, title, type, posterPath, date, action, notes, rating, mood, episodes, timestamp }
    this._data.diary.unshift(entry);
    chrome.storage.local.set({ diary: this._data.diary });
  },

  removeDiaryEntry(tmdbId, timestamp) {
    if (timestamp) { this._data.diary = this._data.diary.filter(d => !(d.tmdbId === tmdbId && d.timestamp === timestamp)); }
    else { const i = this._data.diary.findIndex(d => d.tmdbId === tmdbId); if (i !== -1) this._data.diary.splice(i, 1); }
    chrome.storage.local.set({ diary: this._data.diary });
  },
  updateDiaryEntry(ts, u) { const i = this._data.diary.findIndex(d => d.timestamp === ts); if (i >= 0) { Object.assign(this._data.diary[i], u); chrome.storage.local.set({ diary: this._data.diary }); } },
  getDiaryEntry(ts) { return this._data.diary.find(d => d.timestamp === ts); },
  getUserRating(id, t) { const e = this._data.diary.filter(d => d.tmdbId === id && d.type === t && d.rating); return e.length ? e[0].rating : null; },
  getSeasonRatings(id) { const m = {}; this._data.diary.filter(d => d.tmdbId === id && d.type === 'tv' && d.rating && d.season).forEach(e => { if (!m[e.season]) m[e.season] = e.rating; }); return m; },
  getAvgUserRating(id, t) { const e = this._data.diary.filter(d => d.tmdbId === id && d.type === t && d.rating); return e.length ? e.reduce((s, d) => s + d.rating, 0) / e.length : null; },

  getActivity() { return this._data.activity; },
  addActivity(entry) { this._data.activity.unshift(entry); if (this._data.activity.length > 100) this._data.activity = this._data.activity.slice(0, 100); chrome.storage.local.set({ activity: this._data.activity }); },

  getAll() { return [...this._data.movies.map(m => ({ ...m, mediaType: 'movie' })), ...this._data.tvshows.map(t => ({ ...t, mediaType: 'tv' }))]; },
  deleteMovie(id) { this.removeMovie(id); },
  deleteTvShow(id) { this.removeTvShow(id); },
  getTheme() { return this._data.theme; },
  setTheme(t) { this._data.theme = t; chrome.storage.local.set({ theme: t }); },
  getPopupPrefs() { return this._data.popupPrefs; },
  setPopupPrefs(p) { this._data.popupPrefs = p; chrome.storage.local.set({ popupPrefs: p }); },

  // ─── Export/Import ───
  exportAll() {
    return JSON.stringify({
      version: 2,
      movies: this._data.movies,
      tvshows: this._data.tvshows,
      diary: this._data.diary,
      activity: this._data.activity,
      exportedAt: new Date().toISOString(),
    }, null, 2);
  },

  importAll(json) {
    const data = JSON.parse(json);
    if (data.movies) this._data.movies = data.movies;
    if (data.tvshows) this._data.tvshows = data.tvshows;
    if (data.diary) this._data.diary = data.diary;
    if (data.activity) this._data.activity = data.activity;
    this._saveMovies();
    this._saveTvShows();
    chrome.storage.local.set({ diary: this._data.diary, activity: this._data.activity });
    return { movies: this._data.movies.length, tvshows: this._data.tvshows.length };
  },
};
