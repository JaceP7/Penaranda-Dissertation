# Live serverless RAG — retrieval evaluation + Scopus-backed rationale

This documents the retrieval performance of the **deployed (Upstash Vector + Groq)**
backend and the literature backing the architecture decisions, for Chapter 3
(methodology) and Chapter 4 (results).

## 1. Evaluation setup

- **Test set:** `eval/rag_test_set.json` — 28 scorable Taglish/English queries
  (ambiguous/out-of-scope excluded), each with an expected department.
- **Relevance model:** department-level — a retrieved service is relevant if its
  `department` is in the query's expected-department list (did the correct office
  surface?). Identical to the local evaluation, so the two are directly comparable.
- **Metrics:** Recall@K, Precision@K, MRR, NDCG@K (K = 1, 3, 5).
- **Backends compared:**
  - **Local:** multilingual-e5-large + FAISS + bge-reranker (the pipeline the
    earlier Chapter 4 numbers were measured on). Script: `eval/run_retrieval_metrics.py`.
  - **Live (deployed):** Upstash Vector with server-side `text-embedding-3-small`
    embeddings, **no reranker**. Script: `eval/run_upstash_eval.py`.

## 2. Results — local vs. live deployed backend

| Metric | Local (e5-large + bge-reranker) | **Live (Upstash, text-embedding-3-small)** |
|---|---|---|
| **MRR** | 0.714 | **0.762** |
| Precision@1 | 0.607 | **0.750** |
| Precision@3 | 0.619 | **0.643** |
| Precision@5 | 0.614 | 0.579 |
| NDCG@1 | 0.607 | **0.750** |
| NDCG@3 | 0.623 | **0.679** |
| NDCG@5 | 0.627 | **0.647** |
| Recall@1 | 0.079 | 0.111 |
| Recall@3 | 0.215 | 0.248 |
| Recall@5 | 0.318 | 0.341 |

(Latest raw output: `eval/upstash_metrics_*.json` / `.md`.)

### Interpretation

- The **deployed serverless backend matches or exceeds the local pipeline on
  every headline metric** — MRR 0.762 vs 0.714, Precision@1 0.750 vs 0.607,
  NDCG@1 0.750 vs 0.607.
- Notably, the live backend achieves this with **dense retrieval only (no
  cross-encoder reranker)**, whereas the local pipeline includes a bge-reranker
  stage. A **controlled ablation** (`eval/run_rerank_ablation.py`,
  `eval/RERANK_ABLATION_SUMMARY.md`) — same Upstash candidate pool, with vs
  without `bge-reranker-base` — confirms this is not luck: adding the reranker
  **lowers** every metric (MRR 0.768 → 0.671, Precision@1 0.750 → 0.571).
  The embedding model already ranks the correct service first, and the residual
  errors are recall misses a reranker cannot fix. So the reranker is omitted as a
  deliberate, evidence-backed decision — it would add latency/cost *and* reduce
  quality at this corpus scale (235 services).
- **Recall@K is intentionally low** for both backends and is *not* a quality
  signal here: the Recall denominator is the total number of corpus services
  belonging to the expected department, which for large offices (e.g. Social
  Services with dozens of services) far exceeds K. Precision@1, NDCG, and MRR
  are the meaningful "did the right office surface first" measures.

## 3. Architecture decisions and their literature backing (Scopus-indexed)

### D1 — Serverless / managed cloud RAG instead of a self-hosted GPU pipeline
The production backend runs the embedding + vector search as managed cloud
services (Upstash Vector) with a thin serverless function, rather than hosting
e5-large + bge-reranker on a VM. This is an established pattern:
- Guettala, M. (2026). *Generative AI and cloud deployment for intelligent
  systems: a retrieval-augmented generation framework using Amazon [Bedrock].*
  Information Processing & Management. doi:10.1016/j.ipm.2026.104837
- Sanyal, P. (2026). *RAGMail: a cloud-based retrieval-augmented framework for
  reducing hallucinations in LLM text generation.* Scientific Reports.
  doi:10.1038/s41598-026-38913-w
- Shah, J. (2026). *Cloud-Native AI and Generative AI on AWS: A Systematic
  Review and a Proposed Unified Model.* IEEE ICMCSI.
  doi:10.1109/ICMCSI67283.2026.11412536
- Yoo, H. K. (2026). *ToR-Lite: A Lightweight Semantic Query Decomposition for
  Multi-Hop RAG in Cloud-Based AI Systems.* Applied Sciences.
  doi:10.3390/app16083966

### D2 — Vector database / approximate-nearest-neighbor retrieval
The corpus is stored in a managed vector index for similarity search:
- Johnson, J., Douze, M., & Jegou, H. (2021). *Billion-scale similarity search
  with GPUs.* IEEE Trans. Big Data. doi:10.1109/TBDATA.2019.2921572 (FAISS)
- Turan, M. (2026). *Search at Scale: Quantifying the Performance Trade-offs of
  ANNS on Milvus.* IJSEKE. doi:10.1142/S0218194026500130
- Qin, C. (2026). *CD-ANN: Scalable Approximate Nearest Neighbor search on
  client-side devices.* Journal of Systems Architecture.
  doi:10.1016/j.sysarc.2026.103771

### D3 — Dense text embeddings for semantic retrieval
Using a learned text-embedding model (text-embedding-3-small in production;
multilingual-e5-large locally) for semantic matching of citizen queries:
- Mitrov, G. (2026). *Optimizing document retrieval using massive text
  embeddings and LLM prompt engineering.* Systematic Reviews.
  doi:10.1186/s13643-026-03155-4
- Jo, H. (2026). *Clinical text embeddings: A systematic review of methods,
  applications, and future directions.* Int. J. Medical Informatics.
  doi:10.1016/j.ijmedinf.2026.106505
- Reimers, N., & Gurevych, I. (2019). *Sentence-BERT.* EMNLP. (foundational)

### D4 — Multilingual / cross-lingual embeddings for Taglish
Citizen queries are code-switched Tagalog-English; the embedding model must be
multilingual (text-embedding-3 and bge-m3 both are):
- Guillen-Ramirez, H. (2026). *LLM-augmented semantic embeddings enable
  cross-lingual mapping of medical procedure terms.* Scientific Reports.
  doi:10.1038/s41598-025-34778-7
- Desalegn, E. (2026). *Improving Amharic legal question answering with
  Retrieval-Augmented Generation and locally-sourced data.* Knowledge-Based
  Systems. doi:10.1016/j.knosys.2026.116194
- Posokhov, P. (2026). *Query-Adaptive Hybrid Search.* Machine Learning and
  Knowledge Extraction. doi:10.3390/make8040091

### D5 — Reranker is optional at this corpus scale (efficiency trade-off)
The live backend drops the cross-encoder reranker yet matches the local pipeline,
supporting a quality-vs-efficiency trade-off that the literature evaluates:
- Elkiran, H. (2026). *Evaluating retriever-reranker pairings in RAG based on
  quality and efficiency trade-offs.* Discover Computing.
  doi:10.1007/s10791-026-10156-3
- Lu, H. (2026). *Mutual information-based retrieval-augmented generation for
  domain question answering.* Knowledge and Information Systems.
  doi:10.1007/s10115-025-02624-x

### D6 — Cloud/API LLM generation for public-service chatbots
Generation uses the Groq-hosted llama-3.3-70b API rather than a self-hosted LLM:
- Dong, W. (2026). *An LLM-based NLP pipeline to assist government agencies in
  digesting massive public comments and mitigating spam.* Information Processing
  & Management. doi:10.1016/j.ipm.2026.104821
- Daugdaug, J. (2026). *Bruno: A RAG-based Programming Learning Assistant for
  Guided, No-Code Problem Solving.* ICEEL 2025. doi:10.1145/3789859.3789864
  (Philippine-authored RAG deployment)

## 4. Recommendation for the dissertation

Because the **deployed backend (text-embedding-3-small) outperforms the local
pipeline** on the key metrics, report the **live Upstash numbers as the system's
retrieval results**, and present the local e5-large + bge-reranker pipeline as the
offline/reproducible reference. This keeps the reported numbers consistent with
what an evaluator actually experiences on the live site during the SUS study.

If you prefer the multilingual `bge-m3` model (stronger on low-resource/Asian
languages in some benchmarks), recreate the Upstash index with `bge-m3`, reseed,
and re-run `eval/run_upstash_eval.py` — the comparison table regenerates.
