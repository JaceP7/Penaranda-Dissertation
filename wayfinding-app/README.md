# Indoor Wayfinding App

A mobile-friendly, browser-based indoor wayfinding system built on a **75×75 multi-floor grid**.
Features real-time Pedestrian Dead Reckoning (PDR), QR-code anchor localisation, Dijkstra shortest-path routing, and a full map editor — no frameworks, no native app install required.

---

## How to Run

> **HTTPS is required** for PDR and QR scanning (DeviceMotion / Camera APIs are blocked on plain HTTP).
> Use the included HTTPS server below — not `python -m http.server`.

```bash
cd "C:\Users\Jace\Desktop\College Files\diko\dissertation"
python wayfinding-app/serve_https.py
```

Then open in your browser (desktop or mobile):

```
https://localhost:3001
```

Accept the self-signed certificate warning on first load
(`Advanced → Proceed to localhost`).

> **Requirements:** Python 3.7+. Check with `python --version`.

---

## Project Structure

```
wayfinding-app/
├── index.html              ← entry point (v=29)
├── serve_https.py          ← local HTTPS server (port 3001)
├── css/
│   └── app.css             ← all styles, mobile-first
├── js/
│   ├── app.js              ← state machine, UI, floor switching, capture mode
│   ├── nav.js              ← PDR, compass EMA, QR scan/generate
│   ├── renderer.js         ← canvas: grid, path, trail, capture pins
│   ├── data.js             ← node graph, stamps, presets, localStorage
│   ├── floor_presets.js    ← bundled 75×75 layouts for all 4 floors (auto-load)
│   ├── dijkstra.js         ← shortest-path (MinHeap Dijkstra)
│   ├── compass.js          ← Compass class (DeviceOrientation wrapper)
│   ├── chat.js             ← RAG chat widget
│   └── lib/
│       ├── jsQR.js         ← QR code decoder (bundled, no CDN)
│       └── qrcode.min.js   ← QR code generator (bundled, no CDN)
├── data/
│   ├── departments.json    ← 21 offices with grid coordinates
│   └── services.json       ← service catalogue (RAG corpus)
├── admin.html              ← analytics dashboard
└── wifi_survey/
    └── survey.py           ← Wi-Fi RSSI survey script (fieldwork utility)
```

---

## Features

### Map Editor
| Feature | Description |
|---|---|
| Cell types | Paint cells as **Wall**, **Door**, **Stair**, or **Open** |
| Brush tool | Click or drag to paint; same-type click erases |
| Undo / Redo | 50-step history — `Ctrl+Z` / `Ctrl+Y` |
| Stamp tool | Design reusable n×n patterns; open cells are transparent on stamp |
| Presets | Save and reload named stamp patterns |
| Catalogue | Log named stamp placements with jump-to navigation. Labels render **on the grid** as dark pills (per-floor filtered). Each entry has a **Copy** button → loads pattern + name into the editor for paste-elsewhere. |
| Select mode | Drag to select a region; rotate CW/CCW, move, or delete |
| Multi-floor | Up to 10 independent floor layouts; floor watermark on canvas; **Duplicate Floor** button to clone the active floor's layout to another |
| Persistence | Auto-saved to `localStorage`; optional server sync (laptop dev only) |
| Floor publishing | **Export Floors** (downloads new `floor_presets.js`) or **Deploy Floors** (one-click git push from laptop). Both bake-and-push to Vercel so every visitor sees the new layout on next reload via `FLOOR_PRESETS_VERSION` cache-bust. |

### Pathfinding
| Feature | Description |
|---|---|
| Algorithm | Dijkstra on a 4-connected adjacency graph |
| Display | Coloured path cells, directional arrows, step numbers |
| Info bar | Step count + estimated distance in metres |
| Calibration | `NAV.metresPerCell = distance_m / cells_counted` (browser console) |

### Navigation Mode
| Feature | Description |
|---|---|
| PDR | Zero-crossing step detection (Jiménez et al., 2010); phone-position invariant |
| Heading | **Adaptive EMA compass** — $\alpha$ varies 0.05 (stationary, kills wobble) to 0.80 (active turn, kills lag) (Shi et al., 2025) |
| Heading anchor | Forward direction auto-locked to the phone's facing direction at PDR start. 🧭 **Align** button re-anchors any time. Robust to indoor magnetic interference (Ye et al., 2026) |
| QR anchors | Scan a printed QR to snap position to any cell and floor |
| Drift indicator | Green → amber → red chip showing steps since last QR fix |
| Breadcrumb trail | Last 10 positions shown on canvas, fading with age |
| Arrow keys | Manual fallback (desktop / accessibility) |

