/* collab.js — Document Studio real-time collaboration
   Pattern: hook-based callbacks (window.onStrokeAdded, etc.) — no flag polling.
   Each module calls a hook → collab.js emits the specific event → 
   server relays → peers receive and apply.
   Separate _applyingRemote flags per channel prevent re-broadcast loops.
*/

const COLLAB_COLORS = ['#2563EB','#D97706','#7C3AED','#1A8F6F','#E05A3A','#0891B2','#BE185D','#EA580C','#0D9488','#4338CA'];

let _myColor   = COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)];
let _myName    = '';
let _room      = 'main';
let _socket    = null;
let _connected = false;
let _joined    = false;
let _peersEl   = {};   // sid → cursor DOM
let _peerInfo  = {};   // sid → {name, color}

// Per-channel remote-apply guards — prevent re-broadcast when applying peer data
let _applyingDraw = false;
let _applyingWB   = false;
let _applyingDoc  = false;

let _wbSyncTimer  = null;
let _followScroll = false;

// ── Build panel ────────────────────────────────────────────────────────────
function _buildCollabPanel() {
  if (document.getElementById('collab-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'collab-panel';
  panel.style.cssText = 'position:fixed;top:52px;right:16px;width:280px;background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.6);z-index:1000;display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif;';
  panel.innerHTML = `
    <div style="padding:12px 16px;background:rgba(249,115,22,0.12);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-weight:700;font-size:13px;color:#fff">👥 Collaborate</div>
        <div id="collab-status-line" style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">Not connected</div>
      </div>
      <button onclick="toggleCollabPanel()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;line-height:1;padding:0">✕</button>
    </div>
    <div id="collab-join-form" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.35);margin-bottom:5px">Your name</div>
        <input id="collab-name" value="" placeholder="Enter your name…" style="width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:7px 10px;color:#fff;font-family:inherit;font-size:12px;outline:none;box-sizing:border-box">
      </div>
      <div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.35);margin-bottom:5px">Room ID</div>
        <input id="collab-room" value="${_room}" placeholder="main" style="width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:7px 10px;color:#fff;font-family:inherit;font-size:12px;outline:none;box-sizing:border-box" onkeydown="if(event.key==='Enter')collabConnect()">
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.35)">Color</div>
        <input type="color" id="collab-color" value="${_myColor}" style="width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);cursor:pointer;padding:0;background:none;flex-shrink:0">
        <div style="flex:1"></div>
        <button id="collab-connect-btn" onclick="collabConnect()" style="padding:7px 18px;background:#f97316;color:#fff;border:none;border-radius:6px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer">Join</button>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="collabCopyLink()" style="flex:1;padding:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.5);font-family:inherit;font-size:11px;cursor:pointer">🔗 Copy link</button>
        <button onclick="collabGenRoom()" style="flex:1;padding:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.5);font-family:inherit;font-size:11px;cursor:pointer">🎲 Random room</button>
      </div>
    </div>
    <div id="collab-session" style="display:none;flex-direction:column">
      <div style="padding:10px 16px;border-top:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.3);margin-bottom:8px">In this room</div>
        <div id="collab-peers-inner"></div>
      </div>
      <div style="padding:6px 16px 12px;display:flex;gap:8px">
        <button id="cp-follow-btn" onclick="collabToggleFollow()" style="flex:1;padding:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.5);font-family:inherit;font-size:11px;cursor:pointer">👁 Follow scroll</button>
        <button onclick="collabDisconnect()" style="padding:6px 14px;background:rgba(224,90,58,0.12);border:1px solid rgba(224,90,58,0.3);border-radius:6px;color:#f87155;font-family:inherit;font-weight:700;font-size:11px;cursor:pointer">Leave</button>
      </div>
    </div>
    <div style="padding:5px 16px 8px;font-size:9px;color:rgba(255,255,255,0.18);border-top:1px solid rgba(255,255,255,0.06)">Share the room ID with others to collaborate</div>`;
  document.body.appendChild(panel);
  document.addEventListener('click', e => {
    if (!e.target.closest('#collab-panel') && !e.target.closest('#btn-collab'))
      panel.style.display = 'none';
  });
}

function toggleCollabPanel() {
  const p = document.getElementById('collab-panel');
  if (!p) { _buildCollabPanel(); setTimeout(toggleCollabPanel, 10); return; }
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
  document.getElementById('btn-collab')?.classList.toggle('active', p.style.display === 'flex');
}

// ── Connect ────────────────────────────────────────────────────────────────
function collabConnect(forceName, forceRoom) {
  _myName  = forceName || (document.getElementById('collab-name')?.value || '').trim() || _myName;
  _room    = forceRoom || (document.getElementById('collab-room')?.value || '').trim() || 'main';
  _myColor = document.getElementById('collab-color')?.value || _myColor;
  localStorage.setItem('fs_collab_color', _myColor);

  if (!_myName) { toast('Enter your name first'); return; }

  // Clean up any existing connection
  if (_socket) { try { _socket.removeAllListeners(); _socket.disconnect(); _socket.close(); } catch(e){} _socket = null; }
  _fullyResetPeers();
  _connected = false; _joined = false;

  const btn = document.getElementById('collab-connect-btn');
  if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
  _setStatus('Connecting…', '#f59e0b');

  const ioFn = window.io || window._io;
  if (!ioFn) { _setStatus('Socket.IO not loaded', '#ef4444'); if (btn) { btn.textContent = 'Join'; btn.disabled = false; } return; }

  _socket = ioFn({ transports: ['polling', 'websocket'], reconnection: false });

  _socket.on('connect', () => {
    console.log('[collab] Socket connected, joining room…', _room, _myName);
    _socket.emit('join', { room: _room, name: _myName, color: _myColor });
  });

  _socket.on('joined_ack', ack => {
    try {
      _connected = true; _joined = true;
      _myColor = ack.color || _myColor;
      const cpicker = document.getElementById('collab-color');
      if (cpicker) cpicker.value = _myColor;
      if (btn) { btn.textContent = 'Connected ✓'; btn.disabled = false; }
      _setStatus(`Room: "${_room}"`, '#10b981');
      const jf = document.getElementById('collab-join-form');
      const ss = document.getElementById('collab-session');
      if (jf) jf.style.display = 'none';
      if (ss) ss.style.display = 'flex';
      _updatePeersList([]);
      _refreshAvatarStrip();
      _startCursorBroadcast();
      document.getElementById('btn-collab')?.classList.add('active');
      try { const u = new URL(window.location.href); u.searchParams.set('room', _room); window.history.replaceState({}, '', u.toString()); } catch(e) {}
      toast(`✅ Joined room "${_room}"`);
      Logger.info('Collab', `Joined room="${_room}" as "${_myName}"`);
      // Init sync module (handles all state sync)
      if (typeof window.syncInit === 'function') {
        window.syncInit(_socket, _room);
      }
    } catch(err) {
      Logger.error('Collab', `joined_ack error: ${err.message}`);
    }
  });

  _socket.on('connect_error', err => {
    _setStatus('Failed: ' + err.message, '#ef4444');
    if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
    toast('❌ Connection failed — is Flask running?');
  });

  _socket.on('disconnect', () => {
    _connected = false; _joined = false;
    _setStatus('Disconnected', '#ef4444');
    _fullyResetPeers(); _clearAvatarStrip();
  });

  // ── Room membership ──────────────────────────────────────────────────────
  _socket.on('snapshot', data => {
    const peers = data.peers || [];
    Logger.info('Collab', `Snapshot: ${peers.length} peers`);
    _fullyResetPeers();
    peers.forEach(p => { _peerInfo[p.sid] = { name: p.name, color: p.color }; _createCursor(p.sid, p.name, p.color); });
    _updatePeersList(peers);
    _refreshAvatarStrip();
  });

  _socket.on('peer_joined', d => {
    Logger.info('Collab', `Peer joined: ${d.name}`);
    _fullyRemovePeer(d.sid);
    Object.keys(_peerInfo).forEach(sid => { if (_peerInfo[sid]?.name === d.name) _fullyRemovePeer(sid); });
    _peerInfo[d.sid] = { name: d.name, color: d.color };
    _createCursor(d.sid, d.name, d.color);
    _addPeerToList(d);
    _refreshAvatarStrip();
    toast(`👤 ${d.name} joined`);
    // Send them current state
    setTimeout(_broadcastFullState, 600);
  });

  _socket.on('peer_left', d => {
    Logger.info('Collab', `Peer left: ${d.name}`);
    _fullyRemovePeer(d.sid);
    _refreshAvatarStrip();
    toast(`👤 ${d.name} left`);
  });

  _socket.on('cursor', d => { if (d.sid !== _socket?.id) _moveCursor(d.sid, d.x, d.y); });

  // ── SYNC: Document open ──────────────────────────────────────────────────
  _socket.on('sync_doc', data => {
    if (!data.entry || _applyingDoc) return;
    Logger.info('Sync', `sync_doc: ${data.entry.name}`);
    _applyingDoc = true;
    try {
      if (typeof Tabs !== 'undefined') { Tabs.add(data.entry); Tabs.activate(data.entry.id); }
    } finally { setTimeout(() => { _applyingDoc = false; }, 400); }
    _syncBanner(`📂 ${data.peerName||'Peer'} opened "${data.entry.name}"`);
  });

  // ── SYNC: Draw strokes (document viewer overlay) ─────────────────────────
  // Reference pattern: server relays canvas_stroke_add → apply via _applyStrokeAdd
  _socket.on('sync_draw_stroke', data => {
    if (!data.stroke || _applyingDraw) return;
    console.log('[collab] recv sync_draw_stroke pts=', data.stroke.points?.length);
    Logger.debug('Sync', `sync_draw_stroke pts=${data.stroke.points?.length}`);
    _applyingDraw = true;
    try {
      if (typeof Draw !== 'undefined') Draw.replayStroke(data.stroke);
    } finally { setTimeout(() => { _applyingDraw = false; }, 30); }
  });

  _socket.on('sync_draw_clear', () => {
    if (_applyingDraw) return;
    _applyingDraw = true;
    try { if (typeof Draw !== 'undefined') Draw.clearRemote(); }
    finally { _applyingDraw = false; }
  });

  // ── SYNC: Whiteboard canvas ──────────────────────────────────────────────
  _socket.on('sync_whiteboard', data => {
    if (!data.state || _applyingWB) return;
    console.log('[collab] recv sync_whiteboard', data.state.elements?.length, 'el', data.state.strokes?.length, 'strokes');
    Logger.debug('Sync', `sync_whiteboard: ${data.state.elements?.length||0} el`);
    _applyingWB = true;
    try { if (typeof Whiteboard !== 'undefined') Whiteboard.applyRemoteState(data.state); }
    finally { setTimeout(() => { _applyingWB = false; }, 150); }
  });

  // ── SYNC: Scroll ─────────────────────────────────────────────────────────
  _socket.on('sync_scroll', data => {
    if (!_followScroll) return;
    const el = document.querySelector(data.selector);
    if (el) { el.scrollTop = data.scrollTop; el.scrollLeft = data.scrollLeft; }
  });

  // ── SYNC: Full state for new joiners ─────────────────────────────────────
  _socket.on('sync_state_response', data => {
    Logger.info('Sync', `State: ${data.whiteboard?.elements?.length||0} wb, ${data.drawStrokes?.length||0} draw`);
    try {
      if (data.whiteboard && typeof Whiteboard !== 'undefined') {
        _applyingWB = true;
        Whiteboard.applyRemoteState(data.whiteboard);
        setTimeout(() => { _applyingWB = false; }, 200);
      }
      if (data.drawStrokes?.length && typeof Draw !== 'undefined') {
        _applyingDraw = true;
        data.drawStrokes.forEach(s => Draw.replayStroke(s));
        setTimeout(() => { _applyingDraw = false; }, 200);
      }
      if (data.activeFile && typeof Tabs !== 'undefined') {
        _applyingDoc = true;
        Tabs.add(data.activeFile); Tabs.activate(data.activeFile.id);
        setTimeout(() => { _applyingDoc = false; }, 400);
      }
    } catch(e) { Logger.error('Sync', `state_response error: ${e.message}`); }
  });

  _socket.on('request_sync_state', () => { setTimeout(_broadcastFullState, 200); });
  _socket.on('chat', msg => _appendChat(msg.name, msg.text, msg.color, msg.sid === _socket?.id));
}


// ── Broadcast full state ───────────────────────────────────────────────────
function _broadcastFullState() {
  if (!_connected || !_socket?.connected) return;
  try {
    const payload = { room: _room };
    if (typeof Whiteboard !== 'undefined') payload.whiteboard  = JSON.parse(JSON.stringify(Whiteboard.getState()));
    if (typeof Draw !== 'undefined')       payload.drawStrokes = JSON.parse(JSON.stringify(Draw.getStrokes?.() || []));
    if (typeof Tabs !== 'undefined')       { const a = Tabs.getActive?.(); if (a) payload.activeFile = a; }
    Logger.debug('Sync', `Full state: ${payload.whiteboard?.elements?.length||0} wb, ${payload.drawStrokes?.length||0} draw`);
    _socket.emit('sync_state_response', payload);
  } catch(e) { Logger.error('Sync', `broadcastFullState error: ${e.message}`); }
}

// ── Outbound sync (called from whiteboard.js, tabs.js) ────────────────────
function collabSyncDoc(entry) {
  // Route through sync.js hook
  if (!window.syncIsApplying?.() && typeof window.onDocOpened === 'function') {
    window.onDocOpened(entry, _myName);
  }
}

// Whiteboard canvas sync (throttled)

function collabSyncScroll(selector, scrollTop, scrollLeft) {
  if (!_connected || !_followScroll || !_socket?.connected) return;
  _socket.emit('sync_scroll', { room: _room, selector, scrollTop, scrollLeft });
}


// ── Disconnect ─────────────────────────────────────────────────────────────
function collabDisconnect() {
  // Destroy sync module
  if (typeof window.syncDestroy === 'function') window.syncDestroy();
  if (_socket) { try { _socket.removeAllListeners(); _socket.disconnect(); } catch(e){} _socket = null; }
  _connected = false; _joined = false;
  _fullyResetPeers(); _clearAvatarStrip();
  _setStatus('Not connected', 'rgba(255,255,255,0.4)');
  const btn = document.getElementById('collab-connect-btn');
  if (btn) { btn.textContent = 'Join'; btn.disabled = false; }
  const jf = document.getElementById('collab-join-form'), ss = document.getElementById('collab-session');
  if (jf) jf.style.display = 'flex'; if (ss) ss.style.display = 'none';
  document.getElementById('btn-collab')?.classList.remove('active');
  try { const u = new URL(window.location.href); u.searchParams.delete('room'); window.history.replaceState({}, '', u.toString()); } catch(e) {}
  toast('👋 Left room');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function collabCopyLink() {
  const room = (document.getElementById('collab-room')?.value || _room).trim();
  const url = new URL(window.location.href); url.searchParams.set('room', room);
  navigator.clipboard.writeText(url.toString()).then(() => toast('🔗 Room link copied!')).catch(() => toast('Copy URL manually'));
}
function collabGenRoom() {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const i1 = document.getElementById('collab-room'), i2 = document.getElementById('lp-room');
  if (i1) { i1.value = id; i1.focus(); } if (i2) i2.value = id;
}
function collabSendChat() {
  const inp = document.getElementById('cp-chat-input'), text = (inp?.value||'').trim();
  if (!text || !_connected) return; inp.value = '';
  _socket?.emit('chat', { room: _room, text, color: _myColor });
}

// ── Peer management ────────────────────────────────────────────────────────
function _fullyResetPeers() { Object.keys(_peerInfo).forEach(s => _fullyRemovePeer(s)); }
function _fullyRemovePeer(sid) {
  if (_peersEl[sid]) { _peersEl[sid].remove(); delete _peersEl[sid]; }
  delete _peerInfo[sid];
  document.querySelectorAll(`[data-collab-sid="${sid}"]`).forEach(el => el.remove());
}

function _updatePeersList(peers) {
  const inner = document.getElementById('collab-peers-inner'); if (!inner) return;
  inner.innerHTML = '';
  _addPeerToList({ sid: 'me', name: _myName + ' (you)', color: _myColor });
  peers.forEach(p => _addPeerToList(p));
}
function _addPeerToList(peer) {
  const inner = document.getElementById('collab-peers-inner');
  if (!inner || inner.querySelector(`[data-collab-sid="${peer.sid}"]`)) return;
  const el = document.createElement('div');
  el.dataset.collabSid = peer.sid;
  el.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  el.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${peer.color||'#888'};flex-shrink:0"></span><span style="font-size:12px;color:rgba(255,255,255,0.75)">${_esc(peer.name)}</span>`;
  inner.appendChild(el);
}

// ── Avatar strip ───────────────────────────────────────────────────────────
function _ensureAvatarStrip() {
  if (document.getElementById('collab-avatars')) return;
  const strip = document.createElement('div');
  strip.id = 'collab-avatars';
  strip.style.cssText = 'display:none;align-items:center;gap:0;flex-shrink:0;';
  document.getElementById('btn-collab')?.parentElement?.insertBefore(strip, document.getElementById('btn-collab'));
}
function _refreshAvatarStrip() {
  _ensureAvatarStrip();
  const strip = document.getElementById('collab-avatars'); if (!strip) return;
  while (strip.firstChild) strip.removeChild(strip.firstChild);
  if (!_connected) { strip.style.display = 'none'; return; }
  const all = [{ sid:'me', name:_myName, color:_myColor, isMe:true }, ...Object.entries(_peerInfo).map(([sid,info]) => ({ sid, ...info, isMe:false }))];
  strip.style.display = all.length ? 'flex' : 'none';
  all.slice(0, 6).forEach((p, i) => {
    const av = document.createElement('div');
    const initials = p.name.split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
    av.title = p.name + (p.isMe ? ' (you)' : '');
    av.dataset.avatarSid = p.sid;
    av.style.cssText = `width:26px;height:26px;border-radius:50%;background:${p.color};color:#fff;font-weight:700;font-size:10px;display:flex;align-items:center;justify-content:center;border:2px solid ${p.isMe?'#fff':'rgba(255,255,255,0.3)'};margin-left:${i===0?'0':'-7px'};cursor:default;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,0.3);z-index:${6-i};position:relative;transition:transform .12s;`;
    av.textContent = initials || '?';
    av.addEventListener('mouseenter', () => { av.style.transform='translateY(-3px) scale(1.1)'; av.style.zIndex='99'; });
    av.addEventListener('mouseleave', () => { av.style.transform=''; av.style.zIndex=String(6-i); });
    strip.appendChild(av);
  });
  if (all.length > 6) {
    const more = document.createElement('div');
    more.style.cssText = 'height:26px;border-radius:13px;background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 7px;margin-left:-7px;border:2px solid rgba(255,255,255,0.2);flex-shrink:0;';
    more.textContent = '+' + (all.length - 6);
    strip.appendChild(more);
  }
}
function _clearAvatarStrip() {
  const strip = document.getElementById('collab-avatars'); if (!strip) return;
  strip.style.display = 'none';
  while (strip.firstChild) strip.removeChild(strip.firstChild);
  Object.keys(_peersEl).forEach(sid => { _peersEl[sid]?.remove(); delete _peersEl[sid]; });
  Object.keys(_peerInfo).forEach(k => delete _peerInfo[k]);
}

// ── Cursors ────────────────────────────────────────────────────────────────
function _createCursor(sid, name, color) {
  if (_peersEl[sid]) return;
  const el = document.createElement('div');
  el.id = 'pcursor-' + sid;
  el.style.cssText = 'position:fixed;z-index:9000;pointer-events:none;display:flex;align-items:center;gap:4px;left:-200px;top:-200px;transition:left 80ms linear,top 80ms linear;';
  el.innerHTML = `<svg width="14" height="18" viewBox="0 0 14 18" fill="none"><path d="M0 0L0 14L3.5 10.5L7 17.5L8.75 16.5L5.25 9.5L10.5 9.5Z" fill="${color}" stroke="white" stroke-width="1"/></svg><span style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)">${_esc(name)}</span>`;
  document.body.appendChild(el);
  _peersEl[sid] = el;
}
function _moveCursor(sid, x, y) { const el = _peersEl[sid]; if (!el) return; el.style.left=(x+2)+'px'; el.style.top=(y+2)+'px'; }
function _startCursorBroadcast() {
  let t = null;
  document.addEventListener('mousemove', e => {
    if (!_connected || !_socket) return;
    clearTimeout(t);
    t = setTimeout(() => { _socket.emit('cursor', { room: _room, x: e.clientX, y: e.clientY }); }, 35);
  });
}

// ── Chat ───────────────────────────────────────────────────────────────────
function _appendChat(name, text, color, isMe) {
  const log = document.getElementById('cp-chat-log'); if (!log) return;
  const el = document.createElement('div');
  el.style.cssText = 'margin-bottom:6px;font-size:12px;';
  el.innerHTML = `<span style="color:${color||'#888'};font-weight:600">${_esc(name||'')}: </span><span style="color:rgba(255,255,255,0.8)">${_esc(text)}</span>`;
  log.appendChild(el); log.scrollTop = log.scrollHeight;
}

// ── Status & sync banner ───────────────────────────────────────────────────
function _setStatus(msg, color) { const el = document.getElementById('collab-status-line'); if (el) { el.textContent = msg; el.style.color = color||'rgba(255,255,255,0.4)'; } }
function _syncBanner(msg) {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;top:52px;right:16px;z-index:9999;background:#1e293b;border:1px solid rgba(249,115,22,0.4);color:#f1f5f9;font-size:12px;padding:8px 14px;border-radius:8px;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);pointer-events:none;';
  b.textContent = msg; document.body.appendChild(b); setTimeout(() => b.remove(), 3000);
}
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const savedColor = localStorage.getItem('fs_collab_color');
  if (savedColor) _myColor = savedColor;
  _buildCollabPanel();
  _ensureAvatarStrip();
  const urlRoom = new URLSearchParams(window.location.search).get('room');
  if (urlRoom) { const inp = document.getElementById('collab-room'); if (inp) inp.value = urlRoom; }
});
