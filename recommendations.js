/* Recommendations engine — local WatchTracker data + TMDB */

const Recommendations = {
  MOVIE_GENRES: {
    Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80,
    Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36,
    Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749,
    'Science Fiction': 878, 'Sci-Fi': 878, 'TV Movie': 10770, Thriller: 53,
    War: 10752, Western: 37
  },
  TV_GENRES: {
    Action: 10759, Adventure: 10759, Animation: 16, Comedy: 35, Crime: 80,
    Documentary: 99, Drama: 18, Family: 10751, Kids: 10762, Mystery: 9648,
    News: 10763, Reality: 10764, Romance: 10749, 'Sci-Fi': 10765,
    'Science Fiction': 10765, Fantasy: 10765, Soap: 10766, Talk: 10767,
    War: 10768, Politics: 10768, Western: 37
  },

  // Common typing aliases. TMDB expects ISO-639-1 original-language codes.
  LANGUAGE_ALIASES: {
    english: 'en', hindi: 'hi', telugu: 'te', telgu: 'te', telegu: 'te', tamil: 'ta', malayalam: 'ml', malayam: 'ml', malyalam: 'ml', kannada: 'kn', kanada: 'kn', bengali: 'bn', bangla: 'bn', marathi: 'mr', punjabi: 'pa', gujarati: 'gu', urdu: 'ur', odia: 'or', oriya: 'or', assamese: 'as', nepali: 'ne', sinhala: 'si', japanese: 'ja', korean: 'ko', chinese: 'zh', mandarin: 'zh', cantonese: 'cn', thai: 'th', indonesian: 'id', malay: 'ms', tagalog: 'tl', filipino: 'tl', vietnamese: 'vi', french: 'fr', spanish: 'es', italian: 'it', german: 'de', portuguese: 'pt', russian: 'ru', turkish: 'tr', arabic: 'ar', persian: 'fa', farsi: 'fa', hebrew: 'he'
  },

  normalizeLanguage(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const paren = raw.match(/\(([a-z]{2})\)$/i);
    if (paren) return paren[1].toLowerCase();
    const key = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (this.LANGUAGE_ALIASES[key]) return this.LANGUAGE_ALIASES[key];
    if (/^[a-z]{2}$/i.test(raw)) return raw.toLowerCase();
    return key;
  },



  hasStrongLanguageFilter(filters = {}) {
    return Boolean(filters && filters.language);
  },

  regionalFetchTarget(filters = {}) {
    if (!filters.language) return Math.max(Number(filters.count || 3) * 6, 30);
    // Fetch a much wider pool for language-specific recommendations. Regional catalogs
    // get too few results when we stop after the first 10–15 TMDB items.
    return Math.max(Number(filters.count || 3) * 24, 120);
  },

  normalizeItem(item) {
    return {
      ...item,
      mediaType: item.mediaType || item.type || 'movie',
      tmdbId: Number(item.tmdbId || item.id || 0),
      voteAverage: Number(item.voteAverage || item.vote_average || 0),
      voteCount: Number(item.voteCount || item.vote_count || 0),
      year: Number(item.year || 0),
      genres: Array.isArray(item.genres) ? item.genres : [],
      originalLanguage: item.originalLanguage || item.original_language || item.language || '',
    };
  },

  getAllItems() {
    return Store.getAll().map(i => this.normalizeItem(i));
  },

  getAvgPersonalRating(tmdbId, mediaType) {
    if (Store.getAvgUserRating) return Store.getAvgUserRating(tmdbId, mediaType);
    const entries = Store.getDiary().filter(d => d.tmdbId === tmdbId && d.type === mediaType && d.rating);
    return entries.length ? entries.reduce((sum, e) => sum + Number(e.rating || 0), 0) / entries.length : null;
  },

  isCompleted(item) {
    if (item.watchStatus === 'completed') return true;
    return Store.getDiary().some(d => d.tmdbId === item.tmdbId && d.type === item.mediaType);
  },

  getTasteItems(minMyRating = '') {
    let items = this.getAllItems().filter(i => this.isCompleted(i) || this.getAvgPersonalRating(i.tmdbId, i.mediaType));
    if (minMyRating) {
      const min = Number(minMyRating);
      items = items.filter(i => (this.getAvgPersonalRating(i.tmdbId, i.mediaType) || 0) >= min);
    }
    return items;
  },

  // Convert user's watch history into a richer positive/negative taste profile.
  // This is still local-first and explainable, but it captures much more than genre.
  buildTasteProfile(items) {
    const makeBucket = () => ({
      genres: new Map(),
      keywords: new Map(),
      directors: new Map(),
      writers: new Map(),
      actors: new Map(),
      countries: new Map(),
      languages: new Map(),
      decades: new Map(),
      runtimeBuckets: new Map(),
      moods: new Map(),
    });
    const profile = {
      positive: makeBucket(),
      negative: makeBucket(),
      topGenres: [],
      topDecades: [],
      topLanguages: [],
      avgRuntime: null,
      tasteCount: items.length,
      ratingCount: 0,
      avgPersonalRating: null,
    };
    const runtimeVals = [];
    const ratings = [];

    items.forEach(item => {
      const personal = this.getAvgPersonalRating(item.tmdbId, item.mediaType);
      if (personal) ratings.push(Number(personal));
      const signedWeight = this.preferenceWeight(personal, item);
      const target = signedWeight < 0 ? profile.negative : profile.positive;
      const weight = Math.abs(signedWeight);
      this.addFeaturesToBucket(target, this.extractItemFeatures(item), weight);
      if (item.runtime) runtimeVals.push(Number(item.runtime));
    });

    profile.topGenres = this.topKeys(profile.positive.genres, 5);
    profile.topDecades = this.topKeys(profile.positive.decades, 3).map(Number);
    profile.topLanguages = this.topKeys(profile.positive.languages, 3);
    profile.avgRuntime = runtimeVals.length ? Math.round(runtimeVals.reduce((a, b) => a + b, 0) / runtimeVals.length) : null;
    profile.ratingCount = ratings.length;
    profile.avgPersonalRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
    return profile;
  },

  preferenceWeight(personal, item = {}) {
    const rating = Number(personal || 0);
    let weight = 1;
    if (rating >= 9) weight = 3;
    else if (rating >= 8) weight = 2.25;
    else if (rating >= 7) weight = 1.35;
    else if (rating > 0 && rating <= 3) weight = -3;
    else if (rating > 0 && rating <= 5) weight = -1.75;
    else if (rating > 0 && rating < 7) weight = 0.35;

    if (item.watchStatus === 'completed') weight *= 1.15;
    const date = item.dateWatched || item.dateUpdated || item.dateAdded || item.timestamp;
    const recency = this.recencyBoost(date);
    return weight * recency;
  },

  recencyBoost(dateValue) {
    if (!dateValue) return 1;
    const t = new Date(dateValue).getTime();
    if (!Number.isFinite(t)) return 1;
    const ageDays = Math.max(0, (Date.now() - t) / 86400000);
    if (ageDays < 90) return 1.25;
    if (ageDays < 365) return 1.1;
    if (ageDays > 3650) return 0.75;
    return 1;
  },

  runtimeBucket(runtime) {
    const n = Number(runtime || 0);
    if (!n) return '';
    if (n < 80) return 'short';
    if (n < 105) return 'standard';
    if (n < 135) return 'long';
    return 'epic';
  },

  addWeighted(map, key, weight = 1) {
    if (key === undefined || key === null || key === '') return;
    const clean = String(key).trim();
    if (!clean) return;
    map.set(clean, (map.get(clean) || 0) + Number(weight || 0));
  },

  topKeys(map, n = 10) {
    return [...(map || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  },

  extractItemFeatures(item = {}) {
    const year = Number(item.year || 0);
    const decade = year ? Math.floor(year / 10) * 10 : '';
    const runtime = item.runtime || item.episodeRunTime || item.episode_run_time;
    const toList = (...values) => values.flatMap(v => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') return v.split(/[|,]/).map(x => x.trim()).filter(Boolean);
      return [];
    });
    return {
      genres: toList(item.genres),
      keywords: toList(item.keywords, item.keywordNames, item.tags).map(k => String(k).toLowerCase()),
      directors: toList(item.directors, item.director),
      writers: toList(item.writers, item.writer),
      actors: toList(item.actors, item.cast).slice(0, 8),
      countries: toList(item.countries, item.productionCountries, item.originCountry, item.origin_country),
      languages: toList(item.originalLanguage || item.original_language || item.language).map(l => this.normalizeLanguage(l)),
      decades: decade ? [decade] : [],
      runtimeBuckets: runtime ? [this.runtimeBucket(Array.isArray(runtime) ? runtime[0] : runtime)] : [],
      moods: toList(item.mood, item.moods),
    };
  },

  addFeaturesToBucket(bucket, features, weight = 1) {
    Object.entries(features || {}).forEach(([name, values]) => {
      const map = bucket[name];
      if (!map || !Array.isArray(values)) return;
      values.forEach(v => this.addWeighted(map, v, weight));
    });
  },

  trackedKeySet(libraryMode = 'new_only') {
    const set = new Set();
    this.getAllItems().forEach(i => {
      if (libraryMode === 'include_library') return;
      if (libraryMode === 'not_completed' && !this.isCompleted(i)) return;
      set.add(`${i.mediaType}:${i.tmdbId}`);
    });
    return set;
  },

  passesLocalFilters(item, filters) {
    if (filters.type !== 'both' && item.mediaType !== filters.type) return false;
    if (filters.genre && !(item.genres || []).includes(filters.genre)) return false;
    if (filters.minTmdbRating && Number(item.voteAverage || 0) < Number(filters.minTmdbRating)) return false;
    if (filters.minMyRating && (this.getAvgPersonalRating(item.tmdbId, item.mediaType) || 0) < Number(filters.minMyRating)) return false;
    if (filters.decade && Math.floor((item.year || 0) / 10) * 10 !== Number(filters.decade)) return false;
    if (filters.language && item.originalLanguage !== filters.language) return false;
    return true;
  },

  pickFromLocal(filters) {
    let items = this.getAllItems();
    if (filters.source === 'plan_to_watch') items = items.filter(i => i.watchStatus === 'plan_to_watch');
    if (filters.source === 'completed') items = items.filter(i => this.isCompleted(i));
    items = items.filter(i => this.passesLocalFilters(i, filters));
    items = this.filterRecentRecommendations(items, filters);
    const picked = this.shuffle(items).slice(0, filters.count);
    this.rememberRecommendations(picked, filters);
    const profile = this.buildTasteProfile(items);
    return {
      source: 'local',
      profile,
      results: picked.map(i => ({ ...i, reason: this.localReason(i, filters.source) }))
    };
  },

  localReason(item, source) {
    if (source === 'plan_to_watch') return 'Picked from your Plan to Watch list.';
    if (source === 'completed') return 'Picked from items you already completed.';
    return item.watchStatus ? `Picked from your ${String(item.watchStatus).replace(/_/g, ' ')} items.` : 'Picked from your library.';
  },

  async suggest(filters) {
    filters = { ...filters, language: this.normalizeLanguage(filters.language) };
    if (filters.source !== 'new') return this.pickFromLocal(filters);

    const tasteItems = this.getTasteItems(filters.minMyRating);
    const profile = this.buildTasteProfile(tasteItems.length ? tasteItems : this.getAllItems());
    await this.enrichTasteProfile(profile, tasteItems.length ? tasteItems : this.getAllItems());

    const candidates = [];
    if (filters.style === 'random') {
      candidates.push(...await this.fetchRandomByFilters(filters));
    } else if (filters.style === 'because') {
      candidates.push(...await this.fetchBecauseYouLiked(tasteItems, filters));
      if (filters.language && candidates.length < this.regionalFetchTarget(filters)) {
        // TMDB recommendation/similar endpoints are often weak for regional languages.
        // Backfill with broad language discovery, then score by taste.
        candidates.push(...await this.fetchLanguageBackfill(profile, filters));
      }
    } else {
      candidates.push(...await this.fetchDiscover(profile, filters));
      candidates.push(...await this.fetchTasteSignalCandidates(profile, filters));
    }

    const tracked = this.trackedKeySet(filters.libraryMode);
    let deduped = this.dedupeCandidates(candidates)
      .filter(c => !tracked.has(`${c.mediaType}:${c.tmdbId}`))
      .filter(c => this.passesCandidateFilters(c, filters));

    if (filters.language && filters.source === 'new' && deduped.length < Number(filters.count || 3)) {
      const backfill = await this.fetchLanguageBackfill(profile, filters);
      deduped = this.dedupeCandidates([...deduped, ...backfill])
        .filter(c => !tracked.has(`${c.mediaType}:${c.tmdbId}`))
        .filter(c => this.passesCandidateFilters(c, filters));
    }

    deduped = await this.enrichCandidateMetadata(deduped, filters, profile);
    const preFilterContext = this.buildScoreContext(deduped);
    deduped = this.applyVoteConfidenceFilter(deduped, filters, preFilterContext);
    // Avoid the previous behavior where each click returned the same top titles in a shuffled order.
    // First remove recently shown titles for this filter set when there are enough alternatives,
    // then do a weighted pick from a broader scored pool instead of just shuffling the same top slice.
    deduped = this.filterRecentRecommendations(deduped, filters);

    const scoreContext = this.buildScoreContext(deduped);
    const scored = deduped.map(c => ({ ...c, _score: this.scoreCandidate(c, profile, filters, scoreContext) }))
      .sort((a, b) => b._score - a._score);

    const picked = this.pickWeightedDiverse(scored, filters);
    this.rememberRecommendations(picked, filters);

    return { source: 'tmdb', profile, results: picked };
  },

  async fetchRandomByFilters(filters) {
    const out = [];
    const types = filters.type === 'both' ? ['movie', 'tv'] : [filters.type];
    const sortOptions = filters.language
      ? ['popularity.desc', 'primary_release_date.desc', 'vote_count.desc', 'vote_average.desc']
      : ['popularity.desc', 'vote_average.desc'];
    const requestedGenre = filters.genre || '';
    const target = this.regionalFetchTarget(filters);

    for (const type of types) {
      const genreId = this.genreIdFor(type, requestedGenre);
      for (const sort of sortOptions) {
        const pages = filters.language
          ? this.shuffle(Array.from({ length: 40 }, (_, i) => i + 1)).slice(0, 18)
          : this.shuffle(Array.from({ length: 20 }, (_, i) => i + 1)).slice(0, 8);
        for (const page of pages) {
          const params = {
            page,
            sort_by: sort,
            // Keep this very low. Rating and library filters are applied after fetching,
            // but high vote-count filters remove many Telugu/Tamil/Malayalam/Kannada titles.
            'vote_count.gte': filters.language ? 0 : (filters.minTmdbRating ? 5 : 0),
          };
          if (filters.minTmdbRating) params['vote_average.gte'] = filters.minTmdbRating;
          if (filters.language) params.with_original_language = filters.language;
          if (genreId) params.with_genres = genreId;
          if (filters.decade) {
            const start = `${filters.decade}-01-01`;
            const end = `${Number(filters.decade) + 9}-12-31`;
            if (type === 'movie') { params['primary_release_date.gte'] = start; params['primary_release_date.lte'] = end; }
            else { params['first_air_date.gte'] = start; params['first_air_date.lte'] = end; }
          }
          try {
            const data = type === 'movie' ? await TMDB.discoverMovies(params) : await TMDB.discoverTv(params);
            out.push(...(data.results || []).map(r => this.fromTmdbResult(r, type, null, filters)));
          } catch (e) { console.warn('Random discover failed', type, e); }
          if (this.dedupeCandidates(out).length >= target) break;
        }
        if (this.dedupeCandidates(out).length >= target) break;
      }
    }
    return out;
  },

  async fetchDiscover(profile, filters) {
    const out = [];
    const types = filters.type === 'both' ? ['movie', 'tv'] : [filters.type];
    // If a specific language is selected, do not force the user's top genre by default.
    // Regional-language catalogs can become nearly empty when language + taste-genre + vote-count are combined.
    const genreNames = filters.genre ? [filters.genre] : (filters.language ? [] : profile.topGenres);

    // Regional-language catalogs can be sparse when combined with genre and vote-count filters.
    // Use progressive passes: taste genre first, then relax genre/vote-count while preserving the selected language.
    const makePasses = (type) => {
      const primaryGenre = this.genreIdFor(type, genreNames[0]);
      const passes = [];
      if (filters.language) {
        // For regional-language recommendations, fetch broad language pools first, then score by taste.
        // If the user explicitly selected a genre, preserve that genre in the first passes.
        passes.push({ genreId: primaryGenre, voteCount: 0, sort: 'popularity.desc', pages: 12 });
        passes.push({ genreId: primaryGenre, voteCount: 0, sort: type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc', pages: 8 });
        passes.push({ genreId: primaryGenre, voteCount: 0, sort: 'vote_count.desc', pages: 8 });
        if (!filters.genre) {
          // No explicit genre: also scan widely across the language catalog.
          passes.push({ genreId: '', voteCount: 0, sort: 'popularity.desc', pages: 15 });
          passes.push({ genreId: '', voteCount: 0, sort: type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc', pages: 10 });
          passes.push({ genreId: '', voteCount: 0, sort: 'vote_count.desc', pages: 10 });
          passes.push({ genreId: '', voteCount: 0, sort: 'vote_average.desc', pages: 8 });
        }
      } else {
        passes.push({ genreId: primaryGenre, voteCount: this.voteCountForStyle(filters.style), sort: this.sortForStyle(filters.style), pages: 3 });
        if (!filters.genre) {
          // Also sample a few more of the user's top genres for more variety.
          genreNames.slice(1, 4).forEach(g => passes.push({ genreId: this.genreIdFor(type, g), voteCount: this.voteCountForStyle(filters.style), sort: this.sortForStyle(filters.style), pages: 2 }));
        }
      }
      return passes;
    };

    for (const type of types) {
      for (const pass of makePasses(type)) {
        const seenBefore = out.length;
        for (let page = 1; page <= pass.pages; page++) {
          const params = {
            page,
            sort_by: pass.sort,
            'vote_count.gte': pass.voteCount,
          };
          if (filters.minTmdbRating) params['vote_average.gte'] = filters.minTmdbRating;
          if (filters.language) params.with_original_language = filters.language;
          if (pass.genreId) params.with_genres = pass.genreId;
          if (filters.decade) {
            const start = `${filters.decade}-01-01`;
            const end = `${Number(filters.decade) + 9}-12-31`;
            if (type === 'movie') { params['primary_release_date.gte'] = start; params['primary_release_date.lte'] = end; }
            else { params['first_air_date.gte'] = start; params['first_air_date.lte'] = end; }
          }
          try {
            const data = type === 'movie' ? await TMDB.discoverMovies(params) : await TMDB.discoverTv(params);
            out.push(...(data.results || []).map(r => this.fromTmdbResult(r, type, profile, filters)));
          } catch (e) { console.warn('Discover failed', type, e); }
        }
        if (out.length - seenBefore >= (filters.language ? this.regionalFetchTarget(filters) : Math.max(filters.count * 3, 12))) break;
      }
    }
    return out;
  },

  async fetchLanguageBackfill(profile, filters) {
    if (!filters.language) return [];
    const out = [];
    const types = filters.type === 'both' ? ['movie', 'tv'] : [filters.type];
    const target = this.regionalFetchTarget(filters);

    for (const type of types) {
      const explicitGenreId = this.genreIdFor(type, filters.genre || '');
      const genrePasses = explicitGenreId ? [explicitGenreId] : [''];
      for (const genreId of genrePasses) {
        const sorts = ['popularity.desc', type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc', 'vote_count.desc', 'vote_average.desc'];
        for (const sort of sorts) {
          const maxPages = sort === 'popularity.desc' ? 20 : 12;
          for (let page = 1; page <= maxPages; page++) {
            const params = {
              page,
              sort_by: sort,
              with_original_language: filters.language,
              'vote_count.gte': 0,
            };
            if (genreId) params.with_genres = genreId;
            if (filters.minTmdbRating) params['vote_average.gte'] = filters.minTmdbRating;
            if (filters.decade) {
              const start = `${filters.decade}-01-01`;
              const end = `${Number(filters.decade) + 9}-12-31`;
              if (type === 'movie') { params['primary_release_date.gte'] = start; params['primary_release_date.lte'] = end; }
              else { params['first_air_date.gte'] = start; params['first_air_date.lte'] = end; }
            }
            try {
              const data = type === 'movie' ? await TMDB.discoverMovies(params) : await TMDB.discoverTv(params);
              const results = data.results || [];
              out.push(...results.map(r => this.fromTmdbResult(r, type, profile, filters)));
              if (!results.length) break;
            } catch (e) { console.warn('Language backfill failed', type, e); break; }
            if (this.dedupeCandidates(out).length >= target) return out;
          }
        }
      }
    }
    return out;
  },

  async readMetadataCache() {
    if (this._metadataCache) return this._metadataCache;
    this._metadataCache = await new Promise(resolve => {
      try {
        chrome.storage.local.get(['wtRecommendationMetadataCache'], d => resolve(d.wtRecommendationMetadataCache || {}));
      } catch (_) { resolve({}); }
    });
    return this._metadataCache;
  },

  async writeMetadataCache() {
    if (!this._metadataCache) return;
    try { chrome.storage.local.set({ wtRecommendationMetadataCache: this._metadataCache }); } catch (_) {}
  },

  metadataKey(mediaType, tmdbId) {
    return `${mediaType || 'movie'}:${Number(tmdbId || 0)}`;
  },

  isFreshMetadata(entry) {
    const ttl = 1000 * 60 * 60 * 24 * 90;
    return entry && entry.fetchedAt && (Date.now() - Number(entry.fetchedAt)) < ttl;
  },

  normalizeTmdbMetadata(details = {}, mediaType = 'movie') {
    const credits = details.credits || {};
    const crew = Array.isArray(credits.crew) ? credits.crew : [];
    const cast = Array.isArray(credits.cast) ? credits.cast : [];
    const keywordPayload = mediaType === 'movie' ? details.keywords?.keywords : details.keywords?.results;
    const countries = details.production_countries || details.origin_country || [];
    const episodeRunTime = Array.isArray(details.episode_run_time) ? details.episode_run_time[0] : 0;
    return {
      imdbId: details.imdb_id || details.external_ids?.imdb_id || '',
      runtime: details.runtime || episodeRunTime || 0,
      keywords: (keywordPayload || []).map(k => k.name).filter(Boolean),
      directors: crew.filter(p => p.job === 'Director' || p.department === 'Directing').map(p => p.name).slice(0, 6),
      writers: crew.filter(p => ['Writer', 'Screenplay', 'Story', 'Teleplay', 'Creator'].includes(p.job)).map(p => p.name).slice(0, 8),
      actors: cast.map(p => p.name).filter(Boolean).slice(0, 10),
      countries: Array.isArray(countries) ? countries.map(c => c.iso_3166_1 || c).filter(Boolean) : [],
      productionCompanies: (details.production_companies || []).map(c => c.name).filter(Boolean).slice(0, 8),
      fetchedAt: Date.now(),
    };
  },

  async fetchMetadataFor(mediaType, tmdbId) {
    if (!tmdbId || typeof TMDB === 'undefined') return null;
    const cache = await this.readMetadataCache();
    const key = this.metadataKey(mediaType, tmdbId);
    if (this.isFreshMetadata(cache[key])) return cache[key];
    try {
      const details = mediaType === 'tv'
        ? await TMDB.tvDetailsForRecommendation(tmdbId)
        : await TMDB.movieDetailsForRecommendation(tmdbId);
      const meta = this.normalizeTmdbMetadata(details, mediaType);
      cache[key] = meta;
      await this.writeMetadataCache();
      return meta;
    } catch (e) {
      console.warn('Recommendation metadata fetch failed', mediaType, tmdbId, e);
      return null;
    }
  },

  mergeMetadata(item, meta) {
    if (!meta) return item;
    return {
      ...item,
      imdbId: item.imdbId || meta.imdbId || '',
      runtime: item.runtime || meta.runtime || 0,
      keywords: item.keywords?.length ? item.keywords : meta.keywords || [],
      directors: item.directors?.length ? item.directors : meta.directors || [],
      writers: item.writers?.length ? item.writers : meta.writers || [],
      actors: item.actors?.length ? item.actors : meta.actors || [],
      countries: item.countries?.length ? item.countries : meta.countries || [],
      productionCompanies: item.productionCompanies?.length ? item.productionCompanies : meta.productionCompanies || [],
    };
  },

  async enrichTasteProfile(profile, tasteItems = []) {
    const rated = [...tasteItems]
      .filter(i => i.tmdbId > 0)
      .sort((a, b) => (this.getAvgPersonalRating(b.tmdbId, b.mediaType) || 0) - (this.getAvgPersonalRating(a.tmdbId, a.mediaType) || 0))
      .slice(0, 60);
    for (const item of rated) {
      const personal = this.getAvgPersonalRating(item.tmdbId, item.mediaType);
      // Metadata fetches are most useful for strong likes/dislikes. Avoid spending quota on neutral items.
      if (personal && personal > 5 && personal < 8) continue;
      const meta = await this.fetchMetadataFor(item.mediaType, item.tmdbId);
      if (!meta) continue;
      const enriched = this.mergeMetadata(item, meta);
      const signedWeight = this.preferenceWeight(personal, item);
      const target = signedWeight < 0 ? profile.negative : profile.positive;
      this.addFeaturesToBucket(target, this.extractItemFeatures(enriched), Math.abs(signedWeight) * 0.85);
    }
    profile.topGenres = this.topKeys(profile.positive.genres, 5);
    profile.topDecades = this.topKeys(profile.positive.decades, 3).map(Number);
    profile.topLanguages = this.topKeys(profile.positive.languages, 3);
    return profile;
  },

  async enrichCandidateMetadata(candidates = [], filters = {}, profile = {}) {
    const limit = filters.language ? 120 : 90;
    const prioritized = [...candidates]
      .map(c => ({ c, rough: this.roughCandidateScore(c, profile, filters) }))
      .sort((a, b) => b.rough - a.rough)
      .slice(0, limit)
      .map(x => x.c);
    const targetKeys = new Set(prioritized.map(c => this.candidateKey(c)));
    const out = [];
    for (const c of candidates) {
      if (!targetKeys.has(this.candidateKey(c))) { out.push(c); continue; }
      const meta = await this.fetchMetadataFor(c.mediaType, c.tmdbId);
      out.push(this.mergeMetadata(c, meta));
    }
    return out;
  },

  roughCandidateScore(c, profile, filters) {
    const genreOverlap = (c.genres || []).filter(g => profile?.topGenres?.includes(g)).length;
    const lang = filters.language && c.originalLanguage === filters.language ? 4 : 0;
    return (c.voteAverage || 0) + genreOverlap * 2.5 + Math.min(4, Math.log10((c.voteCount || 0) + 1)) + lang;
  },

  async fetchTasteSignalCandidates(profile, filters) {
    if (filters.style === 'random') return [];
    const out = [];
    const types = filters.type === 'both' ? ['movie', 'tv'] : [filters.type];
    const keywordNames = this.topKeys(profile.positive.keywords, 8);
    const actorNames = this.topKeys(profile.positive.actors, 5);
    const directorNames = this.topKeys(profile.positive.directors, 5);
    // TMDB discover requires numeric ids for keywords/people. Search endpoints are not
    // wrapped in tmdb.js, so this method currently uses stronger broad pools rather than
    // brittle name-to-id guessing. The enriched ranker below does the real personalization.
    for (const type of types) {
      const language = filters.language || this.topKeys(profile.positive.languages, 1)[0] || '';
      const countries = this.topKeys(profile.positive.countries, 3);
      const genreIds = (filters.genre ? [filters.genre] : this.topKeys(profile.positive.genres, 4)).map(g => this.genreIdFor(type, g)).filter(Boolean);
      const passes = [];
      for (const gid of genreIds) passes.push({ with_genres: gid });
      if (language) passes.push({ with_original_language: language });
      for (const c of countries) passes.push({ with_origin_country: c });
      for (const pass of passes.slice(0, 7)) {
        for (const sort of ['popularity.desc', 'vote_average.desc']) {
          try {
            const params = { page: 1, sort_by: sort, 'vote_count.gte': filters.language ? 0 : 50, ...pass };
            if (filters.minTmdbRating) params['vote_average.gte'] = filters.minTmdbRating;
            const data = type === 'movie' ? await TMDB.discoverMovies(params) : await TMDB.discoverTv(params);
            out.push(...(data.results || []).map(r => this.fromTmdbResult(r, type, profile, filters)));
          } catch (e) { console.warn('Taste signal discovery failed', type, e); }
        }
      }
    }
    return out;
  },

  async fetchBecauseYouLiked(tasteItems, filters) {
    const anchors = this.shuffle(tasteItems
      .filter(i => i.tmdbId > 0 && (filters.type === 'both' || i.mediaType === filters.type))
      .sort((a, b) => (this.getAvgPersonalRating(b.tmdbId, b.mediaType) || 0) - (this.getAvgPersonalRating(a.tmdbId, a.mediaType) || 0)))
      .slice(0, 6);
    const out = [];
    for (const a of anchors) {
      try {
        const data = a.mediaType === 'movie' ? await TMDB.movieRecommendations(a.tmdbId) : await TMDB.tvRecommendations(a.tmdbId);
        out.push(...(data.results || []).map(r => ({ ...this.fromTmdbResult(r, a.mediaType, null, filters), reason: `Similar to ${a.title}.` })));
        const similar = a.mediaType === 'movie' ? await TMDB.movieSimilar(a.tmdbId) : await TMDB.tvSimilar(a.tmdbId);
        out.push(...(similar.results || []).slice(0, 10).map(r => ({ ...this.fromTmdbResult(r, a.mediaType, null, filters), reason: `Similar to ${a.title}.` })));
      } catch (e) { console.warn('Recommendation anchor failed', a.title, e); }
    }
    return out;
  },

  fromTmdbResult(r, mediaType, profile, filters) {
    const title = mediaType === 'movie' ? r.title : r.name;
    const date = mediaType === 'movie' ? r.release_date : r.first_air_date;
    const genreMap = mediaType === 'movie' ? this.MOVIE_GENRES : this.TV_GENRES;
    const inv = Object.fromEntries(Object.entries(genreMap).map(([k, v]) => [String(v), k]));
    const genres = (r.genre_ids || []).map(id => inv[String(id)]).filter(Boolean);
    return {
      tmdbId: r.id,
      mediaType,
      title,
      year: parseInt((date || '').slice(0, 4)) || 0,
      posterPath: r.poster_path,
      backdropPath: r.backdrop_path,
      voteAverage: Number(r.vote_average || 0),
      voteCount: Number(r.vote_count || 0),
      popularity: Number(r.popularity || 0),
      overview: r.overview || '',
      genres,
      originalLanguage: r.original_language || '',
      imdbRating: 0,
      imdbVotes: 0,
      imdbId: '',
      reason: this.defaultReason({ genres, voteAverage: r.vote_average, voteCount: r.vote_count }, profile, filters),
    };
  },

  defaultReason(c, profile, filters) {
    if (filters.style === 'hidden') return `${Math.round(c.voteCount || 0).toLocaleString()} TMDB votes; less obvious than the usual picks.`;
    if (filters.style === 'popular') return 'Popular title that matches your filters.';
    if (filters.style === 'wild') return 'A less predictable pick with some connection to your taste.';
    return 'Recommended from your selected filters.';
  },

  passesCandidateFilters(c, filters) {
    if (!c.title) return false;
    if (filters.type !== 'both' && c.mediaType !== filters.type) return false;
    if (filters.genre && !(c.genres || []).includes(filters.genre)) return false;
    if (filters.minTmdbRating && c.voteAverage < Number(filters.minTmdbRating)) return false;
    if (filters.decade && Math.floor((c.year || 0) / 10) * 10 !== Number(filters.decade)) return false;
    if (filters.language && c.originalLanguage !== filters.language) return false;
    return true;
  },

  buildScoreContext(pool) {
    const tmdbVotes = pool.map(c => Number(c.voteCount || 0)).filter(v => v > 0);
    const tmdbRatings = pool.map(c => Number(c.voteAverage || 0)).filter(v => v > 0);
    return {
      tmdbVoteP90: this.percentile(tmdbVotes.map(v => Math.log10(v + 1)), 0.9),
      tmdbVoteP60: this.percentile(tmdbVotes, 0.6) || 50,
      avgTmdbRating: tmdbRatings.length ? tmdbRatings.reduce((a,b)=>a+b,0)/tmdbRatings.length : 6.5,
    };
  },

  percentile(values, p) {
    const arr = values.filter(v => Number.isFinite(v)).sort((a,b)=>a-b);
    if (!arr.length) return 0;
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * p)));
    return arr[idx];
  },

  normalizedVoteScore(votes, p90Log) {
    if (!votes || !p90Log) return 0;
    return Math.min(1, Math.log10(Number(votes) + 1) / p90Log);
  },

  voteMinimums(filters = {}) {
    const lang = Boolean(filters.language);
    const style = filters.style || 'best';

    // TMDB vote counts are much lower for many regional-language catalogs, so the
    // confidence floor is language-aware while still blocking one-digit-vote titles.
    if (style === 'popular') return { tmdb: lang ? 50 : 500 };
    if (style === 'hidden') return { tmdb: lang ? 15 : 50 };
    if (style === 'random') return { tmdb: lang ? 15 : 75 };
    if (style === 'wild') return { tmdb: lang ? 15 : 75 };
    return { tmdb: lang ? 20 : 100 };
  },

  hasBareVoteSignal(c) {
    const tmdbVotes = Number(c.voteCount || 0);
    // Prevent one-digit TMDB vote titles from floating into final recommendations.
    return tmdbVotes >= 10;
  },

  hasEnoughVoteConfidence(c, filters = {}) {
    const min = this.voteMinimums(filters);
    const tmdbVotes = Number(c.voteCount || 0);
    return tmdbVotes >= min.tmdb;
  },

  applyVoteConfidenceFilter(pool, filters = {}, ctx = null) {
    if (!Array.isArray(pool) || !pool.length) return [];
    const needed = Math.max(1, Number(filters.count || 3));

    const strict = pool.filter(c => this.hasEnoughVoteConfidence(c, filters));
    if (strict.length >= needed) return strict;

    // If strict confidence leaves too few regional titles, relax the dynamic floor,
    // but never allow true single-digit-vote items into new recommendations.
    const bare = pool.filter(c => this.hasBareVoteSignal(c));
    if (bare.length) return bare;

    return strict;
  },

  lowVotePenalty(c, filters = {}) {
    if (!this.hasBareVoteSignal(c)) return 60;
    if (!this.hasEnoughVoteConfidence(c, filters)) return filters.language ? 10 : 16;
    return 0;
  },

  bayesianRating(rating, votes, avg, m) {
    const R = Number(rating || 0);
    const v = Number(votes || 0);
    if (!R) return 0;
    const C = Number(avg || 6.5);
    const mm = Math.max(1, Number(m || 50));
    return ((v / (v + mm)) * R) + ((mm / (v + mm)) * C);
  },

  qualityScore(c, ctx) {
    const tmdbBayes = this.bayesianRating(c.voteAverage, c.voteCount, ctx.avgTmdbRating, ctx.tmdbVoteP60);
    return tmdbBayes || Number(c.voteAverage || 0);
  },

  bucketAffinity(values = [], map = new Map(), cap = 1) {
    if (!Array.isArray(values) || !values.length || !map || !map.size) return 0;
    const total = [...map.values()].reduce((a, b) => a + Math.max(0, Number(b || 0)), 0) || 1;
    const hit = values.reduce((sum, v) => sum + Math.max(0, Number(map.get(String(v)) || 0)), 0);
    return Math.min(cap, hit / total * 6);
  },

  profileAffinity(candidate, profile, positive = true) {
    const bucket = positive ? profile?.positive : profile?.negative;
    if (!bucket) return 0;
    const f = this.extractItemFeatures(candidate);
    return (
      this.bucketAffinity(f.genres, bucket.genres, 1.4) * 2.6 +
      this.bucketAffinity(f.keywords, bucket.keywords, 1.5) * 2.4 +
      this.bucketAffinity(f.directors, bucket.directors, 1.3) * 1.9 +
      this.bucketAffinity(f.writers, bucket.writers, 1.2) * 1.2 +
      this.bucketAffinity(f.actors, bucket.actors, 1.2) * 1.35 +
      this.bucketAffinity(f.countries, bucket.countries, 1.0) * 0.75 +
      this.bucketAffinity(f.languages, bucket.languages, 1.0) * 0.85 +
      this.bucketAffinity(f.decades.map(String), bucket.decades, 1.0) * 0.45 +
      this.bucketAffinity(f.runtimeBuckets, bucket.runtimeBuckets, 1.0) * 0.35
    );
  },

  scoreCandidate(c, profile, filters, ctx = this.buildScoreContext([c])) {
    const quality = this.qualityScore(c, ctx);
    const voteStrength = this.normalizedVoteScore(c.voteCount, ctx.tmdbVoteP90);
    const positiveAffinity = this.profileAffinity(c, profile, true);
    const negativeAffinity = this.profileAffinity(c, profile, false);
    const languageMatch = filters.language && c.originalLanguage === filters.language ? 1 : 0;
    const votePenalty = this.lowVotePenalty(c, filters);

    if (filters.style === 'random') {
      // Smart dice: still varied, but random is weighted toward quality and light taste fit.
      return (voteStrength * 42) + (quality * 3.1) + (positiveAffinity * 2.2) - (negativeAffinity * 3.4) + Math.random() * 28 - votePenalty;
    }

    let score =
      (positiveAffinity * 5.2) -
      (negativeAffinity * 6.8) +
      (quality * 2.7) +
      (voteStrength * 11) +
      (languageMatch * 8) +
      Math.random() * 1.2 -
      votePenalty;

    if (filters.style === 'hidden') {
      score += voteStrength >= 0.16 && voteStrength <= 0.72 ? 7 : -2;
      score -= Math.min(5, Number(c.popularity || 0) / 55);
    }
    if (filters.style === 'popular') score += Math.min(9, Number(c.popularity || 0) / 36) + voteStrength * 7;
    if (filters.style === 'wild') {
      const genreOverlap = (c.genres || []).filter(g => profile?.topGenres?.includes(g)).length;
      score += genreOverlap <= 1 ? 5 : -1.5;
      score += positiveAffinity > 0.2 ? 1.5 : 0;
    }
    if (filters.style === 'because') score += positiveAffinity * 1.6;
    return score;
  },

  sortForStyle(style) {
    if (style === 'popular' || style === 'random') return 'popularity.desc';
    return 'vote_average.desc';
  },

  voteCountForStyle(style) {
    if (style === 'hidden') return 80;
    if (style === 'popular') return 1000;
    if (style === 'wild') return 50;
    if (style === 'random') return 0;
    return 200;
  },

  genreIdFor(type, genreName) {
    if (!genreName) return '';
    return String((type === 'movie' ? this.MOVIE_GENRES : this.TV_GENRES)[genreName] || '');
  },

  dedupeCandidates(candidates) {
    const map = new Map();
    candidates.forEach(c => {
      const key = `${c.mediaType}:${c.tmdbId}`;
      if (!map.has(key)) map.set(key, c);
    });
    return [...map.values()];
  },

  recommendationKey(filters = {}) {
    const normalized = {
      source: filters.source || 'new',
      style: filters.style || 'best',
      type: filters.type || 'movie',
      genre: filters.genre || '',
      language: this.normalizeLanguage(filters.language || ''),
      decade: filters.decade || '',
      minTmdbRating: filters.minTmdbRating || '',
      minMyRating: filters.minMyRating || '',
      libraryMode: filters.libraryMode || 'new_only',
    };
    return `wt-recommendation-history:${JSON.stringify(normalized)}`;
  },

  candidateKey(c) {
    return `${c.mediaType || c.type || 'movie'}:${Number(c.tmdbId || c.id || 0)}`;
  },

  getRecommendationHistory(filters = {}) {
    try {
      const raw = localStorage.getItem(this.recommendationKey(filters));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  },

  rememberRecommendations(results = [], filters = {}) {
    try {
      const current = this.getRecommendationHistory(filters);
      const nextKeys = results.map(r => this.candidateKey(r)).filter(k => !k.endsWith(':0'));
      const merged = [...nextKeys, ...current.filter(k => !nextKeys.includes(k))].slice(0, 80);
      localStorage.setItem(this.recommendationKey(filters), JSON.stringify(merged));
    } catch (e) {
      // localStorage can fail in rare browser/privacy modes; recommendations should still work.
    }
  },

  filterRecentRecommendations(candidates = [], filters = {}) {
    const needed = Math.max(1, Number(filters.count || 3));
    const recent = new Set(this.getRecommendationHistory(filters));
    if (!recent.size) return candidates;

    const fresh = candidates.filter(c => !recent.has(this.candidateKey(c)));
    // Only apply the no-repeat filter if it still leaves enough choice. Otherwise the user
    // would see an empty page for narrow languages/genres.
    return fresh.length >= needed ? fresh : candidates;
  },

  jaccard(a = [], b = []) {
    const A = new Set((a || []).map(x => String(x).toLowerCase()).filter(Boolean));
    const B = new Set((b || []).map(x => String(x).toLowerCase()).filter(Boolean));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter += 1; });
    return inter / (A.size + B.size - inter);
  },

  itemSimilarity(a = {}, b = {}) {
    const af = this.extractItemFeatures(a);
    const bf = this.extractItemFeatures(b);
    return (
      this.jaccard(af.genres, bf.genres) * 0.32 +
      this.jaccard(af.keywords, bf.keywords) * 0.24 +
      this.jaccard([...af.directors, ...af.writers], [...bf.directors, ...bf.writers]) * 0.18 +
      this.jaccard(af.actors, bf.actors) * 0.12 +
      this.jaccard(af.languages, bf.languages) * 0.06 +
      this.jaccard(af.countries, bf.countries) * 0.05 +
      this.jaccard(af.decades, bf.decades) * 0.03
    );
  },

  mmrLambda(style = '') {
    if (style === 'random') return 0.58;
    if (style === 'wild') return 0.62;
    if (style === 'because') return 0.82;
    if (style === 'hidden') return 0.7;
    return 0.76;
  },

  pickWeightedDiverse(scored = [], filters = {}) {
    const count = Math.max(1, Number(filters.count || 3));
    if (!scored.length) return [];

    const base = filters.style === 'random' ? 220 : (filters.style === 'wild' ? 150 : 110);
    const poolSize = Math.min(scored.length, Math.max(count * 16, base));
    let pool = scored.slice(0, poolSize);
    const selected = [];
    const used = new Set();
    const lambda = this.mmrLambda(filters.style);
    const maxScore = Math.max(...pool.map(c => Number(c._score || 0)), 1);
    const minScore = Math.min(...pool.map(c => Number(c._score || 0)), 0);
    const range = Math.max(1, maxScore - minScore);

    while (selected.length < count && used.size < pool.length) {
      const available = pool.filter(c => !used.has(this.candidateKey(c)));
      if (!available.length) break;
      const ranked = available.map(c => {
        const relevance = (Number(c._score || 0) - minScore) / range;
        const redundancy = selected.length ? Math.max(...selected.map(s => this.itemSimilarity(c, s))) : 0;
        return { c, mmr: lambda * relevance - (1 - lambda) * redundancy };
      }).sort((a, b) => b.mmr - a.mmr);

      // Sample from the top MMR slice so lists are diverse but still not deterministic.
      const slice = ranked.slice(0, Math.max(8, count * 4)).map(x => ({ ...x.c, _score: x.mmr * 100 }));
      const candidate = this.weightedSample(slice, filters) || ranked[0].c;
      used.add(this.candidateKey(candidate));
      selected.push(candidate);
    }

    return selected.slice(0, count);
  },

  weightedSample(items = [], filters = {}) {
    if (!items.length) return null;
    const scores = items.map(i => Number(i._score || 0));
    const max = Math.max(...scores);
    // Higher temperature = more variety. Random/discovery should move around a lot;
    // closest-match should still prefer stronger picks.
    const temperature = filters.style === 'random' ? 9 : (filters.style === 'wild' ? 7 : 5);
    const weights = items.map(i => Math.exp((Number(i._score || 0) - max) / temperature));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  },

  shuffle(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
  },
};
try { globalThis.Recommendations = Recommendations; } catch (_) {}
