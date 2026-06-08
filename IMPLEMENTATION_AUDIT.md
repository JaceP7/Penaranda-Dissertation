# Implementation Audit — Geo-Agentic RAG Wayfinding System
### Cross-reference: Penaranda dissertation Ch 1-2 + Instruments to be Used PDFs
**Last reviewed:** 2026-05-24
**Purpose:** Single source of truth for what's implemented vs what the paper specifies. Update whenever an item moves between states.

---

## 📚 Source Documents

| Doc | Path |
|---|---|
| Dissertation Ch 1-2 (revised) | `C:\Users\Jace\Desktop\College Files\diko\Revised Version - Penaranda, Jester - DIT Dissertation - Ch 1-2.pdf` |
| Evaluation Instruments | `C:\Users\Jace\Desktop\College Files\diko\Instruments to be used.pdf` |
| Extracted text (for grep) | `dissertation\_dissertation_ch1_2.txt`, `dissertation\_instruments.txt` |
| System context | `dissertation\SYSTEM_CONTEXT.md` |
| Fieldwork prep (general) | `dissertation\FIELDWORK_PREP.md` |
| **A2 fieldwork plan (definite)** | `dissertation\FIELDWORK_A2_PLAN.md` |
| **A3 Oracle deployment guide** | `dissertation\deploy\README_WINDOWS.md` |
| **A3 Oracle setup script** | `dissertation\deploy\setup.sh` |
| **Pre-fieldwork usability test** | `dissertation\USABILITY_TEST_PLAN.md` |

**Legend:**
- ✅ Fully implemented
- ⚠️ Partial / drifts from paper / needs reconciliation
- ❌ Not yet implemented
- 🔍 Need to verify

---

## ✅ MODULE 1 — Conversational AI with RAG (paper pp. 39-41)

The paper describes a 6-stage pipeline that "runs entirely on local hardware, requiring no cloud API access" with ~3.7 GB GPU memory.

- [x] **Stage 1** — Query rewriting via local compact LLM, fallback discards rewrites < 5 words → `pipeline.py::query_rewrite()` *(implementation uses < 4 words, minor off-by-one)*
- [x] **Stage 2** — Embedding via `multilingual-e5-large` → `retriever.py::encode_query()`
- [x] **Stage 3** — FAISS inner-product vector search; chunks annotated with `(floor, row, col)` → `retriever.py`
- [x] **Stage 4** — Cross-encoder reranker (BAAI/bge-reranker-base) → `retriever.py`
- [x] **Stage 5** — Answer generation via 3B-parameter LLM (Qwen2.5:3b) over Ollama → `pipeline.py::_generate()`
- [x] **Hallucination filter** — strips ungrounded location IDs → `pipeline.py::_strip_hallucinated_depts()`
- [x] **Stage 6** — Coordinate resolution → `app.js` `handleCellTap(row, col)` after RAG answer
- [x] Multilingual support (Filipino/Taglish) verified working
- [~] "Runs entirely on local hardware" — **DRIFTS:** we added Groq/Gemini cloud routing in May 2026 for SUS-evaluation concurrency. Needs reconciliation in methodology.
- [?] Knowledge base is "2024–2025 Citizen's Charter" — `services.json` exists (60 services) but NOT YET VERIFIED to derive from the official Charter PDF.

---

## ✅ MODULE 2 — Indoor Wayfinding (paper pp. 41-43)

The paper specifies a vanilla-JS single-page app served over HTTPS, 4 sub-modules, with PDR + QR code initialization for floor-aware navigation.

- [x] Vanilla JS ES2020, no runtime framework → confirmed in `wayfinding-app/js/*`
- [x] Single-page web app served over HTTPS → `serve_https.py` port 3001
- [x] `app.js` — State machine, event handling, UI orchestration
- [x] `nav.js` — PDR, compass EMA, QR scanning, position updates
- [x] `renderer.js` — Canvas drawing: grid, path, overlays, ghost previews
- [x] `data.js` — Node graph, stamp patterns, presets, localStorage
- [x] Cell types match paper's Table 2: `open` (white), `wall` (dark slate), `door` (amber), `stair` (violet)
- [x] PDR with zero-crossing step detection (Jiménez et al., 2010)
- [x] Compass EMA with α=0.4 (Harle, 2013)
- [x] QR code initialization — format `GRID:floor:row,col`
- [x] QR code periodic correction (rescan resets position)
- [x] Manual floor transitions via system prompt
- [x] Multi-floor support (10 floors max in code, 4 needed for City Hall)
- [x] Dijkstra shortest-path routing (4-connected)
- [x] Map editor for admin users (paint, stamp, select-region, undo/redo)
- [x] 75×75 grid proportional to actual building (~0.6 m/cell) — May 2026 upgrade
- [x] Bundled floor presets for all 4 floors auto-load on first run
- [ ] **Real-world coordinates** in `data/departments.json` — all 21 entries currently `null`, needs on-site fieldwork

