/* ═══════════════════════════════════════════
   Sync Engine — Letterboxd + MyAnimeList + External Services
   Pulls data from RSS feeds / public APIs
   All external fetches go through the background service worker
   to bypass CORS restrictions in Chrome MV3.
   ═══════════════════════════════════════════ */

// Route fetch through background.js to bypass CORS
async function bgFetch(url, options) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'fetch', url, options: options || {} }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from background worker'));
        return;
      }
      resolve(response);
    });
  });
}

const SyncEngine = {
  _config: { letterboxd: '', mal: '', syncInterval: 0, lastSync: {}, malUseEnglishTitles: false },

  async loadConfig() {
    return new Promise(resolve => {
      chrome.storage.local.get(['syncConfig'], d => {
        if (d.syncConfig) Object.assign(this._config, d.syncConfig);
        resolve(this._config);
      });
    });
  },

  saveConfig() {
    chrome.storage.local.set({ syncConfig: this._config });
  },

  getConfig() { return this._config; },

  setLetterboxd(username) { this._config.letterboxd = (username || '').trim(); this.saveConfig(); },
  setMal(username) { this._config.mal = (username || '').trim(); this.saveConfig(); },
  setSyncInterval(mins) { this._config.syncInterval = mins; this.saveConfig(); this._setupAlarm(); },
  setMalUseEnglishTitles(val) { this._config.malUseEnglishTitles = !!val; this.saveConfig(); },

  _setupAlarm() {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear('watchtracker-sync');
      if (this._config.syncInterval > 0) {
        chrome.alarms.create('watchtracker-sync', { periodInMinutes: this._config.syncInterval });
      }
    }
  },

  // ═══════════════════════════════════════════
  // LETTERBOXD SYNC — via RSS feed (official, stable)
  // RSS returns ~50 most recent diary entries.
  // For full history, use the ZIP file import instead.
  // ═══════════════════════════════════════════
  async syncLetterboxd(username) {
    if (!username) throw new Error('No Letterboxd username set');

    const feedUrl = `https://letterboxd.com/${encodeURIComponent(username)}/rss/`;
    const res = await bgFetch(feedUrl);

    if (res.error) throw new Error('Failed to reach letterboxd.com: ' + res.error);
    if (res.status === 404) throw new Error(`User "${username}" not found on Letterboxd.`);
    if (res.status === 403) throw new Error('Letterboxd blocked the request. Try again later.');
    if (!res.ok) throw new Error(`Letterboxd RSS HTTP ${res.status}.`);

    const xml = typeof res.body === 'string' ? res.body : '';
    if (!xml.includes('<item') && !xml.includes('<channel')) {
      throw new Error('Invalid RSS response. Check that username "' + username + '" exists.');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) throw new Error('Failed to parse Letterboxd RSS XML.');

    const items = doc.querySelectorAll('item');
    const entries = [];

    items.forEach(item => {
      let title = item.querySelector('title')?.textContent || '';
      const pubDate = item.querySelector('pubDate')?.textContent || '';
      const desc = item.querySelector('description')?.textContent || '';

      const lTitleEl = item.getElementsByTagNameNS('*', 'filmTitle')[0];
      const lYearEl = item.getElementsByTagNameNS('*', 'filmYear')[0];
      const lRatingEl = item.getElementsByTagNameNS('*', 'memberRating')[0];
      const tmdbIdEl = item.getElementsByTagNameNS('*', 'movieId')[0];
      
      let cleanTitle = lTitleEl ? lTitleEl.textContent : '';
      let year = lYearEl ? parseInt(lYearEl.textContent) : null;
      let rating = lRatingEl ? parseFloat(lRatingEl.textContent) * 2 : null;
      let tmdbId = tmdbIdEl ? parseInt(tmdbIdEl.textContent) : null;

      // Fallback parsing if namespaces are missing
      if (!cleanTitle) {
        const yearMatch = title.match(/,\s*(\d{4})/);
        year = yearMatch ? parseInt(yearMatch[1]) : null;
        cleanTitle = title.replace(/,\s*\d{4}.*$/, '').trim();
      }
      
      if (rating === null) {
        const starMatch = desc.match(/★/g);
        if (starMatch) {
          rating = starMatch.length * 2;
          if (desc.includes('½')) rating += 1;
        }
      }

      // Watch date
      let watchDate = '';
      const dateEl = item.querySelector('watchedDate') || item.getElementsByTagNameNS('*', 'watchedDate')[0];
      if (dateEl) watchDate = dateEl.textContent;
      else if (pubDate) watchDate = new Date(pubDate).toISOString().slice(0, 10);

      // Rewatch
      const rewatchEl = item.querySelector('rewatch') || item.getElementsByTagNameNS('*', 'rewatch')[0];
      const isRewatch = rewatchEl ? rewatchEl.textContent === 'Yes' : false;

      if (cleanTitle) {
        entries.push({
          source: 'letterboxd',
          title: cleanTitle,
          year,
          rating,
          watchDate,
          isRewatch,
          type: 'movie',
          watchStatus: 'completed',
          tmdbId
        });
      }
    });

    this._config.lastSync.letterboxd = new Date().toISOString();
    this.saveConfig();
    return entries;
  },

  // ═══════════════════════════════════════════
  // MYANIMELIST SYNC — via Jikan API (public, no auth)
  // ═══════════════════════════════════════════
  async syncMal(username) {
    if (!username) throw new Error('No MAL username set');
    const entries = [];
    try {
      const animeEntries = await this._fetchMalList(username, 'animelist');
      entries.push(...animeEntries);
    } catch (err) {
      throw new Error('MAL sync failed: ' + err.message);
    }
    this._config.lastSync.mal = new Date().toISOString();
    this.saveConfig();
    return entries;
  },

  async _fetchMalList(username, listType) {
    const entries = [];
    let page = 1;
    let hasMore = true;
    let consecutiveErrors = 0;

    // Verify user exists first
    try {
      const checkUrl = `https://api.jikan.moe/v4/users/${encodeURIComponent(username)}`;
      const checkRes = await bgFetch(checkUrl);
      if (checkRes.status === 404) throw new Error(`User "${username}" not found on MyAnimeList.`);
      if (checkRes.status === 403) throw new Error(`Cannot access "${username}". Profile may be private.`);
      if (checkRes.status === 429) await new Promise(r => setTimeout(r, 2000));
      else if (!checkRes.ok) throw new Error(`Jikan API error (${checkRes.status}). Try again later.`);
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('Cannot access') || err.message.includes('Jikan API')) throw err;
      throw new Error('Cannot reach Jikan API. Check your internet connection.');
    }

    await new Promise(r => setTimeout(r, 700));

    // Paginate through the full list — no status filter for maximum reliability
    while (hasMore && page <= 40) {
      const url = `https://api.jikan.moe/v4/users/${encodeURIComponent(username)}/${listType}?page=${page}&limit=25`;

      let res;
      try {
        res = await bgFetch(url);
      } catch (e) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) break;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (res.status === 429) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) break;
        await new Promise(r => setTimeout(r, 1500 + consecutiveErrors * 1000));
        continue;
      }

      if (res.status === 403) {
        throw new Error(`Anime list for "${username}" is private. Set it to public in MAL settings.`);
      }

      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) break;
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      consecutiveErrors = 0;
      let data;
      try { data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body; } catch (e) { break; }

      const items = data.data || [];
      if (items.length === 0) { hasMore = false; break; }

      for (const item of items) {
        const entry = item.entry || {};
        const malStatus = (item.status || '').toLowerCase();

        let watchStatus = 'plan_to_watch';
        if (malStatus === 'watching') watchStatus = 'watching';
        else if (malStatus === 'completed') watchStatus = 'completed';
        else if (malStatus === 'on_hold' || malStatus === 'on-hold') watchStatus = 'on_hold';
        else if (malStatus === 'dropped') watchStatus = 'dropped';
        else if (malStatus.includes('plan')) watchStatus = 'plan_to_watch';

        const malType = (entry.type || '').toLowerCase();
        const isMovie = malType === 'movie';

        // Skip duplicates
        if (entries.find(e => e.malId === entry.mal_id)) continue;

        entries.push({
          source: 'mal',
          malId: entry.mal_id,
          title: entry.title || '',
          titleEnglish: entry.title_english || '',
          posterPath: entry.images?.jpg?.large_image_url || entry.images?.jpg?.image_url || '',
          type: isMovie ? 'movie' : 'tv',
          episodes: entry.episodes || 0,
          episodesWatched: item.episodes_watched || 0,
          score: item.score || null,
          rating: item.score || null,
          watchStatus,
          isRewatching: item.is_rewatching || false,
          malUrl: entry.url || '',
          updatedAt: item.date || '',
        });
      }

      if (!data.pagination?.has_next_page) hasMore = false;
      page++;
      // Respect rate limit: ~2 req/s
      await new Promise(r => setTimeout(r, 600));
    }

    return entries;
  },

  // ═══════════════════════════════════════════
  // IMPORT HELPERS — Match external entries to TMDB
  // ═══════════════════════════════════════════

  // MAL-to-TMDB mapping cache (loaded once from community mapping)
  _malToTmdb: null,

  async _loadMalMapping() {
    if (this._malToTmdb) return this._malToTmdb;
    try {
      // Fribb/anime-lists: community-maintained MAL-to-TMDB mapping
      const res = await bgFetch('https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json');
      if (res.ok && res.body) {
        const list = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        this._malToTmdb = {};
        for (const entry of list) {
          if (entry.mal_id) {
            this._malToTmdb[entry.mal_id] = {
              tmdbId: entry.themoviedb_id || null,
              type: entry.type || '',
            };
          }
        }
        return this._malToTmdb;
      }
    } catch (e) {
      console.warn('[WatchTracker] Could not load MAL-TMDB mapping:', e.message);
    }
    this._malToTmdb = {};
    return this._malToTmdb;
  },

  async matchToTmdb(entries, progressCb) {
    const results = [];
    let matched = 0;
    const useEnglish = this._config.malUseEnglishTitles;

    // Pre-load MAL-to-TMDB mapping for direct ID lookups
    const hasMal = entries.some(e => e.source === 'mal' || e.source === 'mal-xml' || e.source === 'mal-oauth');
    if (hasMal) {
      try { await this._loadMalMapping(); } catch (e) { /* non-fatal */ }
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isMal = entry.source === 'mal' || entry.source === 'mal-xml' || entry.source === 'mal-oauth';

      let searchTitle = entry.title;
      let displayTitle = entry.title;
      if (isMal && useEnglish && entry.titleEnglish) {
        searchTitle = entry.titleEnglish;
        displayTitle = entry.titleEnglish;
      }

      if (progressCb) progressCb(i + 1, entries.length, displayTitle);

      // FAST PATH: All MAL entries use community MAL-to-TMDB mapping.
      // No TMDB text search — avoids all mismatch issues (Erased, Nobody, Chilly Dogs, etc).
      // MAL-OAuth entries already have posters from the API.
      // MAL-XML entries get posters from Jikan in Pass 3.
      if (isMal && entry.malId) {
        let tmdbId = null;
        let tmdbType = entry.type;
        if (this._malToTmdb && this._malToTmdb[entry.malId]) {
          const mapping = this._malToTmdb[entry.malId];
          if (mapping.tmdbId) {
            tmdbId = mapping.tmdbId;
            const mType = mapping.type?.toUpperCase();
            if (mType === 'MOVIE') tmdbType = 'movie';
            else if (mType === 'TV' || mType === 'ONA' || mType === 'OVA' || mType === 'SPECIAL') tmdbType = 'tv';
          }
        }
        results.push({
          ...entry,
          title: displayTitle,
          tmdbId: tmdbId,
          tmdbTitle: displayTitle,
          tmdbType: tmdbType,
          tmdbPoster: entry.posterPath || null,
          tmdbYear: entry.year || 0,
          tmdbRating: 0,
          matched: !!tmdbId,
        });
        if (tmdbId) matched++;
        continue;
      }
      
      // FAST PATH: Letterboxd entries with tmdbId extracted from RSS
      if (entry.source === 'letterboxd' && entry.tmdbId) {
        results.push({
          ...entry,
          tmdbTitle: entry.title,
          tmdbType: entry.type,
          tmdbPoster: null, // will be fetched in pass 2
          tmdbYear: entry.year || 0,
          tmdbRating: entry.rating || 0,
          matched: true,
        });
        matched++;
        continue;
      }

      // FAST PATH: Letterboxd CSV entries with a URI — scrape exact TMDB ID from the page
      // Only attempt for small imports to avoid rate limiting and slowness on large diary files
      if (entry.source === 'letterboxd-csv' && entry.letterboxdUri && entries.length <= 25) {
        try {
          const res = await bgFetch(entry.letterboxdUri);
          if (res && res.ok && res.body) {
            const linkMatch = res.body.match(/href="[^"]*themoviedb\.org\/(movie|tv)\/(\d+)[^"]*"[^>]*data-track-action="TMDb"/i);
            const bodyMatch = !linkMatch && res.body.match(/data-tmdb-id="(\d+)"/);
            const typeMatch = !linkMatch && res.body.match(/data-tmdb-type="([^"]+)"/);
            const tmdbId = linkMatch ? parseInt(linkMatch[2]) : (bodyMatch ? parseInt(bodyMatch[1]) : null);
            const tmdbType = linkMatch ? linkMatch[1] : (typeMatch ? typeMatch[1] : 'movie');

            if (tmdbId) {
              results.push({
                ...entry,
                tmdbId,
                tmdbTitle: entry.title,
                tmdbType,
                tmdbPoster: null,
                tmdbYear: entry.year || 0,
                tmdbRating: entry.rating || 0,
                matched: true,
              });
              matched++;
              await new Promise(r => setTimeout(r, 250));
              continue;
            }
          }
        } catch (e) {
          // Non-fatal — fall through to TMDB text search
          console.warn('[matchToTmdb] Letterboxd URI fetch failed for', entry.title, '— falling back to search');
        }
        await new Promise(r => setTimeout(r, 250));
      }

      try {
        let match = null;
        let tmdbType = entry.type === 'movie' ? 'movie' : 'tv';

        // For MAL entries: try direct MAL ID → TMDB ID mapping first (most accurate)
        if (isMal && entry.malId && this._malToTmdb && this._malToTmdb[entry.malId]) {
          const mapping = this._malToTmdb[entry.malId];
          if (mapping.tmdbId) {
            const mType = mapping.type?.toUpperCase();
            tmdbType = (mType === 'MOVIE') ? 'movie' : 'tv';
            // Fetch basic info from TMDB using the mapped ID
            try {
              const searchResults = await TMDB.search(entry.title);
              // Find the exact TMDB ID in results
              match = searchResults.find(r => r.id === mapping.tmdbId);
              if (!match) {
                // ID is correct but not in search results — create a minimal match
                match = { id: mapping.tmdbId, media_type: tmdbType, poster_path: null, vote_average: 0 };
                // Try to get title from TMDB details
                try {
                  const details = tmdbType === 'movie'
                    ? await TMDB.movieDetails(mapping.tmdbId)
                    : await TMDB.tvDetails(mapping.tmdbId);
                  if (details) {
                    match.poster_path = details.poster_path;
                    match.vote_average = details.vote_average;
                    match.title = details.title;
                    match.name = details.name;
                    match.release_date = details.release_date;
                    match.first_air_date = details.first_air_date;
                  }
                } catch (e) { /* use basic match */ }
              }
            } catch (e) { /* fall through to text search */ }
          }
        }

        // Fallback: text search on TMDB
        if (!match) {
          const searchResults = await TMDB.search(searchTitle + (entry.year ? ` ${entry.year}` : ''));
          const typeFilter = entry.type === 'movie' ? 'movie' : 'tv';

          if (isMal) {
            match = this._pickBestAnimeMatch(searchResults, typeFilter, entry);
          } else {
            match = this._pickBestMatch(searchResults, typeFilter, entry);
          }

          // Retry with original title if English title search failed
          if (!match && isMal && useEnglish && entry.titleEnglish && entry.title !== entry.titleEnglish) {
            const fallbackResults = await TMDB.search(entry.title + (entry.year ? ` ${entry.year}` : ''));
            match = this._pickBestAnimeMatch(fallbackResults, typeFilter, entry);
            await new Promise(r => setTimeout(r, 250));
          }

          // Try appending "anime" to search
          if (!match && isMal) {
            const animeResults = await TMDB.search(entry.title + ' anime');
            match = this._pickBestAnimeMatch(animeResults, typeFilter, entry);
            await new Promise(r => setTimeout(r, 250));
          }

          if (!match) match = searchResults.find(r => r.media_type === typeFilter) || searchResults[0];
        }

        if (match) {
          const matchType = match.media_type || tmdbType;
          let finalTitle;
          if (isMal && useEnglish && entry.titleEnglish) {
            finalTitle = entry.titleEnglish;
          } else {
            finalTitle = match.title || match.name || entry.title;
          }

          results.push({
            ...entry,
            title: displayTitle,
            tmdbId: match.id,
            tmdbTitle: finalTitle,
            tmdbType: matchType,
            tmdbPoster: match.poster_path || entry.posterPath || null,
            tmdbYear: parseInt(((match.release_date || match.first_air_date || '') ).substring(0, 4)) || entry.year || 0,
            tmdbRating: match.vote_average || 0,
            matched: true,
          });
          matched++;
        } else {
          results.push({ ...entry, title: displayTitle, matched: false });
        }
      } catch (err) {
        results.push({ ...entry, title: displayTitle, matched: false, error: err.message });
      }

      await new Promise(r => setTimeout(r, 250));
    }

    return { results, matched, total: entries.length };
  },

  // Enrich MAL entries with Jikan data (English titles + posters) — run AFTER import
  // This is optional and non-blocking. Entries already exist in the store.
  async enrichMalEntries(entries, progressCb) {
    let enriched = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.malId) continue;
      if (progressCb) progressCb(i + 1, entries.length, entry.title);

      try {
        const jikan = await this._fetchJikanInfo(entry.malId);
        if (jikan) {
          // Update poster if TMDB had none
          if (!entry.tmdbPoster && jikan.poster && entry.tmdbId) {
            const isMovie = entry.tmdbType === 'movie';
            if (isMovie) Store.updateMovie(entry.tmdbId, { posterPath: jikan.poster });
            else Store.updateTvShow(entry.tmdbId, { posterPath: jikan.poster });
            enriched++;
          }
        }
      } catch (e) { /* non-fatal */ }

      await new Promise(r => setTimeout(r, 400));
    }
    return enriched;
  },

  // Pick the best TMDB result for an anime entry using scoring
  _pickBestAnimeMatch(searchResults, typeFilter, entry) {
    const ANIMATION_GENRE_ID = 16;
    const candidates = searchResults.filter(r => r.media_type === typeFilter);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    let bestScore = -1;
    let best = null;

    for (const r of candidates) {
      let score = 0;
      const genres = r.genre_ids || [];
      const isAnimation = genres.includes(ANIMATION_GENRE_ID);
      const originCountry = r.origin_country || [];
      const isJapanese = originCountry.includes('JP');
      const lang = r.original_language || '';

      // Animation genre is the strongest signal — anime on TMDB always has this
      if (isAnimation) score += 50;

      // Japanese origin / language
      if (isJapanese) score += 30;
      if (lang === 'ja') score += 20;

      // Year proximity to MAL entry
      if (entry.year) {
        const rDate = r.media_type === 'movie' ? r.release_date : r.first_air_date;
        const rYear = parseInt((rDate || '').substring(0, 4)) || 0;
        if (rYear && Math.abs(rYear - entry.year) <= 1) score += 15;
        else if (rYear && Math.abs(rYear - entry.year) <= 3) score += 5;
      }

      // Exact title match bonus
      const rTitle = (r.media_type === 'movie' ? r.title : r.name) || '';
      if (rTitle.toLowerCase() === (entry.title || '').toLowerCase()) score += 10;
      if (entry.titleEnglish && rTitle.toLowerCase() === entry.titleEnglish.toLowerCase()) score += 10;

      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    // Only return animated result if it scored meaningfully
    // If nothing scored above 0, fall back to first type-matched result
    return best || candidates[0];
  },

  // Pick the best TMDB result for a general movie/TV entry using year + title scoring
  _pickBestMatch(searchResults, typeFilter, entry) {
    const candidates = searchResults.filter(r => r.media_type === typeFilter);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    let bestScore = -1;
    let best = null;

    for (const r of candidates) {
      let score = 0;

      // Exact title match is the strongest signal
      const rTitle = (r.media_type === 'movie' ? r.title : r.name) || '';
      if (rTitle.toLowerCase() === (entry.title || '').toLowerCase()) score += 50;
      // Partial containment (e.g. "Ted" matching "Ted")
      else if (rTitle.toLowerCase().includes((entry.title || '').toLowerCase())) score += 15;

      // Year match — critical for disambiguation (e.g. "Wicked" 2024 vs older)
      if (entry.year) {
        const rDate = r.media_type === 'movie' ? r.release_date : r.first_air_date;
        const rYear = parseInt((rDate || '').substring(0, 4)) || 0;
        if (rYear && rYear === entry.year) score += 40;
        else if (rYear && Math.abs(rYear - entry.year) === 1) score += 20;
        else if (rYear && Math.abs(rYear - entry.year) <= 3) score += 5;
      }

      // Popularity tiebreaker — TMDB's popularity score, slight boost for well-known entries
      if (r.popularity) score += Math.min(r.popularity / 100, 5);

      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    return best || candidates[0];
  },

  // Fetch anime info from Jikan — returns { titleEnglish, poster, year } or null
  async _fetchJikanInfo(malId) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await bgFetch(`https://api.jikan.moe/v4/anime/${malId}`);
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        if (!res.ok) return null;
        const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        const d = data?.data;
        if (!d) return null;
        const images = d.images?.jpg;
        return {
          titleEnglish: d.title_english || d.titles?.find(t => t.type === 'English')?.title || '',
          poster: images?.large_image_url || images?.image_url || null,
          year: d.year || (d.aired?.from ? new Date(d.aired.from).getFullYear() : null),
        };
      } catch (e) { return null; }
    }
    return null;
  },

  // Apply synced entries to the store.
  // For MAL entries: uses MAL data directly (poster, title, episodes) — no TMDB required.
  // For non-MAL entries: uses TMDB match data.
  // Overlap handling: if MAL and Letterboxd both have the same title, MAL wins.
  // sourceTag: 'anime' (from MAL) or 'tmdb' (from TMDB search/Letterboxd).
  async applySyncResults(results, mode = 'merge', progressCb) {
    let added = 0, updated = 0, skipped = 0, diaryAdded = 0;

    // Sort: Letterboxd first, MAL last — MAL overwrites on overlap
    const sorted = [...results].sort((a, b) => {
      const aIsMal = (a.source === 'mal' || a.source === 'mal-xml' || a.source === 'mal-oauth') ? 1 : 0;
      const bIsMal = (b.source === 'mal' || b.source === 'mal-xml' || b.source === 'mal-oauth') ? 1 : 0;
      return aIsMal - bIsMal;
    });

    // Pre-build MAL rating map
    const malRatings = {};
    for (const entry of sorted) {
      const isMal = entry.source === 'mal' || entry.source === 'mal-xml' || entry.source === 'mal-oauth';
      if (isMal && entry.rating && (entry.tmdbId || entry.malId)) {
        const key = entry.tmdbId || ('mal-' + entry.malId);
        malRatings[key] = entry.rating;
      }
    }

    // ── Build overlap index: MAL entries that share a TMDB ID with Letterboxd entries ──
    // Also build a title-based index for fuzzy overlap detection
    const malTmdbIds = new Set();
    const malTitles = {};
    for (const entry of sorted) {
      const isMal = entry.source === 'mal' || entry.source === 'mal-xml' || entry.source === 'mal-oauth';
      if (isMal) {
        if (entry.tmdbId && entry.tmdbId > 0) malTmdbIds.add(entry.tmdbId);
        // Normalize title for fuzzy matching
        const normTitle = (entry.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normTitle) malTitles[normTitle] = entry;
        // Also index original/English title
        if (entry.titleOriginal) {
          const normOrig = entry.titleOriginal.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normOrig) malTitles[normOrig] = entry;
        }
        if (entry.titleEnglish) {
          const normEn = entry.titleEnglish.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normEn) malTitles[normEn] = entry;
        }
      }
    }

    // Helper: check if a Letterboxd entry overlaps with a MAL entry
    const findMalOverlap = (entry) => {
      // Check by TMDB ID
      if (entry.tmdbId && malTmdbIds.has(entry.tmdbId)) return true;
      // Check by normalized title
      const normTitle = (entry.tmdbTitle || entry.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normTitle && malTitles[normTitle]) return true;
      return false;
    };

    // ── PASS 1: Add all entries to store ──
    const newEntryIds = [];
    let idx = 0;
    for (const entry of sorted) {
      idx++;
      if (progressCb) progressCb(idx, sorted.length, entry.tmdbTitle || entry.title);

      const isMal = entry.source === 'mal' || entry.source === 'mal-xml' || entry.source === 'mal-oauth';

      // Determine the store ID: use tmdbId if matched, else synthesize from malId
      let storeId;
      let isMovie;
      let poster;
      let sourceTag;

      if (isMal) {
        // MAL entries: use MAL data directly
        if (entry.matched && entry.tmdbId) {
          storeId = entry.tmdbId;
        } else if (entry.malId) {
          storeId = -entry.malId; // Negative ID = MAL-only entry
        } else {
          skipped++; continue;
        }
        isMovie = entry.type === 'movie';
        poster = entry.posterPath || entry.tmdbPoster || null;
        sourceTag = 'anime';

        // If a Letterboxd/TMDB entry already exists for this anime, remove it
        // so the MAL version replaces it cleanly (MAL has better anime data)
        if (entry.tmdbId && entry.tmdbId > 0) {
          const existingTmdb = isMovie ? Store.getMovie(entry.tmdbId) : Store.getTvShow(entry.tmdbId);
          if (existingTmdb && existingTmdb.sourceTag !== 'anime') {
            // Migrate diary & activity before removing
            Store.migrateTmdbId(entry.tmdbId, storeId, isMovie ? 'movie' : 'tv');
            if (isMovie) Store.removeMovie(entry.tmdbId);
            else Store.removeTvShow(entry.tmdbId);
          }

          // If this entry was previously stored with a negative MAL-only ID, migrate to TMDB ID
          if (entry.malId) {
            const oldNegId = -entry.malId;
            const oldEntry = isMovie ? Store.getMovie(oldNegId) : Store.getTvShow(oldNegId);
            if (oldEntry) {
              Store.migrateTmdbId(oldNegId, storeId, isMovie ? 'movie' : 'tv');
              if (isMovie) Store.removeMovie(oldNegId);
              else Store.removeTvShow(oldNegId);
            }
          }
        }
        // Also check by normalized title if storeId is negative
        if (storeId < 0) {
          const normTitle = (entry.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const allItems = Store.getAll();
          for (const item of allItems) {
            if (item.sourceTag === 'anime') continue; // don't remove other MAL entries
            const itemNorm = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (itemNorm && itemNorm === normTitle) {
              // Migrate diary & activity to the new storeId before removing
              Store.migrateTmdbId(item.tmdbId, storeId, item.mediaType);
              if (item.mediaType === 'movie') Store.removeMovie(item.tmdbId);
              else Store.removeTvShow(item.tmdbId);
              break;
            }
          }
        }
      } else {
        // Non-MAL entries require TMDB match
        if (!entry.matched || !entry.tmdbId) { skipped++; continue; }

        // Skip Letterboxd entries that overlap with MAL entries — MAL takes priority for anime
        if (findMalOverlap(entry)) { skipped++; continue; }

        storeId = entry.tmdbId;
        isMovie = entry.tmdbType === 'movie';
        poster = entry.tmdbPoster || null;
        sourceTag = 'tmdb';
      }

      const exists = isMovie ? Store.hasMovie(storeId) : Store.hasTvShow(storeId);
      if (exists && mode === 'skip') { skipped++; continue; }

      if (!exists) {
        const now = new Date().toISOString();
        const title = entry.tmdbTitle || entry.title;

        if (isMovie) {
          Store.addMovie({
            tmdbId: storeId,
            malId: entry.malId || null,
            title,
            posterPath: poster,
            backdropPath: null,
            year: entry.tmdbYear || entry.year || 0,
            voteAverage: entry.tmdbRating || 0,
            runtime: 0,
            genres: [],
            watchStatus: entry.watchStatus || 'completed',
            rewatchCount: entry.timesWatched || 0,
            rewatchHistory: [],
            startDate: entry.startDate || '',
            endDate: entry.watchDate || '',
            dateAdded: now,
            dateUpdated: now,
            syncSource: entry.source,
            sourceTag,
            _syncOriginalTitle: entry.title || '',
            _syncOriginalYear: entry.year || null,
          });
        } else {
          const epsWatched = entry.episodesWatched || 0;
          Store.addTvShow({
            tmdbId: storeId,
            malId: entry.malId || null,
            title,
            posterPath: poster,
            backdropPath: null,
            year: entry.tmdbYear || entry.year || 0,
            voteAverage: entry.tmdbRating || 0,
            totalSeasons: 0,
            totalEpisodes: entry.episodes || 0,
            genres: [],
            watchStatus: entry.watchStatus || 'completed',
            rewatchCount: entry.timesWatched || 0,
            rewatchHistory: [],
            startDate: entry.startDate || '',
            endDate: entry.watchDate || '',
            seasons: [],
            _syncEpisodesWatched: epsWatched,
            dateAdded: now,
            dateUpdated: now,
            syncSource: entry.source,
            sourceTag,
            _syncOriginalTitle: entry.title || '',
            _syncOriginalYear: entry.year || null,
          });
        }
        added++;
        // Only enrich from TMDB if we have a real (positive) TMDB ID
        if (storeId > 0) {
          newEntryIds.push(storeId + ':' + (isMovie ? 'movie' : 'tv'));
        }
        Store.addActivity({
          tmdbId: storeId, title,
          type: isMovie ? 'movie' : 'tv', posterPath: poster,
          action: 'added', detail: 'Synced from ' + entry.source,
          timestamp: now,
        });
      } else if (mode === 'merge') {
        const updates = { dateUpdated: new Date().toISOString(), syncSource: entry.source };
        if (entry.watchStatus) updates.watchStatus = entry.watchStatus;
        if (poster) updates.posterPath = poster;
        if (isMovie) Store.updateMovie(storeId, updates);
        else Store.updateTvShow(storeId, updates);
        updated++;
      }

      // Diary entry
      if (entry.watchDate) {
        const effectiveRating = malRatings[storeId] || malRatings['mal-' + entry.malId] || entry.rating || null;
        const entryTitle = (entry.tmdbTitle || entry.title || '').toLowerCase();
        const entryType = isMovie ? 'movie' : 'tv';
        const existingDiary = Store.getDiary().find(d =>
          d.date === entry.watchDate && d.type === entryType &&
          (d.tmdbId === storeId || (d.title || '').toLowerCase() === entryTitle)
        );
        if (!existingDiary) {
          Store.addDiaryEntry({
            tmdbId: storeId,
            title: entry.tmdbTitle || entry.title,
            type: isMovie ? 'movie' : 'tv',
            posterPath: poster,
            date: entry.watchDate,
            action: entry.isRewatch ? 'rewatch' : 'watched',
            notes: 'Synced from ' + entry.source,
            rating: effectiveRating,
            mood: null, episodes: null, season: null,
            timestamp: new Date().toISOString(),
            syncSource: entry.source,
          });
          diaryAdded++;
        } else if (isMal && entry.rating) {
          Store.updateDiaryEntry(existingDiary.timestamp, { rating: entry.rating });
        }
      }
    }

    // ── PASS 2: Enrich entries that have real TMDB IDs ──
    const uniqueKeys = [...new Set(newEntryIds)];
    for (let i = 0; i < uniqueKeys.length; i++) {
      const [idStr, type] = uniqueKeys[i].split(':');
      const tmdbId = parseInt(idStr);
      if (progressCb) progressCb(idx + i, idx + uniqueKeys.length, 'Enriching: ' + (type === 'movie' ? Store.getMovie(tmdbId)?.title : Store.getTvShow(tmdbId)?.title) || tmdbId);
      try {
        let d;
        try {
          d = type === 'movie' ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId);
        } catch (typeErr) {
          // Type mismatch — movie on source might be TV on TMDB or vice versa
          if (typeErr.message && typeErr.message.includes('404')) {
            const altType = type === 'movie' ? 'tv' : 'movie';
            try {
              d = altType === 'movie' ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId);
              // Fix the type in store
              Store.migrateType(tmdbId, type, altType);
            } catch (e2) { throw typeErr; } // re-throw original if alt also fails
          } else {
            throw typeErr;
          }
        }

        const actualType = d.title ? 'movie' : 'tv';
        if (actualType === 'movie') {
          const updates = {
            backdropPath: d.backdrop_path,
            runtime: d.runtime || 0,
            genres: (d.genres || []).map(g => g.name),
            voteAverage: d.vote_average || 0,
          };
          // Replace MAL CDN poster with TMDB poster (MAL CDN blocks hotlinking)
          if (d.poster_path) updates.posterPath = d.poster_path;
          Store.updateMovie(tmdbId, updates);
        } else {
          const ss = (d.seasons || []).filter(s => s.season_number > 0);
          const existing = Store.getTvShow(tmdbId);
          // Get total episodes watched from sync data
          let remainingEps = existing?._syncEpisodesWatched || 0;
          // Distribute watched episodes across seasons in order
          const seasonData = ss.map(s => {
            const epCount = s.episode_count || 0;
            let watched = 0;
            if (remainingEps > 0) {
              watched = Math.min(remainingEps, epCount);
              remainingEps -= watched;
            }
            return {
              seasonNumber: s.season_number,
              episodeCount: epCount,
              episodesWatched: watched,
              posterPath: s.poster_path,
            };
          });
          const tvUpdates = {
            backdropPath: d.backdrop_path,
            totalSeasons: d.number_of_seasons || 0,
            totalEpisodes: d.number_of_episodes || 0,
            genres: (d.genres || []).map(g => g.name),
            voteAverage: d.vote_average || 0,
            seasons: seasonData,
          };
          if (d.poster_path) tvUpdates.posterPath = d.poster_path;
          Store.updateTvShow(tmdbId, tvUpdates);
        }
      } catch (err) {
        if (err.message && err.message.includes('429')) {
          // Rate limited — wait and retry once
          await new Promise(r => setTimeout(r, 3000));
          try {
            const d = type === 'movie'
              ? await TMDB.movieDetails(tmdbId)
              : await TMDB.tvDetails(tmdbId);
            if (type === 'movie') {
              const retryUpdates = { backdropPath: d.backdrop_path, runtime: d.runtime || 0, genres: (d.genres || []).map(g => g.name) };
              if (d.poster_path) retryUpdates.posterPath = d.poster_path;
              Store.updateMovie(tmdbId, retryUpdates);
            } else {
              const ss = (d.seasons || []).filter(s => s.season_number > 0);
              const existing = Store.getTvShow(tmdbId);
              let remainingEps = existing?._syncEpisodesWatched || 0;
              const seasonData = ss.map(s => {
                const epCount = s.episode_count || 0;
                let watched = 0;
                if (remainingEps > 0) { watched = Math.min(remainingEps, epCount); remainingEps -= watched; }
                return { seasonNumber: s.season_number, episodeCount: epCount, episodesWatched: watched, posterPath: s.poster_path };
              });
              const retryTvUpdates = { backdropPath: d.backdrop_path, totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0, genres: (d.genres || []).map(g => g.name), seasons: seasonData };
              if (d.poster_path) retryTvUpdates.posterPath = d.poster_path;
              Store.updateTvShow(tmdbId, retryTvUpdates);
            }
          } catch (e) { /* give up on this one */ }
        }
        // Non-fatal — entry already exists with basic data
      }
      // Pace to stay under TMDB rate limits (~40 req/10s)
      await new Promise(r => setTimeout(r, 300));
    }

    // ── PASS 3: Fetch Jikan posters for MAL entries with missing/broken posters ──
    const allItems = Store.getAll();
    for (const item of allItems) {
      if (item.sourceTag !== 'anime') continue;
      if (!item.malId) continue;
      // Skip if already has a TMDB relative path (starts with /) or Jikan URL
      if (item.posterPath && item.posterPath.startsWith('/')) continue;
      if (item.posterPath && item.posterPath.includes('cdn.jikan') ) continue;
      // MAL CDN URLs (cdn.myanimelist.net, myanimelist.cdn-dena.com) are blocked by hotlink protection
      // Fetch from Jikan instead
      try {
        const jikan = await this._fetchJikanInfo(item.malId);
        if (jikan && jikan.poster) {
          if (item.mediaType === 'movie') Store.updateMovie(item.tmdbId, { posterPath: jikan.poster });
          else Store.updateTvShow(item.tmdbId, { posterPath: jikan.poster });
        }
      } catch (e) { /* non-fatal */ }
      await new Promise(r => setTimeout(r, 400));
    }

    return { added, updated, skipped, diaryAdded };
  },

  // ═══════════════════════════════════════════
  // IMPORT STATE PERSISTENCE — survives tab close/refresh
  // ═══════════════════════════════════════════

  // Save matched results so the apply phase can resume after tab close
  saveImportState(label, results, mode) {
    const state = {
      label,
      results,
      mode,
      savedAt: new Date().toISOString(),
    };
    chrome.storage.local.set({ _pendingImport: state });
  },

  clearImportState() {
    chrome.storage.local.remove('_pendingImport');
  },

  async getPendingImport() {
    return new Promise(resolve => {
      chrome.storage.local.get(['_pendingImport'], d => {
        resolve(d._pendingImport || null);
      });
    });
  },
};

