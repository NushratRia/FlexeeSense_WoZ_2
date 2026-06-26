/* whiteboard.js — Canvas whiteboard with image preview, sticky notes, connectors */

const Whiteboard = (() => {
  let canvas, ctx, container;
  let tool = 'select';
  let zoom = 1, panX = 0, panY = 0;
  let spaceDown = false;
  let isPanning = false, panStart = null;
  let isDrawing = false, currentStroke = null;
  let drawColor = '#f97316', drawSize = 3;
  let isErasing = false;
  let isDragging = false, dragEl = null, dragOffX = 0, dragOffY = 0;
  let isResizing = false, resizeEl = null, resizeStart = null;
  let isConnecting = false, connectFrom = null, previewPt = null;
  let elements = [], strokes = [], connectors = [];
  let selected = null;
  let history = [], redoSt = [];
  let elId = 0;
  const GRID = 24;
  const imgCache = {}; // url → HTMLImageElement

  // ── Init ──────────────────────────────────────────────────────────────
  function init(canvasEl, wrapEl) {
    canvas = canvasEl; ctx = canvas.getContext('2d'); container = wrapEl;
    _resize();
    canvas.addEventListener('mousedown',   _onDown);
    canvas.addEventListener('mousemove',   _onMove);
    canvas.addEventListener('mouseup',     _onUp);
    canvas.addEventListener('mouseleave',  _onLeave);
    canvas.addEventListener('dblclick',    _onDbl);
    canvas.addEventListener('contextmenu', _onRightClick);
    canvas.addEventListener('wheel',       _onWheel, { passive: false });
    canvas.addEventListener('touchstart',  e=>{e.preventDefault();_onDown(e.touches[0]);},{passive:false});
    canvas.addEventListener('touchmove',   e=>{e.preventDefault();_onMove(e.touches[0]);},{passive:false});
    canvas.addEventListener('touchend',    e=>{e.preventDefault();_onUp(e.changedTouches[0]);},{passive:false});
    window.addEventListener('keydown', _onKey);
    window.addEventListener('keyup',   e=>{if(e.key===' '){spaceDown=false;_cursor();}});
    window.addEventListener('resize',  _resize);
    _initMinimap();
    render();
    _status('Select & move · Dbl-click canvas = new sticky · Del = remove');
  }

  function _resize() {
    if (!canvas||!container) return;
    const r = container.getBoundingClientRect();
    canvas.width  = Math.max(r.width  || 600, 200);
    canvas.height = Math.max(r.height || 400, 200);
    render();
  }

  function _tw(sx,sy) { return {x:(sx-panX)/zoom, y:(sy-panY)/zoom}; }
  function _cp(e) {
    const r=canvas.getBoundingClientRect(), s=e.touches?e.touches[0]:e;
    return {x:s.clientX-r.left, y:s.clientY-r.top};
  }
  function _center() { return {x:(canvas.width/2-panX)/zoom, y:(canvas.height/2-panY)/zoom}; }

  function _rr(x,y,w,h,r) {
    r=Math.min(r,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
    ctx.closePath();
  }

  // ── Render ────────────────────────────────────────────────────────────
  function render() {
    if (!ctx) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#f1f5f9'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();
    ctx.translate(panX,panY); ctx.scale(zoom,zoom);
    _drawGrid();
    connectors.forEach(_drawConn);
    strokes.forEach(_drawStroke);
    elements.forEach(_drawEl);
    if (selected) { const el=elements.find(e=>e.id===selected); if(el) _drawSel(el); }
    if (isConnecting && connectFrom && previewPt) {
      ctx.save();
      ctx.strokeStyle='#f97316'; ctx.lineWidth=2/zoom; ctx.setLineDash([6/zoom,3/zoom]);
      ctx.beginPath();
      ctx.moveTo(connectFrom.x+connectFrom.w/2, connectFrom.y+connectFrom.h/2);
      ctx.lineTo(previewPt.x,previewPt.y); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }
    ctx.restore();
    _drawMinimap();
  }

  function _drawGrid() {
    const step=GRID, l=Math.floor(-panX/zoom/step)*step-step, t=Math.floor(-panY/zoom/step)*step-step;
    const r=l+canvas.width/zoom+step*2, b=t+canvas.height/zoom+step*2;
    ctx.strokeStyle='rgba(148,163,184,0.13)'; ctx.lineWidth=0.5/zoom;
    for(let x=l;x<=r;x+=step){ctx.beginPath();ctx.moveTo(x,t);ctx.lineTo(x,b);ctx.stroke();}
    for(let y=t;y<=b;y+=step){ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(r,y);ctx.stroke();}
  }

  function _drawStroke(s) {
    if(!s.points||s.points.length<2) return;
    ctx.save(); ctx.strokeStyle=s.color; ctx.lineWidth=s.size/zoom;
    ctx.lineCap=ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(s.points[0].x,s.points[0].y);
    s.points.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.stroke(); ctx.restore();
  }

  function _drawConn(c) {
    const a=elements.find(e=>e.id===c.fromId), b=elements.find(e=>e.id===c.toId);
    if(!a||!b) return;
    const ax=a.x+a.w/2,ay=a.y+a.h/2,bx=b.x+b.w/2,by=b.y+b.h/2;
    const ang=Math.atan2(by-ay,bx-ax), hl=14/zoom;
    ctx.save();
    ctx.strokeStyle='#64748b'; ctx.lineWidth=2/zoom; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    ctx.fillStyle='#64748b'; ctx.beginPath();
    ctx.moveTo(bx,by);
    ctx.lineTo(bx-hl*Math.cos(ang-0.4),by-hl*Math.sin(ang-0.4));
    ctx.lineTo(bx-hl*Math.cos(ang+0.4),by-hl*Math.sin(ang+0.4));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='#f97316'; ctx.beginPath(); ctx.arc(ax,ay,4/zoom,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // ── Sticky colours ─────────────────────────────────────────────────────
  const STICKY_COLORS = {
    yellow: {bg:'#FFF9C4',border:'#F6E05E',text:'#7B6F00'},
    orange: {bg:'#FEECDC',border:'#F6AD55',text:'#7B3D00'},
    green:  {bg:'#DCFCE7',border:'#4ADE80',text:'#14532D'},
    blue:   {bg:'#DBEAFE',border:'#60A5FA',text:'#1E3A5F'},
    pink:   {bg:'#FCE7F3',border:'#F472B6',text:'#831843'},
    purple: {bg:'#EDE9FE',border:'#A78BFA',text:'#4C1D95'},
    teal:   {bg:'#CCFBF1',border:'#2DD4BF',text:'#134E4A'},
  };
  const STICKY_COLOR_KEYS = Object.keys(STICKY_COLORS);

  // ── Draw elements ──────────────────────────────────────────────────────
  function _drawEl(el) {
    if (el.type==='sticky')                              _drawSticky(el);
    else if (['pdf-card','video-card','code-card',
              'image-card','doc-card'].includes(el.type)) _drawFileCard(el);
  }

  function _drawSticky(el) {
    const sc = STICKY_COLORS[el.color] || STICKY_COLORS.yellow;
    const {x,y,w,h} = el;
    const isSel = selected===el.id;
    const topH  = isSel ? 32/zoom : 8/zoom;

    // Shadow + fill
    ctx.shadowColor='rgba(0,0,0,0.14)'; ctx.shadowBlur=12/zoom; ctx.shadowOffsetY=4/zoom;
    ctx.fillStyle=sc.bg; _rr(x,y,w,h,8/zoom); ctx.fill();
    ctx.shadowColor='transparent';

    // Border
    ctx.strokeStyle = isSel ? '#f97316' : sc.border+'88';
    ctx.lineWidth   = isSel ? 2/zoom : 1.5/zoom;
    _rr(x,y,w,h,8/zoom); ctx.stroke();

    // Top bar
    ctx.fillStyle=sc.border;
    ctx.save(); ctx.beginPath();
    const r8=8/zoom;
    ctx.moveTo(x+r8,y); ctx.lineTo(x+w-r8,y); ctx.arcTo(x+w,y,x+w,y+r8,r8);
    ctx.lineTo(x+w,y+topH); ctx.lineTo(x,y+topH);
    ctx.lineTo(x,y+r8); ctx.arcTo(x,y,x+r8,y,r8);
    ctx.closePath(); ctx.fill(); ctx.restore();

    if (isSel) {
      // Color dots in top bar
      const dotColors = [
        {key:'yellow',c:'#FEF08A',b:'#F6E05E'},
        {key:'blue',  c:'#DBEAFE',b:'#60A5FA'},
        {key:'teal',  c:'#CCFBF1',b:'#2DD4BF'},
        {key:'pink',  c:'#FCE7F3',b:'#F472B6'},
        {key:'purple',c:'#EDE9FE',b:'#A78BFA'},
        {key:'orange',c:'#FEECDC',b:'#F6AD55'},
        {key:'green', c:'#DCFCE7',b:'#4ADE80'},
      ];
      const dotR=9/zoom;
      const total=dotColors.length*(dotR*2+4/zoom)-4/zoom;
      let dotX=x+(w-total)/2;
      const dotY=y+topH/2;
      dotColors.forEach(d=>{
        ctx.fillStyle=d.c; ctx.beginPath(); ctx.arc(dotX+dotR,dotY,dotR,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=el.color===d.key?'#1e293b':d.b;
        ctx.lineWidth=el.color===d.key?2.5/zoom:1.5/zoom;
        ctx.beginPath(); ctx.arc(dotX+dotR,dotY,dotR,0,Math.PI*2); ctx.stroke();
        dotX+=dotR*2+4/zoom;
      });
      // × inside top bar
      const cxb=x+w-14/zoom, cyb=y+topH/2;
      ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.arc(cxb,cyb,8/zoom,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font=`bold ${12/zoom}px sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('×',cxb,cyb);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    }

    // Fold corner
    const fs=18/zoom;
    ctx.fillStyle='rgba(0,0,0,0.06)';
    ctx.beginPath(); ctx.moveTo(x+w-fs,y+h); ctx.lineTo(x+w,y+h-fs); ctx.lineTo(x+w,y+h); ctx.closePath(); ctx.fill();

    // Text
    const textTop=y+topH+10/zoom;
    const fss=Math.max(10,Math.min(15,13/zoom));
    ctx.fillStyle=sc.text; ctx.font=`500 ${fss}px Inter,system-ui,sans-serif`;
    ctx.textBaseline='top';
    if(el.text){
      _wrapText(el.text,x+10/zoom,textTop,w-20/zoom,fss*1.55);
    } else {
      ctx.fillStyle=sc.text+'50'; ctx.font=`italic ${fss}px Inter,system-ui,sans-serif`;
      ctx.fillText('Click to edit…',x+10/zoom,textTop);
    }
    ctx.textBaseline='alphabetic';
  }

  function _drawFileCard(el) {
    const T = {
      'pdf-card':   {icon:'📑',hdr:'#ef4444',sub:'PDF Document'},
      'video-card': {icon:'🎬',hdr:'#f59e0b',sub:'Video file'},
      'code-card':  {icon:'💻',hdr:'#8b5cf6',sub:'Code / Text'},
      'image-card': {icon:'🖼',hdr:'#0891b2',sub:'Image'},
      'doc-card':   {icon:'📝',hdr:'#059669',sub:'Document'},
    }[el.type] || {icon:'📄',hdr:'#64748b',sub:'File'};

    const {x,y,w,h}=el, rad=10/zoom;

    // ── IMAGE CARD: thumbnail preview ────────────────────────────────────
    if (el.type==='image-card') {
      ctx.shadowColor='rgba(0,0,0,0.18)'; ctx.shadowBlur=16/zoom; ctx.shadowOffsetY=5/zoom;
      ctx.fillStyle='#fff'; _rr(x,y,w,h,rad); ctx.fill();
      ctx.shadowColor='transparent';

      const bottomH = 34/zoom;
      const prevH   = h - bottomH;
      const img = el.url ? imgCache[el.url] : null;

      if (img && img.complete && img.naturalWidth > 0) {
        // Draw image as cover in top section
        ctx.save();
        _rr(x,y,w,prevH,[rad,rad,0,0]); ctx.clip();
        const iAR=img.naturalWidth/img.naturalHeight, bAR=w/prevH;
        let sx=0,sy=0,sw=img.naturalWidth,sh=img.naturalHeight;
        if(iAR>bAR){sw=img.naturalHeight*bAR;sx=(img.naturalWidth-sw)/2;}
        else        {sh=img.naturalWidth/bAR; sy=(img.naturalHeight-sh)/2;}
        ctx.drawImage(img,sx,sy,sw,sh,x,y,w,prevH);
        // Gradient overlay at top for filename
        const grad=ctx.createLinearGradient(x,y,x,y+30/zoom);
        grad.addColorStop(0,'rgba(0,0,0,0.5)'); grad.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=grad; ctx.fillRect(x,y,w,30/zoom);
        ctx.restore();
        // Filename on image
        const nfs=Math.max(8,11/zoom);
        ctx.fillStyle='#fff'; ctx.font=`600 ${nfs}px Inter,system-ui,sans-serif`;
        ctx.textBaseline='top'; ctx.fillText(_trunc(el.name||'Image',28),x+8/zoom,y+7/zoom);
        ctx.textBaseline='alphabetic';
      } else {
        // Loading state
        const cx=x+w/2, cy=y+prevH/2;
        const ang=(Date.now()/500)%(Math.PI*2);
        ctx.strokeStyle=T.hdr; ctx.lineWidth=3/zoom;
        ctx.beginPath(); ctx.arc(cx,cy,22/zoom,ang,ang+Math.PI*1.4); ctx.stroke();
        ctx.fillStyle='#94a3b8'; ctx.font=`${Math.max(9,11/zoom)}px Inter,system-ui,sans-serif`;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('Loading…',cx,cy+36/zoom);
        ctx.textAlign='left'; ctx.textBaseline='alphabetic';
        requestAnimationFrame(render);
      }

      // Bottom bar
      ctx.fillStyle='#f8fafc'; ctx.fillRect(x,y+prevH,w,bottomH);
      ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=1/zoom;
      ctx.beginPath(); ctx.moveTo(x,y+prevH); ctx.lineTo(x+w,y+prevH); ctx.stroke();
      _rr(x,y+prevH,w,bottomH,[0,0,rad,rad]); ctx.stroke();
      const bfs=Math.max(7,10/zoom);
      ctx.fillStyle=T.hdr; ctx.font=`500 ${bfs}px Inter,system-ui,sans-serif`;
      ctx.textBaseline='middle'; ctx.textAlign='center';
      ctx.fillText('▶ Open in viewer',x+w/2,y+prevH+bottomH/2);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
      if(el.size){
        ctx.fillStyle='#94a3b8'; ctx.font=`${bfs}px Inter,system-ui,sans-serif`;
        ctx.textBaseline='middle'; ctx.textAlign='right';
        ctx.fillText(el.size,x+w-8/zoom,y+prevH+bottomH/2);
        ctx.textAlign='left'; ctx.textBaseline='alphabetic';
      }
      // Outer border
      ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=1/zoom; _rr(x,y,w,h,rad); ctx.stroke();
      return;
    }

    // ── REGULAR FILE CARD ────────────────────────────────────────────────
    const hdrH=40/zoom;
    ctx.shadowColor='rgba(0,0,0,0.12)'; ctx.shadowBlur=14/zoom; ctx.shadowOffsetY=4/zoom;
    ctx.fillStyle='#fff'; _rr(x,y,w,h,rad); ctx.fill(); ctx.shadowColor='transparent';
    ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=1/zoom; _rr(x,y,w,h,rad); ctx.stroke();

    ctx.save(); ctx.fillStyle=T.hdr; ctx.beginPath();
    ctx.moveTo(x+rad,y); ctx.lineTo(x+w-rad,y); ctx.arcTo(x+w,y,x+w,y+rad,rad);
    ctx.lineTo(x+w,y+hdrH); ctx.lineTo(x,y+hdrH);
    ctx.lineTo(x,y+rad); ctx.arcTo(x,y,x+rad,y,rad);
    ctx.closePath(); ctx.fill(); ctx.restore();

    const hfs=Math.max(8,12/zoom);
    ctx.fillStyle='#fff'; ctx.font=`600 ${hfs}px Inter,system-ui,sans-serif`;
    ctx.textBaseline='middle'; ctx.fillText(`${T.icon}  ${_trunc(el.name||T.sub,22)}`,x+10/zoom,y+hdrH/2);

    const bfs=Math.max(7,10/zoom);
    ctx.fillStyle='#64748b'; ctx.font=`${bfs}px Inter,system-ui,sans-serif`; ctx.textBaseline='top';
    ctx.fillText(T.sub,x+10/zoom,y+hdrH+8/zoom);
    if(el.size){ctx.fillStyle='#94a3b8'; ctx.fillText(el.size,x+10/zoom,y+hdrH+22/zoom);}

    const bw=80/zoom,bh=24/zoom,bx2=x+w/2-bw/2,by2=y+h-bh-10/zoom;
    ctx.fillStyle=T.hdr+'22'; _rr(bx2,by2,bw,bh,4/zoom); ctx.fill();
    ctx.fillStyle=T.hdr; ctx.font=`500 ${bfs}px Inter,system-ui,sans-serif`;
    ctx.textBaseline='middle'; ctx.textAlign='center';
    ctx.fillText('▶ Open in viewer',x+w/2,by2+bh/2);
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  }

  function _drawSel(el) {
    const {x,y,w,h}=el;
    ctx.save();
    if(el.type!=='sticky'){
      ctx.strokeStyle='#f97316'; ctx.lineWidth=2/zoom; ctx.setLineDash([5/zoom,3/zoom]);
      ctx.strokeRect(x-6/zoom,y-6/zoom,w+12/zoom,h+12/zoom); ctx.setLineDash([]);
      // × button
      const dx=x+w+14/zoom, dy=y-14/zoom;
      ctx.shadowColor='rgba(0,0,0,0.2)'; ctx.shadowBlur=4/zoom;
      ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.arc(dx,dy,11/zoom,0,Math.PI*2); ctx.fill();
      ctx.shadowColor='transparent';
      ctx.fillStyle='#fff'; ctx.font=`bold ${14/zoom}px sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('×',dx,dy);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    }
    // Resize handle
    const rx=x+w+6/zoom, ry=y+h+6/zoom;
    ctx.fillStyle='#fff'; ctx.strokeStyle='#f97316'; ctx.lineWidth=1.5/zoom;
    ctx.beginPath(); ctx.arc(rx,ry,7/zoom,0,Math.PI*2); ctx.fill(); ctx.stroke();
    if(tool==='connect'){
      ctx.strokeStyle='#22c55e'; ctx.lineWidth=3/zoom;
      ctx.beginPath(); ctx.arc(x+w/2,y+h/2,Math.min(w,h)/2+8/zoom,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }

  function _wrapText(text,x,y,maxW,lineH){
    String(text||'').split('\n').forEach(line=>{
      const ws=line.split(/\s+/); let cur='';
      ws.forEach(w=>{const t=cur?cur+' '+w:w;if(ctx.measureText(t).width>maxW&&cur){ctx.fillText(cur,x,y);y+=lineH;cur=w;}else cur=t;});
      if(cur){ctx.fillText(cur,x,y);y+=lineH;}
    });
  }
  function _trunc(s,n){return s&&s.length>n?s.slice(0,n)+'…':s||'';}

  // ── Hit test ───────────────────────────────────────────────────────────
  function _hit(wx,wy){
    for(let i=elements.length-1;i>=0;i--){const e=elements[i];if(wx>=e.x&&wx<=e.x+e.w&&wy>=e.y&&wy<=e.y+e.h)return e;}
    return null;
  }

  // ── Events ────────────────────────────────────────────────────────────
  function _onDown(e) {
    const cp=_cp(e), wp=_tw(cp.x,cp.y);
    if(e.button===1||spaceDown||tool==='pan'){
      isPanning=true; panStart={sx:e.clientX||cp.x,sy:e.clientY||cp.y,px:panX,py:panY};
      canvas.style.cursor='grabbing'; return;
    }
    if(tool==='pen'){
      _save(); isDrawing=true;
      currentStroke={id:'s'+(++elId),points:[{...wp}],color:drawColor,size:drawSize};
      strokes.push(currentStroke); return;
    }
    if(tool==='eraser'){ isErasing=true; _eraseAt(wp); return; }
    if(tool==='connect'){
      const hit=_hit(wp.x,wp.y);
      if(!isConnecting){
        if(hit){isConnecting=true;connectFrom=hit;selected=hit.id;render();_status('Click another element to connect');}
      } else {
        if(hit&&hit.id!==connectFrom.id){
          _save(); connectors.push({id:'c'+(++elId),fromId:connectFrom.id,toId:hit.id});
          isConnecting=false;connectFrom=null;previewPt=null;selected=null;render();
          _status('Connected! Click two elements to connect');
        } else if(!hit){isConnecting=false;connectFrom=null;previewPt=null;selected=null;render();}
      }
      return;
    }
    if(tool==='select'){
      if(selected){
        const sel=elements.find(e=>e.id===selected);
        if(sel){
          // Sticky: internal × and color dots
          if(sel.type==='sticky'){
            const topH=32/zoom;
            const cxb=sel.x+sel.w-14/zoom, cyb=sel.y+topH/2;
            if(Math.hypot(wp.x-cxb,wp.y-cyb)<10/zoom){
              _save();elements=elements.filter(e=>e.id!==selected);connectors=connectors.filter(c=>c.fromId!==selected&&c.toId!==selected);selected=null;render();return;
            }
            if(wp.y>=sel.y&&wp.y<=sel.y+topH){
              const dotColors=['yellow','blue','teal','pink','purple','orange','green'];
              const dotR=9/zoom, total=dotColors.length*(dotR*2+4/zoom)-4/zoom;
              let dotX=sel.x+(sel.w-total)/2;
              for(const key of dotColors){
                if(Math.hypot(wp.x-(dotX+dotR),wp.y-(sel.y+topH/2))<dotR*1.3){_save();sel.color=key;render();return;}
                dotX+=dotR*2+4/zoom;
              }
            }
          } else {
            // External × for cards
            const dx=sel.x+sel.w+14/zoom, dy=sel.y-14/zoom;
            if(Math.hypot(wp.x-dx,wp.y-dy)<14/zoom){
              _save();elements=elements.filter(e=>e.id!==selected);connectors=connectors.filter(c=>c.fromId!==selected&&c.toId!==selected);selected=null;render();return;
            }
          }
          // Resize handle
          if(Math.hypot(wp.x-(sel.x+sel.w+6/zoom),wp.y-(sel.y+sel.h+6/zoom))<10/zoom){
            isResizing=true;resizeEl=sel;resizeStart={x:wp.x,y:wp.y,w:sel.w,h:sel.h};return;
          }
        }
      }
      const hit=_hit(wp.x,wp.y);
      if(hit){selected=hit.id;dragEl=hit;dragOffX=wp.x-hit.x;dragOffY=wp.y-hit.y;isDragging=false;render();}
      else{selected=null;render();}
    }
  }

  function _eraseAt(wp){
    const R=20/zoom;
    const before=strokes.length;
    strokes=strokes.filter(s=>!s.points.some(p=>Math.hypot(p.x-wp.x,p.y-wp.y)<R));
    if(strokes.length!==before)render();
  }

  function _onMove(e){
    const cp=_cp(e), wp=_tw(cp.x,cp.y);
    if(isPanning&&panStart){
      panX=panStart.px+(e.clientX||cp.x)-panStart.sx; panY=panStart.py+(e.clientY||cp.y)-panStart.sy; render();return;
    }
    if(isDrawing&&currentStroke){currentStroke.points.push({...wp});render();return;}
    if(isErasing){_eraseAt(wp);return;}
    if(isResizing&&resizeEl&&resizeStart){
      resizeEl.w=Math.max(80/zoom,resizeStart.w+(wp.x-resizeStart.x));
      resizeEl.h=Math.max(60/zoom,resizeStart.h+(wp.y-resizeStart.y));
      render();return;
    }
    if(dragEl){isDragging=true;dragEl.x=wp.x-dragOffX;dragEl.y=wp.y-dragOffY;render();return;}
    if(isConnecting){previewPt={...wp};render();return;}
    if(tool==='select')canvas.style.cursor=_hit(wp.x,wp.y)?'move':'default';
    if(tool==='eraser')canvas.style.cursor='cell';
  }

  function _onUp(){
    if(isPanning){isPanning=false;_cursor();}
    if(isDrawing){isDrawing=false;currentStroke=null;}
    if(isErasing){isErasing=false;}
    if(isResizing){if(resizeEl){_save();if(resizeEl)_syncUpd(resizeEl.id,{w:resizeEl.w,h:resizeEl.h});}isResizing=false;resizeEl=null;resizeStart=null;}
    if(dragEl){if(isDragging){_save();_syncMove(dragEl.id,dragEl.x,dragEl.y);}dragEl=null;isDragging=false;}
    render();
  }
  function _onLeave(){
    if(isDrawing){isDrawing=false;currentStroke=null;}
    if(isErasing){isErasing=false;}
    if(dragEl){dragEl=null;isDragging=false;}
    render();
  }

  function _onDbl(e){
    const cp=_cp(e), wp=_tw(cp.x,cp.y), hit=_hit(wp.x,wp.y);
    if(!hit){_addStickyAt(wp.x,wp.y);return;}
    if(hit.type==='sticky'){_editStickyInline(hit);}
    else if(hit.fileId&&typeof Tabs!=='undefined'){Tabs.activate(hit.fileId);if(typeof toast!=='undefined')toast('📂 Opened in viewer');}
  }

  function _onRightClick(e){
    e.preventDefault();
    const cp=_cp(e), wp=_tw(cp.x,cp.y), hit=_hit(wp.x,wp.y);
    if(hit){selected=hit.id;render();}
  }

  function _onWheel(e){
    e.preventDefault();
    if(e.ctrlKey||e.metaKey){
      const cp=_cp(e),f=e.deltaY<0?1.12:0.89,nz=Math.max(0.1,Math.min(6,zoom*f));
      panX=cp.x-(cp.x-panX)*(nz/zoom); panY=cp.y-(cp.y-panY)*(nz/zoom); zoom=nz; _zoomLabel();
    } else{panX-=e.deltaX;panY-=e.deltaY;}
    render();
  }

  function _onKey(e){
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)return;
    if(e.key===' '){spaceDown=true;e.preventDefault();canvas.style.cursor='grab';}
    if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}
    if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();redo();}
    if(e.key==='Delete'||e.key==='Backspace'){
      if(selected){_save();const _delId=selected;elements=elements.filter(el=>el.id!==_delId);connectors=connectors.filter(c=>c.fromId!==_delId&&c.toId!==_delId);selected=null;render();_syncDel(_delId);}
    }
    if(e.key==='Escape'){selected=null;isConnecting=false;connectFrom=null;previewPt=null;render();_cursor();}
    const S=40/zoom;
    if(e.key==='ArrowLeft'){panX+=S;render();e.preventDefault();}
    if(e.key==='ArrowRight'){panX-=S;render();e.preventDefault();}
    if(e.key==='ArrowUp'){panY+=S;render();e.preventDefault();}
    if(e.key==='ArrowDown'){panY-=S;render();e.preventDefault();}
  }

  // ── Inline sticky editor ───────────────────────────────────────────────
  function _editStickyInline(el){
    selected=null; render();
    const cr=canvas.getBoundingClientRect();
    const sx=el.x*zoom+panX, sy=el.y*zoom+panY;
    const editor=document.createElement('div');
    const sc=STICKY_COLORS[el.color]||STICKY_COLORS.yellow;
    editor.contentEditable='true';
    editor.textContent=el.text||'';
    editor.style.cssText=`
      position:fixed;left:${cr.left+sx}px;top:${cr.top+sy+32}px;
      width:${el.w*zoom}px;min-height:${(el.h-32)*zoom}px;
      background:${sc.bg};color:${sc.text};padding:10px 12px;
      font-family:Inter,system-ui,sans-serif;font-size:${Math.max(11,13*zoom)}px;
      line-height:1.55;outline:none;box-sizing:border-box;
      white-space:pre-wrap;word-break:break-word;cursor:text;
      box-shadow:0 0 0 2px #f97316;border-radius:0 0 8px 8px;z-index:10000;
    `;
    document.body.appendChild(editor);
    editor.focus();
    const r=document.createRange(); r.selectNodeContents(editor); r.collapse(false);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
    const commit=()=>{_save();el.text=editor.textContent.trim();editor.remove();render();_syncUpd(el.id,{text:el.text});};
    editor.addEventListener('blur',commit);
    editor.addEventListener('keydown',ev=>{if(ev.key==='Escape'){editor.remove();render();}ev.stopPropagation();});
  }

  // ── History ────────────────────────────────────────────────────────────
  function _save(){
    history.push(JSON.stringify({elements,strokes,connectors}));
    if(history.length>60)history.shift();
    redoSt=[];
  }
  // Granular sync helpers — called AFTER each specific mutation
  function _syncAdd(el)   { if(!window.syncIsApplying?.()) window.onWbElementAdded?.(el); }
  function _syncMove(id,x,y){ if(!window.syncIsApplying?.()) window.onWbElementMoved?.(id,x,y); }
  function _syncDel(id)   { if(!window.syncIsApplying?.()) window.onWbElementDeleted?.(id); }
  function _syncUpd(id,p) { if(!window.syncIsApplying?.()) window.onWbElementUpdated?.(id,p); }
  function _syncConns()   { if(!window.syncIsApplying?.()) window.onWbConnectorsChanged?.(connectors); }
  function undo(){if(!history.length)return;redoSt.push(JSON.stringify({elements,strokes,connectors}));const s=JSON.parse(history.pop());elements=s.elements;strokes=s.strokes;connectors=s.connectors;selected=null;render();}
  function redo(){if(!redoSt.length)return;history.push(JSON.stringify({elements,strokes,connectors}));const s=JSON.parse(redoSt.pop());elements=s.elements;strokes=s.strokes;connectors=s.connectors;selected=null;render();}

  // ── Add helpers ────────────────────────────────────────────────────────
  const COLOR_SEQ=STICKY_COLOR_KEYS;
  let _nextColor=null;
  function _pickColor(){if(_nextColor){const c=_nextColor;_nextColor=null;return c;}return COLOR_SEQ[elements.filter(e=>e.type==='sticky').length%COLOR_SEQ.length];}

  function _addStickyAt(wx,wy){
    _save();
    const count=elements.filter(e=>e.type==='sticky').length;
    const off=(count%8)*22;
    const el={id:'el'+(++elId),type:'sticky',x:wx-90+off,y:wy-90+off,w:180,h:180,color:_pickColor(),text:''};
    elements.push(el); selected=el.id; setTimeout(()=>_syncAdd(el), 50); render(); _broadcast();
    setTimeout(()=>_editStickyInline(el),60);
    _status('Type your note — click outside to save');
  }

  function addSticky(){
    const c=_center(), count=elements.filter(e=>e.type==='sticky').length, off=(count%8)*22;
    _addStickyAt(c.x+off,c.y+off);
  }

  function addFileCard(entry){
    _save();
    const c=_center();
    const typeMap={pdf:'pdf-card',video:'video-card',code:'code-card',text:'code-card',image:'image-card',document:'doc-card',unknown:'doc-card'};
    const isImg=(typeMap[entry.type]==='image-card');
    const el={
      id:'el'+(++elId),
      type:typeMap[entry.type]||'doc-card',
      x:c.x-(isImg?130:120), y:c.y-(isImg?105:80),
      w:isImg?260:240, h:isImg?210:160,
      name:entry.name,
      size:entry.size?(entry.size/1024).toFixed(0)+' KB':'',
      fileId:entry.id,
      url:entry.url,
    };
    elements.push(el); selected=el.id;

    // Preload image
    if(isImg && entry.url && !imgCache[entry.url]){
      const img=new Image();
      img.onload=()=>{imgCache[entry.url]=img;render();};
      img.onerror=()=>{imgCache[entry.url]=null;};
      img.src=entry.url;
    }
    render();
    _status(`${entry.name} added — dbl-click to open in viewer`);
  }

  function setStickyColor(color){
    if(selected){const el=elements.find(e=>e.id===selected&&e.type==='sticky');if(el){_save();el.color=color;render();return;}}
    _nextColor=color;
    if(typeof toast!=='undefined')toast('Next sticky will be '+color);
  }

  // ── Zoom / pan ─────────────────────────────────────────────────────────
  function setTool(t){
    tool=t;isConnecting=false;connectFrom=null;previewPt=null;
    document.querySelectorAll('.wb-sb[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
    _cursor();
    const H={select:'Click=select · Drag=move · Del=remove · Dbl-click empty=new sticky',pan:'Drag to pan · Scroll · Ctrl+scroll=zoom',pen:'Draw freehand strokes',eraser:'Drag over strokes to erase',connect:'Click element A → then element B → arrow drawn'};
    _status(H[t]||'');
  }
  function setColor(c){drawColor=c;}
  function setSize(s){drawSize=parseInt(s)||3;}
  function clear(){if(!confirm('Clear the entire whiteboard?'))return;_save();elements=[];strokes=[];connectors=[];selected=null;render();}
  function zoomIn(){const c=_center();zoom=Math.min(6,zoom*1.2);panX=canvas.width/2-c.x*zoom;panY=canvas.height/2-c.y*zoom;_zoomLabel();render();}
  function zoomOut(){const c=_center();zoom=Math.max(0.1,zoom/1.2);panX=canvas.width/2-c.x*zoom;panY=canvas.height/2-c.y*zoom;_zoomLabel();render();}
  function zoomReset(){zoom=1;panX=0;panY=0;_zoomLabel();render();}
  function exportPNG(){const a=Object.assign(document.createElement('a'),{href:canvas.toDataURL('image/png'),download:'whiteboard.png'});a.click();}
  function _cursor(){const M={select:'default',pan:'grab',pen:'crosshair',eraser:'cell',connect:'crosshair'};canvas.style.cursor=spaceDown?'grab':(M[tool]||'default');}
  function _zoomLabel(){const el=document.getElementById('wb-zoom-label');if(el)el.textContent=Math.round(zoom*100)+'%';}
  function _status(msg){const el=document.getElementById('wb-status');if(el)el.textContent=msg;}

  // ── Minimap ────────────────────────────────────────────────────────────
  let _mm=null,_mmc=null;
  function _initMinimap(){
    _mm=document.getElementById('wb-minimap');if(!_mm)return;
    _mmc=_mm.getContext('2d');_mm.width=160;_mm.height=100;
    _mm.addEventListener('mousedown',_mmDrag);
  }
  function _drawMinimap(){
    if(!_mmc)return;
    const mc=_mmc,W=160,H=100,pad=8;
    mc.clearRect(0,0,W,H);
    mc.fillStyle='rgba(15,23,42,0.9)';mc.beginPath();mc.roundRect(0,0,W,H,6);mc.fill();
    mc.strokeStyle='rgba(249,115,22,0.4)';mc.lineWidth=1;mc.stroke();
    let mnX=-200,mnY=-200,mxX=200,mxY=200;
    elements.forEach(el=>{mnX=Math.min(mnX,el.x-10);mnY=Math.min(mnY,el.y-10);mxX=Math.max(mxX,el.x+el.w+10);mxY=Math.max(mxY,el.y+el.h+10);});
    strokes.forEach(s=>s.points.forEach(p=>{mnX=Math.min(mnX,p.x);mnY=Math.min(mnY,p.y);mxX=Math.max(mxX,p.x);mxY=Math.max(mxY,p.y);}));
    const sc=Math.min((W-pad*2)/(mxX-mnX),(H-pad*2-12)/(mxY-mnY));
    const wx=x=>pad+(x-mnX)*sc, wy=y=>pad+(y-mnY)*sc;
    const TC={'sticky':'#fde047','pdf-card':'#ef4444','video-card':'#f59e0b','code-card':'#8b5cf6','image-card':'#0891b2','doc-card':'#059669'};
    elements.forEach(el=>{mc.fillStyle=(TC[el.type]||'#f97316')+'aa';mc.fillRect(wx(el.x),wy(el.y),Math.max(3,el.w*sc),Math.max(3,el.h*sc));});
    strokes.forEach(s=>{if(s.points.length<2)return;mc.beginPath();mc.strokeStyle=s.color+'aa';mc.lineWidth=1;mc.moveTo(wx(s.points[0].x),wy(s.points[0].y));s.points.forEach(p=>mc.lineTo(wx(p.x),wy(p.y)));mc.stroke();});
    const vl=-panX/zoom,vt=-panY/zoom;
    mc.strokeStyle='#fb923c';mc.lineWidth=1.5;mc.fillStyle='rgba(249,115,22,0.08)';
    mc.fillRect(wx(vl),wy(vt),canvas.width/zoom*sc,canvas.height/zoom*sc);
    mc.strokeRect(wx(vl),wy(vt),canvas.width/zoom*sc,canvas.height/zoom*sc);
    mc.fillStyle='#475569';mc.font='8px monospace';
    mc.fillText(`${Math.round(-panX/zoom)},${Math.round(-panY/zoom)}  ${Math.round(zoom*100)}%`,pad,H-4);
    _mm._meta={mnX,mnY,sc};
  }
  function _mmDrag(e){
    const nav=ev=>{const m=_mm._meta;if(!m)return;const r=_mm.getBoundingClientRect();panX=canvas.width/2-(m.mnX+(ev.clientX-r.left-8)/m.sc)*zoom;panY=canvas.height/2-(m.mnY+(ev.clientY-r.top-8)/m.sc)*zoom;render();};
    nav(e);
    const up=()=>{document.removeEventListener('mousemove',nav);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',nav);document.addEventListener('mouseup',up);e.stopPropagation();
  }

  function getState() { return {elements,strokes,connectors}; }

  function applyRemoteState(state) {
    if (!state) return;
    // Merge: keep local selection, replace data
    elements   = JSON.parse(JSON.stringify(state.elements   || []));
    strokes    = JSON.parse(JSON.stringify(state.strokes    || []));
    connectors = JSON.parse(JSON.stringify(state.connectors || []));
    selected   = null;
    render();
    Logger.debug('WB', `Remote state applied: ${elements.length} elements, ${strokes.length} strokes`);
  }


  // ── Granular apply methods (called by sync.js) ─────────────────────────
  function applyAddElement(el) {
    if (elements.find(e => e.id === el.id)) return; // dedup
    elements.push(JSON.parse(JSON.stringify(el)));
    render();
  }

  function applyMoveElement(id, x, y) {
    const el = elements.find(e => e.id === id);
    if (!el) return;
    el.x = x; el.y = y;
    render();
  }

  function applyDeleteElement(id) {
    elements   = elements.filter(e => e.id !== id);
    connectors = connectors.filter(c => c.fromId !== id && c.toId !== id);
    if (selected === id) selected = null;
    render();
  }

  function applyUpdateElement(id, props) {
    const el = elements.find(e => e.id === id);
    if (!el) return;
    if (props.color !== undefined) el.color = props.color;
    if (props.text  !== undefined) el.text  = props.text;
    if (props.w     !== undefined) el.w     = props.w;
    if (props.h     !== undefined) el.h     = props.h;
    render();
  }

  function applyAddStroke(stroke) {
    strokes = strokes.filter(s => s.id !== stroke.id);
    strokes.push(stroke);
    render();
  }

  function applyClearStrokes() {
    strokes = [];
    render();
  }

  function applyConnectors(conns) {
    connectors = JSON.parse(JSON.stringify(conns));
    render();
  }

  return {init,setTool,setColor,setSize,setStickyColor,clear,undo,redo,zoomIn,zoomOut,zoomReset,exportPNG,addSticky,addFileCard,render,getState,applyRemoteState,applyAddElement,applyMoveElement,applyDeleteElement,applyUpdateElement,applyAddStroke,applyClearStrokes,applyConnectors};
})();
