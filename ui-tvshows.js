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
    DetailUI.open(tmdbId, 'tv');
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