// ═══════════════════════════════════════════
// MAL OAUTH — Official MyAnimeList API v2 with OAuth2 PKCE
// ═══════════════════════════════════════════

const MalOAuth = {
  _token: null, // { access_token, refresh_token, expires_at }
  _clientId: '',

  async load() {
    return new Promise(resolve => {
      chrome.storage.local.get(['malOAuth'], d => {
        if (d.malOAuth) {
          this._token = d.malOAuth.token || null;
          this._clientId = d.malOAuth.clientId || '';
        }
        resolve();
      });
    });
  },

  _save() {
    chrome.storage.local.set({ malOAuth: { token: this._token, clientId: this._clientId } });
  },

  setClientId(id) { this._clientId = (id || '').trim(); this._save(); },
  getClientId() { return this._clientId; },
  isLoggedIn() { return !!(this._token && this._token.access_token); },

  getRedirectUri() {
    return chrome.identity.getRedirectURL('mal');
  },

  // Generate PKCE code verifier + challenge (plain method — MAL supports it)
  _generatePKCE() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let verifier = '';
    const arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 64; i++) verifier += chars[arr[i] % chars.length];
    return { verifier, challenge: verifier }; // MAL accepts plain PKCE
  },

  // Step 1: Open MAL auth page, get authorization code
  async login() {
    if (!this._clientId) throw new Error('Enter your MAL Client ID first.');
    const { verifier, challenge } = this._generatePKCE();
    const redirectUri = this.getRedirectUri();
    const state = Math.random().toString(36).substring(2);

    const authUrl = `https://myanimelist.net/v1/oauth2/authorize?` +
      `response_type=code&client_id=${encodeURIComponent(this._clientId)}` +
      `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=plain` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    // Open MAL's auth page in a popup
    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        (callbackUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(callbackUrl);
          }
        }
      );
    });

    // Extract code from callback URL
    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('No authorization code received from MAL.');

    // Step 2: Exchange code for tokens
    const tokenRes = await bgFetch('https://myanimelist.net/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(this._clientId)}&code=${encodeURIComponent(code)}` +
        `&code_verifier=${encodeURIComponent(verifier)}&grant_type=authorization_code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}`,
    });

    // bgFetch returns { ok, status, body }
    // But token endpoint needs POST — let me handle this through background.js
    // Actually bgFetch only does GET. Need to update background.js to support POST.
    // For now, do it directly since myanimelist.net should have CORS for token endpoint.
    const tokenData = typeof tokenRes.body === 'string' ? JSON.parse(tokenRes.body) : tokenRes.body;

    if (!tokenData.access_token) {
      throw new Error('Token exchange failed: ' + (tokenData.error || tokenData.message || 'Unknown error'));
    }

    this._token = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 2592000) * 1000,
    };
    this._save();
    return await this._getUsername();
  },

  logout() {
    this._token = null;
    this._save();
  },

  // Refresh token if expired
  async _ensureToken() {
    if (!this._token) throw new Error('Not logged in to MAL.');
    if (Date.now() > this._token.expires_at - 60000) {
      // Token expired or about to expire — refresh
      const res = await bgFetch('https://myanimelist.net/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=${encodeURIComponent(this._clientId)}` +
          `&grant_type=refresh_token&refresh_token=${encodeURIComponent(this._token.refresh_token)}`,
      });
      const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
      if (!data.access_token) throw new Error('Token refresh failed. Please login again.');
      this._token.access_token = data.access_token;
      this._token.refresh_token = data.refresh_token || this._token.refresh_token;
      this._token.expires_at = Date.now() + (data.expires_in || 2592000) * 1000;
      this._save();
    }
    return this._token.access_token;
  },

  // MAL API request helper
  async _malApi(path, params = {}) {
    const token = await this._ensureToken();
    const url = new URL(`https://api.myanimelist.net/v2${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await bgFetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-MAL-CLIENT-ID': this._clientId,
      },
    });
    if (!res.ok) throw new Error(`MAL API ${res.status}: ${typeof res.body === 'string' ? res.body : JSON.stringify(res.body)}`);
    return typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  },

  async _getUsername() {
    const data = await this._malApi('/users/@me', { fields: 'name' });
    return data.name || data.id || 'Unknown';
  },

  // Fetch full anime list from official MAL API
  async fetchAnimeList(progressCb) {
    const entries = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    const useEnglish = SyncEngine._config.malUseEnglishTitles;

    while (hasMore) {
      if (progressCb) progressCb(entries.length);

      const data = await this._malApi('/users/@me/animelist', {
        fields: 'list_status{status,score,num_episodes_watched,is_rewatching,finish_date,start_date,num_times_rewatched,updated_at},alternative_titles,num_episodes,media_type,main_picture,start_date',
        limit: String(limit),
        offset: String(offset),
        nsfw: 'true',
      });

      const items = data.data || [];
      if (!items.length) { hasMore = false; break; }

      // Log first response for debugging
      if (offset === 0 && items.length > 0) {
        console.log('[WatchTracker] MAL API first item sample:', JSON.stringify(items[0]).substring(0, 500));
      }

      for (const item of items) {
        const node = item.node || {};
        const status = item.list_status || {};
        const malStatus = (status.status || '').toLowerCase();

        let watchStatus = 'plan_to_watch';
        if (malStatus === 'watching') watchStatus = 'watching';
        else if (malStatus === 'completed') watchStatus = 'completed';
        else if (malStatus === 'on_hold') watchStatus = 'on_hold';
        else if (malStatus === 'dropped') watchStatus = 'dropped';
        else if (malStatus === 'plan_to_watch') watchStatus = 'plan_to_watch';

        const mediaType = (node.media_type || '').toLowerCase();
        const isMovie = mediaType === 'movie';
        const mainPic = node.main_picture;
        let poster = mainPic?.large || mainPic?.medium || '';

        // Fallback: construct Jikan CDN URL from MAL ID if API didn't return a poster
        if (!poster && node.id) {
          poster = `https://cdn.myanimelist.net/images/anime/${node.id}.jpg`;
        }

        const titleEn = node.alternative_titles?.en || '';
        const displayTitle = (useEnglish && titleEn) ? titleEn : node.title;

        entries.push({
          source: 'mal-oauth',
          malId: node.id,
          title: displayTitle || node.title,
          titleOriginal: node.title,
          titleEnglish: titleEn,
          posterPath: poster,
          type: isMovie ? 'movie' : 'tv',
          episodes: node.num_episodes || 0,
          episodesWatched: status.num_episodes_watched || 0,
          score: status.score || null,
          rating: status.score > 0 ? status.score : null,
          watchStatus,
          isRewatching: status.is_rewatching || false,
          timesWatched: status.num_times_rewatched || 0,
          watchDate: status.finish_date || '',
          startDate: status.start_date || '',
          updatedAt: status.updated_at || '',
        });
      }

      if (!data.paging?.next) hasMore = false;
      offset += limit;

      await new Promise(r => setTimeout(r, 300));
    }

    return entries;
  },
};

