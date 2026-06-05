/* Popup — list + detail + TMDB + MAL search, persistent prefs */


/* Theme-aware SVG icon inliner: external SVG <img> files cannot inherit the
   surrounding button text color, so local icon SVGs are inlined and colored
   with currentColor. */
function initThemeAwareSvgIcons(root = document) {
  const selector = 'img[src^="icons/"][src$=".svg"]:not([src$="logo.svg"]):not([data-svg-inlined])';
  const imgs = Array.from(root.querySelectorAll(selector));
  imgs.forEach(async img => {
    if (img.dataset.svgInlined) return;
    img.dataset.svgInlined = 'pending';
    try {
      const src = img.getAttribute('src');
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Unable to load ${src}`);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) throw new Error(`Invalid SVG ${src}`);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.querySelectorAll('[stroke]').forEach(el => {
        if ((el.getAttribute('stroke') || '').toLowerCase() !== 'none') el.setAttribute('stroke', 'currentColor');
      });
      svg.querySelectorAll('[fill]').forEach(el => {
        if ((el.getAttribute('fill') || '').toLowerCase() !== 'none') el.setAttribute('fill', 'currentColor');
      });
      const icon = document.createElement('span');
      icon.className = `${img.className || ''} themed-svg-icon`.trim();
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = new XMLSerializer().serializeToString(svg);
      img.replaceWith(icon);
    } catch (_) {
      img.dataset.svgInlined = 'failed';
    }
  });
}

function watchThemeAwareSvgIcons() {
  initThemeAwareSvgIcons();
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches?.('img[src^="icons/"][src$=".svg"]:not([src$="logo.svg"])')) initThemeAwareSvgIcons(node.parentElement || document);
        else if (node.querySelector?.('img[src^="icons/"][src$=".svg"]:not([src$="logo.svg"])')) initThemeAwareSvgIcons(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Route external API fetches through background.js when available (MV3/CORS-safe).
async function popupBgFetch(url, options) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'fetch', url, options: options || {} }, response => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!response) { reject(new Error('No response from background worker')); return; }
          resolve(response);
        });
      });
    } catch (_) { /* fall through to normal fetch */ }
  }
  const res = await fetch(url, options || {});
  let body = null;
  try { body = await res.json(); } catch (_) { body = await res.text(); }
  return { ok: res.ok, status: res.status, body };
}

function popupIsMalMovie(anime) {
  return String(anime?.type || '').toLowerCase() === 'movie';
}

function popupMalPoster(anime) {
  return anime?.images?.webp?.image_url || anime?.images?.jpg?.image_url || anime?.image_url || '';
}

function popupMalYear(anime) {
  return anime?.year || (anime?.aired?.from ? parseInt(String(anime.aired.from).substring(0, 4)) : 0) || 0;
}

function popupMalTitle(anime) {
  return anime?.title_english || anime?.title || anime?.title_japanese || 'Untitled';
}


function popupIsLandscapeImageUrl(url) {
  return new Promise(resolve => {
    if (!url) { resolve(false); return; }
    const img = new Image();
    const finish = ok => { img.onload = img.onerror = null; resolve(ok); };
    const timer = setTimeout(() => finish(false), 2200);
    img.onload = () => {
      clearTimeout(timer);
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      finish(w >= h * 1.15);
    };
    img.onerror = () => { clearTimeout(timer); finish(false); };
    img.src = url;
  });
}

async function popupMALAnilistBanner(malId) {
  if (!malId) return null;
  try {
    const query = `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { bannerImage } }`;
    const res = await popupBgFetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { idMal: Number(malId) } })
    });
    return res.ok ? (res.body?.data?.Media?.bannerImage || null) : null;
  } catch (_) { return null; }
}

async function popupMALLandscapeBackdrop(anime, malId) {
  // MAL/Jikan does not have TMDB-style backdrops. AniList commonly exposes a
  // proper landscape banner for the same MAL id, so use it first.
  const anilistBanner = await popupMALAnilistBanner(malId || anime?.mal_id);
  if (anilistBanner) return anilistBanner;

  return anime?.trailer?.images?.maximum_image_url
    || anime?.trailer?.images?.large_image_url
    || anime?.trailer?.images?.medium_image_url
    || anime?.trailer?.images?.image_url
    || null;
}

const STATUS_CFG = {
  watching: { label: 'Watching', color: '#00b894' },
  completed: { label: 'Completed', color: '#8B5CF6' },
  on_hold: { label: 'On-Hold', color: '#fdcb6e' },
  dropped: { label: 'Dropped', color: '#e17055' },
  plan_to_watch: { label: 'Plan to Watch', color: '#a29bfe' },
  all: { label: 'All', color: 'linear-gradient(135deg,#00b894,#8B5CF6,#e17055)' },
};

let pFilter = 'watching', pSource = 'all', pType = 'all', pSort = 'dateUpdated', pView = 'list', pQuery = '';
let pSearchSource = 'tmdb';
let pMode = 'list';
let pReturnMode = 'list';
let pSearchTimeout = null;
let pLastSearchQuery = '';
let pRecCache = { html: '', summary: '', filters: null, results: [] };

function openFullDashboardFromPopup(ev) {
  if (ev) {
    ev.preventDefault?.();
    ev.stopPropagation?.();
  }
  const url = chrome.runtime.getURL('app.html');
  try {
    chrome.tabs.create({ url, active: true }, () => {
      try { window.close(); } catch (_) {}
    });
  } catch (_) {
    window.open(url, '_blank', 'noopener');
    setTimeout(() => { try { window.close(); } catch (__) {} }, 80);
  }
}

function popupDashboardShortcutHTML(label = 'Open full dashboard') {
  // Dashboard access now lives in the main popup header, next to the brand.
  // Keep this helper as a no-op so older modal/header render calls do not
  // inject duplicate dashboard buttons.
  return '';
}

function injectPopupDashboardShortcutStyles() {
  if (document.getElementById('popupDashboardShortcutStyles')) return;
  const style = document.createElement('style');
  style.id = 'popupDashboardShortcutStyles';
  style.textContent = `
    .popup-dashboard-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
    .popup-dashboard-header>div:first-child{min-width:0;}
    .pis-head.popup-dashboard-header,.pr-head.popup-dashboard-header,.p-lineup-head.popup-dashboard-header,.pdl-header.popup-dashboard-header{align-items:center;}

    /* Main popup header dashboard shortcut beside the WatchTracker brand.
       Match the existing square header icon buttons. */
    .p-brand-dashboard-wrap{
      display:inline-flex;align-items:center;gap:8px;min-width:0;margin-right:auto;
    }
    .p-brand-dashboard-wrap #pOpenTab,
    #pOpenTab{
      display:inline-flex;align-items:center;gap:9px;min-width:0;
    }
    #pDashboardBtn,
    #pDashboardBtn.p-top-dashboard-btn,
    .p-brand-dashboard-wrap > #pDashboardBtn.p-top-dashboard-btn{
      box-sizing:border-box !important;
      inline-size:28px !important;block-size:28px !important;
      width:28px !important;height:28px !important;
      min-width:28px !important;max-width:28px !important;
      min-height:28px !important;max-height:28px !important;
      flex:0 0 28px !important;align-self:center !important;
      padding:0 !important;margin:0 !important;
      border-radius:7px !important;border:1px solid rgba(148,163,184,.20) !important;
      display:inline-flex !important;align-items:center !important;justify-content:center !important;
      background:var(--pbg-2,rgba(17,21,31,.96)) !important;color:var(--ptext-1,#d2d7e2) !important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.045) !important;cursor:pointer;
      line-height:0 !important;appearance:none !important;-webkit-appearance:none !important;
      transform:none !important;filter:none !important;overflow:hidden !important;
      transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease;
    }
    #pDashboardBtn.p-top-dashboard-btn img,
    #pDashboardBtn.p-top-dashboard-btn svg,
    #pDashboardBtn.p-top-dashboard-btn .themed-svg-icon{
      width:17px !important;height:17px !important;display:block !important;flex:0 0 17px !important;
    }
    #pDashboardBtn.p-top-dashboard-btn svg,
    #pDashboardBtn.p-top-dashboard-btn svg *{
      stroke:currentColor !important;fill:none !important;stroke-width:1.6 !important;
      stroke-linecap:round !important;stroke-linejoin:round !important;
    }
    #pDashboardBtn.p-top-dashboard-btn:hover{
      background:var(--pbg-3,rgba(24,29,42,.98)) !important;border-color:var(--paccent,#8B5CF6) !important;color:var(--ptext-0,#f5f7fb) !important;
    }
    #pDashboardBtn.p-top-dashboard-btn:active{transform:scale(.98) !important;}
    #pDashboardBtn.p-top-dashboard-btn:focus-visible{outline:2px solid var(--paccent,#8B5CF6);outline-offset:2px;}
  `;
  document.head.appendChild(style);
}

function bindPopupDashboardShortcuts(root = document) {
  // Dashboard access is only the top header ↗ button.
}

function popupDashboardIconHTML() {
  // Inline the external-link arrow so it inherits the active popup theme via currentColor.
  // Keeping this inline avoids fixed-color SVG rendering that can happen with <img> icons.
  return `
    <svg class="themed-svg-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M13 5h6v6" />
      <path d="M19 5 10 14" />
      <path d="M18 14v4.2a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 18.2V8.8A1.8 1.8 0 0 1 6.8 7H11" />
    </svg>`;
}

function findPopupBrandElement() {
  const byId = document.getElementById('pOpenTab');
  if (byId) return byId;

  // Fallback for builds where the brand id changed: find the smallest header
  // element that visibly contains the WatchTracker title.
  const candidates = Array.from(document.querySelectorAll('button,a,div,span'))
    .filter(el => /watchtracker/i.test((el.textContent || '').trim()))
    .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
  return candidates[0] || null;
}

function initPopupTopDashboardButton() {
  const brand = findPopupBrandElement();
  if (!brand) return false;

  // Remove old/experimental dashboard triggers and avoid duplicates.
  document.querySelectorAll('#pDashboardBtn, .p-brand-dashboard-shortcut, .popup-dashboard-shortcut').forEach(el => el.remove());

  brand.removeAttribute('role');
  brand.removeAttribute('tabindex');
  brand.removeAttribute('aria-label');
  brand.removeAttribute('title');

  const btn = document.createElement('button');
  btn.id = 'pDashboardBtn';
  const referenceHeaderButton = document.getElementById('pSearchBtn') || document.getElementById('pLineupBtn') || document.getElementById('pDiaryBtn') || document.getElementById('pSettings');
  const referenceClasses = referenceHeaderButton
    ? Array.from(referenceHeaderButton.classList).filter(c => !['hidden','active','selected'].includes(c)).join(' ')
    : '';
  btn.className = `${referenceClasses} p-top-dashboard-btn`.trim();
  btn.type = 'button';
  btn.title = 'Open full dashboard';
  btn.setAttribute('aria-label', 'Open full dashboard');
  btn.innerHTML = popupDashboardIconHTML();
  btn.addEventListener('click', openFullDashboardFromPopup);

  // Put the button immediately beside the Logo / WatchTracker brand.
  let wrap = brand.closest?.('.p-brand-dashboard-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'p-brand-dashboard-wrap';
    brand.parentNode.insertBefore(wrap, brand);
    wrap.appendChild(brand);
  }
  wrap.appendChild(btn);
  initThemeAwareSvgIcons(wrap);

  return true;
}

function keepPopupDashboardButtonMounted() {
  let attempts = 0;
  const ensure = () => {
    attempts += 1;
    initPopupTopDashboardButton();
    if (!document.getElementById('pDashboardBtn') && attempts < 8) setTimeout(ensure, 120);
  };
  ensure();

  const observer = new MutationObserver(() => {
    if (!document.getElementById('pDashboardBtn')) initPopupTopDashboardButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function bindPopupBrandDashboardShortcut() {
  // The logo/title are decorative in the popup. Use #pDashboardBtn to open the full dashboard.
}

function cleanupPopupFooterDashboardButtons() {
  // Dashboard access now lives in the brand/header area, so remove legacy
  // bottom dashboard CTAs that may still be present in popup.html.
  document.querySelectorAll('.p-footer button, .p-footer a').forEach(el => {
    const text = (el.textContent || '').trim().toLowerCase();
    const meta = `${el.id || ''} ${el.className || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.toLowerCase();
    const isDashboardAction = text.includes('open full dashboard')
      || text === '↗'
      || text === 'dashboard ↗'
      || meta.includes('dashboard');
    if (isDashboardAction) el.remove();
  });
  document.querySelectorAll('.p-footer').forEach(footer => {
    const visibleChildren = Array.from(footer.children).filter(child => {
      const style = window.getComputedStyle(child);
      return style.display !== 'none' && style.visibility !== 'hidden' && (child.textContent || '').trim();
    });
    if (!visibleChildren.length) footer.classList.add('hidden');
  });
}

function setPopupModeTabs(mode) {
  const switcher = document.getElementById('pModeSwitch');
  const lib = document.getElementById('pModeLibrary');
  const ext = document.getElementById('pModeExternal');
  const anime = document.getElementById('pModeAnime');
  if (!switcher || !lib || !ext || !anime) return;
  const visible = mode === 'list-search' || mode === 'search';
  switcher.classList.toggle('hidden', !visible);
  lib.classList.toggle('active', mode === 'list-search');
  ext.classList.toggle('active', mode === 'search' && pSearchSource === 'tmdb');
  anime.classList.toggle('active', mode === 'search' && pSearchSource === 'mal');
}

