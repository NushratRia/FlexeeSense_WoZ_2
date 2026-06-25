/* collab.js — Document Studio collaboration
   UI: name + room + color picker → Join button
   Syncs: document open, draw strokes, whiteboard state, peer cursors
   No video/audio.
*/

const COLLAB_COLORS = ['#f97316','#2563EB','#7C3AED','#1A8F6F','#E05A3A','#0891B2','#BE185D','#047857'];

let _myColor   = COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)];
let _myName    = 'Peer ' + Math.floor(Math.random() * 900 + 100);
let _room      = 'main';
let _socket    = null;
let _connected = false;
let _joined    = false;
let _peersEl   = {};        // sid → cursor DOM element
let _peerInfo  = {};        // sid → { name, color }
let _wbTimer   = null;
let _applyingRemote = false;

// ── Build panel UI ─────────────────────────────────────────────────────────
function _buildCollabPanel() {
  if (document.getElementById('collab-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'collab-panel';
  panel.style.cssText = [
    'position:fixed','top:52px','right:16px','width:280px',
    'background:#111827','border:1px solid rgba(255,255,255,0.1)',
    'border-radius:12px','box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    'z-index:1000','display:none','flex-direction:column',
    'overflow:hidden','font-family:Inter,system-ui,sans-serif',
  ].join(';');

  panel.innerHTML = `
    <div style="padding:12px 16px;background:rgba(249,115,22,0.12);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-weight:700;font-size:13px;color:#fff">👥 Collaborate</div>
        <div id="collab-status-line" style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">Not connected</div>
      </div>
      <button onclick="toggleCollabPanel()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;line-height:1;padding:0">✕</button>
    </div>

    <!-- JOIN FORM -->
    <div id="collab-join-form" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.35);margin-bottom:5px">Your name</div>
        <input id="collab-name" value="${_myName}" placeholder="Enter name…"
          style="width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:7px 10px;color:#fff;font-family:inherit;font-size:12px;outline:none;box-sizing:border-box">
      </div>
      <div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.35);margin-bottom:5px">Room ID</div>
        <input id="collab-room" value="${_room}" placeholder="main"
          style="width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:7px 10px;color:#fff;font-family:inherit;font-size:12px;outline:none;box-sizing:border-box"
          onkeydown="if(event.key==='Enter')collabConnect()">
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.35)">Color</div>
        <input type="color" id="collab-color" value="${_myColor}"
          style="width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);cursor:pointer;padding:0;background:none;flex-shrink:0">
        <div style="flex:1"></div>
        <button id="collab-connect-btn" onclick="collabConnect()"
          style="padding:7px 18px;background:#f97316;color:#fff;border:none;border-radius:6px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;transition:opacity .15s">
          Join
        </button>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="collabCopyLink()"
          style="flex:1;padding:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.5);font-family:inherit;font-size:11px;cursor:pointer">
          🔗 Copy link
        </button>
        <button onclick="collabGenRoom()"
          style="flex:1;padding:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.5);font-family:inherit;font-size:11px;cursor:pointer">
          🎲 Random room
        </button>
      </div>
    </div>

    <!-- SESSION VIEW (shown when connected) -->
    <div id="collab-session" style="display:none;flex-direction:column">
      <div style="padding:10px 16px;border-top:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,0.3);margin-bottom:8px">In this room</div>
        <div id="collab-peers-inner"></div>
      </div>
      <div style="padding:6px 16px 12px;display:flex;gap:8px">
        <button id="cp-follow-btn" onclick="collabToggleFollow()"
          style="flex:1;padding:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:rgba(255,255,255,0.5);font-family:inherit;font-size:11px;cursor:pointer">
          👁 Follow scroll
        </button>
        <button onclick="collabDisconnect()"
          style="padding:6px 14px;background:rgba(224,90,58,0.12);border:1px solid rgba(224,90,58,0.3);border-radius:6px;color:#f87155;font-family:inherit;font-weight:700;font-size:11px;cursor:pointer">
          Leave
        </button>
      </div>
    </div>

    <div style="padding:5px 16px 8px;font-size:9px;color:rgba(255,255,255,0.18);border-top:1px solid rgba(255,255,255,0.06)">
      Share the room ID with others to collaborate
    </div>
  `;

  document.body.appendChild(panel);

  // Close on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#collab-panel') && !e.target.closest('#btn-collab')) {
      panel.style.display = 'none';
    }
  });
}

