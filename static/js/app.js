/* app.js — Global utilities: toast, log panel, session reset, keyboard shortcuts */

// ── Toast ──────────────────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(_toastTimer);
  const colors = { success: '#1fab6e', error: '#e05555', warn: '#d48a0c', info: '#7c6ef5' };
  el.textContent = msg;
  el.style.borderColor = colors[type] || colors.info;
  el.classList.add('show');
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Log panel ──────────────────────────────────────────────────────────────
function toggleLog() {
  const panel = document.getElementById('log-panel');
  const open  = panel.style.display === 'none';
  panel.style.display = open ? 'flex' : 'none';
  if (open) refreshLog();
}

async function refreshLog() {
  try {
    const res = await fetch('/log');
    const txt = await res.text();
    const el  = document.getElementById('log-content');
    if (el) { el.textContent = txt; el.scrollTop = el.scrollHeight; }
  } catch(e) {
    Logger.error('Log', `Fetch failed: ${e.message}`);
  }
}

function downloadLog() {
  fetch('/log').then(r => r.text()).then(txt => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = 'app.log'; a.click();
    Logger.info('Log', 'Downloaded app.log');
  });
}

// ── Session reset ──────────────────────────────────────────────────────────
async function resetSession() {
  if (!confirm('Reset session? All uploaded files and room state will be cleared.')) return;
  Logger.info('App', 'Session reset requested');
  try {
    await fetch('/reset', { method: 'POST' });
    window.location.reload();
  } catch(e) {
    window.location.reload();
  }
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

  // Escape — close panels
  if (e.key === 'Escape') {
    document.getElementById('collab-panel').style.display = 'none';
    document.getElementById('log-panel').style.display    = 'none';
    document.getElementById('btn-collab').classList.remove('active');
    document.querySelector('.pdf-annot-tooltip')?.remove();
  }
  // Ctrl+O — open file
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault(); triggerUpload();
  }
  // Ctrl+D — toggle draw
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault(); toggleDraw();
  }
  // Ctrl+K — toggle canvas
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault(); toggleCanvas();
  }
  // Ctrl+` — toggle log
  if ((e.ctrlKey || e.metaKey) && e.key === '`') {
    e.preventDefault(); toggleLog();
  }
});

// ── Session timer ──────────────────────────────────────────────────────────
(function() {
  const start = Date.now();
  const el = document.createElement('span');
  // Add to topbar right if present
  document.addEventListener('DOMContentLoaded', () => {
    const tr = document.querySelector('.topbar-right');
    if (tr) {
      el.style.cssText = 'font-size:10px;color:var(--text-3);font-family:var(--mono);padding:0 4px';
      tr.prepend(el);
    }
    function tick() {
      const s = Math.floor((Date.now()-start)/1000);
      el.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }
    tick(); setInterval(tick, 1000);
  });
})();

Logger.info('App', 'App.js loaded — ready', {
  shortcuts: { 'Ctrl+O':'Open file','Ctrl+D':'Draw','Ctrl+K':'Canvas','Ctrl+`':'Log','Esc':'Close panels' }
});

// ── Landing page collaborate helpers ──────────────────────────────────────
function landingJoin() {
  const name = (document.getElementById('lp-name')?.value || '').trim();
  const room = (document.getElementById('lp-room')?.value || '').trim();
  if (!name) { toast('Enter your name first'); document.getElementById('lp-name')?.focus(); return; }
  if (!room) { toast('Enter a room ID');        document.getElementById('lp-room')?.focus(); return; }

  // Show the main app
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('app').style.display           = 'flex';

  // Wait for collab.js to finish building the panel, then connect
  setTimeout(() => {
    // Fill panel inputs so they show correctly if user opens the panel
    const ni = document.getElementById('collab-name');
    const ri = document.getElementById('collab-room');
    if (ni) ni.value = name;
    if (ri) ri.value = room;

    // Open panel
    const panel = document.getElementById('collab-panel');
    if (panel) panel.style.display = 'flex';
    document.getElementById('btn-collab')?.classList.add('active');

    // Pass name+room directly — don't rely on DOM inputs being ready
    if (typeof collabConnect === 'function') {
      collabConnect(name, room);
    }
    Logger.info('Landing', `Join: name="${name}" room="${room}"`);
  }, 200);
}

function landingGenRoom() {
  const id  = Math.random().toString(36).slice(2, 8).toUpperCase();
  const lp  = document.getElementById('lp-room');
  const cp  = document.getElementById('collab-room');
  if (lp) { lp.value = id; lp.focus(); }
  if (cp) cp.value = id;
}

// Restore saved name in landing collab card
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('fs_collab_name');
  if (saved) {
    const inp = document.getElementById('lp-name');
    if (inp) inp.value = saved;
  }
});

// ── Add current viewer file to whiteboard canvas ──────────────────────────
function addCurrentToCanvas() {
  const entry = Tabs.getActive();
  if (!entry) { toast('Open a file first, then click this to add it to the canvas', 'warn'); return; }
  if (typeof Whiteboard !== 'undefined') {
    Whiteboard.addFileCard(entry);
    toast(`📌 ${entry.name} added to canvas`);
    Logger.info('App', `Added to canvas: ${entry.name}`);
  }
}
