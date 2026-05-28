"""
Rebuild services.json from the official Calamba City Citizen's Charter.

Source:
  1. Listing pages (services raw/*.js)  -> service name, department, createservicesId
  2. Detail pages (calambacity.gov.ph/Users/Home/ViewServicesPage?createservicesId=N)
     -> classification, type of transaction, who may avail, CHECKLIST OF REQUIREMENTS,
        PROCESS FLOW (client steps / fees / processing time)

Output:
  wayfinding-app/data/services.json   (enriched: adds requirements + metadata)
  services_html/<id>.html             (cached raw detail pages — resumable)

Usage:
  python build_corpus_from_charter.py            # fetch missing + rebuild
  python build_corpus_from_charter.py --reparse  # skip fetch, reparse cached HTML only
"""

import argparse
import glob
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

ROOT       = Path(__file__).resolve().parent
RAW_DIR    = ROOT / "services raw"
HTML_CACHE = ROOT / "services_html"
OUT_JSON   = ROOT / "wayfinding-app" / "data" / "services.json"
BASE_URL   = "https://calambacity.gov.ph/Users/Home/ViewServicesPage?createservicesId="

HTML_CACHE.mkdir(exist_ok=True)

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

_WS = re.compile(r"\s+")


def clean(s: str) -> str:
    return _WS.sub(" ", (s or "")).strip()


# ── 1. Parse listing files ────────────────────────────────────────────────────

def parse_listings() -> list[dict]:
    """Return [{category, subservice, department, source_id}] from services raw/*.js."""
    rows = []
    for f in sorted(glob.glob(str(RAW_DIR / "*.js"))):
        category = re.sub(r"^\d+\s*", "", os.path.basename(f).replace(".js", "")).strip()
        soup = BeautifulSoup(open(f, encoding="utf-8").read(), "lxml")
        for tr in soup.select("table#servicesTable tbody tr"):
            tds = tr.find_all("td")
            if len(tds) < 3:
                continue
            link = tr.find("a", class_="view-link")
            if not link or "createservicesId=" not in (link.get("href") or ""):
                continue
            sid = re.search(r"createservicesId=(\d+)", link["href"]).group(1)
            rows.append({
                "category":   category,
                "subservice": clean(tds[0].get_text()),
                "department": clean(tds[1].get_text()),
                "source_id":  sid,
            })
    return rows


# ── 2. Fetch detail pages (cached) ────────────────────────────────────────────

def fetch_detail(sid: str, delay: float = 0.3, retries: int = 2) -> str | None:
    cache = HTML_CACHE / f"{sid}.html"
    if cache.exists() and cache.stat().st_size > 500:
        return cache.read_text(encoding="utf-8", errors="replace")
    url = BASE_URL + sid
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            html = urllib.request.urlopen(req, context=_CTX, timeout=30).read().decode("utf-8", "replace")
            cache.write_text(html, encoding="utf-8")
            time.sleep(delay)
            return html
        except Exception as e:
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
            else:
                print(f"    [fetch failed id={sid}: {e}]")
                return None


# ── 3. Parse a detail page ────────────────────────────────────────────────────

def _find_table_after(soup, header_keywords):
    """Find the first <table> appearing after an <h6>/<h5> whose text contains a keyword."""
    for hdr in soup.find_all(["h5", "h6"]):
        txt = clean(hdr.get_text()).upper()
        if any(k.upper() in txt for k in header_keywords):
            tbl = hdr.find_next("table")
            if tbl:
                return tbl
    return None


