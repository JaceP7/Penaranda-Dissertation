"""
Run the RAG test suite against a live wayfinding server.

Usage:
    python run_rag_test.py                          # uses default https://localhost:3001
    python run_rag_test.py --url https://localhost:3001
    python run_rag_test.py --queries Q01 Q05 Q12    # subset only

Outputs:
    eval/results_<timestamp>.json   — full raw results
    eval/results_<timestamp>.csv    — flat per-query CSV
    eval/results_<timestamp>.md     — human-readable summary report

Pass criterion per query:
    The returned department matches one of expected_department (case-insensitive,
    substring match), OR the answer text mentions the expected department.

Edge cases:
    - "ambiguous" queries pass if needsContext=True (system asked for clarification)
    - "out-of-scope" queries pass if no confident department returned
"""

import argparse
import csv
import json
import statistics
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT       = Path(__file__).resolve().parent
TEST_FILE  = ROOT / "rag_test_set.json"

# Suppress self-signed cert warnings — we trust localhost
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


BUSY_MARKER = "i'm a bit busy"   # the rate-limit fallback message from pipeline.py


def call_chat(url: str, query: str, history=None, timeout: int = 60) -> dict:
    """POST to /api/chat and return parsed JSON + latency."""
    payload = json.dumps({"query": query, "history": history or []}).encode()
    req = urllib.request.Request(
        url.rstrip("/") + "/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout) as resp:
            elapsed = time.perf_counter() - t0
            body = resp.read().decode("utf-8")
            return {
                "ok": True,
                "status": resp.status,
                "latency_s": round(elapsed, 3),
                "response": json.loads(body) if body else {},
            }
    except Exception as e:
        return {
            "ok": False,
            "status": -1,
            "latency_s": round(time.perf_counter() - t0, 3),
            "error": str(e),
            "response": {},
        }


def call_chat_with_retry(url: str, query: str, max_retries: int = 3,
                         retry_delay: float = 20.0) -> dict:
    """Call chat endpoint. If we get the rate-limit busy message, wait + retry."""
    for attempt in range(max_retries + 1):
        result = call_chat(url, query)
        answer = (result.get("response", {}).get("answer") or "").lower()
        if BUSY_MARKER not in answer:
            return result
        if attempt < max_retries:
            wait = retry_delay * (attempt + 1)   # 20s, 40s, 60s
            print(f"\n      [rate-limited; retry {attempt+1}/{max_retries} after {wait:.0f}s]",
                  end="", flush=True)
            time.sleep(wait)
    return result   # last attempt's result, busy or not


def normalize(s: str) -> str:
    return (s or "").lower().strip()


def evaluate_query(q: dict, api_resp: dict) -> dict:
    """Decide pass/fail for one query."""
    expected = [normalize(d) for d in q.get("expected_department", [])]
    returned_dept = normalize(api_resp.get("response", {}).get("department"))
    answer_text   = normalize(api_resp.get("response", {}).get("answer"))
    needs_context = bool(api_resp.get("response", {}).get("needsContext"))
    category      = q.get("category", "")

    # Special handling for ambiguous / out-of-scope categories
    if category == "ambiguous":
        passed = needs_context  # passes if system asks for clarification
        reason = "ambiguous: passes if needsContext=True"
    elif category == "out-of-scope":
        # OOS passes if NO department is confidently returned, OR if needsContext
        passed = (not returned_dept) or needs_context
        reason = "oos: passes if no confident dept OR clarification asked"
    elif not expected:
        # No expected dept and no special category → treat as informational
        passed = True
        reason = "no expected (informational)"
    else:
        # Standard match: returned dept must contain ANY expected dept substring
        # OR answer text must contain it
        dept_match = any(exp in returned_dept for exp in expected)
        text_match = any(exp in answer_text for exp in expected)
        passed = dept_match or text_match
        reason = f"dept_match={dept_match}, text_match={text_match}"

    return {
        "passed": passed,
        "reason": reason,
        "returned_dept": api_resp.get("response", {}).get("department"),
        "needs_context": needs_context,
        "answer_preview": (api_resp.get("response", {}).get("answer") or "")[:150],
    }


def run_tests(url: str, only_ids: list = None,
              delay_s: float = 4.5, max_retries: int = 3) -> dict:
    test_data = json.loads(TEST_FILE.read_text(encoding="utf-8"))
    queries = test_data["queries"]
    if only_ids:
        queries = [q for q in queries if q["id"] in only_ids]

    print(f"\n{'='*70}")
    print(f"  RAG Test Suite - {len(queries)} queries -> {url}")
    print(f"  Per-query delay: {delay_s}s  |  retries on rate-limit: {max_retries}")
    print(f"{'='*70}\n")

    results = []
    for i, q in enumerate(queries, 1):
        if i > 1:
            time.sleep(delay_s)
        print(f"[{i:>2}/{len(queries)}] {q['id']} - {q['query'][:60]}...", end=" ", flush=True)
        api_resp = call_chat_with_retry(url, q["query"], max_retries=max_retries)
        verdict = evaluate_query(q, api_resp)
        result = {
            **q,
            "api_ok":         api_resp["ok"],
            "api_status":     api_resp["status"],
            "latency_s":      api_resp["latency_s"],
            "error":          api_resp.get("error"),
            "passed":         verdict["passed"],
            "verdict_reason": verdict["reason"],
            "returned_dept":  verdict["returned_dept"],
            "needs_context":  verdict["needs_context"],
            "answer_preview": verdict["answer_preview"],
            "rewritten":      api_resp.get("response", {}).get("rewritten"),
        }
        results.append(result)
        mark = "[PASS]" if verdict["passed"] else "[FAIL]"
        print(f"{mark}  ({api_resp['latency_s']:.2f}s)")

    return {"meta": test_data.get("description", ""), "results": results}


def summarise(results_block: dict) -> dict:
    rs = results_block["results"]
    total      = len(rs)
    passed     = sum(1 for r in rs if r["passed"])
    api_ok     = sum(1 for r in rs if r["api_ok"])
    latencies  = [r["latency_s"] for r in rs if r["api_ok"]]

    # Per-category and per-difficulty breakdown
    def group_stats(key):
        groups = {}
        for r in rs:
            k = r.get(key) or "(none)"
            groups.setdefault(k, []).append(r)
        return {
            k: {
                "total":  len(v),
                "passed": sum(1 for r in v if r["passed"]),
                "rate":   round(100 * sum(1 for r in v if r["passed"]) / len(v), 1),
            }
            for k, v in sorted(groups.items())
        }

    summary = {
        "total_queries":    total,
        "api_ok":           api_ok,
        "api_errors":       total - api_ok,
        "passed":           passed,
        "failed":           total - passed,
        "pass_rate":        round(100 * passed / total, 1) if total else 0,
        "latency_mean_s":   round(statistics.mean(latencies), 2) if latencies else None,
        "latency_median_s": round(statistics.median(latencies), 2) if latencies else None,
        "latency_p95_s":    round(statistics.quantiles(latencies, n=20)[-1], 2) if len(latencies) > 5 else None,
        "latency_max_s":    round(max(latencies), 2) if latencies else None,
        "by_category":      group_stats("category"),
        "by_difficulty":    group_stats("difficulty"),
        "by_language":      group_stats("language"),
    }
    return summary


def write_outputs(results_block: dict, summary: dict, out_stem: Path):
    # JSON (full)
    out_json = out_stem.with_suffix(".json")
    out_json.write_text(json.dumps({
        "summary": summary,
        "results": results_block["results"],
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    # CSV (flat per-query)
    out_csv = out_stem.with_suffix(".csv")
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "category", "difficulty", "language",
                    "passed", "latency_s",
                    "query", "expected_departments",
                    "returned_dept", "needs_context",
                    "rewritten", "answer_preview", "verdict_reason"])
        for r in results_block["results"]:
            w.writerow([
                r["id"], r["category"], r["difficulty"], r["language"],
                "PASS" if r["passed"] else "FAIL", r["latency_s"],
                r["query"], "; ".join(r.get("expected_department", []) or []),
                r["returned_dept"] or "", r["needs_context"],
                r["rewritten"] or "", r["answer_preview"], r["verdict_reason"]
            ])

    # Markdown summary
    out_md = out_stem.with_suffix(".md")
    lines = [
        f"# RAG Test Results — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        f"**Total queries:** {summary['total_queries']}",
        f"**Pass rate:** {summary['pass_rate']}% ({summary['passed']}/{summary['total_queries']})",
        f"**API errors:** {summary['api_errors']}",
        "",
        "## Latency",
        "",
        f"- Mean:    {summary['latency_mean_s']} s",
        f"- Median:  {summary['latency_median_s']} s",
        f"- p95:     {summary['latency_p95_s']} s" if summary['latency_p95_s'] else "- p95:     (insufficient samples)",
        f"- Max:     {summary['latency_max_s']} s",
        "",
        "## Pass rate by category",
        "",
        "| Category | Total | Passed | Rate |",
        "|---|---|---|---|",
    ]
    for k, v in summary["by_category"].items():
        lines.append(f"| {k} | {v['total']} | {v['passed']} | {v['rate']}% |")
    lines += [
        "",
        "## Pass rate by difficulty",
        "",
        "| Difficulty | Total | Passed | Rate |",
        "|---|---|---|---|",
    ]
    for k, v in summary["by_difficulty"].items():
        lines.append(f"| {k} | {v['total']} | {v['passed']} | {v['rate']}% |")
    lines += [
        "",
        "## Pass rate by language",
        "",
        "| Language | Total | Passed | Rate |",
        "|---|---|---|---|",
    ]
    for k, v in summary["by_language"].items():
        lines.append(f"| {k} | {v['total']} | {v['passed']} | {v['rate']}% |")

    lines += [
        "",
        "## Failed queries (need attention)",
        "",
    ]
    fails = [r for r in results_block["results"] if not r["passed"]]
    if not fails:
        lines.append("_No failures — all queries passed!_")
    else:
        for r in fails:
            lines.append(f"### {r['id']} — `{r['query']}`")
            lines.append(f"- **Expected:** {', '.join(r.get('expected_department', []) or ['(any)'])}")
            lines.append(f"- **Returned dept:** {r['returned_dept'] or '(none)'}")
            lines.append(f"- **Needs context:** {r['needs_context']}")
            lines.append(f"- **Reason:** {r['verdict_reason']}")
            lines.append(f"- **Answer preview:** {r['answer_preview']}")
            lines.append(f"- **Latency:** {r['latency_s']}s")
            lines.append("")

    out_md.write_text("\n".join(lines), encoding="utf-8")

    print(f"\n{'='*70}")
    print(f"  Outputs written:")
    print(f"   {out_json}")
    print(f"   {out_csv}")
    print(f"   {out_md}")
    print(f"{'='*70}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://localhost:3001",
                    help="Base URL of the wayfinding server (default: %(default)s)")
    ap.add_argument("--queries", nargs="*",
                    help="Only run specific query IDs (e.g., Q01 Q05)")
    ap.add_argument("--delay", type=float, default=7.0,
                    help="Seconds between queries (default 7.0 for Gemini 10 RPM)")
    ap.add_argument("--retries", type=int, default=3,
                    help="Retry attempts when rate-limited (default 3)")
    args = ap.parse_args()

    results_block = run_tests(args.url, only_ids=args.queries,
                              delay_s=args.delay, max_retries=args.retries)
    summary = summarise(results_block)

    print("\n" + "="*70)
    print("  SUMMARY")
    print("="*70)
    print(f"  Pass rate:    {summary['pass_rate']}% ({summary['passed']}/{summary['total_queries']})")
    print(f"  API errors:   {summary['api_errors']}")
    print(f"  Mean latency: {summary['latency_mean_s']}s  |  p95: {summary['latency_p95_s']}s")
    print()
    print("  By difficulty:")
    for k, v in summary["by_difficulty"].items():
        print(f"    {k:<8} {v['passed']}/{v['total']} ({v['rate']}%)")
    print()
    print("  By language:")
    for k, v in summary["by_language"].items():
        print(f"    {k:<12} {v['passed']}/{v['total']} ({v['rate']}%)")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_stem = ROOT / f"results_{ts}"
    write_outputs(results_block, summary, out_stem)


if __name__ == "__main__":
    main()