function showPopupSearchPage(activeMode) {
  const page = document.getElementById('pSearchPage');
  const localInput = document.getElementById('pSearch');
  const extInput = document.getElementById('pTmdbSearch');
  if (!page || !localInput || !extInput) return;
  page.classList.remove('hidden');
  const external = activeMode === 'search';
  localInput.classList.toggle('hidden', external);
  extInput.classList.toggle('hidden', !external);
  setPopupModeTabs(activeMode);
}

function hidePopupSearchPage() {
  const page = document.getElementById('pSearchPage');
  if (page) page.classList.add('hidden');
  setPopupModeTabs('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
  watchThemeAwareSvgIcons();
  try {
    await Store.load();
    const apiKey = Store.getApiKey();
    if (apiKey) TMDB.setKey(apiKey);
    applyPopupTheme();
    injectPopupDashboardShortcutStyles();
    keepPopupDashboardButtonMounted();
    cleanupPopupFooterDashboardButtons();
    restorePrefs();
    renderList();
    hidePopupSearchPage();
  } finally {
    // Avoid first-paint flicker: keep the popup hidden until saved state,
    // preferences, theme, dashboard/header cleanup, and the first render are applied.
    document.documentElement.classList.remove('app-pending');
  }

  bindPopupBrandDashboardShortcut();
  document.getElementById('pSettings')?.addEventListener('click', () => enterPopupSettingsMode());
  document.getElementById('pClose')?.addEventListener('click', () => window.close());
  document.getElementById('pSearchBtn')?.addEventListener('click', () => enterTMDBMode(true, pSearchSource || 'tmdb'));
  document.getElementById('pLineupBtn')?.addEventListener('click', () => enterLineupMode());

  const pModeLibrary = document.getElementById('pModeLibrary');
  const pModeExternal = document.getElementById('pModeExternal');
  const pModeAnime = document.getElementById('pModeAnime');
  if (pModeLibrary) pModeLibrary.addEventListener('click', () => enterLibrarySearchMode(true));
  if (pModeExternal) pModeExternal.addEventListener('click', () => enterTMDBMode(true, 'tmdb'));
  if (pModeAnime) pModeAnime.addEventListener('click', () => enterTMDBMode(true, 'mal'));

  // Diary view
  document.getElementById('pDiaryBtn')?.addEventListener('click', () => enterDiaryMode());
  document.getElementById('pRecBtn')?.addEventListener('click', () => enterRecommendationsMode());

  // Back — returns to the previous popup view when possible
  document.getElementById('pBack').addEventListener('click', () => {
    if (pMode === 'detail' && pReturnMode === 'lineup') enterLineupMode();
    else if (pMode === 'detail' && pReturnMode === 'recommendations') enterRecommendationsMode(false);
    else if (pMode === 'detail' && pReturnMode === 'search') returnToPopupSearch();
    else if (pMode === 'detail' && pReturnMode === 'list-search') enterLibrarySearchMode(true);
    else if (pMode === 'search' || pMode === 'list-search' || pMode === 'lineup') goBackToList();
    else goBackToList();
  });


  // Source + type toggles
  document.querySelectorAll('.p-source').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.p-source').forEach(t => t.classList.remove('active'));
    b.classList.add('active');
    pSource = b.dataset.source || 'all';
    savePrefs();
    renderList();
  }));

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
    if (pMode !== 'list-search') pMode = 'list-search';
    renderList();
  });

  // TMDB search input (the dedicated bar)
  const tmdbInput = document.getElementById('pTmdbSearch');
  tmdbInput.addEventListener('input', (e) => {
    clearTimeout(pSearchTimeout);
    const q = e.target.value.trim();
    if (!q) {
      document.getElementById('pList').innerHTML = `<div class="p-search-msg">Type to search ${pSearchSource === 'mal' ? 'Anime / MAL' : 'TMDB movies & TV'}</div>`;
      return;
    }
    if (q.length >= 2) {
      document.getElementById('pList').innerHTML = `<div class="p-search-msg">Searching ${pSearchSource === 'mal' ? 'Anime / MAL' : 'TMDB'}...</div>`;
      pSearchTimeout = setTimeout(() => searchTMDB(q), 350);
    }
  });
  tmdbInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = tmdbInput.value.trim();
      if (q.length >= 2) { clearTimeout(pSearchTimeout); searchTMDB(q); }
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
  Store.setPopupPrefs({ filter: pFilter, source: pSource, type: pType, sort: pSort, view: pView });
}

function restorePrefs() {
  const p = Store.getPopupPrefs();
  if (!p) return;
  if (p.filter) { pFilter = p.filter; setStatusDD(pFilter); }
  if (p.source) {
    pSource = p.source;
    document.querySelectorAll('.p-source').forEach(b => b.classList.toggle('active', b.dataset.source === pSource));
  }
  if (p.type) {
    pType = p.type === 'anime' ? 'all' : p.type;
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
  document.querySelector('.p-footer')?.classList.remove('hidden');
  cleanupPopupFooterDashboardButtons();
  document.getElementById('pInlineSettings')?.classList.add('hidden');
  document.getElementById('pList')?.classList.remove('hidden');
  pMode = 'list';
  hidePopupSearchPage();
  pReturnMode = 'list';
  document.getElementById('pBack').classList.add('hidden');
  document.getElementById('pControls').classList.remove('hidden');
  document.getElementById('pSearchBtn').classList.remove('hidden');
  document.getElementById('pAddNew')?.classList.remove('hidden');
  document.getElementById('pDiaryBtn').classList.remove('hidden');
  document.getElementById('pLineupBtn')?.classList.remove('hidden');
  document.getElementById('pRecBtn')?.classList.remove('hidden');
  document.getElementById('pTmdbSearch').value = '';
  document.getElementById('pSearch').value = '';
  pQuery = '';
  document.getElementById('pEmpty').classList.add('hidden');
  renderList();
}

function enterLibrarySearchMode(preserveQuery = true) {
  document.getElementById('pInlineSettings')?.classList.add('hidden');
  document.getElementById('pList')?.classList.remove('hidden');
  pMode = 'list-search';
  pReturnMode = 'list-search';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  showPopupSearchPage('list-search');
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  const input = document.getElementById('pSearch');
  if (!preserveQuery) { input.value = ''; pQuery = ''; }
  else pQuery = input.value.trim().toLowerCase();
  renderList();
  setTimeout(() => input.focus(), 50);
}

function returnToPopupSearch() {
  const input = document.getElementById('pTmdbSearch');
  const query = (input.value || pLastSearchQuery || '').trim();
  enterTMDBMode(true);
  if (query.length >= 2) {
    input.value = query;
    searchTMDB(query);
  }
}


function enterLineupMode() {
  document.getElementById('pInlineSettings')?.classList.add('hidden');
  document.getElementById('pList')?.classList.remove('hidden');
  pMode = 'lineup';
  setPopupModeTabs('hidden');
  pReturnMode = 'list';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  hidePopupSearchPage();
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  renderPopupLineup();
}

function renderPopupLineup() {
  if (Store.cleanupLineup) Store.cleanupLineup();
  const el = document.getElementById('pList');
  const lineup = (Store.getLineup ? Store.getLineup() : []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!lineup.length) {
    el.innerHTML = '<div class="p-search-msg">Your Lineup is empty. Open a title and tap Add to Lineup.</div>';
    return;
  }
  el.innerHTML = `<div class="p-lineup-wrap"><div class="p-lineup-head popup-dashboard-header"><div><div class="pd-title">Lineup</div><div class="pd-sub">What you are watching next · drag to reorder</div></div>${popupDashboardShortcutHTML()}</div><div class="p-lineup-list">${lineup.map((entry, idx) => {
    const item = Store._lineupMediaFor ? Store._lineupMediaFor(entry) : null;
    const poster = TMDB.poster((item && item.posterPath) || entry.posterPath, 'w92');
    const title = esc((item && item.title) || entry.title || 'Untitled');
    const source = entry.source === 'mal' || entry.type === 'anime' ? 'MAL' : 'TMDB';
    const label = entry.targetType === 'season' ? `S${entry.seasonNumber}` : entry.type === 'movie' ? 'Movie' : entry.type === 'anime' ? 'Anime' : 'TV';
    const year = ((item && (item.year || item.releaseDate || item.firstAirDate || item.release_date || item.first_air_date)) || '').toString().slice(0,4);
    let progress = '';
    if (item && entry.mediaType !== 'movie') {
      const seasons = item.seasons || [];
      if (entry.targetType === 'season') {
        const season = seasons.find(x => Number(x.seasonNumber) === Number(entry.seasonNumber));
        if (season) progress = `${season.episodesWatched || 0}/${season.episodeCount || '?'} eps`;
      } else {
        const watched = seasons.reduce((sum, season) => sum + (season.episodesWatched || 0), 0);
        const total = seasons.reduce((sum, season) => sum + (season.episodeCount || 0), 0);
        progress = `${watched}/${total || '?'} eps`;
      }
    }
    const status = item ? (item.watchStatus || 'plan_to_watch').replaceAll('_',' ') : 'missing';
    const meta = [label, year, progress].filter(Boolean).map(x => esc(x)).join(' <span class="p-lineup-dot">•</span> ');
    return `<div class="p-lineup-card" data-id="${entry.id}">
      <button class="p-lineup-drag" type="button" title="Drag to reorder" aria-label="Drag to reorder"><span></span><span></span><span></span><span></span><span></span><span></span></button>
      <div class="p-lineup-rank">${idx + 1}</div>
      <div class="p-lineup-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${entry.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}</div>
      <div class="p-lineup-info"><div class="p-lineup-title">${title}</div><div class="p-lineup-meta"><span class="p-lineup-source">${source}</span><span class="p-lineup-meta-text">${meta}</span></div><div class="p-lineup-state">${esc(status)}</div></div>
      <button class="p-lineup-remove p-trash-btn" type="button" title="Remove from Lineup" aria-label="Remove from Lineup"><img src="icons/trash.svg" alt=""></button>
    </div>`;
  }).join('')}</div></div>`;
  bindPopupDashboardShortcuts(el);
  const listEl = el.querySelector('.p-lineup-list');
  const updateRanks = () => {
    listEl?.querySelectorAll('.p-lineup-card').forEach((node, i) => {
      const rank = node.querySelector('.p-lineup-rank');
      if (rank) rank.textContent = String(i + 1);
    });
  };
  const persistDomOrder = () => {
    const ids = [...listEl.querySelectorAll('.p-lineup-card')].map(node => node.dataset.id).filter(Boolean);
    const ok = Store.reorderLineup ? Store.reorderLineup(ids) : false;
    updateRanks();
    return ok;
  };
  el.querySelectorAll('.p-lineup-card').forEach(card => {
    const id = card.dataset.id;
    card.addEventListener('click', ev => {
      if (ev.target.closest('button') || ev.target.closest('.p-lineup-drag')) return;
      const entry = Store.getLineup().find(x => x.id === id);
      if (entry) showDetail(entry.tmdbId, entry.mediaType || (entry.type === 'movie' ? 'movie' : 'tv'), 'lineup');
    });
    const handle = card.querySelector('.p-lineup-drag');
    handle?.addEventListener('mousedown', () => { card.draggable = true; });
    handle?.addEventListener('touchstart', () => { card.draggable = true; }, { passive: true });
    card.addEventListener('dragstart', ev => {
      card.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.draggable = false;
      persistDomOrder();
      renderPopupLineup();
    });
    card.addEventListener('dragover', ev => {
      ev.preventDefault();
      const dragging = listEl.querySelector('.p-lineup-card.dragging');
      if (!dragging || dragging === card) return;
      const rect = card.getBoundingClientRect();
      const after = ev.clientY > rect.top + rect.height / 2;
      listEl.insertBefore(dragging, after ? card.nextSibling : card);
      updateRanks();
    });
    card.addEventListener('drop', ev => {
      ev.preventDefault();
      persistDomOrder();
      renderPopupLineup();
    });
    card.querySelector('.p-lineup-remove')?.addEventListener('click', ev => { ev.stopPropagation(); Store.removeFromLineup(id); renderPopupLineup(); });
  });
}

function enterDiaryMode() {
  document.getElementById('pInlineSettings')?.classList.add('hidden');
  document.getElementById('pList')?.classList.remove('hidden');
  pMode = 'diary';
  setPopupModeTabs('hidden');
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  hidePopupSearchPage();
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
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

  const movies = Store.getMovies();
  const tvshows = Store.getTvShows();
  const actLabels = { completed: 'Completed', rewatch: 'Rewatched', watched: 'Watched', watched_episodes: 'Watched eps', started: 'Started', session: 'Session' };

  // Enrich diary entries with poster fallback from store
  const enriched = diary.map(e => {
    if (e.posterPath) return e;
    const m = e.type === 'movie' ? movies.find(x => x.tmdbId === e.tmdbId) : tvshows.find(x => x.tmdbId === e.tmdbId);
    return { ...e, posterPath: m ? m.posterPath : null };
  });

  // Group by date
  const grouped = {};
  enriched.forEach(e => { const d = e.date || 'Unknown'; if (!grouped[d]) grouped[d] = []; grouped[d].push(e); });

  let html = '<div class="pd-diary-tl">';
  Object.keys(grouped).sort((a, b) => b.localeCompare(a)).forEach(date => {
    const dateObj = new Date(date + 'T12:00:00');
    const valid = !isNaN(dateObj.getTime());
    const dayNum = valid ? dateObj.getDate() : '?';
    const mon = valid ? dateObj.toLocaleDateString('en-US', { month: 'short' }) : '';
    const dayName = valid ? dateObj.toLocaleDateString('en-US', { weekday: 'short' }) : '';

    html += `<div class="pd-tl-day"><div class="pd-tl-marker"><div class="pd-tl-num">${dayNum}</div><div class="pd-tl-mon">${mon}</div><div class="pd-tl-dn">${dayName}</div></div><div class="pd-tl-entries">`;

    grouped[date].forEach(e => {
      const poster = TMDB.poster(e.posterPath, 'w92');
      const act = actLabels[e.action] || e.action || 'Logged';
      const rating = e.rating ? ` · ★ ${e.rating}/10` : '';
      const season = e.season ? ` · S${e.season}` : '';

      html += `<div class="pd-tl-entry" data-tmdb="${e.tmdbId}" data-type="${e.type}">
        <div class="pd-tl-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${e.type === 'movie' ? 'MOV' : 'TV'}</div>`}</div>
        <div class="pd-tl-info">
          <div class="pd-tl-title">${esc(e.title)}</div>
          <div class="pd-tl-meta">${act}${season}${rating}</div>
          ${e.notes ? `<div class="pd-tl-notes">${esc(e.notes).substring(0, 60)}</div>` : ''}
        </div>
        <div class="pd-tl-actions">
          <button class="pd-tl-edit" data-ts="${e.timestamp || ''}">Edit</button>
          <button class="pd-tl-del icon-only-sm trash" data-tmdb="${e.tmdbId}" data-ts="${e.timestamp || ''}" title="Remove" aria-label="Remove"><img src="icons/trash.svg" alt=""></button>
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

function enterTMDBMode(preserveQuery = false, source = pSearchSource || 'tmdb') {
  document.getElementById('pInlineSettings')?.classList.add('hidden');
  document.getElementById('pList')?.classList.remove('hidden');
  pSearchSource = source === 'mal' ? 'mal' : 'tmdb';
  pMode = 'search';
  pReturnMode = 'search';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  showPopupSearchPage('search');
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  const input = document.getElementById('pTmdbSearch');
  if (!preserveQuery) input.value = '';
  const el = document.getElementById('pList');
  input.placeholder = pSearchSource === 'mal' ? 'Search anime on MyAnimeList...' : 'Search movies & TV on TMDB...';
  setPopupModeTabs('search');
  if (!preserveQuery || !input.value.trim()) {
    el.innerHTML = `<div class="p-search-msg">${pSearchSource === 'mal' ? 'Search Anime / MAL separately from TMDB results.' : 'Search TMDB movies & TV separately from anime.'}</div>`;
  } else if (input.value.trim().length >= 2) {
    searchTMDB(input.value.trim());
  }
  setTimeout(() => input.focus(), 50);
}


function enterRecommendationsMode(reset = false) {
  document.getElementById('pInlineSettings')?.classList.add('hidden');
  document.getElementById('pList')?.classList.remove('hidden');
  pMode = 'recommendations';
  setPopupModeTabs('hidden');
  pReturnMode = 'list';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  hidePopupSearchPage();
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  const el = document.getElementById('pList');
  if (!reset && pRecCache.html) {
    el.innerHTML = pRecCache.html;
    bindPopupDashboardShortcuts(el);
    bindPopupRecommendationEvents();
    return;
  }
  el.innerHTML = popupRecommendationShell();
  bindPopupDashboardShortcuts(el);
  bindPopupRecommendationEvents();
}

function popupRecommendationShell() {
  const languageOptions = POPUP_REC_LANGUAGES.map(([code, name]) => `<option value="${esc(name)} (${esc(code)})"></option>`).join('');
  return `<div class="pr-wrap">
    <div class="pr-head popup-dashboard-header">
      <div><div class="pr-title">Recommendations</div><div class="pr-sub">Quick picks from your tracker or TMDB.</div></div>
      ${popupDashboardShortcutHTML()}
    </div>
    <div class="pr-panel">
      <div class="pr-row"><label>Source</label><select id="prSource"><option value="new">Something new</option><option value="plan_to_watch">From Plan to Watch</option><option value="completed">From Completed</option><option value="library">From My Library</option></select></div>
      <div class="pr-grid2">
        <div class="pr-row"><label>Picks</label><select id="prCount"><option>1</option><option selected>3</option><option>5</option><option>10</option></select></div>
        <div class="pr-row"><label>Type</label><select id="prType"><option value="movie" selected>Movies</option><option value="tv">TV Shows</option><option value="both">Movies + TV</option></select></div>
      </div>
      <div class="pr-grid2">
        <div class="pr-row"><label>Style</label><select id="prStyle"><option value="best" selected>Closest match</option><option value="because">Similar favorites</option><option value="hidden">Hidden gems</option><option value="popular">Popular</option><option value="wild">Surprise me</option><option value="random">Random by filters</option></select></div>
        <div class="pr-row"><label>Genre</label><select id="prGenre">${popupGenreOptions()}</select></div>
      </div>
      <div class="pr-grid2">
        <div class="pr-row"><label>TMDB rating</label><select id="prTmdbRating"><option value="">Any</option><option value="6">6+</option><option value="7">7+</option><option value="8">8+</option><option value="9">9+</option></select></div>
        <div class="pr-row"><label>Library</label><select id="prLibrary"><option value="new_only">New only</option><option value="not_completed">Not completed</option><option value="include_library">Allow saved</option></select></div>
      </div>
      <div class="pr-row"><label>Language</label><input id="prLanguage" list="prLanguageList" type="search" placeholder="Any language, e.g. Telugu, Tamil"><datalist id="prLanguageList">${languageOptions}</datalist></div>
      <button id="prSuggest" class="pr-primary">Suggest</button>
    </div>
    <div id="prSummary" class="pr-summary"></div>
    <div id="prResults" class="pr-empty">Choose filters and tap Suggest.</div>
  </div>`;
}

function bindPopupRecommendationEvents() {
  const root = document.getElementById('pList');
  const btn = root.querySelector('#prSuggest');
  if (btn) btn.addEventListener('click', popupSuggestRecommendations);
  root.querySelectorAll('[data-pr-card]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      showDetail(Number(card.dataset.id), card.dataset.type, 'recommendations');
    });
  });
  root.querySelectorAll('[data-pr-add]').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); await popupAddRecommendation(btn); });
  });
}

