/* Profile — Stats + Recent + Activity, no emojis */

const ProfileUI = {
  render() {
    const page = document.getElementById('page-profile');
    const movies = Store.getMovies(), tvshows = Store.getTvShows(), activity = Store.getActivity();
    const mW=movies.filter(m=>m.watchStatus==='watching').length, mC=movies.filter(m=>m.watchStatus==='completed').length;
    const mP=movies.filter(m=>m.watchStatus==='plan_to_watch').length, mH=movies.filter(m=>m.watchStatus==='on_hold').length;
    const mD=movies.filter(m=>m.watchStatus==='dropped').length, mT=movies.length;
    const mRw=movies.reduce((s,m)=>s+(m.rewatchCount||0),0);
    const mDays=(movies.reduce((s,m)=>s+((m.runtime||0)*(1+(m.rewatchCount||0))),0)/60/24).toFixed(1);

    const tW=tvshows.filter(t=>t.watchStatus==='watching').length, tC=tvshows.filter(t=>t.watchStatus==='completed').length;
    const tP=tvshows.filter(t=>t.watchStatus==='plan_to_watch').length, tH=tvshows.filter(t=>t.watchStatus==='on_hold').length;
    const tD=tvshows.filter(t=>t.watchStatus==='dropped').length, tT=tvshows.length;
    const tRw=tvshows.reduce((s,t)=>s+(t.rewatchCount||0),0);
    const tEps=tvshows.reduce((s,t)=>s+(t.seasons||[]).reduce((se,ss)=>se+(ss.episodesWatched||0),0),0);

    const diary = Store.getDiary();
    const recent = diary
      .filter(d => ['watched', 'rewatch'].includes(d.action))
      .sort((a,b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp))
      .slice(0, 10)
      .map(d => {
         const m = d.type === 'movie' ? movies.find(x => x.tmdbId === d.tmdbId) : tvshows.find(x => x.tmdbId === d.tmdbId);
         return { tmdbId: d.tmdbId, mediaType: d.type, title: d.title, posterPath: d.posterPath || (m ? m.posterPath : null), year: m ? m.year : '' };
      });
    const acts = activity.slice(0, 5);
    const sl = {watching:'Watching',plan_to_watch:'Plan to Watch',completed:'Completed',on_hold:'On Hold',dropped:'Dropped'};

    function bar(w,c,h,d,p,t){if(t===0)return'<div class="stat-bar"><div class="stat-bar-seg" style="flex:1;background:var(--bg-4)"></div></div>';const segs=[{v:w,c:'var(--watching)'},{v:c,c:'var(--completed)'},{v:h,c:'var(--on-hold)'},{v:d,c:'var(--dropped)'},{v:p,c:'var(--text-3)'}].filter(s=>s.v>0);return`<div class="stat-bar">${segs.map(s=>`<div class="stat-bar-seg" style="flex:${s.v};background:${s.c}"></div>`).join('')}</div>`;}
    function ago(d){if(!d)return'';const diff=Date.now()-new Date(d).getTime(),m=Math.floor(diff/6e4);if(m<1)return'now';if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h';const dy=Math.floor(h/24);if(dy<7)return dy+'d';return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});}

    page.innerHTML = `<div class="profile-container"><div class="page-header"><h1>Profile</h1></div>
      <div class="profile-stats-row">
        <div class="stats-card"><div class="stats-card-header"><h3>Movie Stats</h3></div><div class="stats-card-body">
          <div class="stats-headline"><div class="stats-headline-item"><span class="stats-big-num">${mDays}</span><span class="stats-big-label">Days</span></div></div>
          ${bar(mW,mC,mH,mD,mP,mT)}
          <div class="stats-breakdown">
            <div class="stats-row"><span class="status-dot dot-watching"></span><span>Watching</span><span class="stats-val">${mW}</span></div>
            <div class="stats-row"><span class="status-dot dot-completed"></span><span>Completed</span><span class="stats-val">${mC}</span></div>
            <div class="stats-row"><span class="status-dot dot-hold"></span><span>On Hold</span><span class="stats-val">${mH}</span></div>
            <div class="stats-row"><span class="status-dot dot-dropped"></span><span>Dropped</span><span class="stats-val">${mD}</span></div>
            <div class="stats-row"><span class="status-dot dot-plan"></span><span>Plan to Watch</span><span class="stats-val">${mP}</span></div>
          </div>
          <div class="stats-totals"><div class="stats-total-item"><span>Total</span><span class="stats-val">${mT}</span></div><div class="stats-total-item"><span>Rewatched</span><span class="stats-val">${mRw}</span></div></div>
        </div></div>
        <div class="stats-card"><div class="stats-card-header"><h3>TV Show Stats</h3></div><div class="stats-card-body">
          <div class="stats-headline"><div class="stats-headline-item"><span class="stats-big-num">${tEps}</span><span class="stats-big-label">Episodes</span></div></div>
          ${bar(tW,tC,tH,tD,tP,tT)}
          <div class="stats-breakdown">
            <div class="stats-row"><span class="status-dot dot-watching"></span><span>Watching</span><span class="stats-val">${tW}</span></div>
            <div class="stats-row"><span class="status-dot dot-completed"></span><span>Completed</span><span class="stats-val">${tC}</span></div>
            <div class="stats-row"><span class="status-dot dot-hold"></span><span>On Hold</span><span class="stats-val">${tH}</span></div>
            <div class="stats-row"><span class="status-dot dot-dropped"></span><span>Dropped</span><span class="stats-val">${tD}</span></div>
            <div class="stats-row"><span class="status-dot dot-plan"></span><span>Plan to Watch</span><span class="stats-val">${tP}</span></div>
          </div>
          <div class="stats-totals"><div class="stats-total-item"><span>Total</span><span class="stats-val">${tT}</span></div><div class="stats-total-item"><span>Rewatched</span><span class="stats-val">${tRw}</span></div></div>
        </div></div>
      </div>
      <div class="profile-section">
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px;">
          <h3 style="margin:0;">Last Activity</h3>
          ${activity.length > 5 ? `<a href="#" class="btn-ghost" style="font-size:12px; padding:4px 8px;" id="profileMoreActivity">More ❯</a>` : ''}
        </div>
        ${acts.length ? (() => {
          // Group by relative day like the activity page
          function relDay(dStr) {
            if (!dStr) return 'UNKNOWN DATE';
            const d = new Date(dStr), n = new Date();
            const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const nd = new Date(n.getFullYear(), n.getMonth(), n.getDate());
            const diff = Math.round((nd - dd) / 864e5);
            if (diff === 0) return 'TODAY';
            if (diff === 1) return 'YESTERDAY';
            if (diff >= 2 && diff <= 3) return diff + ' DAYS AGO';
            if (diff > 3 && diff <= 7) return 'LAST WEEK';
            if (diff > 7 && diff <= 14) return '2 WEEKS AGO';
            if (diff > 14 && diff <= 30) return 'EARLIER THIS MONTH';
            if (diff > 30 && diff <= 60) return 'LAST MONTH';
            return 'OLDER';
          }
          const groups = [];
          let curGroup = null;
          acts.forEach(a => {
            const label = relDay(a.timestamp);
            if (!curGroup || curGroup.label !== label) {
              curGroup = { label, items: [] };
              groups.push(curGroup);
            }
            curGroup.items.push(a);
          });
          return `<div class="timeline-container">
            ${groups.map(g => `<div class="timeline-group">
              <div class="timeline-header"><span class="timeline-dot"></span>${g.label}</div>
              <div class="timeline-items">
                ${g.items.map(a => {
                  let posterPath = a.posterPath;
                  if (!posterPath || posterPath.includes('cdn.jikan')) {
                    const m = a.type === 'movie' ? Store.getMovie(a.tmdbId) : Store.getTvShow(a.tmdbId);
                    if (m && m.posterPath) posterPath = m.posterPath;
                  }
                  const poster = TMDB.poster(posterPath, 'w154');
                  const typeLabel = a.type === 'movie' ? 'MOV' : 'TV';
                  const detailStr = (a.detail || a.action || '').toLowerCase();
                  let tag = '';
                  if (detailStr.includes('watching')) tag = `<span class="activity-tag tag-watching">Watching</span>`;
                  else if (detailStr.includes('completed')) tag = `<span class="activity-tag tag-completed">Completed</span>`;
                  else if (detailStr.includes('plan')) tag = `<span class="activity-tag tag-plan">Plan to watch</span>`;
                  else if (detailStr.includes('hold')) tag = `<span class="activity-tag tag-hold">On Hold</span>`;
                  else if (detailStr.includes('drop')) tag = `<span class="activity-tag tag-dropped">Dropped</span>`;
                  return `<div class="timeline-card" data-tmdb="${a.tmdbId}" data-type="${a.type}">
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
                }).join('')}
              </div>
            </div>`).join('')}
          </div>`;
        })() : '<div class="empty-inline">No activity yet</div>'}
      </div>
    </div>`;
    page.querySelectorAll('[data-tmdb]').forEach(el=>el.addEventListener('click',()=>DetailUI.open(parseInt(el.dataset.tmdb),el.dataset.type)));
    const moreBtn = document.getElementById('profileMoreActivity');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        App.showPage('activity');
      });
    }
    page.querySelectorAll('img').forEach(img => {
      img.addEventListener('error', () => {
        const ph = document.createElement('div');
        ph.className = 'no-poster-ph';
        ph.style.cssText = 'width:100%;height:100%;font-size:10px;';
        ph.textContent = img.closest('[data-type="movie"]') ? 'MOV' : 'TV';
        img.replaceWith(ph);
      });
    });
  },
};
