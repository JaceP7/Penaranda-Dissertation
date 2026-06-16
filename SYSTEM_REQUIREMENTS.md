# System Requirements — Old (Local) vs New (Fully Cloud)

**Decision:** the Conversational AI is now a **fully cloud / serverless** architecture (Option A in `OBJECTIVES_ASSESSMENT.md` §4). This document gives the **old** requirements (what the current paper describes — fully local) and the **new** requirements (what is actually deployed and what the paper should now say). Hand this to your colleague to update the Software & Hardware Requirements section.

> One-line summary of the change: **the LGU no longer needs a server, a GPU, or any on-prem AI hardware.** The whole system runs on managed cloud services; citizens use their own phones; staff use any browser.

---

## A. Side-by-side overview

| Layer | OLD — Fully Local (current paper) | NEW — Fully Cloud (deployed) |
|---|---|---|
| Frontend hosting | Local HTTPS server (`serve_https.py`) on an on-prem machine | **Vercel** static hosting (CDN) |
| Backend / API | Same Python server process | **Vercel serverless functions** (`api/chat.js`, `api/analytics.js`, `api/ping.js`), Node runtime, no dependencies |
| Embedding model | `intfloat/multilingual-e5-large` (local, ~2.2 GB) | **Upstash Vector** managed embedding — `text-embedding-3-small` (1536-dim, server-side) |
| Vector search | **FAISS** `IndexFlatIP` (in-process) | **Upstash Vector** (managed vector DB, REST) |
| Reranker | `BAAI/bge-reranker-base` cross-encoder (local, ~1.1 GB) | *None* (managed ANN retrieval is sufficient; see metrics note) |
| LLM (generation) | **Ollama** local LLM (default `qwen2.5:3b`, 4-bit) | **Groq** `llama-3.3-70b-versatile` (hosted inference, REST) |
| Analytics store | Local file / process memory | **Upstash Redis** (REST, key `wf:querylog`) |
| Compute owner | The LGU (must run + maintain a server 24/7) | Managed providers (no LGU compute) |

---

## B. Hardware requirements

### OLD — Fully Local (server-side)
A dedicated machine running 24/7 to host the model stack:

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4-core x86-64 | 8-core+ |
| RAM | 16 GB | 32 GB |
| GPU / VRAM | Optional but slow on CPU | **8–12 GB VRAM** for e5-large + bge-reranker + a small local LLM (`qwen2.5:3b`). A 70B-class local LLM at parity with the cloud LLM needs **~40 GB+ VRAM** (multi-GPU) — impractical on commodity hardware. |
| Storage | ~10 GB (models + index + OS deps) | SSD, 20 GB+ |
| Network | Static IP / port-forward + TLS cert for HTTPS | UPS / backup power for 24/7 uptime |

### NEW — Fully Cloud (server-side)
**None.** No LGU-owned server, GPU, or AI hardware. All compute is on Vercel + Upstash + Groq.

### Client / end-user device (BOTH — primary deployment = citizens' own phones)
| Requirement | Detail |
|---|---|
| Device | Any modern smartphone, tablet, laptop, or kiosk |
| Browser | Chrome/Safari/Edge/Firefox, last ~2 years (ES2017+) |
| Network | Mobile data or Wi-Fi (the app is online-only for chat) |
| Camera | Optional — only for in-app QR scan; posted QRs work with the **native** camera |
| Motion sensors | Optional — accelerometer + magnetometer for PDR walking; not required if using QR positioning + on-screen route |
| Install | **None** — it is a web app (URL or scan a posted QR) |

---

## C. Software & services

### OLD — Fully Local
- Python 3.10+ with: `torch`, `sentence-transformers`, `faiss-cpu`, `ollama`, `numpy`, `python-dotenv` (see `requirements.txt`)
- Ollama installed + a model pulled (`ollama pull qwen2.5:3b`)
- Local HTTPS server (`serve_https.py`) + a TLS certificate
- OS + drivers (CUDA if GPU)
- Manual ops: patching, restarts, backups, uptime monitoring

### NEW — Fully Cloud (accounts/keys, no installs)
| Service | Purpose | Config |
|---|---|---|
| **Vercel** | Static frontend + serverless API + CDN + auto-deploy from GitHub | project env vars below |
| **Upstash Vector** | Managed embeddings + vector search | `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN` |
| **Groq** | Hosted LLM (`llama-3.3-70b-versatile`) | `GROQ_API_KEY` |
| **Upstash Redis** | Live analytics log | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **GitHub** | Source of truth; push → Vercel redeploys | repo connected to Vercel |

No runtime language install, no model downloads, no package dependencies in the serverless functions (they use native `fetch`).

---

## D. Cost & operations

| | OLD — Local | NEW — Cloud |
|---|---|---|
| Upfront | Server + GPU purchase | ₱0 |
| Recurring | Power, internet, maintenance staff time | Free tiers cover a pilot (Vercel Hobby, Upstash free, Groq free). Paid tiers only if traffic grows. |
| Maintenance | LGU patches/monitors the box | Providers manage uptime/scaling |
| Scaling | Buy more hardware | Automatic (serverless) |
| Key risk | Hardware failure / downtime | Free-tier **rate limits** under heavy concurrent load (handled gracefully with a "busy, try again" message) |

---

## E. Data privacy (RA 10173) — wording change for the paper

**OLD wording (remove):** "locally hosted AI inference to minimize exposure of municipal data to external cloud-based services."

**NEW wording (use):** "The system processes a **public** knowledge base (the Citizen's Charter) on managed cloud services. **No sensitive citizen records, financial data, or confidential transactions are processed or stored.** Only **anonymous operational query logs** (the question text, resolved department, latency, language) are retained for analytics, in line with RA 10173 (Data Privacy Act of 2012). Administrative access is **role-based and PIN-gated.**"

---

## F. Retrieval quality note (defense-ready)

Dropping the local cross-encoder reranker did **not** hurt retrieval: the live cloud stack scores **MRR 0.762 / P@1 0.750** vs. the local pipeline's **MRR 0.714** (`eval/run_upstash_eval.py` vs `eval/run_retrieval_metrics.py`). So the move to cloud is a net win on both ops and accuracy.

---

## G. Checklist for the colleague (paper edits)

1. **Scope & Delimitation** — replace "fully local RAG … FAISS … cross-encoder reranking … local LLMs … locally hosted inference" with the cloud/serverless description (§A) + new privacy clause (§E).
2. **Definition of Terms** — update "Geo-Agentic RAG Intelligent System" / RAG entry to mention managed vector DB + hosted LLM rather than local FAISS/LLM.
3. **Software & Hardware Requirements** — swap the local server/GPU table for §B/§C (no LGU hardware; client device + cloud services).
4. **Methodology / Architecture figure** — update the RAG block to Vercel + Upstash Vector + Groq + Upstash Redis.
5. Keep the **navigation** description as-is (QR-code positioning + PDR + grid/graph routing are unchanged and still local-to-the-browser).