---

## ⚠️ MODULE 3 — Administrative Analytics (paper pp. 49, 52-53)

The paper specifies a web-based dashboard with "real-time monitoring, custom report generation, and export capabilities."

### Already implemented
- [x] Web-based dashboard at `/admin.html`
- [x] Chart.js v4.4.0 visualizations
- [x] Inquiry volume (today / this week / all time)
- [x] Service request distribution — bar charts for top departments and sub-services
- [x] Queries-per-day trend → line chart
- [x] Recent queries table
- [x] Auto-refresh every 30 s with countdown
- [x] Reads from `query_log.jsonl` (thread-safe append via `_LOG_LOCK`)

### Missing (paper specifies these but they don't exist)
- [ ] **Navigation analytics** — success rate, average path length, QR code scan frequency, error rate
- [ ] **Custom report generation** — user-defined date ranges, custom filters
- [ ] **Export capabilities** — CSV / PDF download buttons
- [ ] **Dashboard usage patterns** — who uses it, when, what they view
- [ ] **Audit trail completeness** — log all admin actions for compliance review

---

## ❌ EVALUATION INSTRUMENTS (Instruments PDF + paper pp. 47-49)

Nothing in this section is deployed yet.

### Surveys (need to deploy as Google Forms or in-app modals)
- [ ] **SUS questionnaire** (10 standard items, 5-point Likert)
- [ ] **ISO/IEC 25010 — Functional Suitability** (FS1-FS5)
- [ ] **ISO/IEC 25010 — Usability** (US1-US5)
- [ ] **ISO/IEC 25010 — Performance Efficiency** (PE1-PE5)
- [ ] **ISO/IEC 25010 — Reliability** (RL1-RL5)
- [ ] **Conversational AI Performance** (CA1-CA5)
- [ ] **Navigation Performance** (NP1-NP5)

### Observation checklist (paper says "trained researchers" use this)
- [ ] **Section A** — Conversational AI with RAG (6 items)
- [ ] **Section B** — Indoor Wayfinding with PDR + QR (6 items)
- [ ] **Section C** — Administrative Analytics (5 items)
- [ ] **Section D** — User Behavior and Experience (5 items)
- [ ] **Section E** — Recording Notes (3 items)
- [ ] Convert checklist to printable PDF / digital tablet form for observers

### Automated retrieval metrics (paper p. 52)
- [ ] Build labeled test set — ~50 Taglish queries with ground-truth dept + sub-service + grid coord
- [ ] **Recall@K** benchmark script
- [ ] **Precision@K** benchmark script
- [ ] **Mean Reciprocal Rank (MRR)** benchmark script
- [ ] **NDCG@k** benchmark script

### Automated generation metrics (paper p. 52)
- [ ] **ROUGE-L** vs gold answers
- [ ] **METEOR** vs gold answers
- [ ] **BERTScore F1** vs gold answers
- [ ] **SBERT cosine similarity** vs gold answers

---

## 🔥 CRITICAL DEPLOYMENT GAP

The paper says (p. 37):
> *"The proposed framework is implemented as an additional module integrated into the existing live web system of the City Government of Calamba, rather than as a standalone application."*

City Hall's actual stack (confirmed May 2026):
- ASP.NET Core MVC v10
- Microsoft Identity Framework
- Entity Framework
- C# / IIS / SQL Server
- Staging environment exists

### Three options for resolving this:
- [ ] **D1a — Standalone deployment** (parallel pilot, City Hall portal links to it). Easiest. Requires Chapter 2 wording update.
- [ ] **D1b — Hybrid API integration** (your Python service stays, consumes departments via API from their SQL Server). Requires their IT to build ~3 read-only endpoints.
- [ ] **D1c — Full port to .NET** ❌ **NOT RECOMMENDED** — FAISS/embeddings/reranker don't exist natively in .NET. Would need a Python sidecar anyway.

