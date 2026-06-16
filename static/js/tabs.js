/* tabs.js — Multi-document tab management */

const Tabs = (() => {
  const tabs    = [];   // [{ id, name, type, lang, url, meta }]
  let   activeId = null;
  const TYPE_ICON = { pdf:'📑', video:'🎬', code:'💻', text:'📝', image:'🖼', unknown:'📄' };

  function add(entry) {
    // Don't duplicate same file id
    if (tabs.find(t => t.id === entry.id)) { activate(entry.id); return; }
    tabs.push(entry);
    Logger.info('Tabs', `Added: ${entry.name}  type=${entry.type}`, { id: entry.id });
    render();
    activate(entry.id);
    showApp();
  }

  function remove(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    tabs.splice(idx, 1);
    Logger.info('Tabs', `Removed tab id=${id}  remaining=${tabs.length}`);
    if (tabs.length === 0) {
      activeId = null;
      clearViewer();
      showUpload();
    } else {
      const next = tabs[Math.min(idx, tabs.length - 1)];
      activate(next.id);
    }
    render();
  }

  function activate(id) {
    activeId = id;
    render();
    const entry = tabs.find(t => t.id === id);
    if (entry) {
      Logger.info('Tabs', `Activating: ${entry.name}  type=${entry.type}`);
      renderViewer(entry);
      // Refresh draw canvas so it covers new content dimensions
      if (typeof Draw !== 'undefined') Draw.refresh();
    }
  }

  function render() {
    const bar = document.getElementById('tab-bar');
    if (!bar) return;
    bar.innerHTML = '';
    tabs.forEach(t => {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === activeId ? ' active' : '');
      el.title = t.name;
      el.innerHTML = `
        <span class="tab-icon">${TYPE_ICON[t.type] || '📄'}</span>
        <span class="tab-name">${esc(t.name)}</span>
        <button class="tab-close" title="Close">✕</button>`;
      el.addEventListener('click', e => { if (!e.target.classList.contains('tab-close')) activate(t.id); });
      el.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); remove(t.id); });
      bar.appendChild(el);
    });
  }

  function getActive() { return tabs.find(t => t.id === activeId) || null; }
  function getAll()    { return [...tabs]; }

  return { add, remove, activate, getActive, getAll };
})();

function showApp() {
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

function showUpload() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('upload-screen').style.display = 'flex';
}

function clearViewer() {
  document.getElementById('viewer-content').innerHTML = '';
}

function renderViewer(entry) {
  const vc = document.getElementById('viewer-content');
  vc.innerHTML = '';
  Logger.debug('Viewer', `Rendering ${entry.type}: ${entry.name}`);

  switch (entry.type) {
    case 'pdf':     PDFViewer.load(entry, vc);    break;
    case 'video':   VideoViewer.load(entry, vc);  break;
    case 'code':    CodeViewer.load(entry, vc);   break;
    case 'text':    TextViewer.load(entry, vc);   break;
    case 'image':   ImageViewer.load(entry, vc);  break;
    case 'document':
    case 'unknown':
      // Show a download/info card for unsupported preview types
      vc.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:32px;text-align:center">
          <div style="font-size:48px">${_fileIcon(entry.ext)}</div>
          <div style="font-size:16px;font-weight:600;color:var(--text)">${esc(entry.name)}</div>
          <div style="font-size:12px;color:var(--text-2)">${entry.ext.toUpperCase()} file${entry.size ? ' · ' + (entry.size/1024).toFixed(1) + ' KB' : ''}</div>
          <a href="${entry.url}" download="${esc(entry.name)}"
             style="padding:10px 24px;background:var(--accent);color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;margin-top:8px">
            ⬇ Download file
          </a>
          <p style="font-size:11px;color:var(--text-3);max-width:300px">Preview not available for this file type. You can download it to open locally.</p>
        </div>`;
      break;
    default:
      vc.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-2);font-size:14px;">Cannot preview this file type</div>`;
  }
}

function _fileIcon(ext) {
  const icons = {
    '.jpg':'🖼','.jpeg':'🖼','.png':'🖼','.gif':'🖼','.bmp':'🖼','.webp':'🖼','.svg':'🖼','.heic':'🖼',
    '.mp3':'🎵','.wav':'🎵','.aac':'🎵','.flac':'🎵','.m4a':'🎵',
    '.docx':'📝','.doc':'📝','.rtf':'📝','.odt':'📝','.pages':'📝',
    '.pptx':'📊','.ppt':'📊','.key':'📊',
    '.xlsx':'📈','.xls':'📈','.numbers':'📈',
    '.zip':'🗜','.rar':'🗜','.7z':'🗜',
  };
  return icons[ext?.toLowerCase()] || '📄';
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
