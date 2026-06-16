"""Clean reranker ablation on the LIVE Upstash retrieval.

Answers one question rigorously: *given the same first-stage candidates from
Upstash Vector (text-embedding-3-small), does adding the cross-encoder reranker
the paper originally specified (BAAI/bge-reranker-base) improve retrieval?*

Both arms share the SAME first-stage candidate pool (so this isolates the
reranker, unlike comparing the local pipeline to the cloud one — which also
changed the embedding model):

  Arm A "no rerank" : evaluate the pool in Upstash's native similarity order.
  Arm B "rerank"    : re-score the pool's text with bge-reranker-base, reorder.

Same test set, same department-level relevance model, and same Recall@K /
Precision@K / MRR / NDCG@K formulas as run_upstash_eval.py, so the no-rerank
numbers reproduce the live eval as a sanity check.

USAGE (PowerShell):
    $env:UPSTASH_VECTOR_REST_URL   = "https://....upstash.io"
    $env:UPSTASH_VECTOR_REST_TOKEN = "....."
    python eval/run_rerank_ablation.py
"""
import json
import math
import os
import sys
import time
import urllib.request
import urllib.error
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT       = Path(__file__).resolve().parent
TEST_FILE  = ROOT / "rag_test_set.json"
SERVICES   = ROOT.parent / "wayfinding-app" / "data" / "services.json"
K_VALUES   = [1, 3, 5]
POOL       = 10                       # first-stage candidates both arms draw from
RERANK_MODEL = "BAAI/bge-reranker-base"

URL   = os.environ.get("UPSTASH_VECTOR_REST_URL", "").rstrip("/")
TOKEN = os.environ.get("UPSTASH_VECTOR_REST_TOKEN", "")
if not URL or not TOKEN:
    print("ERROR: set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN.", file=sys.stderr)
    sys.exit(1)


def norm(s):
    return (s or "").strip().lower()


def load_corpus_dept_counts():
    data = json.loads(SERVICES.read_text(encoding="utf-8"))
    return Counter(norm(d.get("department")) for d in data)


def dcg(rels):
    return sum(rel / math.log2(i + 2) for i, rel in enumerate(rels))


def ndcg_at_k(rels, k, total_relevant):
    dcg_k = dcg(rels[:k])
    idcg_k = dcg([1] * min(total_relevant, k))
    return (dcg_k / idcg_k) if idcg_k > 0 else 0.0