async function popupSuggestRecommendations() {
  if (!TMDB.getKey() && document.getElementById('prSource').value === 'new') {
    document.getElementById('prResults').innerHTML = '<div class="pr-empty">Set your TMDB API key in Settings first.</div>';
    return;
  }
  const btn = document.getElementById('prSuggest');
  const results = document.getElementById('prResults');
  const summary = document.getElementById('prSummary');
  btn.disabled = true; btn.textContent = 'Finding...';
  results.className = 'pr-empty';
  results.innerHTML = 'Finding picks...';
  try {
    const filters = {
      source: document.getElementById('prSource').value,
      count: Number(document.getElementById('prCount').value),
      type: document.getElementById('prType').value,
      style: document.getElementById('prStyle')?.value || 'best',
      libraryMode: document.getElementById('prLibrary').value,
      genre: document.getElementById('prGenre')?.value || '',
      language: popupLanguageCode(document.getElementById('prLanguage').value),
      minTmdbRating: document.getElementById('prTmdbRating').value,
      minMyRating: '',
      decade: '',
    };
    const data = await Recommendations.suggest(filters);
    const items = data.results || [];
    summary.textContent = items.length ? `${items.length} pick${items.length === 1 ? '' : 's'}${filters.style === 'random' ? ' · random by filters' : ''}${filters.genre ? ' · ' + filters.genre : ''}${filters.language ? ' · ' + popupLanguageName(filters.language) : ''}` : '';
    results.className = items.length ? 'pr-results' : 'pr-empty';
    results.innerHTML = items.length ? items.map((m, i) => popupRecommendationCard(m, i)).join('') : 'No matches found. Try Random by filters, Any rating, or clear Genre/Language.';
    pRecCache = { html: document.getElementById('pList').innerHTML, summary: summary.textContent, filters, results: items };
    bindPopupRecommendationEvents();
  } catch (err) {
    results.className = 'pr-empty';
    results.innerHTML = `Could not load recommendations: ${esc(err.message || String(err))}`;
  } finally {
    btn.disabled = false; btn.textContent = 'Suggest';
  }
}

function popupRecommendationCard(m, i) {
  const poster = TMDB.poster(m.posterPath, 'w92');
  const inList = m.mediaType === 'movie' ? Store.hasMovie(m.tmdbId) : Store.hasTvShow(m.tmdbId);
  const status = m.watchStatus ? String(m.watchStatus).replace(/_/g, ' ') : '';
  const language = m.originalLanguage ? popupLanguageName(m.originalLanguage) : '';
  const imdb = m.imdbRating ? `IMDb ${Number(m.imdbRating).toFixed(1)}` : '';
  const meta = [m.mediaType === 'movie' ? 'Movie' : 'TV', m.year || '', m.voteAverage ? `TMDB ${Number(m.voteAverage).toFixed(1)}` : '', imdb, language].filter(Boolean).join(' · ');
  const desc = String(m.overview || '').replace(/\s+/g, ' ').trim().slice(0, 130);
  const action = inList ? `<span class="pr-saved">${esc(status || 'Saved')}</span>` : `<button class="pr-add" data-pr-add data-id="${m.tmdbId}" data-type="${m.mediaType}">Add</button>`;
  return `<article class="pr-card" data-pr-card data-id="${m.tmdbId}" data-type="${m.mediaType}">
    <div class="pr-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${m.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}</div>
    <div class="pr-info"><div class="pr-kicker">#${i + 1}</div><div class="pr-name">${esc(m.title)}</div><div class="pr-meta">${esc(meta)}</div>${desc ? `<div class="pr-desc">${esc(desc)}</div>` : ''}<div class="pr-actions">${action}</div></div>
  </article>`;
}

