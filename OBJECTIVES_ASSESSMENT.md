# System vs. Dissertation Objectives — Assessment

**Paper:** *Geo-Agentic RAG: A Framework for Integrated Document Services, Wayfinding, and Administrative Analytics for Local Government Offices* (Revised, Ch. 1–2).
**Assessed:** 2026-06-16 against the live Vercel deployment + local pipeline.
**Verdict in one line:** All three functional objectives (SOP 1–3) are **built and working**; the effectiveness objective (SOP 4) is **partially evidenced** — retrieval metrics are done, but SUS, ISO 25010, navigation, and groundedness/faithfulness instruments are still pending. One **architecture divergence** (paper says *fully local* RAG; deployment is *cloud* RAG) must be reconciled before defense.

---

## 1. Statement of the Problem — scorecard

| # | Objective (paraphrased) | Status | Evidence / gap |
|---|---|---|---|
| **SOP 1** | Design & implement the integrated 3-module Geo-Agentic RAG system to improve citizen access | ✅ **Done** | Unified app: chat → "Take me there" → wayfinding → analytics. All three modules live. |
| **SOP 2** | Conversational AI (RAG) giving context-aware, step-by-step explanations grounded in the Citizen's Charter | ✅ **Done (functionally)** | 235 services from the 2024–25 Charter; grounded answers with requirements + "secure at"; Taglish. ⚠️ *Architecture differs from paper — see §4.* |
| **SOP 3** | Indoor wayfinding for office-to-office navigation | ✅ **Done** | 75×75 grid × 4 floors, Dijkstra routing, PDR + QR init, cross-floor stair prompts, RAG→office routing (26/31 depts, 197/235 services). |
| **SOP 4** | Effectiveness via ISO/IEC 25010 + system performance metrics | 🟡 **Partial** | Retrieval benchmark complete; everything else (ISO, SUS, navigation, generation) not yet measured. See §2–§3. |

---

## 2. SOP 4.1 — ISO/IEC 25010 readiness