// ── Toggle panel ───────────────────────────────────────────────────────────
function toggleCollabPanel() {
  const p = document.getElementById('collab-panel');
  if (!p) { _buildCollabPanel(); setTimeout(toggleCollabPanel, 10); return; }
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
  document.getElementById('btn-collab')?.classList.toggle('active', p.style.display === 'flex');
}

// ── Connect ────────────────────────────────────────────────────────────────
function collabConnect() {
  _myName  = (document.getElementById('collab-name')?.value  || '').trim() || _myName;
  _room    = (document.getElementById('collab-room')?.value  || '').trim() || 'main';
  _myColor = document.getElementById('collab-color')?.value  || _myColor;

  // Save color preference only — not name (each user should enter their own)
  localStorage.setItem('fs_collab_color', _myColor);

  const btn = document.getElementById('collab-connect-btn');
  if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
  _setStatus('Connecting…', '#f59e0b');

  // io() is loaded via <script> tag in HTML — use it directly
  // window._io is a stash set before Monaco loader hijacks window.define
  const ioFn = window.io || window._io;
  if (!ioFn) {
    _setStatus('Socket.IO not loaded', '#ef4444');
    if (btn) { btn.textContent = 'Join'; btn.disabled = false; }
    console.error('[collab] io() not found — check script tag in index.html');
    return;
  }
  _doConnect(ioFn);
}

function _doConnect(ioFn) {
  if (_socket) { _socket.disconnect(); _socket = null; }

  const _ioCreate = ioFn || window.io || window._io;
  console.log('[collab] Connecting to Socket.IO…', typeof _ioCreate);
  _socket = _ioCreate({ transports: ['websocket', 'polling'] });

  _socket.on('connect', () => {
    console.log('[collab] Connected! Emitting join…', { room: _room, name: _myName });
    _socket.emit('join', { room: _room, name: _myName, color: _myColor });
    Logger.info('Collab', `Socket connected sid=${_socket.id}`);
  });

  _socket.on('joined_ack', ack => {
    try {
      _connected = true;
      _joined    = true;
      _myColor   = ack.color || _myColor;
      Logger.info('Collab', `joined_ack received room="${ack.room}" sid=${ack.sid}`);

      const btn = document.getElementById('collab-connect-btn');
      if (btn) { btn.textContent = 'Connected ✓'; btn.disabled = false; }
      _setStatus(`Room: "${_room}"`, '#10b981');

      // Null-safe panel switching
      const joinForm = document.getElementById('collab-join-form');
      const session  = document.getElementById('collab-session');
      if (joinForm) joinForm.style.display = 'none';
      if (session)  session.style.display  = 'flex';

      _updatePeersList([]);
      _refreshAvatarStrip();
      _startCursorBroadcast();

      const cb = document.getElementById('btn-collab');
      if (cb) cb.classList.add('active');

      try {
        const url = new URL(window.location.href);
        url.searchParams.set('room', _room);
        window.history.replaceState({}, '', url.toString());
      } catch(e) {}

      toast(`✅ Joined room "${_room}"`);
      Logger.info('Collab', `Joined room="${_room}" as "${_myName}"`);

      setTimeout(() => {
        if (_socket?.connected) _socket.emit('request_sync_state', { room: _room });
      }, 400);
    } catch(err) {
      Logger.error('Collab', `joined_ack error: ${err.message}`);
      console.error('[collab] joined_ack handler error:', err);
    }
  });

  _socket.on('connect_error', err => {
    _setStatus('Failed: ' + err.message, '#ef4444');
    const btn = document.getElementById('collab-connect-btn');
    if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
    toast('❌ Connection failed — is Flask running?');
  });

  _socket.on('disconnect', () => {
    _connected = false; _joined = false;
    _setStatus('Disconnected', '#ef4444');
    _clearCursors();
    _clearAvatarStrip();
  });

  // ── Room events ───────────────────────────────────────────────────────
  _socket.on('snapshot', data => {
    const peers = data.peers || [];
    peers.forEach(p => {
      _peerInfo[p.sid] = { name: p.name, color: p.color };
      _createCursor(p.sid, p.name, p.color);
    });
    _updatePeersList(peers);
    _refreshAvatarStrip();
    (data.state?.chat || []).forEach(m => _appendChat(m.name, m.text, m.color, false));
    Logger.info('Collab', `Snapshot: ${peers.length} peers`);
  });

  _socket.on('peer_joined', d => {
    _peerInfo[d.sid] = { name: d.name, color: d.color };
    _createCursor(d.sid, d.name, d.color);
    _addPeerToList(d);
    _refreshAvatarStrip();
    toast(`👤 ${d.name} joined`);
    // Send them our current state
    setTimeout(_broadcastState, 500);
  });

  _socket.on('peer_left', d => {
    _removeCursor(d.sid);
    delete _peerInfo[d.sid];
    // Remove from peer list panel
    document.querySelectorAll(`[data-collab-sid="${d.sid}"]`).forEach(el => el.remove());
    // Rebuild avatar strip — removes their avatar
    _refreshAvatarStrip();
    toast(`👤 ${d.name} left`);
    Logger.info('Collab', `Peer left: ${d.name} sid=${d.sid}`);
  });

  _socket.on('cursor', d => {
    if (d.sid !== _socket.id) _moveCursor(d.sid, d.x, d.y);
  });

  // ── Sync events ───────────────────────────────────────────────────────
  _socket.on('sync_doc', data => {
    if (!data.entry) return;
    Logger.info('Sync', `Peer opened: ${data.entry.name}`);
    _applyingRemote = true;  // prevent re-broadcast
    try {
      if (typeof Tabs !== 'undefined') {
        Tabs.add(data.entry);
        Tabs.activate(data.entry.id);
      }
    } finally {
      _applyingRemote = false;
    }
    _syncBanner(`📂 ${data.peerName||'Peer'} opened "${data.entry.name}"`);
  });

  _socket.on('sync_draw_stroke', data => {
    if (!data.stroke || typeof Draw === 'undefined') return;
    _applyingRemote = true;
    try { Draw.replayStroke(data.stroke); }
    finally { _applyingRemote = false; }
  });

  _socket.on('sync_draw_clear', () => {
    if (typeof Draw !== 'undefined') Draw.clearRemote();
  });

  _socket.on('sync_whiteboard', data => {
    if (data.state && typeof Whiteboard !== 'undefined') {
      _applyingRemote = true;
      Whiteboard.applyRemoteState(data.state);
      _applyingRemote = false;
    }
  });

  _socket.on('sync_scroll', data => {
    if (!_followScroll) return;
    const el = document.querySelector(data.selector);
    if (el) { el.scrollTop = data.scrollTop; el.scrollLeft = data.scrollLeft; }
  });

  _socket.on('sync_state_response', data => {
    if (data.whiteboard && typeof Whiteboard !== 'undefined') {
      _applyingRemote = true;
      Whiteboard.applyRemoteState(data.whiteboard);
      _applyingRemote = false;
    }
    if (data.strokes && typeof Draw !== 'undefined') {
      data.strokes.forEach(s => Draw.replayStroke(s));
    }
    if (data.activeFile && typeof Tabs !== 'undefined') {
      Tabs.add(data.activeFile);
      Tabs.activate(data.activeFile.id);
    }
    Logger.info('Sync', 'State applied from peer');
  });

  _socket.on('request_sync_state', () => {
    setTimeout(_broadcastState, 200);
  });

  _socket.on('chat', msg => {
    _appendChat(msg.name, msg.text, msg.color, msg.sid === _socket.id);
  });
}