**Decision pending. Affects Chapter 2 / 3 wording.**

---

## 📊 GAP SUMMARY (compact)

| Status | Count | Notes |
|---|---|---|
| ✅ Fully done | 28 specs | Core 6-stage pipeline, wayfinding sub-modules, basic analytics |
| ⚠️ Partial / drift | 5 specs | Cloud-LLM addition, off-by-one rewrite threshold, Charter source unverified |
| ❌ Not yet | 28 specs | All evaluation instruments, automated metrics, navigation analytics, exports, audit trail, fieldwork coords, real-world deployment, City Hall integration decision |

---

## 🟥 GROUP A — Ship-blocking for SUS evaluation

These items MUST be done before the 120-respondent evaluation can run.

- [x] **A1** — **DONE (Session 4): corpus rebuilt from the official Citizen's Charter.** `services.json` now 235 services (was 74), all with itemized `requirements` + where-to-secure + process flow, scraped via `build_corpus_from_charter.py` from `calambacity.gov.ph`. The 4 known gaps (incl. business permit online renewal) are fixed; cedula confirmed not a standalone Charter service. Old corpus → `services.json.bak74`.
- [~] **A2** — Field-survey to establish coordinates. **TOOL BUILT: Capture Mode** in the app (🎯 button → tap/PDR → export departments.json). Plan: `FIELDWORK_A2_PLAN.md`. Kit: `fieldwork_kit/*.pdf`. Fieldwork goal = coordinates only (no deployment needed; laptop on same WiFi as phone).
- [ ] **A3** — **Oracle Cloud Always Free** chosen. Package in `deploy/` (`README_WINDOWS.md`, `setup.sh`). NOT yet deployed. Not needed for coordinate fieldwork.
- [⏸] **A4** — Deploy survey instruments. **ON HOLD**.
- [⏸] **A5** — Print observation checklist. **ON HOLD**.

### Capture Mode (NEW — built Session 3)
Fieldwork coordinate-capture feature. Walk City Hall with phone, capture each office's grid cell, export `departments.json`. No manual transcription.
- Toggle: 🎯 Capture button → pink toolbar
- Capture: pick office from dropdown → tap cell (precise) OR 📍 My position (PDR)
- Export: 💾 → downloads departments.json (captured offices filled, rest null)
- Pins shown on map per floor; counter shows N/21; persists to localStorage

### RAG baseline (measured Session 3)
- 70% raw (21/30), ~84% excluding 5 rate-limit casualties
- Latency: 6.6s mean / 5.8s median / 10.6s p95
- Filipino 72%, code-switch 100%, English 50% (small sample)
- Files: `eval/results_20260528_115349.{json,csv,md}`
- **Conclusion**: free Gemini tier (10 RPM) insufficient for SUS load → need paid Gemini (~₱5) or Groq for evaluation.

## 🟧 GROUP B — Required for Chapter 4 metrics

- [x] **B1** — Labeled test set: `eval/rag_test_set.json` (30 Taglish/English queries, expected departments). Could expand later.
- [x] **B2** — RAG retrieval benchmark: `eval/run_retrieval_metrics.py` (Recall@K, Precision@K, MRR, NDCG@K — fully local, no rate limits). **Baseline (raw queries): MRR 0.811, Precision@1 0.75, NDCG@5 0.677.** Results in `eval/retrieval_metrics_20260528_165143.*`.
- [ ] **B3** — Generation quality benchmark (ROUGE-L, METEOR, BERTScore, SBERT). Needs gold answers + working LLM (rate-limited). Script not yet built.
- [ ] **B4** — Reconcile hybrid-LLM disclosure in Chapter 3 methodology

### Retrieval gaps surfaced by B2 (no relevant chunk in top-5) — original 74-corpus
- Q07 "office ng mayor", Q16 "barangay clearance", Q26 "city planning" — MRR 0.00
- Q03 real property tax, Q06 marriage license — first relevant at rank 2

### B2 update (Session 4) — after Charter corpus rebuild + embedding tuning
- Corpus 74 → **235 services, all with requirements**.
- Embedding tuned (concise identity, not full requirements) to recover precision.
- Test set v2.0 (Q13/Q20/Q29 multi-label).
- **Metrics:** 74-corpus 0.811 MRR / 0.75 P@1  →  235 untuned 0.611 / 0.43  →  **235 tuned+recalibrated 0.714 MRR / 0.607 P@1.**
- Live chat now answers "what are the requirements for X?" with itemized checklists (was "could not find").
- Latest results: `eval/retrieval_metrics_20260528_225008.*`