def upstash_pool(query, top_k):
    """Return the candidate pool as list of dicts {department, text}."""
    body = json.dumps({"data": query, "topK": top_k,
                       "includeMetadata": True, "includeData": True}).encode()
    req = urllib.request.Request(URL + "/query-data", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
            out = []
            for x in d.get("result", []):
                meta = x.get("metadata") or {}
                out.append({"department": meta.get("department"),
                            "text": x.get("data") or meta.get("subservice") or ""})
            return out
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(1.5 * (attempt + 1)); continue
            raise
    return []


def metrics_for(depts, expected, R):
    """Department-level metrics from a ranked list of departments."""
    rels = [1 if norm(d) in expected else 0 for d in depts]
    first = next((i + 1 for i, r in enumerate(rels) if r), None)
    row = {"mrr": (1.0 / first) if first else 0.0}
    for k in K_VALUES:
        rel_k = sum(rels[:k])
        row[f"recall@{k}"]    = rel_k / R
        row[f"precision@{k}"] = rel_k / k
        row[f"ndcg@{k}"]      = ndcg_at_k(rels, k, R)
    return row


def blank_agg():
    a = {f"recall@{k}": [] for k in K_VALUES}
    a.update({f"precision@{k}": [] for k in K_VALUES})
    a.update({f"ndcg@{k}": [] for k in K_VALUES})
    a["mrr"] = []
    return a


def main():
    print(f"Loading reranker {RERANK_MODEL} (CPU)...")
    from sentence_transformers import CrossEncoder
    ce = CrossEncoder(RERANK_MODEL, device="cpu")   # CPU: avoids the GPU OOM seen in serve_https

    test_data   = json.loads(TEST_FILE.read_text(encoding="utf-8"))
    dept_counts = load_corpus_dept_counts()
    scorable    = [q for q in test_data["queries"] if q.get("expected_department")]
    print(f"Scoring {len(scorable)} queries | pool={POOL} | arms: no-rerank vs rerank\n")

    agg_base, agg_rr = blank_agg(), blank_agg()
    per_query = []

    for i, q in enumerate(scorable, 1):
        expected = set(norm(d) for d in q["expected_department"])
        R = sum(dept_counts.get(d, 0) for d in expected) or 1
        pool = upstash_pool(q["query"], POOL)
        if not pool:
            continue

        # Arm A — native Upstash order
        base_depts = [c["department"] for c in pool]
        mb = metrics_for(base_depts, expected, R)

        # Arm B — rerank the SAME pool with the cross-encoder
        scores = ce.predict([(q["query"], c["text"]) for c in pool])
        order  = sorted(range(len(pool)), key=lambda j: scores[j], reverse=True)
        rr_depts = [pool[j]["department"] for j in order]
        mr = metrics_for(rr_depts, expected, R)

        for m in agg_base:
            agg_base[m].append(mb[m]); agg_rr[m].append(mr[m])

        per_query.append({
            "id": q["id"], "query": q["query"], "expected": q["expected_department"],
            "base_top1": base_depts[0] if base_depts else None,
            "rr_top1":   rr_depts[0] if rr_depts else None,
            "base_mrr": round(mb["mrr"], 3), "rr_mrr": round(mr["mrr"], 3),
        })
        flag = "  <-- changed top-1" if (base_depts[:1] != rr_depts[:1]) else ""
        print(f"  [{i:2d}/{len(scorable)}] {q['id']:<14} "
              f"base MRR={mb['mrr']:.2f}  rerank MRR={mr['mrr']:.2f}{flag}")
        time.sleep(0.15)

    def summ(agg):
        return {m: round(sum(v) / len(v), 3) for m, v in agg.items()}
    sb, sr = summ(agg_base), summ(agg_rr)

    print("\n" + "=" * 66)
    print("  RERANKER ABLATION  (same Upstash pool, department-level relevance)")
    print("=" * 66)
    print(f"  {'Metric':<12}{'no-rerank':>12}{'rerank':>12}{'delta':>12}")
    for k in K_VALUES:
        for fam in ("recall", "precision", "ndcg"):
            m = f"{fam}@{k}"
            print(f"  {m:<12}{sb[m]:>12.3f}{sr[m]:>12.3f}{sr[m]-sb[m]:>+12.3f}")
    print(f"  {'MRR':<12}{sb['mrr']:>12.3f}{sr['mrr']:>12.3f}{sr['mrr']-sb['mrr']:>+12.3f}")

    changed = sum(1 for r in per_query if r["base_top1"] != r["rr_top1"])
    print(f"\n  Queries where rerank changed top-1: {changed}/{len(per_query)}")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out = {"backend": "upstash-vector + bge-reranker-base ablation",
           "embedding_model": "text-embedding-3-small (Upstash server-side)",
           "reranker": RERANK_MODEL, "pool": POOL, "generated": ts,
           "n_queries": len(per_query), "relevance": "department-level",
           "no_rerank": sb, "rerank": sr,
           "delta": {m: round(sr[m] - sb[m], 3) for m in sb},
           "top1_changed": changed, "per_query": per_query}
    (ROOT / f"rerank_ablation_{ts}.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    md = [
        "# Reranker ablation — Upstash retrieval, with vs without bge-reranker-base",
        "",
        f"- First stage: **Upstash Vector** (text-embedding-3-small), top-{POOL} pool",
        f"- Reranker: **{RERANK_MODEL}** (CPU cross-encoder, re-orders the same pool)",
        f"- Queries: {len(per_query)} | department-level relevance | {ts} UTC",
        "",
        "| Metric | no-rerank | rerank | delta |",
        "|---|---|---|---|",
    ]
    for k in K_VALUES:
        for fam in ("recall", "precision", "ndcg"):
            m = f"{fam}@{k}"
            md.append(f"| {m} | {sb[m]:.3f} | {sr[m]:.3f} | {sr[m]-sb[m]:+.3f} |")
    md.append(f"| **MRR** | **{sb['mrr']:.3f}** | **{sr['mrr']:.3f}** | **{sr['mrr']-sb['mrr']:+.3f}** |")
    md += ["", f"Rerank changed the top-1 result on **{changed}/{len(per_query)}** queries."]
    (ROOT / f"rerank_ablation_{ts}.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\nSaved eval/rerank_ablation_{ts}.json + .md")


if __name__ == "__main__":
    main()