def parse_detail(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    out = {
        "title": "", "classification": "", "type_of_transaction": "",
        "who_may_avail": "", "office_division": "",
        "requirements": [], "steps": [],
    }

    # Title
    h5 = soup.find("h5", class_="section-title")
    if h5:
        out["title"] = clean(h5.get_text())

    # Info table — th label / td value pairs
    info_map = {
        "office or division": "office_division",
        "classification": "classification",
        "type of transaction": "type_of_transaction",
        "who may avail": "who_may_avail",
    }
    for tr in soup.find_all("tr"):
        th, td = tr.find("th"), tr.find("td")
        if th and td:
            label = clean(th.get_text()).rstrip(":").lower()
            for key, field in info_map.items():
                if key in label and not out[field]:
                    out[field] = clean(td.get_text())

    # Requirements table (CHECKLIST OF REQUIREMENTS)
    req_tbl = _find_table_after(soup, ["CHECKLIST OF REQUIREMENTS"])
    if req_tbl:
        for tr in req_tbl.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) >= 2:
                requirement = clean(tds[0].get_text())
                where = clean(tds[1].get_text())
                # skip header-ish/empty rows
                if requirement and requirement.upper() != "CHECKLIST OF REQUIREMENTS":
                    out["requirements"].append({
                        "requirement": requirement,
                        "where_to_secure": where,
                    })

    # Process flow -> client steps (first column)
    proc_tbl = _find_table_after(soup, ["PROCESS FLOW"])
    if proc_tbl:
        body_rows = proc_tbl.find_all("tr")
        for tr in body_rows:
            tds = tr.find_all("td")
            if not tds:
                continue
            step_text = clean(tds[0].get_text())
            if step_text and "TOTAL" not in step_text.upper() and len(step_text) > 3:
                # include fee/time if present (last cols)
                extra = ""
                if len(tds) >= 4:
                    fee = clean(tds[-3].get_text())
                    tim = clean(tds[-1].get_text()) if len(tds) >= 5 else clean(tds[-1].get_text())
                out["steps"].append(step_text)

    return out


# ── 4. Build enriched corpus ──────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reparse", action="store_true", help="Skip fetching; reparse cached HTML")
    ap.add_argument("--delay", type=float, default=0.3)
    args = ap.parse_args()

    listings = parse_listings()
    print(f"Parsed {len(listings)} service rows from {len(glob.glob(str(RAW_DIR/'*.js')))} listing files")

    # Dedupe by source_id (keep first category seen)
    seen, unique = set(), []
    for row in listings:
        if row["source_id"] in seen:
            continue
        seen.add(row["source_id"])
        unique.append(row)
    print(f"Unique services (by id): {len(unique)}")

    enriched = []
    n_req, n_fail = 0, 0
    for i, row in enumerate(unique, 1):
        sid = row["source_id"]
        html = fetch_detail(sid, delay=args.delay) if not args.reparse else (
            (HTML_CACHE / f"{sid}.html").read_text(encoding="utf-8", errors="replace")
            if (HTML_CACHE / f"{sid}.html").exists() else None
        )
        if not html:
            n_fail += 1
            # still keep the listing-level entry (no details)
            enriched.append({
                "service": row["category"], "subservice": row["subservice"],
                "department": row["department"], "source_id": sid,
                "source_url": BASE_URL + sid,
                "classification": "", "type_of_transaction": "", "who_may_avail": "",
                "requirements": [], "steps": [],
            })
            continue
        d = parse_detail(html)
        # Prefer the detail-page title for subservice if present, else listing name
        subservice = d["title"] or row["subservice"]
        entry = {
            "service":             row["category"],
            "subservice":          subservice,
            "department":          row["department"],
            "source_id":           sid,
            "source_url":          BASE_URL + sid,
            "classification":      d["classification"],
            "type_of_transaction": d["type_of_transaction"],
            "who_may_avail":       d["who_may_avail"],
            "requirements":        d["requirements"],
            "steps":               d["steps"],
        }
        if d["requirements"]:
            n_req += 1
        enriched.append(entry)
        if i % 25 == 0 or i == len(unique):
            print(f"  [{i}/{len(unique)}] processed  (with requirements: {n_req}, failed: {n_fail})")

    # Write
    OUT_JSON.write_text(json.dumps(enriched, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(enriched)} services -> {OUT_JSON}")
    print(f"  with requirements: {n_req}")
    print(f"  with steps:        {sum(1 for e in enriched if e['steps'])}")
    print(f"  fetch failures:    {n_fail}")


if __name__ == "__main__":
    main()
