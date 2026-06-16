/* collab.js — Real-time collaboration via SocketIO
   Key fix: emit 'join' only AFTER socket confirms connection (on 'connect' event)
*/

let _socket    = null;
let _joined    = false;
let _room      = 'main';
let _myName    = '';
let _myColor   = '#f97316';
let _peers     = {};
let _panelOpen = false;
let _pendingJoin = null;   // { name, room } — queued until socket connects

const PEER_COLORS = ['#f97316','#f59e0b','#10b981','#3b82f6','#ef4444','#8b5cf6','#ec4899'];

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  _myName  = localStorage.getItem('fs_collab_name') || '';
  _myColor = PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)];

  // Restore name in panel input
  const nameEl = document.getElementById('cp-name');
  if (nameEl && _myName) nameEl.value = _myName;

  // Auto-join from ?room= URL param
  const urlRoom = new URLSearchParams(window.location.search).get('room');
  if (urlRoom) {
    const roomEl = document.getElementById('cp-room');
    if (roomEl) roomEl.value = urlRoom;
    if (_myName) setTimeout(collabJoin, 400);
    else { toggleCollabPanel(); }
  }

  // Cursor broadcast
  document.getElementById('viewer-pane')?.addEventListener('mousemove', e => {
    if (!_joined) return;
    _socket?.emit('cursor', { room: _room, x: e.clientX, y: e.clientY });
  }, { passive: true });
});

// ── Socket connection ──────────────────────────────────────────────────────
function _connect(onReady) {
  // Already connected — call onReady immediately
  if (_socket && _socket.connected) { onReady(); return; }

  // Already connecting — queue onReady
  if (_socket && !_socket.connected) {
    _socket.once('connect', onReady);
    return;
  }

  // Fresh connection
  _socket = io({ transports: ['websocket', 'polling'] });

  _socket.on('connect', () => {
    Logger.info('Collab', `Socket connected  sid=${_socket.id}`);
    onReady();
  });

  _socket.on('connect_error', err => {
    Logger.error('Collab', `Connection error: ${err.message}`);
    toast(`❌ Cannot connect to server: ${err.message}`, 'error');
    _setConnectedUI(false);
    _joined = false;
  });

  _socket.on('disconnect', reason => {
    Logger.warn('Collab', `Disconnected: ${reason}`);
    if (_joined) {
      _joined = false;
      _setConnectedUI(false);
      toast('⚠ Disconnected from room', 'warn');
    }
  });

  _socket.on('snapshot', data => {
    Logger.info('Collab', `Snapshot: peers=${data.peers?.length} chat=${data.state?.chat?.length}`);
    (data.peers || []).forEach(p => _addPeer(p.sid || String(Date.now()), p.name, p.color));
    (data.state?.chat || []).forEach(m => _appendChat(m.name, m.text, m.color, false));
    _renderPeers();
  });

  _socket.on('peer_joined', d => {
    _addPeer(d.sid, d.name, d.color);
    _appendChat(null, `${d.name} joined`, null, false, true);
    toast(`👋 ${d.name} joined`);
    _updatePeerBadge();
    Logger.info('Collab', `Peer joined: ${d.name}`);
  });

  _socket.on('peer_left', d => {
    _removePeer(d.sid);
    _appendChat(null, `${d.name} left`, null, false, true);
    _updatePeerBadge();
    Logger.info('Collab', `Peer left: ${d.name}`);
  });

  _socket.on('chat', msg => {
    _appendChat(msg.name, msg.text, msg.color, msg.sid === _socket.id);
  });

  _socket.on('cursor', d => {
    if (d.sid === _socket.id) return;
    _moveCursor(d.sid, d.x, d.y);
  });

  _socket.on('file_open', entry => {
    if (typeof Tabs !== 'undefined') Tabs.add(entry);
    toast(`📂 ${entry.name} shared by a peer`);
    Logger.info('Collab', `Peer shared file: ${entry.name}`);
  });
}

// ── Join / leave ───────────────────────────────────────────────────────────
function collabJoin() {
  const name = (document.getElementById('cp-name')?.value || '').trim();
  const room = (document.getElementById('cp-room')?.value || '').trim() || 'main';

  if (!name) {
    toast('Enter your name first', 'warn');
    document.getElementById('cp-name')?.focus();
    return;
  }

  _myName = name;
  _room   = room;
  localStorage.setItem('fs_collab_name', name);

  // Show "connecting…" state while socket handshakes
  _setStatusConnecting();
  Logger.info('Collab', `Joining room="${room}" as "${name}"…`);

  _connect(() => {
    // This runs only after socket.connected === true
    _socket.emit('join', { room, name });
    _joined = true;
    _setConnectedUI(true);

    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('room', room);
    window.history.replaceState({}, '', url.toString());

    toast(`✅ Joined room "${room}"`, 'success');
    Logger.info('Collab', `Joined room="${room}" as "${name}"  sid=${_socket.id}`);
  });
}

function collabLeave() {
  if (_socket) { _socket.disconnect(); _socket = null; }
  _joined = false; _peers = {};
  document.querySelectorAll('.peer-cursor').forEach(el => el.remove());
  _setConnectedUI(false);
  _renderPeers();
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url.toString());
  toast('👋 Left room');
  Logger.info('Collab', 'Left room');
}

