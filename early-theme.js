(() => {
  const CACHE_KEY = 'watchtracker-theme-cache-v1';
  const PRESETS = {
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
  function paletteFromTheme(theme) {
    const t = theme || { preset: 'midnight' };
    return t.custom || PRESETS[t.preset] || PRESETS.midnight;
  }
  function apply(p){
    if(!p) return;
    const r=document.documentElement.style;
    const popup=location.pathname.endsWith('popup.html');
    if(popup){
      r.setProperty('--pbg-0',p.bg0); r.setProperty('--pbg-1',p.bg1); r.setProperty('--pbg-2',p.bg2); r.setProperty('--pbg-3',p.bg3); r.setProperty('--pbg-4',p.bg4); r.setProperty('--pborder',p.border);
      r.setProperty('--ptext-0',p.text0); r.setProperty('--ptext-1',p.text1); r.setProperty('--ptext-2',p.text2); r.setProperty('--ptext-3',p.text3);
      r.setProperty('--paccent',p.accent); r.setProperty('--paccent-l',p.accentL);
      r.setProperty('--text-color',p.text0); r.setProperty('--accent-color',p.accent);
    } else {
      r.setProperty('--bg-0',p.bg0); r.setProperty('--bg-1',p.bg1); r.setProperty('--bg-2',p.bg2); r.setProperty('--bg-3',p.bg3); r.setProperty('--bg-4',p.bg4); r.setProperty('--border',p.border);
      r.setProperty('--text-0',p.text0); r.setProperty('--text-1',p.text1); r.setProperty('--text-2',p.text2); r.setProperty('--text-3',p.text3);
      r.setProperty('--accent',p.accent); r.setProperty('--accent-light',p.accentL); r.setProperty('--accent-glow',p.accent+'22');
      r.setProperty('--text-color',p.text0); r.setProperty('--accent-color',p.accent);
    }
    document.documentElement.style.background = p.bg0;
  }
  function cacheTheme(theme) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(theme || { preset: 'midnight' })); } catch (_) {}
  }
  function done(){ document.documentElement.classList.remove('theme-pending'); }

  // Synchronous first paint: use the last saved theme mirror immediately, before CSS paints.
  let hadCache = false;
  try {
    const cached = localStorage.getItem(CACHE_KEY) || localStorage.getItem('watchtracker-theme');
    if (cached) {
      hadCache = true;
      apply(paletteFromTheme(JSON.parse(cached)));
      done();
    }
  } catch (_) {}

  // Authoritative Chrome storage check. If there was no cache, keep the UI hidden until this returns
  // so users never see the default theme before their selected theme is applied.
  try {
    chrome.storage.local.get(['theme'], ({theme}) => {
      const t = theme || {preset:'midnight'};
      cacheTheme(t);
      apply(paletteFromTheme(t));
      done();
    });
  } catch (_) {
    if (!hadCache) apply(PRESETS.midnight);
    done();
  }

  // Last-resort fail-safe only. It uses the current CSS variables/palette, not a default repaint.
  setTimeout(() => { if (document.documentElement.classList.contains('theme-pending')) done(); }, 2000);
})();
