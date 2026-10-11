"""Date filtering and CSV export in the LOCAL dev server (serve_https.py).

serve_https.py binds its port at import time, so the analytics helpers are
lifted out with ast and executed in a clean namespace instead.

Run:  python tools/test_analytics_range_local.py .
"""
import ast
import csv
import io
import json
import os
import re
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
SRC = os.path.join(ROOT, "wayfinding-app", "serve_https.py")

WANT = {"_read_log", "_in_range", "_clean_range", "_analytics_csv", "_get_analytics"}

tree = ast.parse(io.open(SRC, encoding="utf-8").read())
picked = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANT]
missing = WANT - {n.name for n in picked}
if missing:
    sys.exit(f"could not find in serve_https.py: {sorted(missing)}")

log_fd, LOG_PATH = tempfile.mkstemp(suffix=".jsonl")
os.close(log_fd)

ns = {
    "json": json, "csv": csv, "io": io, "re": re,
    "datetime": datetime, "timedelta": timedelta, "timezone": timezone,
    "defaultdict": defaultdict,
    "DATE_RE": re.compile(r"^\d{4}-\d{2}-\d{2}$"),
    "QUERY_LOG": LOG_PATH,
}
exec(compile(ast.Module(body=picked, type_ignores=[]), SRC, "exec"), ns)

ENTRIES = [
    {"timestamp": "2026-09-20T09:00:00+00:00", "query": "old one",             "department": "BPLO",           "subservice": "Renewal",    "needsContext": False, "latency_ms": 1000},
    {"timestamp": "2026-10-01T09:00:00+00:00", "query": 'saan po ang "office"?', "department": None,            "subservice": None,         "needsContext": True,  "latency_ms": 700},
    {"timestamp": "2026-10-05T09:00:00+00:00", "query": "birth certificate",    "department": "CIVIL REGISTRY", "subservice": "Birth cert", "needsContext": False, "latency_ms": 800},
    {"timestamp": "2026-10-05T10:00:00+00:00", "query": "cedula, magkano po?",  "department": "TREASURY",       "subservice": "Cedula",     "needsContext": False, "latency_ms": 1100},
    {"timestamp": "2026-10-10T09:00:00+00:00", "query": "business permit",      "department": "BPLO",           "subservice": "New permit", "needsContext": False, "latency_ms": 900},
]
with io.open(LOG_PATH, "w", encoding="utf-8") as f:
    for e in ENTRIES:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")

_pass = _fail = 0


def ok(name, cond, extra=""):
    global _pass, _fail
    if cond:
        _pass += 1
        print("  PASS  " + name)
    else:
        _fail += 1
        print("  FAIL  " + name + (f"  -> {extra}" if extra else ""))


print("\n--- serve_https.py: date range + CSV (temp log) ---")

a = ns["_get_analytics"]()
ok("no range returns every entry", a["total"] == 5, a["total"])
ok("no range reports applied:false", a["range"]["applied"] is False)
ok("all-time per-day series is 7 days", len(a["queriesPerDay"]) == 7)

a = ns["_get_analytics"]("2026-10-01", "2026-10-10")
ok("range filters out the September entry", a["total"] == 4, a["total"])
ok("range is echoed back", a["range"] == {"from": "2026-10-01", "to": "2026-10-10", "applied": True})
ok("per-day series spans the window", len(a["queriesPerDay"]) == 10, len(a["queriesPerDay"]))
ok("per-day counts land on the right dates",
   next(d for d in a["queriesPerDay"] if d["date"] == "2026-10-05")["count"] == 2)
ok("avg latency is over the filtered rows only", a["avgLatency"] == 875.0, a["avgLatency"])
ok("ambiguity rate counts the clarification row", a["ambiguityRate"] == 25.0, a["ambiguityRate"])

a = ns["_get_analytics"]("2026-10-05", "2026-10-05")
ok("single-day range works", a["total"] == 2, a["total"])

a = ns["_get_analytics"]("2026-10-10", "2026-10-01")
ok("a reversed range is swapped, not emptied", a["total"] == 4, a["total"])

a = ns["_get_analytics"]("garbage", "")
ok("a malformed date is ignored rather than fatal",
   a["total"] == 5 and a["range"]["applied"] is False)

a = ns["_get_analytics"]("2026-01-01", "2026-01-02")
ok("an empty window returns zero without raising", a["total"] == 0)
ok("an empty window still returns a per-day series", len(a["queriesPerDay"]) == 2,
   len(a["queriesPerDay"]))

text = ns["_analytics_csv"]()
lines = text.strip().split("\r\n")
ok("CSV has a header plus one row per entry", len(lines) == 6, len(lines))
ok("CSV header names the columns",
   lines[0] == "timestamp_utc,date,query,rewritten,department,subservice,needs_context,latency_ms",
   lines[0])
ok("CSV is oldest-first", "2026-09-20" in lines[1], lines[1])
ok("CSV quotes a field containing a comma", '"cedula, magkano po?"' in text)
ok("CSV doubles embedded quotes", 'saan po ang ""office""?' in text)
ok("CSV renders booleans as yes/no", ",yes," in text and ",no," in text)

text = ns["_analytics_csv"]("2026-10-05", "2026-10-05")
ok("CSV honours the date range", len(text.strip().split("\r\n")) == 3)

# A real read-back, so the quoting is proven against a parser and not a regex.
parsed = list(csv.reader(io.StringIO(ns["_analytics_csv"]())))
ok("CSV round-trips through a parser", len(parsed) == 6, len(parsed))
ok("every row has 8 columns", all(len(r) == 8 for r in parsed),
   [len(r) for r in parsed])
ok("the comma-bearing query survives the round trip",
   any(r[2] == "cedula, magkano po?" for r in parsed))
ok("the quote-bearing query survives the round trip",
   any(r[2] == 'saan po ang "office"?' for r in parsed))

os.unlink(LOG_PATH)
print(f"\n{_pass} passed, {_fail} failed")
sys.exit(1 if _fail else 0)
