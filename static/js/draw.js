/* draw.js — Document-attached drawing overlay
   
   The draw canvas attaches INSIDE the actual scrolling element of each viewer:
   - PDF:   .pdf-canvas-area  (scrolls vertically through all pages)
   - Video: #viewer-content
   - Code:  #viewer-content
   - Image: #viewer-content
   
   Strokes are stored as absolute pixel coords relative to the scroll container's
   full content area, so they always stay anchored to the document content.
*/

const Draw = (() => {
  let active   = false;
  let tool     = 'pen';
  let color    = '#f97316';
  let size     = 3;
  let drawing  = false;
  let canvas   = null;
  let ctx      = null;
  let scrollEl = null;   // the element that actually scrolls
  let strokes  = [];     // [{tool,color,size,points:[{x,y}]}] — content-relative
  let current  = null;   // stroke in progress
  let history  = [];     // undo stack
  let redoSt   = [];

  // ── Find which element scrolls in the current viewer ──────────────────
  function _scrollContainer() {
    return document.querySelector('.pdf-canvas-area')
        || document.querySelector('#viewer-content')
        || document.getElementById('viewer-pane');
  }

  // ── Inject canvas inside the scroll container ─────────────────────────
  function _init() {
    // Remove old canvas if present
    document.getElementById('draw-canvas-inner')?.remove();

    scrollEl = _scrollContainer();
    if (!scrollEl) return;

    // scrollEl needs to be position:relative for absolute child
    const origPos = getComputedStyle(scrollEl).position;
    if (origPos === 'static') scrollEl.style.position = 'relative';

    canvas = document.createElement('canvas');
    canvas.id = 'draw-canvas-inner';
    canvas.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      pointer-events: none;
      z-index: 100;
      cursor: crosshair;
    `;
    scrollEl.appendChild(canvas);

    ctx = canvas.getContext('2d');
    ctx.lineCap = ctx.lineJoin = 'round';

    _sizeCanvas();
    Logger.info('Draw', `Canvas injected into ${scrollEl.className||scrollEl.id}`);
  }

  // ── Size canvas to fully cover the scrollable content ─────────────────
  function _sizeCanvas() {
    if (!canvas || !scrollEl) return;
    const w = Math.max(scrollEl.scrollWidth,  scrollEl.clientWidth);
    const h = Math.max(scrollEl.scrollHeight, scrollEl.clientHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      _redraw();
    }
  }

  // ── Coordinates: relative to content origin (not viewport) ────────────
  function _pos(e) {
    if (!scrollEl) return {x:0,y:0};
    const src  = e.touches ? e.touches[0] : e;
    const rect = scrollEl.getBoundingClientRect();
    return {
      x: src.clientX - rect.left + scrollEl.scrollLeft,
      y: src.clientY - rect.top  + scrollEl.scrollTop,
    };
  }

  // ── Redraw all stored strokes ─────────────────────────────────────────
  function _redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(_paintStroke);
    if (current) _paintStroke(current);
  }

  function _paintStroke(s) {
    if (!s.points || s.points.length < 2) return;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    if (s.tool === 'hl') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = s.color + '66';
      ctx.lineWidth   = s.size * 8;
    } else if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth   = s.size * 6;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = s.size;
    }
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // ── Mouse/touch events ────────────────────────────────────────────────
  function _onDown(e) {
    e.preventDefault();
    _sizeCanvas(); // ensure canvas covers latest content size
    drawing = true;
    const p = _pos(e);
    current = { tool, color, size, points: [{...p}] };
  }

  function _onMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = _pos(e);
    current.points.push({...p});
    _redraw();
  }

  function _onUp(e) {
    if (!drawing) return;
    drawing = false;
    if (current && current.points.length > 1) {
      history.push(JSON.parse(JSON.stringify(strokes)));
      redoSt = [];
      strokes.push(current);
    }
    current = null;
    _redraw();
  }

  function _onTouchStart(e) { e.preventDefault(); _onDown(e.touches[0] || e); }
  function _onTouchMove(e)  { e.preventDefault(); _onMove(e.touches[0] || e); }
  function _onTouchEnd(e)   { e.preventDefault(); _onUp(e.changedTouches[0] || e); }

  // Watch scroll container resizing (PDF pages load progressively)
  let _resizeObs = null;
  function _watchResize() {
    _resizeObs?.disconnect();
    if (!scrollEl) return;
    _resizeObs = new ResizeObserver(_sizeCanvas);
    _resizeObs.observe(scrollEl);
    // Also watch scroll content children
    Array.from(scrollEl.children).forEach(c => {
      if (c !== canvas) _resizeObs.observe(c);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────
  function enable() {
    _init();
    if (!canvas) { Logger.warn('Draw','No scroll container found'); return; }
    active = true;
    canvas.style.pointerEvents = 'all';
    canvas.addEventListener('mousedown',  _onDown);
    canvas.addEventListener('mousemove',  _onMove);
    canvas.addEventListener('mouseup',    _onUp);
    canvas.addEventListener('mouseleave', _onUp);
    canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   _onTouchEnd);
    _watchResize();
    document.getElementById('draw-toolbar').style.display = 'flex';
    document.getElementById('btn-draw').classList.add('active');
    Logger.info('Draw', 'Enabled — strokes anchored to content');
  }

  function disable() {
    active = false;
    if (canvas) {
      canvas.style.pointerEvents = 'none';
      canvas.removeEventListener('mousedown',  _onDown);
      canvas.removeEventListener('mousemove',  _onMove);
      canvas.removeEventListener('mouseup',    _onUp);
      canvas.removeEventListener('mouseleave', _onUp);
      canvas.removeEventListener('touchstart', _onTouchStart);
      canvas.removeEventListener('touchmove',  _onTouchMove);
      canvas.removeEventListener('touchend',   _onTouchEnd);
    }
    _resizeObs?.disconnect();
    document.getElementById('draw-toolbar').style.display = 'none';
    document.getElementById('btn-draw').classList.remove('active');
    Logger.info('Draw', 'Disabled');
  }

  function toggle() { active ? disable() : enable(); }

  // Called when a new tab/file loads — re-init to find the right scroll container
  function refresh() {
    if (!active) return;
    setTimeout(() => {
      _init();
      if (!canvas) return;
      canvas.style.pointerEvents = 'all';
      canvas.addEventListener('mousedown',  _onDown);
      canvas.addEventListener('mousemove',  _onMove);
      canvas.addEventListener('mouseup',    _onUp);
      canvas.addEventListener('mouseleave', _onUp);
      canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
      canvas.addEventListener('touchmove',  _onTouchMove,  { passive: false });
      canvas.addEventListener('touchend',   _onTouchEnd);
      _watchResize();
    }, 400); // wait for viewer to render
  }

  function setTool(t) {
    tool = t;
    document.querySelectorAll('.dtool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    if (canvas) canvas.style.cursor = t === 'eraser' ? 'cell' : 'crosshair';
  }

  function setColor(c) { color = c; }
  function setSize(s)  { size  = parseInt(s) || 3; }

  function undo() {
    if (!history.length) return;
    redoSt.push(JSON.parse(JSON.stringify(strokes)));
    strokes = history.pop();
    _redraw();
  }

  function redo() {
    if (!redoSt.length) return;
    history.push(JSON.parse(JSON.stringify(strokes)));
    strokes = redoSt.pop();
    _redraw();
  }

  function clear() {
    history.push(JSON.parse(JSON.stringify(strokes)));
    redoSt = [];
    strokes = [];
    _redraw();
  }

  function exportPNG() {
    const a = Object.assign(document.createElement('a'), {
      href: canvas.toDataURL('image/png'),
      download: 'drawing.png'
    });
    a.click();
  }

  return { enable, disable, toggle, setTool, setColor, setSize, undo, redo, clear, refresh, exportPNG };
})();

function toggleDraw()    { Draw.toggle(); }
function setDrawTool(t)  { Draw.setTool(t); }
function setDrawColor(c) { Draw.setColor(c); }
function setDrawSize(s)  { Draw.setSize(s); }
function drawUndo()      { Draw.undo(); }
function drawClear()     { Draw.clear(); }
function drawExport()    { Draw.exportPNG(); }
