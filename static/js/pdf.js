/* pdf.js — Adobe Acrobat-style PDF viewer
   - All pages rendered continuously (scroll)
   - Text selection → floating toolbar → Highlight / Comment
   - Highlight: clean yellow fill, NO underline, mix-blend-mode:multiply
   - Comment: green underline + 💬 pin → click pin → popover shows comment text
   - Both persist across zoom (stored as normalized 0-1 coords, rescaled on re-render)
   - Comment dialog uses async modal (never disappears)
*/

const PDFViewer = (() => {
  let doc, scale = 1.5, curPage = 1, entry, container;
  let showThumbs = true, showNotes = false;
  let notes = [];
  // annots[pageNum] = [{id, type, normRects:[{x,y,w,h} as fraction of page], text, comment}]
  let annots = {};
  let annotId = 0;
  let _pSel = null; // pending selection
  let rendering = false;

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load(fileEntry, el) {
    entry = fileEntry; container = el;
    Logger.info('PDF', `Loading: ${fileEntry.name}`);
    el.innerHTML = _skeleton();
    _bindToolbar();
    try {
      const task = pdfjsLib.getDocument(fileEntry.url);
      task.onProgress = ({loaded, total}) => {
        if (!total) return;
        const b = el.querySelector('.pdf-progress-bar');
        if (b) b.style.width = Math.round(loaded/total*100) + '%';
      };
      doc = await task.promise;
      el.querySelector('#pdf-total').textContent = doc.numPages;
      el.querySelector('#pdf-pg-input').max      = doc.numPages;
      el.querySelector('.pdf-spinner-wrap').remove();
      el.querySelector('.pdf-canvas-area').style.display = 'flex';
      await _renderThumbs();
      await _renderAll();
      _watchScroll();
    } catch(err) {
      Logger.error('PDF', `Load failed: ${err.message}`);
      const sp = el.querySelector('.pdf-spinner-wrap');
      if (sp) sp.innerHTML = `<div style="color:#e05555;padding:24px">❌ ${err.message}</div>`;
    }
  }

  // ── Render all pages ───────────────────────────────────────────────────────
  async function _renderAll() {
    if (!doc || rendering) return;
    rendering = true;
    const area = container.querySelector('.pdf-canvas-area');
    area.innerHTML = '';
    for (let pn = 1; pn <= doc.numPages; pn++) {
      await _renderOnePage(pn, area);
    }
    rendering = false;
    _updateUI();
    Logger.info('PDF', `All ${doc.numPages} pages rendered`);
  }

  async function _renderOnePage(pn, area) {
    const page = await doc.getPage(pn);
    const vp   = page.getViewport({scale});

    const wrap = document.createElement('div');
    wrap.id = `pdf-pw-${pn}`;
    wrap.style.cssText = `position:relative;width:${vp.width}px;height:${vp.height}px;flex-shrink:0;box-shadow:0 4px 24px rgba(0,0,0,0.5);background:#fff;`;

    // PDF canvas
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    canvas.style.display = 'block';
    wrap.appendChild(canvas);

    // Text layer — user-select:text, sits above canvas
    const textDiv = document.createElement('div');
    textDiv.className = 'pdf-text-layer';
    textDiv.style.cssText = `
      position:absolute;top:0;left:0;
      width:${vp.width}px;height:${vp.height}px;
      overflow:hidden;user-select:text;cursor:text;
      line-height:1;
    `;
    wrap.appendChild(textDiv);

    // Highlight layer — sits between canvas and text (pointer-events:none so text still selectable)
    const hlDiv = document.createElement('div');
    hlDiv.className = 'pdf-hl-layer';
    hlDiv.dataset.page = pn;
    hlDiv.style.cssText = `
      position:absolute;top:0;left:0;
      width:${vp.width}px;height:${vp.height}px;
      pointer-events:none;overflow:visible;
    `;
    // Insert BEFORE textDiv so highlights are under text layer
    wrap.insertBefore(hlDiv, textDiv);

    // Comment pin layer — above text layer, pointer-events:auto
    const pinDiv = document.createElement('div');
    pinDiv.className = 'pdf-pin-layer';
    pinDiv.dataset.page = pn;
    pinDiv.style.cssText = `
      position:absolute;top:0;left:0;
      width:${vp.width}px;height:${vp.height}px;
      pointer-events:none;overflow:visible;z-index:5;
    `;
    wrap.appendChild(pinDiv);

    // Page number label
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:absolute;bottom:6px;right:10px;font-size:10px;color:rgba(0,0,0,0.3);pointer-events:none;font-family:monospace';
    lbl.textContent = pn;
    wrap.appendChild(lbl);

    area.appendChild(wrap);

    // Render PDF
    await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;

    // Text layer
    const tc = await page.getTextContent();
    try {
      pdfjsLib.renderTextLayer({textContent: tc, container: textDiv, viewport: vp, textDivs: []});
    } catch(e) {}

    // Paint any existing annotations for this page
    _paintAnnots(pn, hlDiv, pinDiv, vp);

    // Selection handler
    const _pn = pn, _vp = vp;
    textDiv.addEventListener('mouseup', e => {
      setTimeout(() => _handleSel(e, _pn, hlDiv, pinDiv, _vp, wrap), 20);
    });
  }

  async function _rerender() {
    const area = container.querySelector('.pdf-canvas-area');
    const pct  = area.scrollHeight > 0 ? area.scrollTop / area.scrollHeight : 0;
    await _renderAll();
    area.scrollTop = pct * area.scrollHeight;
  }

  // ── Thumbnails ─────────────────────────────────────────────────────────────
  async function _renderThumbs() {
    const panel = container.querySelector('.pdf-thumbs');
    if (!panel) return;
    panel.innerHTML = '';
    for (let i = 1; i <= Math.min(doc.numPages, 80); i++) {
      const item = document.createElement('div');
      item.className = 'pdf-thumb' + (i === 1 ? ' active' : '');
      item.id = `pdf-thumb-${i}`;
      item.innerHTML = `<canvas></canvas><div class="pdf-thumb-num">${i}</div>`;
      item.addEventListener('click', () => _scrollTo(i));
      panel.appendChild(item);
      const page = await doc.getPage(i);
      const vp   = page.getViewport({scale: 0.18});
      const c    = item.querySelector('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({canvasContext: c.getContext('2d'), viewport: vp}).promise;
    }
  }

  // ── Text selection → tooltip ───────────────────────────────────────────────
  function _handleSel(e, pn, hlDiv, pinDiv, vp, wrap) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const text = sel.toString().trim();

    // Store NORMALIZED rects (as fraction of page size) so they survive zoom changes
    const pageRect = wrap.getBoundingClientRect();
    const normRects = [];
    if (sel.rangeCount) {
      Array.from(sel.getRangeAt(0).getClientRects()).forEach(r => {
        if (r.width < 2 || r.height < 1) return;
        normRects.push({
          x: (r.left - pageRect.left) / pageRect.width,
          y: (r.top  - pageRect.top)  / pageRect.height,
          w: r.width  / pageRect.width,
          h: r.height / pageRect.height,
        });
      });
    }
    if (!normRects.length) return;

    _pSel = {pn, normRects, text, hlDiv, pinDiv, vp};
    _showTooltip(e.clientX, e.clientY);
  }

  function _showTooltip(cx, cy) {
    document.querySelectorAll('.pdf-annot-tooltip').forEach(t => t.remove());
    const tip = document.createElement('div');
    tip.className = 'pdf-annot-tooltip';
    tip.style.cssText = `
      position:fixed;z-index:99999;
      left:${Math.min(cx - 60, window.innerWidth - 300)}px;
      top:${Math.max(8, cy - 64)}px;
      background:#1a1c2a;
      border:1px solid rgba(255,255,255,0.12);
      border-radius:10px;padding:6px 8px;
      display:flex;gap:6px;align-items:center;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
      animation:fadeIn 0.1s ease;
      font-family:Inter,sans-serif;
    `;
    tip.innerHTML = `
      <button onclick="PDFViewer._apply('highlight')"
        style="display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:7px;
               background:rgba(250,204,21,0.18);border:1.5px solid rgba(250,204,21,0.5);
               color:#fbbf24;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;
               transition:background 0.1s">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/>
        </svg>
        Highlight
      </button>
      <button onclick="PDFViewer._apply('comment')"
        style="display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:7px;
               background:rgba(52,211,153,0.12);border:1.5px solid rgba(52,211,153,0.4);
               color:#34d399;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        Comment
      </button>
      <button onclick="this.closest('.pdf-annot-tooltip').remove()"
        style="padding:4px 7px;background:none;border:none;color:rgba(255,255,255,0.25);
               font-size:18px;cursor:pointer;line-height:1;font-family:sans-serif">×</button>
    `;
    document.body.appendChild(tip);

    // Dismiss on outside click — but NOT immediately (let button clicks fire first)
    function onOutside(ev) {
      if (!tip.contains(ev.target) && !ev.target.closest('.pdf-annot-tooltip')) {
        tip.remove();
        document.removeEventListener('mousedown', onOutside);
      }
    }
    setTimeout(() => document.addEventListener('mousedown', onOutside), 200);
  }

  // ── Apply annotation ───────────────────────────────────────────────────────
  function _apply(type) {
    // Remove tooltip first
    document.querySelectorAll('.pdf-annot-tooltip').forEach(t => t.remove());

    if (!_pSel) return;
    const saved = {..._pSel}; // capture before async clears it

    if (type === 'highlight') {
      _commitAnnot(saved, 'highlight', '');
      window.getSelection()?.removeAllRanges();
      _pSel = null;
    } else {
      // Comment: show modal, then commit
      window.getSelection()?.removeAllRanges();
      _showCommentModal(saved.text, (commentText) => {
        if (commentText !== null) {
          _commitAnnot(saved, 'comment', commentText);
        }
        _pSel = null;
      });
    }
  }

  function _commitAnnot(sel, type, comment) {
    const {pn, normRects, text, hlDiv, pinDiv, vp} = sel;
    const id = 'a' + (++annotId);
    if (!annots[pn]) annots[pn] = [];
    annots[pn].push({id, type, normRects, text, comment});
    _paintAnnots(pn, hlDiv, pinDiv, vp);
    _toast(type === 'highlight' ? '✏ Highlighted' : '💬 Comment saved');
    Logger.info('PDF', `${type} added p${pn}: "${text.slice(0,50)}"`);
  }

  // ── Paint annotations onto highlight/pin layers ────────────────────────────
  function _paintAnnots(pn, hlDiv, pinDiv, vp) {
    if (!hlDiv || !pinDiv) return;
    // Clear existing marks/pins
    hlDiv.querySelectorAll('.pdf-hl-mark, .pdf-cmt-mark').forEach(m => m.remove());
    pinDiv.querySelectorAll('.pdf-cmt-pin').forEach(m => m.remove());

    const W = vp.width, H = vp.height;

    (annots[pn] || []).forEach(a => {
      a.normRects.forEach((nr, ri) => {
        // Convert normalized → pixel for current scale
        const px = nr.x * W, py = nr.y * H, pw = nr.w * W, ph = nr.h * H;

        const mark = document.createElement('div');

        if (a.type === 'highlight') {
          mark.className = 'pdf-hl-mark';
          mark.style.cssText = `
            position:absolute;
            left:${px}px; top:${py}px;
            width:${pw}px; height:${ph}px;
            background:rgba(250,204,21,0.42);
            mix-blend-mode:multiply;
            border-radius:1px;
            pointer-events:none;
          `;
          mark.title = a.text;
          hlDiv.appendChild(mark);

        } else if (a.type === 'comment') {
          mark.className = 'pdf-cmt-mark';
          mark.style.cssText = `
            position:absolute;
            left:${px}px; top:${py}px;
            width:${pw}px; height:${ph}px;
            background:rgba(52,211,153,0.22);
            border-bottom:2px solid rgba(16,185,129,0.9);
            mix-blend-mode:multiply;
            border-radius:1px;
            pointer-events:none;
          `;
          hlDiv.appendChild(mark);

          // Pin icon — only on first rect, appears in pin layer (above text)
          if (ri === 0) {
            const pin = document.createElement('div');
            pin.className = 'pdf-cmt-pin';
            pin.style.cssText = `
              position:absolute;
              left:${px + pw}px;
              top:${Math.max(0, py - 14)}px;
              width:20px; height:20px;
              border-radius:50%;
              background:#10b981;
              color:#fff;
              display:flex; align-items:center; justify-content:center;
              font-size:11px;
              cursor:pointer; pointer-events:auto;
              box-shadow:0 2px 6px rgba(0,0,0,0.25);
              border:1.5px solid #fff;
              z-index:10;
              user-select:none;
            `;
            pin.textContent = '💬';
            pin.title = `Comment: ${a.comment}`;
            pin.addEventListener('click', ev => {
              ev.stopPropagation();
              _showCommentPopover(ev.clientX, ev.clientY, a);
            });
            pinDiv.style.pointerEvents = 'none'; // layer itself non-blocking
            pinDiv.appendChild(pin);
          }
        }
      });
    });
  }

  // ── Comment modal (async, never disappears) ────────────────────────────────
  function _showCommentModal(selectedText, callback) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;
      background:rgba(0,0,0,0.55);
      z-index:999999;
      display:flex;align-items:center;justify-content:center;
      font-family:Inter,sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#1e2030;border:1px solid rgba(255,255,255,0.12);
                  border-radius:14px;padding:24px;width:400px;
                  box-shadow:0 20px 60px rgba(0,0,0,0.7);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:18px">💬</span>
          <span style="font-size:15px;font-weight:600;color:#e8e8f2">Add Comment</span>
        </div>
        <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);
                    border-radius:8px;padding:10px 12px;margin-bottom:14px;
                    font-size:12px;color:#9ca3af;font-style:italic;line-height:1.5;">
          "${selectedText.slice(0, 120)}${selectedText.length > 120 ? '…' : ''}"
        </div>
        <textarea id="_cmt_ta" rows="4" placeholder="Type your comment here…"
          style="width:100%;background:#13141a;border:1px solid rgba(255,255,255,0.1);
                 border-radius:8px;color:#e8e8f2;font-size:13px;padding:12px;
                 resize:vertical;font-family:Inter,sans-serif;outline:none;
                 box-sizing:border-box;line-height:1.6;"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
          <button id="_cmt_cancel"
            style="padding:9px 20px;background:none;border:1px solid rgba(255,255,255,0.12);
                   border-radius:8px;color:#9ca3af;font-size:13px;cursor:pointer;
                   font-family:Inter,sans-serif;">Cancel</button>
          <button id="_cmt_save"
            style="padding:9px 20px;background:#10b981;border:none;border-radius:8px;
                   color:#fff;font-size:13px;font-weight:600;cursor:pointer;
                   font-family:Inter,sans-serif;">Save Comment</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const ta = overlay.querySelector('#_cmt_ta');
    ta.focus();

    overlay.querySelector('#_cmt_cancel').addEventListener('click', () => {
      overlay.remove();
      callback(null);
    });

    overlay.querySelector('#_cmt_save').addEventListener('click', () => {
      const val = ta.value.trim() || '(no text)';
      overlay.remove();
      callback(val);
    });

    ta.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        overlay.querySelector('#_cmt_save').click();
      }
      if (ev.key === 'Escape') {
        overlay.querySelector('#_cmt_cancel').click();
      }
    });
  }

  // ── Comment popover (shown when clicking 💬 pin) ──────────────────────────
  function _showCommentPopover(cx, cy, annot) {
    document.querySelectorAll('.pdf-cmt-popover').forEach(p => p.remove());
    const pop = document.createElement('div');
    pop.className = 'pdf-cmt-popover';
    pop.style.cssText = `
      position:fixed;z-index:999998;
      left:${Math.min(cx + 10, window.innerWidth - 300)}px;
      top:${Math.min(cy - 10, window.innerHeight - 200)}px;
      background:#fff;
      border:1px solid #e2e8f0;
      border-radius:12px;padding:16px;width:280px;
      box-shadow:0 8px 32px rgba(0,0,0,0.15);
      font-family:Inter,sans-serif;
    `;
    pop.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span style="font-size:14px">💬</span>
        <span style="font-size:11px;font-weight:700;color:#10b981;letter-spacing:0.05em;text-transform:uppercase">Comment</span>
        <button onclick="this.closest('.pdf-cmt-popover').remove()"
          style="margin-left:auto;background:none;border:none;color:#9ca3af;font-size:16px;cursor:pointer;line-height:1">×</button>
      </div>
      <div style="font-size:11px;color:#9ca3af;font-style:italic;margin-bottom:10px;line-height:1.5;
                  padding:8px;background:#f8fafc;border-radius:6px;border-left:3px solid #10b981">
        "${annot.text.slice(0, 100)}${annot.text.length > 100 ? '…' : ''}"
      </div>
      <div style="font-size:13px;color:#1e293b;line-height:1.6">${annot.comment}</div>
    `;
    document.body.appendChild(pop);

    // Dismiss on outside click
    function onOut(ev) {
      if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', onOut); }
    }
    setTimeout(() => document.addEventListener('mousedown', onOut), 100);
  }

  // ── Scroll & page tracking ─────────────────────────────────────────────────
  function _scrollTo(n) {
    const area = container.querySelector('.pdf-canvas-area');
    const pw   = document.getElementById(`pdf-pw-${n}`);
    if (area && pw) { area.scrollTo({top: pw.offsetTop - 16, behavior: 'smooth'}); curPage = n; _updateUI(); _thumbActive(); }
  }

  function _watchScroll() {
    const area = container.querySelector('.pdf-canvas-area');
    if (!area) return;
    area.addEventListener('scroll', () => {
      // Broadcast scroll position to collaborators (follow mode)
      if (typeof collabSyncScroll === 'function') {
        collabSyncScroll('.pdf-canvas-area', area.scrollTop, area.scrollLeft);
      }
      const ar = area.getBoundingClientRect();
      let best = 1, bestVis = -Infinity;
      for (let pn = 1; pn <= (doc?.numPages || 1); pn++) {
        const pw = document.getElementById(`pdf-pw-${pn}`);
        if (!pw) continue;
        const r = pw.getBoundingClientRect();
        const vis = Math.min(r.bottom, ar.bottom) - Math.max(r.top, ar.top);
        if (vis > bestVis) { bestVis = vis; best = pn; }
      }
      if (best !== curPage) { curPage = best; _updateUI(); _thumbActive(); }
    }, {passive: true});
  }

  function _thumbActive() {
    container.querySelectorAll('.pdf-thumb').forEach(t => t.classList.remove('active'));
    const a = container.querySelector(`#pdf-thumb-${curPage}`);
    if (a) { a.classList.add('active'); a.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────
  async function _zoom(delta) {
    scale = Math.max(0.3, Math.min(4.0, scale + delta));
    const sel = container.querySelector('#pdf-zoom-select');
    if (sel) {
      const opts = Array.from(sel.options).map(o => parseFloat(o.value));
      sel.value = opts.reduce((a, b) => Math.abs(b - scale) < Math.abs(a - scale) ? b : a);
    }
    await _rerender();
  }

  async function _fitWidth() {
    const area = container.querySelector('.pdf-canvas-area');
    if (!doc || !area) return;
    const page = await doc.getPage(1);
    const vp   = page.getViewport({scale: 1});
    scale = (area.clientWidth - 64) / vp.width;
    await _rerender();
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────
  function _updateUI() {
    const inp = container.querySelector('#pdf-pg-input');
    const pg  = container.querySelector('#pdf-status-pg');
    const zm  = container.querySelector('#pdf-statusbar-zoom');
    if (inp) inp.value = curPage;
    if (pg)  pg.textContent = `Page ${curPage} of ${doc?.numPages || '—'}`;
    if (zm)  zm.textContent = `${Math.round(scale * 100)}%`;
  }

  function _addNote() {
    const ta = container.querySelector('#pdf-note-ta');
    if (!ta?.value?.trim()) return;
    notes.push({page: curPage, text: ta.value.trim(), time: new Date().toLocaleTimeString()});
    _renderNotes(); ta.value = '';
  }

  function _renderNotes() {
    const list = container.querySelector('.pdf-notes-list');
    if (!list) return;
    list.innerHTML = notes.map(n => `
      <div class="pdf-note-item">
        <div style="font-size:10px;color:#f97316;margin-bottom:3px">Page ${n.page} · ${n.time}</div>
        ${n.text}
      </div>`).join('');
  }

  function _toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tmr);
    t._tmr = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ── Toolbar binding ────────────────────────────────────────────────────────
  function _bindToolbar() {
    container.addEventListener('click', async e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      switch (action) {
        case 'prev':      _scrollTo(Math.max(1, curPage - 1));                       break;
        case 'next':      _scrollTo(Math.min(doc?.numPages || 1, curPage + 1));      break;
        case 'zoom-out':  await _zoom(-0.25);                                        break;
        case 'zoom-in':   await _zoom(+0.25);                                        break;
        case 'fit-width': await _fitWidth();                                         break;
        case 'actual':    scale = 1.0; await _rerender();                            break;
        case 'thumbs':
          showThumbs = !showThumbs;
          container.querySelector('.pdf-thumbs').classList.toggle('hidden', !showThumbs);
          e.target.closest('[data-action]').classList.toggle('active', showThumbs);  break;
        case 'notes':
          showNotes = !showNotes;
          container.querySelector('.pdf-notes-panel').classList.toggle('hidden', !showNotes);
          e.target.closest('[data-action]').classList.toggle('active', showNotes);   break;
        case 'add-note':  _addNote();                                                break;
        case 'print':     window.print();                                            break;
        case 'download':  Object.assign(document.createElement('a'), {href: entry.url, download: entry.name}).click(); break;
      }
    });

    container.addEventListener('change', async e => {
      if (e.target.id === 'pdf-pg-input') { const n = parseInt(e.target.value); if (!isNaN(n)) _scrollTo(n); }
      if (e.target.id === 'pdf-zoom-select') { scale = parseFloat(e.target.value); await _rerender(); }
    });

    container.setAttribute('tabindex', '0');
    container.addEventListener('keydown', async e => {
      if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') _scrollTo(Math.min(doc?.numPages || 1, curPage + 1));
      if (e.key === 'ArrowUp'   || e.key === 'PageUp')   _scrollTo(Math.max(1, curPage - 1));
      if (e.key === 'Home') _scrollTo(1);
      if (e.key === 'End')  _scrollTo(doc?.numPages || 1);
      if ((e.key === '+' || e.key === '=') && !e.ctrlKey) await _zoom(0.25);
      if (e.key === '-' && !e.ctrlKey) await _zoom(-0.25);
    });

    container.addEventListener('wheel', async e => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); await _zoom(e.deltaY < 0 ? 0.15 : -0.15); }
    }, {passive: false});
  }

  // ── Skeleton HTML ──────────────────────────────────────────────────────────
  function _skeleton() { return `
<div class="pdf-viewer">
  <div class="pdf-toolbar">
    <div class="pdf-tb-group">
      <button class="pdf-tb-btn" data-action="prev" title="Previous page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <input class="pdf-page-input" id="pdf-pg-input" type="number" min="1" value="1">
      <span class="pdf-page-total">/ <span id="pdf-total">—</span></span>
      <button class="pdf-tb-btn" data-action="next" title="Next page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="pdf-tb-group">
      <button class="pdf-tb-btn" data-action="zoom-out" title="Zoom out">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      </button>
      <select class="pdf-zoom-select" id="pdf-zoom-select">
        <option value="0.5">50%</option><option value="0.75">75%</option>
        <option value="1.0">100%</option><option value="1.25">125%</option>
        <option value="1.5" selected>150%</option><option value="1.75">175%</option>
        <option value="2.0">200%</option><option value="2.5">250%</option>
        <option value="3.0">300%</option><option value="4.0">400%</option>
      </select>
      <button class="pdf-tb-btn" data-action="zoom-in" title="Zoom in">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      </button>
      <button class="pdf-tb-btn" data-action="fit-width" title="Fit width" style="width:auto;padding:0 8px;font-size:10px">Fit W</button>
      <button class="pdf-tb-btn" data-action="actual" title="100%" style="width:auto;padding:0 8px;font-size:10px">1:1</button>
    </div>
    <div class="pdf-tb-group">
      <button class="pdf-tb-btn active" data-action="thumbs" title="Thumbnails">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      </button>
      <button class="pdf-tb-btn" data-action="notes" title="Notes">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      </button>
    </div>
    <div class="pdf-tb-group">
      <input class="pdf-search-input" type="text" placeholder="Search in PDF…">
    </div>
    <div class="pdf-tb-group">
      <button class="pdf-tb-btn" data-action="download" title="Download">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      <button class="pdf-tb-btn" data-action="print" title="Print">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      </button>
    </div>
  </div>
  <div class="pdf-body">
    <div class="pdf-thumbs" id="pdf-thumbs"></div>
    <div class="pdf-canvas-area" style="display:none"></div>
    <div class="pdf-notes-panel hidden" id="pdf-notes-panel">
      <div class="pdf-notes-header">📝 Notes</div>
      <div class="pdf-notes-list"></div>
      <div class="pdf-notes-footer">
        <textarea id="pdf-note-ta" placeholder="Add note…"></textarea>
        <button class="pdf-add-note-btn" data-action="add-note">Add</button>
      </div>
    </div>
  </div>
  <div class="pdf-spinner-wrap">
    <div class="pdf-spinner"></div>
    <div style="font-size:12px;color:#888;margin-top:8px">Loading PDF…</div>
    <div class="pdf-progress" style="margin-top:8px"><div class="pdf-progress-bar"></div></div>
  </div>
  <div class="pdf-statusbar">
    <span id="pdf-status-pg">Page — of —</span>
    <span id="pdf-statusbar-zoom">150%</span>
    <span style="margin-left:auto;opacity:.3;font-size:10px">Select text → Highlight or Comment</span>
  </div>
</div>`; }

  return { load, _apply };
})();

window.PDFViewer = PDFViewer;