async function popupAddRecommendation(btn) {
  const id = Number(btn.dataset.id);
  const type = btn.dataset.type;
  btn.disabled = true; btn.textContent = 'Adding...';
  try {
    const rec = (pRecCache?.results || []).find(x => Number(x.tmdbId) === id && x.mediaType === type) || {};
    if (type === 'movie') {
      const d = await TMDB.movieDetails(id);
      Store.addMovie({ tmdbId: d.id, title: d.title, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.release_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.imdb_id || '', runtime: d.runtime || 0, genres: (d.genres || []).map(g => g.name), originalLanguage: d.original_language || '', watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
      Store.addActivity({ tmdbId: d.id, title: d.title, type: 'movie', posterPath: d.poster_path, action: 'added', detail: 'Added from popup recommendations', timestamp: new Date().toISOString() });
    } else {
      const d = await TMDB.tvDetails(id);
      const ss = (d.seasons || []).filter(s => s.season_number > 0);
      Store.addTvShow({ tmdbId: d.id, title: d.name, posterPath: d.poster_path, backdropPath: d.backdrop_path, year: parseInt((d.first_air_date || '').substring(0, 4)) || 0, voteAverage: d.vote_average || 0, imdbRating: rec?.imdbRating || 0, imdbVotes: rec?.imdbVotes || 0, imdbId: rec?.imdbId || d.external_ids?.imdb_id || '', totalSeasons: d.number_of_seasons || 0, totalEpisodes: d.number_of_episodes || 0, genres: (d.genres || []).map(g => g.name), originalLanguage: d.original_language || '', watchStatus: 'plan_to_watch', rewatchCount: 0, rewatchHistory: [], startDate: '', endDate: '', seasons: ss.map(s => ({ seasonNumber: s.season_number, episodeCount: s.episode_count || 0, episodesWatched: 0, posterPath: s.poster_path })), dateAdded: new Date().toISOString(), dateUpdated: new Date().toISOString() });
      Store.addActivity({ tmdbId: d.id, title: d.name, type: 'tv', posterPath: d.poster_path, action: 'added', detail: 'Added from popup recommendations', timestamp: new Date().toISOString() });
    }
    btn.outerHTML = '<span class="pr-saved">Saved</span>';
    pRecCache.html = document.getElementById('pList').innerHTML;
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Add';
  }
}

function popupGenreOptions() {
  const local = new Set();
  try { Store.getAll().forEach(i => (i.genres || []).forEach(g => local.add(g))); } catch (_) {}
  const fallback = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
  const genres = [...new Set([...local, ...fallback])].filter(Boolean).sort((a,b) => a.localeCompare(b));
  return `<option value="">Any genre</option>${genres.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}`;
}

const POPUP_REC_LANGUAGES = [
  ['en','English'], ['hi','Hindi'], ['te','Telugu'], ['ta','Tamil'], ['ml','Malayalam'], ['kn','Kannada'], ['bn','Bengali'], ['mr','Marathi'], ['pa','Punjabi'], ['gu','Gujarati'], ['ur','Urdu'], ['or','Odia'], ['as','Assamese'], ['ne','Nepali'], ['si','Sinhala'],
  ['ja','Japanese'], ['ko','Korean'], ['zh','Mandarin / Chinese'], ['cn','Cantonese'], ['th','Thai'], ['id','Indonesian'], ['ms','Malay'], ['tl','Filipino / Tagalog'], ['vi','Vietnamese'], ['fr','French'], ['es','Spanish'], ['it','Italian'], ['de','German'], ['pt','Portuguese'], ['ru','Russian'], ['tr','Turkish'], ['ar','Arabic'], ['fa','Persian']
];
function popupLanguageCode(value = '') {
  const v = String(value || '').trim(); if (!v) return '';
  const paren = v.match(/\(([a-z]{2})\)$/i); if (paren) return paren[1].toLowerCase();
  const found = POPUP_REC_LANGUAGES.find(([c,n]) => c.toLowerCase() === v.toLowerCase() || n.toLowerCase() === v.toLowerCase());
  if (found) return found[0];
  return Recommendations.normalizeLanguage ? Recommendations.normalizeLanguage(v) : v.toLowerCase();
}
function popupLanguageName(code = '') {
  const found = POPUP_REC_LANGUAGES.find(([c]) => c === code);
  return found ? found[1] : String(code || '').toUpperCase();
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
      default:  { bg0:'#08090c', bg1:'#0e1015', bg2:'#151820', bg3:'#1c2030', bg4:'#242a3a', accent:'#6c5ce7', accentL:'#a29bfe', text0:'#f5f7fb', text1:'#d2d7e2', text2:'#9aa3b7', text3:'#697189', border:'rgba(255,255,255,0.08)' },
      midnight: { bg0:'#08090c', bg1:'#0e1015', bg2:'#151820', bg3:'#1c2030', bg4:'#242a3a', accent:'#6c5ce7', accentL:'#a29bfe', text0:'#f5f7fb', text1:'#d2d7e2', text2:'#9aa3b7', text3:'#697189', border:'rgba(255,255,255,0.08)' },
      oled:     { bg0:'#000000', bg1:'#090909', bg2:'#121212', bg3:'#1a1a1a', bg4:'#242424', accent:'#d1d5db', accentL:'#f3f4f6', text0:'#e5e5e5', text1:'#a3a3a3', text2:'#737373', text3:'#525252', border:'rgba(255,255,255,0.08)' },
      ocean:    { bg0:'#090e17', bg1:'#0f1623', bg2:'#151e2f', bg3:'#1c273c', bg4:'#25324a', accent:'#38bdf8', accentL:'#7dd3fc', text0:'#e2e8f0', text1:'#cbd5e1', text2:'#94a3b8', text3:'#64748b', border:'rgba(255,255,255,0.08)' },
      nord:     { bg0:'#2e3440', bg1:'#3b4252', bg2:'#434c5e', bg3:'#4c566a', bg4:'#5e6980', accent:'#88c0d0', accentL:'#8fbcbb', text0:'#eceff4', text1:'#e5e9f0', text2:'#d8dee9', text3:'#aebad0', border:'rgba(255,255,255,0.1)' },
      sakura:   { bg0:'#170f14', bg1:'#23161e', bg2:'#2d1b26', bg3:'#3a2231', bg4:'#492a3e', accent:'#f472b6', accentL:'#fbcfe8', text0:'#fae8f0', text1:'#dfb8ca', text2:'#b3869d', text3:'#876074', border:'rgba(255,255,255,0.08)' },
      matcha:   { bg0:'#222622', bg1:'#2b302b', bg2:'#343a34', bg3:'#404740', bg4:'#4e574e', accent:'#a3e635', accentL:'#d9f99d', text0:'#e6ebe6', text1:'#c3cbc3', text2:'#95a195', text3:'#717d71', border:'rgba(255,255,255,0.08)' },
      cloud:    { bg0:'#f8fafc', bg1:'#f1f5f9', bg2:'#e2e8f0', bg3:'#cbd5e1', bg4:'#94a3b8', accent:'#3b82f6', accentL:'#2563eb', text0:'#0f172a', text1:'#1e293b', text2:'#334155', text3:'#475569', border:'rgba(0,0,0,0.1)' },
      latte:    { bg0:'#faf4ed', bg1:'#f3e8da', bg2:'#e6d5c3', bg3:'#d4bca4', bg4:'#c2a487', accent:'#d97706', accentL:'#b45309', text0:'#453a35', text1:'#5c4c45', text2:'#7a685f', text3:'#99857a', border:'rgba(0,0,0,0.08)' },
    };
    p = presets[t.preset];
  } else if (t.custom) {
    p = { bg0: t.custom.bg0, bg1: t.custom.bg1, bg2: t.custom.bg2, bg3: t.custom.bg3, bg4: t.custom.bg4, accent: t.custom.accent, accentL: t.custom.accentL, text0: t.custom.text0, text1: t.custom.text1, text2: t.custom.text2, text3: t.custom.text3, border: t.custom.border };
  }
  if (p) {
    r.setProperty('--pbg-0', p.bg0); r.setProperty('--pbg-1', p.bg1);
    r.setProperty('--pbg-2', p.bg2); r.setProperty('--pbg-3', p.bg3); if (p.bg4) r.setProperty('--pbg-4', p.bg4);
    r.setProperty('--paccent', p.accent); r.setProperty('--paccent-l', p.accentL);
    r.setProperty('--ptext-0', p.text0); r.setProperty('--ptext-1', p.text1);
    r.setProperty('--ptext-2', p.text2); if (p.text3) r.setProperty('--ptext-3', p.text3);
    if (p.border) r.setProperty('--pborder', p.border);
    r.setProperty('--text-color', p.text0);
    r.setProperty('--accent-color', p.accent);
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
  const el = document.getElementById('pList');
  const empty = document.getElementById('pEmpty');
  if (pMode === 'list-search') {
    if (!pQuery) {
      el.innerHTML = '<div class="p-search-msg">Type to search titles already in your library</div>';
      empty.classList.add('hidden');
      return;
    }
    items = items.filter(i => (i.title || '').toLowerCase().includes(pQuery));
  } else {
    const isAnimeItem = (i) => i.sourceTag === 'anime' || i.mediaKind === 'anime' || i.malId;
    if (pFilter !== 'all') items = items.filter(i => i.watchStatus === pFilter);
    if (pSource === 'tmdb') items = items.filter(i => !isAnimeItem(i));
    if (pSource === 'anime') items = items.filter(i => isAnimeItem(i));
    if (pType !== 'all') items = items.filter(i => i.mediaType === pType);
    if (pQuery) items = items.filter(i => (i.title || '').toLowerCase().includes(pQuery));
  }

  const typePri = (i) => (i.sourceTag === 'anime' || i.mediaKind === 'anime' || i.malId) ? 0 : (i.mediaType === 'tv' ? 1 : 2);
  switch (pSort) {
    case 'title': items.sort((a, b) => a.title.localeCompare(b.title) || typePri(a) - typePri(b)); break;
    case 'year': items.sort((a, b) => (b.year || 0) - (a.year || 0) || typePri(a) - typePri(b)); break;
    case 'dateAdded': items.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded) || typePri(a) - typePri(b)); break;
    default: items.sort((a, b) => new Date(b.dateUpdated || b.dateAdded) - new Date(a.dateUpdated || a.dateAdded) || typePri(a) - typePri(b));
  }

  if (!items.length) { el.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const fc = { watching: 'fill-watching', completed: 'fill-completed', plan_to_watch: 'fill-plan', on_hold: 'fill-hold', dropped: 'fill-dropped' };

  if (pView === 'grid') {
    el.innerHTML = `<div class="p-grid">${items.map(i => {
      const img = TMDB.poster(i.posterPath, 'w185');
      const pct = getPct(i); const f = fc[i.watchStatus] || 'fill-plan';
      return `<div class="p-grid-card" data-tmdb="${i.tmdbId}" data-type="${i.mediaType}">
        <div class="p-grid-poster">${img ? `<img src="${img}">` : `<div class="p-poster-ph">${i.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}
          <div class="p-grid-bar"><div class="p-grid-bar-fill ${f}" style="width:${pct}%"></div></div>
        </div><div class="p-grid-title">${esc(i.title)}</div></div>`;
    }).join('')}</div>`;
  } else {
    el.innerHTML = items.map(i => {
      const img = TMDB.poster(i.posterPath, 'w92');
      const pct = getPct(i); const f = fc[i.watchStatus] || 'fill-plan';
      const eps = getEps(i); const score = i.voteAverage ? i.voteAverage.toFixed(1) : '';
      return `<div class="p-item" data-tmdb="${i.tmdbId}" data-type="${i.mediaType}">
        <div class="p-poster">${img ? `<img src="${img}">` : `<div class="p-poster-ph">${i.mediaType === 'movie' ? 'MOV' : 'TV'}</div>`}</div>
        <div class="p-info"><div class="p-title">${esc(i.title)}</div>
          <div class="p-meta">${(i.sourceTag === 'anime' || i.mediaKind === 'anime' || i.malId) ? 'Anime / MAL' : (i.mediaType === 'movie' ? 'TMDB Movie' : 'TMDB TV')} · ${i.year || ''}</div>
          <div class="p-bar-wrap"><div class="p-bar"><div class="p-bar-fill ${f}" style="width:${pct}%"></div></div></div></div>
        <div class="p-right">${eps ? `<div class="p-eps">${eps}</div>` : ''}${score ? `<div class="p-score">${score}</div>` : ''}</div></div>`;
    }).join('');
  }

  el.querySelectorAll('[data-tmdb]').forEach(c => c.addEventListener('click', () => {
    showDetail(parseInt(c.dataset.tmdb), c.dataset.type, pMode === 'list-search' ? 'list-search' : 'list');
  }));
}

/* ═══════════════════════════════════════════
   DETAIL VIEW — custom status dropdown + eps + remove
   ═══════════════════════════════════════════ */


function buildQuickLinkUrl(template, title) {
  if (!template) return '';
  const raw = (title || '').trim();
  const collapsed = raw.replace(/\s+/g, ' ');
  const map = {
    searchterm: encodeURIComponent(collapsed),
    searchtermPlus: collapsed.split(' ').map(encodeURIComponent).join('+'),
    searchtermMinus: collapsed.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, ''),
    searchtermUnderscore: collapsed.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, ''),
    searchtermRaw: collapsed,
  };
  return template.replace(/\{(searchtermPlus|searchtermMinus|searchtermUnderscore|searchtermRaw|searchterm)\}/g, (_, key) => map[key]);
}

function renderPopupQuickLinks(title) {
  const links = Store.getQuickLinks ? Store.getQuickLinks().filter(l => l.enabled !== false) : [];
  const row = links.map(l => {
    const template = l.url || l.animeUrl || l.mangaUrl || '';
    const href = buildQuickLinkUrl(template, title);
    if (!href) return '';
    return `<a class="pd-quicklink-chip" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(l.name)}">
      <span class="pd-quicklink-favicon"><img src="https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(href)}" loading="lazy" onerror="this.remove()"></span>${esc(l.name)}</a>`;
  }).join('');
  if (!row) return '';
  return `<div class="pd-section pd-quicklinks"><div class="pd-section-label">Quick Links</div><div class="pd-quicklinks-list"><div class="pd-quicklink-chip-row">${row}</div></div></div>`;
}

function bindPopupQuickLinks(root) {
  root.querySelectorAll('.pd-quicklink-chip').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href) { chrome.tabs.create({ url: href }); window.close(); }
    });
  });
}

function buildStatusDropdownHTML(currentVal, idPrefix) {
  const entries = [
    { val: 'watching', label: 'Watching', color: '#00b894' },
    { val: 'completed', label: 'Completed', color: '#8B5CF6' },
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
      ${entries.map(e => `<div class="p-dd-item ${e.val === currentVal ? 'active' : ''}" data-val="${e.val}"><span class="p-dd-dot" style="background:${e.color}"></span>${e.label}</div>`).join('')}
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
      const cfg = { watching: { l: 'Watching', c: '#00b894' }, completed: { l: 'Completed', c: '#8B5CF6' }, on_hold: { l: 'On-Hold', c: '#fdcb6e' }, dropped: { l: 'Dropped', c: '#e17055' }, plan_to_watch: { l: 'Plan to Watch', c: '#a29bfe' } };
      const c = cfg[val] || cfg.watching;
      document.getElementById(`${idPrefix}Label`).textContent = c.l;
      document.getElementById(`${idPrefix}Dot`).style.background = c.c;
      menu.querySelectorAll('.p-dd-item').forEach(i => i.classList.toggle('active', i.dataset.val === val));
      dd.classList.remove('open'); menu.classList.add('hidden');

      const isM = mediaType === 'movie';
      const show = !isM ? Store.getTvShow(tmdbId) : null;
      const isAnimeEntry = show && show.sourceTag === 'anime' && show.malId;
      if (isAnimeEntry) Store.updateTvShowByMalId(show.malId, { watchStatus: val });
      else if (isM) Store.updateMovie(tmdbId, { watchStatus: val });
      else Store.updateTvShow(tmdbId, { watchStatus: val });
      Store.addActivity({ tmdbId, title, type: mediaType, posterPath, action: 'status_change', detail: `Changed to ${c.l}`, timestamp: new Date().toISOString() });
    });
  });
}

async function showDetail(tmdbId, mediaType, returnMode = 'list') {
  pMode = 'detail';
  setPopupModeTabs('hidden');
  pReturnMode = returnMode || 'list';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  hidePopupSearchPage();
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');

  const isM = mediaType === 'movie';
  let stored = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
  const el = document.getElementById('pList');

  // If not found, diary entry may have a stale tmdbId — recover by title
  if (!stored) {
    const diaryEntry = Store.getDiary().find(d => d.tmdbId === tmdbId && d.type === mediaType);
    if (diaryEntry && diaryEntry.title) {
      const titleLower = diaryEntry.title.toLowerCase();
      const all = Store.getAll();
      const match = all.find(x => x.mediaType === mediaType && (x.title || '').toLowerCase() === titleLower);
      if (match) {
        Store.migrateTmdbId(tmdbId, match.tmdbId, mediaType);
        tmdbId = match.tmdbId;
        stored = match.mediaType === 'movie' ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
      }
    }
  }

  if (!stored) { showTMDBDetail(tmdbId, mediaType, pReturnMode); return; }

  el.innerHTML = '<div class="p-search-msg">Loading...</div>';

  const isAnime = stored.sourceTag === 'anime';
  const poster = TMDB.poster(stored.posterPath, 'w185');
  const genres = (stored.genres || []).slice(0, 4);
  const score = stored.voteAverage ? stored.voteAverage.toFixed(1) : '—';
  const scoreLabel = isAnime ? 'MAL' : 'TMDB';

  let seasonHtml = '';
  if (!isM) {
    const ss = stored.seasons || [];
    const totalEps = ss.reduce((s, x) => s + (x.episodeCount || 0), 0);
    const watchedEps = ss.reduce((s, x) => s + (x.episodesWatched || 0), 0);

    if (isAnime) {
      // Anime: single flat episode counter
      seasonHtml = `<div class="pd-section"><div class="pd-section-label">Episode Progress (${watchedEps}/${totalEps || '?'})</div>
        ${ss.map(s => {
        const w = s.episodesWatched || 0, t = s.episodeCount || 0;
        const unknownTotal = t === 0 && w > 0;
        const pct = unknownTotal ? 90 : (t > 0 ? Math.round(w / t * 100) : 0);
        const epDisplay = unknownTotal ? `${w}/?` : `${w}/${t}`;
        const metaEps = unknownTotal ? '? eps' : `${t} eps`;
        const barColor = stored.watchStatus === 'completed' ? 'var(--pcompleted)' : stored.watchStatus === 'on_hold' ? 'var(--phold)' : stored.watchStatus === 'dropped' ? 'var(--pdropped)' : 'var(--pwatching)';
        return `<div class="pd-ep-row"><span class="pd-ep-label">${esc(stored.title)} (${metaEps})</span>
            <div class="pd-ep-counter"><button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="dec">-</button>
              <input class="pd-ep-input" data-sn="${s.seasonNumber}" type="number" value="${w}" min="0" ${t > 0 ? `max="${t}"` : ''} style="width:${String(epDisplay).length * 8 + 16}px;">
              <span class="pd-ep-total">/ ${t || '?'}</span>
              <button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="inc">+</button></div>
          </div><div class="pd-season-bar"><div class="pd-season-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
      }).join('')}</div>`;
    } else {
      // TMDB TV: per-season progress with per-season status dropdown
      const seasonStatuses = stored.seasonStatuses || {};
      const seasonStatusColors = { watching:'#00b894', completed:'#8B5CF6', on_hold:'#fdcb6e', dropped:'#e17055', plan_to_watch:'#a29bfe', not_started:'#5c6180' };
      const ssOpts = [
        { val:'not_started', label:'—' }, { val:'watching', label:'Watching' },
        { val:'completed', label:'Completed' }, { val:'on_hold', label:'On-Hold' },
        { val:'dropped', label:'Dropped' }, { val:'plan_to_watch', label:'Plan' },
      ];
      seasonHtml = `<div class="pd-section"><div class="pd-section-label">Episode Progress (${watchedEps}/${totalEps || '?'})</div>
        ${ss.map(s => {
        const w = s.episodesWatched || 0, t = s.episodeCount || 0;
        const unknownTotal = t === 0 && w > 0;
        const pct = unknownTotal ? 90 : (t > 0 ? Math.round(w / t * 100) : 0);
        const sStatus = seasonStatuses[s.seasonNumber] || (w >= t && t > 0 ? 'completed' : w > 0 ? 'watching' : 'not_started');
        const sColor = seasonStatusColors[sStatus] || '#5c6180';
        const barColor = sColor;
        const epDisplay = unknownTotal ? `${w}/?` : `${w}/${t}`;
        const metaEps = unknownTotal ? '? eps' : `${t} eps`;
        return `<div class="pd-ep-row"><span class="pd-ep-label">S${s.seasonNumber} (${metaEps})</span>
            <select class="pd-season-status-select" data-sn="${s.seasonNumber}" style="color:${sColor};border-color:${sColor}40;">
              ${ssOpts.map(o => `<option value="${o.val}" ${o.val===sStatus?'selected':''}>${o.label}</option>`).join('')}
            </select>
            <div class="pd-ep-counter"><button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="dec">-</button>
              <input class="pd-ep-input" data-sn="${s.seasonNumber}" type="number" value="${w}" min="0" ${t > 0 ? `max="${t}"` : ''} style="width:${String(epDisplay).length * 8 + 16}px;">
              <span class="pd-ep-total">/ ${t || '?'}</span>
              <button class="pd-ep-btn" data-sn="${s.seasonNumber}" data-act="inc">+</button></div>
          </div><div class="pd-season-bar"><div class="pd-season-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
      }).join('')}</div>`;
    }
  }

  let movieInfo;
  if (isM) {
    const rt = stored.runtime ? `${Math.floor(stored.runtime / 60)}h ${stored.runtime % 60}m` : '';
    movieInfo = [stored.year, rt].filter(Boolean).join(' · ');
  } else if (isAnime) {
    movieInfo = [stored.year, `${stored.totalEpisodes || '?'} Eps`].filter(Boolean).join(' · ');
  } else {
    const ss = stored.seasons || [];
    movieInfo = [stored.year, `${stored.totalSeasons || ss.length} Seasons`, `${stored.totalEpisodes || '?'} Eps`].filter(Boolean).join(' · ');
  }

  // Fetch extra details: Jikan-first for anime, TMDB for others
  let overview = '';
  let imdbId = stored.imdbId || null;
  let castHtml = '';
  let relatedHtml = '';

  if (isAnime && stored.malId) {
    // Fetch from Jikan
    try {
      const res = await fetch(`https://api.jikan.moe/v4/anime/${stored.malId}/full`);
      if (res.ok) {
        const jData = await res.json();
        const anime = jData?.data;
        if (anime) {
          overview = (anime.synopsis || '').substring(0, 250) + ((anime.synopsis || '').length > 250 ? '...' : '');

          // Build related anime section
          const validRelTypes = ['Prequel', 'Sequel', 'Parent Story', 'Side Story', 'Spin-off', 'Alternative Version'];
          const rels = [];
          for (const rel of (anime.relations || [])) {
            if (!validRelTypes.includes(rel.relation)) continue;
            for (const entry of (rel.entry || [])) {
              if (entry.type !== 'anime') continue;
              rels.push({ malId: entry.mal_id, title: entry.name || '', relation: rel.relation });
            }
          }
          if (rels.length) {
            const relOrder = ['Prequel', 'Sequel', 'Parent Story', 'Side Story', 'Spin-off', 'Alternative Version'];
            rels.sort((a, b) => (relOrder.indexOf(a.relation) === -1 ? 99 : relOrder.indexOf(a.relation)) - (relOrder.indexOf(b.relation) === -1 ? 99 : relOrder.indexOf(b.relation)));
            relatedHtml = `<div class="pd-section"><div class="pd-section-label">Related</div><div class="pd-related-list">${rels.map(r => {
              const inStore = Store.getTvShowByMalId(r.malId) || Store.getMovies().find(m => m.malId === r.malId);
              const dotColor = inStore ? ({ completed:'var(--pwatching)', watching:'var(--paccent-l)', dropped:'var(--pdropped)' }[inStore.watchStatus] || 'var(--ptext-2)') : 'transparent';
              return `<div class="pd-related-card" data-rel-mal="${r.malId}">
                <span class="pd-related-type">${esc(r.relation)}</span>
                <span class="pd-related-dot" style="background:${dotColor};${dotColor === 'transparent' ? 'border:1.5px solid var(--ptext-2);' : ''}"></span>
                <span class="pd-related-title">${esc(r.title)}</span>
              </div>`;
            }).join('')}</div></div>`;
          }
        }
      }
    } catch (e) { /* non-fatal */ }

    // Supplement with TMDB data for cast
    const tmdbFallbackId = stored.malTmdbId || (tmdbId > 0 ? tmdbId : null);
    if (tmdbFallbackId && TMDB.getKey()) {
      try {
        const d = isM ? await TMDB.movieDetails(tmdbFallbackId) : await TMDB.tvDetails(tmdbFallbackId);
        if (!overview && d.overview) overview = (d.overview || '').substring(0, 250) + ((d.overview || '').length > 250 ? '...' : '');
        if (!imdbId) imdbId = isM ? (d.imdb_id || null) : (d.external_ids?.imdb_id || null);
        const cast = (d.credits?.cast || []).slice(0, 6);
        if (cast.length) {
          castHtml = `<div class="pd-section"><div class="pd-section-label">Cast</div><div class="pd-cast-row">${cast.map(c => {
            const ph = TMDB.profile(c.profile_path, 'w92');
            return `<div class="pd-cast-card">${ph ? `<img src="${ph}" class="pd-cast-img">` : `<div class="pd-cast-ph"></div>`}<div class="pd-cast-name">${esc(c.name)}</div><div class="pd-cast-char">${esc(c.character || '')}</div></div>`;
          }).join('')}</div></div>`;
        }
      } catch (e) { /* non-fatal */ }
    }
  } else if (TMDB.getKey() && tmdbId > 0) {
    try {
      const d = isM ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId);
      overview = (d.overview || '').substring(0, 250) + ((d.overview || '').length > 250 ? '...' : '');
      if (!imdbId) {
        imdbId = isM ? (d.imdb_id || null) : (d.external_ids?.imdb_id || null);
        if (imdbId) {
          if (isM) Store.updateMovie(tmdbId, { imdbId });
          else Store.updateTvShow(tmdbId, { imdbId });
        }
      }
      const cast = (d.credits?.cast || []).slice(0, 6);
      if (cast.length) {
        castHtml = `<div class="pd-section"><div class="pd-section-label">Cast</div><div class="pd-cast-row">${cast.map(c => {
          const ph = TMDB.profile(c.profile_path, 'w92');
          return `<div class="pd-cast-card">${ph ? `<img src="${ph}" class="pd-cast-img">` : `<div class="pd-cast-ph"></div>`}<div class="pd-cast-name">${esc(c.name)}</div><div class="pd-cast-char">${esc(c.character || '')}</div></div>`;
        }).join('')}</div></div>`;
      }
    } catch (e) { /* non-fatal, just skip extras */ }
  }

  el.innerHTML = `<div class="pd-wrap">
    <div class="pd-hero">
      <div class="pd-poster">${poster ? `<img src="${poster}">` : `<div class="pd-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div>
      <div class="pd-info">
        <div class="pd-title">${esc(stored.title)}</div>
        <div class="pd-sub">${movieInfo}</div>
        <div class="pd-genres">${genres.map(g => `<span class="pd-genre-tag">${esc(g)}</span>`).join('')}</div>
        <div class="pd-stats">
          <div><div class="pd-stat-val gold">${score}</div><div class="pd-stat-label">${scoreLabel}</div></div>
          ${stored.rewatchCount ? `<div><div class="pd-stat-val">${stored.rewatchCount}</div><div class="pd-stat-label">Rewatches</div></div>` : ''}
        </div>
        <div class="pd-links">
          ${!isAnime ? `<a href="https://www.themoviedb.org/${isM ? 'movie' : 'tv'}/${Math.abs(tmdbId)}" target="_blank">&#8599; TMDB</a>` : ''}
          ${isM && tmdbId > 0 ? `<a href="https://letterboxd.com/tmdb/${Math.abs(tmdbId)}/" target="_blank">&#8599; Letterboxd</a>` : ''}
          ${imdbId ? `<a href="https://www.imdb.com/title/${imdbId}" target="_blank">&#8599; IMDb</a>` : ''}
          ${stored.malId ? `<a href="https://myanimelist.net/anime/${stored.malId}" target="_blank">&#8599; MAL</a>` : ''}
        </div>
      </div>
    </div>
    ${overview ? `<div class="pd-overview">${esc(overview)}</div>` : ''}
    ${castHtml}
    ${renderPopupQuickLinks(stored.title)}
    <div class="pd-section"><div class="pd-section-label">Status</div>
      ${buildStatusDropdownHTML(stored.watchStatus, 'pdSt')}
    </div>
    ${seasonHtml}
    <div class="pd-actions pd-icon-actions">
      <button class="pd-btn pd-btn-open pd-icon-action" id="pdOpenFull" title="Open full details" aria-label="Open full details"><img src="icons/external.svg" alt=""></button>
      <button class="pd-btn pd-btn-lineup pd-icon-action" id="pdLineup" title="Add to Lineup" aria-label="Add to Lineup"><img src="icons/lineup.svg" alt=""></button>
      <button class="pd-btn pd-btn-diary pd-icon-action" id="pdDiaryLog" title="Log Diary" aria-label="Log Diary"><img src="icons/diary.svg" alt=""></button>
      <button class="pd-btn pd-btn-remove pd-icon-action" id="pdRemove" title="Remove from list" aria-label="Remove from list"><img src="icons/trash.svg" alt=""></button>
    </div>
    ${relatedHtml}
  </div>`;

  // Bind custom status dropdown and quick links
  bindDetailStatusDD('pdSt', tmdbId, mediaType, stored.title, stored.posterPath);
  bindPopupQuickLinks(el);

  // Episode +/- (in-place update, no re-render)
  const updateEpInPlace = (sn, newVal) => {
    const show = Store.getTvShow(tmdbId); if (!show) return;
    const isAnimeEntry = show.sourceTag === 'anime' && show.malId;
    const ss = show.seasons || [];
    const s = ss.find(x => x.seasonNumber === sn); if (!s) return;
    const t = s.episodeCount || 0;
    const clamped = t > 0 ? Math.max(0, Math.min(newVal, t)) : Math.max(0, newVal);
    s.episodesWatched = clamped;

    const seasonStatuses = show.seasonStatuses || {};
    const sDone = clamped >= t && t > 0;
    if (sDone && (!seasonStatuses[sn] || seasonStatuses[sn] === 'watching' || seasonStatuses[sn] === 'not_started')) {
      seasonStatuses[sn] = 'completed';
      const nextS = ss.find(x => x.seasonNumber === sn + 1);
      if (nextS && (!seasonStatuses[sn+1] || seasonStatuses[sn+1] === 'not_started')) seasonStatuses[sn+1] = 'watching';
    } else if (clamped > 0 && !sDone && (!seasonStatuses[sn] || seasonStatuses[sn] === 'not_started')) {
      seasonStatuses[sn] = 'watching';
    }
    const allDone = ss.every(x => x.episodesWatched >= (x.episodeCount || 0) && (x.episodeCount || 0) > 0);
    const anyStarted = ss.some(x => x.episodesWatched > 0);
    let ns = show.watchStatus;
    if (allDone) ns = 'completed';
    else if (anyStarted && ns === 'plan_to_watch') ns = 'watching';
    if (isAnimeEntry) Store.updateTvShowByMalId(show.malId, { seasons: ss, watchStatus: ns });
    else Store.updateTvShow(tmdbId, { seasons: ss, watchStatus: ns, seasonStatuses });

    // In-place DOM update
    const input = el.querySelector(`.pd-ep-input[data-sn="${sn}"]`);
    if (input && input !== document.activeElement) input.value = clamped;
    const unknownTotal = t === 0 && clamped > 0;
    const pct = unknownTotal ? 90 : (t > 0 ? Math.round(clamped / t * 100) : 0);
    const bar = el.querySelector(`.pd-season-bar-fill`);
    // Find the bar that corresponds to this season
    const rows = el.querySelectorAll('.pd-ep-row');
    rows.forEach((row, i) => {
      const rowSn = row.querySelector('.pd-ep-btn')?.dataset.sn;
      if (parseInt(rowSn) === sn) {
        const barEl = row.nextElementSibling?.querySelector('.pd-season-bar-fill');
        if (barEl) barEl.style.width = `${pct}%`;
      }
    });
  };

  el.querySelectorAll('.pd-ep-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sn = parseInt(btn.dataset.sn), act = btn.dataset.act;
      const show = Store.getTvShow(tmdbId); if (!show) return;
      const ss = show.seasons || [];
      const s = ss.find(x => x.seasonNumber === sn); if (!s) return;
      const t = s.episodeCount || 0;
      let newVal = s.episodesWatched || 0;
      if (act === 'inc') newVal++;
      else if (act === 'dec') newVal--;
      else return;
      updateEpInPlace(sn, newVal);
    });
  });

  // Editable episode input
  el.querySelectorAll('.pd-ep-input').forEach(input => {
    input.addEventListener('change', () => {
      const sn = parseInt(input.dataset.sn);
      const val = parseInt(input.value) || 0;
      updateEpInPlace(sn, val);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { input.blur(); }
    });
  });

  // Per-season status select dropdown (TMDB TV only)
  el.querySelectorAll('.pd-season-status-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const sn = parseInt(sel.dataset.sn);
      const val = sel.value;
      const show = Store.getTvShow(tmdbId); if (!show) return;
      const ss = show.seasons || [];
      const seasonStatuses = show.seasonStatuses || {};
      seasonStatuses[sn] = val;
      // Cascade logic
      let newShowStatus = show.watchStatus;
      if (val === 'dropped') newShowStatus = 'dropped';
      else if (val === 'on_hold') newShowStatus = 'on_hold';
      else if (val === 'completed') {
        const nextS = ss.find(x => x.seasonNumber === sn + 1);
        if (nextS && (!seasonStatuses[sn+1] || seasonStatuses[sn+1] === 'not_started')) seasonStatuses[sn+1] = 'watching';
        const allCompleted = ss.every(x => (seasonStatuses[x.seasonNumber] || 'not_started') === 'completed');
        newShowStatus = allCompleted ? 'completed' : 'watching';
      } else if (val === 'watching') newShowStatus = 'watching';
      Store.updateTvShow(tmdbId, { seasonStatuses, watchStatus: newShowStatus });
      showDetail(tmdbId, mediaType);
    });
  });

  // Related anime navigation
  el.querySelectorAll('.pd-related-card').forEach(card => {
    card.addEventListener('click', () => {
      const relMal = parseInt(card.dataset.relMal);
      const inStore = Store.getTvShowByMalId(relMal) || Store.getMovies().find(m => m.malId === relMal);
      if (inStore) {
        showDetail(inStore.tmdbId, inStore.mediaType || 'tv');
      } else {
        // Not in library — open full dashboard to the anime detail page
        chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-tv-${-relMal}` });
        window.close();
      }
    });
  });

  el.querySelector('#pdOpenFull').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-${mediaType}-${tmdbId}` }); window.close();
  });

  el.querySelector('#pdLineup')?.addEventListener('click', () => {
    const added = Store.addToLineup({ ...stored, mediaType }, { targetType: mediaType === 'movie' ? 'movie' : 'show' });
    alert(added ? 'Added to Lineup' : 'Already in Lineup');
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


async function popupAddTmdbToList(tmdbId, mediaType) {
  const isM = mediaType === 'movie';
  const now = new Date().toISOString();
  if (isM) {
    const d = await TMDB.movieDetails(tmdbId);
    Store.addMovie({
      tmdbId: d.id,
      mediaKind: 'movie',
      granularity: 'movie',
      externalIds: [{ provider: 'tmdb', providerType: 'movie', id: d.id, relation: 'same_as' }],
      title: d.title,
      posterPath: d.poster_path,
      backdropPath: d.backdrop_path,
      year: parseInt((d.release_date || '').substring(0, 4)) || 0,
      voteAverage: d.vote_average || 0,
      imdbId: d.imdb_id || '',
      runtime: d.runtime || 0,
      genres: (d.genres || []).map(g => g.name),
      watchStatus: 'plan_to_watch',
      rewatchCount: 0,
      rewatchHistory: [],
      startDate: '',
      endDate: '',
      dateAdded: now,
      dateUpdated: now,
      sourceTag: 'tmdb',
    });
    Store.addActivity({ tmdbId: d.id, title: d.title, type: 'movie', posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: now });
    return d;
  }
  const d = await TMDB.tvDetails(tmdbId);
  const ss = (d.seasons || []).filter(season => season.season_number > 0);
  Store.addTvShow({
    tmdbId: d.id,
    mediaKind: 'tv',
    granularity: 'series',
    externalIds: [{ provider: 'tmdb', providerType: 'tv', id: d.id, relation: 'same_as' }],
    title: d.name,
    posterPath: d.poster_path,
    backdropPath: d.backdrop_path,
    year: parseInt((d.first_air_date || '').substring(0, 4)) || 0,
    voteAverage: d.vote_average || 0,
    imdbId: d.external_ids?.imdb_id || '',
    totalSeasons: d.number_of_seasons || 0,
    totalEpisodes: d.number_of_episodes || 0,
    genres: (d.genres || []).map(g => g.name),
    watchStatus: 'plan_to_watch',
    rewatchCount: 0,
    rewatchHistory: [],
    startDate: '',
    endDate: '',
    seasons: ss.map(season => ({ seasonNumber: season.season_number, episodeCount: season.episode_count || 0, episodesWatched: 0, posterPath: season.poster_path })),
    dateAdded: now,
    dateUpdated: now,
    sourceTag: 'tmdb',
  });
  Store.addActivity({ tmdbId: d.id, title: d.name, type: 'tv', posterPath: d.poster_path, action: 'added', detail: 'Added from popup', timestamp: now });
  return d;
}

async function searchTMDB(query) {
  pLastSearchQuery = (query || '').trim();
  const el = document.getElementById('pList');
  const source = pSearchSource === 'mal' ? 'mal' : 'tmdb';
  el.innerHTML = `<div class="p-search-msg">Searching ${source === 'mal' ? 'Anime / MAL' : 'TMDB'}...</div>`;

  try {
    const rows = [];
    if (source === 'mal') {
      const malResults = await searchMALAnime(query);
      malResults.forEach(r => rows.push({ source: 'mal', data: r }));
    } else {
      if (!TMDB.getKey()) {
        el.innerHTML = '<div class="p-search-msg">Set your TMDB API key in Settings before searching TMDB.</div>';
        return;
      }
      const tmdbResults = await TMDB.search(query);
      tmdbResults.forEach(r => rows.push({ source: 'tmdb', data: r }));
    }

    if (!rows.length) {
      el.innerHTML = `<div class="p-search-msg">No ${source === 'mal' ? 'Anime / MAL' : 'TMDB'} results found.</div>`;
      return;
    }

    const header = source === 'mal'
      ? '<div class="p-result-section-title">Anime / MAL results</div>'
      : '<div class="p-result-section-title">TMDB movie & TV results</div>';

    el.innerHTML = header + rows.slice(0, 18).map(row => {
      if (row.source === 'mal') {
        const r = row.data;
        const malId = Number(r.mal_id);
        const isMovie = popupIsMalMovie(r);
        const title = popupMalTitle(r);
        const yr = popupMalYear(r) || '';
        const poster = popupMalPoster(r);
        const score = r.score ? ` · ${Number(r.score).toFixed(1)}` : '';
        const eps = !isMovie && r.episodes ? ` · ${r.episodes} eps` : '';
        const inList = isMovie ? Store.getMovies().some(m => Number(m.malId) === malId) : Store.hasTvShowByMalId(malId);
        return `<div class="p-search-item" data-source="mal" data-mal-id="${malId}">
          <div class="p-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">MAL</div>`}</div>
          <div class="p-search-info"><div class="p-search-title">${esc(title)}</div>
            <div class="p-search-sub">Anime / MAL · ${esc(r.type || (isMovie ? 'Movie' : 'TV'))}${yr ? ` · ${yr}` : ''}${score}${eps}</div></div>
          <span class="p-search-type p-search-type-anime">Anime</span>
          <div class="p-search-actions">
            ${inList ? `<button class="p-add-btn added" disabled>In List</button>` : `<button class="p-add-btn" data-action="add">+ Add</button>`}
          </div>
        </div>`;
      }

      const r = row.data;
      const isM = r.media_type === 'movie';
      const title = isM ? r.title : r.name;
      const yr = ((isM ? r.release_date : r.first_air_date) || '').substring(0, 4);
      const poster = TMDB.poster(r.poster_path, 'w92');
      const inList = isM ? Store.hasMovie(r.id) : Store.hasTvShow(r.id);
      return `<div class="p-search-item" data-source="tmdb" data-id="${r.id}" data-type="${r.media_type}">
        <div class="p-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div>
        <div class="p-search-info"><div class="p-search-title">${esc(title)}</div>
          <div class="p-search-sub">TMDB · ${yr}${r.vote_average ? ` · ${r.vote_average.toFixed(1)}` : ''}</div></div>
        <span class="p-search-type p-search-type-${isM ? 'movie' : 'tv'}">${isM ? 'Movie' : 'TV'}</span>
        <div class="p-search-actions">
          ${inList ? `<button class="p-add-btn added" disabled>In List</button>` : `<button class="p-add-btn" data-action="add">+ Add</button>`}
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('.p-search-item').forEach(item => {
      const source = item.dataset.source;
      const openDetails = () => {
        if (source === 'mal') {
          const malId = Number(item.dataset.malId);
          const stored = (Store.getTvShowByMalId && Store.getTvShowByMalId(malId)) || Store.getMovies().find(m => Number(m.malId) === malId);
          if (stored) showDetail(stored.tmdbId, stored.mediaType || (stored.mediaKind === 'movie' ? 'movie' : 'tv'), 'search');
          else showMALDetail(malId, 'search');
          return;
        }
        const tmdbId = Number(item.dataset.id);
        const mediaType = item.dataset.type;
        const stored = mediaType === 'movie' ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
        if (stored) showDetail(tmdbId, mediaType, 'search');
        else showTMDBDetail(tmdbId, mediaType, 'search');
      };
      const addBtn = item.querySelector('[data-action="add"]');
      if (addBtn) {
        addBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          addBtn.textContent = '...'; addBtn.disabled = true;
          try {
            if (source === 'mal') await popupAddMalToList(parseInt(item.dataset.malId));
            else await popupAddTmdbToList(parseInt(item.dataset.id), item.dataset.type);
            addBtn.textContent = 'In List'; addBtn.classList.add('added');
          } catch (err) {
            addBtn.textContent = 'Error';
            setTimeout(() => { addBtn.textContent = '+ Add'; addBtn.disabled = false; }, 1500);
          }
        });
      }
      item.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openDetails();
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="p-search-msg" style="color:var(--pdropped)">Error: ${esc(err.message)}</div>`;
  }
}

