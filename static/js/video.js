/* video.js — Full-featured HTML5 video player */

const VideoViewer = (() => {
  function load(entry, el) {
    Logger.info('Video', `Loading: ${entry.name}`);
    const url = entry.url;
    el.innerHTML = `
<div class="video-viewer">
  <video id="vid-el" src="${url}" preload="metadata"
         style="width:100%;flex:1;min-height:0;object-fit:contain;background:#000;display:block"></video>
  <div class="video-controls-bar">
    <input type="range" id="vid-progress" value="0" min="0" step="0.01"
           style="width:100%;height:4px;accent-color:#7c6ef5;margin-bottom:6px;display:block">
    <div style="display:flex;align-items:center;gap:8px">
      <button class="vid-btn" id="vid-skip-b" title="Back 10s">⏮</button>
      <button class="vid-btn big" id="vid-play" title="Play/Pause">▶</button>
      <button class="vid-btn" id="vid-skip-f" title="Forward 10s">⏭</button>
      <span id="vid-time" style="font-size:12px;color:#ccc;font-family:var(--mono)">0:00 / 0:00</span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
        <button class="vid-btn" id="vid-mute" title="Mute">🔊</button>
        <input type="range" id="vid-vol" min="0" max="1" step="0.05" value="1"
               style="width:68px;accent-color:#7c6ef5">
        <select id="vid-speed" style="background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:#ccc;font-size:11px;padding:2px 5px">
          <option value="0.25">0.25×</option><option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option><option value="1" selected>1×</option>
          <option value="1.25">1.25×</option><option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
        <button class="vid-btn" id="vid-fs" title="Fullscreen">⛶</button>
      </div>
    </div>
  </div>
  <div class="video-filename">${entry.name}</div>
</div>
<style>
  .video-controls-bar{width:100%;padding:10px 14px 8px;background:#111;flex-shrink:0}
  .vid-btn{background:none;border:none;color:#ccc;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;line-height:1}
  .vid-btn.big{font-size:22px}
  .vid-btn:hover{background:rgba(255,255,255,0.1)}
</style>`;

    const vid   = el.querySelector('#vid-el');
    const prog  = el.querySelector('#vid-progress');
    const time  = el.querySelector('#vid-time');
    const play  = el.querySelector('#vid-play');
    const fmt   = s => { const m=Math.floor(s/60),se=Math.floor(s%60); return `${m}:${se<10?'0':''}${se}`; };

    vid.addEventListener('loadedmetadata', () => { prog.max = vid.duration; time.textContent = `0:00 / ${fmt(vid.duration)}`; });
    vid.addEventListener('timeupdate', () => { prog.value = vid.currentTime; time.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration||0)}`; });
    vid.addEventListener('ended', () => { play.textContent = '▶'; });

    play.onclick = () => { vid.paused ? vid.play() : vid.pause(); play.textContent = vid.paused ? '▶' : '⏸'; };
    el.querySelector('#vid-skip-b').onclick = () => { vid.currentTime = Math.max(0, vid.currentTime - 10); };
    el.querySelector('#vid-skip-f').onclick = () => { vid.currentTime = Math.min(vid.duration, vid.currentTime + 10); };
    prog.addEventListener('input', () => { vid.currentTime = prog.value; });
    el.querySelector('#vid-vol').addEventListener('input', e => { vid.volume = e.target.value; });
    el.querySelector('#vid-mute').onclick = () => { vid.muted = !vid.muted; el.querySelector('#vid-mute').textContent = vid.muted ? '🔇' : '🔊'; };
    el.querySelector('#vid-speed').addEventListener('change', e => { vid.playbackRate = parseFloat(e.target.value); });
    el.querySelector('#vid-fs').onclick = () => {
      el.querySelector('.video-viewer').requestFullscreen?.()
        .catch(e => Logger.warn('Video', `Fullscreen denied: ${e.message}`));
    };

    // Keyboard shortcuts
    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); play.click(); }
      if (e.key === 'ArrowRight') vid.currentTime += 5;
      if (e.key === 'ArrowLeft')  vid.currentTime -= 5;
      if (e.key === 'm') el.querySelector('#vid-mute').click();
    });
  }

  return { load };
})();

/* text.js — Plain text, Markdown, CSV viewer */

const TextViewer = (() => {
  async function load(entry, el) {
    Logger.info('Text', `Loading: ${entry.name}`);
    try {
      const res  = await fetch(entry.url);
      const text = await res.text();
      const isCSV = entry.ext === '.csv';
      const isMD  = entry.ext === '.md';

      el.innerHTML = `
<div class="text-viewer">
  <div class="text-viewer-toolbar">
    <span>${entry.name}</span>
    <span style="margin-left:auto">${text.split('\n').length} lines · ${(entry.size/1024).toFixed(1)} KB</span>
    <button onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(text)}'))" style="padding:3px 8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#ccc;font-size:11px;cursor:pointer;margin-left:8px">Copy</button>
  </div>
  <div class="text-viewer-body" id="tvb"></div>
</div>`;

      const body = el.querySelector('#tvb');
      if (isCSV) body.innerHTML = _csv(text);
      else if (isMD) body.innerHTML = _md(text);
      else body.innerHTML = _plain(text);

      Logger.info('Text', `Rendered ${text.length} chars`);
    } catch (err) {
      Logger.error('Text', `Load failed: ${err.message}`);
      el.innerHTML = `<div style="padding:32px;color:#e05555">❌ ${err.message}</div>`;
    }
  }

  function _plain(text) {
    return text.split('\n').map((l, i) =>
      `<div class="text-line">
         <span class="text-line-num">${i+1}</span>
         <span class="text-line-content">${_esc(l) || '\u00a0'}</span>
       </div>`
    ).join('');
  }

  function _md(text) {
    const html = _esc(text)
      .replace(/^# (.+)$/gm, '<h1 style="color:#569cd6;font-size:18px;margin:16px 0 8px">$1</h1>')
      .replace(/^## (.+)$/gm,'<h2 style="color:#4ec9b0;font-size:15px;margin:14px 0 6px">$1</h2>')
      .replace(/^### (.+)$/gm,'<h3 style="color:#ce9178;font-size:13px;margin:12px 0 4px">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g,'<strong style="color:#e8e8f2">$1</strong>')
      .replace(/\*(.+?)\*/g,'<em style="color:#ccc">$1</em>')
      .replace(/`([^`]+)`/g,'<code style="background:#0d0d0f;color:#ce9178;padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:12px">$1</code>')
      .replace(/^- (.+)$/gm,'<li style="color:#d4d4d4;margin:2px 0;padding-left:12px">$1</li>')
      .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
    return `<div style="padding:24px;max-width:720px;font-size:14px;color:#c8c8c8;line-height:1.7"><p>${html}</p></div>`;
  }

  function _csv(text) {
    const rows = text.trim().split('\n').map(r => r.split(','));
    const hdr  = rows[0];
    const body = rows.slice(1);
    return `<div style="overflow:auto;height:100%;padding:12px">
      <table style="border-collapse:collapse;font-size:12px;font-family:var(--mono);width:100%">
        <thead><tr style="background:#252526;position:sticky;top:0">
          <th style="padding:6px 8px;border:1px solid #333;color:rgba(255,255,255,.25);width:40px">#</th>
          ${hdr.map(h=>`<th style="padding:6px 10px;border:1px solid #333;color:#7c6ef5;text-align:left;white-space:nowrap">${_esc(h.trim())}</th>`).join('')}
        </tr></thead>
        <tbody>${body.map((r,i)=>`<tr style="background:${i%2?'#1a1a1e':'#141416'}">
          <td style="padding:4px 8px;border:1px solid #222;color:rgba(255,255,255,.2);text-align:center">${i+1}</td>
          ${r.map(c=>`<td style="padding:4px 10px;border:1px solid #222;color:#d4d4d4;white-space:nowrap">${_esc(c.trim())}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  return { load };
})();

/* image.js — Image viewer */

const ImageViewer = (() => {
  function load(entry, el) {
    Logger.info('Image', `Loading: ${entry.name}`);
    el.innerHTML = `
<div class="image-viewer">
  <img src="${entry.url}" alt="${entry.name}" title="${entry.name}">
  <p style="color:var(--text-3);font-size:12px;margin-top:12px">${entry.name}</p>
</div>`;
  }
  return { load };
})();
