"""
app.py — Document Studio
Flask + SocketIO server.

Routes:
  GET  /                    → main UI
  POST /upload              → save file, return metadata
  GET  /file/<fname>        → serve uploaded file
  GET  /log                 → view app.log as plain text
  POST /reset               → clear uploads + room state

app.log resets on every server start.
uploads/ clears on every server start.

Run:
  pip install flask flask-socketio pypdf
  python app.py
  → http://localhost:5050
"""

import os, uuid, re, shutil, json, logging
from logging.handlers import RotatingFileHandler
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, join_room, leave_room, emit

# ── Paths ──────────────────────────────────────────────────────────────────
BASE     = os.path.dirname(__file__)
LOG_FILE = os.path.join(BASE, 'app.log')
UPLOADS  = os.path.join(BASE, 'uploads')

# ── Reset log on every start (session boundary) ────────────────────────────
with open(LOG_FILE, 'w', encoding='utf-8') as _f:
    _f.write('=== Document Studio Session Log — server started ===\n')

# ── Logging setup ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s  %(levelname)-8s  %(message)s',
    datefmt='%H:%M:%S',
    handlers=[
        RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=2, encoding='utf-8'),
        logging.StreamHandler(),
    ]
)
log = logging.getLogger('flexeesense')
for _q in ('werkzeug', 'socketio', 'engineio'):
    logging.getLogger(_q).setLevel(logging.WARNING)

log.info('Document Studio starting — log reset, uploads cleared')

# ── Clear uploads on every start ───────────────────────────────────────────
if os.path.exists(UPLOADS):
    shutil.rmtree(UPLOADS)
os.makedirs(UPLOADS)

# ── Flask ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config['SECRET_KEY']         = 'flexeesense-p3-2025'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024   # 500 MB

socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

# ── File type detection ────────────────────────────────────────────────────
CODE_EXTS = {
    '.py','.js','.ts','.jsx','.tsx','.go','.rs','.java','.c','.cpp','.cs',
    '.rb','.php','.swift','.kt','.scala','.r','.sh','.bash','.sql','.html',
    '.css','.scss','.json','.yaml','.yml','.xml','.md','.txt','.ipynb',
    '.lua','.dart','.vue','.svelte','.toml','.ini','.env','.gitignore',
}
VIDEO_EXTS = {'.mp4','.mov','.webm','.ogg','.m4v','.mkv','.avi','.flv'}
IMG_EXTS   = {'.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg','.ico','.tiff','.tif','.heic','.heif','.avif','.jfif'}

LANG_MAP = {
    '.py':'python','.js':'javascript','.ts':'typescript',
    '.jsx':'javascript','.tsx':'typescript','.go':'go','.rs':'rust',
    '.java':'java','.c':'c','.cpp':'cpp','.cs':'csharp','.rb':'ruby',
    '.php':'php','.swift':'swift','.kt':'kotlin','.scala':'scala',
    '.r':'r','.sh':'shell','.bash':'shell','.sql':'sql',
    '.html':'html','.css':'css','.scss':'scss','.json':'json',
    '.yaml':'yaml','.yml':'yaml','.xml':'xml','.md':'markdown',
    '.lua':'lua','.dart':'dart','.vue':'html','.toml':'ini',
}

DOC_EXTS = {'.docx','.doc','.pptx','.ppt','.xlsx','.xls','.odt','.rtf','.pages','.numbers','.key'}
AUDIO_EXTS = {'.mp3','.wav','.aac','.flac','.ogg','.m4a','.wma','.aiff'}

