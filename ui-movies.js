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
    const page = document.getElementById('page-movie-detail');
    page.innerHTML = '<div style="padding:40px;color:var(--text-3)">Loading...</div>';
    App.showPage('movie-detail');

    let details;
    try {
      details = await TMDB.movieDetails(tmdbId);
    } catch (e) {
      page.innerHTML = `<div style="padding:40px;color:var(--dropped)">Failed to load details. ${e.message}</div>`;
      return;
    }

    const stored = Store.getMovie(tmdbId);
    const isInList = !!stored;

    const backdrop = TMDB.backdrop(details.backdrop_path);
    const poster = TMDB.poster(details.poster_path, 'w500');
    const year = (details.release_date || '').substring(0, 4);
    const genres = (details.genres || []).map(g => g.name);
    const runtime = details.runtime || 0;
    const hours = Math.floor(runtime / 60);
    const mins = runtime % 60;
    const runtimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    const budget = details.budget ? `$${(details.budget / 1_000_000).toFixed(1)}M` : '—';
    const revenue = details.revenue ? `$${(details.revenue / 1_000_000).toFixed(1)}M` : '—';
    const directors = (details.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
    const cast = (details.credits?.cast || []).slice(0, 12);
    const trailer = (details.videos?.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
    const recommendations = (details.recommendations?.results || []).slice(0, 6);
    const countries = (details.production_countries || []).map(c => c.name);
    const languages = (details.spoken_languages || []).map(l => l.english_name);
    const companies = (details.production_companies || []).slice(0, 5);

    const watchStatus = stored?.watchStatus || 'plan_to_watch';
    const rewatchCount = stored?.rewatchCount || 0;
    const startDate = stored?.startDate || '';
    const endDate = stored?.endDate || '';

    const statusLabels = {
      watching: 'Watching', plan_to_watch: 'Plan to Watch',
      completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped'
    };

    page.innerHTML = `
      <button class="btn-back" id="movieBackBtn">← Back</button>

      <div class="detail-backdrop">
        ${backdrop ? `<img src="${backdrop}" alt="">` : '<div style="height:100%;background:var(--bg-2)"></div>'}
        <div class="detail-backdrop-grad"></div>
      </div>

      <div class="detail-hero">
        <div class="detail-poster-wrap">
          ${poster ? `<img src="${poster}" alt="">` : '<div class="no-poster-ph" style="width:200px;height:300px;border-radius:12px;">🎬</div>'}
        </div>
        <div class="detail-hero-info">
          <h1>${esc(details.title)}</h1>
          ${details.tagline ? `<div class="detail-tagline">"${esc(details.tagline)}"</div>` : ''}
          <div class="detail-chips">
            ${genres.map(g => `<span class="detail-chip">${esc(g)}</span>`).join('')}
            ${year ? `<span class="detail-chip">${year}</span>` : ''}
            ${runtimeStr !== '0m' ? `<span class="detail-chip">${runtimeStr}</span>` : ''}
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
            ${rewatchCount > 0 ? `
              <div class="detail-stat">
                <div class="detail-stat-val">${rewatchCount}</div>
                <div class="detail-stat-label">Rewatches</div>
              </div>` : ''}
          </div>

          <div class="detail-actions">
            ${isInList ? `
              <span class="detail-status-badge badge-${watchStatus}">${statusLabels[watchStatus]}</span>
              <button class="btn-accent" id="movieEditBtn">✏ Edit</button>
              <button class="btn-danger" id="movieRemoveBtn">Remove</button>
            ` : `
              <button class="btn-accent" id="movieAddBtn">+ Add to List</button>
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

        <div class="detail-section">
          <h3>Details</h3>
          <div class="detail-info-grid">
            ${directors.length ? `<div class="info-cell"><div class="info-cell-label">Director</div><div class="info-cell-value">${esc(directors.join(', '))}</div></div>` : ''}
            <div class="info-cell"><div class="info-cell-label">Release Date</div><div class="info-cell-value">${details.release_date || '—'}</div></div>
            <div class="info-cell"><div class="info-cell-label">Status</div><div class="info-cell-value">${details.status || '—'}</div></div>
            <div class="info-cell"><div class="info-cell-label">Original Language</div><div class="info-cell-value">${(details.original_language || '').toUpperCase()}</div></div>
            ${languages.length ? `<div class="info-cell"><div class="info-cell-label">Languages</div><div class="info-cell-value">${esc(languages.join(', '))}</div></div>` : ''}
            ${countries.length ? `<div class="info-cell"><div class="info-cell-label">Countries</div><div class="info-cell-value">${esc(countries.join(', '))}</div></div>` : ''}
            <div class="info-cell"><div class="info-cell-label">Budget</div><div class="info-cell-value">${budget}</div></div>
            <div class="info-cell"><div class="info-cell-label">Revenue</div><div class="info-cell-value">${revenue}</div></div>
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
                return `<div class="grid-card" data-tmdb="${r.id}" data-rectype="movie" style="flex-shrink:0;width:130px;">
                  <div class="poster-wrap" style="aspect-ratio:2/3;">
                    ${rPoster ? `<img src="${rPoster}" loading="lazy">` : '<div class="no-poster-ph">🎬</div>'}
                    <div class="poster-overlay"></div>
                  </div>
                  <div class="grid-card-info">
                    <div class="grid-card-title">${esc(r.title || r.name)}</div>
                    <div class="grid-card-meta"><span>${(r.release_date || '').substring(0,4)}</span></div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}
      </div>
    `;

    // ─── Bind events ───
    page.querySelector('#movieBackBtn').addEventListener('click', () => App.showPage('movies'));

    // Add to list
    const addBtn = page.querySelector('#movieAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const item = {
          tmdbId: details.id,
          title: details.title,
          posterPath: details.poster_path,
          backdropPath: details.backdrop_path,
          year: parseInt(year) || 0,
          voteAverage: details.vote_average || 0,
          runtime: runtime,
          genres: genres,
          watchStatus: 'plan_to_watch',
          rewatchCount: 0,
          rewatchHistory: [],
          startDate: '',
          endDate: '',
          dateAdded: new Date().toISOString(),
          dateUpdated: new Date().toISOString(),
        };
        Store.addMovie(item);
        Store.addActivity({
          tmdbId: details.id, title: details.title, type: 'movie',
          posterPath: details.poster_path, action: 'added',
          detail: 'Added to list as Plan to Watch',
          timestamp: new Date().toISOString(),
        });
        App.refreshCounts();
        toast(`Added "${details.title}" to your movies`);
        this.openDetail(tmdbId);
      });
    }

    // Edit button
    const editBtn = page.querySelector('#movieEditBtn');
    if (editBtn) {
      editBtn.addEventListener('click', () => this._openEditModal(tmdbId, details));
    }

    // Remove
    const removeBtn = page.querySelector('#movieRemoveBtn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        if (confirm(`Remove "${details.title}" from your list?`)) {
          Store.removeMovie(tmdbId);
          Store.addActivity({
            tmdbId: details.id, title: details.title, type: 'movie',
            posterPath: details.poster_path, action: 'removed',
            detail: 'Removed from list',
            timestamp: new Date().toISOString(),
          });
          App.refreshCounts();
          toast('Removed from list');
          App.showPage('movies');
        }
      });
    }

    // Recommended clicks
    page.querySelectorAll('[data-rectype="movie"]').forEach(card => {
      card.addEventListener('click', () => this.openDetail(parseInt(card.dataset.tmdb)));
    });
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
