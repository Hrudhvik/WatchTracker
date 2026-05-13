/* ═══════════════════════════════════════════
   UI — Movies (Grid + Detail + Edit Modal)
   ═══════════════════════════════════════════ */

const MoviesUI = {

  // ─── Grid Rendering ───
  renderGrid(filter = 'all', sortBy = 'dateAdded') {
    let items = Store.getMovies();
    if (filter !== 'all') items = items.filter(m => m.watchStatus === filter);
    if (sortBy === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === 'year') items.sort((a, b) => (b.year || 0) - (a.year || 0));

    const grid = document.getElementById('movieGrid');
    const empty = document.getElementById('movieEmpty');

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

    grid.innerHTML = items.map(m => {
      const poster = TMDB.poster(m.posterPath, 'w342');
      const posterHtml = poster
        ? `<img src="${poster}" alt="" loading="lazy">`
        : `<div class="no-poster-ph">🎬</div>`;

      return `
        <div class="grid-card" data-tmdb="${m.tmdbId}">
          <div class="poster-wrap">
            ${posterHtml}
            <div class="poster-overlay"></div>
            <div class="poster-badge badge-${m.watchStatus}">${statusLabels[m.watchStatus]}</div>
          </div>
          <div class="grid-card-info">
            <div class="grid-card-title" title="${esc(m.title)}">${esc(m.title)}</div>
            <div class="grid-card-meta">
              <span>${m.year || '—'}</span>
              ${m.voteAverage ? `<span>·</span><span class="tmdb-score">★ ${m.voteAverage.toFixed(1)}</span>` : ''}
              ${m.runtime ? `<span>·</span><span>${m.runtime}m</span>` : ''}
              ${m.rewatchCount ? `<span>·</span><span>↻ ${m.rewatchCount}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.grid-card').forEach(card => {
      card.addEventListener('click', () => {
        this.openDetail(parseInt(card.dataset.tmdb));
      });
    });
  },

  // ─── Detail Page ───
  async openDetail(tmdbId) {
    DetailUI.open(tmdbId, 'movie');
  },

  // ─── Edit Modal ───
  _openEditModal(tmdbId, details) {
    const stored = Store.getMovie(tmdbId);
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
      <div class="modal-backdrop edit-modal-backdrop" id="editMovieModal">
        <div class="modal-box edit-modal-box">
          <div class="modal-header">
            <h2>Edit — ${esc(stored.title)}</h2>
            <button class="modal-close-btn" id="editMovieClose">✕</button>
          </div>
          <div class="modal-body">
            <div class="edit-field">
              <div class="edit-field-label">Status</div>
              <select class="status-select edit-full-select" id="editMovieStatus">
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
                  <input type="date" id="editMovieStartDate" value="${stored.startDate || ''}" class="edit-date-input">
                  <button class="btn-today" id="editMovieStartToday">Today</button>
                </div>
              </div>
              <div class="edit-field edit-field-half">
                <div class="edit-field-label">End Date</div>
                <div class="edit-date-input-row">
                  <input type="date" id="editMovieEndDate" value="${stored.endDate || ''}" class="edit-date-input">
                  <button class="btn-today" id="editMovieEndToday">Today</button>
                </div>
              </div>
            </div>

            <hr>

            <div class="edit-field">
              <div class="edit-field-label">Rewatch</div>
              <p class="edit-field-hint">Current rewatches: <strong>${stored.rewatchCount || 0}</strong></p>
              <button class="btn-ghost" id="editMovieRewatch" style="margin-top:6px;">↻ Add Rewatch</button>
              <p class="edit-field-hint" style="margin-top:4px;">Saves current dates as a rewatch entry, increments count, and resets dates.</p>
            </div>

            ${rwHistoryHtml}

            <hr>
            <div class="edit-actions">
              <button class="btn-accent" id="editMovieSave">Save Changes</button>
              <button class="btn-ghost" id="editMovieCancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('editMovieModal');
    const closeModal = () => modal.remove();

    modal.querySelector('#editMovieClose').addEventListener('click', closeModal);
    modal.querySelector('#editMovieCancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // Today buttons
    modal.querySelector('#editMovieStartToday').addEventListener('click', () => {
      modal.querySelector('#editMovieStartDate').value = today;
    });
    modal.querySelector('#editMovieEndToday').addEventListener('click', () => {
      modal.querySelector('#editMovieEndDate').value = today;
    });

    // Rewatch
    modal.querySelector('#editMovieRewatch').addEventListener('click', () => {
      const currentStart = stored.startDate || '';
      const currentEnd = stored.endDate || '';
      const history = stored.rewatchHistory || [];
      history.push({ startDate: currentStart, endDate: currentEnd });
      const newCount = (stored.rewatchCount || 0) + 1;

      Store.updateMovie(tmdbId, {
        rewatchCount: newCount,
        rewatchHistory: history,
        startDate: '',
        endDate: '',
        watchStatus: 'watching',
      });
      Store.addActivity({
        tmdbId: stored.tmdbId, title: stored.title, type: 'movie',
        posterPath: stored.posterPath, action: 'rewatch',
        detail: `Started rewatch #${newCount}`,
        timestamp: new Date().toISOString(),
      });
      App.refreshCounts();
      toast(`Rewatch #${newCount} started!`);
      closeModal();
      this.openDetail(tmdbId);
    });

    // Save
    modal.querySelector('#editMovieSave').addEventListener('click', () => {
      const newStatus = modal.querySelector('#editMovieStatus').value;
      const newStart = modal.querySelector('#editMovieStartDate').value;
      const newEnd = modal.querySelector('#editMovieEndDate').value;

      const oldStatus = stored.watchStatus;
      Store.updateMovie(tmdbId, {
        watchStatus: newStatus,
        startDate: newStart,
        endDate: newEnd,
      });

      if (oldStatus !== newStatus) {
        const sl = { watching: 'Watching', plan_to_watch: 'Plan to Watch', completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped' };
        Store.addActivity({
          tmdbId: stored.tmdbId, title: stored.title, type: 'movie',
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
};