// ── Chat ───────────────────────────────────────────────────────────────────
function collabSendChat() {
  const inp  = document.getElementById('cp-chat-input');
  const text = (inp?.value || '').trim();
  if (!text || !_joined) return;
  inp.value = '';
  _socket?.emit('chat', { room: _room, text, color: _myColor });
}

// ── Room helpers ───────────────────────────────────────────────────────────
function collabGenRoom() {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const el = document.getElementById('cp-room');
  if (el) { el.value = id; el.focus(); }
}

function collabCopyLink() {
  const room = (document.getElementById('cp-room')?.value || _room || '').trim() || 'main';
  const url  = new URL(window.location.href);
  url.searchParams.set('room', room);
  navigator.clipboard.writeText(url.toString())
    .then(() => toast('🔗 Room link copied!'))
    .catch(() => toast('⚠ Copy failed — manually copy the URL', 'warn'));
}

// Share a newly opened file with the room
function collabShareFile(entry) {
  if (!_joined || !_socket?.connected) return;
  _socket.emit('file_open', { ...entry, room: _room });
  Logger.info('Collab', `Shared file: ${entry.name}`);
}

// ── Panel toggle ───────────────────────────────────────────────────────────
function toggleCollabPanel() {
  _panelOpen = !_panelOpen;
  document.getElementById('collab-panel').style.display = _panelOpen ? 'flex' : 'none';
  document.getElementById('btn-collab').classList.toggle('active', _panelOpen);
}

// ── UI state helpers ───────────────────────────────────────────────────────
function _setStatusConnecting() {
  const bar = document.getElementById('cp-connected');
  if (bar) {
    bar.style.display = 'flex';
    bar.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;flex-shrink:0;animation:pulse 1s infinite"></span>
      <span style="color:#f59e0b;font-size:12px">Connecting…</span>`;
  }
  document.getElementById('cp-join').style.display  = 'none';
  document.getElementById('cp-peers').style.display = 'none';
  document.getElementById('cp-chat').style.display  = 'none';
}

function _setConnectedUI(connected) {
  document.getElementById('cp-join').style.display      = connected ? 'none'  : 'block';
  document.getElementById('cp-connected').style.display = connected ? 'flex'  : 'none';
  document.getElementById('cp-peers').style.display     = connected ? 'block' : 'none';
  document.getElementById('cp-chat').style.display      = connected ? 'flex'  : 'none';

  if (connected) {
    const bar = document.getElementById('cp-connected');
    if (bar) bar.innerHTML = `
      <span class="cp-online-dot"></span>
      <span id="cp-room-label">Room: ${_room}</span>
      <button class="cp-leave-btn" onclick="collabLeave()">Leave</button>`;
  }
}

// ── Peer management ────────────────────────────────────────────────────────
function _addPeer(sid, name, color) {
  if (_peers[sid]) return;
  _peers[sid] = { sid, name, color, cursorEl: null };
  _renderPeers();
}

function _removePeer(sid) {
  _peers[sid]?.cursorEl?.remove();
  delete _peers[sid];
  _renderPeers();
}

function _renderPeers() {
  const list = document.getElementById('cp-peers-list');
  if (!list) return;
  const me  = { name: _myName || 'You', color: _myColor };
  const all = [me, ...Object.values(_peers)];
  list.innerHTML = all.map((p, i) => `
    <div class="cp-peer-row">
      <span class="cp-peer-dot" style="background:${p.color}"></span>
      <span style="color:var(--text-2);font-size:12px">${_esc(p.name)}${i === 0 ? ' <span style="opacity:.4;font-size:10px">(you)</span>' : ''}</span>
    </div>`).join('');
}

function _updatePeerBadge() {
  const n  = Object.keys(_peers).length;
  const el = document.getElementById('peer-count-badge');
  if (!el) return;
  el.style.display = n > 0 ? 'block' : 'none';
  el.textContent   = n;
}

// ── Chat messages ──────────────────────────────────────────────────────────
function _appendChat(name, text, color, isMe, isSystem = false) {
  const log = document.getElementById('cp-chat-log');
  if (!log) return;
  const el = document.createElement('div');
  el.className = 'cp-chat-msg' + (isSystem ? ' system' : isMe ? ' me' : '');
  el.innerHTML = isSystem
    ? `<span style="color:var(--text-3);font-style:italic;font-size:11px">${_esc(text)}</span>`
    : `<div class="cp-chat-author" style="color:${color || '#888'}">${_esc(name || '')}</div><div>${_esc(text)}</div>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

// ── Live cursors ───────────────────────────────────────────────────────────
function _moveCursor(sid, x, y) {
  const peer = _peers[sid];
  if (!peer) return;
  if (!peer.cursorEl) {
    const el = document.createElement('div');
    el.className = 'peer-cursor';
    el.innerHTML = `
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path d="M0 0L0 14L4 10L7 17L9 16L6 9L11 9Z" fill="${peer.color}" stroke="#fff" stroke-width="1"/>
      </svg>
      <span class="peer-cursor-name" style="background:${peer.color}">${_esc(peer.name)}</span>`;
    document.body.appendChild(el);
    peer.cursorEl = el;
  }
  peer.cursorEl.style.transform = `translate(${x}px, ${y}px)`;
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
