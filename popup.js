/* Popup — list + detail + TMDB search, TV first, persistent prefs */

const STATUS_CFG = {
  watching: { label: 'Watching', color: '#00b894' },
  completed: { label: 'Completed', color: '#6c5ce7' },
  on_hold: { label: 'On-Hold', color: '#fdcb6e' },
  dropped: { label: 'Dropped', color: '#e17055' },
  plan_to_watch: { label: 'Plan to Watch', color: '#a29bfe' },
  all: { label: 'All', color: 'linear-gradient(135deg,#00b894,#6c5ce7,#e17055)' },
};

let pFilter = 'watching', pType = 'all', pSort = 'dateUpdated', pView = 'list', pQuery = '';
let pMode = 'list';
let pSearchTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  await Store.load();
  const apiKey = Store.getApiKey();
  if (apiKey) TMDB.setKey(apiKey);
  applyPopupTheme();
  restorePrefs();
  renderList();

  document.getElementById('pOpenTab').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); window.close();
  });
  document.getElementById('pSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + '#settings' }); window.close();
  });
  document.getElementById('pClose').addEventListener('click', () => window.close());

  // Diary view
  document.getElementById('pDiaryBtn').addEventListener('click', () => enterDiaryMode());

  // Back — returns to list from any sub-view
  document.getElementById('pBack').addEventListener('click', goBackToList);

  // + Add New button — enters TMDB search mode
  document.getElementById('pAddNew').addEventListener('click', () => {
    enterTMDBMode();
  });

  // Type toggle
  document.querySelectorAll('.p-type').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.p-type').forEach(t => t.classList.remove('active'));
    b.classList.add('active'); pType = b.dataset.type; savePrefs(); renderList();
  }));

  // Custom status dropdown
  initStatusDropdown();

  // Sort custom dropdown
  initSortDropdown();

  // View toggle
  document.querySelectorAll('.p-view').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.p-view').forEach(v => v.classList.remove('active'));
    b.classList.add('active'); pView = b.dataset.view; savePrefs(); renderList();
  }));

  // Local list filter (the main search bar)
  document.getElementById('pSearch').addEventListener('input', (e) => {
    pQuery = e.target.value.trim().toLowerCase();
    renderList();
  });

  // TMDB search input (the dedicated bar)
  const tmdbInput = document.getElementById('pTmdbSearch');
  tmdbInput.addEventListener('input', (e) => {
    clearTimeout(pSearchTimeout);
    const q = e.target.value.trim();
    if (!q) {
      document.getElementById('pList').innerHTML = '<div class="p-search-msg">Type to search TMDB for movies and TV shows</div>';
      return;
    }
    if (q.length >= 2 && TMDB.getKey()) {
      document.getElementById('pList').innerHTML = '<div class="p-search-msg">Searching...</div>';
      pSearchTimeout = setTimeout(() => searchTMDB(q), 350);
    }
  });
  tmdbInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = tmdbInput.value.trim();
      if (q.length >= 2 && TMDB.getKey()) { clearTimeout(pSearchTimeout); searchTMDB(q); }
    }
    if (e.key === 'Escape') goBackToList();
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.p-status-dd')) closeStatusDD('pStatusDD');
    if (!e.target.closest('.p-sort-dd')) closeSortDD();
    document.querySelectorAll('.pd-status-dd.open').forEach(dd => {
      if (!dd.contains(e.target)) { dd.classList.remove('open'); dd.querySelector('.pd-dd-menu').classList.add('hidden'); }
    });
  });
});

/* ═══════════════════════════════════════════
   PREFS PERSISTENCE
   ═══════════════════════════════════════════ */

function savePrefs() {
  Store.setPopupPrefs({ filter: pFilter, type: pType, sort: pSort, view: pView });
}

function restorePrefs() {
  const p = Store.getPopupPrefs();
  if (!p) return;
  if (p.filter) { pFilter = p.filter; setStatusDD(pFilter); }
  if (p.type) {
    pType = p.type;
    document.querySelectorAll('.p-type').forEach(b => b.classList.toggle('active', b.dataset.type === pType));
  }
  if (p.sort) {
    pSort = p.sort;
    setSortDD(pSort);
  }
  if (p.view) {
    pView = p.view;
    document.querySelectorAll('.p-view').forEach(b => b.classList.toggle('active', b.dataset.view === pView));
  }
}

/* ═══════════════════════════════════════════
   CUSTOM STATUS DROPDOWN
   ═══════════════════════════════════════════ */

function initStatusDropdown() {
  const btn = document.getElementById('pStatusBtn');
  const dd = document.getElementById('pStatusDD');
  const menu = document.getElementById('pStatusMenu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) { closeStatusDD('pStatusDD'); }
    else { menu.classList.remove('hidden'); dd.classList.add('open'); }
  });

  menu.querySelectorAll('.p-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      const val = item.dataset.val;
      pFilter = val;
      setStatusDD(val);
      closeStatusDD('pStatusDD');
      savePrefs();
      renderList();
    });
  });
}

