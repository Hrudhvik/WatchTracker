/* Activity Timeline Page */

const ActivityUI = {
  currentPage: 1,
  itemsPerPage: 50,
  _scrollInit: false,

  render() {
    const page = document.getElementById('page-activity');
    if (!this._scrollInit) {
      window.addEventListener('scroll', () => {
        if (App && App.currentView !== 'activity') return;
        const btn = document.getElementById('scrollTopBtn');
        if (btn) {
          if (window.scrollY > 300) btn.classList.remove('hidden');
          else btn.classList.add('hidden');
        }
      });
      const btn = document.getElementById('scrollTopBtn');
      if (btn) {
        btn.addEventListener('click', () => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
      this._scrollInit = true;
    }

    const activity = Store.getActivity();
    
    // Fallback missing posters
    activity.forEach(a => {
      if (!a.posterPath || a.posterPath.includes('cdn.jikan')) {
        const m = a.type === 'movie' ? Store.getMovie(a.tmdbId) : Store.getTvShow(a.tmdbId);
        if (m && m.posterPath) a.posterPath = m.posterPath;
      }
    });

    const totalPages = Math.ceil(activity.length / this.itemsPerPage) || 1;
    if (this.currentPage > totalPages) this.currentPage = totalPages;

    const startIdx = (this.currentPage - 1) * this.itemsPerPage;
    const currentActs = activity.slice(startIdx, startIdx + this.itemsPerPage);

    // Grouping
    const groups = [];
    let currentGroup = null;

    currentActs.forEach(a => {
      const gStr = this._getRelativeDayStr(a.timestamp);
      if (!currentGroup || currentGroup.label !== gStr) {
        currentGroup = { label: gStr, items: [] };
        groups.push(currentGroup);
      }
      currentGroup.items.push(a);
    });

    const esc = (s) => {
      if (!s) return '';
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    };

    const getStatusTag = (detail) => {
      const lower = (detail || '').toLowerCase();
      if (lower.includes('watching')) return `<span class="activity-tag tag-watching">Watching</span>`;
      if (lower.includes('completed')) return `<span class="activity-tag tag-completed">Completed</span>`;
      if (lower.includes('plan')) return `<span class="activity-tag tag-plan">Plan to watch</span>`;
      if (lower.includes('hold')) return `<span class="activity-tag tag-hold">On Hold</span>`;
      if (lower.includes('drop')) return `<span class="activity-tag tag-dropped">Dropped</span>`;
      return '';
    };

    // Header with back button, title, and items-per-page filter
    let html = `<div class="page-header">
      <div style="display:flex; align-items:center; gap:12px;">
        <button class="btn-ghost" id="activityBackBtn" style="padding:6px 10px; font-size:13px; display:flex; align-items:center; gap:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          Back
        </button>
        <h1>Activity Timeline</h1>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:12px; color:var(--text-2);">Show</span>
        <select id="activityPerPage" class="sort-select" style="min-width:70px; font-size:12px; padding:5px 8px;">
          <option value="25" ${this.itemsPerPage === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${this.itemsPerPage === 50 ? 'selected' : ''}>50</option>
          <option value="100" ${this.itemsPerPage === 100 ? 'selected' : ''}>100</option>
        </select>
        <span style="font-size:12px; color:var(--text-3);">${activity.length} total</span>
      </div>
    </div>`;

    if (groups.length === 0) {
      html += `<div class="empty-state"><h3>No activity yet</h3><p>Your history will appear here.</p></div>`;
    } else {
      html += `<div class="timeline-container">`;
      groups.forEach(g => {
        html += `<div class="timeline-group">
          <div class="timeline-header"><span class="timeline-dot"></span>${g.label}</div>
          <div class="timeline-items">`;
        
        g.items.forEach(a => {
          const poster = TMDB.poster(a.posterPath, 'w154');
          const typeLabel = a.type === 'movie' ? 'MOV' : 'TV';
          const tag = getStatusTag(a.detail || a.action);
          
          html += `<div class="timeline-card" data-tmdb="${a.tmdbId}" data-type="${a.type}">
            <div class="tl-poster">
              ${poster ? `<img src="${poster}" loading="lazy">` : `<div class="no-poster-ph">${typeLabel}</div>`}
            </div>
            <div class="tl-content">
              <div class="tl-title-row">
                <span class="tl-title">${esc(a.title)}</span>
                ${tag}
              </div>
              <div class="tl-detail">${esc(a.detail || a.action)}</div>
            </div>
          </div>`;
        });

        html += `</div></div>`;
      });
      html += `</div>`;
    }

    // Pagination
    if (totalPages > 1) {
      html += `<div class="pagination-bar">
        <button class="btn-ghost" id="btnPagePrev" ${this.currentPage === 1 ? 'disabled' : ''}>Previous</button>
        <div class="pagination-numbers">`;
      
      const maxPagesToShow = 5;
      let startPage = Math.max(1, this.currentPage - Math.floor(maxPagesToShow / 2));
      let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
      
      if (endPage - startPage + 1 < maxPagesToShow) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
      }

      if (startPage > 1) {
        html += `<button class="page-num" data-page="1">1</button>`;
        if (startPage > 2) html += `<span class="page-dots">...</span>`;
      }

      for (let p = startPage; p <= endPage; p++) {
        html += `<button class="page-num ${p === this.currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }

      if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="page-dots">...</span>`;
        html += `<button class="page-num" data-page="${totalPages}">${totalPages}</button>`;
      }

      html += `</div>
        <button class="btn-ghost" id="btnPageNext" ${this.currentPage === totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
    }

    // Page info footer
    if (activity.length > 0) {
      const showEnd = Math.min(startIdx + this.itemsPerPage, activity.length);
      html += `<div style="text-align:center; padding:8px 0 20px; font-size:12px; color:var(--text-3);">
        Showing ${startIdx + 1}&ndash;${showEnd} of ${activity.length}
      </div>`;
    }

    page.innerHTML = html;

    // ── Events ──

    // Back button → return to profile
    const backBtn = page.querySelector('#activityBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        App.showPage('profile');
        // Re-highlight profile in sidebar
        document.querySelectorAll('.nav-item[data-view]').forEach(b => {
          b.classList.toggle('active', b.dataset.view === 'profile');
        });
      });
    }

    // Items per page selector
    const perPageSelect = page.querySelector('#activityPerPage');
    if (perPageSelect) {
      perPageSelect.addEventListener('change', (e) => {
        this.itemsPerPage = parseInt(e.target.value);
        this.currentPage = 1;
        this.render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Timeline card clicks
    page.querySelectorAll('.timeline-card').forEach(card => {
      card.addEventListener('click', () => {
        if (typeof DetailUI !== 'undefined') {
          DetailUI.open(parseInt(card.dataset.tmdb), card.dataset.type);
        }
      });
    });

    // Pagination buttons
    const btnPrev = page.querySelector('#btnPagePrev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    const btnNext = page.querySelector('#btnPageNext');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (this.currentPage < totalPages) {
          this.currentPage++;
          this.render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    page.querySelectorAll('.page-num').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const p = parseInt(e.target.dataset.page);
        if (p && p !== this.currentPage) {
          this.currentPage = p;
          this.render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  },

  _getRelativeDayStr(dStr) {
    if (!dStr) return "UNKNOWN DATE";
    const date = new Date(dStr);
    const now = new Date();
    
    const dDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const diffTime = nDate.getTime() - dDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "TODAY";
    if (diffDays === 1) return "YESTERDAY";
    if (diffDays === 2) return "2 DAYS AGO";
    if (diffDays === 3) return "3 DAYS AGO";
    if (diffDays > 3 && diffDays <= 7) return "LAST WEEK";
    if (diffDays > 7 && diffDays <= 14) return "2 WEEKS AGO";
    if (diffDays > 14 && diffDays <= 30) return "EARLIER THIS MONTH";
    if (diffDays > 30 && diffDays <= 60) return "LAST MONTH";
    return "OLDER";
  }
};
