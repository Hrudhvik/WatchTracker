/* Recommendations page UI */

const RecommendationsUI = {
  _lastResults: [],
  _lastData: null,
  _lastFilters: null,
  _renderedOnce: false,

  LANGUAGES: [
    ['en','English'], ['hi','Hindi'], ['te','Telugu'], ['ta','Tamil'], ['ml','Malayalam'], ['kn','Kannada'], ['bn','Bengali'], ['mr','Marathi'], ['pa','Punjabi'], ['gu','Gujarati'], ['ur','Urdu'], ['or','Odia'], ['as','Assamese'], ['ne','Nepali'], ['si','Sinhala'],
    ['ja','Japanese'], ['ko','Korean'], ['zh','Mandarin / Chinese'], ['cn','Cantonese'], ['th','Thai'], ['id','Indonesian'], ['ms','Malay'], ['tl','Filipino / Tagalog'], ['vi','Vietnamese'],
    ['fr','French'], ['es','Spanish'], ['it','Italian'], ['de','German'], ['pt','Portuguese'], ['ru','Russian'], ['tr','Turkish'], ['ar','Arabic'], ['fa','Persian'], ['he','Hebrew'],
    ['nl','Dutch'], ['sv','Swedish'], ['da','Danish'], ['no','Norwegian'], ['fi','Finnish'], ['pl','Polish'], ['cs','Czech'], ['hu','Hungarian'], ['ro','Romanian'], ['uk','Ukrainian'], ['el','Greek'],
    ['af','Afrikaans'], ['sw','Swahili'], ['am','Amharic'], ['zu','Zulu'], ['yo','Yoruba'], ['ha','Hausa'],
    ['la','Latin']
  ],

  render(force = false) {
    const page = document.getElementById('page-recommendations');
    if (!page) return;

    // When returning from a detail page, keep the exact recommendations/results on screen.
    if (!force && this._renderedOnce && page.innerHTML.trim()) {
      this._bindEvents();
      return;
    }

    const genres = this._availableGenres();
    page.dataset.recBound = '';
    page.innerHTML = `
      <div class="page-header rec-page-header">
        <div>
          <h1>Recommendations</h1>
          <p class="rec-subtitle">Pick from your library or find something new from TMDB using your WatchTracker taste.</p>
        </div>
      </div>

      <div class="rec-panel">
        <div class="rec-form-grid">
          ${this._select('recSource', 'Recommend', [
            ['new', 'Something new'],
            ['plan_to_watch', 'From Plan to Watch'],
            ['completed', 'From Completed'],
            ['library', 'From My Library'],
          ], 'new')}
          ${this._select('recCount', 'How many?', [['1','1'], ['3','3'], ['5','5'], ['10','10'], ['15','15'], ['20','20']], '3')}
          ${this._select('recType', 'Type', [['movie','Movies'], ['tv','TV Shows'], ['both','Movies + TV']], 'movie')}
          ${this._select('recStyle', 'Style', [
            ['best', 'Closest match'],
            ['because', 'Similar to favorites'],
            ['hidden', 'Hidden gems'],
            ['popular', 'Popular'],
            ['wild', 'Surprise me'],
            ['random', 'Random by filters'],
          ])}
          ${this._select('recLibrary', 'Existing library', [
            ['new_only', 'Exclude everything saved'],
            ['not_completed', 'Exclude completed only'],
            ['include_library', 'Allow saved items'],
          ], 'new_only')}
          ${this._select('recGenre', 'Genre', [['', 'Any / based on taste'], ...genres.map(g => [g, g])])}
          ${this._languageInput()}
          ${this._select('recTmdbRating', 'TMDB rating', [['', 'Any'], ['6','6+'], ['7','7+'], ['8','8+'], ['9','9+']])}
          ${this._select('recMyRating', 'Use my ratings', [['', 'Any'], ['6','6+'], ['7','7+'], ['8','8+'], ['9','9+']])}
          ${this._select('recDecade', 'Decade', [['', 'Any'], ['2020','2020s'], ['2010','2010s'], ['2000','2000s'], ['1990','1990s'], ['1980','1980s'], ['1970','1970s'], ['1960','1960s'], ['1950','1950s'], ['1940','1940s'], ['1930','1930s']])}
        </div>
        <div class="rec-actions">
          <button class="btn-accent" id="recSuggestBtn">Suggest</button>
          <button class="btn-ghost" id="recResetBtn">Reset</button>
          <span class="rec-inline-help" id="recHint"></span>
        </div>
      </div>

      <div id="recSummary" class="rec-summary-line"></div>

      <div id="recResults" class="rec-results-empty">
        <h3>No recommendations yet</h3>
        <p>Choose filters and press Suggest.</p>
      </div>
    `;

    this._renderedOnce = true;
    this._bindEvents();
    this._updateControls();
  },

  _bindEvents() {
    const page = document.getElementById('page-recommendations');
    if (!page || page.dataset.recBound === '1') return;
    page.dataset.recBound = '1';
    page.querySelector('#recSuggestBtn')?.addEventListener('click', () => this.suggest());
    page.querySelector('#recResetBtn')?.addEventListener('click', () => this.reset());
    page.querySelector('#recSource')?.addEventListener('change', () => this._updateControls());
    page.querySelector('#recStyle')?.addEventListener('change', () => this._updateControls());
  },

  reset() {
    this._lastResults = [];
    this._lastData = null;
    this._lastFilters = null;
    this._renderedOnce = false;
    this.render(true);
  },

  async suggest() {
    const source = document.getElementById('recSource').value;
    if (!TMDB.getKey() && source === 'new') {
      toast('Set your TMDB API key in Settings first');
      return;
    }

    const btn = document.getElementById('recSuggestBtn');
    const results = document.getElementById('recResults');
    const summary = document.getElementById('recSummary');
    btn.disabled = true;
    btn.textContent = 'Finding...';
    results.className = 'rec-loading';
    results.innerHTML = '<div class="rec-spinner"></div><p>Finding matches...</p>';

    try {
      const filters = this._readFilters();
      const data = await Recommendations.suggest(filters);
      this._lastResults = data.results || [];
      this._lastData = data;
      this._lastFilters = filters;
      this._renderSummary(summary, data, filters);
      this._renderResults(results, this._lastResults, data.source);
    } catch (err) {
      results.className = 'rec-results-empty';
      results.innerHTML = `<h3>Could not load recommendations</h3><p>${esc(err.message || String(err))}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Suggest';
    }
  },

  _readFilters() {
    return {
      source: document.getElementById('recSource').value,
      count: Number(document.getElementById('recCount').value),
      type: document.getElementById('recType').value,
      style: document.getElementById('recStyle').value,
      libraryMode: document.getElementById('recLibrary').value,
      genre: document.getElementById('recGenre').value,
      language: this._languageCode(document.getElementById('recLanguage').value),
      minTmdbRating: document.getElementById('recTmdbRating').value,
      minMyRating: document.getElementById('recMyRating').value,
      decade: document.getElementById('recDecade').value,
    };
  },

  _renderSummary(el, data, filters) {
    const p = data.profile || {};
    const bits = [];
    if (data.source === 'local') bits.push('Using saved tracker items');
    else bits.push(`${p.tasteCount || 0} taste items analyzed`);
    if (filters.minTmdbRating) bits.push(`TMDB ${filters.minTmdbRating}+`);
    if (filters.minMyRating) bits.push(`My rating ${filters.minMyRating}+`);
    if (filters.language) bits.push(this._languageName(filters.language));
    el.textContent = bits.filter(Boolean).join('  •  ');
  },

  _renderResults(container, items, source) {
    if (!items.length) {
      container.className = 'rec-results-empty';
      container.innerHTML = '<h3>No matches found</h3><p>Try fewer filters, a lower rating, or include your library.</p>';
      return;
    }
    container.className = 'rec-grid';
    container.innerHTML = items.map((m, i) => this._card(m, i, source)).join('');
    container.querySelectorAll('[data-rec-card]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        DetailUI.open(Number(card.dataset.id), card.dataset.type);
      });
    });
    container.querySelectorAll('[data-rec-add]').forEach(btn => {
      btn.addEventListener('click', async (e) => { e.stopPropagation(); await this._addToWatchlist(btn); });
    });
  },

  _card(m, i, source) {
    const poster = TMDB.poster(m.posterPath, 'w185');
    const inList = m.mediaType === 'movie' ? Store.hasMovie(m.tmdbId) : Store.hasTvShow(m.tmdbId);
    const status = m.watchStatus ? this._statusLabel(m.watchStatus) : '';
    const language = m.originalLanguage ? this._languageName(m.originalLanguage) : '';
    const imdb = m.imdbRating ? `IMDb ${Number(m.imdbRating).toFixed(1)}` : '';
    const meta = [m.year || '', m.voteAverage ? `TMDB ${Number(m.voteAverage).toFixed(1)}` : '', imdb, language].filter(Boolean).join(' · ');
    const description = this._description(m);
    const kicker = `${i + 1}. ${m.mediaType === 'movie' ? 'Movie' : 'TV Show'}${status ? ` · ${status}` : ''}`;
    const action = inList
      ? `<span class="rec-status-pill">${esc(status || 'Saved')}</span>`
      : `<button class="rec-add-btn btn-accent" data-rec-add data-id="${m.tmdbId}" data-type="${m.mediaType}">Add to Plan</button>`;
    return `
      <article class="rec-card" data-rec-card data-id="${m.tmdbId}" data-type="${m.mediaType}" title="Open ${esc(m.title)}">
        <div class="rec-poster">
          ${poster ? `<img src="${poster}" loading="lazy" alt="">` : `<div class="no-poster-ph">${m.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}
        </div>
        <div class="rec-card-body">
          <div class="rec-card-kicker">${esc(kicker)}</div>
          <h3>${esc(m.title)}</h3>
          <div class="rec-meta">${esc(meta)}</div>
          ${description ? `<p class="rec-description">${esc(description)}</p>` : ''}
          <div class="rec-card-actions">${action}</div>
        </div>
      </article>`;
  },

  async _addToWatchlist(btn) {
    const id = Number(btn.dataset.id);
    const type = btn.dataset.type;
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
      const rec = (this._lastResults || []).find(x => Number(x.tmdbId) === id && x.mediaType === type) || {};
      if (type === 'movie') {
        const d = await TMDB.movieDetails(id);
        Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.release_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.imdb_id || '', runtime: d.runtime || 0, genres: (d.genres || []).map(g => g.name), originalLanguage: d.original_language || '', watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
        Store.addActivity({ tmdbId: d.id, title: d.title, type: 'movie', posterPath: d.poster_path, action: 'added', detail: 'Added from Recommendations', timestamp: new Date().toISOString() });
      } else {
        const d = await TMDB.tvDetails(id);
        const ss = (d.seasons || []).filter(s => s.season_number > 0);
        Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.first_air_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.external_ids?.imdb_id || '', totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0, genres: (d.genres || []).map(g => g.name), originalLanguage: d.original_language || '', watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s => ({ seasonNumber: s.season_number, episodeCount: s.episode_count || 0, episodesWatched: 0, posterPath: s.poster_path })), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
        Store.addActivity({ tmdbId: d.id, title: d.name, type: 'tv', posterPath: d.poster_path, action: 'added', detail: 'Added from Recommendations', timestamp: new Date().toISOString() });
      }
      App.refreshCounts();
      btn.outerHTML = '<span class="rec-status-pill">Saved</span>';
      toast('Added to Plan to Watch');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Add to Plan';
      toast('Failed: ' + err.message);
    }
  },

  _description(item) {
    const text = item.overview || item.description || item.notes || '';
    return String(text || '').replace(/\s+/g, ' ').trim();
  },

  _select(id, label, options, selected = '') {
    return `<label class="rec-field"><span>${label}</span><select id="${id}">${options.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  },

  _languageInput() {
    const options = this.LANGUAGES.map(([code, name]) => `<option value="${esc(name)} (${esc(code)})"></option>`).join('');
    return `<label class="rec-field"><span>Language</span><input id="recLanguage" list="recLanguageOptions" type="search" placeholder="Any language"><datalist id="recLanguageOptions">${options}</datalist></label>`;
  },

  _languageCode(value = '') {
    const v = String(value || '').trim();
    if (!v) return '';
    const paren = v.match(/\(([a-z]{2})\)$/i);
    if (paren) return paren[1].toLowerCase();
    const direct = this.LANGUAGES.find(([code, name]) => code.toLowerCase() === v.toLowerCase() || name.toLowerCase() === v.toLowerCase());
    return direct ? direct[0] : v.toLowerCase();
  },

  _availableGenres() {
    const local = new Set();
    Store.getAll().forEach(i => (i.genres || []).forEach(g => local.add(g)));
    const fallback = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
    return [...new Set([...local, ...fallback])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  },

  _updateControls() {
    const source = document.getElementById('recSource')?.value;
    const style = document.getElementById('recStyle');
    const library = document.getElementById('recLibrary');
    const myRating = document.getElementById('recMyRating');
    const hint = document.getElementById('recHint');
    const isLocal = source !== 'new';
    if (style) style.disabled = isLocal;
    if (library) library.disabled = isLocal;
    if (myRating) myRating.disabled = source === 'plan_to_watch';
    if (!hint) return;
    if (source === 'new' && style?.value === 'random') hint.textContent = 'Random by filters ignores your taste and only uses filters like language, genre, rating, decade, and type.';
    else if (source === 'new') hint.textContent = 'Uses completed/rated items as taste signals, then excludes or includes saved items based on Existing library.';
    else if (source === 'plan_to_watch') hint.textContent = 'Only picks from items you saved as Plan to Watch.';
    else if (source === 'completed') hint.textContent = 'Only picks from completed/logged items.';
    else hint.textContent = 'Picks from your saved WatchTracker library.';
  },

  _statusLabel(status = '') {
    return String(status).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },

  _languageName(code = '') {
    const found = this.LANGUAGES.find(([c]) => c === code);
    return found ? found[1] : String(code || '').toUpperCase();
  },
};
