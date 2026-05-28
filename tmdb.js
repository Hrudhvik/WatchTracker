/* ═══════════════════════════════════════════
   TMDB API Module
   ═══════════════════════════════════════════ */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';

const TMDB = {
  _key: '',

  setKey(key) { this._key = key; },
  getKey() { return this._key; },

  async _fetch(endpoint, params = {}) {
    if (!this._key) throw new Error('NO_API_KEY');
    const url = new URL(`${TMDB_BASE}${endpoint}`);
    url.searchParams.set('api_key', this._key);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return res.json();
  },

  // Multi search (movies + TV)
  async search(query) {
    const data = await this._fetch('/search/multi', { query, include_adult: false });
    return (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
  },

  // Full movie details with credits
  async movieDetails(id) {
    return this._fetch(`/movie/${id}`, { append_to_response: 'credits,videos,recommendations,keywords,external_ids' });
  },

  // Full TV show details
  async tvDetails(id) {
    return this._fetch(`/tv/${id}`, { append_to_response: 'credits,videos,recommendations,similar,keywords,external_ids' });
  },

  // TV season details (episodes list)
  async seasonDetails(tvId, seasonNum) {
    return this._fetch(`/tv/${tvId}/season/${seasonNum}`);
  },

  async discoverMovies(params = {}) {
    return this._fetch('/discover/movie', {
      include_adult: false,
      include_video: false,
      sort_by: 'vote_average.desc',
      ...params,
    });
  },

  async discoverTv(params = {}) {
    return this._fetch('/discover/tv', {
      include_adult: false,
      include_null_first_air_dates: false,
      sort_by: 'vote_average.desc',
      ...params,
    });
  },


  async movieDetailsForRecommendation(id) {
    return this._fetch(`/movie/${id}`, { append_to_response: 'credits,keywords,external_ids' });
  },

  async tvDetailsForRecommendation(id) {
    return this._fetch(`/tv/${id}`, { append_to_response: 'credits,keywords,external_ids' });
  },

  async movieRecommendations(id, page = 1) {
    return this._fetch(`/movie/${id}/recommendations`, { page });
  },

  async movieSimilar(id, page = 1) {
    return this._fetch(`/movie/${id}/similar`, { page });
  },

  async tvRecommendations(id, page = 1) {
    return this._fetch(`/tv/${id}/recommendations`, { page });
  },

  async tvSimilar(id, page = 1) {
    return this._fetch(`/tv/${id}/similar`, { page });
  },

  // Image helpers
  poster(path, size = 'w342') {
    if (!path) return null;
    return path.startsWith('http') ? path : `${TMDB_IMG}${size}${path}`;
  },
  backdrop(path, size = 'w1280') {
    if (!path) return null;
    return path.startsWith('http') ? path : `${TMDB_IMG}${size}${path}`;
  },
  profile(path, size = 'w185') {
    return path ? `${TMDB_IMG}${size}${path}` : null;
  },
};
try { globalThis.TMDB = TMDB; } catch (_) {}
