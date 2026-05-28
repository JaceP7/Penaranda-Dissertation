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
