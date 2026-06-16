/* code.js — VS Code Monaco editor for code files */

const CodeViewer = (() => {
  let editor    = null;
  let monacoOk  = false;

  async function load(entry, el) {
    Logger.info('Code', `Loading: ${entry.name}  lang=${entry.lang}`);

    el.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;background:#1e1e1e">
  <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:#252526;border-bottom:1px solid #1e1e1e;flex-shrink:0">
    <span style="font-size:11px;color:#858585;font-family:var(--mono)">${entry.name}</span>
    <span style="font-size:10px;color:#555;margin-left:4px">${entry.lang || 'plaintext'}</span>
    <div style="margin-left:auto;display:flex;gap:6px">
      <button id="code-copy-btn" style="font-size:11px;padding:3px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#ccc;cursor:pointer">Copy</button>
      <button id="code-dl-btn"   style="font-size:11px;padding:3px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#ccc;cursor:pointer">Download</button>
      <select id="code-lang-sel" style="font-size:11px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#ccc;padding:2px 5px">
        ${['plaintext','javascript','typescript','python','java','c','cpp','csharp','go','rust','ruby','php','html','css','json','yaml','xml','markdown','sql','shell'].map(l=>`<option value="${l}" ${l===entry.lang?'selected':''}>${l}</option>`).join('')}
      </select>
      <label style="font-size:11px;color:#858585;cursor:pointer;display:flex;align-items:center;gap:4px">
        <input type="checkbox" id="code-minimap-cb" checked> Minimap
      </label>
    </div>
  </div>
  <div id="monaco-mount" style="flex:1;min-height:0;overflow:hidden"></div>
  <div id="code-output" style="height:140px;background:#1e1e1e;border-top:1px solid #333;display:none;flex-direction:column">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:#252526;border-bottom:1px solid #333;font-size:11px;color:#858585">
      <span>Output</span>
      <button id="code-clear-output" style="font-size:10px;color:#666;cursor:pointer;background:none;border:none">Clear</button>
    </div>
    <div id="code-output-content" style="flex:1;overflow-y:auto;padding:8px 12px;font-family:var(--mono);font-size:12px;color:#ccc;line-height:1.5"></div>
  </div>
</div>`;

    // Fetch code content
    let code = '';
    try {
      const res = await fetch(entry.url);
      code = await res.text();
    } catch(e) {
      Logger.error('Code', `Fetch failed: ${e.message}`);
      code = `// Error loading file: ${e.message}`;
    }

    // Try Monaco
    try {
      await _initMonaco(el, code, entry.lang || 'plaintext');
    } catch(e) {
      Logger.warn('Code', `Monaco failed: ${e.message} — using fallback`);
      _fallback(el, code, entry);
    }

    // Toolbar bindings
    el.querySelector('#code-copy-btn').onclick = () => {
      const val = _getCode();
      navigator.clipboard.writeText(val).then(() => toast('✅ Copied!')).catch(() => toast('❌ Copy failed', 'error'));
    };
    el.querySelector('#code-dl-btn').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([_getCode()], { type: 'text/plain' }));
      a.download = entry.name; a.click();
    };
    el.querySelector('#code-lang-sel').addEventListener('change', e => {
      if (editor && monacoOk) monaco.editor.setModelLanguage(editor.getModel(), e.target.value);
    });
    el.querySelector('#code-minimap-cb').addEventListener('change', e => {
      if (editor && monacoOk) editor.updateOptions({ minimap: { enabled: e.target.checked } });
    });
    el.querySelector('#code-clear-output')?.addEventListener('click', () => {
      el.querySelector('#code-output-content').innerHTML = '';
    });
  }

  function _initMonaco(el, code, lang) {
    return new Promise((resolve, reject) => {
      if (typeof require === 'undefined') { reject(new Error('require not available')); return; }
      try {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], () => {
          monacoOk = true;
          editor = monaco.editor.create(el.querySelector('#monaco-mount'), {
            value:      code,
            language:   lang,
            theme:      'vs-dark',
            fontSize:   13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontLigatures:      true,
            lineNumbers:        'on',
            minimap:            { enabled: true },
            wordWrap:           'off',
            scrollBeyondLastLine: false,
            automaticLayout:    true,
            tabSize:            2,
            bracketPairColorization: { enabled: true },
            guides:             { bracketPairs: true },
            smoothScrolling:    true,
            cursorBlinking:     'smooth',
            renderWhitespace:   'selection',
            padding:            { top: 12, bottom: 12 },
          });
          Logger.info('Code', `Monaco initialized  lang=${lang}`);
          resolve();
        });
      } catch(e) { reject(e); }
    });
  }

  function _fallback(el, code, entry) {
    const mount = el.querySelector('#monaco-mount');
    mount.innerHTML = `
      <textarea style="width:100%;height:100%;background:#1e1e1e;color:#d4d4d4;border:none;outline:none;resize:none;padding:12px 16px;font-family:var(--mono);font-size:13px;line-height:1.6;tab-size:2" spellcheck="false">${_esc(code)}</textarea>`;
  }

  function _getCode() {
    if (editor && monacoOk) return editor.getValue();
    const ta = document.querySelector('#monaco-mount textarea');
    return ta ? ta.value : '';
  }

  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { load };
})();
