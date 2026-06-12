# System Context — Geo-Agentic RAG Wayfinding System
### Calamba City Hall · Dissertation Project
**Last updated:** 2026-06-22

---

## 0. SESSION LOG (read this first to resume)

### Session 5 (2026-06-08 to 2026-06-22) — PDR improvements + publishing workflow + floor remap

**PDR heading work** — backed by Scopus-indexed literature (Madgwick 2011 @ 1937 cits; Mahony 2008 @ 1630 cits; Shi 2025 IEEE TIM; Mansour 2026 IEEE TIM; Cheng 2025 @ 18 cits).
- **F0 — Walk recorder.** New 🔴 Rec / 📥 Walks buttons in Capture toolbar. Samples `{t,row,col,heading,alpha}` at 5 Hz into localStorage (`wayfinding-walks-v1`), exportable as JSON. Auto-starts PDR if it isn't running (was a footgun — Rec without PDR produced static recordings).
- **F1 — Adaptive EMA in `compass.js`.** α now varies per sample with |Δheading|: 0.05 stationary (kills wobble), 0.80 during active turns (kills lag), saturates at 20°. Replaces fixed α=0.4 from B1 (kept as fallback). Cite Shi (2025).
- **F3-lite — Heading anchor on PDR start.** Indoor magnetometer reports wrong "North"; instead of trusting it absolutely, `NAV.headingOffset` captures the first compass reading after PDR start, and step direction maps from `(heading − headingOffset)` so walking direction matches user-facing direction. 🧭 Align button re-anchors anytime. Smaller than full F3 (no 8-direction picker), but solved the immediate "I walk but the cursor goes elsewhere" problem on Walk 5.
- **F2 — Gyro + magnetometer fusion** still PLANNED. Walk 5 data confirms the need: 38 s walk, 44 steps, but only 0.09 straightness — magnetometer scrambled the direction even though steps were detected cleanly. F1 helped wobble but not the slow drift + spikes.

