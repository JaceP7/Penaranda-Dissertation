"""End-to-end health check for the deployed Geo-Agentic RAG stack.

Probes every link in the chain and prints a PASS/FAIL table, so an outage is
diagnosed in one command instead of guesswork:

    site  ->  /api/ping  ->  /api/chat (Upstash Vector + Groq)
                          ->  /api/analytics (Upstash Redis)
                          ->  /api/mapstate (Upstash Redis)

Optionally also probes the Upstash Vector index directly (vector count), when
UPSTASH_VECTOR_REST_URL / _TOKEN are set in the environment.

USAGE:
    python tools/verify_stack.py
    python tools/verify_stack.py --url https://your-deployment.vercel.app

Exit code 0 = everything healthy, 1 = at least one check failed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://penaranda-dissertation.vercel.app"
TIMEOUT = 45

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" - {detail}" if detail else ""))
    return ok


def _req(url, method="GET", payload=None, headers=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read().decode("utf-8", "replace")
        return r.status, raw


def check_site(base):
    try:
        status, _ = _req(base + "/")
        return record("site reachable", status == 200, f"HTTP {status}")
    except Exception as e:
        return record("site reachable", False, str(e)[:120])


def check_ping(base):
    try:
        status, raw = _req(base + "/api/ping")
        d = json.loads(raw)
        ok = status == 200 and d.get("ok")
        return record("/api/ping", ok,
                      f"GROQ key present: {d.get('hasKey')}, node {d.get('node','?')}")
    except Exception as e:
        return record("/api/ping", False, str(e)[:120])


def check_chat(base):
    """The full RAG path: Upstash Vector retrieval + Groq generation."""
    try:
        t0 = time.time()
        status, raw = _req(base + "/api/chat", "POST",
                           {"query": "How do I get a business permit?", "history": []})
        dt = round(time.time() - t0, 1)
        d = json.loads(raw)
        if d.get("error"):
            return record("/api/chat (RAG)", False,
                          f"{d.get('error')}: {str(d.get('detail'))[:90]}")
        answer = (d.get("answer") or "").strip()
        dept = d.get("department")
        ok = status == 200 and len(answer) > 40
        return record("/api/chat (RAG)", ok,
                      f"{dt}s, dept={dept!r}, answer {len(answer)} chars")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:140]
        return record("/api/chat (RAG)", False, f"HTTP {e.code}: {body}")
    except Exception as e:
        return record("/api/chat (RAG)", False, str(e)[:120])


def check_note_endpoint(base, path, label):
    """analytics / mapstate return 200 with a `_note` when Redis is unreachable."""
    try:
        status, raw = _req(base + path)
        d = json.loads(raw)
        note = d.get("_note")
        if note and ("failed" in note.lower() or "not configured" in note.lower()):
            return record(label, False, note[:110])
        return record(label, status == 200, "Redis reachable")
    except Exception as e:
        return record(label, False, str(e)[:120])


def check_vector_direct():
    url = os.environ.get("UPSTASH_VECTOR_REST_URL", "").rstrip("/")
    token = os.environ.get("UPSTASH_VECTOR_REST_TOKEN", "")
    if not url or not token:
        print("  [skip] Upstash Vector direct probe (env vars not set locally)")
        return True
    try:
        status, raw = _req(url + "/info", "GET", None, {"Authorization": f"Bearer {token}"})
        d = json.loads(raw)
        res = d.get("result", d)
        count = res.get("vectorCount", res.get("pendingVectorCount", "?"))
        dim = res.get("dimension", "?")
        ok = isinstance(count, int) and count > 0
        return record("Upstash Vector index", ok,
                      f"{count} vectors, dim={dim} (expect 235)")
    except Exception as e:
        return record("Upstash Vector index", False, str(e)[:120])


def main():
    base = DEFAULT_URL
    if "--url" in sys.argv:
        base = sys.argv[sys.argv.index("--url") + 1].rstrip("/")

    print(f"\nVerifying stack at {base}\n" + "-" * 62)
    check_site(base)
    check_ping(base)
    check_vector_direct()
    check_chat(base)
    check_note_endpoint(base, "/api/analytics", "/api/analytics (Redis)")
    check_note_endpoint(base, "/api/mapstate", "/api/mapstate (Redis)")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("-" * 62)
    print(f"  {passed}/{total} checks passed")
    if passed < total:
        print("\n  Failing components:")
        for name, ok, detail in results:
            if not ok:
                print(f"    - {name}: {detail}")
        print("\n  If Vector/Redis fail: the Upstash databases are likely gone.")
        print("  Recreate them, update the Vercel env vars, then run:")
        print("     python tools/upstash_seed.py")
    print()
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
