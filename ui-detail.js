/* Detail Page — Movie + TV unified, no emojis */

const DetailUI = {
  async open(tmdbId, mediaType) {
    const page = document.getElementById('page-detail');
    page.innerHTML = '<div style="padding:40px;color:var(--text-3)">Loading...</div>';
    App.showPage('detail');

    const isM = mediaType === 'movie';
    const stored = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
    let d;

    // For MAL-only entries (negative tmdbId), build detail from stored data + Jikan
    if (tmdbId < 0 && stored) {
      d = await this._buildMalDetail(stored, isM);
    } else {
      try { d = isM ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId); }
      catch (e) {
        // If TMDB fails but we have stored data (MAL entry with mapped but broken TMDB ID), use stored + Jikan
        if (stored && stored.malId) {
          d = await this._buildMalDetail(stored, isM);
        } else {
          page.innerHTML = `<div style="padding:40px;color:var(--dropped)">Failed: ${e.message}</div>`;
          return;
        }
      }
    }

    const inList = !!stored;
    const backdrop = TMDB.backdrop(d.backdrop_path);
    const poster = TMDB.poster(d.poster_path, 'w500');
    const title = isM ? d.title : d.name;
    const year = (isM ? d.release_date : d.first_air_date || '').substring(0, 4);
    const genres = (d.genres || []).map(g => g.name);
    const cast = (d.credits?.cast || []).slice(0, 12);
    const trailer = (d.videos?.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
    const recs = (d.recommendations?.results || []).slice(0, 6);
    const companies = (d.production_companies || []).slice(0, 5);
    const countries = (d.production_countries || []).map(c => c.name);
    const languages = (d.spoken_languages || []).map(l => l.english_name);
    const ph = isM ? 'MOV' : 'TV';

    const rt = isM ? (d.runtime || 0) : 0;
    const rtStr = rt > 0 ? `${Math.floor(rt/60)}h ${rt%60}m` : '';
    const budget = isM && d.budget ? `$${(d.budget/1e6).toFixed(1)}M` : '';
    const revenue = isM && d.revenue ? `$${(d.revenue/1e6).toFixed(1)}M` : '';
    const directors = isM ? (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name) : [];
    const lastYear = !isM ? (d.last_air_date || '').substring(0, 4) : '';
    const yearRange = !isM && lastYear && lastYear !== year ? `${year}–${lastYear}` : year;
    const creators = !isM ? (d.created_by || []).map(c => c.name) : [];
    const networks = !isM ? (d.networks || []).slice(0, 4) : [];
    const epRt = !isM ? ((d.episode_run_time || [])[0] || '') : '';
    const tmdbS = !isM ? (d.seasons || []).filter(s => s.season_number > 0) : [];

    const ws = stored?.watchStatus || 'plan_to_watch';
    const rwc = stored?.rewatchCount || 0;
    const sd = stored?.startDate || '';
    const ed = stored?.endDate || '';
    const sMap = {}; (stored?.seasons || []).forEach(s => { sMap[s.seasonNumber] = s; });
    const sl = { watching:'Watching', plan_to_watch:'Plan to Watch', completed:'Completed', on_hold:'On Hold', dropped:'Dropped' };

    let chips = genres.map(g => `<span class="detail-chip">${esc(g)}</span>`).join('');
    if (isM) { if (year) chips += `<span class="detail-chip">${year}</span>`; if (rtStr) chips += `<span class="detail-chip">${rtStr}</span>`; }
    else { if (yearRange) chips += `<span class="detail-chip">${yearRange}</span>`; chips += `<span class="detail-chip">${d.number_of_seasons||'?'} Seasons</span><span class="detail-chip">${d.number_of_episodes||'?'} Eps</span>`; }

    let stats = '';
    const isAnime = stored && stored.sourceTag === 'anime';
    const scoreLabel = isAnime ? 'MAL' : 'TMDB';
    if (d.vote_average) stats += `<div class="detail-stat"><div class="detail-stat-val gold">${d.vote_average.toFixed(1)}</div><div class="detail-stat-label">${scoreLabel} ${d.vote_count ? `(${d.vote_count})` : ''}</div></div>`;
    if (inList) {
      if (isM) { const ur = Store.getUserRating(tmdbId,'movie'); if (ur) stats += `<div class="detail-stat"><div class="detail-stat-val" style="color:var(--accent-light)">★ ${ur}</div><div class="detail-stat-label">Your Rating</div></div>`; }
      else { const ar = Store.getAvgUserRating(tmdbId,'tv'); if (ar) stats += `<div class="detail-stat"><div class="detail-stat-val" style="color:var(--accent-light)">★ ${ar.toFixed(1)}</div><div class="detail-stat-label">Your Avg</div></div>`; }
    }
    if (d.popularity) stats += `<div class="detail-stat"><div class="detail-stat-val">${Math.round(d.popularity)}</div><div class="detail-stat-label">Popularity</div></div>`;
    if (!isM && d.status) stats += `<div class="detail-stat"><div class="detail-stat-val">${d.status}</div><div class="detail-stat-label">Status</div></div>`;
    if (rwc > 0) stats += `<div class="detail-stat"><div class="detail-stat-val">${rwc}</div><div class="detail-stat-label">Rewatches</div></div>`;

    let actions;
    const statusEntries = [
      { val:'watching', label:'Watching', color:'#00b894' },
      { val:'completed', label:'Completed', color:'#6c5ce7' },
      { val:'on_hold', label:'On-Hold', color:'#fdcb6e' },
      { val:'dropped', label:'Dropped', color:'#e17055' },
      { val:'plan_to_watch', label:'Plan to Watch', color:'#a29bfe' },
    ];
    const curStatus = statusEntries.find(e => e.val === ws) || statusEntries[0];
    if (inList) {
      actions = `<div class="custom-dd" id="detailStatusDD">
        <button class="custom-dd-btn" id="detailStatusBtn">
          <span class="dd-dot" style="background:${curStatus.color}"></span>
          <span class="dd-label" id="detailStatusLabel">${curStatus.label}</span>
          <span class="dd-arrow">&#9662;</span>
        </button>
        <div class="custom-dd-menu hidden" id="detailStatusMenu">
          ${statusEntries.map(e => `<div class="dd-item ${e.val===ws?'active':''}" data-val="${e.val}"><span class="dd-dot" style="background:${e.color}"></span>${e.label}</div>`).join('')}
        </div>
      </div><button class="btn-accent" id="detailEditBtn">Edit</button><button class="btn-accent btn-diary-log" id="detailDiaryBtn">Log Diary</button>`;
    } else { actions = `<button class="btn-accent" id="detailAddBtn">+ Add to List</button>`; }

    const dates = inList && (sd||ed) ? `<div class="detail-dates-row">${sd?`<span class="detail-date-chip">Started: ${sd}</span>`:''}${ed?`<span class="detail-date-chip">Finished: ${ed}</span>`:''}</div>` : '';

    let seasonHtml = '';
    if (!isM && inList && tmdbS.length) {
      const sRatings = Store.getSeasonRatings(tmdbId);
      seasonHtml = `<div class="detail-section"><h3>Season Progress</h3><div class="season-track-list" id="seasonTrackList">${tmdbS.map(s => {
        const tr = sMap[s.season_number] || { episodesWatched: 0 };
        const w = tr.episodesWatched||0, tot = s.episode_count||0;
        const done = w>=tot&&tot>0, pct = tot>0?(w/tot)*100:0;
        const sp = TMDB.poster(s.poster_path, 'w185');
        const ay = s.air_date ? s.air_date.substring(0,4) : '';
        const sRate = sRatings[s.season_number];
        return `<div class="season-track-card ${done?'season-done':'season-active'}" data-snum="${s.season_number}">
          ${sp?`<img class="season-poster" src="${sp}" loading="lazy">`:`<div class="season-poster no-poster-ph" style="font-size:10px;">S${s.season_number}</div>`}
          <div class="season-info"><h4>Season ${s.season_number}${sRate?` <span class="season-user-rating">★ ${sRate}/10</span>`:''}</h4><div class="season-meta">${tot} eps${ay?' · '+ay:''}</div>
            <div class="season-progress-bar"><div class="season-progress-fill" style="width:${pct}%;background:${done?'var(--watching)':'var(--accent-light)'}"></div></div>
          </div>
          <div class="season-controls"><div class="ep-counter">
            <button class="ep-dec" data-snum="${s.season_number}">-</button>
            <div class="ep-counter-val">${w} / ${tot}</div>
            <button class="ep-inc" data-snum="${s.season_number}">+</button>
          </div><div class="season-btn-col"><button class="season-done-btn ${done?'undone':'mark-done'}" data-snum="${s.season_number}">${done?'Undo':'Done'}</button><button class="season-diary-btn" data-snum="${s.season_number}" title="Log to diary">Log</button></div></div>
        </div>`;
      }).join('')}</div></div>`;
    }

    let info = '';
    if (isM) {
      if (directors.length) info += `<div class="info-cell"><div class="info-cell-label">Director</div><div class="info-cell-value">${esc(directors.join(', '))}</div></div>`;
      info += `<div class="info-cell"><div class="info-cell-label">Release</div><div class="info-cell-value">${d.release_date||'—'}</div></div>`;
      info += `<div class="info-cell"><div class="info-cell-label">Status</div><div class="info-cell-value">${d.status||'—'}</div></div>`;
      info += `<div class="info-cell"><div class="info-cell-label">Language</div><div class="info-cell-value">${(d.original_language||'').toUpperCase()}</div></div>`;
      if (budget) info += `<div class="info-cell"><div class="info-cell-label">Budget</div><div class="info-cell-value">${budget}</div></div>`;
      if (revenue) info += `<div class="info-cell"><div class="info-cell-label">Revenue</div><div class="info-cell-value">${revenue}</div></div>`;
    } else {
      if (creators.length) info += `<div class="info-cell"><div class="info-cell-label">Created By</div><div class="info-cell-value">${esc(creators.join(', '))}</div></div>`;
      info += `<div class="info-cell"><div class="info-cell-label">First Aired</div><div class="info-cell-value">${d.first_air_date||'—'}</div></div>`;
      info += `<div class="info-cell"><div class="info-cell-label">Last Aired</div><div class="info-cell-value">${d.last_air_date||'—'}</div></div>`;
      if (epRt) info += `<div class="info-cell"><div class="info-cell-label">Ep Runtime</div><div class="info-cell-value">${epRt}m</div></div>`;
      info += `<div class="info-cell"><div class="info-cell-label">Language</div><div class="info-cell-value">${(d.original_language||'').toUpperCase()}</div></div>`;
    }

    page.innerHTML = `
      <button class="btn-back" id="detailBackBtn">Back</button>
      <div class="detail-backdrop">${backdrop?`<img src="${backdrop}">`:'<div style="height:100%;background:var(--bg-2)"></div>'}<div class="detail-backdrop-grad"></div></div>
      <div class="detail-hero">
        <div class="detail-poster-wrap">${poster?`<img src="${poster}" class="detail-poster-img">`:`<div class="no-poster-ph" style="width:200px;height:300px;border-radius:12px;">${ph}</div>`}</div>
        <div class="detail-hero-info">
          <h1>${esc(title)}</h1>
          ${d.tagline?`<div class="detail-tagline">"${esc(d.tagline)}"</div>`:''}
          <div class="detail-chips">${chips}</div>
          <div class="detail-stats">${stats}</div>
          <div class="detail-actions" style="display:flex; gap:10px; align-items:center;">
            ${actions}
            <button id="detailManualSyncBtn" class="btn-ghost" style="font-size:12px; padding:2px 6px; margin-left:auto; height:auto; min-height:0;">&#128279; Link</button>
            <a href="https://www.themoviedb.org/${isM?'movie':'tv'}/${Math.abs(tmdbId)}" target="_blank" style="color:var(--text-2); font-size:12px; text-decoration:none;">↗ TMDB</a>
            ${stored && stored.malId ? `<a href="https://myanimelist.net/anime/${stored.malId}" target="_blank" style="color:var(--text-2); font-size:12px; text-decoration:none;">↗ MAL</a>` : ''}
          </div>${dates}
        </div>
      </div>
      <div class="detail-body">
        ${d.overview?`<div class="detail-section"><h3>Overview</h3><p class="detail-overview">${esc(d.overview)}</p></div>`:''}
        ${seasonHtml}
        <div class="detail-section"><h3>Details</h3><div class="detail-info-grid">${info}</div></div>
        ${cast.length?`<div class="detail-section"><h3>Cast</h3><div class="cast-row">${cast.map(c=>{const p=TMDB.profile(c.profile_path);return`<div class="cast-card">${p?`<img src="${p}" loading="lazy">`:'<div class="cast-ph"></div>'}<div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character||'')}</div></div>`;}).join('')}</div></div>`:''}
        ${!isM&&networks.length?`<div class="detail-section"><h3>Networks</h3><div class="companies-row">${networks.map(n=>`<div class="company-tag">${n.logo_path?`<img src="${TMDB.poster(n.logo_path,'w92')}">`:''}${esc(n.name)}</div>`).join('')}</div></div>`:''}
        ${companies.length?`<div class="detail-section"><h3>Production</h3><div class="companies-row">${companies.map(c=>`<div class="company-tag">${c.logo_path?`<img src="${TMDB.poster(c.logo_path,'w92')}">`:''}${esc(c.name)}</div>`).join('')}</div></div>`:''}
        ${trailer?`<div class="detail-section"><h3>Trailer</h3><div style="border-radius:12px;overflow:hidden;max-width:640px;"><iframe width="100%" height="360" src="https://www.youtube-nocookie.com/embed/${trailer.key}?rel=0&modestbranding=1&origin=null" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="display:block;"></iframe></div></div>`:''}
        ${recs.length?`<div class="detail-section"><h3>Recommended</h3><div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;">${recs.map(r=>{const rP=TMDB.poster(r.poster_path,'w185');const rT=r.media_type||(r.first_air_date?'tv':'movie');return`<div class="grid-card" data-tmdb="${r.id}" data-type="${rT}" style="flex-shrink:0;width:130px;"><div class="poster-wrap" style="aspect-ratio:2/3;">${rP?`<img src="${rP}" loading="lazy">`:`<div class="no-poster-ph">${ph}</div>`}<div class="poster-overlay"></div></div><div class="grid-card-info"><div class="grid-card-title">${esc(r.title||r.name)}</div></div></div>`;}).join('')}</div></div>`:''}
      </div>`;

    page.querySelector('#detailBackBtn').addEventListener('click', () => App.showPage('watchlist'));

    const addBtn = page.querySelector('#detailAddBtn');
    if (addBtn) addBtn.addEventListener('click', () => {
      if (isM) Store.addMovie({ tmdbId:d.id, title:d.title, posterPath:d.poster_path, backdropPath:d.backdrop_path, year:parseInt(year)||0, voteAverage:d.vote_average||0, runtime:rt, genres, watchStatus:'plan_to_watch', rewatchCount:0, rewatchHistory:[], startDate:'', endDate:'', dateAdded:new Date().toISOString(), dateUpdated:new Date().toISOString() });
      else Store.addTvShow({ tmdbId:d.id, title:d.name, posterPath:d.poster_path, backdropPath:d.backdrop_path, year:parseInt(year)||0, voteAverage:d.vote_average||0, totalSeasons:d.number_of_seasons||0, totalEpisodes:d.number_of_episodes||0, genres, watchStatus:'plan_to_watch', rewatchCount:0, rewatchHistory:[], startDate:'', endDate:'', seasons:tmdbS.map(s=>({seasonNumber:s.season_number,episodeCount:s.episode_count||0,episodesWatched:0,posterPath:s.poster_path})), dateAdded:new Date().toISOString(), dateUpdated:new Date().toISOString() });
      Store.addActivity({ tmdbId:d.id, title, type:mediaType, posterPath:d.poster_path, action:'added', detail:'Added to list', timestamp:new Date().toISOString() });
      App.refreshCounts(); toast(`Added "${title}"`); this.open(tmdbId, mediaType);
    });

    // Custom status dropdown
    const ddBtn = page.querySelector('#detailStatusBtn');
    const ddMenu = page.querySelector('#detailStatusMenu');
    const ddWrap = page.querySelector('#detailStatusDD');
    if (ddBtn && ddMenu && ddWrap) {
      ddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !ddMenu.classList.contains('hidden');
        ddMenu.classList.toggle('hidden'); ddWrap.classList.toggle('open');
      });
      ddMenu.querySelectorAll('.dd-item').forEach(item => {
        item.addEventListener('click', () => {
          const ns = item.dataset.val;
          const cfgMap = { watching:{l:'Watching',c:'#00b894'}, completed:{l:'Completed',c:'#6c5ce7'}, on_hold:{l:'On-Hold',c:'#fdcb6e'}, dropped:{l:'Dropped',c:'#e17055'}, plan_to_watch:{l:'Plan to Watch',c:'#a29bfe'} };
          const cfg = cfgMap[ns] || cfgMap.watching;
          page.querySelector('#detailStatusLabel').textContent = cfg.l;
          page.querySelector('#detailStatusBtn .dd-dot').style.background = cfg.c;
          ddMenu.querySelectorAll('.dd-item').forEach(i => i.classList.toggle('active', i.dataset.val === ns));
          ddMenu.classList.add('hidden'); ddWrap.classList.remove('open');
          const os = stored.watchStatus;
          if (isM) Store.updateMovie(tmdbId, { watchStatus: ns }); else Store.updateTvShow(tmdbId, { watchStatus: ns });
          if (os !== ns) Store.addActivity({ tmdbId, title, type: mediaType, posterPath: stored.posterPath, action:'status_change', detail:`Changed to ${sl[ns]}`, timestamp:new Date().toISOString() });
          App.refreshCounts(); toast(`Status: ${sl[ns]}`);
        });
      });
      document.addEventListener('click', function closeDD(e) {
        if (!ddWrap.contains(e.target)) { ddMenu.classList.add('hidden'); ddWrap.classList.remove('open'); }
      });
    }

    const eBtn = page.querySelector('#detailEditBtn');
    if (eBtn) eBtn.addEventListener('click', () => this._editModal(tmdbId, mediaType, title, d));
    const dBtn = page.querySelector('#detailDiaryBtn');
    if (dBtn) dBtn.addEventListener('click', () => this._diaryLogModal(tmdbId, mediaType, title, stored?.posterPath, null));
    const msBtn = page.querySelector('#detailManualSyncBtn');
    if (msBtn) msBtn.addEventListener('click', () => this._manualSyncModal(tmdbId, mediaType, stored));

    if (!isM && inList) {
      this._bindSeason(page, tmdbId, tmdbS);
      page.querySelectorAll('.season-diary-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); this._diaryLogModal(tmdbId,'tv',title,stored?.posterPath,parseInt(btn.dataset.snum)); });
      });
    }

    page.querySelectorAll('.detail-body [data-tmdb]').forEach(c => c.addEventListener('click', () => this.open(parseInt(c.dataset.tmdb), c.dataset.type)));

    // Handle broken poster images
    page.querySelectorAll('img').forEach(img => {
      img.addEventListener('error', () => {
        const ph = document.createElement('div');
        ph.className = 'no-poster-ph';
        ph.style.cssText = img.closest('.detail-poster-wrap') ? 'width:200px;height:300px;border-radius:12px;' : '';
        ph.textContent = isM ? 'MOV' : 'TV';
        img.replaceWith(ph);
      });
    });
  },

  _manualSyncModal(tmdbId, mediaType, stored) {
    const isM = mediaType === 'movie';
    const html = `<div class="modal-backdrop edit-modal-backdrop" id="manualSyncModal">
      <div class="modal-box edit-modal-box" style="max-width:400px;">
        <div class="modal-header"><h2>Link & Sync</h2><button class="modal-close-btn" id="msClose">&#10005;</button></div>
        <div class="modal-body">
          <p class="field-hint" style="margin-bottom:12px;">Paste a TMDB or MyAnimeList URL to link and fetch updated details.</p>
          <div class="input-row"><input type="text" id="msUrl" placeholder="https://..." class="sync-input"></div>
          <div class="btn-row" style="margin-top:16px;">
            <button id="msSyncBtn" class="btn-accent" style="flex:1;">Sync</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const m = document.getElementById('manualSyncModal');
    const close = () => m.remove();
    m.querySelector('#msClose').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });

    m.querySelector('#msSyncBtn').addEventListener('click', async () => {
      const url = m.querySelector('#msUrl').value.trim();
      if (!url) return toast('Please enter a URL');

      const btn = m.querySelector('#msSyncBtn');
      btn.textContent = 'Syncing...';
      btn.disabled = true;

      try {
        let newTmdbId = tmdbId;
        let malId = stored ? stored.malId : null;
        let requireTmdbUpdate = false;
        let requireMalUpdate = false;

        if (url.includes('myanimelist.net/anime/')) {
          const match = url.match(/anime\/(\d+)/);
          if (match) {
            malId = parseInt(match[1]);
            requireMalUpdate = true;
          }
        } else if (url.includes('themoviedb.org/')) {
          const match = url.match(/(movie|tv)\/(\d+)/);
          if (match) {
            const parsedType = match[1];
            if (parsedType !== mediaType) throw new Error(`Type mismatch: URL is ${parsedType}, current is ${mediaType}`);
            newTmdbId = parseInt(match[2]);
            requireTmdbUpdate = true;
          }
        } else {
          throw new Error('Unsupported URL. Use TMDB or MAL links.');
        }

        if (requireTmdbUpdate && newTmdbId !== tmdbId && stored) {
          Store.migrateTmdbId(tmdbId, newTmdbId, mediaType);
        }

        if (requireMalUpdate && stored) {
          if (isM) Store.updateMovie(newTmdbId, { malId });
          else Store.updateTvShow(newTmdbId, { malId });
          // Fetch Jikan info to update poster/details immediately
          const jikan = await SyncEngine._fetchJikanInfo(malId);
          if (jikan && jikan.poster) {
            if (isM) Store.updateMovie(newTmdbId, { posterPath: jikan.poster });
            else Store.updateTvShow(newTmdbId, { posterPath: jikan.poster });
          }
        }

        toast('Linked and synced successfully!');
        close();
        this.open(newTmdbId, mediaType);
      } catch (err) {
        toast('Error: ' + err.message);
        btn.textContent = 'Sync';
        btn.disabled = false;
      }
    });
  },

  _editModal(tmdbId, mt, title, details) {
    const isM = mt === 'movie';
    const st = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
    if (!st) return;
    const today = new Date().toISOString().substring(0, 10);
    const rwH = st.rewatchHistory || [];
    const rwHtml = rwH.length ? `<div class="edit-rewatch-history"><div class="edit-field-label">Rewatch History</div>${rwH.map((rw,i)=>`<div class="rw-history-row"><span class="rw-history-num">#${i+1}</span><span class="rw-history-dates">${rw.startDate||'—'} → ${rw.endDate||'—'}</span></div>`).join('')}</div>` : '';

    const html = `<div class="modal-backdrop edit-modal-backdrop" id="editModal"><div class="modal-box edit-modal-box"><div class="modal-header"><h2>Edit — ${esc(st.title)}</h2><button class="modal-close-btn" id="editClose">&#10005;</button></div><div class="modal-body">
      <div class="edit-dates-row"><div class="edit-field edit-field-half"><div class="edit-field-label">Start Date</div><div class="edit-date-input-row"><input type="date" id="editStart" value="${st.startDate||''}" class="edit-date-input"><button class="btn-today" id="editStartT">Today</button></div></div>
      <div class="edit-field edit-field-half"><div class="edit-field-label">End Date</div><div class="edit-date-input-row"><input type="date" id="editEnd" value="${st.endDate||''}" class="edit-date-input"><button class="btn-today" id="editEndT">Today</button></div></div></div>
      <hr><div class="edit-field"><div class="edit-field-label">Rewatches</div><div class="edit-rewatch-row"><div class="ep-counter"><button id="rwDec">-</button><div class="ep-counter-val" id="rwVal">${st.rewatchCount||0}</div><button id="rwInc">+</button></div>
      <button class="btn-ghost" id="editLogRw" style="margin-left:12px;">Log New Rewatch</button></div><p class="edit-field-hint" style="margin-top:6px;">Use +/- to adjust count. "Log New Rewatch" saves dates and resets${!isM?' season progress':''}.</p></div>${rwHtml}
      <hr><div class="edit-actions"><button class="btn-accent" id="editSave">Save Changes</button><button class="btn-ghost" id="editCancel">Cancel</button></div>
      <hr><div class="edit-field" style="padding-top:4px;"><button class="btn-delete" id="editDelete">Delete Permanently</button><p class="edit-field-hint" style="margin-top:4px;">Removes entry and all related data.</p></div>
    </div></div></div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    const m = document.getElementById('editModal');
    let rwc = st.rewatchCount || 0;
    const close = () => m.remove();

    m.querySelector('#editClose').addEventListener('click', close);
    m.querySelector('#editCancel').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#editStartT').addEventListener('click', () => { m.querySelector('#editStart').value = today; });
    m.querySelector('#editEndT').addEventListener('click', () => { m.querySelector('#editEnd').value = today; });
    m.querySelector('#rwInc').addEventListener('click', () => { rwc++; m.querySelector('#rwVal').textContent = rwc; });
    m.querySelector('#rwDec').addEventListener('click', () => { if (rwc > 0) rwc--; m.querySelector('#rwVal').textContent = rwc; });

    m.querySelector('#editLogRw').addEventListener('click', () => {
      const cs = m.querySelector('#editStart').value||st.startDate||'', ce = m.querySelector('#editEnd').value||st.endDate||'';
      const h = st.rewatchHistory||[]; h.push({startDate:cs,endDate:ce}); rwc++;
      const u = { rewatchCount:rwc, rewatchHistory:h, startDate:'', endDate:'', watchStatus:'watching' };
      if (!isM) u.seasons = (st.seasons||[]).map(s=>({...s,episodesWatched:0}));
      if (isM) Store.updateMovie(tmdbId,u); else Store.updateTvShow(tmdbId,u);
      Store.addActivity({tmdbId,title,type:mt,posterPath:st.posterPath,action:'rewatch',detail:`Started rewatch #${rwc}`,timestamp:new Date().toISOString()});
      App.refreshCounts(); toast(`Rewatch #${rwc} started`); close(); this.open(tmdbId,mt);
    });

    m.querySelector('#editSave').addEventListener('click', () => {
      const u = { startDate:m.querySelector('#editStart').value, endDate:m.querySelector('#editEnd').value, rewatchCount:rwc };
      if (isM) Store.updateMovie(tmdbId,u); else Store.updateTvShow(tmdbId,u);
      App.refreshCounts(); toast('Saved'); close(); this.open(tmdbId,mt);
    });

    m.querySelector('#editDelete').addEventListener('click', () => {
      if (confirm(`Permanently delete "${st.title}" and all its data?`)) {
        if (isM) Store.deleteMovie(tmdbId); else Store.deleteTvShow(tmdbId);
        App.refreshCounts(); toast('Deleted'); close(); App.showPage('watchlist');
      }
    });
  },

  _diaryLogModal(tmdbId, mediaType, title, posterPath, season) {
    const today=new Date().toISOString().substring(0,10); const poster=TMDB.poster(posterPath,'w185'); const isM=mediaType==='movie';
    const st=isM?Store.getMovie(tmdbId):Store.getTvShow(tmdbId);
    const sOpts=!isM&&st?(st.seasons||[]).map(s=>`<option value="${s.seasonNumber}" ${season===s.seasonNumber?'selected':''}>Season ${s.seasonNumber}</option>`).join(''):'';
    const entries=Store.getDiary().filter(d=>d.tmdbId===tmdbId&&d.type===mediaType);
    const aL={completed:'Completed',rewatch:'Rewatched',watched:'Watched',watched_episodes:'Watched eps',started:'Started',session:'Session'};
    const histHtml=entries.length?`<div class="dl-hist-section"><div class="dl-hist-header">Diary History (${entries.length})</div><div class="dl-hist-list">${entries.map(de=>{const a=aL[de.action]||de.action;const r=de.rating?` · ★ ${de.rating}`:'';const s=de.season?` · S${de.season}`:'';return`<div class="dl-hist-row"><div class="dl-hist-info"><span class="dl-hist-date">${de.date||'—'}</span><span class="dl-hist-act">${a}${s}${r}</span></div><button class="dl-hist-edit" data-ts="${de.timestamp}">Edit</button><button class="dl-hist-del" data-ts="${de.timestamp}">Remove</button></div>`;}).join('')}</div></div>`:'';
    const html=`<div class="modal-backdrop edit-modal-backdrop" id="diaryLogModal"><div class="modal-box edit-modal-box" style="max-width:460px;"><div class="modal-header"><h2>Log Diary</h2><button class="modal-close-btn" id="dlClose">&#10005;</button></div><div class="modal-body">
      <div class="dp-hero"><div class="dp-poster">${poster?`<img src="${poster}">`:`<div class="no-poster-ph" style="width:72px;height:108px;border-radius:6px;">${isM?'MOV':'TV'}</div>`}</div><div class="dp-info"><div class="dp-title">${esc(title)}</div>${season?`<div class="dp-season-tag">Season ${season}</div>`:''}</div></div>
      <div class="edit-field"><div class="edit-field-label">Date</div><div class="edit-date-input-row"><input type="date" id="dlDate" value="${today}" class="edit-date-input" style="flex:1;"><button class="btn-today" id="dlToday">Today</button></div></div>
      <div class="edit-dates-row"><div class="edit-field edit-field-half"><div class="edit-field-label">Action</div><select id="dlAction" class="edit-select" style="width:100%;"><option value="watched">Watched</option><option value="rewatch">Rewatched</option></select></div><div class="edit-field edit-field-half"><div class="edit-field-label">Rating</div><select id="dlRating" class="edit-select" style="width:100%;"><option value="0">— None —</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option value="${n}">★ ${n}/10</option>`).join('')}</select></div></div>
      ${!isM&&!season?`<div class="edit-field"><div class="edit-field-label">Season</div><select id="dlSeason" class="edit-select" style="width:100%;"><option value="">General / All</option>${sOpts}</select></div>`:''}
      <div class="edit-field"><div class="edit-field-label">Notes</div><textarea class="diary-notes-input" id="dlNotes" rows="2" placeholder="Thoughts..."></textarea></div>
      <div class="edit-actions"><button class="btn-accent" id="dlSave" style="flex:1;">Save Entry</button><button class="btn-ghost" id="dlCancel">Cancel</button></div>
      ${histHtml}
    </div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);const m=document.getElementById('diaryLogModal');const close=()=>m.remove();
    m.querySelector('#dlClose').addEventListener('click',close);m.querySelector('#dlCancel').addEventListener('click',close);m.addEventListener('click',e=>{if(e.target===m)close();});
    m.querySelector('#dlToday').addEventListener('click',()=>{m.querySelector('#dlDate').value=today;});
    m.querySelectorAll('.dl-hist-edit').forEach(btn=>{btn.addEventListener('click',()=>{close();this._editDiaryEntry(btn.dataset.ts,tmdbId,mediaType,title,posterPath);});});
    m.querySelectorAll('.dl-hist-del').forEach(btn=>{btn.addEventListener('click',()=>{if(confirm('Remove?')){Store.removeDiaryEntry(tmdbId,btn.dataset.ts);toast('Removed');close();this._diaryLogModal(tmdbId,mediaType,title,posterPath,season);}});});
    m.querySelector('#dlSave').addEventListener('click',()=>{const date=m.querySelector('#dlDate').value;if(!date){toast('Pick a date');return;}const action=m.querySelector('#dlAction').value;const notes=m.querySelector('#dlNotes').value.trim();const rating=parseInt(m.querySelector('#dlRating').value)||null;const selS=season||(!isM&&m.querySelector('#dlSeason')?parseInt(m.querySelector('#dlSeason').value)||null:null);Store.addDiaryEntry({tmdbId,title,type:mediaType,posterPath,date,action,notes,rating,mood:null,episodes:null,season:selS,timestamp:new Date().toISOString()});toast('Saved!');close();this.open(tmdbId,mediaType);});
  },

  _editDiaryEntry(ts, tmdbId, mt, title, posterPath) {
    const entry=Store.getDiaryEntry(ts);if(!entry)return;const isM=mt==='movie';const st=isM?Store.getMovie(tmdbId):Store.getTvShow(tmdbId);
    const sOpts=!isM&&st?(st.seasons||[]).map(s=>`<option value="${s.seasonNumber}" ${entry.season===s.seasonNumber?'selected':''}>Season ${s.seasonNumber}</option>`).join(''):'';
    const html=`<div class="modal-backdrop edit-modal-backdrop" id="editDiaryModal"><div class="modal-box edit-modal-box" style="max-width:420px;"><div class="modal-header"><h2>Edit Entry</h2><button class="modal-close-btn" id="edClose">&#10005;</button></div><div class="modal-body">
      <div class="edit-field"><div class="edit-field-label">Date</div><input type="date" id="edDate" value="${entry.date||''}" class="edit-date-input" style="width:100%;"></div>
      <div class="edit-dates-row"><div class="edit-field edit-field-half"><div class="edit-field-label">Action</div><select id="edAction" class="edit-select" style="width:100%;"><option value="watched" ${entry.action==='watched'?'selected':''}>Watched</option><option value="rewatch" ${entry.action==='rewatch'?'selected':''}>Rewatched</option></select></div>
      <div class="edit-field edit-field-half"><div class="edit-field-label">Rating</div><select id="edRating" class="edit-select" style="width:100%;"><option value="0">— None —</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option value="${n}" ${entry.rating===n?'selected':''}>★ ${n}/10</option>`).join('')}</select></div></div>
      ${!isM?`<div class="edit-field"><div class="edit-field-label">Season</div><select id="edSeason" class="edit-select" style="width:100%;"><option value="">General</option>${sOpts}</select></div>`:''}
      <div class="edit-field"><div class="edit-field-label">Notes</div><textarea class="diary-notes-input" id="edNotes" rows="3">${esc(entry.notes||'')}</textarea></div>
      <div class="edit-actions"><button class="btn-accent" id="edSave">Save</button><button class="btn-ghost" id="edBack">Back</button></div>
    </div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);const m=document.getElementById('editDiaryModal');const close=()=>m.remove();
    m.querySelector('#edClose').addEventListener('click',close);m.querySelector('#edBack').addEventListener('click',()=>{close();this._diaryLogModal(tmdbId,mt,title,posterPath,null);});
    m.addEventListener('click',e=>{if(e.target===m)close();});
    m.querySelector('#edSave').addEventListener('click',()=>{Store.updateDiaryEntry(ts,{date:m.querySelector('#edDate').value,action:m.querySelector('#edAction').value,season:!isM&&m.querySelector('#edSeason')?parseInt(m.querySelector('#edSeason').value)||null:null,rating:parseInt(m.querySelector('#edRating').value)||null,notes:m.querySelector('#edNotes').value.trim()});toast('Updated');close();this._diaryLogModal(tmdbId,mt,title,posterPath,null);});
  },

  _bindSeason(page, tmdbId, tmdbS) {
    const list = page.querySelector('#seasonTrackList');
    if (!list) return;
    list.addEventListener('click', e => {
      const btn = e.target.closest('button'); if (!btn) return;
      const sn = parseInt(btn.dataset.snum);
      const show = Store.getTvShow(tmdbId); if (!show) return;
      const ss = show.seasons||[]; const si = ss.findIndex(s=>s.seasonNumber===sn); if (si===-1) return;
      const s = ss[si]; const tot = s.episodeCount||0;
      if (btn.classList.contains('ep-inc')) { if (s.episodesWatched<tot) s.episodesWatched++; }
      else if (btn.classList.contains('ep-dec')) { if (s.episodesWatched>0) s.episodesWatched--; }
      else if (btn.classList.contains('season-done-btn')) { s.episodesWatched = btn.classList.contains('mark-done') ? tot : 0; }
      else return;
      const allD = ss.every(x=>x.episodesWatched>=(x.episodeCount||0)&&(x.episodeCount||0)>0);
      const anyS = ss.some(x=>x.episodesWatched>0);
      let ns = show.watchStatus; if (allD) ns='completed'; else if (anyS&&show.watchStatus==='plan_to_watch') ns='watching';
      Store.updateTvShow(tmdbId,{seasons:ss,watchStatus:ns}); App.refreshCounts();
      const card = list.querySelector(`[data-snum="${sn}"]`);
      if (card) { const w=s.episodesWatched||0,dn=w>=tot&&tot>0,pct=tot>0?(w/tot)*100:0; card.classList.toggle('season-done',dn); card.classList.toggle('season-active',!dn); card.querySelector('.season-progress-fill').style.width=`${pct}%`; card.querySelector('.season-progress-fill').style.background=dn?'var(--watching)':'var(--accent-light)'; card.querySelector('.ep-counter-val').textContent=`${w} / ${tot}`; const db=card.querySelector('.season-done-btn'); db.className=dn?'season-done-btn undone':'season-done-btn mark-done'; db.textContent=dn?'Undo':'Done'; }
      const sel = page.querySelector('#detailStatusLabel');
      if (sel) {
        const cfgMap = { watching:{l:'Watching',c:'#00b894'}, completed:{l:'Completed',c:'#6c5ce7'}, on_hold:{l:'On-Hold',c:'#fdcb6e'}, dropped:{l:'Dropped',c:'#e17055'}, plan_to_watch:{l:'Plan to Watch',c:'#a29bfe'} };
        const cfg = cfgMap[ns]; if (cfg) { sel.textContent = cfg.l; const dot = page.querySelector('#detailStatusBtn .dd-dot'); if (dot) dot.style.background = cfg.c; }
      }
    });
  },

  // Build a TMDB-compatible detail object from stored MAL data + optional Jikan enrichment
  async _buildMalDetail(stored, isMovie) {
    const d = {
      id: stored.tmdbId,
      title: stored.title,
      name: stored.title,
      poster_path: stored.posterPath || null,
      backdrop_path: stored.backdropPath || null,
      release_date: stored.endDate || '',
      first_air_date: stored.startDate || '',
      last_air_date: '',
      vote_average: stored.voteAverage || 0,
      vote_count: 0,
      genres: (stored.genres || []).map(g => typeof g === 'string' ? { name: g } : g),
      overview: '',
      runtime: stored.runtime || 0,
      number_of_seasons: stored.totalSeasons || 0,
      number_of_episodes: stored.totalEpisodes || stored.episodes || 0,
      seasons: (stored.seasons || []).map(s => ({
        season_number: s.seasonNumber,
        episode_count: s.episodeCount || 0,
        poster_path: s.posterPath || null,
        name: 'Season ' + s.seasonNumber,
      })),
      credits: { cast: [], crew: [] },
      videos: { results: [] },
      recommendations: { results: [] },
      production_companies: [],
      production_countries: [],
      spoken_languages: [],
      created_by: [],
      networks: [],
      episode_run_time: [],
      status: '',
      tagline: '',
      budget: 0,
      revenue: 0,
    };

    // Try to enrich with Jikan data if we have a malId
    if (stored.malId) {
      try {
        const res = await bgFetch(`https://api.jikan.moe/v4/anime/${stored.malId}/full`);
        if (res.ok) {
          const jData = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
          const anime = jData?.data;
          if (anime) {
            d.overview = anime.synopsis || '';
            d.tagline = anime.title_japanese || '';
            d.vote_average = anime.score || d.vote_average;
            d.vote_count = anime.scored_by || 0;
            if (anime.images?.jpg?.large_image_url) {
              d.poster_path = anime.images.jpg.large_image_url;
            }
            if (anime.trailer?.images?.maximum_image_url) {
              d.backdrop_path = anime.trailer.images.maximum_image_url;
            }
            d.genres = (anime.genres || []).concat(anime.themes || []).map(g => ({ name: g.name }));
            d.status = anime.status || '';
            if (anime.aired?.from) d.first_air_date = anime.aired.from.substring(0, 10);
            if (anime.aired?.to) d.last_air_date = anime.aired.to.substring(0, 10);
            d.release_date = d.first_air_date;
            d.runtime = anime.duration ? parseInt(anime.duration) || 0 : 0;
            d.number_of_episodes = anime.episodes || d.number_of_episodes;
            d.production_companies = (anime.studios || []).map(s => ({ name: s.name }));

            // Update stored poster if we got a better one
            if (d.poster_path && d.poster_path.startsWith('http')) {
              if (isMovie) Store.updateMovie(stored.tmdbId, { posterPath: d.poster_path, genres: d.genres.map(g => g.name), voteAverage: d.vote_average });
              else Store.updateTvShow(stored.tmdbId, { posterPath: d.poster_path, genres: d.genres.map(g => g.name), voteAverage: d.vote_average });
            }
          }
        }
      } catch (e) { /* proceed with stored data only */ }
    }

    return d;
  },
};