async function searchMALAnime(query) {
  if (!query || query.trim().length < 2) return [];
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query.trim())}&limit=10&sfw=true&order_by=popularity&sort=asc`;
  const res = await popupBgFetch(url);
  if (!res.ok) throw new Error(`MAL/Jikan ${res.status}`);
  const data = res.body || {};
  return (data.data || []).filter(a => a && a.mal_id).slice(0, 10);
}

async function fetchMALAnimeFull(malId) {
  const res = await popupBgFetch(`https://api.jikan.moe/v4/anime/${malId}/full`);
  if (!res.ok) throw new Error(`MAL/Jikan ${res.status}`);
  return res.body?.data;
}

async function popupAddMalToList(malId) {
  const anime = await fetchMALAnimeFull(malId);
  if (!anime) throw new Error('MAL anime not found');
  const isMovie = popupIsMalMovie(anime);
  const now = new Date().toISOString();
  const title = popupMalTitle(anime);
  const poster = popupMalPoster(anime);
  const year = popupMalYear(anime);
  const score = anime.score || 0;
  const genres = (anime.genres || []).map(g => g.name).filter(Boolean);
  const common = {
    tmdbId: -Math.abs(Number(malId)),
    malId: Number(malId),
    mediaKind: 'anime',
    granularity: isMovie ? 'movie' : 'mal_entry',
    externalIds: [{ provider: 'mal', providerType: 'anime', id: Number(malId), relation: 'primary' }],
    title,
    posterPath: poster,
    backdropPath: await popupMALLandscapeBackdrop(anime, malId),
    year,
    voteAverage: score,
    genres,
    watchStatus: 'plan_to_watch',
    rewatchCount: 0,
    rewatchHistory: [],
    startDate: '',
    endDate: '',
    dateAdded: now,
    dateUpdated: now,
    sourceTag: 'anime',
    syncSource: 'mal-search',
  };

  if (isMovie) {
    const runtimeMin = anime.duration ? (parseInt(String(anime.duration).match(/\d+/)?.[0] || '0') || 0) : 0;
    Store.addMovie({ ...common, runtime: runtimeMin });
    Store.addActivity({ tmdbId: common.tmdbId, malId: Number(malId), title, type: 'movie', posterPath: poster, action: 'added', detail: 'Added from MAL search', timestamp: now });
    return { type: 'movie', tmdbId: common.tmdbId, anime };
  }

  const eps = Number(anime.episodes) || 0;
  Store.addTvShow({
    ...common,
    totalSeasons: 1,
    totalEpisodes: eps,
    seasons: [{ seasonNumber: 1, episodeCount: eps, episodesWatched: 0, posterPath: poster }],
  });
  Store.addActivity({ tmdbId: common.tmdbId, malId: Number(malId), title, type: 'tv', posterPath: poster, action: 'added', detail: 'Added from MAL search', timestamp: now });
  return { type: 'tv', tmdbId: common.tmdbId, anime };
}

