# Code Study Guide — Geo-Agentic RAG Wayfinding System

### For understanding + defending the system

**Last updated:** 2026-05-28

Read this alongside the code. Files are ranked by how important they are to
understand for your dissertation defense. Line numbers are approximate.

---

## 🗺️ The big picture (3 modules + glue)

```
                          ┌──────────────────────────────┐
   CITIZEN (phone)        │  FRONTEND (vanilla JS)        │
        │                 │  - app.js     orchestrator    │
        ▼                 │  - chat.js    Module 1 UI     │
  index.html  ───────────►│  - nav.js     Module 2 (PDR)  │
                          │  - renderer.js  canvas        │
                          │  - dijkstra.js  pathfinding   │
                          │  - data.js    grid graph      │
                          └───────────┬──────────────────┘
                                      │ HTTPS  (/api/chat, /api/analytics, /api/state)
                                      ▼
                          ┌──────────────────────────────┐
                          │  BACKEND (Python)             │
                          │  serve_https.py               │
                          │   - _handle_rag()  Module 1   │
                          │   - _log_query()   Module 3   │
                          │   - _get_analytics() Module 3 │
                          └───────────┬──────────────────┘
                                      │
                                      ▼
                          ┌──────────────────────────────┐
                          │  RAG ENGINE (Python)          │
                          │  rag_engine/pipeline.py       │  ← THE 6-stage pipeline
                          │  rag_engine/retriever.py      │  ← stages 2-4
                          │  rag_engine/build_index.py    │  ← one-time index build
                          └───────────┬──────────────────┘
                                      │
                                      ▼
                          data/services.json   (corpus)
                          data/departments.json (coords)
```

The dissertation has **3 modules**: (1) Conversational AI/RAG, (2) Indoor Wayfinding/PDR, (3) Analytics. The map above shows which files implement each.

---

## 📚 Reading order (study these in this order)

### TIER 1 — MUST understand deeply (your novel contributions)

These are what a panel will probe. Know them cold.

1. **`rag_engine/pipeline.py`** — the 6-stage RAG pipeline (Module 1 core)
2. **`wayfinding-app/js/nav.js`** — PDR + QR localization (Module 2 core)
3. **`wayfinding-app/js/dijkstra.js`** — pathfinding (small, easy to explain)
4. **`rag_engine/retriever.py`** — embedding + FAISS + reranker (stages 2-4)

### TIER 2 — SHOULD understand (the glue + serving)

5. **`wayfinding-app/serve_https.py`** — backend API + analytics (Modules 1 & 3)
6. **`wayfinding-app/js/app.js`** — frontend orchestrator / state machine
7. **`wayfinding-app/js/data.js`** — the 75×75 grid graph
8. **`wayfinding-app/js/chat.js`** — chat widget (Module 1 UI)

### TIER 3 — SKIM (supporting; understand the role, not every line)

9. `wayfinding-app/js/renderer.js` — canvas drawing
10. `wayfinding-app/admin.html` — analytics dashboard (Module 3 UI)
11. `wayfinding-app/js/compass.js` — DeviceOrientation wrapper
12. `rag_engine/build_index.py` — builds the FAISS index (run once)

### CAN IGNORE (bundled libraries / generated)

- `js/lib/jsQR.js`, `js/lib/qrcode.min.js` — third-party, no need to read
- `js/floor_presets.js` — generated data (the bundled 75×75 layouts)

---

## 🔬 TIER 1 — deep notes

### 1. `rag_engine/pipeline.py` — the 6-stage RAG pipeline ⭐

**This is the heart of your dissertation. Memorize the flow.**

| What                                      | Where    | Understand                                                                |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `CityPipeline` class                      | line 190 | The pipeline object, created once                                         |
| `__init__`                                | 196      | Backend selection: Groq > Gemini > Ollama (set by `.env`)                 |
| `answer()`                                | ~285     | **Orchestrates all 6 stages** — read this top to bottom                   |
| `query_rewrite()`                         | 279      | **Stage 1** — normalises Taglish; falls back to original if rewrite fails |
| `_needs_rewrite()`                        | 92       | Heuristic: triggers rewrite for Filipino/short queries                    |
| `_generate()`                             | ~310     | **Stage 5** — routes to Groq/Gemini/Ollama                                |
| `_generate_groq()` / `_generate_gemini()` | ~340     | OpenAI-compatible cloud calls                                             |
| `_format_context()`                       | 147      | Builds the grounded prompt from retrieved chunks                          |
| `_strip_hallucinated_depts()`             | 160      | **Hallucination filter** — removes any office not in retrieved chunks     |
| `_load_departments()`                     | 181      | **Stage 6** — maps office name → grid coords                              |

