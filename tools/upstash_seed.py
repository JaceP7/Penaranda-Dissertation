"""Seed an Upstash Vector index with the 235 Calamba City services.

The index must be created with the built-in embedding model BAAI/bge-m3
(multilingual, 1024-dim) so Upstash embeds both the upserted text and queries
server-side. We upsert a CONCISE identity string as the embedded `data`
(mirroring the local build_index.py concise-identity approach that recovered
retrieval precision), and carry the full requirements/steps in `metadata` so
the serverless chat can ground its answer.

USAGE (PowerShell):
    $env:UPSTASH_VECTOR_REST_URL   = "https://....upstash.io"
    $env:UPSTASH_VECTOR_REST_TOKEN = "....."
    python tools/upstash_seed.py

USAGE (bash):
    UPSTASH_VECTOR_REST_URL=... UPSTASH_VECTOR_REST_TOKEN=... python tools/upstash_seed.py

Re-running is safe: upserts overwrite by id (source_id). Pass --reset to clear
the index first.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICES = os.path.join(ROOT, "wayfinding-app", "data", "services.json")

URL   = os.environ.get("UPSTASH_VECTOR_REST_URL", "").rstrip("/")
TOKEN = os.environ.get("UPSTASH_VECTOR_REST_TOKEN", "")

if not URL or not TOKEN:
    print("ERROR: set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN env vars.",
          file=sys.stderr)
    sys.exit(1)


def _post(path, payload):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(URL + path, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}", file=sys.stderr)
        raise


def concise_identity(s):
    """Short, retrieval-friendly text — what gets embedded by bge-m3."""
    who = (s.get("who_may_avail") or "")[:200]
    return (f"{s.get('subservice','')}. "
            f"Department: {s.get('department','')}. "
            f"Category: {s.get('service','')}. "
            f"Who may avail: {who}")


def main():
    if "--reset" in sys.argv:
        print("Resetting index (deleting all vectors)…")
        try:
            _post("/reset", {})
            print("  reset done.")
        except Exception:
            print("  reset failed (continuing).")

    services = json.load(open(SERVICES, encoding="utf-8"))
    print(f"Loaded {len(services)} services from services.json")

    # Build records. Keep metadata compact — requirements as a list of
    # {requirement, where_to_secure}; steps as a list of strings.
    records = []
    for s in services:
        sid = str(s.get("source_id") or "")
        if not sid:
            continue
        reqs = []
        for r in (s.get("requirements") or [])[:25]:
            reqs.append({
                "requirement":     (r.get("requirement") or "")[:300],
                "where_to_secure": (r.get("where_to_secure") or "")[:200],
            })
        meta = {
            "service":             s.get("service", ""),
            "subservice":          s.get("subservice", ""),
            "department":          s.get("department", ""),
            "source_id":           sid,
            "source_url":          s.get("source_url", ""),
            "classification":      s.get("classification", ""),
            "type_of_transaction": s.get("type_of_transaction", ""),
            "who_may_avail":       (s.get("who_may_avail") or "")[:600],
            "requirements":        reqs,
            "steps":               [str(x)[:400] for x in (s.get("steps") or [])[:15]],
        }
        records.append({"id": sid, "data": concise_identity(s), "metadata": meta})

    # Upsert in batches (Upstash accepts an array body).
    BATCH = 25
    ok = 0
    for i in range(0, len(records), BATCH):
        chunk = records[i:i + BATCH]
        _post("/upsert-data", chunk)
        ok += len(chunk)
        print(f"  upserted {ok}/{len(records)}")
        time.sleep(0.2)

    # Report index info
    try:
        info = _post("/info", {})
        print("\nIndex info:", json.dumps(info.get("result", info))[:300])
    except Exception:
        pass
    print(f"\nDone. Seeded {ok} services into Upstash Vector.")
    print("Next: set the same UPSTASH_VECTOR_REST_URL/TOKEN as Vercel env vars and redeploy.")


if __name__ == "__main__":
    main()