async function showMALDetail(malId, returnMode = 'search') {
  const existingTv = Store.getTvShowByMalId ? Store.getTvShowByMalId(Number(malId)) : null;
  const existingMovie = Store.getMovies().find(m => Number(m.malId) === Number(malId));
  const existing = existingTv || existingMovie;
  if (existing) {
    showDetail(existing.tmdbId, existing.mediaType || (existingMovie ? 'movie' : 'tv'), returnMode || 'search');
    return;
  }
  pMode = 'detail';
  setPopupModeTabs('hidden');
  pReturnMode = returnMode || 'search';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  hidePopupSearchPage();
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Loading MAL details...</div>';

  try {
    const anime = await fetchMALAnimeFull(malId);
    if (!anime) throw new Error('MAL anime not found');
    const isMovie = popupIsMalMovie(anime);
    const title = popupMalTitle(anime);
    const year = popupMalYear(anime);
    const poster = popupMalPoster(anime);
    const score = anime.score ? Number(anime.score).toFixed(1) : '—';
    const genres = (anime.genres || []).slice(0, 4);
    const eps = anime.episodes ? `${anime.episodes} Eps` : '';
    const subInfo = [anime.type || (isMovie ? 'Movie' : 'TV'), year || '', eps, anime.status || ''].filter(Boolean).join(' · ');
    const overview = (anime.synopsis || '').substring(0, 320) + ((anime.synopsis || '').length > 320 ? '...' : '');
    const inList = isMovie ? Store.getMovies().some(m => Number(m.malId) === Number(malId)) : Store.hasTvShowByMalId(Number(malId));

    let relatedHtml = '';
    const validRelTypes = ['Prequel', 'Sequel', 'Parent Story', 'Side Story', 'Spin-off', 'Alternative Version'];
    const rels = [];
    for (const rel of (anime.relations || [])) {
      if (!validRelTypes.includes(rel.relation)) continue;
      for (const entry of (rel.entry || [])) {
        if (entry.type !== 'anime') continue;
        rels.push({ malId: entry.mal_id, title: entry.name || '', relation: rel.relation });
      }
    }
    if (rels.length) {
      relatedHtml = `<div class="pd-section"><div class="pd-section-label">Related MAL Entries</div><div class="pd-related-list">${rels.slice(0, 8).map(r => `<div class="pd-related-card" data-rel-mal="${r.malId}"><span class="pd-related-type">${esc(r.relation)}</span><span class="pd-related-title">${esc(r.title)}</span></div>`).join('')}</div></div>`;
    }

    el.innerHTML = `<div class="pd-wrap">
      <div class="pd-hero">
        <div class="pd-poster">${poster ? `<img src="${poster}">` : `<div class="pd-poster-ph">MAL</div>`}</div>
        <div class="pd-info">
          <div class="pd-title">${esc(title)}</div>
          <div class="pd-sub">MAL Anime · ${esc(subInfo)}</div>
          <div class="pd-genres">${genres.map(g => `<span class="pd-genre-tag">${esc(g.name)}</span>`).join('')}</div>
          <div class="pd-stats"><div><div class="pd-stat-val gold">${score}</div><div class="pd-stat-label">MAL</div></div>${anime.rank ? `<div><div class="pd-stat-val">#${anime.rank}</div><div class="pd-stat-label">Rank</div></div>` : ''}</div>
        </div>
      </div>
      ${overview ? `<div class="pd-overview">${esc(overview)}</div>` : ''}
      ${relatedHtml}
      ${renderPopupQuickLinks(title)}
      <div class="pd-actions">
        <button class="pd-btn pd-btn-open pd-icon-action" id="pdOpenFull" title="Open full details" aria-label="Open full details"><img src="icons/external.svg" alt=""></button>
        ${inList ? '' : `<button class="pd-btn pd-btn-add pd-icon-action" id="pdAddMal" title="Add to Watchlist" aria-label="Add to Watchlist"><img src="icons/watchlist.svg" alt=""></button>`}
      </div>
      <div class="pd-links"><a href="https://myanimelist.net/anime/${malId}" target="_blank">↗ MAL</a></div>
    </div>`;

    bindPopupQuickLinks(el);
    el.querySelector('#pdOpenFull')?.addEventListener('click', () => {
      chrome.tabs.create({ url: `https://myanimelist.net/anime/${malId}` });
    });
    el.querySelectorAll('[data-rel-mal]').forEach(card => card.addEventListener('click', () => showMALDetail(parseInt(card.dataset.relMal), 'search')));

    if (!inList) {
      el.querySelector('#pdAddMal')?.addEventListener('click', async () => {
        const btn = el.querySelector('#pdAddMal'); btn.textContent = 'Adding...'; btn.disabled = true;
        try {
          const added = await popupAddMalToList(Number(malId));
          showDetail(added.tmdbId, added.type, pReturnMode);
        } catch (err) { btn.textContent = 'Error'; }
      });
    }
  } catch (err) {
    el.innerHTML = `<div class="p-search-msg" style="color:var(--pdropped)">Failed: ${esc(err.message)}</div>`;
  }
}