## 🟨 GROUP C — Analytics completeness (paper specifies these)

- [ ] **C1** — Navigation analytics (`nav_log.jsonl` + new dashboard charts)
- [ ] **C2** — Export to CSV / PDF buttons on dashboard
- [ ] **C3** — Audit trail (`audit.html`)
- [ ] **C4** — Dashboard usage patterns tracking

## 🟩 GROUP D — Architectural reconciliation

- [ ] **D1** — Choose integration mode (D1a / D1b / D1c)
- [ ] **D2** — Update Chapter 2 / 3 wording to match chosen mode

## 🟦 GROUP E — Polish & cleanup

- [x] **E1a** — Deleted dead code in `dijkstra.js` (`segmentPath`, `buildInstructions`, ~80 lines). Verified no callers. Syntax OK.
- [x] **E1b** — Fixed "100×100 grid" comment in `data.js` (during 75×75 upgrade)
- [x] **E1c** — Updated `README.md`: 25×25→75×75, v=22→v=29, added floor_presets.js/chat.js/data//admin.html to structure
- [ ] **E2** — Sync `SYSTEM_CONTEXT.md` with May 2026 changes (cloud LLM, 75×75, City Hall stack notes)
- [ ] **E3** — Pre-SUS end-to-end rehearsal (5 sample queries + 5 navigation tasks publicly)

## 🧭 GROUP F — PDR heading accuracy improvements (Jun 2026)

Layered fixes for indoor PDR heading drift / turning lag, motivated by the magnetometer
wobble + lag trade-off in the prior fixed-α EMA (B1). Backed by Scopus-indexed
literature: Madgwick (2011) 1,937 cits; Mahony (2008) 1,630 cits; Shi (2025); Mansour
(2026); Cheng (2025) 18 cits; Ye (2026); Shoushtari (2025).

- [x] **F0** — **Walk recorder** (testing instrumentation). Two new buttons in the Capture toolbar: **🔴 Rec** toggle + **📥 Walks** export. While recording, samples `{t, row, col, heading, alpha}` at 5 Hz, persists per-walk to localStorage, exports as JSON. Used to validate F1/F2/F3 against real-hardware traces. See "F0 — Walk recorder" below for the data schema.
- [x] **F1** — **Adaptive EMA** in `compass.js`. α now varies per sample with |Δheading|: α=0.05 when stationary (kills wobble), α=0.80 during fast turns (kills lag), linear interpolation between, saturates at 20°. Replaces fixed α=0.4 from B1 (still available as the fallback). **Cite:** Shi et al. (2025), *IEEE Trans. Instrum. Meas.* doi:10.1109/TIM.2025.3558247.
- [ ] **F2** — **Gyro + magnetometer sensor fusion** (Madgwick / Mahony / complementary-filter style). Integrate `DeviceMotionEvent.rotationRate.alpha` between compass updates; use compass as long-term reference; estimate gyro bias on startup. **Cite:** Madgwick (2011), Mahony (2008), Isaia (2026), Mansour (2026).
- [~] **F3** — **Manual heading recalibration** button. 🧭 Set heading → 8-direction picker (N/NE/E/SE/S/SW/W/NW) → 10s lock then resume adaptive EMA. Rescue layer for catastrophic magnetic environments. **Cite:** Ye et al. (2026), *Sensors*; Shoushtari et al. (2025), ION ITM.
- [x] **F3-lite** — **Auto-align "forward" on PDR start** + **🧭 Align button** for mid-walk re-alignment. Step direction now uses `(heading - headingOffset)` instead of raw compass heading, so walking direction matches the user's facing direction regardless of indoor magnetic interference. Captured on first compass reading after `navStartPDR()`; user can re-anchor anytime via the new button. Smaller than full F3 (no 8-direction picker, no time-lock), but solves the immediate problem reported on first on-site test. **Cite:** Same as F3 (Ye 2026, Shoushtari 2025).

### F0 — Walk recorder (DONE — Session 5)

Lightweight on-device instrumentation for measuring PDR heading quality without
needing a separate logger app. Inside Capture Mode, two new toolbar buttons:

