"""Retrieval metrics for the LIVE Upstash Vector backend.

Mirrors eval/run_retrieval_metrics.py exactly (same test set, same
department-level relevance model, same Recall@K / Precision@K / MRR / NDCG@K
formulas) so the numbers are directly comparable to the local
e5-large + bge-reranker pipeline.

Difference: retrieval is done by querying the deployed Upstash Vector index
(server-side embedding) instead of the local FAISS pipeline — so these are the
numbers for what's actually live on the website.

USAGE:
    $env:UPSTASH_VECTOR_REST_URL   = "https://....upstash.io"
    $env:UPSTASH_VECTOR_REST_TOKEN = "....."
    python eval/run_upstash_eval.py
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

ROOT      = Path(__file__).resolve().parent
TEST_FILE = ROOT / "rag_test_set.json"
SERVICES  = ROOT.parent / "wayfinding-app" / "data" / "services.json"
K_VALUES  = [1, 3, 5]

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
    ideal = [1] * min(total_relevant, k)
    idcg_k = dcg(ideal)
    return (dcg_k / idcg_k) if idcg_k > 0 else 0.0


def upstash_retrieve(query, top_k):
    """Query the live Upstash Vector index → list of department strings (rank order)."""
    body = json.dumps({"data": query, "topK": top_k, "includeMetadata": True}).encode()
    req = urllib.request.Request(URL + "/query-data", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
            return [(x.get("metadata") or {}).get("department") for x in d.get("result", [])]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(1.5 * (attempt + 1)); continue
            raise
    return []


def main():
    test_data = json.loads(TEST_FILE.read_text(encoding="utf-8"))
    dept_counts = load_corpus_dept_counts()
    scorable = [q for q in test_data["queries"] if q.get("expected_department")]
    print(f"Scoring {len(scorable)} queries against LIVE Upstash Vector "
          f"(text-embedding model server-side)\n")

    per_query = []
    agg = {f"recall@{k}": [] for k in K_VALUES}
    agg.update({f"precision@{k}": [] for k in K_VALUES})
    agg.update({f"ndcg@{k}": [] for k in K_VALUES})
    agg["mrr"] = []
    topk = max(K_VALUES)

    for i, q in enumerate(scorable, 1):
        expected = set(norm(d) for d in q["expected_department"])
        R = sum(dept_counts.get(d, 0) for d in expected) or 1
        depts = upstash_retrieve(q["query"], top_k=topk)
        rels = [1 if norm(d) in expected else 0 for d in depts]

        first_rel = next((idx + 1 for idx, r in enumerate(rels) if r), None)
        mrr = (1.0 / first_rel) if first_rel else 0.0
        agg["mrr"].append(mrr)

        row = {"id": q["id"], "query": q["query"], "expected": q["expected_department"],
               "top_depts": depts[:max(K_VALUES)], "rels": rels, "R": R, "mrr": round(mrr, 3)}
        for k in K_VALUES:
            rel_k = sum(rels[:k])
            row[f"recall@{k}"]    = round(rel_k / R, 3)
            row[f"precision@{k}"] = round(rel_k / k, 3)
            row[f"ndcg@{k}"]      = round(ndcg_at_k(rels, k, R), 3)
            agg[f"recall@{k}"].append(rel_k / R)
            agg[f"precision@{k}"].append(rel_k / k)
            agg[f"ndcg@{k}"].append(ndcg_at_k(rels, k, R))
        per_query.append(row)
        print(f"  [{i:2d}/{len(scorable)}] {q['id']}  R@1={row['recall@1']:.2f} "
              f"MRR={row['mrr']:.2f}  {q['query'][:44]}")
        time.sleep(0.15)

    summary = {m: round(sum(v) / len(v), 3) for m, v in agg.items()}

    print("\n" + "=" * 60)
    print("  LIVE UPSTASH RETRIEVAL METRICS (department-level)")
    print("=" * 60)
    for k in K_VALUES:
        print(f"  Recall@{k}: {summary[f'recall@{k}']:.3f}   "
              f"Precision@{k}: {summary[f'precision@{k}']:.3f}   "
              f"NDCG@{k}: {summary[f'ndcg@{k}']:.3f}")
    print(f"  MRR:       {summary['mrr']:.3f}")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    # JSON
    (ROOT / f"upstash_metrics_{ts}.json").write_text(
        json.dumps({"backend": "upstash-vector",
                    "embedding_model": "text-embedding-3-small (Upstash server-side)",
                    "generated": ts, "n_queries": len(scorable),
                    "relevance": "department-level",
                    "summary": summary, "per_query": per_query}, indent=2),
        encoding="utf-8")
    # Markdown
    md = [
        f"# Live Upstash Vector retrieval metrics",
        f"",
        f"- Backend: **Upstash Vector** (server-side embedding, what the website uses)",
        f"- Queries scored: {len(scorable)} (department-level relevance)",
        f"- Generated: {ts} UTC",
        f"",
        f"| Metric | @1 | @3 | @5 |",
        f"|---|---|---|---|",
        f"| Recall | {summary['recall@1']:.3f} | {summary['recall@3']:.3f} | {summary['recall@5']:.3f} |",
        f"| Precision | {summary['precision@1']:.3f} | {summary['precision@3']:.3f} | {summary['precision@5']:.3f} |",
        f"| NDCG | {summary['ndcg@1']:.3f} | {summary['ndcg@3']:.3f} | {summary['ndcg@5']:.3f} |",
        f"",
        f"**MRR: {summary['mrr']:.3f}**",
        f"",
        f"| ID | Query | Expected | Top-1 retrieved | R@1 | MRR |",
        f"|---|---|---|---|---|---|",
    ]
    for r in per_query:
        top1 = (r["top_depts"][0] if r["top_depts"] else "—") or "—"
        md.append(f"| {r['id']} | {r['query'][:38]} | {r['expected'][0][:28]} | "
                  f"{top1[:28]} | {r['recall@1']:.2f} | {r['mrr']:.2f} |")
    (ROOT / f"upstash_metrics_{ts}.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\nSaved eval/upstash_metrics_{ts}.json + .md")


if __name__ == "__main__":
    main()