function setStatusDD(val) {
  const cfg = STATUS_CFG[val] || STATUS_CFG.watching;
  document.getElementById('pStatusLabel').textContent = cfg.label;
  const dot = document.getElementById('pStatusDot');
  dot.style.background = cfg.color;
  // Update active state
  document.querySelectorAll('#pStatusMenu .p-dd-item').forEach(it => {
    it.classList.toggle('active', it.dataset.val === val);
  });
}

function closeStatusDD(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  dd.classList.remove('open');
  const menu = dd.querySelector('.p-dd-menu, .pd-dd-menu');
  if (menu) menu.classList.add('hidden');
}

/* ═══════════════════════════════════════════
   CUSTOM SORT DROPDOWN
   ═══════════════════════════════════════════ */

const SORT_LABELS = { dateUpdated: 'Updated', dateAdded: 'Added', title: 'A-Z', year: 'Year' };

function initSortDropdown() {
  const btn = document.getElementById('pSortBtn');
  const dd = document.getElementById('pSortDD');
  const menu = document.getElementById('pSortMenu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) { closeSortDD(); } else { menu.classList.remove('hidden'); dd.classList.add('open'); }
  });

  menu.querySelectorAll('.p-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      pSort = item.dataset.val;
      setSortDD(pSort);
      closeSortDD();
      savePrefs();
      renderList();
    });
  });
}

function setSortDD(val) {
  document.getElementById('pSortLabel').textContent = SORT_LABELS[val] || val;
  document.querySelectorAll('#pSortMenu .p-dd-item').forEach(it => {
    it.classList.toggle('active', it.dataset.val === val);
  });
}

function closeSortDD() {
  const dd = document.getElementById('pSortDD');
  const menu = document.getElementById('pSortMenu');
  if (dd) dd.classList.remove('open');
  if (menu) menu.classList.add('hidden');
}

/* ═══════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════ */

function goBackToList() {
  pMode = 'list';
  document.getElementById('pBack').classList.add('hidden');
  document.getElementById('pControls').classList.remove('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pSearch').parentElement.classList.remove('hidden');
  document.getElementById('pAddNew').classList.remove('hidden');
  document.getElementById('pDiaryBtn').classList.remove('hidden');
  document.getElementById('pTmdbSearch').value = '';
  document.getElementById('pSearch').value = '';
  pQuery = '';
  document.getElementById('pEmpty').classList.add('hidden');
  renderList();
}

function enterDiaryMode() {
  pMode = 'diary';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pSearch').parentElement.classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  renderPopupDiary();
}