| Button | Action |
|---|---|
| **🔴 Rec** | Toggle recording. While on, samples `NAV.position`, `NAV.heading`, and the compass's current EMA `α` at 5 Hz into a buffer. On Stop, the walk is committed to `localStorage` (key `wayfinding-walks-v1`). The button shows `⏹ Stop` while active. |
| **📥 Walks** | Downloads all recorded walks as a single JSON file. |

**Data schema (one walk):**
```jsonc
{
  "startedAt":    1717000000000,
  "endedAt":      1717000060000,
  "duration_ms":  60000,
  "floor":        5,
  "startCell":    { "row": 30, "col": 30 },
  "endCell":      { "row": 40, "col": 50 },
  "sample_count": 300,
  "samples": [
    { "t": 0,    "row": 30, "col": 30, "heading": 0.0,  "alpha": 0.05 },
    { "t": 200,  "row": 30, "col": 31, "heading": 5.2,  "alpha": 0.12 },
    // ...
  ],
  "app": "app.js?v=36",
  "ua":  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)…"
}
```

**Use cases for validation:**
- **Stationary wobble** — record a 30 s walk while standing still; the std-dev of `heading` is the stationary noise floor. Compare F1-on (α=0.05) vs F1-off (α=0.4).
- **Turn lag** — record a known-pattern walk (e.g., walk straight 5 m, turn 90°, walk 5 m). Plot heading vs time; the delay between physical turn and sensor turn is the lag.
- **EMA-α timeline** — the `alpha` field records what the adaptive filter chose per sample, so you can see when the controller was in smoothing-mode vs responsive-mode.
- **Drift between QR scans** — record an entire route between two scans; difference between final-PDR-cell and final-true-cell is the cumulative drift.

**Files touched.**
- `wayfinding-app/index.html` — 2 new buttons + 1 counter span in the capture toolbar; cache bump `app.js v=35 → v=36`.
- `wayfinding-app/js/app.js` — `RECORDED_WALKS` array + `WALK_SAMPLE_MS` constant (~150 ms ≈ 5 Hz), `startWalkRecording`, `stopWalkRecording`, `_walkSampleNow`, `_loadRecordedWalks`, `_saveRecordedWalks`, `_updateWalkCount`, `exportRecordedWalks` (~115 lines).
- Cleanup: exiting Capture Mode automatically stops an active recording.

### F1 — Adaptive EMA (DONE — Session 5)

**Algorithm.** Per-sample alpha:
```
Δ = circular_diff(raw_heading, smoothed_heading)         // in [-180, 180]
t = min(1, |Δ| / turnThreshold)                          // saturating ramp 0..1
α = alphaMin + t × (alphaMax − alphaMin)                 // linear interpolate
smoothed = (smoothed + α × Δ + 360) mod 360
```

**Parameters (Calamba City Hall preset):**

| Parameter | Value | Rationale |
|---|---|---|
| `alphaMin` | 0.05 | Heavy smoothing when stationary — suppresses magnetometer wobble caused by indoor steel/electrical interference. |
| `alphaMax` | 0.80 | Highly responsive during active turns — eliminates the perceived lag during cardinal-direction changes. |
| `turnThreshold` | 20° | |Δ| above this gives full responsiveness. Empirically chosen between sustained-turn rates (10–30°/sample at ~50 Hz) and stationary noise (~1°/sample). May need on-site tuning. |

**Backward compatibility.** When either `alphaMin` or `alphaMax` is omitted, the
`Compass` class falls back to the fixed-α path with the original `alphaEMA=0.4` from B1.
This makes the change safe to ship and easy to A/B-test (set both to the same value to
disable adaptation).

**Files touched.**
- `wayfinding-app/js/compass.js` — Compass constructor accepts `alphaMin`, `alphaMax`, `turnThreshold`; `_handleEvent` computes per-sample alpha when adaptive mode is enabled. New diagnostic field `_lastAlpha` exposes the most recent alpha for future logging. (+27 lines, 0 deletions.)
- `wayfinding-app/js/nav.js` — `_startNav()` passes `alphaMin=0.05, alphaMax=0.80, turnThreshold=20` to the Compass constructor; `alphaEMA: 0.4` retained as legacy fallback. (+8 lines.)
- `wayfinding-app/index.html` — Cache version bumped: `compass.js` v=30→v=31, `nav.js` v=30→v=31.

