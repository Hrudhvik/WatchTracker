/* ═══════════════════════════════════════════
   UI — TV Shows (Grid + Detail + Season Tracker + Edit Modal)
   ═══════════════════════════════════════════ */

const TvShowsUI = {

  // ─── Grid ───
  renderGrid(filter = 'all', sortBy = 'dateAdded') {
    let items = Store.getTvShows();
    if (filter !== 'all') items = items.filter(t => t.watchStatus === filter);
    if (sortBy === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === 'year') items.sort((a, b) => (b.year || 0) - (a.year || 0));

    const grid = document.getElementById('tvGrid');
    const empty = document.getElementById('tvEmpty');

    if (items.length === 0) {
      grid.innerHTML = '';
      empty.classList.add('visible');
      return;
    }
    empty.classList.remove('visible');

    const statusLabels = {
      watching: 'Watching', plan_to_watch: 'Plan to Watch',
      completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped'
    };

    grid.innerHTML = items.map(t => {
      const poster = TMDB.poster(t.posterPath, 'w342');
      const posterHtml = poster
        ? `<img src="${poster}" alt="" loading="lazy">`
        : `<div class="no-poster-ph">📺</div>`;

      const seasons = t.seasons || [];
      const pipHtml = seasons.length > 0 ? `
        <div class="season-pips">
          ${seasons.map(s => {
            const watched = s.episodesWatched || 0;
            const total = s.episodeCount || 0;
            const cls = watched >= total && total > 0 ? 'pip-done' : (watched > 0 ? 'pip-active' : '');
            return `<div class="season-pip ${cls}"></div>`;
          }).join('')}
        </div>` : '';

      return `
        <div class="grid-card" data-tmdb="${t.tmdbId}">
          <div class="poster-wrap">
            ${posterHtml}
            <div class="poster-overlay"></div>
            <div class="poster-badge badge-${t.watchStatus}">${statusLabels[t.watchStatus]}</div>
          </div>
          <div class="grid-card-info">
            <div class="grid-card-title" title="${esc(t.title)}">${esc(t.title)}</div>
            <div class="grid-card-meta">
              <span>${t.year || '—'}</span>
              ${t.voteAverage ? `<span>·</span><span class="tmdb-score">★ ${t.voteAverage.toFixed(1)}</span>` : ''}
              <span>·</span><span>${t.totalSeasons || '?'}S</span>
            </div>
            ${pipHtml}
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.grid-card').forEach(card => {
      card.addEventListener('click', () => this.openDetail(parseInt(card.dataset.tmdb)));
    });
  },

  // ─── Detail Page ───
  async openDetail(tmdbId) {
    const page = document.getElementById('page-tv-detail');
    page.innerHTML = '<div style="padding:40px;color:var(--text-3)">Loading...</div>';
    App.showPage('tv-detail');

    let details;
    try {
      details = await TMDB.tvDetails(tmdbId);
    } catch (e) {
      page.innerHTML = `<div style="padding:40px;color:var(--dropped)">Failed to load. ${e.message}</div>`;
      return;
    }

    const stored = Store.getTvShow(tmdbId);
    const isInList = !!stored;

    const backdrop = TMDB.backdrop(details.backdrop_path);
    const poster = TMDB.poster(details.poster_path, 'w500');
    const year = (details.first_air_date || '').substring(0, 4);
    const lastYear = (details.last_air_date || '').substring(0, 4);
    const yearRange = lastYear && lastYear !== year ? `${year}–${lastYear}` : year;
    const genres = (details.genres || []).map(g => g.name);
    const creators = (details.created_by || []).map(c => c.name);
    const cast = (details.credits?.cast || []).slice(0, 12);
    const trailer = (details.videos?.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
    const recommendations = (details.recommendations?.results || []).slice(0, 6);
    const networks = (details.networks || []).slice(0, 4);
    const companies = (details.production_companies || []).slice(0, 4);
    const countries = (details.production_countries || []).map(c => c.name);
    const languages = (details.spoken_languages || []).map(l => l.english_name);
    const episodeRuntime = (details.episode_run_time || [])[0] || '—';
    const tmdbSeasons = (details.seasons || []).filter(s => s.season_number > 0);

    const watchStatus = stored?.watchStatus || 'plan_to_watch';
    const rewatchCount = stored?.rewatchCount || 0;
    const startDate = stored?.startDate || '';
    const endDate = stored?.endDate || '';

    const storedSeasons = stored?.seasons || [];
    const seasonsMap = {};
    storedSeasons.forEach(s => { seasonsMap[s.seasonNumber] = s; });

    const statusLabels = {
      watching: 'Watching', plan_to_watch: 'Plan to Watch',
      completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped'
    };

    page.innerHTML = `
      <button class="btn-back" id="tvBackBtn">← Back</button>

      <div class="detail-backdrop">
        ${backdrop ? `<img src="${backdrop}" alt="">` : '<div style="height:100%;background:var(--bg-2)"></div>'}
        <div class="detail-backdrop-grad"></div>
      </div>

      <div class="detail-hero">
        <div class="detail-poster-wrap">
          ${poster ? `<img src="${poster}" alt="">` : '<div class="no-poster-ph" style="width:200px;height:300px;border-radius:12px;">📺</div>'}
        </div>
        <div class="detail-hero-info">
          <h1>${esc(details.name)}</h1>
          ${details.tagline ? `<div class="detail-tagline">"${esc(details.tagline)}"</div>` : ''}
          <div class="detail-chips">
            ${genres.map(g => `<span class="detail-chip">${esc(g)}</span>`).join('')}
            ${yearRange ? `<span class="detail-chip">${yearRange}</span>` : ''}
            <span class="detail-chip">${details.number_of_seasons || '?'} Seasons</span>
            <span class="detail-chip">${details.number_of_episodes || '?'} Episodes</span>
          </div>

          <div class="detail-stats">
            ${details.vote_average ? `
              <div class="detail-stat">
                <div class="detail-stat-val gold">★ ${details.vote_average.toFixed(1)}</div>
                <div class="detail-stat-label">TMDB (${details.vote_count || 0})</div>
              </div>` : ''}
            ${details.popularity ? `
              <div class="detail-stat">
                <div class="detail-stat-val">${Math.round(details.popularity)}</div>
                <div class="detail-stat-label">Popularity</div>
              </div>` : ''}
            <div class="detail-stat">
              <div class="detail-stat-val">${details.status || '—'}</div>
              <div class="detail-stat-label">Status</div>
            </div>
            ${rewatchCount > 0 ? `
              <div class="detail-stat">
                <div class="detail-stat-val">${rewatchCount}</div>
                <div class="detail-stat-label">Rewatches</div>
              </div>` : ''}
          </div>

          <div class="detail-actions">
            ${isInList ? `
              <span class="detail-status-badge badge-${watchStatus}">${statusLabels[watchStatus]}</span>
              <button class="btn-accent" id="tvEditBtn">✏ Edit</button>
              <button class="btn-danger" id="tvRemoveBtn">Remove</button>
            ` : `
              <button class="btn-accent" id="tvAddBtn">+ Add to List</button>
            `}
          </div>

          ${isInList && (startDate || endDate) ? `
            <div class="detail-dates-row">
              ${startDate ? `<span class="detail-date-chip">Started: ${startDate}</span>` : ''}
              ${endDate ? `<span class="detail-date-chip">Finished: ${endDate}</span>` : ''}
            </div>` : ''}
        </div>
      </div>

      <div class="detail-body">
        ${details.overview ? `
          <div class="detail-section">
            <h3>Overview</h3>
            <p class="detail-overview">${esc(details.overview)}</p>
          </div>` : ''}

        ${isInList ? `
          <div class="detail-section">
            <h3>Season Progress</h3>
            <div class="season-track-list" id="seasonTrackList">
              ${tmdbSeasons.map(s => {
                const tracked = seasonsMap[s.season_number] || { episodesWatched: 0 };
                const watched = tracked.episodesWatched || 0;
                const total = s.episode_count || 0;
                const isDone = watched >= total && total > 0;
                const progress = total > 0 ? (watched / total) * 100 : 0;
                const sPoster = TMDB.poster(s.poster_path, 'w185');
                const airDate = s.air_date ? s.air_date.substring(0, 4) : '';
                const cardClass = isDone ? 'season-done' : '';
                const activeClass = !isDone ? 'season-active' : '';

                return `
                  <div class="season-track-card ${cardClass} ${activeClass}" data-snum="${s.season_number}" data-total="${total}">
                    ${sPoster ? `<img class="season-poster" src="${sPoster}" loading="lazy">` : '<div class="season-poster no-poster-ph" style="font-size:18px;">📺</div>'}
                    <div class="season-info">
                      <h4>Season ${s.season_number}</h4>
                      <div class="season-meta">${total} episodes${airDate ? ` · ${airDate}` : ''}</div>
                      <div class="season-progress-bar">
                        <div class="season-progress-fill" style="width:${progress}%;background:${isDone ? 'var(--watching)' : 'var(--accent-light)'}"></div>
                      </div>
                    </div>
                    <div class="season-controls">
                      <div class="ep-counter">
                        <button class="ep-dec" data-snum="${s.season_number}">−</button>
                        <div class="ep-counter-val">${watched} / ${total}</div>
                        <button class="ep-inc" data-snum="${s.season_number}">+</button>
                      </div>
                      <button class="season-done-btn ${isDone ? 'undone' : 'mark-done'}" data-snum="${s.season_number}">
                        ${isDone ? '↩ Undo' : '✓ Done'}
                      </button>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>` : ''}

        <div class="detail-section">
          <h3>Details</h3>
          <div class="detail-info-grid">
            ${creators.length ? `<div class="info-cell"><div class="info-cell-label">Created By</div><div class="info-cell-value">${esc(creators.join(', '))}</div></div>` : ''}
            <div class="info-cell"><div class="info-cell-label">First Air Date</div><div class="info-cell-value">${details.first_air_date || '—'}</div></div>
            <div class="info-cell"><div class="info-cell-label">Last Air Date</div><div class="info-cell-value">${details.last_air_date || '—'}</div></div>
            <div class="info-cell"><div class="info-cell-label">Episode Runtime</div><div class="info-cell-value">${episodeRuntime}m</div></div>
            <div class="info-cell"><div class="info-cell-label">Type</div><div class="info-cell-value">${details.type || '—'}</div></div>
            <div class="info-cell"><div class="info-cell-label">Original Language</div><div class="info-cell-value">${(details.original_language || '').toUpperCase()}</div></div>
            ${languages.length ? `<div class="info-cell"><div class="info-cell-label">Languages</div><div class="info-cell-value">${esc(languages.join(', '))}</div></div>` : ''}
            ${countries.length ? `<div class="info-cell"><div class="info-cell-label">Countries</div><div class="info-cell-value">${esc(countries.join(', '))}</div></div>` : ''}
          </div>
        </div>

        ${cast.length ? `
          <div class="detail-section">
            <h3>Cast</h3>
            <div class="cast-row">
              ${cast.map(c => {
                const profileImg = TMDB.profile(c.profile_path);
                return `<div class="cast-card">
                  ${profileImg ? `<img src="${profileImg}" alt="" loading="lazy">` : '<div style="width:80px;height:80px;border-radius:50%;background:var(--bg-3);margin:0 auto 6px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:24px;">👤</div>'}
                  <div class="cast-name">${esc(c.name)}</div>
                  <div class="cast-char">${esc(c.character || '')}</div>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}

        ${networks.length ? `
          <div class="detail-section">
            <h3>Networks</h3>
            <div class="companies-row">
              ${networks.map(n => {
                const logo = n.logo_path ? `<img src="${TMDB.poster(n.logo_path, 'w92')}" alt="">` : '';
                return `<div class="company-tag">${logo}${esc(n.name)}</div>`;
              }).join('')}
            </div>
          </div>` : ''}

        ${companies.length ? `
          <div class="detail-section">
            <h3>Production</h3>
            <div class="companies-row">
              ${companies.map(c => {
                const logo = c.logo_path ? `<img src="${TMDB.poster(c.logo_path, 'w92')}" alt="">` : '';
                return `<div class="company-tag">${logo}${esc(c.name)}</div>`;
              }).join('')}
            </div>
          </div>` : ''}

        ${trailer ? `
          <div class="detail-section">
            <h3>Trailer</h3>
            <div style="border-radius:12px;overflow:hidden;max-width:640px;">
              <iframe width="100%" height="360" src="https://www.youtube.com/embed/${trailer.key}" frameborder="0" allowfullscreen style="display:block;"></iframe>
            </div>
          </div>` : ''}

        ${recommendations.length ? `
          <div class="detail-section">
            <h3>Recommended</h3>
            <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;">
              ${recommendations.map(r => {
                const rPoster = TMDB.poster(r.poster_path, 'w185');
                return `<div class="grid-card" data-tmdb="${r.id}" data-rectype="tv" style="flex-shrink:0;width:130px;">
                  <div class="poster-wrap" style="aspect-ratio:2/3;">
                    ${rPoster ? `<img src="${rPoster}" loading="lazy">` : '<div class="no-poster-ph">📺</div>'}
                    <div class="poster-overlay"></div>
                  </div>
                  <div class="grid-card-info">
                    <div class="grid-card-title">${esc(r.name || r.title)}</div>
                    <div class="grid-card-meta"><span>${(r.first_air_date || '').substring(0,4)}</span></div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}
      </div>
    `;

    // ─── Bind events ───
    page.querySelector('#tvBackBtn').addEventListener('click', () => App.showPage('tvshows'));

    // Add to list
    const addBtn = page.querySelector('#tvAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const seasonsData = tmdbSeasons.map(s => ({
          seasonNumber: s.season_number,
          episodeCount: s.episode_count || 0,
          episodesWatched: 0,
          posterPath: s.poster_path,
        }));
        const item = {
          tmdbId: details.id,
          title: details.name,
          posterPath: details.poster_path,
          backdropPath: details.backdrop_path,
          year: parseInt(year) || 0,
          voteAverage: details.vote_average || 0,
          totalSeasons: details.number_of_seasons || 0,
          totalEpisodes: details.number_of_episodes || 0,
          genres: genres,
          watchStatus: 'plan_to_watch',
          rewatchCount: 0,
          rewatchHistory: [],
          startDate: '',
          endDate: '',
          seasons: seasonsData,
          dateAdded: new Date().toISOString(),
          dateUpdated: new Date().toISOString(),
        };
        Store.addTvShow(item);
        Store.addActivity({
          tmdbId: details.id, title: details.name, type: 'tv',
          posterPath: details.poster_path, action: 'added',
          detail: 'Added to list as Plan to Watch',
          timestamp: new Date().toISOString(),
        });
        App.refreshCounts();
        toast(`Added "${details.name}" to your TV shows`);
        this.openDetail(tmdbId);
      });
    }

    // Edit
    const editBtn = page.querySelector('#tvEditBtn');
    if (editBtn) {
      editBtn.addEventListener('click', () => this._openEditModal(tmdbId, details));
    }

    // Remove
    const removeBtn = page.querySelector('#tvRemoveBtn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        if (confirm(`Remove "${details.name}" from your list?`)) {
          Store.removeTvShow(tmdbId);
          Store.addActivity({
            tmdbId: details.id, title: details.name, type: 'tv',
            posterPath: details.poster_path, action: 'removed',
            detail: 'Removed from list',
            timestamp: new Date().toISOString(),
          });
          App.refreshCounts();
          toast('Removed from list');
          App.showPage('tvshows');
        }
      });
    }

    // Season tracking controls
    if (isInList) this._bindSeasonControls(page, tmdbId, tmdbSeasons);

    // Recommended clicks
    page.querySelectorAll('[data-rectype="tv"]').forEach(card => {
      card.addEventListener('click', () => this.openDetail(parseInt(card.dataset.tmdb)));
    });
  },

  // ─── Edit Modal ───
  _openEditModal(tmdbId, details) {
    const stored = Store.getTvShow(tmdbId);
    if (!stored) return;

    const today = new Date().toISOString().substring(0, 10);
    const rwHistory = stored.rewatchHistory || [];

    const rwHistoryHtml = rwHistory.length > 0 ? `
      <div class="edit-rewatch-history">
        <div class="edit-field-label">Rewatch History</div>
        ${rwHistory.map((rw, idx) => `
          <div class="rw-history-row">
            <span class="rw-history-num">↻ #${idx + 1}</span>
            <span class="rw-history-dates">${rw.startDate || '—'} → ${rw.endDate || '—'}</span>
          </div>
        `).join('')}
      </div>` : '';

    const modalHtml = `
      <div class="modal-backdrop edit-modal-backdrop" id="editTvModal">
        <div class="modal-box edit-modal-box">
          <div class="modal-header">
            <h2>Edit — ${esc(stored.title)}</h2>
            <button class="modal-close-btn" id="editTvClose">✕</button>
          </div>
          <div class="modal-body">
            <div class="edit-field">
              <div class="edit-field-label">Status</div>
              <select class="status-select edit-full-select" id="editTvStatus">
                <option value="watching" ${stored.watchStatus === 'watching' ? 'selected' : ''}>🟢 Watching</option>
                <option value="plan_to_watch" ${stored.watchStatus === 'plan_to_watch' ? 'selected' : ''}>📋 Plan to Watch</option>
                <option value="completed" ${stored.watchStatus === 'completed' ? 'selected' : ''}>✅ Completed</option>
                <option value="on_hold" ${stored.watchStatus === 'on_hold' ? 'selected' : ''}>⏸ On Hold</option>
                <option value="dropped" ${stored.watchStatus === 'dropped' ? 'selected' : ''}>🚫 Dropped</option>
              </select>
            </div>

            <div class="edit-dates-row">
              <div class="edit-field edit-field-half">
                <div class="edit-field-label">Start Date</div>
                <div class="edit-date-input-row">
                  <input type="date" id="editTvStartDate" value="${stored.startDate || ''}" class="edit-date-input">
                  <button class="btn-today" id="editTvStartToday">Today</button>
                </div>
              </div>
              <div class="edit-field edit-field-half">
                <div class="edit-field-label">End Date</div>
                <div class="edit-date-input-row">
                  <input type="date" id="editTvEndDate" value="${stored.endDate || ''}" class="edit-date-input">
                  <button class="btn-today" id="editTvEndToday">Today</button>
                </div>
              </div>
            </div>

            <hr>

            <div class="edit-field">
              <div class="edit-field-label">Rewatch</div>
              <p class="edit-field-hint">Current rewatches: <strong>${stored.rewatchCount || 0}</strong></p>
              <button class="btn-ghost" id="editTvRewatch" style="margin-top:6px;">↻ Add Rewatch</button>
              <p class="edit-field-hint" style="margin-top:4px;">Saves current dates, resets all season progress, and starts fresh.</p>
            </div>

            ${rwHistoryHtml}

            <hr>
            <div class="edit-actions">
              <button class="btn-accent" id="editTvSave">Save Changes</button>
              <button class="btn-ghost" id="editTvCancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('editTvModal');
    const closeModal = () => modal.remove();

    modal.querySelector('#editTvClose').addEventListener('click', closeModal);
    modal.querySelector('#editTvCancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#editTvStartToday').addEventListener('click', () => {
      modal.querySelector('#editTvStartDate').value = today;
    });
    modal.querySelector('#editTvEndToday').addEventListener('click', () => {
      modal.querySelector('#editTvEndDate').value = today;
    });

    // Rewatch
    modal.querySelector('#editTvRewatch').addEventListener('click', () => {
      const currentStart = stored.startDate || '';
      const currentEnd = stored.endDate || '';
      const history = stored.rewatchHistory || [];
      history.push({ startDate: currentStart, endDate: currentEnd });
      const newCount = (stored.rewatchCount || 0) + 1;
      const resetSeasons = (stored.seasons || []).map(s => ({ ...s, episodesWatched: 0 }));

      Store.updateTvShow(tmdbId, {
        rewatchCount: newCount,
        rewatchHistory: history,
        startDate: '',
        endDate: '',
        watchStatus: 'watching',
        seasons: resetSeasons,
      });
      Store.addActivity({
        tmdbId: stored.tmdbId, title: stored.title, type: 'tv',
        posterPath: stored.posterPath, action: 'rewatch',
        detail: `Started rewatch #${newCount}`,
        timestamp: new Date().toISOString(),
      });
      App.refreshCounts();
      toast(`Rewatch #${newCount} started! Progress reset.`);
      closeModal();
      this.openDetail(tmdbId);
    });

    // Save
    modal.querySelector('#editTvSave').addEventListener('click', () => {
      const newStatus = modal.querySelector('#editTvStatus').value;
      const newStart = modal.querySelector('#editTvStartDate').value;
      const newEnd = modal.querySelector('#editTvEndDate').value;

      const oldStatus = stored.watchStatus;
      Store.updateTvShow(tmdbId, {
        watchStatus: newStatus,
        startDate: newStart,
        endDate: newEnd,
      });

      if (oldStatus !== newStatus) {
        const sl = { watching: 'Watching', plan_to_watch: 'Plan to Watch', completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped' };
        Store.addActivity({
          tmdbId: stored.tmdbId, title: stored.title, type: 'tv',
          posterPath: stored.posterPath, action: 'status_change',
          detail: `Changed to ${sl[newStatus]}`,
          timestamp: new Date().toISOString(),
        });
      }

      App.refreshCounts();
      toast('Changes saved');
      closeModal();
      this.openDetail(tmdbId);
    });
  },

  // ─── Season Controls ───
  _bindSeasonControls(page, tmdbId, tmdbSeasons) {
    const list = page.querySelector('#seasonTrackList');
    if (!list) return;

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      const snum = parseInt(btn.dataset.snum);
      const show = Store.getTvShow(tmdbId);
      if (!show) return;

      const seasons = show.seasons || [];
      const sIdx = seasons.findIndex(s => s.seasonNumber === snum);
      if (sIdx === -1) return;

      const season = seasons[sIdx];
      const total = season.episodeCount || 0;

      if (btn.classList.contains('ep-inc')) {
        if (season.episodesWatched < total) season.episodesWatched++;
      } else if (btn.classList.contains('ep-dec')) {
        if (season.episodesWatched > 0) season.episodesWatched--;
      } else if (btn.classList.contains('season-done-btn')) {
        if (btn.classList.contains('mark-done')) season.episodesWatched = total;
        else season.episodesWatched = 0;
      } else return;

      const allDone = seasons.every(s => s.episodesWatched >= (s.episodeCount || 0) && (s.episodeCount || 0) > 0);
      const anyStarted = seasons.some(s => s.episodesWatched > 0);
      let newStatus = show.watchStatus;
      if (allDone) newStatus = 'completed';
      else if (anyStarted && show.watchStatus === 'plan_to_watch') newStatus = 'watching';

      Store.updateTvShow(tmdbId, { seasons, watchStatus: newStatus });
      App.refreshCounts();
      this._updateSeasonCard(list, snum, season, total);

      const statusSel = page.querySelector('#tvStatusSelect');
      if (statusSel && statusSel.value !== newStatus) statusSel.value = newStatus;
    });
  },

  _updateSeasonCard(list, snum, season, total) {
    const card = list.querySelector(`[data-snum="${snum}"]`);
    if (!card) return;
    const watched = season.episodesWatched || 0;
    const isDone = watched >= total && total > 0;
    const progress = total > 0 ? (watched / total) * 100 : 0;
    card.classList.toggle('season-done', isDone);
    card.classList.toggle('season-active', !isDone);
    card.querySelector('.season-progress-fill').style.width = `${progress}%`;
    card.querySelector('.season-progress-fill').style.background = isDone ? 'var(--watching)' : 'var(--accent-light)';
    card.querySelector('.ep-counter-val').textContent = `${watched} / ${total}`;
    const doneBtn = card.querySelector('.season-done-btn');
    doneBtn.className = isDone ? 'season-done-btn undone' : 'season-done-btn mark-done';
    doneBtn.textContent = isDone ? '↩ Undo' : '✓ Done';
  },
};