function renderPopupDiary() {
  const el = document.getElementById('pList');
  const diary = Store.getDiary();
  if (!diary.length) {
    el.innerHTML = '<div class="p-search-msg">No diary entries yet. Log a watch from any title\'s detail page.</div>';
    return;
  }

  const actLabels = { completed:'Completed', rewatch:'Rewatched', watched:'Watched', watched_episodes:'Watched eps', started:'Started', session:'Session' };

  // Group by date
  const grouped = {};
  diary.forEach(e => { const d = e.date || 'Unknown'; if (!grouped[d]) grouped[d] = []; grouped[d].push(e); });

  let html = '<div class="pd-diary-tl">';
  Object.keys(grouped).forEach(date => {
    const dateObj = new Date(date + 'T12:00:00');
    const valid = !isNaN(dateObj.getTime());
    const dayNum = valid ? dateObj.getDate() : '?';
    const mon = valid ? dateObj.toLocaleDateString('en-US', { month: 'short' }) : '';
    const dayName = valid ? dateObj.toLocaleDateString('en-US', { weekday: 'short' }) : '';

    html += `<div class="pd-tl-day"><div class="pd-tl-marker"><div class="pd-tl-num">${dayNum}</div><div class="pd-tl-mon">${mon}</div><div class="pd-tl-dn">${dayName}</div></div><div class="pd-tl-entries">`;

    grouped[date].forEach(e => {
      const poster = e.posterPath ? `https://image.tmdb.org/t/p/w92${e.posterPath}` : '';
      const act = actLabels[e.action] || e.action || 'Logged';
      const rating = e.rating ? ` · ★ ${e.rating}/10` : '';
      const season = e.season ? ` · S${e.season}` : '';

      html += `<div class="pd-tl-entry" data-tmdb="${e.tmdbId}" data-type="${e.type}">
        <div class="pd-tl-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${e.type==='movie'?'MOV':'TV'}</div>`}</div>
        <div class="pd-tl-info">
          <div class="pd-tl-title">${esc(e.title)}</div>
          <div class="pd-tl-meta">${act}${season}${rating}</div>
          ${e.notes ? `<div class="pd-tl-notes">${esc(e.notes).substring(0,60)}</div>` : ''}
        </div>
        <div class="pd-tl-actions">
          <button class="pd-tl-edit" data-ts="${e.timestamp||''}">Edit</button>
          <button class="pd-tl-del" data-tmdb="${e.tmdbId}" data-ts="${e.timestamp||''}">Remove</button>
        </div>
      </div>`;
    });

    html += '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;

  // Bind clicks
  el.querySelectorAll('.pd-tl-entry').forEach(entry => {
    entry.addEventListener('click', (ev) => {
      if (ev.target.closest('.pd-tl-edit') || ev.target.closest('.pd-tl-del')) return;
      showDetail(parseInt(entry.dataset.tmdb), entry.dataset.type);
    });
  });
  el.querySelectorAll('.pd-tl-edit').forEach(btn => {
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); popupEditDiaryEntry(btn.dataset.ts); });
  });
  el.querySelectorAll('.pd-tl-del').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm('Remove this entry?')) {
        Store.removeDiaryEntry(parseInt(btn.closest('.pd-tl-entry').dataset.tmdb), btn.dataset.ts);
        renderPopupDiary();
      }
    });
  });
}

function enterTMDBMode() {
  pMode = 'search';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.remove('hidden');
  document.getElementById('pSearch').parentElement.classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Type to search TMDB for movies and TV shows</div>';
  setTimeout(() => document.getElementById('pTmdbSearch').focus(), 50);
}

/* ═══════════════════════════════════════════
   THEME
   ═══════════════════════════════════════════ */

function applyPopupTheme() {
  const t = Store.getTheme();
  if (!t) return;
  const r = document.documentElement.style;
  let p;
  if (t.preset) {
    const presets = {
      default:  { bg0:'#0e1015', bg1:'#151820', bg2:'#1c2030', bg3:'#242a3a', accent:'#6c5ce7', accentL:'#a29bfe', text0:'#f0f2f5', text1:'#9ba0b5', text2:'#5c6180' },
      midnight: { bg0:'#161b22', bg1:'#1c2129', bg2:'#21262d', bg3:'#30363d', accent:'#58a6ff', accentL:'#79c0ff', text0:'#e6edf3', text1:'#b1bac4', text2:'#6e7681' },
      ocean:    { bg0:'#112240', bg1:'#162b50', bg2:'#1d3a6a', bg3:'#254980', accent:'#64ffda', accentL:'#88ffea', text0:'#e6f1ff', text1:'#a8c0d8', text2:'#607b96' },
      forest:   { bg0:'#132413', bg1:'#1a2e1a', bg2:'#223b22', bg3:'#2d4a2d', accent:'#4ade80', accentL:'#86efac', text0:'#ecfdf5', text1:'#a7cfb0', text2:'#5c8a6a' },
      sunset:   { bg0:'#2d1515', bg1:'#3a1e1e', bg2:'#4a2828', bg3:'#5c3535', accent:'#f97316', accentL:'#fb923c', text0:'#fef2f2', text1:'#d4a0a0', text2:'#8a5555' },
      sakura:   { bg0:'#2a1525', bg1:'#351c30', bg2:'#42243d', bg3:'#522e4d', accent:'#f472b6', accentL:'#f9a8d4', text0:'#fdf2f8', text1:'#d4a0c0', text2:'#8a5578' },
      nord:     { bg0:'#3b4252', bg1:'#434c5e', bg2:'#4c566a', bg3:'#5a6478', accent:'#88c0d0', accentL:'#8fbcbb', text0:'#eceff4', text1:'#d8dee9', text2:'#81a1c1' },
      light:    { bg0:'#e8e8ed', bg1:'#dddde3', bg2:'#d0d0d8', bg3:'#c0c0cc', accent:'#6c5ce7', accentL:'#5a4bd4', text0:'#1a1a2e', text1:'#333355', text2:'#666688' },
    };
    p = presets[t.preset];
  } else if (t.custom) {
    p = { bg0: t.custom.bg0, bg1: t.custom.bg1, bg2: t.custom.bg2, bg3: t.custom.bg3, accent: t.custom.accent, accentL: t.custom.accentL, text0: t.custom.text0, text1: t.custom.text1, text2: t.custom.text2 };
  }
  if (p) {
    r.setProperty('--pbg-0', p.bg0); r.setProperty('--pbg-1', p.bg1);
    r.setProperty('--pbg-2', p.bg2); r.setProperty('--pbg-3', p.bg3);
    r.setProperty('--paccent', p.accent); r.setProperty('--paccent-l', p.accentL);
    r.setProperty('--ptext-0', p.text0); r.setProperty('--ptext-1', p.text1);
    r.setProperty('--ptext-2', p.text2);
    document.body.style.background = p.bg0;
  }
}

/* ═══════════════════════════════════════════
   LIST VIEW
   ═══════════════════════════════════════════ */

function renderList() {
  let items = [
    ...Store.getTvShows().map(t => ({ ...t, mediaType: 'tv' })),
    ...Store.getMovies().map(m => ({ ...m, mediaType: 'movie' })),
  ];
  if (pFilter !== 'all') items = items.filter(i => i.watchStatus === pFilter);
  if (pType !== 'all') items = items.filter(i => i.mediaType === pType);
  if (pQuery) items = items.filter(i => i.title.toLowerCase().includes(pQuery));

  const typePri = (i) => i.mediaType === 'tv' ? 0 : 1;
  switch (pSort) {
    case 'title': items.sort((a,b) => a.title.localeCompare(b.title) || typePri(a) - typePri(b)); break;
    case 'year': items.sort((a,b) => (b.year||0)-(a.year||0) || typePri(a) - typePri(b)); break;
    case 'dateAdded': items.sort((a,b) => new Date(b.dateAdded)-new Date(a.dateAdded) || typePri(a) - typePri(b)); break;
    default: items.sort((a,b) => new Date(b.dateUpdated||b.dateAdded)-new Date(a.dateUpdated||a.dateAdded) || typePri(a) - typePri(b));
  }

  const el = document.getElementById('pList');
  const empty = document.getElementById('pEmpty');
  if (!items.length) { el.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const fc = { watching:'fill-watching', completed:'fill-completed', plan_to_watch:'fill-plan', on_hold:'fill-hold', dropped:'fill-dropped' };

  if (pView === 'grid') {
    el.innerHTML = `<div class="p-grid">${items.map(i => {
      const img = i.posterPath ? `https://image.tmdb.org/t/p/w185${i.posterPath}` : '';
      const pct = getPct(i); const f = fc[i.watchStatus] || 'fill-plan';
      return `<div class="p-grid-card" data-tmdb="${i.tmdbId}" data-type="${i.mediaType}">
        <div class="p-grid-poster">${img ? `<img src="${img}">` : `<div class="p-poster-ph">${i.mediaType==='movie'?'MOV':'TV'}</div>`}
          <div class="p-grid-bar"><div class="p-grid-bar-fill ${f}" style="width:${pct}%"></div></div>
        </div><div class="p-grid-title">${esc(i.title)}</div></div>`;
    }).join('')}</div>`;
  } else {
    el.innerHTML = items.map(i => {
      const img = i.posterPath ? `https://image.tmdb.org/t/p/w92${i.posterPath}` : '';
      const pct = getPct(i); const f = fc[i.watchStatus] || 'fill-plan';
      const eps = getEps(i); const score = i.voteAverage ? i.voteAverage.toFixed(1) : '';
      return `<div class="p-item" data-tmdb="${i.tmdbId}" data-type="${i.mediaType}">
        <div class="p-poster">${img ? `<img src="${img}">` : `<div class="p-poster-ph">${i.mediaType==='movie'?'MOV':'TV'}</div>`}</div>
        <div class="p-info"><div class="p-title">${esc(i.title)}</div>
          <div class="p-meta">${i.mediaType==='movie'?'Movie':'TV'} · ${i.year||''}</div>
          <div class="p-bar-wrap"><div class="p-bar"><div class="p-bar-fill ${f}" style="width:${pct}%"></div></div></div></div>
        <div class="p-right">${eps ? `<div class="p-eps">${eps}</div>` : ''}${score ? `<div class="p-score">${score}</div>` : ''}</div></div>`;
    }).join('');
  }

  el.querySelectorAll('[data-tmdb]').forEach(c => c.addEventListener('click', () => {
    showDetail(parseInt(c.dataset.tmdb), c.dataset.type);
  }));
}