**The 6 stages (in `answer()`):**

1. Query rewrite (LLM) → 2. Embed (e5-large) → 3. FAISS search → 4. Cross-encoder rerank → 5. Generate answer (LLM) → 6. Resolve coordinate

**Defense soundbite:** _"The pipeline grounds every answer on retrieved Citizen's Charter chunks; the hallucination filter (`_strip_hallucinated_depts`) guarantees no office is named that wasn't in the retrieved evidence."_

### 2. `wayfinding-app/js/nav.js` — PDR + QR ⭐

**Your indoor-navigation contribution. Stairs/QR/step-detection live here.**

| Function           | Line | Understand                                                      |
| ------------------ | ---- | --------------------------------------------------------------- |
| `navInit()`        | 74   | Sets starting position to grid center                           |
| `navSetPosition()` | 87   | Moves the "ME" dot; clamps to grid; fires callbacks             |
| `navStartPDR()`    | 115  | Starts listening to accelerometer (DeviceMotion)                |
| `_navOnMotion()`   | 199  | **THE step detector** — zero-crossing on acceleration magnitude |
| `_navStep()`       | 243  | Advances 1 cell in the compass heading direction                |
| `navRecalibrate()` | 176  | Resets the adaptive step threshold                              |
| `navStartQRScan()` | 267  | Opens camera, starts decode loop                                |
| `_navQRLoop()`     | 304  | Per-frame jsQR decode; parses `GRID:floor:row,col`              |
| `navGenerateQR()`  | 361  | Encodes a cell as a printable QR                                |

**Defense soundbite:** _"Step detection uses zero-crossing of the accelerometer magnitude (Jiménez et al., 2010), which is phone-orientation invariant; QR anchors reset accumulated drift to zero (`_stepsSinceQR`)."_

### 3. `wayfinding-app/js/dijkstra.js` — pathfinding

Small (~108 lines after cleanup). Easy to explain fully.

| What            | Line | Understand                                                                 |
| --------------- | ---- | -------------------------------------------------------------------------- |
| `MinHeap` class | 11   | Binary heap priority queue — O((V+E) log V)                                |
| `dijkstra()`    | 62   | Standard Dijkstra: dist[], prev[], early-exit at dest, path reconstruction |

**Defense soundbite:** _"Routing is Dijkstra over a 4-connected grid graph; with a min-heap it's O((V+E) log V), and at 5,625 nodes it completes in under 5 ms."_

### 4. `rag_engine/retriever.py` — stages 2-4

| Function         | Line | Understand                                                                                        |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `encode_query()` | 73   | **Stage 2** — e5-large embedding with `"query: "` prefix                                          |
| `retrieve()`     | 89   | **Stage 3** FAISS inner-product search → **Stage 4** bge-reranker reorders top-15 → returns top-K |

**Defense soundbite:** _"Bi-encoder FAISS gives fast approximate recall; the cross-encoder reranker then re-scores each query-chunk pair jointly for precision (Glass et al., 2022)."_

---

## 🔧 TIER 2 — glue notes

### 5. `wayfinding-app/serve_https.py` — backend

| Function                 | Line    | Understand                                                               |
| ------------------------ | ------- | ------------------------------------------------------------------------ |
| `_handle_rag()`          | 264     | The `/api/chat` brain: tries full pipeline, falls back to keyword search |
| `_call_llm()`            | 258     | Keyword-path LLM router (Ollama/Groq)                                    |
| `_log_query()`           | 322     | **Module 3** — thread-safe append to `query_log.jsonl`                   |
| `_get_analytics()`       | 332     | **Module 3** — aggregates the log for the dashboard                      |
| `Handler.do_GET/do_POST` | 396/420 | Routes: `/api/state`, `/api/analytics`, `/api/chat`, static files        |
| `_ThreadingHTTPServer`   | ~end    | Concurrency — one slow request doesn't block others                      |

### 6. `wayfinding-app/js/app.js` — orchestrator (biggest file)

Don't read every line. Understand these anchors:
| What | Understand |
|---|---|
| `STATE` object | ~20 | All mode flags (wallMode, navMode, captureMode, currentFloor) |
| `handleCellTap()` | ~469 | **Central tap router** — branches by active mode (capture/select/stamp/wall/destination) |
| `recompute()` | ~540 | Runs Dijkstra + updates the drawn path |
| `setNavMode/setCaptureMode/...` | ~628+ | Mode toggles (mutually exclusive) |
| `switchFloor()` | ~789 | Swaps the active floor's walls in/out of NODES |
| `NAV.onPositionChange` callback | ~229 | Wires PDR position → recompute → redraw → arrival check |
| `loadGridState/saveGridState` | ~1259+ | localStorage persistence + preset version migration |