**Capture Mode mobile UX**
- WASD walking on laptop (Capture-Mode-gated). Plain click captures; Shift+click teleports `NAV.position`.
- 📌 Set Position toggle button — mobile-friendly equivalent of Shift+click. When ON, taps teleport instead of capture.
- Cosmetic Copy button text label (was a 📋 emoji — wasn't reading consistently across mobile fonts).

**Floor publishing workflow (bake-and-push)** — chosen over Vercel KV for the dissertation's reproducibility requirements.
- `Export Floors` — downloads a complete `floor_presets.js` with auto-bumped `FLOOR_PRESETS_VERSION`. User runs `tools/replace_floor_presets.py` + git push. Works on any device.
- `Deploy Floors` — laptop-only one-click button. POSTs the new content to `/api/deploy-floors` on `serve_https.py`, which writes the file + runs `git add / commit / push`. Confirmation dialog with editable commit message. Hidden on Vercel via the same probe that hides Sync.
- `Duplicate Floor` — copy current floor's walls/doors/stairs to another floor (Ctrl+Z restorable). Useful for reusing the octagonal shell across upper floors.
- `Floors ▾` dropdown — collapses the three publishing buttons into one toolbar item after they were pushing Wall Mode / Stamp & Places off-screen at typical viewport widths.
- `DEPLOY_FLOOR_PLANS.md` — full workflow doc (one-click and manual paths).

**Stamp annotation labels**
- Stamp names render on the grid as small dark pills at the centre of each placement (per active floor only). `STAMP_PLACEMENTS` schema gained a `floor` field; legacy entries migrated to floor 0.
- Catalogue side panel: each placement gets a `Copy` button → loads pattern + name into stamp editor for paste-elsewhere via next grid click. Also a tiny `F0`/`F1`/… badge to show which floor a labelled placement lives on.

**Charter alignment (mid-session)**
- Cross-checked our 21-office canonical list against the official Citizen's Charter (calambacity.gov.ph/Users/Home/CitizenCharter) and the 12-category service listing. Charter has 28 offices; we keep 3 sub-units (OSCA / PDAO / CDRRMD-MO) → new canonical = **31 offices**.
- **98 service rows** in `services.json` had `department` renamed across 6 mappings: 5 spelling differences + 1 typo (`MANAGMENT` → `MANAGEMENT`).
- `departments.json` rebuilt 21 → 31. `OFFICE_FALLBACK` in `app.js` matches.
- FAISS index rebuilt (`python -m rag_engine.build_index`, ~70 s for 235 chunks).
- All 235 services cross-verified: count matches, IDs match, departments match.
- `CHARTER_ALIGNMENT_REPORT.md` captures the diff for dissertation traceability.

**Floor remap (commit `aac8e1f`)**
- User designed the 4 real City Hall floors at UI positions 5/6/7/8 (internal 4–7), with **99 labeled stamps** (22 GF + 25 LG + 22 2F + 30 3F).
- Promoted them to UI 1/2/3/4 via `tools/remap_floors_5to8_to_1to4.py` (one-off script).
- Source floors 5–8 cleared. 5 old Floor-1 stamps dropped (per user's "Replace" choice).
- `FLOOR_PRESETS_VERSION` bumped 6 → 7 → all devices auto-pick-up via cache-bust.
- Backups: `app-state.json.bak_before_remap`, `floor_presets.js.bak_before_remap`.

**Vercel KV cross-device sync** — deferred per user. Stamps + captures stay per-device-localStorage. Bake-and-push covers walls/doors/stairs for everyone.

### Key new files (Session 5)
- `tools/replace_floor_presets.py` — manual install helper for the Export Floors flow
- `DEPLOY_FLOOR_PLANS.md` — bake-and-push workflow guide
- `wayfinding-app/app-state.json` (gitignored) — server-side state from `serve_https.py`

### Session 4 (2026-05-28 PM) — corpus rebuild + chat fixes
- **CORPUS REBUILT from the official Citizen's Charter**: `wayfinding-app/data/services.json` now has **235 services** (was 74), **all with `requirements`** (was 0). Built by `build_corpus_from_charter.py` which: parses `services raw/*.js` (10 category listing files = 235 services) → fetches each `https://calambacity.gov.ph/Users/Home/ViewServicesPage?createservicesId=N` (cached to `services_html/`) → extracts requirements checklist + process flow + who-may-avail. Old 74 corpus backed up to `services.json.bak74`.
- **New enriched schema** per service: `service` (category), `subservice` (name), `department`, `source_id`, `source_url`, `classification`, `type_of_transaction`, `who_may_avail`, `requirements` [{requirement, where_to_secure}], `steps`.
- **LLM backend = Groq** (`llama-3.3-70b-versatile`), `.env` `USE_GROQ=true`. Gemini abandoned (free tier 503s + 10 RPM too unreliable). Groq: ~2-6s warm, reliable. ⚠️ Groq key was pasted in chat — rotate it.
- **Chat fixes (Session 4)**: (A) contextual query rewrite — `query_rewrite(query, history)` resolves follow-ups like "what are those requirements?"; (C) honest no-data message + null department on no-match (no misleading "Take me there"); (D) department extracted from the LLM's "Go to:" line, not chunks[0]; requirements now shown from corpus.
- **Embedding tuned**: `build_index.py build_chunk` embeds CONCISE identity (subservice + department + category + who-may-avail), NOT the full requirements (which diluted precision). Requirements/steps carried in metadata for the LLM. `_format_context` reads them from metadata.
- **Test set v2.0**: `eval/rag_test_set.json` recalibrated — Q13/Q20/Q29 multi-label for the 235-corpus.
- **Metrics**: 74-corpus MRR 0.811/P@1 0.75 → 235 untuned 0.611/0.43 → **235 tuned+recalibrated 0.714/0.607**. Coverage 3.2× + requirements grounding. Latency ~4-6s warm (Groq).
- **serve_https.py bug fixed**: startup banner referenced GROQ_MODEL before definition (crashed on USE_GROQ=true).
- **Committed + (attempted) push** under JCEPenaranda — push needs JaceP7 auth (403). Sensitive files gitignored: real floor plan, tmp_cred.txt, dissertation text, *.pyc.

### Key new files (Session 4)
- `build_corpus_from_charter.py` — the corpus scraper (resumable, caches to services_html/)
- `eval/run_retrieval_metrics.py` — Recall@K/Precision@K/MRR/NDCG (run with `RAG_RERANKER_CPU=1` if server is up, else GPU; stop server to avoid OOM/segfault)
- `services raw/*.js` — 10 Charter listing files (source of the 235 services)
- `CODE_STUDY_GUIDE.md` — file-by-file study guide for defense

### Session 3 (2026-05-28) — current state
- **Cloud LLM added**: `rag_engine/pipeline.py` now routes Stage 1 + 5 to Groq OR Gemini OR Ollama (priority: Groq > Gemini > Ollama). Selected via `.env` flags `USE_GROQ` / `USE_GEMINI`. Embedding/FAISS/reranker still local.
- **Active config**: `.env` has `USE_GEMINI=true`, `gemini-2.5-flash`. (⚠️ Gemini API key was pasted in chat — user advised to rotate it.)
- **75×75 grid**: upgraded from 25×25. `data.js GRID_ROWS/COLS = 75`. Bundled `js/floor_presets.js` auto-loads all 4 floors on first run.
- **Capture Mode** (NEW): fieldwork feature to capture office coordinates. 🎯 button → pick office → tap cell OR use PDR position → pins on map → 💾 Export → `departments.json`. Files: `index.html`, `app.js` (`setCaptureMode`, `captureOfficeAt`, `exportCaptures`, `CAPTURED_POINTS`, `DEPT_CODE`), `renderer.js` (pink pins), `css/app.css`. Persists to localStorage `wayfinding-captures-v1`.
- **Cache version**: now `v=27` across index.html.
- **Bug fixed**: `query_rewrite()` no longer uses the rate-limit error message as the search query (falls back to original).
- **RAG baseline measured**: 70% raw (21/30), ~84% excluding 5 rate-limit casualties. Latency 6.6s mean. Results in `eval/results_20260528_115349.*`.
- **Known finding**: free Gemini tier (10 RPM) too tight for SUS — need paid tier or Groq for 120 respondents.
- **4 corpus gaps found**: real property tax, marriage license, mayor's office, veterinary — all alias/keyword issues in `services.json`.
- **Deployment decision**: Oracle Cloud Always Free chosen (A3). Package in `deploy/`. NOT YET deployed.
- **Fieldwork goal clarified**: establish coordinates via Capture Mode on phone (laptop same-WiFi). No deployment needed for coordinate-gathering.

### Key eval/test tooling
- `eval/rag_test_set.json` — 30 curated Taglish/English queries with expected departments
- `eval/run_rag_test.py` — runner with rate-limit retry + pacing (`--delay`, `--retries`)

### How to run the RAG test
```
python wayfinding-app/serve_https.py   # start server first
cd eval && python run_rag_test.py --delay 15 --retries 2
```

---

## 1. Project Identity

**Full title:** Geo-Agentic RAG: A Framework for Integrated Document Services, Wayfinding, and Administrative Analytics for Local Government Offices

**Location:** Calamba City Hall, Calamba, Laguna, Philippines

**Purpose:** A browser-based system that helps walk-in citizens find the right office, understand what documents to bring, and navigate the building — without needing to install an app or ask a guard.

**Stack:** Pure HTML/CSS/JS frontend + Python HTTPS backend. No frameworks. No native app.

---

## 2. System Modules

### Module 1 — Indoor Wayfinding
- 25×25 multi-floor grid map of the building
- Dijkstra shortest-path routing (4-connected adjacency graph)
- Coloured path with directional arrows and step numbers
- Info bar: step count + estimated distance in metres
- Multi-floor support (up to 10 floors); floor watermark on canvas
- Pan and zoom (mouse scroll / pinch)

### Module 2 — Navigation Mode (PDR + QR)
- Pedestrian Dead Reckoning (PDR): zero-crossing step detection, EMA compass (α=0.4)
- Phone-position invariant — works in hand, pocket, or bag
- QR anchor scanning: scans printed QR codes on walls → snaps position to exact cell
- QR format: `GRID:<floor>:<row>,<col>` (0-indexed internally)
- Drift indicator chip: green → amber → red (steps since last QR fix)
- Breadcrumb trail: last 10 positions on canvas, fading with age
- Stair detection: lands on stair cell → prompts floor confirmation
- Arrival banner: "You have arrived!" auto-dismisses after 4s

### Module 3 — RAG Chat Widget
6-stage pipeline:
1. **Query rewrite** — cleans and normalises the citizen's question
2. **Embedding** — multilingual-e5-large (560M params, ~1.1GB VRAM)
3. **FAISS search** — IndexFlatIP vector similarity on document corpus
4. **Reranking** — bge-reranker-base cross-encoder (~0.5GB VRAM)
5. **LLM answer** — Qwen2.5:3b via Ollama (~2.0GB VRAM, 4-bit quant)
6. **Coordinate resolve** — maps department name in answer → grid coordinates

Supports multilingual input (Filipino, English, Taglish).
History: last 6 messages sent as context window.
Rate-limited responses render as yellow `chat-bubble-busy` (friendly message, not raw error).

### Module 4 — Admin Analytics Dashboard (`/admin.html`)
- Total queries (today / this week / all time)
- Queries per day — line chart (Chart.js)
- Most-queried departments — horizontal bar chart
- Most-requested sub-services — horizontal bar chart
- Recent queries table
- Auto-refresh every 30s with countdown
- Data source: `query_log.jsonl` (local only; Vercel stub returns zeroed data)

### Module 5 — Map Editor
- Paint cells: Wall, Door, Stair, Open, Erase
- Brush + drag painting; same-type click erases
- Undo/Redo: 50-step history (Ctrl+Z / Ctrl+Y)
- Stamp tool: design reusable n×n patterns
- Presets: save/reload named stamp patterns
- Catalogue: log named stamp placements with jump-to navigation
- Select mode: drag to select region → rotate CW/CCW, move, delete
- Persistence: auto-saved to localStorage (`wayfinding-grid-v1`)

---

## 3. Key File Paths

| File | Purpose |
|---|---|
| `wayfinding-app/index.html` | Entry point (v=25) |
| `wayfinding-app/serve_https.py` | Local HTTPS server (port 3001) |
| `wayfinding-app/js/app.js` | State machine, UI, floor switching, prompts |
| `wayfinding-app/js/nav.js` | PDR, compass EMA, QR scan/generate |
| `wayfinding-app/js/renderer.js` | Canvas: grid, path, trail, ghost previews |
| `wayfinding-app/js/data.js` | NODES, NODE_MAP, localStorage persistence |
| `wayfinding-app/js/dijkstra.js` | Shortest-path (MinHeap Dijkstra) |
| `wayfinding-app/js/compass.js` | Compass class (DeviceOrientation wrapper) |
| `wayfinding-app/js/chat.js` | RAG chat widget |
| `wayfinding-app/css/app.css` | All styles, mobile-first |
| `wayfinding-app/data/departments.json` | 21 departments with grid coordinates (all null — pending fieldwork) |
| `wayfinding-app/data/services.json` | 60 service records linked to departments |
| `wayfinding-app/admin.html` | Analytics dashboard |
| `wayfinding-app/query_log.jsonl` | Runtime query log (git-ignored) |
| `api/chat.js` | Vercel serverless function (Groq) |
| `api/analytics.js` | Vercel analytics stub |
| `.env` | Local config (git-ignored) |
| `.env.example` | Config template (committed) |
| `dissertation/SYSTEM_CONTEXT.md` | This file |

---

## 4. Deployment Modes

| Mode | LLM Backend | Use Case |
|---|---|---|
| **Mode 1 — Local Ollama** | Qwen2.5:3b/7b via Ollama | Daily development, RAG evaluation, analytics |
| **Mode 2 — Local + Groq fallback** | Groq (USE_GROQ=true in .env) | Quick demo when Ollama is off |
| **Mode 3 — Vercel + Groq** | llama-3.1-8b-instant via Groq | SUS evaluation with 120 respondents (public URL) |

**Run locally:**
```bash
python wayfinding-app/serve_https.py
# → https://localhost:3001
```

**HTTPS required** — DeviceMotion and Camera APIs blocked on plain HTTP.

---

## 5. Hardware Tiers (Local Pipeline)

| Tier | GPU | VRAM | Concurrent Users | Best For |
|---|---|---|---|---|
| 1 (current) | ~4GB VRAM | 4GB | 3–5 | Solo development |
| 2 (recommended) | RTX 3060 12GB | 12GB | 10–15 | Dissertation SUS evaluation |
| 3 (deployment) | RTX 3090 24GB | 24GB | 20–60 (vLLM) | City hall pilot |
| 4 (production) | Mac Mini M4 Pro | 24GB unified | 30–50 | Always-on office server |

**VRAM budget (full stack, 4-bit quant):**
- Qwen2.5:3b + e5-large + bge-reranker = ~3.6GB
- Qwen2.5:7b + e5-large + bge-reranker = ~6.1GB
- Qwen2.5:14b + e5-large + bge-reranker = ~10.6GB

---

## 6. The 21 Departments (departments.json)

All coordinates currently `null` — to be filled after fieldwork.

| # | Department | Floor Plan Label | Floor |
|---|---|---|---|
| 1 | Building Regulatory Services Office | Building Regulatory Office | 2nd |
| 2 | City Accounting and Internal Control Office | Accounting (26) | 2nd |
| 3 | City Administration Office | Admin's Office / Admin Office | 3rd |
| 4 | City Assessment Office | City Assessment Office (40) | Ground |
| 5 | Office for the Senior Citizens Affairs | ⚠️ Not clearly labeled — needs confirmation |
| 6 | Persons with Disability Affairs Office | PDAO | Lower Ground |
| 7 | City Social Services Department | CSSYDO (10) — needs confirmation | Lower Ground |
| 8 | Business Permits and Tricycle Franchising Office | Business Permit (20) | Ground |
| 9 | City Disaster Risk Reduction and Management Division | ⚠️ Not visible — needs confirmation |
| 10 | City Planning and Development Office | City Planning and Dev't Office (30) | 2nd |
| 11 | City Human Resource and Management Office | HR (17) | 2nd |
| 12 | City Environment and Natural Resources Department | CENRO (6) | 2nd |
| 13 | City College of Calamba | ⚠️ Not visible — may be separate building |
| 14 | City Population Management Office | POPULATION (2nd) / Population (10) (3rd) — needs confirmation |
| 15 | Information, Investment Promotions and Employment Services Office | IIPESO (17) | Lower Ground |
| 16 | City Health Services Department | Health (10) | Lower Ground |
| 17 | Veterinary Services and Slaughterhouse Management Office | City Veterinary (10) | Lower Ground |
| 18 | Office of the City Vice-Mayor | Vice Mayor's Office (3) | 3rd |
| 19 | Office of the City Mayor | Mayor's Office (15) | 3rd |
| 20 | Cooperatives and Livelihood Development Department | COOP (13) | Lower Ground |
| 21 | City Legal Services Office | Prosecutor (10) — needs confirmation | Lower Ground |

---

## 7. Building Layout (from Floor Plan Slides)

**Shape:** Octagonal, 4 floors.

### Slide 1 — Lower Ground Floor
CSSYDO, IIPESO, Treasury, Health, Landbank, Housing, COMELEC, COOP, Prosecutor, PDAO, Agriculture, City Veterinary, Cong Cha

### Slide 2 — Ground Floor
City Treasury Office, GSO, Local Civil Registration Office, Tourism, City Assessment Office, MOPAC, Business Permit

### Slide 3 — Second Floor
VMO Extension, Building Regulatory Office, Engineering/Services Office, MOEA, Population, City Planning and Dev't Office, City Budget Office, Accounting, HR, DILG, Sectoral Affairs, CENRO

### Slide 4 — Third Floor
Sangguniang Bayan Secretariat, Vice Mayor's Office, Councillor's Offices (×11), CCEMPC, Population, Mayor's Office, Admin's Office, Admin Office

**Notes:**
- Numbers in parentheses (e.g., Treasury (20)) — meaning unknown, likely personnel count or seating capacity. Needs confirmation.
- Main entrance location: unknown — needs fieldwork confirmation.
- North orientation: unknown from scanned plan.

---

## 8. Pending Fieldwork Questions (for City Hall Personnel)

*(See taglish version in conversation for actual delivery)*

1. **Floor numbering & main entrance** — which floor/side do citizens enter from?
2. **Unconfirmed offices** — OSCA, CDRRMD, City College locations?
3. **Ambiguous labels** — CSSYDO = City Social Services? Prosecutor = City Legal Services?
4. **Duplicate floor** — Population on 2nd and 3rd — which is the public-facing counter?
5. **Out-of-scope offices** — COMELEC, Landbank, GSO, Tourism, etc. — include or exclude?
6. **Numbers in parentheses** — personnel count, seating capacity, or other?

---

## 9. Known Bugs / Pending Code Fixes

| Item | File | Status |
|---|---|---|
| Dead code: `segmentPath()` + `buildInstructions()` | `dijkstra.js` lines 110–190 | ⏳ Not yet fixed |
| Wrong comment "100×100 grid" | `data.js` line 2 | ⏳ Not yet fixed |
| Stale version in README: says `v=22`, should be `v=25` | `README.md` | ⏳ Not yet fixed |

---

## 10. Dissertation Evaluation Plan

| Metric | Method |
|---|---|
| RAG quality | Recall@K, Precision@K, MRR on held-out query set |
| Navigation accuracy | Positional error (m) across conditions A/B/C/D |
| Usability | SUS survey, 120 respondents |
| Concurrency | Mode 1 vs Mode 3 response time under load |

---

## 11. Key Technical Decisions (Rationale)

| Decision | Reason |
|---|---|
| Zero-crossing step detection | Phone-position invariant (Jiménez et al., 2010) |
| EMA compass α=0.4 | Faster turn response (Harle, 2013) |
| Dijkstra over A* | Simpler, sufficient for 25×25 grid |
| FAISS IndexFlatIP | Exact search; index small enough (~21 docs) |
| Groq llama-3.1-8b-instant | 14,400 RPD limit vs 1,000 RPD on qwen3-32b |
| ThreadingHTTPServer | Prevents single Ollama call blocking all requests |
| Double-checked locking | Thread-safe pipeline init without bottlenecking |
| No frameworks (vanilla JS) | No install required on citizen device |
