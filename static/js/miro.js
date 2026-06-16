/* miro.js — Canvas panel (whiteboard only, Miro removed) */

let _canvasOpen  = false;
let _wbInited    = false;

// Toggle split-screen canvas
function toggleCanvas() {
  _canvasOpen = !_canvasOpen;
  document.getElementById('canvas-pane').style.display     = _canvasOpen ? 'flex' : 'none';
  document.getElementById('splitter').style.display        = _canvasOpen ? 'block' : 'none';
  document.getElementById('btn-canvas').classList.toggle('active', _canvasOpen);

  if (_canvasOpen) {
    setTimeout(() => {
      if (!_wbInited) {
        _wbInited = true;
        const canvas = document.getElementById('wb-canvas');
        const wrap   = document.getElementById('wb-canvas-wrap');
        if (canvas && wrap) {
          Whiteboard.init(canvas, wrap);
          Logger.info('Canvas', 'Whiteboard initialized');
        }
      } else {
        Whiteboard.render();
      }
    }, 60);
  }
  Logger.info('Canvas', _canvasOpen ? 'Opened' : 'Closed');
}

// Splitter drag
function startSplitterDrag(e) {
  e.preventDefault();
  const ws = document.getElementById('workspace');
  const vp = document.getElementById('viewer-pane');
  const sx = e.clientX, sw = vp.getBoundingClientRect().width;
  const mv = ev => {
    const total = ws.getBoundingClientRect().width;
    vp.style.flex = `0 0 ${Math.max(220, Math.min(total - 220, sw + ev.clientX - sx))}px`;
  };
  const up = () => {
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup', up);
    document.body.style.cssText = '';
  };
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup', up);
  document.body.style.cssText = 'cursor:col-resize;user-select:none';
}

// Stubs for any remaining HTML references (no-ops now)
function openMiroPopup()      {}
function openMiroInTab()      {}
function openMiroNewBoard()   {}
function loadMiroSDK()        {}
function reloadMiro()         {}
function useBuiltinWhiteboard() {}