### 7. `wayfinding-app/js/data.js` — the grid graph

| What                   | Understand                                                |
| ---------------------- | --------------------------------------------------------- |
| `GRID_ROWS/COLS = 75`  | grid dimensions                                           |
| `NODES` / `NODE_MAP`   | every cell as a node `{id, row, col, wall, cellType}`     |
| `buildAdjacency()`     | builds the 4-connected graph Dijkstra walks (skips walls) |
| stamp/preset functions | supporting (map editor) — skim                            |

### 8. `wayfinding-app/js/chat.js` — chat widget

| Function        | Line | Understand                                                                          |
| --------------- | ---- | ----------------------------------------------------------------------------------- |
| `send()`        | 136  | POSTs `{query, history}` to `/api/chat`, renders reply                              |
| `_addMessage()` | 47   | Adds a bubble; handles rate-limited (busy) styling                                  |
| `onNavigate()`  | 20   | Callback that triggers `app.js navigateToDepartment` when an answer names an office |

---

## 🔀 The two critical data flows (trace these)

### Flow A — Citizen asks a question (Module 1)

```
chat.js send()
  → POST /api/chat  {query, history}
    → serve_https.py _handle_rag()
      → pipeline.answer()
          Stage 1  query_rewrite()        (LLM)
          Stage 2  encode_query()         (e5-large)
          Stage 3  retrieve() → FAISS     (top-15)
          Stage 4  reranker.predict()     (top-5)
          Stage 5  _generate()            (LLM, grounded prompt)
                   _strip_hallucinated_depts()
          Stage 6  _load_departments()    (office → row,col)
      → returns {answer, department, subservice, ...}
    → _log_query()                        (Module 3 logging)
  → chat.js _addMessage()  (shows answer)
  → if department: onNavigate() → app.js navigateToDepartment()
      → renderer draws the route to that office
```

### Flow B — Citizen navigates (Module 2)

```
nav.js navStartPDR()
  → _navOnMotion()      (accelerometer fires ~60Hz)
      → zero-crossing detects a step
      → _navStep()       (advance 1 cell toward compass heading)
      → navSetPosition()
  → app.js NAV.onPositionChange callback
      → recompute()      (dijkstra from new pos → destination)
      → renderer._draw() (move ME dot, redraw path, breadcrumb)
      → arrival check

QR correction:
nav.js navStartQRScan() → _navQRLoop() → jsQR decodes "GRID:f:r,c"
  → navSetPosition()  (snap to exact cell; reset drift)
  → if floor differs: NAV.onFloorChange → app.js switchFloor()
```

---

## 🎓 Defense Q&A → which code answers it

| Likely question                                 | Point to                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| "How does the RAG avoid hallucination?"         | `pipeline.py _strip_hallucinated_depts()` + grounded prompt in `_format_context()` |
| "Why a reranker on top of FAISS?"               | `retriever.py retrieve()` — bi-encoder recall + cross-encoder precision            |
| "How does indoor positioning work without GPS?" | `nav.js _navOnMotion()` (PDR) + `_navQRLoop()` (QR anchors)                        |
| "How do you handle multi-floor routing?"        | `app.js switchFloor()` + `NAV.onStairCell` + QR floor field                        |
| "Is it accurate? What are the numbers?"         | `eval/run_retrieval_metrics.py` → MRR 0.811, P@1 0.75                              |
| "Does it scale to many users?"                  | `serve_https.py _ThreadingHTTPServer` + cloud LLM offload                          |
| "What's the knowledge source?"                  | `data/services.json` (from Citizen's Charter) + `build_index.py`                   |
| "How does analytics work?"                      | `serve_https.py _log_query()/_get_analytics()` + `admin.html`                      |

---

## ⏱️ Suggested study session (2-3 hours)

1. **Read `pipeline.py answer()` end-to-end** (30 min) — trace all 6 stages
2. **Read `nav.js _navOnMotion()` + `_navStep()`** (20 min) — understand PDR
3. **Read `dijkstra.js` fully** (15 min) — it's small, know it completely
4. **Read `retriever.py retrieve()`** (15 min) — stages 2-4
5. **Skim `serve_https.py _handle_rag()`** (15 min) — see how the API ties pipeline to frontend
6. **Trace Flow A and Flow B** above with the code open (30 min)
7. **Run the eval** (`python eval/run_retrieval_metrics.py`) and read the output (15 min)

After this you can explain any part of the system to a panel.
