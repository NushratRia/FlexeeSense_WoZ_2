/* sync.js — Document Studio real-time sync
   Separate from collab.js (UI/connection).
   Uses the reference pattern: granular events per action,
   window hooks that modules call, _applyingRemote guard.
   
   Events emitted/received:
   - wb_element_add    { element }
   - wb_element_move   { id, x, y }
   - wb_element_delete { id }
   - wb_element_update { id, ...props }  (color, text, size)
   - wb_stroke_add     { stroke }
   - wb_stroke_clear   {}
   - wb_connectors     { connectors }
   - doc_open          { entry, peerName }
   - draw_stroke_add   { stroke }
   - draw_clear        {}
   - cursor            { x, y }
   - state_request     {}
   - state_response    { wbState, drawStrokes, activeFile }
*/

(function() {
  'use strict';

  let _socket   = null;
  let _room     = 'main';
  let _ready    = false;
  let _applying = false;  // global guard — set true while applying remote data

  // ── Called by collab.js after socket connects and joins room ──────────────
  window.syncInit = function(socket, room) {
    _socket = socket;
    _room   = room;
    _ready  = true;

    _registerListeners();
    _installHooks();

    // Ask peers for current state
    setTimeout(() => _emit('state_request', {}), 400);
    console.log('[sync] Initialized, room=' + room);
  };

  window.syncDestroy = function() {
    _ready  = false;
    _socket = null;
    // Remove hooks
    window.onStrokeAdded    = null;
    window.onStrokeDeleted  = null;
    console.log('[sync] Destroyed');
  };

  // ── Emit helper ───────────────────────────────────────────────────────────
  function _emit(event, data) {
    if (!_ready || !_socket?.connected || _applying) return;
    _socket.emit(event, { ...data, room: _room });
  }

  // ── Install hooks that whiteboard.js + draw.js call ───────────────────────
  function _installHooks() {
    // DRAW OVERLAY (document viewer)
    // draw.js calls window.onStrokeAdded after each stroke finishes
    window.onStrokeAdded = function(id, points, color, size) {
      _emit('draw_stroke_add', { stroke: { id, points, color, size } });
      console.log('[sync] draw_stroke_add pts=' + points?.length);
    };

    window.onStrokeDeleted = function(id) {
      _emit('draw_clear', {});
    };

    // WHITEBOARD CANVAS
    // whiteboard.js calls these hooks after each mutation
    window.onWbElementAdded = function(element) {
      _emit('wb_element_add', { element: JSON.parse(JSON.stringify(element)) });
      console.log('[sync] wb_element_add type=' + element.type);
    };

    window.onWbElementMoved = function(id, x, y) {
      _emit('wb_element_move', { id, x, y });
    };

    window.onWbElementDeleted = function(id) {
      _emit('wb_element_delete', { id });
    };

    window.onWbElementUpdated = function(id, props) {
      _emit('wb_element_update', { id, ...props });
    };

    window.onWbStrokeAdded = function(stroke) {
      _emit('wb_stroke_add', { stroke: JSON.parse(JSON.stringify(stroke)) });
    };

    window.onWbStrokeCleared = function() {
      _emit('wb_stroke_clear', {});
    };

    window.onWbConnectorsChanged = function(connectors) {
      _emit('wb_connectors', { connectors: JSON.parse(JSON.stringify(connectors)) });
    };

    // DOCUMENT VIEWER
    window.onDocOpened = function(entry, peerName) {
      _emit('doc_open', { entry, peerName });
    };

    console.log('[sync] Hooks installed');
  }

  // ── Listen for events from peers ──────────────────────────────────────────
  function _registerListeners() {

    // ── WHITEBOARD ────────────────────────────────────────────────────────
    _socket.on('wb_element_add', data => {
      if (!data.element || typeof Whiteboard === 'undefined') return;
      console.log('[sync] recv wb_element_add', data.element.type);
      _applying = true;
      try { Whiteboard.applyAddElement(data.element); }
      finally { setTimeout(() => { _applying = false; }, 100); }
    });

    _socket.on('wb_element_move', data => {
      if (!data.id || typeof Whiteboard === 'undefined') return;
      _applying = true;
      try { Whiteboard.applyMoveElement(data.id, data.x, data.y); }
      finally { _applying = false; }
    });

    _socket.on('wb_element_delete', data => {
      if (!data.id || typeof Whiteboard === 'undefined') return;
      _applying = true;
      try { Whiteboard.applyDeleteElement(data.id); }
      finally { _applying = false; }
    });

    _socket.on('wb_element_update', data => {
      if (!data.id || typeof Whiteboard === 'undefined') return;
      _applying = true;
      try { Whiteboard.applyUpdateElement(data.id, data); }
      finally { _applying = false; }
    });

    _socket.on('wb_stroke_add', data => {
      if (!data.stroke || typeof Whiteboard === 'undefined') return;
      _applying = true;
      try { Whiteboard.applyAddStroke(data.stroke); }
      finally { _applying = false; }
    });

    _socket.on('wb_stroke_clear', () => {
      if (typeof Whiteboard === 'undefined') return;
      _applying = true;
      try { Whiteboard.applyClearStrokes(); }
      finally { _applying = false; }
    });

    _socket.on('wb_connectors', data => {
      if (!data.connectors || typeof Whiteboard === 'undefined') return;
      _applying = true;
      try { Whiteboard.applyConnectors(data.connectors); }
      finally { _applying = false; }
    });

    // ── DRAW OVERLAY ──────────────────────────────────────────────────────
    _socket.on('draw_stroke_add', data => {
      if (!data.stroke || typeof Draw === 'undefined') return;
      console.log('[sync] recv draw_stroke_add pts=' + data.stroke.points?.length);
      _applying = true;
      try { Draw.replayStroke(data.stroke); }
      finally { setTimeout(() => { _applying = false; }, 30); }
    });

    _socket.on('draw_clear', () => {
      if (typeof Draw === 'undefined') return;
      _applying = true;
      try { Draw.clearRemote(); }
      finally { _applying = false; }
    });

    // ── DOCUMENT VIEWER ───────────────────────────────────────────────────
    _socket.on('doc_open', data => {
      if (!data.entry || typeof Tabs === 'undefined') return;
      console.log('[sync] recv doc_open', data.entry.name);
      _applying = true;
      try { Tabs.add(data.entry); Tabs.activate(data.entry.id); }
      finally { setTimeout(() => { _applying = false; }, 400); }
      // Show banner
      const b = document.createElement('div');
      b.style.cssText = 'position:fixed;top:52px;right:16px;z-index:9999;background:#1e293b;border:1px solid rgba(249,115,22,0.4);color:#f1f5f9;font-size:12px;padding:8px 14px;border-radius:8px;pointer-events:none;font-family:Inter,sans-serif;';
      b.textContent = `📂 ${data.peerName||'Peer'} opened "${data.entry.name}"`;
      document.body.appendChild(b);
      setTimeout(() => b.remove(), 3000);
    });

    // ── STATE EXCHANGE ────────────────────────────────────────────────────
    _socket.on('state_request', () => {
      // A new peer joined — send full state
      setTimeout(_broadcastFullState, 300);
    });

    _socket.on('state_response', data => {
      console.log('[sync] recv state_response wb_el=' + (data.wbState?.elements?.length||0) + ' draw=' + (data.drawStrokes?.length||0));
      _applying = true;
      try {
        if (data.wbState && typeof Whiteboard !== 'undefined') {
          Whiteboard.applyRemoteState(data.wbState);
        }
        if (data.drawStrokes?.length && typeof Draw !== 'undefined') {
          data.drawStrokes.forEach(s => Draw.replayStroke(s));
        }
        if (data.activeFile && typeof Tabs !== 'undefined') {
          Tabs.add(data.activeFile);
          Tabs.activate(data.activeFile.id);
        }
      } finally {
        setTimeout(() => { _applying = false; }, 300);
      }
    });

    // Cursor
    _socket.on('cursor', data => {
      // Handled by collab.js peer cursor system
    });
  }

  // ── Broadcast full state to new joiner ───────────────────────────────────
  function _broadcastFullState() {
    if (!_ready || !_socket?.connected) return;
    try {
      const payload = { room: _room };
      if (typeof Whiteboard !== 'undefined') payload.wbState     = JSON.parse(JSON.stringify(Whiteboard.getState()));
      if (typeof Draw       !== 'undefined') payload.drawStrokes = JSON.parse(JSON.stringify(Draw.getStrokes?.() || []));
      if (typeof Tabs       !== 'undefined') { const a = Tabs.getActive?.(); if (a) payload.activeFile = a; }
      console.log('[sync] broadcast state wb_el=' + (payload.wbState?.elements?.length||0) + ' draw=' + (payload.drawStrokes?.length||0));
      _socket.emit('state_response', payload);
    } catch(e) { console.error('[sync] broadcastFullState error', e); }
  }

  // ── Public: check if currently applying remote ────────────────────────────
  window.syncIsApplying = function() { return _applying; };

})();