// ── Broadcast current state ────────────────────────────────────────────────
function _broadcastState() {
  if (!_connected || !_socket?.connected) return;
  const payload = { room: _room };
  if (typeof Whiteboard !== 'undefined') payload.whiteboard = Whiteboard.getState();
  if (typeof Draw       !== 'undefined') payload.strokes    = Draw.getStrokes?.() || [];
  if (typeof Tabs       !== 'undefined') {
    const active = Tabs.getActive?.();
    if (active) payload.activeFile = active;
  }
  _socket.emit('sync_state_response', payload);
}

// ── Disconnect ─────────────────────────────────────────────────────────────
function collabDisconnect() {
  if (_socket) { _socket.disconnect(); _socket = null; }
  _connected = false; _joined = false;
  _clearCursors(); _clearAvatarStrip();
  _setStatus('Not connected', 'rgba(255,255,255,0.4)');
  const btn = document.getElementById('collab-connect-btn');
  if (btn) { btn.textContent = 'Join'; btn.disabled = false; }
  document.getElementById('collab-join-form').style.display  = 'flex';
  document.getElementById('collab-session').style.display    = 'none';
  document.getElementById('btn-collab')?.classList.remove('active');
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url.toString());
  toast('👋 Left room');
}

// ── Outbound sync ──────────────────────────────────────────────────────────
function collabSyncDoc(entry) {
  if (!_connected || !_socket?.connected || _applyingRemote) return;
  _socket.emit('sync_doc', { room: _room, entry, peerName: _myName });
}

function collabSyncStroke(stroke) {
  if (!_connected || !_socket?.connected || _applyingRemote) return;
  _socket.emit('sync_draw_stroke', { room: _room, stroke });
}

