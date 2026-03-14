# Indoor Wayfinding App

A mobile-friendly, browser-based indoor wayfinding system built on a **25×25 multi-floor grid**.
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
├── index.html              ← entry point (v=22)
├── serve_https.py          ← local HTTPS server (port 3001)
├── css/
│   └── app.css             ← all styles, mobile-first
├── js/
│   ├── app.js              ← state machine, UI, floor switching, prompts
│   ├── nav.js              ← PDR, compass EMA, QR scan/generate
│   ├── renderer.js         ← canvas: grid, path, trail, ghost previews
│   ├── data.js             ← node graph, stamps, presets, localStorage
│   ├── dijkstra.js         ← shortest-path (MinHeap Dijkstra)
│   ├── compass.js          ← Compass class (DeviceOrientation wrapper)
│   └── lib/
│       ├── jsQR.js         ← QR code decoder (bundled, no CDN)
│       └── qrcode.min.js   ← QR code generator (bundled, no CDN)
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
| Catalogue | Log named stamp placements with jump-to navigation |
| Select mode | Drag to select a region; rotate CW/CCW, move, or delete |
| Multi-floor | Up to 10 independent floor layouts; floor watermark on canvas |
| Persistence | Auto-saved to `localStorage`; optional server sync |

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
| PDR | Zero-crossing step detection; EMA compass ($\alpha=0.4$); phone-position invariant |
| QR anchors | Scan a printed QR to snap position to any cell and floor |
| Drift indicator | Green → amber → red chip showing steps since last QR fix |
| Breadcrumb trail | Last 10 positions shown on canvas, fading with age |
| Arrow keys | Manual fallback (desktop / accessibility) |

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
