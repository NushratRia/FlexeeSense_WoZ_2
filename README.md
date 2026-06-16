# FlexeeSense — Prototype 2 (with Collaboration)

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run
python app.py

# 3. Open browser
open http://localhost:5050
```

## Collaboration

Click **👥 Collaborate** in the top bar:
1. Enter your name
2. Enter a room ID (or click 🎲 to generate one)
3. Click **Join**
4. Share the link with collaborators (🔗 Copy link button)

All canvas changes sync in real-time: cards, stickies, strokes, links.
Live cursors show where each peer is on the canvas.
Built-in chat with typing indicators.

## File Structure

```
flexeesense2/
├── app.py                      ← Flask server + SocketIO (collaboration, upload, logging)
├── requirements.txt
├── app.log                     ← Reset on every server start
├── uploads/                    ← Cleared on every server start (temporary session files)
│
├── templates/
│   └── index.html              ← Main UI template
│
└── static/
    ├── css/
    │   ├── main.css            ← Core layout, toolbar, panels, PDF styles, canvas
    │   ├── collab.css          ← Collaboration panel, live cursors, chat, log panel
    │   └── audio_notes.css     ← Audio notes
    │
    └── js/
        ├── resize.js           ← Panel splitter drag
        ├── upload.js           ← File upload → server, file registry
        ├── pdf_viewer.js       ← High-res PDF (pdf.js): zoom, text select, highlights, comments, links
        ├── viewer.js           ← Video player + notebook viewer + tab switching
        ├── canvas.js           ← Infinite pan/zoom canvas + cards + collaboration hooks
        ├── links.js            ← SVG visual links (PDF ↔ Video ↔ Code ↔ canvas)
        ├── draw.js             ← Full-workspace freehand draw (SVG strokes)
        ├── app.js              ← Toast, session timer, keyboard shortcuts
        ├── audio_notes.js      ← Audio notes
        └── collab.js           ← SocketIO collaboration: rooms, peers, cursors, chat, sync
```

## Supported File Types

| Type     | Extensions                                     |
|----------|------------------------------------------------|
| PDF      | .pdf                                           |
| Video    | .mp4 .mov .webm .ogg .m4v .mkv .avi           |
| Code     | .py .js .ts .jsx .tsx .go .rs .java .c .cpp   |
|          | .cs .rb .php .swift .kt .scala .r .sh .sql    |
|          | .html .css .json .yaml .xml .md .txt .ipynb   |

## Logging

- `app.log` resets on every server start
- View live: click **📋 Log** in the top bar
- Download: click ↓ Download in the log panel
- Direct URL: http://localhost:5050/log
- Debug rooms: http://localhost:5050/collab/debug

## Keyboard Shortcuts

| Key         | Action                |
|-------------|-----------------------|
| Escape      | Cancel pending link   |
| Space+drag  | Pan canvas            |
| Ctrl+scroll | Zoom canvas           |
| Ctrl+`      | Toggle log panel      |
| Ctrl+Shift+C| Toggle collab panel   |
# FlexeeSense_WoZ_2-