/* ═══════════════════════════════════════════
   DETAIL VIEW — custom status dropdown + eps + remove
   ═══════════════════════════════════════════ */

function buildStatusDropdownHTML(currentVal, idPrefix) {
  const entries = [
    { val: 'watching', label: 'Watching', color: '#00b894' },
    { val: 'completed', label: 'Completed', color: '#6c5ce7' },
    { val: 'on_hold', label: 'On-Hold', color: '#fdcb6e' },
    { val: 'dropped', label: 'Dropped', color: '#e17055' },
    { val: 'plan_to_watch', label: 'Plan to Watch', color: '#a29bfe' },
  ];
  const cur = entries.find(e => e.val === currentVal) || entries[0];
  return `<div class="pd-status-dd" id="${idPrefix}DD">
    <div class="pd-status-btn" id="${idPrefix}Btn">
      <span class="p-dd-dot" id="${idPrefix}Dot" style="background:${cur.color}"></span>
      <span class="pd-status-btn-label" id="${idPrefix}Label">${cur.label}</span>
      <span class="p-dd-arrow">&#9662;</span>
    </div>
    <div class="pd-dd-menu hidden" id="${idPrefix}Menu">
      ${entries.map(e => `<div class="p-dd-item ${e.val===currentVal?'active':''}" data-val="${e.val}"><span class="p-dd-dot" style="background:${e.color}"></span>${e.label}</div>`).join('')}
    </div>
  </div>`;
}

function bindDetailStatusDD(idPrefix, tmdbId, mediaType, title, posterPath) {
  const dd = document.getElementById(`${idPrefix}DD`);
  const btn = document.getElementById(`${idPrefix}Btn`);
  const menu = document.getElementById(`${idPrefix}Menu`);
  if (!dd || !btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) { dd.classList.remove('open'); menu.classList.add('hidden'); }
    else { menu.classList.remove('hidden'); dd.classList.add('open'); }
  });

  menu.querySelectorAll('.p-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      const val = item.dataset.val;
      const cfg = { watching:{l:'Watching',c:'#00b894'}, completed:{l:'Completed',c:'#6c5ce7'}, on_hold:{l:'On-Hold',c:'#fdcb6e'}, dropped:{l:'Dropped',c:'#e17055'}, plan_to_watch:{l:'Plan to Watch',c:'#a29bfe'} };
      const c = cfg[val] || cfg.watching;
      document.getElementById(`${idPrefix}Label`).textContent = c.l;
      document.getElementById(`${idPrefix}Dot`).style.background = c.c;
      menu.querySelectorAll('.p-dd-item').forEach(i => i.classList.toggle('active', i.dataset.val === val));
      dd.classList.remove('open'); menu.classList.add('hidden');

      const isM = mediaType === 'movie';
      if (isM) Store.updateMovie(tmdbId, { watchStatus: val });
      else Store.updateTvShow(tmdbId, { watchStatus: val });
      Store.addActivity({ tmdbId, title, type: mediaType, posterPath, action: 'status_change', detail: `Changed to ${c.l}`, timestamp: new Date().toISOString() });
    });
  });
}

