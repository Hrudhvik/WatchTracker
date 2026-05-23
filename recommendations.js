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

  buildTasteProfile(items) {
    const genreScores = new Map();
    const decadeScores = new Map();
    const languageScores = new Map();
    const runtimeVals = [];

    items.forEach(item => {
      const personal = this.getAvgPersonalRating(item.tmdbId, item.mediaType);
      const weight = personal ? Math.max(1, personal / 2) : 1;
      (item.genres || []).forEach(g => genreScores.set(g, (genreScores.get(g) || 0) + weight));
      if (item.year) {
        const decade = Math.floor(item.year / 10) * 10;
        decadeScores.set(decade, (decadeScores.get(decade) || 0) + weight);
      }
      if (item.originalLanguage) languageScores.set(item.originalLanguage, (languageScores.get(item.originalLanguage) || 0) + weight);
      if (item.runtime) runtimeVals.push(Number(item.runtime));
    });

    const topGenres = [...genreScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
    const topDecades = [...decadeScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
    const topLanguages = [...languageScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);
    const avgRuntime = runtimeVals.length ? Math.round(runtimeVals.reduce((a, b) => a + b, 0) / runtimeVals.length) : null;

    return { topGenres, topDecades, topLanguages, avgRuntime, tasteCount: items.length };
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

    deduped = await this.enrichWithOmdb(deduped, filters, profile);
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

  async enrichWithOmdb(candidates, filters, profile) {
    if (!window.OMDB || !OMDB.hasKey || !OMDB.hasKey()) return candidates;
    const limit = filters.language ? 80 : 50;
    const prioritized = [...candidates]
      .map(c => ({
        c,
        rough: (c.voteAverage || 0) + ((c.genres || []).filter(g => profile?.topGenres?.includes(g)).length * 2) + Math.min(3, (c.voteCount || 0) / 1000)
      }))
      .sort((a, b) => b.rough - a.rough)
      .slice(0, limit)
      .map(x => x.c);
    const targetKeys = new Set(prioritized.map(c => `${c.mediaType}:${c.tmdbId}`));
    const enriched = [];
    for (const c of candidates) {
      if (!targetKeys.has(`${c.mediaType}:${c.tmdbId}`)) { enriched.push(c); continue; }
      try {
        const omdb = c.imdbId ? await OMDB.byImdbId(c.imdbId) : await OMDB.byTitle(c.title, c.year, c.mediaType);
        enriched.push(omdb ? {
          ...c,
          imdbId: omdb.imdbId || c.imdbId || '',
          imdbRating: Number(omdb.imdbRating || 0),
          imdbVotes: Number(omdb.imdbVotes || 0),
          overview: c.overview || omdb.omdbPlot || '',
        } : c);
      } catch (e) {
        console.warn('OMDb enrich failed', c.title, e);
        enriched.push(c);
      }
    }
    return enriched;
  },

  buildScoreContext(pool) {
    const tmdbVotes = pool.map(c => Number(c.voteCount || 0)).filter(v => v > 0);
    const imdbVotes = pool.map(c => Number(c.imdbVotes || 0)).filter(v => v > 0);
    const tmdbRatings = pool.map(c => Number(c.voteAverage || 0)).filter(v => v > 0);
    const imdbRatings = pool.map(c => Number(c.imdbRating || 0)).filter(v => v > 0);
    return {
      tmdbVoteP90: this.percentile(tmdbVotes.map(v => Math.log10(v + 1)), 0.9),
      imdbVoteP90: this.percentile(imdbVotes.map(v => Math.log10(v + 1)), 0.9),
      tmdbVoteP60: this.percentile(tmdbVotes, 0.6) || 50,
      imdbVoteP60: this.percentile(imdbVotes, 0.6) || 50,
      avgTmdbRating: tmdbRatings.length ? tmdbRatings.reduce((a,b)=>a+b,0)/tmdbRatings.length : 6.5,
      avgImdbRating: imdbRatings.length ? imdbRatings.reduce((a,b)=>a+b,0)/imdbRatings.length : 6.5,
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
    // floor is language-aware. Still, avoid single-digit vote titles unless OMDb/IMDb
    // provides a stronger confidence signal.
    if (style === 'popular') return { tmdb: lang ? 50 : 500, imdb: lang ? 250 : 1500 };
    if (style === 'hidden') return { tmdb: lang ? 15 : 50, imdb: lang ? 100 : 300 };
    if (style === 'random') return { tmdb: lang ? 15 : 75, imdb: lang ? 100 : 400 };
    if (style === 'wild') return { tmdb: lang ? 15 : 75, imdb: lang ? 100 : 350 };
    return { tmdb: lang ? 20 : 100, imdb: lang ? 125 : 500 };
  },

  hasBareVoteSignal(c) {
    const tmdbVotes = Number(c.voteCount || 0);
    const imdbVotes = Number(c.imdbVotes || 0);
    // This specifically prevents one-digit TMDB vote titles from floating into the
    // final picks unless IMDb has enough votes to back them up.
    return tmdbVotes >= 10 || imdbVotes >= 75;
  },

  hasEnoughVoteConfidence(c, filters = {}) {
    const min = this.voteMinimums(filters);
    const tmdbVotes = Number(c.voteCount || 0);
    const imdbVotes = Number(c.imdbVotes || 0);
    return tmdbVotes >= min.tmdb || imdbVotes >= min.imdb;
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
    const tmdbVotes = Number(c.voteCount || 0);
    const imdbVotes = Number(c.imdbVotes || 0);
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
    const imdbBayes = this.bayesianRating(c.imdbRating, c.imdbVotes, ctx.avgImdbRating, ctx.imdbVoteP60);
    if (imdbBayes && tmdbBayes) return (imdbBayes * 0.6) + (tmdbBayes * 0.4);
    return imdbBayes || tmdbBayes || Number(c.voteAverage || 0);
  },

  scoreCandidate(c, profile, filters, ctx = this.buildScoreContext([c])) {
    const genreOverlap = (c.genres || []).filter(g => profile?.topGenres?.includes(g)).length;

    const tasteScore = Math.min(10, genreOverlap * 3 + (profile?.topDecades?.includes(Math.floor((c.year || 0) / 10) * 10) ? 1.5 : 0));
    const quality = this.qualityScore(c, ctx);
    const tmdbVoteStrength = this.normalizedVoteScore(c.voteCount, ctx.tmdbVoteP90);
    const imdbVoteStrength = this.normalizedVoteScore(c.imdbVotes, ctx.imdbVoteP90);
    const voteStrength = imdbVoteStrength ? (imdbVoteStrength * 0.6 + tmdbVoteStrength * 0.4) : tmdbVoteStrength;

    if (filters.style === 'random') {
      return (voteStrength * 65) + (quality * 2.5) + Math.random() * 25 - this.lowVotePenalty(c, filters);
    }

    const isLanguageSpecific = Boolean(filters.language);
    const votePenalty = this.lowVotePenalty(c, filters);
    let score = isLanguageSpecific
      ? (tasteScore * 0.45) + (quality * 0.30) + (voteStrength * 8) + Math.random() * 2 - votePenalty
      : (tasteScore * 0.35) + (quality * 0.30) + (voteStrength * 10) + Math.random() * 2 - votePenalty;

    if (filters.style === 'hidden') {
      // Hidden gems should be credible within their own pool, not globally high-vote.
      score += voteStrength >= 0.18 && voteStrength <= 0.75 ? 5 : -2;
    }
    if (filters.style === 'popular') score += Math.min(8, c.popularity / 40) + voteStrength * 6;
    if (filters.style === 'wild') score += genreOverlap <= 1 ? 4 : 0;
    if (filters.language && c.originalLanguage === filters.language) score += 8;
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

  pickWeightedDiverse(scored = [], filters = {}) {
    const count = Math.max(1, Number(filters.count || 3));
    if (!scored.length) return [];

    // Use a broad pool so repeated clicks can actually change results. Taste-based modes
    // stay closer to the top; random/discovery mode samples more widely.
    const base = filters.style === 'random' ? 180 : (filters.style === 'wild' ? 120 : 90);
    const poolSize = Math.min(scored.length, Math.max(count * 12, base));
    const pool = scored.slice(0, poolSize);

    const selected = [];
    const used = new Set();
    const seenGenreSignatures = new Set();

    while (selected.length < count && used.size < pool.length) {
      const available = pool.filter(c => !used.has(this.candidateKey(c)));
      if (!available.length) break;

      const candidate = this.weightedSample(available, filters);
      const key = this.candidateKey(candidate);
      used.add(key);

      // Light diversity: avoid filling every slot with the exact same genre bundle when
      // there are enough alternatives. This keeps Telugu/Tamil/etc. pools from looking
      // like the same few titles reshuffled.
      const signature = (candidate.genres || []).slice(0, 2).sort().join('|');
      if (signature && seenGenreSignatures.has(signature) && selected.length < count - 1) {
        const alternatives = available.filter(c => {
          const sig = (c.genres || []).slice(0, 2).sort().join('|');
          return sig !== signature && !used.has(this.candidateKey(c));
        });
        if (alternatives.length >= (count - selected.length)) continue;
      }

      if (signature) seenGenreSignatures.add(signature);
      selected.push(candidate);
    }

    if (selected.length < count) {
      for (const c of pool) {
        const key = this.candidateKey(c);
        if (!selected.some(s => this.candidateKey(s) === key)) selected.push(c);
        if (selected.length >= count) break;
      }
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