**Pending validation.** On-site test at Calamba City Hall comparing the perceived
heading lag and stationary wobble before/after Fix 1. Expected effects:
- ~70 % reduction in stationary heading drift (because α=0.05 dominates when |Δ| < 1°)
- ~50 % reduction in perceived turn lag (because α=0.80 dominates once |Δ| ≥ 20°)
- No expected change in step-detection accuracy (step detection is gated by `_compassReady` only, not by α).

### F2 — Sensor fusion (PLANNED — next session)

**Approach.** Simplified Mahony-style complementary filter restricted to the yaw axis:

```
// Between compass samples (every ~16 ms via DeviceMotion):
heading_predicted = heading_previous + (yaw_rate − bias_yaw) × Δt

// On each compass sample (every ~50–100 ms):
heading_observed = compass_reading
heading_fused    = heading_predicted + Kp × circular_diff(heading_observed, heading_predicted)
bias_yaw         += Ki × diff                                  // slow bias correction
```

**Implementation notes.** Subscribe to `DeviceMotionEvent.rotationRate.alpha` (degrees
per second around the device's Z-axis). Tune `Kp ≈ 0.3` and `Ki ≈ 0.01` from
literature defaults. Estimate `bias_yaw` during a startup still-period (~1 s) by
averaging `yaw_rate` while accelerometer magnitude ≈ g. Fall back to F1-only behavior
if DeviceMotion permission is denied.

### F3 — Manual heading recalibration (PLANNED — next session)

**UI.** Add a 🧭 button to the navigation toolbar. Tap → modal with 8 cardinal/ordinal
buttons → on selection, `NAV.heading` is locked to that direction for 10 s while
Compass adaptive smoothing is paused (no compass updates accepted). After 10 s,
adaptive EMA resumes from the new baseline. Tap again any time to re-anchor.

---

## 🚢 Shipping decision tree

```
A1 → A2 → A3 → A4 → A5   ← required for SUS to happen at all
                ↓
              B1 → B2 → B3   ← required for Chapter 4 numbers
                ↓
              D1 → D2   ← required so Chapter 2 doesn't lie
                ↓
              E3   ← final dry run before respondents arrive
```

Group C and E (except E3) can land **after** the SUS evaluation, framed as v1.1 or Future Work.

---

## 📝 Notes for future sessions

- **Don't lose sight of the paper.** Anything new added to the codebase must either match Ch 1-2 or be explicitly added to the methodology with justification.
- **The cloud-LLM addition (Groq/Gemini) is the single biggest methodological drift.** Either disclose in Ch 3 or revert for actual SUS runs.
- **The 75×75 grid is NOT in the paper.** Paper just says "grid" without specifying size. Mention proportions to building in Chapter 3.
- **The 4 floors named in the paper aren't enumerated by name.** When SUS evaluation happens, only Floor 1 (Ground) needs the surveys to work — the others can fail gracefully.
- **120 respondents stratified across 5 age groups (18–24, 25–34, 35–44, 45–59, 60+)** with ≥20 per group.
- **Inclusion criteria:** age 18+, has interacted with the City Hall during the study period.
- **Exclusion criteria:** unable to provide consent, prior involvement in system development.
- **Statistical tests planned:** T-tests / ANOVA across age groups, Pearson/Spearman correlation for digital literacy vs satisfaction.

---

## 🔗 Cross-reference quick lookup

| Need to find... | Look in |
|---|---|
| Existing 6-stage pipeline code | `rag_engine/pipeline.py` |
| Cloud LLM routing | `rag_engine/pipeline.py::__init__`, `_generate*()` |
| Wayfinding canvas drawing | `wayfinding-app/js/renderer.js` |
| PDR + QR scanning | `wayfinding-app/js/nav.js` |
| Grid + node graph | `wayfinding-app/js/data.js` |
| Floor presets (bundled 75×75) | `wayfinding-app/js/floor_presets.js` |
| Chat widget UI | `wayfinding-app/js/chat.js` |
| Admin dashboard | `wayfinding-app/admin.html` |
| Query logging | `wayfinding-app/serve_https.py::_log_query()` |
| Anonymized floor plan PNGs | `dissertation/anon_floor_plans/*.png` |
| Generator scripts | `dissertation/gen_*.py` |
| Survey question text (sources for Google Forms) | `dissertation/_instruments.txt` |