async function showTMDBDetail(tmdbId, mediaType, returnMode = 'list') {
  const existing = mediaType === 'movie' ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
  if (existing) {
    showDetail(tmdbId, mediaType, returnMode || 'search');
    return;
  }
  pMode = 'detail';
  setPopupModeTabs('hidden');
  pReturnMode = returnMode || 'list';
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  hidePopupSearchPage();
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  const el = document.getElementById('pList');
  el.innerHTML = '<div class="p-search-msg">Loading...</div>';

  const isM = mediaType === 'movie';
  try {
    const d = isM ? await TMDB.movieDetails(tmdbId) : await TMDB.tvDetails(tmdbId);
    const title = isM ? d.title : d.name;
    const year = (isM ? d.release_date : d.first_air_date || '').substring(0, 4);
    const poster = TMDB.poster(d.poster_path, 'w185');
    const genres = (d.genres || []).slice(0, 4);
    const score = d.vote_average ? d.vote_average.toFixed(1) : '—';
    const overview = (d.overview || '').substring(0, 250) + ((d.overview || '').length > 250 ? '...' : '');
    const inList = isM ? Store.hasMovie(d.id) : Store.hasTvShow(d.id);
    const imdbId = isM ? (d.imdb_id || null) : (d.external_ids?.imdb_id || null);
    const subInfo = isM
      ? [year, d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : '', d.status].filter(Boolean).join(' · ')
      : [year, `${d.number_of_seasons || '?'} Seasons`, `${d.number_of_episodes || '?'} Eps`, d.status].filter(Boolean).join(' · ');

    const cast = (d.credits?.cast || []).slice(0, 6);
    const castHtml = cast.length ? `<div class="pd-section"><div class="pd-section-label">Cast</div><div class="pd-cast-row">${cast.map(c => {
      const ph = TMDB.profile(c.profile_path, 'w92');
      return `<div class="pd-cast-card">${ph ? `<img src="${ph}" class="pd-cast-img">` : `<div class="pd-cast-ph"></div>`}<div class="pd-cast-name">${esc(c.name)}</div><div class="pd-cast-char">${esc(c.character || '')}</div></div>`;
    }).join('')}</div></div>` : '';

    el.innerHTML = `<div class="pd-wrap">
      <div class="pd-hero">
        <div class="pd-poster">${poster ? `<img src="${poster}">` : `<div class="pd-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div>
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
      ${castHtml}
      ${renderPopupQuickLinks(title)}
      <div class="pd-actions">
        <button class="pd-btn pd-btn-open pd-icon-action" id="pdOpenFull" title="Open full details" aria-label="Open full details"><img src="icons/external.svg" alt=""></button>
        ${inList ? '' : `<button class="pd-btn pd-btn-add pd-icon-action" id="pdAdd" title="Add to Watchlist" aria-label="Add to Watchlist"><img src="icons/watchlist.svg" alt=""></button>`}
      </div>
      <div class="pd-links">
        <a href="https://www.themoviedb.org/${isM ? 'movie' : 'tv'}/${d.id}" target="_blank">&#8599; TMDB</a>
        ${isM ? `<a href="https://letterboxd.com/tmdb/${d.id}/" target="_blank">&#8599; Letterboxd</a>` : ''}
        ${imdbId ? `<a href="https://www.imdb.com/title/${imdbId}" target="_blank">&#8599; IMDb</a>` : ''}
      </div>
    </div>`;

    bindPopupQuickLinks(el);

    el.querySelector('#pdOpenFull')?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + `#detail-${mediaType}-${tmdbId}` }); window.close();
    });

    if (!inList) {
      el.querySelector('#pdAdd').addEventListener('click', async () => {
        const btn = el.querySelector('#pdAdd'); btn.textContent = 'Adding...'; btn.disabled = true;
        try {
          await popupAddTmdbToList(d.id, mediaType);
          showDetail(d.id, mediaType, pReturnMode);
        } catch (err) { btn.textContent = 'Error'; }
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
  const poster = TMDB.poster(posterPath, 'w185');
  const isM = mediaType === 'movie';
  const st = isM ? Store.getMovie(tmdbId) : Store.getTvShow(tmdbId);
  const sOpts = !isM && st ? (st.seasons || []).map(s => `<option value="${s.seasonNumber}">S${s.seasonNumber}</option>`).join('') : '';

  // History
  const entries = Store.getDiary().filter(d => d.tmdbId === tmdbId && d.type === mediaType);
  const aL = { completed: 'Completed', rewatch: 'Rewatched', watched: 'Watched', watched_episodes: 'Watched eps', started: 'Started', session: 'Session' };
  const histHtml = entries.length ? `<div class="pdl-hist"><div class="pdl-hist-head">Diary History (${entries.length})</div>${entries.map(de => {
    const a = aL[de.action] || de.action; const r = de.rating ? ` · ★${de.rating}` : ''; const s = de.season ? ` · S${de.season}` : '';
    return `<div class="pdl-hrow"><div class="pdl-hinfo"><span class="pdl-hdate">${de.date || '—'}</span> <span class="pdl-hact">${a}${s}${r}</span></div><button class="pdl-hedit" data-ts="${de.timestamp}">Edit</button><button class="pdl-hdel" data-tmdb="${de.tmdbId}" data-ts="${de.timestamp}">Remove</button></div>`;
  }).join('')}</div>` : '';

  const html = `<div class="pdl-overlay" id="pdlModal"><div class="pdl-box"><div class="pdl-header popup-dashboard-header"><span>Log Diary</span>${popupDashboardShortcutHTML()}<button class="pdl-close" id="pdlX">&#10005;</button></div><div class="pdl-body">
    <div class="pdl-hero"><div class="pdl-poster">${poster ? `<img src="${poster}">` : `<div class="p-poster-ph">${isM ? 'MOV' : 'TV'}</div>`}</div><div><div class="pdl-name">${esc(title)}</div></div></div>
    <div class="pdl-form">
      <div class="pdl-row"><label>Date</label><input type="date" id="pdlDate" value="${today}" class="pdl-inp"></div>
      <div class="pdl-row2">
        <div class="pdl-row" style="flex:1;"><label>Action</label><select id="pdlAction" class="pdl-inp"><option value="watched">Watched</option><option value="rewatch">Rewatched</option></select></div>
        <div class="pdl-row" style="flex:1;"><label>Rating</label><select id="pdlRating" class="pdl-inp"><option value="0">— None —</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}">★ ${n}/10</option>`).join('')}</select></div>
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
  bindPopupDashboardShortcuts(m);
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
    Store.addDiaryEntry({ mediaId: st?.mediaId || null, tmdbId, malId: st?.malId || null, title, type: mediaType, posterPath, date, action, notes, rating, mood: null, episodes: null, season, timestamp: new Date().toISOString(), syncSource: 'manual' });
    close();
    if (pMode === 'diary') renderPopupDiary();
    else showDetail(tmdbId, mediaType);
  });
}