### Capture Mode (fieldwork)
| Feature | Description |
|---|---|
| Tap-to-capture | Tap a cell on the grid → records `{office, floor, row, col}` in localStorage |
| 📍 My position | Capture at the current PDR position |
| 📌 Set Position | Mobile-friendly teleport — taps move the cursor instead of capturing (laptop equivalent is Shift+click) |
| WASD walking | Laptop simulation — keys move the cursor one cell per press (Capture-Mode-gated) |
| Export | Download captured coordinates as a JSON file |
| Custom offices | "➕ Add new office" prompt in the dropdown lets fieldwork add labels not in the canonical 31-office list |

### Walk Recorder (PDR diagnostics)
| Feature | Description |
|---|---|
| 🔴 Rec / ⏹ Stop | Toggle recording. Samples `{t, row, col, heading, alpha}` at 5 Hz to localStorage. Auto-starts PDR if it isn't running |
| 📥 Walks | Download all recorded walks as a single JSON file for offline analysis (motivated the F2 sensor fusion roadmap with concrete data) |

### Stair & Arrival
| Feature | Description |
|---|---|
| Stair detection | Lands on stair cell → checks adjacent floors for matching stair |
| Single direction | Prompt: *"Climbed to Floor N? Yes / Not yet"* — confirms before switching |
| Both directions | Direction prompt: *Up / Down / Not yet* |
| Auto-dismiss | All stair prompts dismiss after 8 seconds |
| Arrival | *"You have arrived!"* banner on reaching destination; auto-dismisses after 4 s |

### QR Code Generator
| Feature | Description |
|---|---|
| Generate | Pick floor (1-indexed), row, col → QR preview generated |
| Download | Save as PNG ready to print and place in the building |
| Format | Payload: `GRID:<floor>:<row>,<col>` (0-indexed internally) |

---

## Using the App

| Action | How |
|---|---|
| Set destination | Tap any open cell — shortest path computed instantly |
| Paint walls | Enable **Wall Mode**, choose type (Wall / Door / Stair / Erase), tap or drag |
| Stamp a pattern | Open **Stamp / Places**, design in the editor, click the grid to place |
| Select a region | Enable **Select Mode**, drag to highlight, use toolbar to rotate / move / delete |
| Change floor | Use **▲ / ▼** floor controls in the header |
| Navigate (live) | Enable **Nav Mode** → start PDR or scan a QR anchor |
| Generate QR | Nav Mode → **Gen QR** → set location → download PNG |
| Pan | Click-drag (mouse) or one-finger drag (touch) |
| Zoom | Scroll wheel or pinch two fingers |

---

## Calibration (fieldwork)

Measure a real corridor in metres, count the cells it spans, then run in the browser console:

```javascript
NAV.metresPerCell = <distance_m> / <cells_counted>
```

This updates the distance estimate in the info bar immediately.

---

## Browser Support

| Browser | Routing | PDR | QR Scan | Pan / Zoom |
|---|---|---|---|---|
| Chrome Android | ✅ | ✅ | ✅ | ✅ |
| Safari iOS 13+ | ✅ | ✅ | ✅ | ✅ |
| Chrome Desktop | ✅ | ⚠️ no motion sensor | ✅ (if webcam) | ✅ |
| Firefox | ✅ | ⚠️ | ✅ | ✅ |
| Edge | ✅ | ⚠️ | ✅ | ✅ |

> PDR requires a physical accelerometer and compass — desktop browsers will not detect steps.

---

## Related Files

```
dissertation/
├── wayfinding-app/          ← this app (source)
├── wayfinding-report.tex    ← dissertation technical report (Overleaf / pdflatex)
└── wayfinding-sysdesign/    ← system design LaTeX document
```

---

## What is excluded from git

The following are listed in `.gitignore` at the repo root and will **not** be committed:

| Excluded | Reason |
|---|---|
| `*.pem`, `*.key`, `*.crt` | SSL certificates / private keys — never commit these |
| `mkcert.exe` | Windows binary tool — download separately from [mkcert.dev](https://github.com/FiloSottile/mkcert) |
| `app-state.json` | Runtime server state — generated automatically on first run |
| `*.pdf` | Binary blobs (dissertation drafts, compiled reports) |
| `*.aux`, `*.log`, `*.toc` … | LaTeX build artefacts |
| `.claude/` | Claude Code session files |

---

## Generating a fresh HTTPS certificate

If `cert.pem` / `key.pem` are missing (first clone on a new machine):

```bash
# Install mkcert (Windows — download from https://github.com/FiloSottile/mkcert/releases)
mkcert -install
mkcert localhost 127.0.0.1 ::1
# Rename the generated files:
#   localhost+2.pem     → cert.pem
#   localhost+2-key.pem → key.pem
```
