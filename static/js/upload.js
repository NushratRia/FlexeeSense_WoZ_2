/* upload.js — Upload handling: drag-drop, browse, server POST */

function triggerUpload() {
  document.getElementById('file-input').click();
}

function handleFileInput(input) {
  Array.from(input.files).forEach(uploadFile);
  input.value = '';
}

async function uploadFile(file) {
  Logger.info('Upload', `Uploading: ${file.name}  size=${(file.size/1024).toFixed(1)}KB`);
  toast(`⬆ Uploading ${file.name}…`);

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res  = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) { toast(`❌ ${data.error}`, 'error'); return; }

    Logger.info('Upload', `Done: ${data.name}  type=${data.type}  id=${data.id}`);
    toast(`✅ ${data.name} loaded`);

    const entry = {
      id:   data.id,
      name: data.name,
      type: data.type,
      lang: data.lang,
      ext:  data.ext,
      url:  data.url,
      fname: data.fname,
      size: data.size,
    };

    Tabs.add(entry);

    // Share with collaborators
    if (typeof collabShareFile === 'function') collabShareFile(entry);

  } catch (err) {
    Logger.error('Upload', `Failed: ${err.message}`);
    toast(`❌ Upload failed: ${err.message}`, 'error');
  }
}

// Drag and drop on upload zone
function dzOver(e) { e.preventDefault(); document.getElementById('upload-zone').classList.add('over'); }
function dzLeave(e) { document.getElementById('upload-zone').classList.remove('over'); }
function dzDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('over');
  Array.from(e.dataTransfer.files).forEach(uploadFile);
}

// Also allow dropping anywhere on the app
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    Array.from(e.dataTransfer.files).forEach(uploadFile);
  }
});