function showDetail(tmdbId, mediaType) {
  pMode = 'detail';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');

  const isM = mediaType === 'movie';
  const stored = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
  const el = document.getElementById('pList');

  if (!stored) { showTMDBDetail(tmdbId, mediaType); return; }

  const poster = stored.posterPath ? `https://image.tmdb.org/t/p/w185${stored.posterPath}` : '';
  const genres = (stored.genres || []).slice(0, 4);
  const score = stored.voteAverage ? stored.voteAverage.toFixed(1) : '—';
  const scoreLabel = stored.sourceTag === 'anime' ? 'MAL' : 'TMDB';

  let seasonHtml = '';
  if (!isM) {
    const ss = stored.seasons || [];
    const totalEps = ss.reduce((s,x) => s + (x.episodeCount||0), 0);
    const watchedEps = ss.reduce((s,x) => s + (x.episodesWatched||0), 0);
    seasonHtml = `<div class="pd-section"><div class="pd-section-label">Episode Progress (${watchedEps}/${totalEps})</div>
      ${ss.map(s => {
        const w = s.episodesWatched||0, t = s.episodeCount||0;
        const pct = t > 0 ? Math.round(w/t*100) : 0;
        return `<div class="pd-ep-row"><span class="pd-ep-label">S${s.seasonNumber} (${t} eps)</span>
          <div class="pd-ep-counter"><button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="dec">-</button>
            <div class="pd-ep-val">${w}/${t}</div>
            <button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="inc">+</button></div>
        </div><div class="pd-season-bar"><div class="pd-season-bar-fill" style="width:${pct}%"></div></div>`;
      }).join('')}</div>`;
  }

  let movieInfo;
  if (isM) {
    const rt = stored.runtime ? `${Math.floor(stored.runtime/60)}h ${stored.runtime%60}m` : '';
    movieInfo = [stored.year, rt].filter(Boolean).join(' · ');
  } else {
    const ss = stored.seasons || [];
    movieInfo = [stored.year, `${stored.totalSeasons||ss.length} Seasons`, `${stored.totalEpisodes||'?'} Eps`].filter(Boolean).join(' · ');
  }

  el.innerHTML = `<div class="pd-wrap">
    <div class="pd-hero">
      <div class="pd-poster">${poster ? `<img src="${poster}">` : `<div class="pd-poster-ph">${isM?'MOV':'TV'}</div>`}</div>
      <div class="pd-info">
        <div class="pd-title">${esc(stored.title)}</div>
        <div class="pd-sub">${movieInfo}</div>
        <div class="pd-genres">${genres.map(g => `<span class="pd-genre-tag">${esc(g)}</span>`).join('')}</div>
        <div class="pd-stats">
          <div><div class="pd-stat-val gold">${score}</div><div class="pd-stat-label">${scoreLabel}</div></div>
          ${stored.rewatchCount ? `<div><div class="pd-stat-val">${stored.rewatchCount}</div><div class="pd-stat-label">Rewatches</div></div>` : ''}
        </div>
      </div>
    </div>
    <div class="pd-section"><div class="pd-section-label">Status</div>
      ${buildStatusDropdownHTML(stored.watchStatus, 'pdSt')}
    </div>
    ${seasonHtml}
    <div class="pd-actions">
      <button class="pd-btn pd-btn-open" id="pdOpenFull">Full Details</button>
      <button class="pd-btn pd-btn-diary" id="pdDiaryLog">Diary</button>
      <button class="pd-btn pd-btn-remove" id="pdRemove">Remove</button>
    </div>
  </div>`;

  // Bind custom status dropdown
  bindDetailStatusDD('pdSt', tmdbId, mediaType, stored.title, stored.posterPath);

  // Episode +/-
  el.querySelectorAll('.pd-ep-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sn = parseInt(btn.dataset.sn), act = btn.dataset.act;
      const show = Store.getTvShow(tmdbId); if (!show) return;
      const ss = show.seasons || [];
      const s = ss.find(x => x.seasonNumber === sn); if (!s) return;
      const t = s.episodeCount || 0;
      if (act === 'inc' && s.episodesWatched < t) s.episodesWatched++;
      else if (act === 'dec' && s.episodesWatched > 0) s.episodesWatched--;
      else return;
      const allDone = ss.every(x => x.episodesWatched >= (x.episodeCount||0) && (x.episodeCount||0) > 0);
      const anyStarted = ss.some(x => x.episodesWatched > 0);
      let ns = show.watchStatus;
      if (allDone) ns = 'completed';
      else if (anyStarted && ns === 'plan_to_watch') ns = 'watching';
      Store.updateTvShow(tmdbId, { seasons: ss, watchStatus: ns });
      showDetail(tmdbId, mediaType);
    });
  });

  el.querySelector('#pdOpenFull').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-${mediaType}-${tmdbId}` }); window.close();
  });

  el.querySelector('#pdDiaryLog')?.addEventListener('click', () => {
    popupDiaryLogModal(tmdbId, mediaType, stored.title, stored.posterPath);
  });

  el.querySelector('#pdRemove').addEventListener('click', () => {
    if (confirm(`Remove "${stored.title}" from your list?`)) {
      if (isM) Store.deleteMovie(tmdbId); else Store.deleteTvShow(tmdbId);
      Store.addActivity({ tmdbId, title: stored.title, type: mediaType, posterPath: stored.posterPath, action: 'removed', detail: 'Removed from list', timestamp: new Date().toISOString() });
      goBackToList();
    }
  });
}

/* ═══════════════════════════════════════════
   TMDB SEARCH
   ═══════════════════════════════════════════ */

async function searchTMDB(query) {
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Searching TMDB...</div>';

  try {
    const results = await TMDB.search(query);
    if (!results.length) { el.innerHTML = '<div class="p-search-msg">No results found</div>'; return; }
    results.sort((a,b) => (a.media_type === 'tv' ? 0 : 1) - (b.media_type === 'tv' ? 0 : 1));

    el.innerHTML = results.slice(0, 12).map(r => {
      const isM = r.media_type === 'movie';
      const title = isM ? r.title : r.name;
      const yr = ((isM ? r.release_date : r.first_air_date) || '').substring(0, 4);
      const poster = r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : '';
      const inList = isM ? Store.hasMovie(r.id) : Store.hasTvShow(r.id);
      return `<div class="p-search-item" data-id="${r.id}" data-type="${r.media_type}">
        <div class="p-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${isM?'MOV':'TV'}</div>`}</div>
        <div class="p-search-info"><div class="p-search-title">${esc(title)}</div>
          <div class="p-search-sub">${yr}${r.vote_average ? ` · ${r.vote_average.toFixed(1)}` : ''}</div></div>
        <span class="p-search-type p-search-type-${isM?'movie':'tv'}">${isM?'Movie':'TV'}</span>
        ${inList ? `<button class="p-add-btn added" disabled>Added</button>` : `<button class="p-add-btn" data-action="add">+ Add</button>`}
      </div>`;
    }).join('');

    el.querySelectorAll('.p-search-item').forEach(item => {
      const addBtn = item.querySelector('[data-action="add"]');
      if (addBtn) {
        addBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(item.dataset.id), type = item.dataset.type;
          addBtn.textContent = '...'; addBtn.disabled = true;
          try {
            if (type === 'movie') {
              const d = await TMDB.movieDetails(id);
              Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.release_date||'').substring(0,4))||0, voteAverage: d.vote_average||0, runtime: d.runtime||0, genres: (d.genres||[]).map(g=>g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
              Store.addActivity({ tmdbId: d.id, title: d.title, type: 'movie', posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: new Date().toISOString() });
            } else {
              const d = await TMDB.tvDetails(id);
              const ss = (d.seasons||[]).filter(s => s.season_number > 0);
              Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.first_air_date||'').substring(0,4))||0, voteAverage: d.vote_average||0, totalSeasons: d.number_of_seasons||0, totalEpisodes: d.number_of_episodes||0, genres: (d.genres||[]).map(g=>g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s=>({seasonNumber:s.season_number,episodeCount:s.episode_count||0,episodesWatched:0,posterPath:s.poster_path})), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
              Store.addActivity({ tmdbId: d.id, title: d.name, type: 'tv', posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: new Date().toISOString() });
            }
            addBtn.textContent = 'Added'; addBtn.classList.add('added');
          } catch (err) { addBtn.textContent = 'Error'; setTimeout(() => { addBtn.textContent = '+ Add'; addBtn.disabled = false; }, 1500); }
        });
      }
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="add"]') || e.target.closest('.p-add-btn')) return;
        showTMDBDetail(parseInt(item.dataset.id), item.dataset.type);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="p-search-msg" style="color:var(--pdropped)">Error: ${err.message}</div>`;
  }
}

