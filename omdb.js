/* ═══════════════════════════════════════════
   OMDb API Module — optional IMDb rating layer
   ═══════════════════════════════════════════ */

const OMDB_BASE = 'https://www.omdbapi.com/';

const OMDB = {
  _key: '',
  _cache: null,

  setKey(key) { this._key = String(key || '').trim(); },
  getKey() { return this._key; },
  hasKey() { return Boolean(this._key); },

  async _loadCache() {
    if (this._cache) return this._cache;
    this._cache = await new Promise(resolve => {
      if (!chrome?.storage?.local) return resolve({});
      chrome.storage.local.get(['omdbCache'], d => resolve(d.omdbCache || {}));
    });
    return this._cache;
  },

  async _saveCache() {
    if (!chrome?.storage?.local || !this._cache) return;
    chrome.storage.local.set({ omdbCache: this._cache });
  },

  _votesToNumber(votes) {
    if (!votes || votes === 'N/A') return 0;
    return Number(String(votes).replace(/[^0-9]/g, '')) || 0;
  },

  _normalize(payload) {
    if (!payload || payload.Response === 'False') return null;
    const imdbRating = payload.imdbRating && payload.imdbRating !== 'N/A' ? Number(payload.imdbRating) : 0;
    const imdbVotes = this._votesToNumber(payload.imdbVotes);
    return {
      imdbId: payload.imdbID || '',
      imdbRating,
      imdbVotes,
      imdbTitle: payload.Title || '',
      imdbYear: payload.Year || '',
      imdbType: payload.Type || '',
      omdbPlot: payload.Plot && payload.Plot !== 'N/A' ? payload.Plot : '',
    };
  },

  async byImdbId(imdbId) {
    if (!this._key || !imdbId) return null;
    const cache = await this._loadCache();
    const key = `id:${imdbId}`;
    if (cache[key]) return cache[key] || null;

    const url = new URL(OMDB_BASE);
    url.searchParams.set('apikey', this._key);
    url.searchParams.set('i', imdbId);
    url.searchParams.set('plot', 'short');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`OMDB ${res.status}`);
    const data = this._normalize(await res.json());
    cache[key] = data || null;
    await this._saveCache();
    return data;
  },

  async byTitle(title, year = '', mediaType = 'movie') {
    if (!this._key || !title) return null;
    const cleanTitle = String(title || '').trim();
    const type = mediaType === 'tv' ? 'series' : 'movie';
    const y = year ? String(year).slice(0, 4) : '';
    const cache = await this._loadCache();
    const key = `title:${type}:${cleanTitle.toLowerCase()}:${y}`;
    if (cache[key]) return cache[key] || null;

    const url = new URL(OMDB_BASE);
    url.searchParams.set('apikey', this._key);
    url.searchParams.set('t', cleanTitle);
    url.searchParams.set('type', type);
    if (y) url.searchParams.set('y', y);
    url.searchParams.set('plot', 'short');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`OMDB ${res.status}`);
    const data = this._normalize(await res.json());
    cache[key] = data || null;
    if (data?.imdbId) cache[`id:${data.imdbId}`] = data;
    await this._saveCache();
    return data;
  },
};