def detect(filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext == '.pdf':              return 'pdf',      ext, None
    if ext in VIDEO_EXTS:         return 'video',    ext, None
    if ext in IMG_EXTS:           return 'image',    ext, None
    if ext in AUDIO_EXTS:         return 'video',    ext, None  # use video player for audio
    if ext in DOC_EXTS:           return 'document', ext, None
    if ext in CODE_EXTS:          return 'code',     ext, LANG_MAP.get(ext, 'plaintext')
    return 'unknown', ext, None

# ── HTTP routes ────────────────────────────────────────────────────────────
@app.route('/')
def index():
    log.info(f'GET /  ip={request.remote_addr}')
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    f = request.files.get('file')
    if not f or not f.filename:
        log.warning('Upload rejected — no file')
        return jsonify({'error': 'No file'}), 400

    ftype, ext, lang = detect(f.filename)
    uid   = str(uuid.uuid4())
    fname = uid + ext
    dest  = os.path.join(UPLOADS, fname)
    f.save(dest)
    size  = os.path.getsize(dest)
    log.info(f'UPLOAD  "{f.filename}"  type={ftype}  lang={lang}  {size//1024}KB  id={uid}')

    return jsonify({
        'id': uid, 'name': f.filename, 'type': ftype,
        'lang': lang, 'ext': ext,
        'url': f'/file/{fname}', 'fname': fname, 'size': size,
    })

@app.route('/file/<fname>')
def serve(fname):
    log.debug(f'SERVE  {fname}')
    return send_from_directory(UPLOADS, fname)

@app.route('/log')
def view_log():
    try:
        with open(LOG_FILE, encoding='utf-8') as f:
            return f.read(), 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except Exception as e:
        return str(e), 500

@app.route('/reset', methods=['POST'])
def reset():
    try:
        shutil.rmtree(UPLOADS); os.makedirs(UPLOADS)
        _rooms.clear(); _peers.clear()
        with open(LOG_FILE, 'w') as f:
            f.write('=== Session reset ===\n')
        log.info('Session reset')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/collab/debug')
def debug():
    return jsonify({
        r: {'peers': len(_peers.get(r,{})), 'files': len(s.get('files',{}))}
        for r, s in _rooms.items()
    })

# ── SocketIO collaboration ─────────────────────────────────────────────────
_rooms = {}   # room → { files: {}, chat: [] }
_peers = {}   # room → { sid → { name, color } }

def _room(r):
    _rooms.setdefault(r, {'files': {}, 'chat': []})
    _peers.setdefault(r, {})
    return _rooms[r], _peers[r]

COLORS = ['#2563EB','#D97706','#7C3AED','#1A8F6F','#E05A3A','#0891B2','#be185d']

@socketio.on('join')
def on_join(data):
    r     = data.get('room', 'main')
    name  = data.get('name', 'Peer')
    state, peers = _room(r)
    used  = [p['color'] for p in peers.values()]
    color = next((c for c in COLORS if c not in used), COLORS[0])
    join_room(r)
    peers[request.sid] = {'name': name, 'color': color, 'sid': request.sid}
    # Send snapshot to the joining peer (all other peers + chat history)
    other_peers = [p for s, p in peers.items() if s != request.sid]
    emit('snapshot', {'state': state, 'peers': other_peers})
    # Broadcast join to everyone else
    emit('peer_joined', {'sid': request.sid, 'name': name, 'color': color}, to=r, skip_sid=request.sid)
    log.info(f'JOIN  sid={request.sid}  name="{name}"  room="{r}"  peers={len(peers)}')

@socketio.on('disconnect')
def on_disc():
    for r, peers in _peers.items():
        if request.sid in peers:
            peer = peers.pop(request.sid)
            emit('peer_left', {'sid': request.sid, 'name': peer['name']}, to=r)
            log.info(f'DISC  sid={request.sid}  name="{peer["name"]}"  room="{r}"')
            break

@socketio.on('file_open')
def on_file_open(data):
    r = data.get('room', 'main')
    state, _ = _room(r)
    state['files'][data['id']] = data
    emit('file_open', data, to=r, skip_sid=request.sid)
    log.info(f'FILE_OPEN  room="{r}"  name="{data.get("name")}"')

@socketio.on('chat')
def on_chat(data):
    r = data.get('room', 'main')
    state, peers = _room(r)
    msg = {**data, 'name': peers.get(request.sid, {}).get('name', 'Peer')}
    state['chat'].append(msg)
    emit('chat', msg, to=r)

@socketio.on('cursor')
def on_cursor(data):
    r = data.get('room', 'main')
    emit('cursor', {**data, 'sid': request.sid}, to=r, skip_sid=request.sid)

@socketio.on_error_default
def on_err(e):
    log.error(f'SOCKET_ERR  {e}', exc_info=True)

@app.errorhandler(Exception)
def on_http_err(e):
    log.error(f'HTTP_ERR  {request.path}  {e}', exc_info=True)
    return jsonify({'error': str(e)}), 500

# ── Start ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    log.info(f'→  http://localhost:{port}')
    log.info(f'→  Log: http://localhost:{port}/log')
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
