"""
Retrieval-stage benchmark for the Geo-Agentic RAG pipeline.

Computes the IR metrics specified in the dissertation (Ch 4):
    Recall@K, Precision@K, Mean Reciprocal Rank (MRR), NDCG@K

Runs FULLY LOCAL — calls rag_engine.retriever.retrieve() directly
(multilingual-e5-large + FAISS + bge-reranker on CPU). No LLM, so NO rate limits.

Relevance model (department-level):
    A retrieved chunk is RELEVANT if its `department` is in the query's
    expected_department list. R (total relevant) = number of corpus chunks
    whose department is in that list. This measures whether the retriever
    surfaces the correct OFFICE for each citizen query.

Usage:
    python run_retrieval_metrics.py
    python run_retrieval_metrics.py --rewrite     # also rewrite via LLM first (rate-limited)

Outputs:
    eval/retrieval_metrics_<ts>.json   full per-query + aggregate
    eval/retrieval_metrics_<ts>.md     readable report (paste into Ch 4)
"""

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
sys.path.insert(0, str(REPO))

TEST_FILE = ROOT / "rag_test_set.json"
SERVICES  = REPO / "wayfinding-app" / "data" / "services.json"

K_VALUES = [1, 3, 5]


def norm(s):
    return (s or "").strip().lower()


def load_corpus_dept_counts():
    """Count how many corpus chunks belong to each department (for Recall denominator)."""
    data = json.loads(SERVICES.read_text(encoding="utf-8"))
    counts = Counter(norm(d.get("department")) for d in data)
    return counts


def dcg(rels):
    """Discounted cumulative gain for a binary relevance list (in rank order)."""
    return sum(rel / math.log2(i + 2) for i, rel in enumerate(rels))


