/* ═══════════════════════════════════════════
   Store — chrome.storage.local wrapper
   ═══════════════════════════════════════════ */


const DEFAULT_QUICK_LINKS = [
  { id: 'default-netflix', name: 'Netflix', url: 'https://www.netflix.com/search?q={searchterm}', enabled: true, defaultLink: true },
  { id: 'default-prime-video', name: 'Prime Video', url: 'https://www.primevideo.com/search/ref=atv_nb_sr?phrase={searchterm}&ie=UTF8', enabled: true, defaultLink: true },
  { id: 'default-hulu', name: 'Hulu', url: 'https://www.hulu.com/search?q={searchterm}', enabled: true, defaultLink: true },
  { id: 'default-youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query={searchtermPlus}', enabled: true, defaultLink: true },

  // More streaming defaults can be re-enabled later if needed.
  // { id: 'default-disney-plus', name: 'Disney+', url: 'https://www.disneyplus.com/search?q={searchterm}', enabled: true, defaultLink: true },
  // { id: 'default-apple-tv', name: 'Apple TV', url: 'https://tv.apple.com/search?term={searchterm}', enabled: true, defaultLink: true },
  // { id: 'default-max', name: 'Max', url: 'https://play.max.com/search?q={searchterm}', enabled: true, defaultLink: true },
  // { id: 'default-paramount-plus', name: 'Paramount+', url: 'https://www.paramountplus.com/search/?q={searchterm}', enabled: true, defaultLink: true },
  // { id: 'default-peacock', name: 'Peacock', url: 'https://www.peacocktv.com/search?q={searchterm}', enabled: true, defaultLink: true },
  // { id: 'default-tubi', name: 'Tubi', url: 'https://tubitv.com/search/{searchtermPlus}', enabled: true, defaultLink: true },
];
const ACTIVE_DEFAULT_QUICK_LINK_IDS = new Set(DEFAULT_QUICK_LINKS.map(link => link.id));

