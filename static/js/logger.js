/* logger.js — Session logger. Resets on every page load (session boundary). */

const Logger = (() => {
  const START  = new Date().toISOString();
  const KEY    = 'fs_log';
  const LEVELS = { DEBUG:0, INFO:1, WARN:2, ERROR:3 };
  let   minLvl = 0;

  // Reset on new session
  sessionStorage.removeItem(KEY);
  sessionStorage.setItem(KEY, `=== Document Studio Session — ${START} ===\n`);

  function _write(lvl, mod, msg, data) {
    if (LEVELS[lvl] < minLvl) return;
    const ts   = new Date().toISOString().split('T')[1].slice(0,12);
    const line = `[${ts}] [${lvl.padEnd(5)}] [${mod.padEnd(14)}] ${msg}` +
                 (data !== undefined ? `  ${JSON.stringify(data)}` : '');
    const prev = sessionStorage.getItem(KEY) || '';
    sessionStorage.setItem(KEY, prev + line + '\n');
    const styles = { DEBUG:'color:#555', INFO:'color:#7c9ef5', WARN:'color:#d48a0c;font-weight:bold', ERROR:'color:#e05555;font-weight:bold' };
    console.log(`%c${line}`, styles[lvl] || '');
  }

  return {
    debug: (m, msg, d) => _write('DEBUG', m, msg, d),
    info:  (m, msg, d) => _write('INFO',  m, msg, d),
    warn:  (m, msg, d) => _write('WARN',  m, msg, d),
    error: (m, msg, d) => _write('ERROR', m, msg, d),
    get:   ()          => sessionStorage.getItem(KEY) || '',
    clear: ()          => { sessionStorage.setItem(KEY, `=== Cleared ${new Date().toISOString()} ===\n`); },
    download() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([this.get()], { type: 'text/plain' }));
      a.download = 'app.log'; a.click();
    }
  };
})();

Logger.info('App', 'Document Studio started');