function collabSyncDrawClear() {
  if (!_connected || !_socket?.connected) return;
  _socket.emit('sync_draw_clear', { room: _room });
}

function collabSyncWhiteboard(state) {
  if (!_connected || !_socket?.connected || _applyingRemote) return;
  clearTimeout(_wbTimer);
  _wbTimer = setTimeout(() => {
    _socket.emit('sync_whiteboard', { room: _room, state });
  }, 300);
}

let _followScroll = false;
function collabSyncScroll(selector, scrollTop, scrollLeft) {
  if (!_connected || !_followScroll || !_socket?.connected) return;
  _socket.emit('sync_scroll', { room: _room, selector, scrollTop, scrollLeft });
}

function collabToggleFollow() {
  _followScroll = !_followScroll;
  const btn = document.getElementById('cp-follow-btn');
  if (btn) {
    btn.style.color = _followScroll ? '#f97316' : 'rgba(255,255,255,0.5)';
    btn.style.borderColor = _followScroll ? 'rgba(249,115,22,0.4)' : 'rgba(255,255,255,0.1)';
  }
  toast(_followScroll ? '👁 Following peers\' scroll' : '🔓 Scroll sync off');
}

// ── Room helpers ───────────────────────────────────────────────────────────
function collabCopyLink() {
  const room = (document.getElementById('collab-room')?.value || _room).trim() || 'main';
  const url  = new URL(window.location.href);
  url.searchParams.set('room', room);
  navigator.clipboard.writeText(url.toString())
    .then(() => toast('🔗 Room link copied!'))
    .catch(() => toast('Copy the URL manually'));
}

function collabGenRoom() {
  const id  = Math.random().toString(36).slice(2, 8).toUpperCase();
  const inp = document.getElementById('collab-room');
  if (inp) { inp.value = id; inp.focus(); }
}

// ── Peers list ─────────────────────────────────────────────────────────────
function _updatePeersList(peers) {
  const inner = document.getElementById('collab-peers-inner');
  if (!inner) return;
  inner.innerHTML = '';
  // Self
  _addPeerToList({ sid: 'me', name: _myName + ' (you)', color: _myColor });
  // Others
  peers.forEach(p => _addPeerToList(p));
}

function _addPeerToList(peer) {
  const inner = document.getElementById('collab-peers-inner');
  if (!inner || inner.querySelector(`[data-collab-sid="${peer.sid}"]`)) return;
  const el = document.createElement('div');
  el.dataset.collabSid = peer.sid;
  el.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  el.innerHTML = `
    <span style="width:10px;height:10px;border-radius:50%;background:${peer.color||'#888'};flex-shrink:0"></span>
    <span style="font-size:12px;color:rgba(255,255,255,0.75);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(peer.name)}</span>`;
  inner.appendChild(el);
}

// ── Avatar strip (topbar) ──────────────────────────────────────────────────
function _ensureAvatarStrip() {
  if (document.getElementById('collab-avatars')) return;
  const strip = document.createElement('div');
  strip.id = 'collab-avatars';
  strip.style.cssText = 'display:none;align-items:center;gap:0;flex-shrink:0;';
  const cb = document.getElementById('btn-collab');
  if (cb?.parentElement) cb.parentElement.insertBefore(strip, cb);
}

function _refreshAvatarStrip() {
  _ensureAvatarStrip();
  const strip = document.getElementById('collab-avatars');
  if (!strip) return;
  // Clear all existing avatars completely before rebuilding
  while (strip.firstChild) strip.removeChild(strip.firstChild);

  const all = [{ sid: 'me', name: _myName, color: _myColor, isMe: true }];
  Object.entries(_peerInfo).forEach(([sid, info]) => all.push({ sid, ...info, isMe: false }));

  if (!_connected || all.length === 0) { strip.style.display = 'none'; return; }
  strip.style.display = 'flex';

  const MAX = 5;
  all.slice(0, MAX).forEach((p, i) => {
    const av = document.createElement('div');
    const initials = p.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    av.title = p.isMe ? p.name + ' (you)' : p.name;
    av.style.cssText = [
      'width:26px','height:26px','border-radius:50%',
      `background:${p.color}`, 'color:#fff',
      'font-weight:700','font-size:10px',
      'display:flex','align-items:center','justify-content:center',
      `border:2px solid ${p.isMe ? '#fff' : 'rgba(255,255,255,0.3)'}`,
      `margin-left:${i===0?'0':'-7px'}`,
      'cursor:default','flex-shrink:0',
      'box-shadow:0 1px 4px rgba(0,0,0,0.3)',
      `z-index:${MAX-i}`, 'position:relative',
      'transition:transform .12s',
    ].join(';');
    av.textContent = initials || '?';
    av.addEventListener('mouseenter', () => { av.style.transform = 'translateY(-3px) scale(1.1)'; av.style.zIndex = '99'; });
    av.addEventListener('mouseleave', () => { av.style.transform = ''; av.style.zIndex = String(MAX - i); });
    strip.appendChild(av);
  });

  if (all.length > MAX) {
    const more = document.createElement('div');
    more.style.cssText = 'height:26px;border-radius:13px;background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 7px;margin-left:-7px;border:2px solid rgba(255,255,255,0.2);flex-shrink:0;';
    more.textContent = '+' + (all.length - MAX);
    strip.appendChild(more);
  }
}