async function showTMDBDetail(tmdbId, mediaType) {
  pMode = 'detail';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pTmdbBar').classList.add('hidden');
  document.getElementById('pAddNew').classList.add('hidden');
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Loading...</div>';

  const isM = mediaType === 'movie';
  try {
    const d = isM ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId);
    const title = isM ? d.title : d.name;
    const year = (isM ? d.release_date : d.first_air_date || '').substring(0, 4);
    const poster = d.poster_path ? `https://image.tmdb.org/t/p/w185${d.poster_path}` : '';
    const genres = (d.genres || []).slice(0, 4);
    const score = d.vote_average ? d.vote_average.toFixed(1) : '—';
    const overview = (d.overview || '').substring(0, 200) + ((d.overview || '').length > 200 ? '...' : '');
    const inList = isM ? Store.hasMovie(d.id) : Store.hasTvShow(d.id);
    const subInfo = isM
      ? [year, d.runtime ? `${Math.floor(d.runtime/60)}h ${d.runtime%60}m` : '', d.status].filter(Boolean).join(' · ')
      : [year, `${d.number_of_seasons||'?'} Seasons`, `${d.number_of_episodes||'?'} Eps`, d.status].filter(Boolean).join(' · ');

    el.innerHTML = `<div class="pd-wrap">
      <div class="pd-hero">
        <div class="pd-poster">${poster ? `<img src="${poster}">` : `<div class="pd-poster-ph">${isM?'MOV':'TV'}</div>`}</div>
        <div class="pd-info">
          <div class="pd-title">${esc(title)}</div>
          <div class="pd-sub">${subInfo}</div>
          <div class="pd-genres">${genres.map(g => `<span class="pd-genre-tag">${esc(g.name)}</span>`).join('')}</div>
          <div class="pd-stats">
            <div><div class="pd-stat-val gold">${score}</div><div class="pd-stat-label">TMDB</div></div>
            ${d.popularity ? `<div><div class="pd-stat-val">${Math.round(d.popularity)}</div><div class="pd-stat-label">Popularity</div></div>` : ''}
          </div>
        </div>
      </div>
      ${overview ? `<div class="pd-overview">${esc(overview)}</div>` : ''}
      <div class="pd-actions">
        ${inList ? `<button class="pd-btn pd-btn-open" id="pdOpenFull">View in Dashboard</button>`
                 : `<button class="pd-btn pd-btn-add" id="pdAdd">+ Add to List</button>`}
      </div>
    </div>`;

    if (!inList) {
      el.querySelector('#pdAdd').addEventListener('click', async () => {
        const btn = el.querySelector('#pdAdd'); btn.textContent = 'Adding...'; btn.disabled = true;
        try {
          if (isM) Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt(year)||0, voteAverage: d.vote_average||0, runtime: d.runtime||0, genres: genres.map(g=>g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
          else { const ss = (d.seasons||[]).filter(s => s.season_number > 0); Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt(year)||0, voteAverage: d.vote_average||0, totalSeasons: d.number_of_seasons||0, totalEpisodes: d.number_of_episodes||0, genres: genres.map(g=>g.name), watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s=>({seasonNumber:s.season_number,episodeCount:s.episode_count||0,episodesWatched:0,posterPath:s.poster_path})), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() }); }
          Store.addActivity({ tmdbId: d.id, title, type: mediaType, posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: new Date().toISOString() });
          showDetail(d.id, mediaType);
        } catch (err) { btn.textContent = 'Error'; }
      });
    } else {
      el.querySelector('#pdOpenFull').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-${mediaType}-${tmdbId}` }); window.close();
      });
    }
  } catch (err) {
    el.innerHTML = `<div class="p-search-msg" style="color:var(--pdropped)">Failed: ${err.message}</div>`;
  }
}

/* ═══════════════════════════════════════════
   POPUP DIARY — Log Modal + Edit Modal
   ═══════════════════════════════════════════ */

function popupDiaryLogModal(tmdbId, mediaType, title, posterPath) {
  const today = new Date().toISOString().substring(0, 10);
  const poster = posterPath ? `https://image.tmdb.org/t/p/w185${posterPath}` : '';
  const isM = mediaType === 'movie';
  const st = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
  const sOpts = !isM && st ? (st.seasons||[]).map(s => `<option value="${s.seasonNumber}">S${s.seasonNumber}</option>`).join('') : '';

  // History
  const entries = Store.getDiary().filter(d => d.tmdbId === tmdbId && d.type === mediaType);
  const aL = { completed:'Completed', rewatch:'Rewatched', watched:'Watched', watched_episodes:'Watched eps', started:'Started', session:'Session' };
  const histHtml = entries.length ? `<div class="pdl-hist"><div class="pdl-hist-head">Diary History (${entries.length})</div>${entries.map(de => {
    const a = aL[de.action]||de.action; const r = de.rating ? ` · ★${de.rating}` : ''; const s = de.season ? ` · S${de.season}` : '';
    return `<div class="pdl-hrow"><div class="pdl-hinfo"><span class="pdl-hdate">${de.date||'—'}</span> <span class="pdl-hact">${a}${s}${r}</span></div><button class="pdl-hedit" data-ts="${de.timestamp}">Edit</button><button class="pdl-hdel" data-tmdb="${de.tmdbId}" data-ts="${de.timestamp}">Remove</button></div>`;
  }).join('')}</div>` : '';

  const html = `<div class="pdl-overlay" id="pdlModal"><div class="pdl-box"><div class="pdl-header"><span>Log Diary</span><button class="pdl-close" id="pdlX">&#10005;</button></div><div class="pdl-body">
    <div class="pdl-hero"><div class="pdl-poster">${poster?`<img src="${poster}">`:`<div class="p-poster-ph">${isM?'MOV':'TV'}</div>`}</div><div><div class="pdl-name">${esc(title)}</div></div></div>
    <div class="pdl-form">
      <div class="pdl-row"><label>Date</label><input type="date" id="pdlDate" value="${today}" class="pdl-inp"></div>
      <div class="pdl-row2">
        <div class="pdl-row" style="flex:1;"><label>Action</label><select id="pdlAction" class="pdl-inp"><option value="watched">Watched</option><option value="rewatch">Rewatched</option></select></div>
        <div class="pdl-row" style="flex:1;"><label>Rating</label><select id="pdlRating" class="pdl-inp"><option value="0">— None —</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option value="${n}">★ ${n}/10</option>`).join('')}</select></div>
      </div>
      ${!isM ? `<div class="pdl-row"><label>Season</label><select id="pdlSeason" class="pdl-inp"><option value="">All</option>${sOpts}</select></div>` : ''}
      <div class="pdl-row"><label>Notes</label><textarea id="pdlNotes" class="pdl-inp pdl-ta" rows="2" placeholder="Quick thoughts..."></textarea></div>
      <button class="pdl-save" id="pdlSave">Save Entry</button>
    </div>
    ${histHtml}
  </div></div></div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const m = document.getElementById('pdlModal');
  const close = () => m.remove();
  m.querySelector('#pdlX').addEventListener('click', close);
  m.addEventListener('click', e => { if (e.target === m) close(); });

  m.querySelectorAll('.pdl-hedit').forEach(b => { b.addEventListener('click', () => { close(); popupEditDiaryEntry(b.dataset.ts); }); });
  m.querySelectorAll('.pdl-hdel').forEach(b => { b.addEventListener('click', () => { if (confirm('Remove?')) { Store.removeDiaryEntry(parseInt(b.dataset.tmdb), b.dataset.ts); close(); popupDiaryLogModal(tmdbId, mediaType, title, posterPath); } }); });

  m.querySelector('#pdlSave').addEventListener('click', () => {
    const date = m.querySelector('#pdlDate').value; if (!date) return;
    const action = m.querySelector('#pdlAction').value;
    const notes = m.querySelector('#pdlNotes').value.trim();
    const rating = parseInt(m.querySelector('#pdlRating').value) || null;
    const season = !isM && m.querySelector('#pdlSeason') ? parseInt(m.querySelector('#pdlSeason').value) || null : null;
    Store.addDiaryEntry({ tmdbId, title, type: mediaType, posterPath, date, action, notes, rating, mood: null, episodes: null, season, timestamp: new Date().toISOString() });
    close();
    if (pMode === 'diary') renderPopupDiary();
    else showDetail(tmdbId, mediaType);
  });
}