const Store = {
  _data: { apiKey: '', movies: [], tvshows: [], diary: [], activity: [], lineup: [], theme: null, popupPrefs: null, letterboxdWidgetEnabled: true, quickLinks: [], quickLinkDefaultsSeeded: false },
  _nextId: 1,

  _newMediaId() {
    return 'wt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  },

  _cleanProviderId(id) {
    if (id == null || id === '') return null;
    if (typeof id === 'object') {
      if (id.movie != null) return Number(id.movie);
      if (id.tv != null) return Number(id.tv);
      if (id.id != null) return Number(id.id);
      return null;
    }
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  },

  _externalKey(link) {
    return `${link.provider}:${link.providerType}:${link.id}`;
  },

  _inferExternalIds(item, mediaType) {
    const out = [];
    const add = (provider, providerType, id, relation = 'primary') => {
      const cleanId = this._cleanProviderId(id);
      if (cleanId == null || cleanId === 0) return;
      out.push({ provider, providerType, id: cleanId, relation });
    };
    if (Array.isArray(item.externalIds)) {
      item.externalIds.forEach(l => {
        if (!l) return;
        add(l.provider, l.providerType || l.type || mediaType, l.id, l.relation || 'primary');
      });
    }
    if (item.malId) add('mal', 'anime', item.malId, item.sourceTag === 'anime' ? 'primary' : 'same_as');
    const rawTmdb = item.tmdbId;
    if (typeof rawTmdb === 'object' && rawTmdb) {
      if (rawTmdb.movie != null) add('tmdb', 'movie', rawTmdb.movie, 'candidate');
      if (rawTmdb.tv != null) add('tmdb', 'tv', rawTmdb.tv, 'candidate');
    } else if (Number(rawTmdb) > 0) {
      add('tmdb', mediaType === 'movie' ? 'movie' : 'tv', rawTmdb, item.sourceTag === 'anime' && mediaType === 'tv' ? 'included_in_series' : 'same_as');
    }
    if (item.malTmdbId) add('tmdb', mediaType === 'movie' ? 'movie' : 'tv', item.malTmdbId, item.sourceTag === 'anime' && mediaType === 'tv' ? 'included_in_series' : 'same_as');
    const seen = new Set();
    return out.filter(l => {
      if (!l.provider || !l.providerType || l.id == null) return false;
      const k = this._externalKey(l);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },

  _normalizeMediaIdentity(item, mediaType) {
    if (!item.mediaId) item.mediaId = this._newMediaId();
    if (!item.mediaKind) item.mediaKind = item.sourceTag === 'anime' ? 'anime' : mediaType;
    if (!item.granularity) item.granularity = mediaType === 'movie' ? 'movie' : (item.sourceTag === 'anime' ? 'mal_entry' : 'series');
    item.externalIds = this._inferExternalIds(item, mediaType);
    // Legacy exports sometimes stored tmdbId as { tv: 123 } or as a negative MAL surrogate.
    // Keep tmdbId primitive for old UI code and keep real provider links in externalIds.
    if (typeof item.tmdbId === 'object' && item.tmdbId) {
      const clean = this._cleanProviderId(item.tmdbId);
      item.malTmdbId = item.malTmdbId || clean || null;
      item.tmdbId = item.sourceTag === 'anime' && item.malId ? -Math.abs(Number(item.malId)) : clean;
    }
    if ((item.tmdbId == null || item.tmdbId === 0) && item.sourceTag === 'anime' && item.malId) {
      item.tmdbId = -Math.abs(Number(item.malId));
    }
    return item;
  },

  findByExternalId(provider, providerType, id) {
    const cleanId = this._cleanProviderId(id);
    if (cleanId == null) return null;
    return this.getAll().find(item => (item.externalIds || []).some(l => l.provider === provider && l.providerType === providerType && Number(l.id) === cleanId)) || null;
  },

  _assignIds() {
    let maxId = 0;
    [...this._data.movies, ...this._data.tvshows].forEach(item => { if (item._id && item._id > maxId) maxId = item._id; });
    this._nextId = maxId + 1;
    let changed = false;
    this._data.movies.forEach(m => {
      if (!m._id) { m._id = this._nextId++; changed = true; }
      const before = JSON.stringify([m.mediaId, m.externalIds, m.mediaKind, m.granularity, m.tmdbId, m.malTmdbId]);
      this._normalizeMediaIdentity(m, 'movie');
      if (before !== JSON.stringify([m.mediaId, m.externalIds, m.mediaKind, m.granularity, m.tmdbId, m.malTmdbId])) changed = true;
    });
    this._data.tvshows.forEach(t => {
      if (!t._id) { t._id = this._nextId++; changed = true; }
      const before = JSON.stringify([t.mediaId, t.externalIds, t.mediaKind, t.granularity, t.tmdbId, t.malTmdbId]);
      this._normalizeMediaIdentity(t, 'tv');
      if (before !== JSON.stringify([t.mediaId, t.externalIds, t.mediaKind, t.granularity, t.tmdbId, t.malTmdbId])) changed = true;
    });
    if (changed) { this._saveMovies(); this._saveTvShows(); }
  },

  async load() {
    // Remove legacy OMDb settings/cache so the extension never keeps or uses OMDb credentials.
    try { chrome.storage.local.remove(['omdbKey', 'omdbCache']); } catch (_) {}
    return new Promise(resolve => {
      chrome.storage.local.get(['apiKey', 'movies', 'tvshows', 'diary', 'activity', 'lineup', 'theme', 'popupPrefs', 'letterboxdWidgetEnabled', 'quickLinks', 'quickLinkDefaultsSeeded'], d => {
        this._data.apiKey = d.apiKey || '';
        this._data.movies = d.movies || [];
        this._data.tvshows = d.tvshows || [];
        this._data.diary = d.diary || [];
        this._data.activity = d.activity || [];
        this._data.lineup = Array.isArray(d.lineup) ? d.lineup : [];
        this._data.theme = d.theme || null;
        try { localStorage.setItem('watchtracker-theme-cache-v1', JSON.stringify(this._data.theme || { preset: 'midnight' })); } catch (_) {}
        this._data.popupPrefs = d.popupPrefs || null;
        this._data.letterboxdWidgetEnabled = d.letterboxdWidgetEnabled !== false;
        this._data.quickLinkDefaultsSeeded = d.quickLinkDefaultsSeeded === true;
        let quickLinks = Array.isArray(d.quickLinks) ? d.quickLinks : [];
        quickLinks = quickLinks
          .map(l => ({ ...l, url: l.url || l.animeUrl || l.mangaUrl || '', enabled: l.enabled !== false }))
          .filter(l => !(l.defaultLink === true || String(l.id || '').startsWith('default-')) || ACTIVE_DEFAULT_QUICK_LINK_IDS.has(l.id));
        if (!this._data.quickLinkDefaultsSeeded) {
          const existingIds = new Set(quickLinks.map(l => l.id));
          const existingNames = new Set(quickLinks.map(l => (l.name || '').toLowerCase()));
          const defaultsToAdd = DEFAULT_QUICK_LINKS.filter(l => !existingIds.has(l.id) && !existingNames.has(l.name.toLowerCase()));
          quickLinks = [...defaultsToAdd, ...quickLinks];
          this._data.quickLinkDefaultsSeeded = true;
          chrome.storage.local.set({ quickLinks, quickLinkDefaultsSeeded: true });
        }
        this._data.quickLinks = quickLinks;
        this._assignIds();
        if (this.dedupeDiary) this.dedupeDiary();
        if (this.cleanupLineup) this.cleanupLineup();
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
    this._normalizeMediaIdentity(item, 'movie');
    const tmdb = this._cleanProviderId(item.tmdbId);
    if (typeof item.tmdbId === 'object' && tmdb != null) item.tmdbId = tmdb;
    if (tmdb != null && tmdb > 0 && this._data.movies.find(m => this._cleanProviderId(m.tmdbId) === tmdb)) return false;
    if (item.malId && this._data.movies.find(m => Number(m.malId) === Number(item.malId))) return false;
    if (!item._id) item._id = this._nextId++;
    this._data.movies.unshift(item);
    this._saveMovies();
    return true;
  },

  updateMovie(tmdbId, updates) {
    const idx = this._data.movies.findIndex(m => m.tmdbId === tmdbId);
    if (idx === -1) return;
    Object.assign(this._data.movies[idx], updates, { dateUpdated: new Date().toISOString() });
    this._saveMovies();
    if (this.cleanupLineup) this.cleanupLineup();
  },

  removeMovie(tmdbId) {
    const removed = this._data.movies.find(m => m.tmdbId === tmdbId);
    this._data.movies = this._data.movies.filter(m => m.tmdbId !== tmdbId);
    this._saveMovies();
    if (removed) this.removeFromLineupByMedia(removed);
  },

  hasMovie(tmdbId) {
    return this._data.movies.some(m => m.tmdbId === tmdbId);
  },

  getMovie(tmdbId) {
    return this._data.movies.find(m => m.tmdbId === tmdbId);
  },

  getById(id) {
    return this._data.movies.find(m => m._id === id) || this._data.tvshows.find(t => t._id === id) || null;
  },

  getByIdType(id) {
    const m = this._data.movies.find(m => m._id === id);
    if (m) return { item: m, mediaType: 'movie' };
    const t = this._data.tvshows.find(t => t._id === id);
    if (t) return { item: t, mediaType: 'tv' };
    return null;
  },

  removeById(id) {
    const mi = this._data.movies.findIndex(m => m._id === id);
    if (mi !== -1) { const removed = this._data.movies.splice(mi, 1)[0]; this._saveMovies(); this.removeFromLineupByMedia(removed); return true; }
    const ti = this._data.tvshows.findIndex(t => t._id === id);
    if (ti !== -1) { const removed = this._data.tvshows.splice(ti, 1)[0]; this._saveTvShows(); this.removeFromLineupByMedia(removed); return true; }
    return false;
  },

  _saveMovies() {
    chrome.storage.local.set({ movies: this._data.movies });
  },

  // ─── TV Shows ───
  getTvShows() { return this._data.tvshows; },

  addTvShow(item) {
    this._normalizeMediaIdentity(item, 'tv');
    if (typeof item.tmdbId === 'object') {
      const clean = this._cleanProviderId(item.tmdbId);
      if (clean != null) item.tmdbId = clean;
    }
    // Anime entries from MAL are stored per-MAL-entry (each MAL season is separate).
    // Allow multiple anime entries with the same TMDB ID but different MAL IDs.
    if (item.sourceTag === 'anime' && item.malId) {
      // Only block exact malId duplicates
      if (this._data.tvshows.find(t => t.malId === item.malId)) return false;
    } else {
      if (this._data.tvshows.find(t => t.tmdbId === item.tmdbId)) return false;
      if (item.malId && this._data.tvshows.find(t => t.malId === item.malId)) return false;
    }
    if (!item._id) item._id = this._nextId++;
    this._data.tvshows.unshift(item);
    this._saveTvShows();
    return true;
  },

  updateTvShow(tmdbId, updates) {
    const idx = this._data.tvshows.findIndex(t => t.tmdbId === tmdbId);
    if (idx === -1) return;
    Object.assign(this._data.tvshows[idx], updates, { dateUpdated: new Date().toISOString() });
    this._saveTvShows();
    if (this.cleanupLineup) this.cleanupLineup();
  },

  // Update by MAL ID — needed because multiple anime can share a TMDB ID
  updateTvShowByMalId(malId, updates) {
    const idx = this._data.tvshows.findIndex(t => t.malId === malId);
    if (idx === -1) return;
    Object.assign(this._data.tvshows[idx], updates, { dateUpdated: new Date().toISOString() });
    this._saveTvShows();
    if (this.cleanupLineup) this.cleanupLineup();
  },

  removeTvShow(tmdbId) {
    const removed = this._data.tvshows.find(t => t.tmdbId === tmdbId);
    this._data.tvshows = this._data.tvshows.filter(t => t.tmdbId !== tmdbId);
    this._saveTvShows();
    if (removed) this.removeFromLineupByMedia(removed);
  },

  // Remove by MAL ID — precise removal of a single anime entry
  removeTvShowByMalId(malId) {
    const removed = this._data.tvshows.find(t => t.malId === malId);
    this._data.tvshows = this._data.tvshows.filter(t => t.malId !== malId);
    this._saveTvShows();
    if (removed) this.removeFromLineupByMedia(removed);
  },

  hasTvShow(tmdbId) {
    return this._data.tvshows.some(t => t.tmdbId === tmdbId);
  },

  hasTvShowByMalId(malId) {
    return this._data.tvshows.some(t => t.malId === malId);
  },

  getTvShow(tmdbId) {
    return this._data.tvshows.find(t => t.tmdbId === tmdbId);
  },

  getTvShowByMalId(malId) {
    return this._data.tvshows.find(t => t.malId === malId);
  },

  _saveTvShows() {
    chrome.storage.local.set({ tvshows: this._data.tvshows });
  },

  // ─── Diary (completion log) ───
  getDiary() { return this._data.diary; },

  _normalizeDiaryTitle(title) {
    return String(title || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, 'and')
      .replace(/\b(the|a|an)\b/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  },

  _diaryIdentityKey(entry) {
    const mediaId = entry.mediaId || entry.libraryMediaId || '';
    if (mediaId) return `media:${mediaId}`;
    if (entry.malId) return `mal:${Number(entry.malId)}`;
    if (entry.tmdbId != null && Number(entry.tmdbId) > 0) return `tmdb:${entry.type || 'media'}:${Number(entry.tmdbId)}`;
    const title = this._normalizeDiaryTitle(entry.title);
    return title ? `title:${entry.type || 'media'}:${title}` : 'unknown';
  },

  makeDiaryCanonicalKey(entry) {
    const date = entry.date || '';
    const action = entry.action || 'watched';
    const season = entry.season ? `:s${entry.season}` : '';
    return `${date}:${action}:${this._diaryIdentityKey(entry)}${season}`;
  },

  _enrichDiaryEntryIdentity(entry) {
    const all = this.getAll ? this.getAll() : [...this._data.movies, ...this._data.tvshows];
    let match = null;
    if (entry.mediaId) match = all.find(i => i.mediaId === entry.mediaId);
    if (!match && entry.malId) match = all.find(i => Number(i.malId) === Number(entry.malId));
    if (!match && entry.tmdbId != null) match = all.find(i => Number(i.tmdbId) === Number(entry.tmdbId) && (!entry.type || i.mediaType === entry.type));
    if (!match && entry.title) {
      const title = this._normalizeDiaryTitle(entry.title);
      match = all.find(i => this._normalizeDiaryTitle(i.title) === title && (!entry.type || i.mediaType === entry.type));
    }
    if (match) {
      entry.mediaId = entry.mediaId || match.mediaId || null;
      entry.malId = entry.malId || match.malId || null;
      entry.tmdbId = entry.tmdbId != null ? entry.tmdbId : match.tmdbId;
      entry.type = entry.type || match.mediaType || (match.runtime ? 'movie' : 'tv');
      entry.posterPath = entry.posterPath || match.posterPath || null;
      entry.title = entry.title || match.title || '';
    }
    return entry;
  },

  _isSameDiaryWatch(a, b) {
    if ((a.date || '') !== (b.date || '')) return false;
    if ((a.action || 'watched') !== (b.action || 'watched')) return false;
    if ((a.season || '') !== (b.season || '')) return false;
    if (a.mediaId && b.mediaId && a.mediaId === b.mediaId) return true;
    if (a.malId && b.malId && Number(a.malId) === Number(b.malId)) return true;
    if (a.tmdbId != null && b.tmdbId != null && Number(a.tmdbId) > 0 && Number(a.tmdbId) === Number(b.tmdbId) && (!a.type || !b.type || a.type === b.type)) return true;
    const at = this._normalizeDiaryTitle(a.title);
    const bt = this._normalizeDiaryTitle(b.title);
    return !!(at && bt && at === bt && (!a.type || !b.type || a.type === b.type));
  },

  makeDiarySourceEventKey(entry) {
    if (entry.sourceEventKey) return entry.sourceEventKey;
    const source = entry.syncSource || entry.source || 'manual';
    if (source === 'manual') return null;
    if (entry.malId) return `${source}:anime:${entry.malId}:${entry.action || 'watched'}:${entry.date || ''}`;
    if (entry.letterboxdGuid) return `letterboxd:${entry.letterboxdGuid}`;
    const providerId = entry.tmdbId != null ? entry.tmdbId : (entry.mediaId || entry.title || 'unknown');
    return `${source}:${entry.type || 'media'}:${providerId}:${entry.action || 'watched'}:${entry.date || ''}:${entry.season || ''}`;
  },

  addDiaryEntry(entry) {
    // entry: { mediaId, tmdbId, malId, title, type, posterPath, date, action, notes, rating, mood, episodes, timestamp, sourceEventKey }
    this._enrichDiaryEntryIdentity(entry);
    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    const key = this.makeDiarySourceEventKey(entry);
    if (key) entry.sourceEventKey = key;
    entry.canonicalDiaryKey = this.makeDiaryCanonicalKey(entry);

    const existingIdx = this._data.diary.findIndex(d => {
      this._enrichDiaryEntryIdentity(d);
      if (key && d.sourceEventKey === key) return true;
      if (d.canonicalDiaryKey && d.canonicalDiaryKey === entry.canonicalDiaryKey) return true;
      return this._isSameDiaryWatch(d, entry);
    });

    if (existingIdx !== -1) {
      const existing = this._data.diary[existingIdx];
      this._data.diary[existingIdx] = {
        ...existing,
        ...entry,
        notes: existing.notes || entry.notes || '',
        mood: existing.mood || entry.mood || null,
        rating: existing.rating || entry.rating || null,
        timestamp: existing.timestamp || entry.timestamp,
        sourceEventKey: existing.sourceEventKey || entry.sourceEventKey,
        canonicalDiaryKey: entry.canonicalDiaryKey,
      };
      chrome.storage.local.set({ diary: this._data.diary });
      return false;
    }

    this._data.diary.unshift(entry);
    chrome.storage.local.set({ diary: this._data.diary });
    return true;
  },

  dedupeDiary() {
    const cleaned = [];
    let removed = 0;
    for (const raw of this._data.diary || []) {
      const entry = this._enrichDiaryEntryIdentity({ ...raw });
      entry.canonicalDiaryKey = this.makeDiaryCanonicalKey(entry);
      const existing = cleaned.find(d =>
        (d.canonicalDiaryKey && d.canonicalDiaryKey === entry.canonicalDiaryKey) || this._isSameDiaryWatch(d, entry)
      );
      if (existing) {
        existing.notes = existing.notes || entry.notes || '';
        existing.mood = existing.mood || entry.mood || null;
        existing.rating = existing.rating || entry.rating || null;
        existing.malId = existing.malId || entry.malId || null;
        existing.mediaId = existing.mediaId || entry.mediaId || null;
        existing.posterPath = existing.posterPath || entry.posterPath || null;
        existing.sourceEventKey = existing.sourceEventKey || entry.sourceEventKey;
        removed++;
      } else {
        cleaned.push(entry);
      }
    }
    if (removed > 0 || cleaned.some((e, i) => e !== this._data.diary[i])) {
      this._data.diary = cleaned;
      chrome.storage.local.set({ diary: this._data.diary });
    }
    return { removed, total: cleaned.length };
  },

  removeDiaryEntry(tmdbId, timestamp) {
    if (timestamp) { this._data.diary = this._data.diary.filter(d => d.timestamp !== timestamp); }
    else { const i = this._data.diary.findIndex(d => d.tmdbId === tmdbId); if (i !== -1) this._data.diary.splice(i, 1); }
    chrome.storage.local.set({ diary: this._data.diary });
  },
  updateDiaryEntry(ts, u) { const i = this._data.diary.findIndex(d => d.timestamp === ts); if (i >= 0) { Object.assign(this._data.diary[i], u); this._enrichDiaryEntryIdentity(this._data.diary[i]); this._data.diary[i].canonicalDiaryKey = this.makeDiaryCanonicalKey(this._data.diary[i]); chrome.storage.local.set({ diary: this._data.diary }); } },
  getDiaryEntry(ts) { return this._data.diary.find(d => d.timestamp === ts); },
  getUserRating(id, t) { const e = this._data.diary.filter(d => d.tmdbId === id && d.type === t && d.rating); return e.length ? e[0].rating : null; },
  getSeasonRatings(id) { const m = {}; this._data.diary.filter(d => d.tmdbId === id && d.type === 'tv' && d.rating && d.season).forEach(e => { if (!m[e.season]) m[e.season] = e.rating; }); return m; },
  getAvgUserRating(id, t) { const e = this._data.diary.filter(d => d.tmdbId === id && d.type === t && d.rating); return e.length ? e.reduce((s, d) => s + d.rating, 0) / e.length : null; },


  // ─── Lineup / Watch Next Queue ───
  getLineup() {
    return Array.isArray(this._data.lineup) ? this._data.lineup : [];
  },

  _saveLineup() {
    chrome.storage.local.set({ lineup: this._data.lineup || [] });
  },

  _lineupKeyFor(item, opts = {}) {
    const targetType = opts.targetType || (item.mediaType === 'movie' || item.type === 'movie' ? 'movie' : 'show');
    const seasonNumber = targetType === 'season' ? Number(opts.seasonNumber || 1) : '';
    if (item.mediaId) return `${targetType}:${item.mediaId}:${seasonNumber}`;
    if (item.malId) return `${targetType}:mal:${item.malId}:${seasonNumber}`;
    return `${targetType}:tmdb:${item.tmdbId}:${seasonNumber}`;
  },

  isInLineup(item, opts = {}) {
    const key = this._lineupKeyFor(item, opts);
    return this.getLineup().some(x => x.key === key);
  },

  addToLineup(item, opts = {}) {
    if (!item) return false;
    if (!Array.isArray(this._data.lineup)) this._data.lineup = [];
    const mediaType = item.mediaType || item.type || (item.runtime ? 'movie' : 'tv');
    const targetType = opts.targetType || (mediaType === 'movie' ? 'movie' : 'show');
    const seasonNumber = targetType === 'season' ? Number(opts.seasonNumber || 1) : null;
    const key = this._lineupKeyFor({ ...item, mediaType }, { targetType, seasonNumber });
    if (this._data.lineup.some(x => x.key === key)) return false;
    const entry = {
      id: 'lineup_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      key,
      mediaId: item.mediaId || null,
      tmdbId: item.tmdbId,
      malId: item.malId || null,
      source: item.sourceTag === 'anime' || item.mediaKind === 'anime' ? 'mal' : 'tmdb',
      title: item.title,
      type: mediaType === 'movie' ? 'movie' : (item.sourceTag === 'anime' ? 'anime' : 'tv'),
      mediaType: mediaType === 'movie' ? 'movie' : 'tv',
      targetType,
      seasonNumber,
      posterPath: item.posterPath || null,
      addedAt: new Date().toISOString(),
      order: this._data.lineup.length
    };
    this._data.lineup.push(entry);
    this._saveLineup();
    return true;
  },

  removeFromLineup(id) {
    const before = this.getLineup().length;
    this._data.lineup = this.getLineup().filter(x => x.id !== id && x.key !== id);
    if (this._data.lineup.length !== before) { this._normalizeLineupOrder(); this._saveLineup(); return true; }
    return false;
  },

  removeFromLineupByMedia(item) {
    if (!item) return false;
    const before = this.getLineup().length;
    this._data.lineup = this.getLineup().filter(x => {
      if (item.mediaId && x.mediaId === item.mediaId) return false;
      if (item.malId && x.malId && Number(x.malId) === Number(item.malId)) return false;
      if (x.tmdbId === item.tmdbId && (x.mediaType === item.mediaType || !x.mediaType)) return false;
      return true;
    });
    if (this._data.lineup.length !== before) { this._normalizeLineupOrder(); this._saveLineup(); return true; }
    return false;
  },

  moveLineupItem(id, direction) {
    const list = this.getLineup();
    const idx = list.findIndex(x => x.id === id || x.key === id);
    if (idx < 0) return false;
    const next = direction === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= list.length) return false;
    [list[idx], list[next]] = [list[next], list[idx]];
    this._normalizeLineupOrder();
    this._saveLineup();
    return true;
  },

  reorderLineup(ids = []) {
    if (!Array.isArray(ids) || !ids.length) return false;
    const current = this.getLineup();
    const byId = new Map(current.map(x => [x.id, x]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    current.forEach(x => { if (!ids.includes(x.id)) ordered.push(x); });
    if (ordered.length !== current.length) return false;
    this._data.lineup = ordered;
    this._normalizeLineupOrder();
    this._saveLineup();
    return true;
  },

  _normalizeLineupOrder() {
    this._data.lineup = this.getLineup().map((x, i) => ({ ...x, order: i }));
  },

  _lineupMediaFor(entry) {
    if (!entry) return null;
    if (entry.mediaId) {
      const byMedia = this.getAll().find(x => x.mediaId === entry.mediaId);
      if (byMedia) return byMedia;
    }
    if (entry.malId) {
      const anime = this._data.tvshows.find(t => Number(t.malId) === Number(entry.malId)) || this._data.movies.find(m => Number(m.malId) === Number(entry.malId));
      if (anime) return { ...anime, mediaType: anime.runtime ? 'movie' : 'tv' };
    }
    if (entry.mediaType === 'movie') return this._data.movies.find(m => m.tmdbId === entry.tmdbId) || null;
    return this._data.tvshows.find(t => t.tmdbId === entry.tmdbId) || null;
  },

  _lineupEntryFinished(entry) {
    const item = this._lineupMediaFor(entry);
    if (!item) return true;
    if ((item.watchStatus || '') === 'completed') return true;
    if (entry.targetType === 'movie') return (item.watchStatus || '') === 'completed';
    const seasons = item.seasons || [];
    if (entry.targetType === 'season') {
      const sn = Number(entry.seasonNumber || 1);
      const season = seasons.find(s => Number(s.seasonNumber) === sn);
      if (!season) return false;
      const total = season.episodeCount || 0;
      const watched = season.episodesWatched || 0;
      const seasonStatus = item.seasonStatuses && item.seasonStatuses[sn];
      return seasonStatus === 'completed' || (total > 0 && watched >= total);
    }
    if (seasons.length) {
      return seasons.every(s => (s.episodeCount || 0) > 0 && (s.episodesWatched || 0) >= (s.episodeCount || 0));
    }
    return false;
  },

  cleanupLineup() {
    if (!Array.isArray(this._data.lineup)) this._data.lineup = [];
    const before = this._data.lineup.length;
    this._data.lineup = this._data.lineup.filter(e => !this._lineupEntryFinished(e));
    this._normalizeLineupOrder();
    if (this._data.lineup.length !== before) this._saveLineup();
    return { removed: before - this._data.lineup.length, total: this._data.lineup.length };
  },

  getActivity() { return this._data.activity; },
  addActivity(entry) {
    this._data.activity.unshift(entry);
    if (this._data.activity.length > 500) this._data.activity = this._data.activity.slice(0, 500);
    chrome.storage.local.set({ activity: this._data.activity });
  },

  getAll() { return [...this._data.movies.map(m => ({ ...m, mediaType: 'movie' })), ...this._data.tvshows.map(t => ({ ...t, mediaType: 'tv' }))]; },
  deleteMovie(id) { this.removeMovie(id); },
  deleteTvShow(id) { this.removeTvShow(id); },
  getTheme() { return this._data.theme; },
  setTheme(t) {
    this._data.theme = t;
    try { localStorage.setItem('watchtracker-theme-cache-v1', JSON.stringify(t || { preset: 'midnight' })); } catch (_) {}
    chrome.storage.local.set({ theme: t });
  },
  getPopupPrefs() { return this._data.popupPrefs; },
  setPopupPrefs(p) { this._data.popupPrefs = p; chrome.storage.local.set({ popupPrefs: p }); },

  // ─── Custom Quick Links ───
  getQuickLinks() { return this._data.quickLinks || []; },
  setQuickLinks(links) {
    this._data.quickLinks = Array.isArray(links) ? links.map(l => ({ ...l, enabled: l.enabled !== false })) : [];
    chrome.storage.local.set({ quickLinks: this._data.quickLinks });
  },
  addQuickLink(link) {
    const clean = {
      id: link.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: (link.name || '').trim(),
      url: (link.url || link.animeUrl || link.mangaUrl || '').trim(),
      enabled: link.enabled !== false,
      defaultLink: link.defaultLink === true,
    };
    if (!clean.name || !clean.url) return false;
    this._data.quickLinks = this.getQuickLinks();
    this._data.quickLinks.push(clean);
    chrome.storage.local.set({ quickLinks: this._data.quickLinks });
    return clean;
  },
  updateQuickLink(id, updates) {
    const idx = this.getQuickLinks().findIndex(l => l.id === id);
    if (idx === -1) return false;
    const clean = {
      ...this._data.quickLinks[idx],
      name: (updates.name || '').trim(),
      url: (updates.url || updates.animeUrl || updates.mangaUrl || '').trim(),
    };
    if ('enabled' in updates) clean.enabled = updates.enabled !== false;
    delete clean.animeUrl;
    delete clean.mangaUrl;
    if (!clean.name || !clean.url) return false;
    this._data.quickLinks[idx] = clean;
    chrome.storage.local.set({ quickLinks: this._data.quickLinks });
    return true;
  },
  toggleQuickLink(id, enabled) {
    const idx = this.getQuickLinks().findIndex(l => l.id === id);
    if (idx === -1) return false;
    this._data.quickLinks[idx] = { ...this._data.quickLinks[idx], enabled: enabled !== false };
    chrome.storage.local.set({ quickLinks: this._data.quickLinks });
    return true;
  },
  moveQuickLink(id, direction) {
    const links = this.getQuickLinks().slice();
    const idx = links.findIndex(l => l.id === id);
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= links.length) return false;
    [links[idx], links[target]] = [links[target], links[idx]];
    this.setQuickLinks(links);
    return true;
  },
  removeQuickLink(id) {
    this._data.quickLinks = this.getQuickLinks().filter(l => l.id !== id);
    chrome.storage.local.set({ quickLinks: this._data.quickLinks });
  },

  getLetterboxdWidgetEnabled() { return this._data.letterboxdWidgetEnabled !== false; },
  setLetterboxdWidgetEnabled(enabled) {
    this._data.letterboxdWidgetEnabled = enabled !== false;
    chrome.storage.local.set({ letterboxdWidgetEnabled: this._data.letterboxdWidgetEnabled });
  },

  migrateTmdbId(oldId, newId, type) {
    if (type === 'movie') {
      const idx = this._data.movies.findIndex(m => m.tmdbId === oldId);
      if (idx !== -1) { this._data.movies[idx].tmdbId = newId; this._saveMovies(); }
    } else {
      const idx = this._data.tvshows.findIndex(t => t.tmdbId === oldId);
      if (idx !== -1) { this._data.tvshows[idx].tmdbId = newId; this._saveTvShows(); }
    }
    let diaryChanged = false;
    this._data.diary.forEach(d => { if (d.tmdbId === oldId && d.type === type) { d.tmdbId = newId; diaryChanged = true; } });
    if (diaryChanged) chrome.storage.local.set({ diary: this._data.diary });
    let activityChanged = false;
    this._data.activity.forEach(a => { if (a.tmdbId === oldId && a.type === type) { a.tmdbId = newId; activityChanged = true; } });
    if (activityChanged) chrome.storage.local.set({ activity: this._data.activity });
  },

  migrateType(id, oldType, newType) {
    if (oldType === newType) return;
    let item;
    if (oldType === 'movie') {
      const idx = this._data.movies.findIndex(m => m.tmdbId === id);
      if (idx !== -1) { item = this._data.movies.splice(idx, 1)[0]; this._saveMovies(); }
    } else {
      const idx = this._data.tvshows.findIndex(t => t.tmdbId === id);
      if (idx !== -1) { item = this._data.tvshows.splice(idx, 1)[0]; this._saveTvShows(); }
    }
    if (item) {
      if (newType === 'movie') {
        this._data.movies.unshift(item); this._saveMovies();
      } else {
        if (!item.seasons) item.seasons = [];
        this._data.tvshows.unshift(item); this._saveTvShows();
      }
    }
    let diaryChanged = false;
    this._data.diary.forEach(d => { if (d.tmdbId === id && d.type === oldType) { d.type = newType; diaryChanged = true; } });
    if (diaryChanged) chrome.storage.local.set({ diary: this._data.diary });
    let activityChanged = false;
    this._data.activity.forEach(a => { if (a.tmdbId === id && a.type === oldType) { a.type = newType; activityChanged = true; } });
    if (activityChanged) chrome.storage.local.set({ activity: this._data.activity });
  },

  mergeItems(survivorId, survivorType, duplicateId, duplicateType, duplicate_id) {
    const survivor = survivorType === 'movie' ? this.getMovie(survivorId) : this.getTvShow(survivorId);
    // Use _id for precise lookup if provided (handles same-tmdbId duplicates)
    let duplicate;
    if (duplicate_id) {
      duplicate = this.getById(duplicate_id);
    } else {
      duplicate = duplicateType === 'movie' ? this.getMovie(duplicateId) : this.getTvShow(duplicateId);
    }
    if (!survivor || !duplicate) return false;

    // Transfer malId if survivor doesn't have one
    if (!survivor.malId && duplicate.malId) {
      if (survivorType === 'movie') this.updateMovie(survivorId, { malId: duplicate.malId });
      else this.updateTvShow(survivorId, { malId: duplicate.malId });
    }

    // Transfer sourceTag (anime) if survivor doesn't have one
    if (!survivor.sourceTag && duplicate.sourceTag) {
      if (survivorType === 'movie') this.updateMovie(survivorId, { sourceTag: duplicate.sourceTag });
      else this.updateTvShow(survivorId, { sourceTag: duplicate.sourceTag });
    }

    // Keep best watch status: completed > watching > on_hold > dropped > plan_to_watch
    const statusRank = { completed: 5, watching: 4, on_hold: 3, dropped: 2, plan_to_watch: 1 };
    if ((statusRank[duplicate.watchStatus] || 0) > (statusRank[survivor.watchStatus] || 0)) {
      if (survivorType === 'movie') this.updateMovie(survivorId, { watchStatus: duplicate.watchStatus });
      else this.updateTvShow(survivorId, { watchStatus: duplicate.watchStatus });
    }

    // Transfer season data if survivor has none but duplicate does (TV shows)
    if (survivorType === 'tv') {
      const sSeasons = survivor.seasons || [];
      const dSeasons = duplicate.seasons || [];
      if (sSeasons.length === 0 && dSeasons.length > 0) {
        this.updateTvShow(survivorId, { seasons: dSeasons });
      } else if (sSeasons.length > 0 && dSeasons.length > 0) {
        // Merge: keep survivor's season structure but take higher episode counts
        const merged = sSeasons.map(ss => {
          const ds = dSeasons.find(d => d.seasonNumber === ss.seasonNumber);
          if (ds && (ds.episodesWatched || 0) > (ss.episodesWatched || 0)) {
            return { ...ss, episodesWatched: ds.episodesWatched };
          }
          return ss;
        });
        this.updateTvShow(survivorId, { seasons: merged });
      }
      // Transfer totalSeasons/totalEpisodes if survivor lacks them
      if (!survivor.totalSeasons && duplicate.totalSeasons) {
        this.updateTvShow(survivorId, { totalSeasons: duplicate.totalSeasons });
      }
      if (!survivor.totalEpisodes && duplicate.totalEpisodes) {
        this.updateTvShow(survivorId, { totalEpisodes: duplicate.totalEpisodes });
      }
    }

    // Transfer rewatchCount if duplicate has more
    if ((duplicate.rewatchCount || 0) > (survivor.rewatchCount || 0)) {
      const rwUpdates = { rewatchCount: duplicate.rewatchCount };
      if (duplicate.rewatchHistory && duplicate.rewatchHistory.length) {
        rwUpdates.rewatchHistory = [...(survivor.rewatchHistory || []), ...duplicate.rewatchHistory];
      }
      if (survivorType === 'movie') this.updateMovie(survivorId, rwUpdates);
      else this.updateTvShow(survivorId, rwUpdates);
    }

    // Transfer dates if survivor has none
    if (!survivor.startDate && duplicate.startDate) {
      if (survivorType === 'movie') this.updateMovie(survivorId, { startDate: duplicate.startDate });
      else this.updateTvShow(survivorId, { startDate: duplicate.startDate });
    }
    if (!survivor.endDate && duplicate.endDate) {
      if (survivorType === 'movie') this.updateMovie(survivorId, { endDate: duplicate.endDate });
      else this.updateTvShow(survivorId, { endDate: duplicate.endDate });
    }

    // Migrate diary entries
    let diaryChanged = false;
    this._data.diary.forEach(d => {
      if (d.tmdbId === duplicateId && d.type === duplicateType) {
        d.tmdbId = survivorId; d.type = survivorType; diaryChanged = true;
      }
    });
    if (diaryChanged) chrome.storage.local.set({ diary: this._data.diary });

    // Migrate activity
    let actChanged = false;
    this._data.activity.forEach(a => {
      if (a.tmdbId === duplicateId && a.type === duplicateType) {
        a.tmdbId = survivorId; a.type = survivorType; actChanged = true;
      }
    });
    if (actChanged) chrome.storage.local.set({ activity: this._data.activity });

    // Remove the duplicate by _id (precise, won't remove survivor even with same tmdbId)
    if (duplicate._id) {
      this.removeById(duplicate._id);
    } else {
      if (duplicateType === 'movie') this.removeMovie(duplicateId);
      else this.removeTvShow(duplicateId);
    }

    return true;
  },

  // ─── Export/Import ───
  exportAll() {
    return JSON.stringify({
      version: 2,
      movies: this._data.movies,
      tvshows: this._data.tvshows,
      diary: this._data.diary,
      activity: this._data.activity,
      quickLinks: this._data.quickLinks,
      exportedAt: new Date().toISOString(),
    }, null, 2);
  },

  importAll(json, mode = 'replace') {
    const data = JSON.parse(json);
    if (mode === 'replace') {
      if (data.movies) this._data.movies = data.movies;
      if (data.tvshows) this._data.tvshows = data.tvshows;
      if (data.diary) this._data.diary = data.diary;
      if (data.activity) this._data.activity = data.activity;
      if (data.quickLinks) this._data.quickLinks = data.quickLinks;
    } else {
      // Merge mode — add new items, don't overwrite existing
      const stats = { moviesAdded: 0, tvAdded: 0, diaryAdded: 0 };
      if (data.movies) {
        data.movies.forEach(m => {
          if (!this._data.movies.find(ex => ex.tmdbId === m.tmdbId)) {
            this._data.movies.unshift(m);
            stats.moviesAdded++;
          }
        });
      }
      if (data.tvshows) {
        data.tvshows.forEach(t => {
          if (!this._data.tvshows.find(ex => ex.tmdbId === t.tmdbId)) {
            this._data.tvshows.unshift(t);
            stats.tvAdded++;
          }
        });
      }
      if (data.diary) {
        data.diary.forEach(d => {
          const exists = this._data.diary.find(ex =>
            ex.tmdbId === d.tmdbId && ex.date === d.date && ex.type === d.type && ex.action === d.action
          );
          if (!exists) {
            this._data.diary.unshift(d);
            stats.diaryAdded++;
          }
        });
      }
      if (data.quickLinks) {
        const existingNames = new Set(this.getQuickLinks().map(l => (l.name || '').toLowerCase()));
        data.quickLinks.forEach(l => {
          if (l && l.name && !existingNames.has(l.name.toLowerCase())) {
            this._data.quickLinks.push({
              id: l.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
              name: l.name,
              url: l.url || l.animeUrl || l.mangaUrl || '',
            });
            existingNames.add(l.name.toLowerCase());
          }
        });
      }
      if (data.activity) {
        data.activity.forEach(a => {
          if (!this._data.activity.find(ex => ex.timestamp === a.timestamp)) {
            this._data.activity.unshift(a);
          }
        });
        if (this._data.activity.length > 500) {
          this._data.activity = this._data.activity.slice(0, 500);
        }
      }
    }
    this._assignIds();
    this._saveMovies();
    this._saveTvShows();
    chrome.storage.local.set({ diary: this._data.diary, activity: this._data.activity, quickLinks: this._data.quickLinks });
    return { movies: this._data.movies.length, tvshows: this._data.tvshows.length, diary: this._data.diary.length };
  },

  clearAll() {
    this._data.movies = [];
    this._data.tvshows = [];
    this._data.diary = [];
    this._data.activity = [];
    this._data.quickLinks = [];
    this._saveMovies();
    this._saveTvShows();
    chrome.storage.local.set({ diary: [], activity: [], quickLinks: [] });
  },
};
try { globalThis.Store = Store; } catch (_) {}
