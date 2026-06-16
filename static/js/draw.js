/* draw.js — Freehand draw overlay over document pane */

const Draw = (() => {
  let active   = false;
  let tool     = 'pen';
  let color    = '#f97316';
  let size     = 3;
  let drawing  = false;
  let canvas   = null;
  let ctx      = null;
  let history  = [];    // ImageData snapshots
  let redoSt   = [];
  let startX   = 0, startY = 0;
  let snapshot = null;  // for shape preview

  function _init() {
    canvas = document.getElementById('draw-canvas');
    ctx    = canvas.getContext('2d');
    ctx.lineCap = ctx.lineJoin = 'round';

    canvas.addEventListener('mousedown', _start);
    canvas.addEventListener('mousemove', _move);
    canvas.addEventListener('mouseup',   _end);
    canvas.addEventListener('mouseleave',_end);
    canvas.addEventListener('touchstart', _touchStart, { passive: false });
    canvas.addEventListener('touchmove',  _touchMove,  { passive: false });
    canvas.addEventListener('touchend',   _end);
    Logger.info('Draw', 'Canvas initialized');
  }

  function _resize() {
    const pane = document.getElementById('viewer-pane');
    const rect = pane.getBoundingClientRect();
    const img  = ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    canvas.width  = rect.width;
    canvas.height = rect.height;
    canvas.style.left = rect.left + 'px';
    canvas.style.top  = rect.top  + 'px';
    if (img) ctx.putImageData(img, 0, 0);
    ctx.lineCap = ctx.lineJoin = 'round';
  }

  function _pos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  function _save() {
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    redoSt = [];
  }

  function _start(e) {
    e.preventDefault();
    drawing  = true;
    const p  = _pos(e);
    startX   = p.x; startY = p.y;
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (tool === 'pen' || tool === 'hl' || tool === 'eraser') {
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
    }
  }

  function _move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = _pos(e);
    _draw(p.x, p.y);
  }

  function _touchStart(e) { e.preventDefault(); _start(e.touches[0] ? e : { ...e, clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }); }
  function _touchMove(e)  { e.preventDefault(); _move(e.touches[0]  ? { ...e, clientX: e.touches[0].clientX,  clientY: e.touches[0].clientY,  preventDefault:()=>{} } : e); }

  function _draw(x, y) {
    ctx.strokeStyle = tool === 'eraser' ? 'rgba(0,0,0,1)' : color;
    ctx.lineWidth   = tool === 'hl' ? size * 8 : tool === 'eraser' ? size * 6 : size;

    if (tool === 'pen' || tool === 'hl') {
      ctx.globalCompositeOperation = tool === 'hl' ? 'multiply' : 'source-over';
      if (tool === 'hl') ctx.strokeStyle = color + '77';
      ctx.lineTo(x, y); ctx.stroke();
    } else if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineTo(x, y); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // Shape tools: redraw from snapshot
      ctx.putImageData(snapshot, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color; ctx.lineWidth = size;
      ctx.beginPath();
      if (tool === 'rect') {
        ctx.strokeRect(startX, startY, x - startX, y - startY);
      } else if (tool === 'ellipse') {
        const rx = Math.abs(x - startX) / 2, ry = Math.abs(y - startY) / 2;
        ctx.ellipse(startX + (x-startX)/2, startY + (y-startY)/2, rx, ry, 0, 0, Math.PI*2);
        ctx.stroke();
      } else if (tool === 'arrow') {
        const angle = Math.atan2(y - startY, x - startX);
        const hLen  = 14;
        ctx.moveTo(startX, startY); ctx.lineTo(x, y);
        ctx.lineTo(x - hLen*Math.cos(angle-0.4), y - hLen*Math.sin(angle-0.4));
        ctx.moveTo(x, y);
        ctx.lineTo(x - hLen*Math.cos(angle+0.4), y - hLen*Math.sin(angle+0.4));
        ctx.stroke();
      } else if (tool === 'line') {
        ctx.moveTo(startX, startY); ctx.lineTo(x, y); ctx.stroke();
      }
    }
  }

  function _end() {
    if (!drawing) return;
    drawing = false;
    ctx.globalCompositeOperation = 'source-over';
    _save();
  }

  // ── Public API ─────────────────────────────────────────────────────────
  function enable() {
    if (!canvas) _init();
    active = true;
    _resize();
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'all';
    document.getElementById('draw-toolbar').style.display = 'flex';
    document.getElementById('btn-draw').classList.add('active');
    Logger.info('Draw', 'Draw mode enabled');
  }

  function disable() {
    active = false;
    if (canvas) { canvas.style.pointerEvents = 'none'; }
    document.getElementById('draw-toolbar').style.display = 'none';
    document.getElementById('btn-draw').classList.remove('active');
    Logger.info('Draw', 'Draw mode disabled');
  }

  function toggle() { active ? disable() : enable(); }

  function setTool(t) {
    tool = t;
    document.querySelectorAll('.dtool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    Logger.debug('Draw', `Tool: ${t}`);
  }

  function setColor(c) { color = c; }
  function setSize(s)  { size  = parseInt(s); }

  function undo() {
    if (!history.length) return;
    redoSt.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(history.pop(), 0, 0);
  }

  function redo() {
    if (!redoSt.length) return;
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(redoSt.pop(), 0, 0);
  }

  function clear() {
    _save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Logger.info('Draw', 'Canvas cleared');
  }

  function exportPNG() {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'drawing.png'; a.click();
    Logger.info('Draw', 'Exported PNG');
  }

  window.addEventListener('resize', () => { if (active) _resize(); });

  return { enable, disable, toggle, setTool, setColor, setSize, undo, redo, clear, exportPNG };
})();

// Global wires (called from HTML)
function toggleDraw()          { Draw.toggle(); }
function setDrawTool(t)        { Draw.setTool(t); }
function setDrawColor(c)       { Draw.setColor(c); }
function setDrawSize(s)        { Draw.setSize(s); }
function drawUndo()            { Draw.undo(); }
function drawClear()           { Draw.clear(); }
function drawExport()          { Draw.exportPNG(); }