function popupEditDiaryEntry(timestamp) {
  const entry = Store.getDiaryEntry(timestamp);
  if (!entry) return;
  const isM = entry.type === 'movie';

  const html = `<div class="pdl-overlay" id="pdleModal"><div class="pdl-box"><div class="pdl-header"><span>Edit Entry</span><button class="pdl-close" id="pdleX">&#10005;</button></div><div class="pdl-body"><div class="pdl-form">
    <div class="pdl-row"><label>Date</label><input type="date" id="pdleDate" value="${entry.date||''}" class="pdl-inp"></div>
    <div class="pdl-row2">
      <div class="pdl-row" style="flex:1;"><label>Action</label><select id="pdleAction" class="pdl-inp"><option value="watched" ${entry.action==='watched'?'selected':''}>Watched</option><option value="rewatch" ${entry.action==='rewatch'?'selected':''}>Rewatched</option></select></div>
      <div class="pdl-row" style="flex:1;"><label>Rating</label><select id="pdleRating" class="pdl-inp"><option value="0">— None —</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option value="${n}" ${entry.rating===n?'selected':''}>★ ${n}/10</option>`).join('')}</select></div>
    </div>
    <div class="pdl-row"><label>Notes</label><textarea id="pdleNotes" class="pdl-inp pdl-ta" rows="2">${esc(entry.notes||'')}</textarea></div>
    <div style="display:flex;gap:6px;"><button class="pdl-save" id="pdleSave" style="flex:1;">Save</button><button class="pdl-back" id="pdleBack">Back</button></div>
  </div></div></div></div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const m = document.getElementById('pdleModal');
  const close = () => m.remove();
  m.querySelector('#pdleX').addEventListener('click', close);
  m.querySelector('#pdleBack').addEventListener('click', () => { close(); if (pMode === 'diary') renderPopupDiary(); });

  m.querySelector('#pdleSave').addEventListener('click', () => {
    Store.updateDiaryEntry(timestamp, {
      date: m.querySelector('#pdleDate').value,
      action: m.querySelector('#pdleAction').value,
      rating: parseInt(m.querySelector('#pdleRating').value) || null,
      notes: m.querySelector('#pdleNotes').value.trim(),
    });
    close();
    if (pMode === 'diary') renderPopupDiary();
  });
}

/* ─── Helpers ─── */
function getPct(i) {
  if (i.mediaType === 'tv') {
    const ss = i.seasons || []; const w = ss.reduce((s,se)=>s+(se.episodesWatched||0),0);
    const t = ss.reduce((s,se)=>s+(se.episodeCount||0),0);
    return t > 0 ? Math.round(w/t*100) : 0;
  }
  return i.watchStatus === 'completed' ? 100 : i.watchStatus === 'watching' ? 40 : 0;
}
function getEps(i) {
  if (i.mediaType !== 'tv') return '';
  const ss = i.seasons || []; const w = ss.reduce((s,se)=>s+(se.episodesWatched||0),0);
  const t = ss.reduce((s,se)=>s+(se.episodeCount||0),0);
  return `${w}<span class="p-eps-total">/${t||'?'}</span>`;
}
function esc(s) { if(!s) return ''; const e=document.createElement('span'); e.textContent=s; return e.innerHTML; }
