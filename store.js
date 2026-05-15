/* ═══════════════════════════════════════════
   Store — chrome.storage.local wrapper
   ═══════════════════════════════════════════ */

const Store = {
  _data: { apiKey: '', movies: [], tvshows: [], diary: [], activity: [], theme: null, popupPrefs: null },
  _nextId: 1,

  _assignIds() {
    let maxId = 0;
    [...this._data.movies, ...this._data.tvshows].forEach(item => { if (item._id && item._id > maxId) maxId = item._id; });
    this._nextId = maxId + 1;
    let changed = false;
    this._data.movies.forEach(m => { if (!m._id) { m._id = this._nextId++; changed = true; } });
    this._data.tvshows.forEach(t => { if (!t._id) { t._id = this._nextId++; changed = true; } });
    if (changed) { this._saveMovies(); this._saveTvShows(); }
  },

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
        this._assignIds();
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
    if (item.malId && this._data.movies.find(m => m.malId === item.malId)) return false;
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
    if (mi !== -1) { this._data.movies.splice(mi, 1); this._saveMovies(); return true; }
    const ti = this._data.tvshows.findIndex(t => t._id === id);
    if (ti !== -1) { this._data.tvshows.splice(ti, 1); this._saveTvShows(); return true; }
    return false;
  },

  _saveMovies() {
    chrome.storage.local.set({ movies: this._data.movies });
  },

  // ─── TV Shows ───
  getTvShows() { return this._data.tvshows; },

  addTvShow(item) {
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
  },

  // Update by MAL ID — needed because multiple anime can share a TMDB ID
  updateTvShowByMalId(malId, updates) {
    const idx = this._data.tvshows.findIndex(t => t.malId === malId);
    if (idx === -1) return;
    Object.assign(this._data.tvshows[idx], updates, { dateUpdated: new Date().toISOString() });
    this._saveTvShows();
  },

  removeTvShow(tmdbId) {
    this._data.tvshows = this._data.tvshows.filter(t => t.tmdbId !== tmdbId);
    this._saveTvShows();
  },

  // Remove by MAL ID — precise removal of a single anime entry
  removeTvShowByMalId(malId) {
    this._data.tvshows = this._data.tvshows.filter(t => t.malId !== malId);
    this._saveTvShows();
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
  addActivity(entry) {
    this._data.activity.unshift(entry);
    if (this._data.activity.length > 500) this._data.activity = this._data.activity.slice(0, 500);
    chrome.storage.local.set({ activity: this._data.activity });
  },

  getAll() { return [...this._data.movies.map(m => ({ ...m, mediaType: 'movie' })), ...this._data.tvshows.map(t => ({ ...t, mediaType: 'tv' }))]; },
  deleteMovie(id) { this.removeMovie(id); },
  deleteTvShow(id) { this.removeTvShow(id); },
  getTheme() { return this._data.theme; },
  setTheme(t) { this._data.theme = t; chrome.storage.local.set({ theme: t }); },
  getPopupPrefs() { return this._data.popupPrefs; },
  setPopupPrefs(p) { this._data.popupPrefs = p; chrome.storage.local.set({ popupPrefs: p }); },

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
    this._saveMovies();
    this._saveTvShows();
    chrome.storage.local.set({ diary: this._data.diary, activity: this._data.activity });
    return { movies: this._data.movies.length, tvshows: this._data.tvshows.length, diary: this._data.diary.length };
  },

  clearAll() {
    this._data.movies = [];
    this._data.tvshows = [];
    this._data.diary = [];
    this._data.activity = [];
    this._saveMovies();
    this._saveTvShows();
    chrome.storage.local.set({ diary: [], activity: [] });
  },
};