function _clearAvatarStrip() {
  const strip = document.getElementById('collab-avatars');
  if (strip) strip.style.display = 'none';
  Object.keys(_peerInfo).forEach(k => delete _peerInfo[k]);
}

// ── Peer cursors ───────────────────────────────────────────────────────────
function _createCursor(sid, name, color) {
  if (_peersEl[sid]) return;
  const el = document.createElement('div');
  el.id = 'pcursor-' + sid;
  el.style.cssText = 'position:fixed;z-index:9000;pointer-events:none;display:flex;align-items:center;gap:4px;left:-200px;top:-200px;transition:left 80ms linear,top 80ms linear;';
  el.innerHTML = `
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
      <path d="M0 0L0 14L3.5 10.5L7 17.5L8.75 16.5L5.25 9.5L10.5 9.5Z" fill="${color}" stroke="white" stroke-width="1"/>
    </svg>
    <span style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)">${_esc(name)}</span>`;
  document.body.appendChild(el);
  _peersEl[sid] = el;
}

function _moveCursor(sid, x, y) {
  const el = _peersEl[sid]; if (!el) return;
  el.style.left = (x + 2) + 'px'; el.style.top = (y + 2) + 'px';
}

function _removeCursor(sid) { _peersEl[sid]?.remove(); delete _peersEl[sid]; }
function _clearCursors()    { Object.keys(_peersEl).forEach(_removeCursor); }

function _startCursorBroadcast() {
  let _t = null;
  document.addEventListener('mousemove', e => {
    if (!_connected || !_socket) return;
    clearTimeout(_t);
    _t = setTimeout(() => {
      _socket.emit('cursor', { room: _room, x: e.clientX, y: e.clientY });
    }, 35);
  });
}

// ── Chat ───────────────────────────────────────────────────────────────────
function collabSendChat() {
  const inp  = document.getElementById('cp-chat-input');
  const text = (inp?.value || '').trim();
  if (!text || !_connected) return;
  inp.value = '';
  _socket?.emit('chat', { room: _room, text, color: _myColor });
}

function _appendChat(name, text, color, isMe, isSystem=false) {
  const log = document.getElementById('cp-chat-log');
  if (!log) return;
  const el = document.createElement('div');
  el.style.cssText = 'margin-bottom:6px;font-size:12px;';
  el.innerHTML = isSystem
    ? `<span style="color:#6b7280;font-style:italic">${_esc(text)}</span>`
    : `<span style="color:${color||'#888'};font-weight:600">${_esc(name)}: </span><span style="color:rgba(255,255,255,0.8)">${_esc(text)}</span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

// ── Status & utilities ─────────────────────────────────────────────────────
function _setStatus(msg, color) {
  const el = document.getElementById('collab-status-line');
  if (el) { el.textContent = msg; el.style.color = color || 'rgba(255,255,255,0.4)'; }
}

function _syncBanner(msg) {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;top:52px;right:16px;z-index:9999;background:#1e293b;border:1px solid rgba(249,115,22,0.4);color:#f1f5f9;font-size:12px;padding:8px 14px;border-radius:8px;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);pointer-events:none;';
  b.textContent = msg;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 3000);
}

function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Restore color preference but NOT name (so each person enters their own)
  const savedColor = localStorage.getItem('fs_collab_color');
  if (savedColor) _myColor = savedColor;
  // Generate a fresh random placeholder name every session
  _myName = '';  // empty — user must type their name

  _buildCollabPanel();
  _ensureAvatarStrip();

  // Auto-join from URL param (only if name was already set this session)
  const urlRoom = new URLSearchParams(window.location.search).get('room');
  if (urlRoom) {
    const inp = document.getElementById('collab-room');
    if (inp) inp.value = urlRoom;
  }
});