def ndcg_at_k(rels, k, total_relevant):
    """NDCG@k with binary relevance."""
    dcg_k = dcg(rels[:k])
    ideal = [1] * min(total_relevant, k)
    idcg_k = dcg(ideal)
    return (dcg_k / idcg_k) if idcg_k > 0 else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rewrite", action="store_true",
                    help="Rewrite queries via the LLM first (rate-limited; default off)")
    ap.add_argument("--topk", type=int, default=max(K_VALUES),
                    help="Retrieve this many chunks (default %(default)s)")
    args = ap.parse_args()

    print("Loading retriever (e5-large + FAISS + bge-reranker, CPU)... ~30s first time")
    from rag_engine.retriever import retrieve  # heavy import

    rewrite_fn = None
    if args.rewrite:
        from rag_engine.pipeline import CityPipeline
        rewrite_fn = CityPipeline().query_rewrite

    test_data = json.loads(TEST_FILE.read_text(encoding="utf-8"))
    dept_counts = load_corpus_dept_counts()

    # Only queries with a known expected department can be scored
    scorable = [q for q in test_data["queries"] if q.get("expected_department")]
    print(f"Scoring {len(scorable)} queries (of {len(test_data['queries'])} total; "
          f"ambiguous/OOS excluded)\n")

    per_query = []
    agg = {f"recall@{k}": [] for k in K_VALUES}
    agg.update({f"precision@{k}": [] for k in K_VALUES})
    agg.update({f"ndcg@{k}": [] for k in K_VALUES})
    agg["mrr"] = []

    topk = max(args.topk, max(K_VALUES))

    for i, q in enumerate(scorable, 1):
        query = q["query"]
        if rewrite_fn:
            try:
                query = rewrite_fn(query)
            except Exception as e:
                print(f"  [rewrite failed for {q['id']}: {e}]")

        expected = set(norm(d) for d in q["expected_department"])
        # total relevant chunks in corpus for this query's expected depts
        R = sum(dept_counts.get(d, 0) for d in expected) or 1

        chunks = retrieve(query, top_k=topk, use_reranker=True)
        rels = [1 if norm(c.get("department")) in expected else 0 for c in chunks]

        # First relevant rank (for MRR)
        first_rel = next((idx + 1 for idx, r in enumerate(rels) if r), None)
        mrr = (1.0 / first_rel) if first_rel else 0.0
        agg["mrr"].append(mrr)

        row = {"id": q["id"], "query": q["query"],
               "expected": q["expected_department"],
               "top_depts": [c.get("department") for c in chunks[:max(K_VALUES)]],
               "rels": rels, "R": R, "mrr": round(mrr, 3)}

        for k in K_VALUES:
            rel_k = sum(rels[:k])
            recall = rel_k / R
            precision = rel_k / k
            ndcg = ndcg_at_k(rels, k, R)
            agg[f"recall@{k}"].append(recall)
            agg[f"precision@{k}"].append(precision)
            agg[f"ndcg@{k}"].append(ndcg)
            row[f"recall@{k}"] = round(recall, 3)
            row[f"precision@{k}"] = round(precision, 3)
            row[f"ndcg@{k}"] = round(ndcg, 3)

        per_query.append(row)
        mark = "OK " if first_rel and first_rel <= 3 else "..."
        print(f"[{i:>2}/{len(scorable)}] {mark} {q['id']}  "
              f"R@1={row['recall@1']:.2f} MRR={row['mrr']:.2f}  {q['query'][:42]}")

    # Aggregate (macro-average over queries)
    summary = {k: round(sum(v) / len(v), 4) if v else 0.0 for k, v in agg.items()}

    print("\n" + "=" * 60)
    print("  AGGREGATE RETRIEVAL METRICS (macro-avg over queries)")
    print("=" * 60)
    for k in K_VALUES:
        print(f"  Recall@{k}:    {summary[f'recall@{k}']:.3f}    "
              f"Precision@{k}: {summary[f'precision@{k}']:.3f}    "
              f"NDCG@{k}: {summary[f'ndcg@{k}']:.3f}")
    print(f"  MRR:         {summary['mrr']:.3f}")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_json = ROOT / f"retrieval_metrics_{ts}.json"
    out_json.write_text(json.dumps(
        {"config": {"rewrite": args.rewrite, "topk": topk,
                    "relevance": "department-level"},
         "summary": summary, "per_query": per_query},
        indent=2, ensure_ascii=False), encoding="utf-8")

    # Markdown report
    md = [
        f"# Retrieval Metrics — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        f"- Pipeline: multilingual-e5-large + FAISS + bge-reranker (CPU, local)",
        f"- Query rewriting: {'ON (LLM)' if args.rewrite else 'OFF (raw queries — isolates retrieval)'}",
        f"- Relevance: department-level (correct office surfaced)",
        f"- Scored queries: {len(scorable)} (ambiguous/out-of-scope excluded)",
        "",
        "## Aggregate (macro-average)",
        "",
        "| Metric | @1 | @3 | @5 |",
        "|---|---|---|---|",
        f"| Recall | {summary['recall@1']:.3f} | {summary['recall@3']:.3f} | {summary['recall@5']:.3f} |",
        f"| Precision | {summary['precision@1']:.3f} | {summary['precision@3']:.3f} | {summary['precision@5']:.3f} |",
        f"| NDCG | {summary['ndcg@1']:.3f} | {summary['ndcg@3']:.3f} | {summary['ndcg@5']:.3f} |",
        "",
        f"**MRR: {summary['mrr']:.3f}**",
        "",
        "## Per-query",
        "",
        "| ID | Query | Expected | Top-1 retrieved | R@1 | MRR |",
        "|---|---|---|---|---|---|",
    ]
    for r in per_query:
        top1 = r["top_depts"][0] if r["top_depts"] else "(none)"
        exp = r["expected"][0] if r["expected"] else ""
        md.append(f"| {r['id']} | {r['query'][:30]} | {exp[:24]} | "
                  f"{(top1 or '')[:24]} | {r['recall@1']:.2f} | {r['mrr']:.2f} |")

    out_md = ROOT / f"retrieval_metrics_{ts}.md"
    out_md.write_text("\n".join(md), encoding="utf-8")

    print(f"\nSaved:\n  {out_json}\n  {out_md}")


if __name__ == "__main__":
    main()