The *system* supports each characteristic; the *formal evaluation instrument* (expert/pilot survey, Cronbach's α) is what's missing.

| Attribute | System supports it? | Formal evidence? | Note |
|---|---|---|---|
| Functional Suitability | ✅ | ❌ | Features map to all 3 modules; needs a functional-suitability checklist scored by evaluators. |
| Performance Efficiency | ✅ | 🟡 | Per-query latency is logged to Redis (`avgLatency`); not yet summarised as a metric. |
| Compatibility | ✅ | ❌ | Runs in any mobile browser (citizens' own phones); no install. Needs a device/browser matrix. |
| Reliability | ✅ | 🟡 | Groq retry + rate-limit handling + graceful "could not reach assistant". No uptime/MTBF study. |
| Security | 🟡 | ❌ | PIN-gated admin, role separation, no sensitive records stored. ⚠️ Exposed keys must be rotated; no pen-test. |
| Maintainability | ✅ | ❌ | Modular JS, bake-and-push deploy, documented audits. Needs a maintainability rubric. |
| Portability | ✅ | ❌ | Serverless + static; portable to any LGU by swapping the corpus + floor plans. |

**Gap:** the ISO 25010 + SUS survey instrument (A4/A5) is the single biggest remaining evaluation deliverable.

---

## 3. SOP 4.2 — System performance metrics readiness

| Metric group | Status | What exists | What's missing |
|---|---|---|---|
| 4.2.1 Conversational AI Performance | 🟡 | Latency logged; answers grounded | Accuracy/helpfulness rating by evaluators |
| 4.2.2 Navigation Performance | ❌ | Routing works; walk recorder (F0) captures 5 Hz traces | Navigation accuracy, route-completion rate, localization accuracy, task-completion time — need an **on-site walk study** |
| 4.2.3 SUS | ❌ | — | Standard 10-item SUS, ≥ pilot N respondents |
| 4.2.4 Administrative Analytics | ✅ | Live Redis dashboard: totals, top depts/subservices, per-day, ambiguity rate, latency, recent queries | Navigation analytics + CSV/PDF export are nice-to-have |
| 4.2.5 Retrieval Benchmarking | 🟡 | **Precision@K, Recall@K, MRR, NDCG@K** done — live MRR 0.762 / P@1 0.750 (`eval/run_upstash_eval.py`) | **Groundedness + Faithfulness** not yet measured (need LLM-as-judge or annotated set) |

---

## 4. ⚠️ The one divergence to reconcile: local vs. cloud RAG

This is the most important finding. The paper's **Scope & Delimitation** and **Definition of Terms** state the conversational AI uses:

> "a **fully local RAG architecture** incorporating vector embeddings, **FAISS vector search**, **cross-encoder reranking**, **local Large Language Models (LLMs)**, and grounded response generation … the system utilizes … **locally hosted AI inference to minimize exposure of municipal data to external cloud-based services**."

The **live deployment** uses a **cloud** stack instead:
- **Upstash Vector** (managed, `text-embedding-3-small`) — not local FAISS
- **Groq `llama-3.3-70b`** — not a local LLM
- **No cross-encoder reranker** in the serverless path
- Embeddings/queries leave the device (the opposite of "locally hosted inference")

Both stacks exist in the repo. The **local pipeline** (`serve_https.py`: multilingual-e5-large + FAISS IndexFlatIP + bge-reranker-base + Groq) **matches the paper**; the **cloud pipeline** (Vercel + Upstash) is what citizens currently hit. They even score similarly (cloud MRR 0.762 vs local 0.714).

**DECISION (2026-06-16): Option A — fully cloud.**

The methodology is being rewritten to describe a **cloud / serverless** RAG architecture (managed vector DB + hosted LLM), justified by zero on-prem hardware, zero-maintenance deployment to citizens' own phones, and the fact that the Citizen's Charter corpus is **public** (no sensitive document leaves a private boundary; only operational query logs are stored). The privacy clause changes from "locally hosted inference" to "no sensitive citizen records are processed; only anonymous operational query logs are retained (RA 10173-compliant)."

See **`SYSTEM_REQUIREMENTS.md`** for the old→new requirement breakdown to hand to the colleague.

*(Rejected — Option B: hosting the local e5-large + FAISS + bge-reranker + local LLM pipeline on a server. A 70B local LLM at parity with Groq needs ~40 GB+ VRAM, which defeats the no-hardware goal.)*

---

## 5. Scope & Delimitation alignment

| Scope statement | Status |
|---|---|
| "Additional module integrated into the **existing live web system** of Calamba" | 🟡 Styled to match (Calamba eGov hero + chat-first overlay) and deployed standalone on Vercel; **not yet embedded** inside calambacity.gov.ph. Either embed via iframe/subdomain or soften wording to "designed to integrate." |
| Main building only, predefined layouts, QR init | ✅ |
| Floor transitions **manually triggered by confirmation prompts** (no auto floor detection) | ✅ Stair prompts implemented exactly as scoped. |
| No online transactions (payments/permits/appointments) | ✅ Information + guidance only. |
| Static layout, no emergency/relocation routing | ✅ Matches delimitation. |
| RA 10173 / role-based access / only operational logs stored | 🟡 PIN gate + query logs only (no citizen records). ⚠️ "locally hosted inference" clause conflicts with §4. |

---

## 6. The three UX features shipped today (citizens' own phones)

Deployment target = the citizen's **own smartphone**, so onboarding and self-service matter most.

1. **Tappable starter prompts** under the chat ("Business permit", "Cedula", "Marriage certificate", "Senior citizen ID", "Real property tax", "Building permit"). Removes the blank-box problem; auto-hide after the first message. → strengthens **SOP 1/2** (access) and future **SUS** scores.
2. **QR-first positioning + posted-QR deep links.** Posted QRs now encode a full app URL (`?qr=floor:row,col`) scannable by the phone's **native camera** — opens the app already localised, no install or in-app scanner. In-app scanner still accepts both URL and legacy `GRID:` payloads; a citizen-facing "Scan the QR near you" hint sits in the chat. → directly serves **SOP 3** and the Charter's **QR-Code Positioning** definition; PDR is now explicitly the *backup*.
3. **Turn-by-turn text directions** alongside the map route line (collapsible panel: "Head north ~6 m → Turn right → Arrive at …", with a "Take the stairs to Floor X" note for cross-floor trips). → serves **SOP 3** and gives evaluators something concrete to score for **navigation performance** and accessibility.

All three are behind the citizen (`view-user`) view; admin/editor chrome is unchanged.

---

## 7. What's next (priority order)

1. **Reconcile §4 (local vs cloud RAG)** — a writing/architecture decision; blocks the methodology chapter. *(Highest.)*
2. **Build the SUS + ISO 25010 instruments** (A4/A5) and run the pilot — the main missing *evaluation* deliverable.
3. **On-site navigation study** — measure route-completion rate, localization accuracy, task-completion time using the F0 walk recorder + the new turn-by-turn steps. Also verifies the 5 unmapped offices' coordinates.
4. **Groundedness + Faithfulness** for retrieval (LLM-as-judge or a small annotated set) — completes SOP 4.2.5.
5. **Embed into / link from the real Calamba site** (or soften the scope wording).
6. **Rotate the exposed keys** (Upstash Vector/Redis, Groq, Gemini) — security hygiene before any public pilot.
7. **F2 PDR upgrade** (gyro+magnetometer fusion) — improves localization accuracy, the weakest navigation metric.

**Bottom line:** the build substantially satisfies SOP 1–3 and the analytics + retrieval slices of SOP 4. The remaining work is mostly *evaluation instruments and write-up reconciliation*, not new engineering — except the architecture decision in §4, which is a choice you need to make.