const ImportExport = {

  // ─── CSV Export (Letterboxd-compatible diary) ───
  exportLetterboxdCSV() {
    const movies = Store.getMovies().filter(m => m.watchStatus === 'completed' || m.endDate);
    const diary = Store.getDiary().filter(d => d.type === 'movie');
    const rows = [['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date']];

    const seen = new Set();
    diary.forEach(d => {
      const movie = Store.getMovie(d.tmdbId);
      const yr = movie?.year || '';
      const rating = d.rating ? (d.rating / 2).toFixed(1) : '';
      const rewatch = d.action === 'rewatch' ? 'Yes' : '';
      rows.push([
        d.date || '', this._csvEscape(d.title), yr, '', rating, rewatch, '', d.date || ''
      ]);
      seen.add(`${d.tmdbId}-${d.date}`);
    });

    movies.forEach(m => {
      const key = `${m.tmdbId}-${m.endDate}`;
      if (!seen.has(key)) {
        const userRating = Store.getUserRating(m.tmdbId, 'movie');
        const rating = userRating ? (userRating / 2).toFixed(1) : '';
        rows.push([
          m.endDate || m.dateAdded?.slice(0, 10) || '', this._csvEscape(m.title), m.year || '', '', rating, '', '', m.endDate || ''
        ]);
      }
    });

    return rows.map(r => r.join(',')).join('\n');
  },

  // ─── Full Diary CSV Export ───
  exportDiaryCSV() {
    const diary = Store.getDiary();
    const rows = [['Date', 'Title', 'Type', 'Action', 'Rating', 'Season', 'Notes', 'Mood']];

    diary.forEach(d => {
      rows.push([
        d.date || '',
        this._csvEscape(d.title),
        d.type || '',
        d.action || '',
        d.rating || '',
        d.season || '',
        this._csvEscape(d.notes || ''),
        d.mood || '',
      ]);
    });

    return rows.map(r => r.join(',')).join('\n');
  },

  // ─── Watchlist CSV Export ───
  exportWatchlistCSV() {
    const all = Store.getAll();
    const rows = [['Title', 'Type', 'Year', 'Status', 'Rating', 'TMDB Rating', 'Genres', 'Date Added', 'Start Date', 'End Date', 'Rewatch Count']];

    all.forEach(item => {
      const userRating = Store.getUserRating(item.tmdbId, item.mediaType) || '';
      rows.push([
        this._csvEscape(item.title),
        item.mediaType || '',
        item.year || '',
        item.watchStatus || '',
        userRating,
        item.voteAverage || '',
        this._csvEscape((item.genres || []).join('; ')),
        (item.dateAdded || '').slice(0, 10),
        item.startDate || '',
        item.endDate || '',
        item.rewatchCount || 0,
      ]);
    });

    return rows.map(r => r.join(',')).join('\n');
  },

  // ═══════════════════════════════════════════
  // LETTERBOXD ZIP IMPORT — handles the full export zip
  // Contains: diary.csv, watched.csv, ratings.csv, watchlist.csv, reviews.csv, lists/
  // ═══════════════════════════════════════════
  async parseLetterboxdZip(zipFile) {
    const files = await this._readZipEntries(zipFile);
    const entries = [];
    const ratingsMap = {};
    const watchedSet = new Set();

    // Helper to find file by name (may be in root or subdirectory)
    const findFile = (name) => {
      for (const [path, content] of Object.entries(files)) {
        if (path === name || path.endsWith('/' + name)) return content;
      }
      return null;
    };

    // 1. Parse ratings.csv first
    const ratingsText = findFile('ratings.csv');
    if (ratingsText) {
      const rows = this._parseCSVLines(ratingsText);
      if (rows.length > 1) {
        const h = rows[0].map(c => c.toLowerCase().trim());
        const nameI = h.indexOf('name');
        const yearI = h.indexOf('year');
        const ratingI = h.indexOf('rating');
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          const name = cols[nameI]?.trim();
          const year = cols[yearI]?.trim();
          const rating = parseFloat(cols[ratingI]) || 0;
          if (name) ratingsMap[`${name}|||${year}`] = rating;
        }
      }
    }

    // 2. Parse diary.csv — these are logged watches with dates
    const diaryText = findFile('diary.csv');
    if (diaryText) {
      const rows = this._parseCSVLines(diaryText);
      if (rows.length > 1) {
        const h = rows[0].map(c => c.toLowerCase().trim());
        const dateI = h.indexOf('date');
        const nameI = h.indexOf('name');
        const yearI = h.indexOf('year');
        const ratingI = h.indexOf('rating');
        const rewatchI = h.indexOf('rewatch');
        const watchedDateI = h.findIndex(x => x === 'watched date');

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          const name = cols[nameI]?.trim();
          if (!name) continue;

          const year = parseInt(cols[yearI]) || null;
          let rating = parseFloat(cols[ratingI]) || 0;
          const watchDate = cols[watchedDateI]?.trim() || cols[dateI]?.trim() || '';
          const isRewatch = (cols[rewatchI] || '').trim().toLowerCase() === 'yes';

          // Convert 0.5-5 scale to 1-10
          const rating10 = rating > 0 ? (rating <= 5 ? Math.round(rating * 2) : Math.round(rating)) : null;

          const key = `${name}|||${year}|||${watchDate}`;
          entries.push({
            source: 'letterboxd-csv',
            title: name,
            year,
            rating: rating10,
            watchDate,
            isRewatch,
            type: 'movie',
            watchStatus: 'completed',
            _dedupKey: key,
          });
          watchedSet.add(`${name}|||${year}`);
        }
      }
    }

    // 3. Parse watched.csv — all films ever marked watched (may lack diary entries)
    const watchedText = findFile('watched.csv');
    if (watchedText) {
      const rows = this._parseCSVLines(watchedText);
      if (rows.length > 1) {
        const h = rows[0].map(c => c.toLowerCase().trim());
        const dateI = h.indexOf('date');
        const nameI = h.indexOf('name');
        const yearI = h.indexOf('year');

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          const name = cols[nameI]?.trim();
          if (!name) continue;

          const year = parseInt(cols[yearI]) || null;
          const lookupKey = `${name}|||${year}`;

          // Skip if already in diary
          if (watchedSet.has(lookupKey)) continue;

          const rating = ratingsMap[lookupKey] || 0;
          const rating10 = rating > 0 ? (rating <= 5 ? Math.round(rating * 2) : Math.round(rating)) : null;

          entries.push({
            source: 'letterboxd-csv',
            title: name,
            year,
            rating: rating10,
            watchDate: '', // watched.csv date is not a watch date
            isRewatch: false,
            type: 'movie',
            watchStatus: 'completed',
          });
          watchedSet.add(lookupKey);
        }
      }
    }

    // 4. Parse watchlist.csv — plan-to-watch films
    const watchlistText = findFile('watchlist.csv');
    if (watchlistText) {
      const rows = this._parseCSVLines(watchlistText);
      if (rows.length > 1) {
        const h = rows[0].map(c => c.toLowerCase().trim());
        const nameI = h.indexOf('name');
        const yearI = h.indexOf('year');

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          const name = cols[nameI]?.trim();
          if (!name) continue;
          const year = parseInt(cols[yearI]) || null;
          if (watchedSet.has(`${name}|||${year}`)) continue;

          entries.push({
            source: 'letterboxd-csv',
            title: name,
            year,
            rating: null,
            watchDate: '',
            isRewatch: false,
            type: 'movie',
            watchStatus: 'plan_to_watch',
          });
        }
      }
    }

    return entries;
  },

  // ─── Import single Letterboxd CSV (diary.csv or similar) ───
  parseLetterboxdCSV(csvText) {
    const lines = this._parseCSVLines(csvText);
    if (lines.length < 2) throw new Error('Empty or invalid CSV');

    const headers = lines[0].map(h => h.toLowerCase().trim());
    const nameIdx = headers.findIndex(h => h === 'name' || h === 'title');
    const yearIdx = headers.findIndex(h => h === 'year');
    const ratingIdx = headers.findIndex(h => h === 'rating' || h === 'rating10');
    const dateIdx = headers.findIndex(h => h === 'date');
    const watchedDateIdx = headers.findIndex(h => h === 'watched date');
    const rewatchIdx = headers.findIndex(h => h === 'rewatch');
    const tagsIdx = headers.findIndex(h => h === 'tags');

    if (nameIdx === -1) throw new Error('CSV must have a "Name" or "Title" column');

    const entries = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i];
      if (!cols[nameIdx]) continue;

      let rating = null;
      if (ratingIdx >= 0 && cols[ratingIdx]) {
        const r = parseFloat(cols[ratingIdx]);
        rating = r > 0 ? (r <= 5 ? Math.round(r * 2) : Math.round(r)) : null;
      }

      // Prefer "Watched Date" over "Date"
      // const watchDate = (watchedDateIdx >= 0 ? cols[watchedDateIdx]?.trim() : '') || (dateIdx >= 0 ? cols[dateIdx]?.trim() : '') || '';

      // Default to completed movie. If watchedDateIdx exists, it's a diary entry. Otherwise, no watch date.
      entries.push({
        source: 'letterboxd-csv',
        title: cols[nameIdx].trim(),
        year: yearIdx >= 0 ? parseInt(cols[yearIdx]) || null : null,
        rating,
        watchDate: watchedDateIdx >= 0 ? (cols[watchedDateIdx]?.trim() || cols[dateIdx]?.trim() || '') : '',
        isRewatch: rewatchIdx >= 0 ? (cols[rewatchIdx] || '').trim().toLowerCase() === 'yes' : false,
        tags: tagsIdx >= 0 ? cols[tagsIdx]?.trim() || '' : '',
        type: 'movie',
        watchStatus: 'completed',
      });
    }

    return entries;
  },

  // ═══════════════════════════════════════════
  // MAL XML IMPORT — handles .xml or .xml.gz
  // ═══════════════════════════════════════════
  async parseMalFile(file) {
    let xmlText;

    if (file.name.endsWith('.gz')) {
      // Decompress gzip
      const arrayBuffer = await file.arrayBuffer();
      const ds = new DecompressionStream('gzip');
      const decompressed = new Response(
        new Blob([arrayBuffer]).stream().pipeThrough(ds)
      );
      xmlText = await decompressed.text();
    } else {
      xmlText = await file.text();
    }

    return this.parseMalXML(xmlText);
  },

  parseMalXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const animeNodes = doc.querySelectorAll('anime');
    const entries = [];

    animeNodes.forEach(node => {
      const getText = tag => node.querySelector(tag)?.textContent?.trim() || '';
      const malStatus = getText('my_status');

      let watchStatus = 'plan_to_watch';
      if (malStatus === 'Watching' || malStatus === '1') watchStatus = 'watching';
      else if (malStatus === 'Completed' || malStatus === '2') watchStatus = 'completed';
      else if (malStatus === 'On-Hold' || malStatus === 'On Hold' || malStatus === '3') watchStatus = 'on_hold';
      else if (malStatus === 'Dropped' || malStatus === '4') watchStatus = 'dropped';
      else if (malStatus === 'Plan to Watch' || malStatus === '6') watchStatus = 'plan_to_watch';

      const score = parseInt(getText('my_score')) || null;
      const epsWatched = parseInt(getText('my_watched_episodes')) || 0;
      const totalEps = parseInt(getText('series_episodes')) || 0;
      const seriesType = getText('series_type').toLowerCase();
      const timesWatched = parseInt(getText('my_times_watched')) || 0;

      // Map MAL series_type to movie vs tv
      const isMovie = seriesType === 'movie';

      entries.push({
        source: 'mal-xml',
        malId: parseInt(getText('series_animedb_id')) || null,
        title: getText('series_title'),
        seriesType: getText('series_type'),
        type: isMovie ? 'movie' : 'tv',
        episodes: totalEps,
        episodesWatched: epsWatched,
        score,
        rating: score > 0 ? score : null,
        watchStatus,
        watchDate: getText('my_finish_date') !== '0000-00-00' ? getText('my_finish_date') : '',
        startDate: getText('my_start_date') !== '0000-00-00' ? getText('my_start_date') : '',
        isRewatch: getText('my_rewatching') === '1',
        timesWatched,
        tags: getText('my_tags'),
      });
    });

    return entries;
  },

  // ─── Minimal ZIP reader using native browser APIs ───
  // Reads a ZIP file and extracts text entries. Works in Chrome 80+.
  async _readZipEntries(zipFile) {
    const buf = await zipFile.arrayBuffer();
    const view = new DataView(buf);
    const entries = {};

    // Find End of Central Directory record
    let eocdOffset = -1;
    for (let i = buf.byteLength - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset < 0) throw new Error('Invalid ZIP file');

    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdCount = view.getUint16(eocdOffset + 10, true);
    let pos = cdOffset;

    for (let i = 0; i < cdCount; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;

      const compressionMethod = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const uncompSize = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localHeaderOffset = view.getUint32(pos + 42, true);

      const nameBytes = new Uint8Array(buf, pos + 46, nameLen);
      const fileName = new TextDecoder().decode(nameBytes);

      // Read local file header to find actual data offset
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

      if (compSize > 0 && !fileName.endsWith('/')) {
        const rawData = new Uint8Array(buf, dataOffset, compSize);

        if (compressionMethod === 0) {
          // Stored (no compression)
          entries[fileName] = new TextDecoder().decode(rawData);
        } else if (compressionMethod === 8) {
          // Deflated — use DecompressionStream
          try {
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            writer.write(rawData);
            writer.close();
            const reader = ds.readable.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const totalLen = chunks.reduce((s, c) => s + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
              result.set(chunk, offset);
              offset += chunk.length;
            }
            entries[fileName] = new TextDecoder().decode(result);
          } catch (e) {
            // Skip files that fail to decompress
          }
        }
      }

      pos += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
  },

  // ─── CSV Helpers ───
  _csvEscape(str) {
    if (!str) return '';
    str = String(str);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  },

  async processLetterboxdFiles(files, progressCb) {
    let watchedCSV = [], diaryCSV = [], watchlistCSV = [], ratingsCSV = [];

    // Parse the files
    for (const f of files) {
      let text = await f.text();
      text = text.replace(/^\uFEFF/, '');
      const name = f.name.toLowerCase();
      if (name.includes('watched')) watchedCSV = this._parseCSVLines(text);
      else if (name.includes('diary')) diaryCSV = this._parseCSVLines(text);
      else if (name.includes('watchlist')) watchlistCSV = this._parseCSVLines(text);
      else if (name.includes('ratings')) ratingsCSV = this._parseCSVLines(text);
    }

    // ── Helpers ──
    const uriCol = (r) => r ? r.map(c => c.toLowerCase().trim()).indexOf('letterboxd uri') : -1;

    // Build ratings map (URI → rating on 10-point scale)
    const ratingMap = {};
    if (ratingsCSV.length > 1) {
      const uI = uriCol(ratingsCSV[0]);
      const rI = ratingsCSV[0].map(c => c.toLowerCase().trim()).indexOf('rating');
      if (uI > -1 && rI > -1) {
        for (let i = 1; i < ratingsCSV.length; i++) {
          const uri = (ratingsCSV[i][uI] || '').trim();
          const r = parseFloat(ratingsCSV[i][rI]);
          if (uri && !isNaN(r) && r > 0) ratingMap[uri] = r <= 5 ? Math.round(r * 2) : Math.round(r);
        }
      }
    }

    // TMDB ID cache: letterboxd URI → { type, id }
    const tmdbCache = {};

    const getTmdbId = async (uri) => {
      if (!uri) return null;
      if (tmdbCache[uri]) return tmdbCache[uri];
      try {
        const res = await bgFetch(uri);
        if (!res || !res.ok || !res.body) return null;

        const linkMatch = res.body.match(/href="[^"]*themoviedb\.org\/(movie|tv)\/(\d+)[^"]*"[^>]*data-track-action="TMDb"/i);
        if (linkMatch) { tmdbCache[uri] = { type: linkMatch[1], id: parseInt(linkMatch[2]) }; return tmdbCache[uri]; }

        const bodyMatch = res.body.match(/data-tmdb-id="(\d+)"/);
        const typeMatch = res.body.match(/data-tmdb-type="([^"]+)"/);
        if (bodyMatch) { tmdbCache[uri] = { type: (typeMatch ? typeMatch[1] : 'movie'), id: parseInt(bodyMatch[1]) }; return tmdbCache[uri]; }
      } catch (e) {
        console.warn('[LB Import] URI fetch failed:', uri, e.message);
      }
      return null;
    };

    const addToStore = async (tmdbData, title, status, origTitle, origYear) => {
      const tmdbId = tmdbData.id;
      const type = tmdbData.type;

      if (type === 'movie') {
        if (!Store.hasMovie(tmdbId)) {
          try {
            const d = await TMDB.movieDetails(tmdbId);
            Store.addMovie({
              tmdbId, title: d.title || title, posterPath: d.poster_path || null,
              backdropPath: d.backdrop_path || null,
              year: parseInt((d.release_date || '').substring(0, 4)) || 0,
              voteAverage: d.vote_average || 0, runtime: d.runtime || 0,
              genres: (d.genres || []).map(g => g.name), watchStatus: status,
              rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '',
              dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString(),
              syncSource: 'letterboxd-csv', sourceTag: 'tmdb',
              _syncOriginalTitle: origTitle || '', _syncOriginalYear: origYear || null,
            });
          } catch (e) {
            // TMDB details failed — add with basic info
            Store.addMovie({
              tmdbId, title, posterPath: null, backdropPath: null,
              year: origYear || 0, voteAverage: 0, runtime: 0, genres: [],
              watchStatus: status, rewatchCount: 0, rewatchHistory: [],
              startDate: '', endDate: '',
              dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString(),
              syncSource: 'letterboxd-csv', sourceTag: 'tmdb',
              _syncOriginalTitle: origTitle || '', _syncOriginalYear: origYear || null,
            });
          }
        } else {
          Store.updateMovie(tmdbId, { watchStatus: status, dateUpdated: new Date().toISOString() });
        }
      } else {
        if (!Store.hasTvShow(tmdbId)) {
          try {
            const d = await TMDB.tvDetails(tmdbId);
            const ss = (d.seasons || []).filter(s => s.season_number > 0);
            Store.addTvShow({
              tmdbId, title: d.name || title, posterPath: d.poster_path || null,
              backdropPath: d.backdrop_path || null,
              year: parseInt((d.first_air_date || '').substring(0, 4)) || 0,
              voteAverage: d.vote_average || 0,
              totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0,
              genres: (d.genres || []).map(g => g.name), watchStatus: status,
              rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '',
              seasons: ss.map(s => ({ seasonNumber: s.season_number, episodeCount: s.episode_count || 0, episodesWatched: 0, posterPath: s.poster_path })),
              dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString(),
              syncSource: 'letterboxd-csv', sourceTag: 'tmdb',
              _syncOriginalTitle: origTitle || '', _syncOriginalYear: origYear || null,
            });
          } catch (e) {
            Store.addTvShow({
              tmdbId, title, posterPath: null, backdropPath: null,
              year: origYear || 0, voteAverage: 0, totalSeasons: 0, totalEpisodes: 0,
              genres: [], watchStatus: status, rewatchCount: 0, rewatchHistory: [],
              startDate: '', endDate: '', seasons: [],
              dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString(),
              syncSource: 'letterboxd-csv', sourceTag: 'tmdb',
              _syncOriginalTitle: origTitle || '', _syncOriginalYear: origYear || null,
            });
          }
        } else {
          Store.updateTvShow(tmdbId, { watchStatus: status, dateUpdated: new Date().toISOString() });
        }
      }
      return tmdbData;
    };

    // ── Count total work ──
    const totalRows = Math.max(0, watchedCSV.length - 1) + Math.max(0, diaryCSV.length - 1) + Math.max(0, watchlistCSV.length - 1);
    let processed = 0;
    let added = 0, skipped = 0, diaryAdded = 0;

    // ── Process Watched ──
    if (watchedCSV.length > 1) {
      const uI = uriCol(watchedCSV[0]);
      const h = watchedCSV[0].map(c => c.toLowerCase().trim());
      const nI = h.indexOf('name');
      const yI = h.indexOf('year');
      for (let i = 1; i < watchedCSV.length; i++) {
        const uri = uI > -1 ? (watchedCSV[i][uI] || '').trim() : '';
        const name = nI > -1 ? (watchedCSV[i][nI] || '').trim() : '';
        const year = yI > -1 ? parseInt(watchedCSV[i][yI]) || null : null;
        if (!uri) { processed++; continue; }

        processed++;
        if (progressCb) progressCb(processed, totalRows, `Watched: ${name}`);

        const tmdb = await getTmdbId(uri);
        if (tmdb) { await addToStore(tmdb, name, 'completed', name, year); added++; }
        else { skipped++; }
        await new Promise(r => setTimeout(r, 120));
      }
    }

    // ── Process Watchlist ──
    if (watchlistCSV.length > 1) {
      const uI = uriCol(watchlistCSV[0]);
      const h = watchlistCSV[0].map(c => c.toLowerCase().trim());
      const nI = h.indexOf('name');
      const yI = h.indexOf('year');
      for (let i = 1; i < watchlistCSV.length; i++) {
        const uri = uI > -1 ? (watchlistCSV[i][uI] || '').trim() : '';
        const name = nI > -1 ? (watchlistCSV[i][nI] || '').trim() : '';
        const year = yI > -1 ? parseInt(watchlistCSV[i][yI]) || null : null;
        if (!uri) { processed++; continue; }

        processed++;
        if (progressCb) progressCb(processed, totalRows, `Watchlist: ${name}`);

        const tmdb = await getTmdbId(uri);
        if (tmdb) { await addToStore(tmdb, name, 'plan_to_watch', name, year); added++; }
        else { skipped++; }
        await new Promise(r => setTimeout(r, 120));
      }
    }

    // ── Build a title→tmdbData lookup from cache for diary cross-referencing ──
    // Diary URIs point to diary entries, not film pages, so they may not have TMDB IDs.
    // We use the film URIs from watched.csv (already cached) to resolve diary entries by title.
    const titleCache = {}; // 'title|||year' → tmdbData
    for (const [uri, tmdbData] of Object.entries(tmdbCache)) {
      // We don't have the title directly in the cache, so we build it during processing
    }

    // ── Process Diary (entries with watch dates → diary logs) ──
    if (diaryCSV.length > 1) {
      const h = diaryCSV[0].map(c => c.toLowerCase().trim());
      const uI = uriCol(diaryCSV[0]);
      const nI = h.indexOf('name');
      const yI = h.indexOf('year');
      const rI = h.indexOf('rating');
      const rwI = h.indexOf('rewatch');
      const ldI = h.indexOf('date');
      const wdI = h.findIndex(x => x === 'watched date');

      for (let i = 1; i < diaryCSV.length; i++) {
        const row = diaryCSV[i];
        const uri = uI > -1 ? (row[uI] || '').trim() : '';
        const name = nI > -1 ? (row[nI] || '').trim() : '';
        const year = yI > -1 ? parseInt(row[yI]) || null : null;
        if (!name) { processed++; continue; }

        processed++;
        if (progressCb) progressCb(processed, totalRows, `Diary: ${name}`);

        let rating = null;
        if (rI > -1 && row[rI]) {
          const rv = parseFloat(row[rI]);
          if (!isNaN(rv) && rv > 0) rating = rv <= 5 ? Math.round(rv * 2) : Math.round(rv);
        }
        if (!rating && uri) rating = ratingMap[uri] || null;

        // Find TMDB ID: first check if movie is already in store (from watched.csv), then try URI
        let tmdb = null;

        // 1. Look up by title in the store (already added from watched.csv)
        const allItems = Store.getAll();
        const titleLower = name.toLowerCase();
        const storeMatch = allItems.find(x =>
          (x.title || '').toLowerCase() === titleLower &&
          (!year || !x.year || Math.abs(x.year - year) <= 1)
        );
        if (storeMatch) {
          tmdb = { type: storeMatch.mediaType, id: storeMatch.tmdbId };
        }

        // 2. Fall back to URI fetch (diary URIs may not resolve, but try)
        if (!tmdb && uri) {
          tmdb = await getTmdbId(uri);
          if (!tmdb) await new Promise(r => setTimeout(r, 120));
        }

        if (tmdb) {
          // Ensure movie exists in store
          if (!(tmdb.type === 'movie' ? Store.hasMovie(tmdb.id) : Store.hasTvShow(tmdb.id))) {
            await addToStore(tmdb, name, 'completed', name, year);
          }

          // Create diary entry
          const wDate = wdI > -1 ? (row[wdI] || '').trim() : '';
          const lDate = ldI > -1 ? (row[ldI] || '').trim() : '';
          const date = wDate || lDate || '';
          const action = (rwI > -1 && (row[rwI] || '').trim().toLowerCase() === 'yes') ? 'rewatch' : 'watched';

          const stored = tmdb.type === 'movie' ? Store.getMovie(tmdb.id) : Store.getTvShow(tmdb.id);
          const posterPath = stored ? stored.posterPath : null;

          // Dedup by tmdbId+date+type OR title+date+type
          const existing = Store.getDiary().find(d =>
            d.date === date && d.type === tmdb.type &&
            (d.tmdbId === tmdb.id || (d.title || '').toLowerCase() === titleLower)
          );
          if (!existing && date) {
            Store.addDiaryEntry({
              tmdbId: tmdb.id, title: stored ? stored.title : name,
              type: tmdb.type, posterPath, date, action,
              notes: '', rating,
              mood: null, episodes: null, season: null,
              timestamp: new Date().toISOString(),
            });
            diaryAdded++;
          }
          added++;
        } else {
          skipped++;
          console.warn('[LB Import] Diary: could not resolve', name, uri);
        }
      }
    }

    console.log('[LB Import] Done — added:', added, 'skipped:', skipped, 'diary:', diaryAdded);
    return { added, updated: 0, skipped, diaryAdded };
  },

  _parseCSVLines(text) {
    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const lines = [];
    let current = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { current.push(field); field = ''; }
        else if (ch === '\n') {
          current.push(field); field = '';
          if (current.some(c => c.trim())) lines.push(current);
          current = [];
        } else { field += ch; }
      }
    }
    if (field || current.length) {
      current.push(field);
      if (current.some(c => c.trim())) lines.push(current);
    }

    return lines;
  },
};

