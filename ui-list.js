/* Unified Watchlist — Poster Grid | Compact | Table */

const ListUI = {
  _statusFilter: 'all', _typeFilter: 'all', _sortBy: 'dateAdded', _viewMode: 'poster',

  init() {
    document.querySelectorAll('.list-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._statusFilter = tab.dataset.status;
        this.render();
      });
    });
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._typeFilter = btn.dataset.type;
        this.render();
      });
    });
    // Sort custom dropdown
    const sortBtn = document.getElementById('listSortBtn');
    const sortMenu = document.getElementById('listSortMenu');
    const sortDD = document.getElementById('listSortDD');
    sortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !sortMenu.classList.contains('hidden');
      sortMenu.classList.toggle('hidden'); sortDD.classList.toggle('open');
    });
    sortMenu.querySelectorAll('.dd-item').forEach(item => {
      item.addEventListener('click', () => {
        this._sortBy = item.dataset.val;
        document.getElementById('listSortLabel').textContent = item.textContent;
        sortMenu.querySelectorAll('.dd-item').forEach(i => i.classList.toggle('active', i === item));
        sortMenu.classList.add('hidden'); sortDD.classList.remove('open');
        this.render();
      });
    });
    document.addEventListener('click', (e) => {
      if (!sortDD.contains(e.target)) { sortMenu.classList.add('hidden'); sortDD.classList.remove('open'); }
    });
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._viewMode = btn.dataset.grid;
        this.render();
      });
    });
  },

  _getItems() {
    let items = Store.getAll();
    if (this._statusFilter !== 'all') items = items.filter(i => i.watchStatus === this._statusFilter);
    if (this._typeFilter !== 'all') items = items.filter(i => i.mediaType === this._typeFilter);
    switch (this._sortBy) {
      case 'title': items.sort((a, b) => a.title.localeCompare(b.title)); break;
      case 'year': items.sort((a, b) => (b.year || 0) - (a.year || 0)); break;
      case 'rating': items.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0)); break;
      case 'dateUpdated': items.sort((a, b) => new Date(b.dateUpdated || b.dateAdded) - new Date(a.dateUpdated || a.dateAdded)); break;
      default: items.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
    }
    return items;
  },

  render() {
    const items = this._getItems();
    const container = document.getElementById('listContainer');
    const empty = document.getElementById('listEmpty');

    const all = Store.getAll();
    const cm = { all: all.length, watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 };
    all.forEach(i => { if (cm[i.watchStatus] !== undefined) cm[i.watchStatus]++; });
    document.querySelectorAll('.list-tab').forEach(tab => {
      const s = tab.dataset.status, c = cm[s] || 0;
      const ex = tab.querySelector('.tab-count');
      if (ex) ex.textContent = c;
      else { const sp = document.createElement('span'); sp.className = 'tab-count'; sp.textContent = c; tab.appendChild(sp); }
    });

    if (!items.length) { container.innerHTML = ''; empty.classList.add('visible'); return; }
    empty.classList.remove('visible');

    if (this._viewMode === 'poster') this._renderPoster(container, items);
    else if (this._viewMode === 'card') this._renderCard(container, items);
    else this._renderTable(container, items);
  },

  _renderPoster(c, items) {
    const sl = { watching: 'Watching', plan_to_watch: 'Plan to Watch', completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped' };
    c.innerHTML = `<div class="content-grid">${items.map(m => {
      const poster = TMDB.poster(m.posterPath, 'w342');
      const ph = m.mediaType === 'movie' ? 'MOV' : 'TV';
      const posterHtml = poster ? `<img src="${poster}" loading="lazy">` : `<div class="no-poster-ph">${ph}</div>`;
      const pips = m.mediaType === 'tv' && (m.seasons||[]).length ? `<div class="season-pips">${(m.seasons||[]).map(s => {
        const w = s.episodesWatched||0, t = s.episodeCount||0;
        return `<div class="season-pip ${w>=t&&t>0?'pip-done':w>0?'pip-active':''}"></div>`;
      }).join('')}</div>` : '';
      return `<div class="grid-card" data-tmdb="${m.tmdbId}" data-type="${m.mediaType}">
        <div class="poster-wrap">${posterHtml}<div class="poster-overlay"></div>
          <div class="poster-badge badge-${m.watchStatus}">${sl[m.watchStatus]}</div>
          <div class="poster-type-tag">${m.mediaType==='movie'?'Movie':'TV'}</div>
        </div>
        <div class="grid-card-info">
          <div class="grid-card-title" title="${esc(m.title)}">${esc(m.title)}</div>
          <div class="grid-card-meta"><span>${m.year||''}</span>
            ${m.voteAverage?`<span>·</span><span class="tmdb-score">${m.voteAverage.toFixed(1)}</span>`:''}
            ${m.mediaType==='movie'&&m.runtime?`<span>·</span><span>${m.runtime}m</span>`:''}
            ${m.mediaType==='tv'?`<span>·</span><span>${m.totalSeasons||'?'}S</span>`:''}
          </div>${pips}
        </div></div>`;
    }).join('')}</div>`;
    this._bind(c);
  },

  _renderCard(c, items) {
    const sl = { watching: 'Watching', plan_to_watch: 'Plan to Watch', completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped' };
    const sc = { watching:'var(--watching)', completed:'var(--completed)', on_hold:'var(--on-hold)', dropped:'var(--dropped)', plan_to_watch:'var(--plan)' };
    c.innerHTML = `<div class="card-list">${items.map(m => {
      const poster = TMDB.poster(m.posterPath, 'w185');
      const ph = m.mediaType === 'movie' ? 'MOV' : 'TV';
      const score = m.voteAverage ? m.voteAverage.toFixed(1) : '';
      const meta = m.mediaType === 'movie'
        ? [m.year, m.runtime ? `${Math.floor(m.runtime/60)}h ${m.runtime%60}m` : '', (m.genres||[]).slice(0,2).join(', ')].filter(Boolean).join(' · ')
        : [m.year, `${m.totalSeasons||'?'} Seasons`, `${m.totalEpisodes||'?'} Eps`].filter(Boolean).join(' · ');
      let progHtml = '';
      if (m.mediaType === 'tv') {
        const ss = m.seasons||[];
        const w = ss.reduce((s,x)=>s+(x.episodesWatched||0),0);
        const t = ss.reduce((s,x)=>s+(x.episodeCount||0),0);
        const pct = t > 0 ? Math.round(w/t*100) : 0;
        progHtml = `<div class="card-progress"><div class="card-progress-bar"><div class="card-progress-fill" style="width:${pct}%;background:${sc[m.watchStatus]||'var(--accent)'}"></div></div><span class="card-progress-text">${w}/${t}</span></div>`;
      } else {
        progHtml = m.watchStatus === 'completed' ? '<div class="card-progress"><div class="card-progress-bar"><div class="card-progress-fill" style="width:100%;background:var(--completed)"></div></div></div>' : '';
      }
      return `<div class="card-row" data-tmdb="${m.tmdbId}" data-type="${m.mediaType}">
        <div class="card-poster">${poster?`<img src="${poster}" loading="lazy">`:`<div class="no-poster-ph" style="width:100%;height:100%;font-size:11px;border-radius:6px;">${ph}</div>`}</div>
        <div class="card-body">
          <div class="card-header">
            <span class="card-title">${esc(m.title)}</span>
            <span class="card-type-badge card-type-${m.mediaType}">${m.mediaType==='movie'?'Movie':'TV'}</span>
          </div>
          <div class="card-meta">${meta}</div>
          ${progHtml}
          <div class="card-footer">
            <span class="card-status badge-${m.watchStatus}">${sl[m.watchStatus]}</span>
            ${m.rewatchCount?`<span class="card-rewatch">↻ ${m.rewatchCount}</span>`:''}
          </div>
        </div>
        ${score?`<div class="card-score-col"><span class="card-score-val">${score}</span><span class="card-score-label">TMDB</span></div>`:''}
      </div>`;
    }).join('')}</div>`;
    this._bind(c);
  },

  _renderTable(c, items) {
    const sl = { watching: 'Watching', plan_to_watch: 'Plan to Watch', completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped' };
    c.innerHTML = `<div class="table-wrap">
      <div class="table-header"><span class="th-num">#</span><span class="th-img">Image</span><span class="th-title">Title</span><span class="th-score">Score</span><span class="th-type">Type</span><span class="th-progress">Progress</span><span class="th-status">Status</span></div>
      ${items.map((m,i) => {
        const poster = TMDB.poster(m.posterPath, 'w92');
        const ph = m.mediaType === 'movie' ? 'MOV' : 'TV';
        const prog = m.mediaType === 'tv' ? this._tvProgShort(m) : (m.watchStatus==='completed'?'Done':'—');
        return `<div class="table-row" data-tmdb="${m.tmdbId}" data-type="${m.mediaType}">
          <span class="td-num">${i+1}</span>
          <span class="td-img">${poster?`<img src="${poster}">`:`<div class="no-poster-ph" style="width:36px;height:52px;font-size:9px;border-radius:4px;">${ph}</div>`}</span>
          <span class="td-title"><div class="td-title-name">${esc(m.title)}</div><div class="td-title-sub">${m.year||''}</div></span>
          <span class="td-score">${m.voteAverage?m.voteAverage.toFixed(1):'—'}</span>
          <span class="td-type">${m.mediaType==='movie'?'Movie':'TV'}</span>
          <span class="td-progress">${prog}</span>
          <span class="td-status"><span class="mini-badge badge-${m.watchStatus}">${sl[m.watchStatus]}</span></span>
        </div>`;
      }).join('')}</div>`;
    this._bind(c);
  },

  _tvProg(m) { const ss=m.seasons||[]; const w=ss.reduce((s,x)=>s+(x.episodesWatched||0),0), t=ss.reduce((s,x)=>s+(x.episodeCount||0),0); return t>0?` · ${w}/${t} eps`:''; },
  _tvProgShort(m) { const ss=m.seasons||[]; const w=ss.reduce((s,x)=>s+(x.episodesWatched||0),0), t=ss.reduce((s,x)=>s+(x.episodeCount||0),0); return t>0?`${w}/${t}`:'—'; },

  _bind(c) {
    c.querySelectorAll('[data-tmdb]').forEach(el => {
      el.addEventListener('click', () => DetailUI.open(parseInt(el.dataset.tmdb), el.dataset.type));
    });
  },
};