function popupEditDiaryEntry(timestamp) {
  const entry = Store.getDiaryEntry(timestamp);
  if (!entry) return;
  const isM = entry.type === 'movie';

  const html = `<div class="pdl-overlay" id="pdleModal"><div class="pdl-box"><div class="pdl-header popup-dashboard-header"><span>Edit Entry</span>${popupDashboardShortcutHTML()}<button class="pdl-close" id="pdleX">&#10005;</button></div><div class="pdl-body"><div class="pdl-form">
    <div class="pdl-row"><label>Date</label><input type="date" id="pdleDate" value="${entry.date || ''}" class="pdl-inp"></div>
    <div class="pdl-row2">
      <div class="pdl-row" style="flex:1;"><label>Action</label><select id="pdleAction" class="pdl-inp"><option value="watched" ${entry.action === 'watched' ? 'selected' : ''}>Watched</option><option value="rewatch" ${entry.action === 'rewatch' ? 'selected' : ''}>Rewatched</option></select></div>
      <div class="pdl-row" style="flex:1;"><label>Rating</label><select id="pdleRating" class="pdl-inp"><option value="0">— None —</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}" ${entry.rating === n ? 'selected' : ''}>★ ${n}/10</option>`).join('')}</select></div>
    </div>
    <div class="pdl-row"><label>Notes</label><textarea id="pdleNotes" class="pdl-inp pdl-ta" rows="2">${esc(entry.notes || '')}</textarea></div>
    <div style="display:flex;gap:6px;"><button class="pdl-save" id="pdleSave" style="flex:1;">Save</button><button class="pdl-back" id="pdleBack">Back</button></div>
  </div></div></div></div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const m = document.getElementById('pdleModal');
  const close = () => m.remove();
  bindPopupDashboardShortcuts(m);
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



function popupClampHex(hex, fallback) {
  const v = String(hex || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

function popupHexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function popupRgbToHex({ r, g, b }) {
  const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function popupMix(hex, amt) {
  const c = popupHexToRgb(hex);
  const target = amt >= 0 ? 255 : 0;
  const p = Math.abs(amt) / 100;
  return popupRgbToHex({ r: c.r + (target - c.r) * p, g: c.g + (target - c.g) * p, b: c.b + (target - c.b) * p });
}

function popupCustomThemeVars({ bg, surface, accent, text }) {
  bg = popupClampHex(bg, '#130F1C');
  surface = popupClampHex(surface, '#1E182D');
  accent = popupClampHex(accent, '#8B5CF6');
  text = popupClampHex(text, '#F8F8F2');
  return {
    bg0: bg,
    bg1: popupMix(bg, 8),
    bg2: surface,
    bg3: popupMix(surface, 10),
    bg4: popupMix(surface, 20),
    accent,
    accentL: popupMix(accent, 20),
    text0: text,
    text1: popupMix(text, -15),
    text2: popupMix(text, -35),
    text3: popupMix(text, -55),
    border: 'rgba(255,255,255,0.08)',
  };
}

function enterPopupSettingsMode() {
  pMode = 'settings';
  setPopupModeTabs('hidden');
  hidePopupSearchPage();
  document.getElementById('pBack').classList.remove('hidden');
  document.getElementById('pControls').classList.add('hidden');
  document.getElementById('pSearchBtn').classList.add('hidden');
  document.getElementById('pAddNew')?.classList.add('hidden');
  document.getElementById('pDiaryBtn').classList.add('hidden');
  document.getElementById('pLineupBtn')?.classList.add('hidden');
  document.getElementById('pRecBtn')?.classList.add('hidden');
  document.getElementById('pEmpty').classList.add('hidden');
  document.getElementById('pList').classList.add('hidden');
  const panel = document.getElementById('pInlineSettings');
  document.querySelector('.p-footer')?.classList.add('hidden');
  panel.classList.remove('hidden');
  chrome.storage.local.get(['syncConfig', 'lastBackgroundSync'], ({ syncConfig = {}, lastBackgroundSync = null }) => {
    const savedTheme = Store.getTheme() || { preset: 'midnight' };
    const lastSummary = lastBackgroundSync?.finishedAt
      ? `Last background sync: ${new Date(lastBackgroundSync.finishedAt).toLocaleString()} · +${lastBackgroundSync.added || 0} added, ${lastBackgroundSync.updated || 0} updated, ${lastBackgroundSync.diaryAdded || 0} diary`
      : 'No background sync has run yet.';
    const themeOptions = [['midnight','Midnight (Default)'],['oled','OLED Black'],['ocean','Deep Ocean'],['nord','Nord'],['sakura','Sakura Night'],['matcha','Matcha'],['cloud','Cloud'],['latte','Latte'],['custom','Custom']];
    const themeValue = savedTheme.custom ? 'custom' : (savedTheme.preset || 'midnight');
    const c = savedTheme.custom || {};
    panel.innerHTML = `<div class="pis-wrap">
      <div class="pis-head"><div><h2>Settings</h2><p>Quick controls only. Full setup stays in More Settings.</p></div></div>

      <div class="pis-card">
        <label>Theme</label>
        <select id="pisTheme">
          ${themeOptions.map(([v,l]) => `<option value="${v}" ${themeValue===v?'selected':''}>${l}</option>`).join('')}
        </select>
        <div id="pisCustomTheme" class="pis-custom-theme ${themeValue === 'custom' ? '' : 'hidden'}">
          <div class="pis-color-row"><label>Background<input id="pisBg" type="color" value="${esc(c.bg0 || '#130F1C')}"></label><label>Surface<input id="pisSurface" type="color" value="${esc(c.bg2 || '#1E182D')}"></label></div>
          <div class="pis-color-row"><label>Accent<input id="pisAccent" type="color" value="${esc(c.accent || '#8B5CF6')}"></label><label>Text<input id="pisText" type="color" value="${esc(c.text0 || '#F8F8F2')}"></label></div>
        </div>
      </div>

      <div class="pis-card">
        <label>Sync</label>
        <div class="pis-sync-grid">
          <button id="pisSyncLetterboxd" type="button">Sync Letterboxd</button>
          <button id="pisSyncMal" type="button">Sync MAL</button>
        </div>
        <button id="pisSyncNow" type="button" class="pis-secondary-full pis-sync-all">Sync All</button>
        <div class="pis-note">Usernames, API keys, and MAL login are managed from More Settings.</div>
      </div>

      <div class="pis-card">
        <label>Auto-sync interval</label>
        <select id="pisInterval">
          ${[[0,'Off'],[30,'Every 30 minutes'],[60,'Hourly'],[180,'Every 3 hours'],[360,'Every 6 hours'],[720,'Every 12 hours'],[1440,'Daily']].map(([v,l]) => `<option value="${v}" ${Number(syncConfig.syncInterval || 0)===v?'selected':''}>${l}</option>`).join('')}
        </select>
        <div class="pis-last pis-last-plain">${esc(lastSummary)}</div>
      </div>

      <div id="pisStatus" class="pis-status"></div>
      <div class="pis-footer pis-footer-single"><button id="pisOpenFull" type="button">More Settings</button></div>
    </div>`;

    bindPopupDashboardShortcuts(panel);

    const applyCustomFromPopup = () => {
      const vars = popupCustomThemeVars({
        bg: panel.querySelector('#pisBg')?.value,
        surface: panel.querySelector('#pisSurface')?.value,
        accent: panel.querySelector('#pisAccent')?.value,
        text: panel.querySelector('#pisText')?.value,
      });
      const current = Store.getTheme() || {};
      Store.setTheme({ ...current, preset: null, custom: vars });
      applyPopupTheme();
    };

    panel.querySelector('#pisTheme').addEventListener('change', e => {
      const current = Store.getTheme() || {};
      const customBox = panel.querySelector('#pisCustomTheme');
      if (e.target.value === 'custom') {
        customBox?.classList.remove('hidden');
        applyCustomFromPopup();
      } else {
        customBox?.classList.add('hidden');
        Store.setTheme({ ...current, preset: e.target.value, custom: null });
        applyPopupTheme();
      }
    });
    panel.querySelector('#pisApplyCustom')?.addEventListener('click', applyCustomFromPopup);
    panel.querySelectorAll('#pisBg,#pisSurface,#pisAccent,#pisText').forEach(input => input.addEventListener('input', () => {
      if (panel.querySelector('#pisTheme')?.value === 'custom') applyCustomFromPopup();
    }));

    panel.querySelector('#pisInterval').addEventListener('change', () => {
      chrome.storage.local.set({ syncConfig: {
        ...syncConfig,
        syncInterval: Number(panel.querySelector('#pisInterval').value || 0),
      }}, () => {
        chrome.runtime.sendMessage({ type: 'watchtracker:refresh-sync-alarm' }, () => {});
        panel.querySelector('#pisStatus').textContent = 'Auto-sync interval saved.';
      });
    });

    const runPopupSync = (source, label) => {
      const status = panel.querySelector('#pisStatus');
      status.textContent = `Syncing ${label} in background...`;
      chrome.runtime.sendMessage({ type: 'watchtracker:run-sync-now', source }, res => {
        const body = res?.body;
        status.textContent = body ? `${label} done: ${body.added || 0} added, ${body.updated || 0} updated, ${body.diaryAdded || 0} diary entries${body.errors?.length ? ' · ' + body.errors.join(' · ') : ''}` : `${label} sync request failed.`;
      });
    };

    panel.querySelector('#pisSyncLetterboxd').addEventListener('click', () => runPopupSync('letterboxd', 'Letterboxd'));
    panel.querySelector('#pisSyncMal').addEventListener('click', () => runPopupSync('mal', 'MAL'));
    panel.querySelector('#pisSyncNow').addEventListener('click', () => runPopupSync('all', 'All sources'));
    panel.querySelector('#pisOpenFull').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + '#settings' }); window.close();
    });
    bindPopupDashboardShortcuts(panel);
  });
}

/* ─── Helpers ─── */
function getPct(i) {
  if (i.mediaType === 'tv') {
    const ss = i.seasons || []; const w = ss.reduce((s, se) => s + (se.episodesWatched || 0), 0);
    const t = ss.reduce((s, se) => s + (se.episodeCount || 0), 0);
    return t === 0 && w > 0 ? 90 : (t > 0 ? Math.round(w / t * 100) : 0);
  }
  return i.watchStatus === 'completed' ? 100 : i.watchStatus === 'watching' ? 40 : 0;
}
function getEps(i) {
  if (i.mediaType !== 'tv') return '';
  const ss = i.seasons || []; const w = ss.reduce((s, se) => s + (se.episodesWatched || 0), 0);
  const t = ss.reduce((s, se) => s + (se.episodeCount || 0), 0);
  return `${w}<span class="p-eps-total">/${t || '?'}</span>`;
}
function esc(s) { if (!s) return ''; const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }
