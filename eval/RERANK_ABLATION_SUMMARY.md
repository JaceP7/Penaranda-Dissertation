# Reranker ablation — does the cross-encoder help? (Answer: no, it hurts)

**Question.** The original (local) methodology specified a cross-encoder reranker
(`BAAI/bge-reranker-base`). The live cloud pipeline drops it. Is that a loss?

**Method (clean, isolates the reranker).** Both arms use the **same first-stage
candidate pool** retrieved from the live **Upstash Vector** index
(`text-embedding-3-small`, top-10). Arm A keeps Upstash's order; Arm B re-orders
that same pool with `bge-reranker-base` (CPU cross-encoder). Same 28-query test
set, same department-level relevance, same metric formulas as
`run_upstash_eval.py`. Reproduce: `python eval/run_rerank_ablation.py`.

## Result

| Metric | no-rerank | rerank | delta |
|---|---|---|---|
| Recall@1 | 0.111 | 0.074 | −0.037 |
| Precision@1 | 0.750 | 0.571 | **−0.179** |
| NDCG@1 | 0.750 | 0.571 | −0.179 |
| Recall@3 | 0.230 | 0.222 | −0.008 |
| Precision@3 | 0.631 | 0.595 | −0.036 |
| NDCG@3 | 0.666 | 0.601 | −0.065 |
| Recall@5 | 0.323 | 0.322 | −0.001 |
| Precision@5 | 0.571 | 0.564 | −0.007 |
| NDCG@5 | 0.633 | 0.590 | −0.043 |
| **MRR** | **0.768** | **0.671** | **−0.097** |

Reranking changed the top-1 result on **7 / 28** queries — and the net effect was
negative (e.g., several `MRR 1.00 → 0.50/0.33` regressions, no gains).

(The no-rerank MRR 0.768 reproduces the live eval's 0.762, confirming the
first-stage arm matches production.)

## Why the reranker hurts here

1. **First stage is already near-optimal.** On a small, clean corpus (235 short,
   distinct service entries), `text-embedding-3-small` already ranks the correct
   service #1 — Precision@1 is 0.75 *before* reranking. There is almost no
   mis-ordering left for a reranker to fix, so it can only add noise (e.g., it
   prefers the lexically similar "Certified True Copy of Business Permit" over
   the correct "New Business Permit application").
2. **The residual errors are recall misses, not ranking errors.** Every 0-MRR
   query had no relevant candidate anywhere in the top-10 pool. A reranker only
   re-orders what was retrieved — it **cannot** recover a missed document, so it
   has zero upside on exactly the queries that are still failing.
3. **General-purpose reranker, domain-specific short texts.** `bge-reranker-base`
   is trained for passage ranking; the candidate texts here are one-line service
   identities, which play to the embedding model's strengths, not the
   cross-encoder's.

## Decision

**Do not add a reranker.** It is omitted to reduce latency and cost, and the
ablation shows it would also *reduce* retrieval quality on this corpus. This is
reported as an experimental finding, not an omission.

**Caveat / honesty for the defense.** This tests the reranker the paper named
(`bge-reranker-base`). A different commercial reranker (Cohere, Voyage) might
behave differently, but the headroom is small (P@1 already 0.75) and the
remaining failures are recall problems a reranker cannot fix. If retrieval recall
needs improving later, the lever is the **embedding model / corpus coverage**,
not a reranker.

Raw artifacts: `eval/rerank_ablation_<timestamp>.json` / `.md`.
