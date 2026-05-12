/* ═══════════════════════════════════════════
   UI — Diary (Comprehensive Watch Journal)
   Three views: Timeline Feed, Calendar, Heatmap
   Manual entry logging, notes, ratings, search
   ═══════════════════════════════════════════ */

const DiaryUI = {
  _currentMonth: new Date().getMonth(),
  _currentYear: new Date().getFullYear(),
  _currentView: 'timeline', // 'timeline' | 'calendar' | 'heatmap'
  _filter: 'all', // 'all' | 'movie' | 'tv'
  _searchQuery: '',

  render() {
    const page = document.getElementById('page-diary');
    page.innerHTML = `
      <div class="diary-container">
        <div class="page-header">
          <h1>Diary</h1>
          <div class="diary-header-actions">
            <button class="btn-accent diary-add-entry-btn" id="diaryAddEntry">+ Log Entry</button>
          </div>
        </div>

        <!-- View Switcher + Filters -->
        <div class="diary-toolbar">
          <div class="diary-view-switcher">
            <button class="diary-view-btn ${this._currentView === 'timeline' ? 'active' : ''}" data-view="timeline">
              <span class="dvb-icon">≡</span> Timeline
            </button>
            <button class="diary-view-btn ${this._currentView === 'calendar' ? 'active' : ''}" data-view="calendar">
              <span class="dvb-icon">▦</span> Calendar
            </button>
            <button class="diary-view-btn ${this._currentView === 'heatmap' ? 'active' : ''}" data-view="heatmap">
              <span class="dvb-icon">▥</span> Heatmap
            </button>
          </div>
          <div class="diary-filters">
            <div class="diary-type-filters">
              <button class="diary-type-btn ${this._filter === 'all' ? 'active' : ''}" data-filter="all">All</button>
              <button class="diary-type-btn ${this._filter === 'movie' ? 'active' : ''}" data-filter="movie">Movies</button>
              <button class="diary-type-btn ${this._filter === 'tv' ? 'active' : ''}" data-filter="tv">TV Shows</button>
            </div>
            <div class="diary-search-wrap">
              <input type="text" class="diary-search-input" id="diarySearch" placeholder="Search diary..." value="${esc(this._searchQuery)}">
            </div>
          </div>
        </div>

        <!-- Stats Summary Bar -->
        <div class="diary-stats-bar" id="diaryStatsBar"></div>

        <!-- View Container -->
        <div id="diaryViewContainer"></div>
      </div>
    `;

    // Bind toolbar events
    page.querySelectorAll('.diary-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._currentView = btn.dataset.view;
        this.render();
      });
    });

    page.querySelectorAll('.diary-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._filter = btn.dataset.filter;
        this.render();
      });
    });

    const searchInput = page.querySelector('#diarySearch');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this._searchQuery = searchInput.value.trim().toLowerCase();
        this._renderCurrentView();
      }, 200);
    });

    page.querySelector('#diaryAddEntry').addEventListener('click', () => {
      this._openAddEntryModal();
    });

    this._renderStatsBar();
    this._renderCurrentView();
  },

  // ─── Get All Diary Entries ───
  _getAllEntries() {
    const diary = Store.getDiary();
    const movies = Store.getMovies();
    const tvshows = Store.getTvShows();
    let entries = [...diary];

    // Also include legacy endDate-based entries not already in diary
    const diaryKeys = new Set(diary.map(d => `${d.tmdbId}-${d.date}-${d.type}`));

    movies.forEach(m => {
      if (m.endDate) {
        const key = `${m.tmdbId}-${m.endDate}-movie`;
        if (!diaryKeys.has(key)) {
          entries.push({
            tmdbId: m.tmdbId, title: m.title, type: 'movie',
            posterPath: m.posterPath, date: m.endDate,
            action: 'completed', notes: '', rating: null, mood: null,
            episodes: null, timestamp: m.endDate + 'T23:59:59.000Z',
          });
        }
      }
      (m.rewatchHistory || []).forEach((rw, idx) => {
        if (rw.endDate) {
          entries.push({
            tmdbId: m.tmdbId, title: m.title, type: 'movie',
            posterPath: m.posterPath, date: rw.endDate,
            action: 'rewatch', notes: '', rating: null, mood: null,
            episodes: null, rewatchNum: idx + 1,
            timestamp: rw.endDate + 'T23:59:59.000Z',
          });
        }
      });
    });

    tvshows.forEach(t => {
      if (t.endDate) {
        const key = `${t.tmdbId}-${t.endDate}-tv`;
        if (!diaryKeys.has(key)) {
          entries.push({
            tmdbId: t.tmdbId, title: t.title, type: 'tv',
            posterPath: t.posterPath, date: t.endDate,
            action: 'completed', notes: '', rating: null, mood: null,
            episodes: null, timestamp: t.endDate + 'T23:59:59.000Z',
          });
        }
      }
      (t.rewatchHistory || []).forEach((rw, idx) => {
        if (rw.endDate) {
          entries.push({
            tmdbId: t.tmdbId, title: t.title, type: 'tv',
            posterPath: t.posterPath, date: rw.endDate,
            action: 'rewatch', notes: '', rating: null, mood: null,
            episodes: null, rewatchNum: idx + 1,
            timestamp: rw.endDate + 'T23:59:59.000Z',
          });
        }
      });
    });

    // Apply filters
    if (this._filter !== 'all') {
      entries = entries.filter(e => e.type === this._filter);
    }
    if (this._searchQuery) {
      entries = entries.filter(e =>
        (e.title || '').toLowerCase().includes(this._searchQuery) ||
        (e.notes || '').toLowerCase().includes(this._searchQuery)
      );
    }

    // Sort by date descending
    entries.sort((a, b) => {
      const da = a.date || a.timestamp || '';
      const db = b.date || b.timestamp || '';
      return db.localeCompare(da);
    });

    return entries;
  },

  // ─── Stats Bar ───
  _renderStatsBar() {
    const entries = this._getAllEntries();
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - now.getDay());
    const weekStr = thisWeekStart.toISOString().substring(0, 10);

    const monthEntries = entries.filter(e => (e.date || '').startsWith(thisMonth));
    const weekEntries = entries.filter(e => (e.date || '') >= weekStr);
    const movieCount = entries.filter(e => e.type === 'movie').length;
    const tvCount = entries.filter(e => e.type === 'tv').length;
    const rated = entries.filter(e => e.rating);
    const avgRating = rated.length > 0 ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : 0;

    const bar = document.getElementById('diaryStatsBar');
    bar.innerHTML = `
      <div class="diary-stat-chip">
        <span class="dsc-num">${entries.length}</span>
        <span class="dsc-label">Total Entries</span>
      </div>
      <div class="diary-stat-chip">
        <span class="dsc-num">${monthEntries.length}</span>
        <span class="dsc-label">This Month</span>
      </div>
      <div class="diary-stat-chip">
        <span class="dsc-num">${weekEntries.length}</span>
        <span class="dsc-label">This Week</span>
      </div>
      <div class="diary-stat-chip">
        <span class="dsc-num">${movieCount}</span>
        <span class="dsc-label">Movies</span>
      </div>
      <div class="diary-stat-chip">
        <span class="dsc-num">${tvCount}</span>
        <span class="dsc-label">TV Shows</span>
      </div>
      ${avgRating > 0 ? `
        <div class="diary-stat-chip">
          <span class="dsc-num dsc-gold">★ ${avgRating.toFixed(1)}</span>
          <span class="dsc-label">Avg Rating</span>
        </div>` : ''}
    `;
  },

  _renderCurrentView() {
    const container = document.getElementById('diaryViewContainer');
    if (!container) return;
    if (this._currentView === 'timeline') this._renderTimeline(container);
    else if (this._currentView === 'calendar') this._renderCalendar(container);
    else if (this._currentView === 'heatmap') this._renderHeatmap(container);
  },

  // ═══════════════════════════════════════════
  // TIMELINE VIEW (Letterboxd-style feed)
  // ═══════════════════════════════════════════
  _renderTimeline(container) {
    const entries = this._getAllEntries();

    if (entries.length === 0) {
      container.innerHTML = `
        <div class="diary-empty">
          <div class="diary-empty-icon" style="font-size:32px;color:var(--text-3);">Diary</div>
          <h3>No diary entries yet</h3>
          <p>Log your first watch session with the <strong>+ Log Entry</strong> button, or entries will appear here as you complete movies and TV shows.</p>
        </div>`;
      return;
    }

    // Group by date
    const grouped = {};
    entries.forEach(e => {
      const date = e.date || 'Unknown';
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(e);
    });

    const moodEmojis = { loved: '❤️', great: '🔥', good: '👍', meh: '😐', bad: '👎' };
    const actionLabels = {
      completed: 'Completed', rewatch: 'Rewatched', watched: 'Watched',
      watched_episodes: 'Watched episodes', started: 'Started', session: 'Watch session'
    };

    let html = '<div class="diary-timeline">';

    Object.keys(grouped).forEach(date => {
      const dateObj = new Date(date + 'T12:00:00');
      const isValid = !isNaN(dateObj.getTime());
      const dayName = isValid ? dateObj.toLocaleDateString('en-US', { weekday: 'short' }) : '';
      const dayNum = isValid ? dateObj.getDate() : '?';
      const monthShort = isValid ? dateObj.toLocaleDateString('en-US', { month: 'short' }) : '';
      const yearNum = isValid ? dateObj.getFullYear() : '';

      html += `
        <div class="tl-day-group">
          <div class="tl-day-marker">
            <div class="tl-day-num">${dayNum}</div>
            <div class="tl-day-month">${monthShort} ${yearNum}</div>
            <div class="tl-day-name">${dayName}</div>
          </div>
          <div class="tl-day-entries">`;

      grouped[date].forEach(e => {
        const poster = TMDB.poster(e.posterPath, 'w185');
        const action = actionLabels[e.action] || e.action || 'Logged';
        const mood = e.mood ? (moodEmojis[e.mood] || '') : '';
        const typeIcon = e.type === 'movie' ? '🎬' : '📺';
        const ratingStars = e.rating ? '★'.repeat(Math.round(e.rating / 2)) + '☆'.repeat(5 - Math.round(e.rating / 2)) : '';

        html += `
          <div class="tl-entry" data-tmdb="${e.tmdbId}" data-type="${e.type}">
            <div class="tl-entry-poster">
              ${poster ? `<img src="${poster}" loading="lazy">` : `<div class="tl-entry-poster-ph">${typeIcon}</div>`}
            </div>
            <div class="tl-entry-body">
              <div class="tl-entry-header">
                <span class="tl-entry-title">${esc(e.title)}</span>
                <span class="tl-entry-type-badge tl-type-${e.type}">${e.type === 'movie' ? 'Movie' : 'TV'}</span>
              </div>
              <div class="tl-entry-action">
                <span class="tl-action-label">${action}</span>
                ${e.rewatchNum ? `<span class="tl-rewatch-badge">↻ #${e.rewatchNum}</span>` : ''}
                ${e.episodes ? `<span class="tl-episodes-badge">${esc(e.episodes)}</span>` : ''}
                ${mood ? `<span class="tl-mood">${mood}</span>` : ''}
              </div>
              ${ratingStars ? `<div class="tl-entry-rating">${ratingStars} <span class="tl-rating-num">${e.rating}/10</span></div>` : ''}
              ${e.notes ? `<div class="tl-entry-notes">${esc(e.notes)}</div>` : ''}
            </div>
            <div class="tl-entry-btns">
              <button class="tl-btn tl-btn-edit" data-tmdb="${e.tmdbId}" data-type="${e.type}" data-ts="${e.timestamp || ''}">Edit</button>
              <button class="tl-btn tl-btn-del" data-tmdb="${e.tmdbId}" data-ts="${e.timestamp || ''}">Remove</button>
            </div>
          </div>`;
      });

      html += `</div></div>`;
    });

    html += '</div>';
    container.innerHTML = html;

    // Bind clicks
    container.querySelectorAll('.tl-entry').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.tl-btn-del') || ev.target.closest('.tl-btn-edit')) return;
        DetailUI.open(parseInt(el.dataset.tmdb), el.dataset.type);
      });
    });

    container.querySelectorAll('.tl-btn-edit').forEach(btn => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); this._editEntryModal(btn.dataset.ts); });
    });

    container.querySelectorAll('.tl-btn-del').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const tmdbId = parseInt(btn.dataset.tmdb);
        const ts = btn.dataset.ts;
        if (confirm('Remove this diary entry?')) {
          Store.removeDiaryEntry(tmdbId, ts);
          this._renderStatsBar();
          this._renderCurrentView();
          toast('Entry removed');
        }
      });
    });
  },

  // ═══════════════════════════════════════════
  // CALENDAR VIEW
  // ═══════════════════════════════════════════
  _renderCalendar(container) {
    const year = this._currentYear;
    const month = this._currentMonth;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const entries = this._getAllEntries();
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthEntries = entries.filter(e => (e.date || '').startsWith(prefix));

    const byDay = {};
    monthEntries.forEach(e => {
      const day = parseInt((e.date || '').substring(8, 10));
      if (!isNaN(day)) {
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(e);
      }
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    const monthMovies = monthEntries.filter(e => e.type === 'movie').length;
    const monthTv = monthEntries.filter(e => e.type === 'tv').length;

    let html = `
      <div class="diary-cal-wrap">
        <div class="diary-cal-nav">
          <button class="btn-ghost diary-nav-btn" id="diaryPrev">←</button>
          <div class="diary-cal-nav-center">
            <h2 id="diaryMonthLabel">${monthNames[month]} ${year}</h2>
            <span class="diary-cal-nav-sub">${monthEntries.length} entries · ${monthMovies} movies · ${monthTv} TV</span>
          </div>
          <button class="btn-ghost diary-nav-btn" id="diaryNext">→</button>
        </div>
        <div class="diary-calendar">
          <div class="cal-header-row">`;

    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
      html += `<div class="cal-header-cell">${d}</div>`;
    });
    html += '</div><div class="cal-grid">';

    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-cell cal-empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dayEntries = byDay[d] || [];
      const hasEntries = dayEntries.length > 0;
      const isToday = isCurrentMonth && today.getDate() === d;
      const todayClass = isToday ? 'cal-today' : '';
      const activeClass = hasEntries ? 'cal-has-entries' : '';

      html += `<div class="cal-cell ${todayClass} ${activeClass}" data-day="${d}">
        <div class="cal-day-num">${d}</div>
        ${hasEntries ? `
          <div class="cal-entries-preview">
            ${dayEntries.slice(0, 3).map(e => {
              const poster = TMDB.poster(e.posterPath, 'w92');
              return poster
                ? `<img class="cal-entry-thumb" src="${poster}" title="${esc(e.title)}">`
                : `<div class="cal-entry-thumb cal-entry-thumb-ph">${e.type === 'movie' ? '🎬' : '📺'}</div>`;
            }).join('')}
            ${dayEntries.length > 3 ? `<span class="cal-more">+${dayEntries.length - 3}</span>` : ''}
          </div>
          <div class="cal-entry-count">${dayEntries.length}</div>
        ` : ''}
      </div>`;
    }

    html += '</div></div></div>';
    html += '<div id="diaryDayDetail" class="diary-day-detail"></div>';

    container.innerHTML = html;

    container.querySelector('#diaryPrev').addEventListener('click', () => {
      this._currentMonth--;
      if (this._currentMonth < 0) { this._currentMonth = 11; this._currentYear--; }
      this._renderCurrentView();
    });
    container.querySelector('#diaryNext').addEventListener('click', () => {
      this._currentMonth++;
      if (this._currentMonth > 11) { this._currentMonth = 0; this._currentYear++; }
      this._renderCurrentView();
    });

    container.querySelectorAll('.cal-has-entries').forEach(cell => {
      cell.addEventListener('click', () => {
        const day = parseInt(cell.dataset.day);
        this._showDayDetail(container, day, byDay[day] || []);
      });
    });
  },

  _showDayDetail(container, day, entries) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const dateStr = `${monthNames[this._currentMonth]} ${day}, ${this._currentYear}`;
    const moodEmojis = { loved: '❤️', great: '🔥', good: '👍', meh: '😐', bad: '👎' };

    const detail = container.querySelector('#diaryDayDetail');
    detail.innerHTML = `
      <div class="diary-day-detail-inner">
        <h3>${dateStr}</h3>
        <span class="diary-day-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>
        <div class="diary-day-list">
          ${entries.map(e => {
            const poster = TMDB.poster(e.posterPath, 'w92');
            const mood = e.mood ? (moodEmojis[e.mood] || '') : '';
            return `
              <div class="diary-day-item" data-tmdb="${e.tmdbId}" data-type="${e.type}">
                ${poster ? `<img src="${poster}">` : `<div class="no-poster-ph" style="width:44px;height:66px;border-radius:6px;font-size:16px;">${e.type === 'movie' ? '🎬' : '📺'}</div>`}
                <div class="diary-day-item-info">
                  <div class="diary-day-item-title">${esc(e.title)}</div>
                  <div class="diary-day-item-meta">
                    ${e.type === 'movie' ? 'Movie' : 'TV Show'}
                    ${e.rewatchNum ? ` · Rewatch #${e.rewatchNum}` : ''}
                    ${e.rating ? ` · ★ ${e.rating}/10` : ''}
                    ${mood ? ` · ${mood}` : ''}
                  </div>
                  ${e.notes ? `<div class="diary-day-item-notes">${esc(e.notes)}</div>` : ''}
                </div>
                <div class="diary-day-item-actions">
                  ${e.timestamp ? `<button class="ddi-btn ddi-edit" data-ts="${e.timestamp}">Edit</button>` : ''}
                  ${e.timestamp ? `<button class="ddi-btn ddi-del" data-tmdb="${e.tmdbId}" data-ts="${e.timestamp}">Remove</button>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;

    detail.querySelectorAll('.diary-day-item').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.ddi-edit') || ev.target.closest('.ddi-del')) return;
        DetailUI.open(parseInt(el.dataset.tmdb), el.dataset.type);
      });
    });
    detail.querySelectorAll('.ddi-edit').forEach(btn => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); this._editEntryModal(btn.dataset.ts); });
    });
    detail.querySelectorAll('.ddi-del').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm('Remove this entry?')) {
          Store.removeDiaryEntry(parseInt(btn.dataset.tmdb), btn.dataset.ts);
          this._renderStatsBar(); this._renderCurrentView(); toast('Removed');
        }
      });
    });
  },

  // ═══════════════════════════════════════════
  // HEATMAP VIEW (GitHub-style year grid)
  // ═══════════════════════════════════════════
  _renderHeatmap(container) {
    const entries = this._getAllEntries();
    const now = new Date();
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    yearAgo.setDate(yearAgo.getDate() + 1);
    const yearAgoStr = yearAgo.toISOString().substring(0, 10);

    // Count entries per day
    const countByDate = {};
    entries.forEach(e => {
      const d = e.date;
      if (d) {
        countByDate[d] = (countByDate[d] || 0) + 1;
      }
    });

    // Build weeks grid
    const startDate = new Date(yearAgo);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const weeks = [];
    const cursor = new Date(startDate);
    for (let w = 0; w < 53; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = cursor.toISOString().substring(0, 10);
        const count = countByDate[dateStr] || 0;
        const isInRange = cursor >= yearAgo && cursor <= now;
        week.push({ date: dateStr, count, isInRange });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }

    // Month labels
    const monthLabels = [];
    let lastMonth = -1;
    weeks.forEach((week, wIdx) => {
      const firstDay = new Date(week[0].date + 'T12:00:00');
      const m = firstDay.getMonth();
      if (m !== lastMonth) {
        monthLabels.push({ weekIdx: wIdx, label: firstDay.toLocaleDateString('en-US', { month: 'short' }) });
        lastMonth = m;
      }
    });

    // Streaks
    let currentStreak = 0;
    const checkDate = new Date(now);
    while (true) {
      const ds = checkDate.toISOString().substring(0, 10);
      if (countByDate[ds]) { currentStreak++; checkDate.setDate(checkDate.getDate() - 1); }
      else break;
    }

    const allDates = Object.keys(countByDate).sort();
    let longestStreak = 0;
    let tempStreak = allDates.length > 0 ? 1 : 0;
    longestStreak = tempStreak;
    for (let i = 1; i < allDates.length; i++) {
      const prev = new Date(allDates[i - 1] + 'T12:00:00');
      const curr = new Date(allDates[i] + 'T12:00:00');
      const diffDays = Math.round((curr - prev) / (86400000));
      if (diffDays === 1) { tempStreak++; if (tempStreak > longestStreak) longestStreak = tempStreak; }
      else tempStreak = 1;
    }

    const totalDaysWatched = Object.keys(countByDate).filter(d => d >= yearAgoStr).length;
    const totalEntries = entries.filter(e => e.date && e.date >= yearAgoStr).length;

    function levelClass(count) {
      if (count === 0) return 'hm-level-0';
      if (count === 1) return 'hm-level-1';
      if (count === 2) return 'hm-level-2';
      if (count <= 4) return 'hm-level-3';
      return 'hm-level-4';
    }

    let html = `
      <div class="diary-heatmap-wrap">
        <div class="hm-stats-row">
          <div class="hm-stat">
            <span class="hm-stat-num">${totalEntries}</span>
            <span class="hm-stat-label">entries this year</span>
          </div>
          <div class="hm-stat">
            <span class="hm-stat-num">${totalDaysWatched}</span>
            <span class="hm-stat-label">days watched</span>
          </div>
          <div class="hm-stat">
            <span class="hm-stat-num">${currentStreak}</span>
            <span class="hm-stat-label">current streak</span>
          </div>
          <div class="hm-stat">
            <span class="hm-stat-num">${longestStreak}</span>
            <span class="hm-stat-label">longest streak</span>
          </div>
        </div>

        <div class="hm-grid-container">
          <div class="hm-month-labels">
            ${monthLabels.map(ml => `<span class="hm-month-label" style="left:${ml.weekIdx * 16}px">${ml.label}</span>`).join('')}
          </div>
          <div class="hm-grid-scroll">
            <div class="hm-day-labels">
              <span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span>
            </div>
            <div class="hm-weeks">
              ${weeks.map(week => `
                <div class="hm-week">
                  ${week.map(day => {
                    if (!day.isInRange) return '<div class="hm-cell hm-cell-empty"></div>';
                    return `<div class="hm-cell ${levelClass(day.count)}" data-date="${day.date}" data-count="${day.count}" title="${day.date}: ${day.count} ${day.count === 1 ? 'entry' : 'entries'}"></div>`;
                  }).join('')}
                </div>
              `).join('')}
            </div>
          </div>
          <div class="hm-legend">
            <span class="hm-legend-label">Less</span>
            <div class="hm-cell hm-level-0"></div>
            <div class="hm-cell hm-level-1"></div>
            <div class="hm-cell hm-level-2"></div>
            <div class="hm-cell hm-level-3"></div>
            <div class="hm-cell hm-level-4"></div>
            <span class="hm-legend-label">More</span>
          </div>
        </div>

        <div id="heatmapDayDetail" class="diary-day-detail"></div>
      </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('.hm-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const date = cell.dataset.date;
        const count = parseInt(cell.dataset.count);
        if (count === 0) return;

        container.querySelectorAll('.hm-cell').forEach(c => c.classList.remove('hm-selected'));
        cell.classList.add('hm-selected');

        const dayEntries = entries.filter(e => e.date === date);
        const dateObj = new Date(date + 'T12:00:00');
        const formatted = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        this._showHeatmapDayDetail(container, formatted, dayEntries);
      });
    });
  },

  _showHeatmapDayDetail(container, dateStr, entries) {
    const detail = container.querySelector('#heatmapDayDetail');
    const moodEmojis = { loved: '❤️', great: '🔥', good: '👍', meh: '😐', bad: '👎' };

    detail.innerHTML = `
      <div class="diary-day-detail-inner">
        <h3>${dateStr}</h3>
        <span class="diary-day-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>
        <div class="diary-day-list">
          ${entries.map(e => {
            const poster = TMDB.poster(e.posterPath, 'w92');
            const mood = e.mood ? (moodEmojis[e.mood] || '') : '';
            return `
              <div class="diary-day-item" data-tmdb="${e.tmdbId}" data-type="${e.type}">
                ${poster ? `<img src="${poster}">` : `<div class="no-poster-ph" style="width:44px;height:66px;border-radius:6px;font-size:16px;">${e.type === 'movie' ? '🎬' : '📺'}</div>`}
                <div class="diary-day-item-info">
                  <div class="diary-day-item-title">${esc(e.title)}</div>
                  <div class="diary-day-item-meta">
                    ${e.type === 'movie' ? 'Movie' : 'TV Show'}
                    ${e.rating ? ` · ★ ${e.rating}/10` : ''}
                    ${mood ? ` · ${mood}` : ''}
                  </div>
                  ${e.notes ? `<div class="diary-day-item-notes">${esc(e.notes)}</div>` : ''}
                </div>
                <div class="diary-day-item-actions">
                  ${e.timestamp ? `<button class="diary-day-edit-btn" data-ts="${e.timestamp}">Edit</button>` : ''}
                  ${e.timestamp ? `<button class="diary-day-del-btn" data-tmdb="${e.tmdbId}" data-ts="${e.timestamp}">Remove</button>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;

    detail.querySelectorAll('.diary-day-item').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.diary-day-edit-btn') || ev.target.closest('.diary-day-del-btn')) return;
        DetailUI.open(parseInt(el.dataset.tmdb), el.dataset.type);
      });
    });
    detail.querySelectorAll('.diary-day-edit-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); this._editEntryModal(btn.dataset.ts); });
    });
    detail.querySelectorAll('.diary-day-del-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm('Remove this entry?')) {
          Store.removeDiaryEntry(parseInt(btn.dataset.tmdb), btn.dataset.ts);
          this._renderStatsBar(); this._renderCurrentView(); toast('Removed');
        }
      });
    });
  },

  // ═══════════════════════════════════════════
  // ADD ENTRY MODAL
  // ═══════════════════════════════════════════
  _openAddEntryModal() {
    const today = new Date().toISOString().substring(0, 10);
    const movies = Store.getMovies();
    const tvshows = Store.getTvShows();
    const allItems = [
      ...movies.map(m => ({ tmdbId: m.tmdbId, title: m.title, type: 'movie', posterPath: m.posterPath })),
      ...tvshows.map(t => ({ tmdbId: t.tmdbId, title: t.title, type: 'tv', posterPath: t.posterPath })),
    ].sort((a, b) => a.title.localeCompare(b.title));

    const optionsHtml = allItems.map(i =>
      `<option value="${i.type}:${i.tmdbId}">${esc(i.title)} (${i.type === 'movie' ? 'Movie' : 'TV'})</option>`
    ).join('');

    const modalHtml = `
      <div class="modal-backdrop edit-modal-backdrop" id="diaryEntryModal">
        <div class="modal-box edit-modal-box">
          <div class="modal-header">
            <h2>Log Watch Session</h2>
            <button class="modal-close-btn" id="diaryEntryClose">✕</button>
          </div>
          <div class="modal-body">
            <div class="edit-field">
              <div class="edit-field-label">Title</div>
              ${allItems.length > 0 ? `
                <select class="status-select edit-full-select" id="diaryEntryTitle">
                  <option value="">Select from your list...</option>
                  ${optionsHtml}
                </select>
              ` : `<p class="edit-field-hint">Add some movies or TV shows to your list first.</p>`}
            </div>

            <div class="edit-field">
              <div class="edit-field-label">Date</div>
              <div class="edit-date-input-row">
                <input type="date" id="diaryEntryDate" value="${today}" class="edit-date-input">
                <button class="btn-today" id="diaryEntryToday">Today</button>
              </div>
            </div>

            <div class="edit-field">
              <div class="edit-field-label">Action</div>
              <select class="status-select edit-full-select" id="diaryEntryAction">
                <option value="watched">Watched</option>
                <option value="rewatch">Rewatched</option>
              </select>
            </div>

            <div class="edit-field">
              <div class="edit-field-label">Rating</div>
              <select class="status-select edit-full-select" id="diaryEntryRating">
                <option value="0">— No rating —</option>
                ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">★ ${n}/10</option>`).join('')}
              </select>
            </div>

            <div class="edit-field">
              <div class="edit-field-label">Mood</div>
              <div class="diary-mood-row" id="diaryMoodRow">
                <button class="diary-mood-btn" data-mood="loved">❤️ Loved</button>
                <button class="diary-mood-btn" data-mood="great">🔥 Great</button>
                <button class="diary-mood-btn" data-mood="good">👍 Good</button>
                <button class="diary-mood-btn" data-mood="meh">😐 Meh</button>
                <button class="diary-mood-btn" data-mood="bad">👎 Bad</button>
              </div>
            </div>

            <div class="edit-field">
              <div class="edit-field-label">Notes</div>
              <textarea class="diary-notes-input" id="diaryEntryNotes" rows="3" placeholder="Thoughts, reactions, memorable scenes..."></textarea>
            </div>

            <hr>
            <div class="edit-actions">
              <button class="btn-accent" id="diaryEntrySave">Save Entry</button>
              <button class="btn-ghost" id="diaryEntryCancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('diaryEntryModal');
    const closeModal = () => modal.remove();

    modal.querySelector('#diaryEntryClose').addEventListener('click', closeModal);
    modal.querySelector('#diaryEntryCancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#diaryEntryToday').addEventListener('click', () => {
      modal.querySelector('#diaryEntryDate').value = today;
    });

    // Mood selection
    let selectedMood = '';
    modal.querySelectorAll('.diary-mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (selectedMood === btn.dataset.mood) {
          selectedMood = '';
          btn.classList.remove('active');
        } else {
          selectedMood = btn.dataset.mood;
          modal.querySelectorAll('.diary-mood-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // Save
    modal.querySelector('#diaryEntrySave').addEventListener('click', () => {
      const titleVal = modal.querySelector('#diaryEntryTitle')?.value;
      if (!titleVal) { toast('Please select a title'); return; }

      const [type, tmdbIdStr] = titleVal.split(':');
      const tmdbId = parseInt(tmdbIdStr);
      const item = allItems.find(i => i.tmdbId === tmdbId && i.type === type);
      if (!item) { toast('Invalid selection'); return; }

      const date = modal.querySelector('#diaryEntryDate').value;
      if (!date) { toast('Please select a date'); return; }

      const action = modal.querySelector('#diaryEntryAction').value;
      const notes = modal.querySelector('#diaryEntryNotes').value.trim();

      const entry = {
        tmdbId: item.tmdbId,
        title: item.title,
        type: item.type,
        posterPath: item.posterPath,
        date: date,
        action: action,
        notes: notes,
        rating: parseInt(modal.querySelector('#diaryEntryRating').value) || null,
        mood: selectedMood || null,
        episodes: null,
        timestamp: new Date().toISOString(),
      };

      Store.addDiaryEntry(entry);
      Store.addActivity({
        tmdbId: item.tmdbId, title: item.title, type: item.type,
        posterPath: item.posterPath, action: 'diary',
        detail: `Logged: ${action}${notes ? ' — ' + notes.substring(0, 50) : ''}`,
        timestamp: new Date().toISOString(),
      });

      toast('Diary entry saved!');
      closeModal();
      this.render();
    });
  },

  _editEntryModal(timestamp) {
    const entry = Store.getDiaryEntry(timestamp);
    if (!entry) return;
    const isM = entry.type === 'movie';
    const html = `<div class="modal-backdrop edit-modal-backdrop" id="diaryEditModal">
      <div class="modal-box edit-modal-box" style="max-width:420px;">
        <div class="modal-header"><h2>Edit Diary Entry</h2><button class="modal-close-btn" id="deClose">&#10005;</button></div>
        <div class="modal-body">
          <div class="edit-field"><div class="edit-field-label">Date</div><input type="date" id="deDate" value="${entry.date || ''}" class="edit-date-input" style="width:100%;"></div>
          <div class="edit-dates-row">
            <div class="edit-field edit-field-half"><div class="edit-field-label">Action</div>
              <select id="deAction" class="edit-select" style="width:100%;">
                <option value="watched" ${entry.action === 'watched' ? 'selected' : ''}>Watched</option>
                <option value="rewatch" ${entry.action === 'rewatch' ? 'selected' : ''}>Rewatched</option>
              </select>
            </div>
            <div class="edit-field edit-field-half"><div class="edit-field-label">Rating</div>
              <select id="deRating" class="edit-select" style="width:100%;">
                <option value="0">— None —</option>
                ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}" ${entry.rating === n ? 'selected' : ''}>★ ${n}/10</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="edit-field"><div class="edit-field-label">Notes</div><textarea class="diary-notes-input" id="deNotes" rows="3">${esc(entry.notes || '')}</textarea></div>
          <div class="edit-actions"><button class="btn-accent" id="deSave">Save</button><button class="btn-ghost" id="deCancel">Cancel</button></div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const m = document.getElementById('diaryEditModal');
    const close = () => { m.remove(); this._renderStatsBar(); this._renderCurrentView(); };
    m.querySelector('#deClose').addEventListener('click', close);
    m.querySelector('#deCancel').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#deSave').addEventListener('click', () => {
      Store.updateDiaryEntry(timestamp, {
        date: m.querySelector('#deDate').value,
        action: m.querySelector('#deAction').value,
        rating: parseInt(m.querySelector('#deRating').value) || null,
        notes: m.querySelector('#deNotes').value.trim(),
      });
      toast('Updated'); close();
    });
  },
};
