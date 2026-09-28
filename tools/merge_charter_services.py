"""Merge PDF-parsed charter services into wayfinding-app/data/services.json.

The six offices absent from the online catalogue (City Civil Registry, City
Treasury, Agricultural, Budget, Housing, Legislative) are parsed out of the
official per-office PDF charters by tools/parse_charter_pdfs.py. This merges
that output into the corpus using the canonical 10-key schema.

New rows get source_id 1001+ (the web-scraped rows occupy 1-235) and a
source_url that cites the exact PDF page, so every added service is traceable
back to the published Citizen's Charter.

USAGE:
    python tools/merge_charter_services.py <parsed.json> [--dry-run]
"""
import argparse
import json
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "wayfinding-app" / "data" / "services.json"
PDF_BASE = "https://www.calambacity.gov.ph/maincss/assets/citizencharter/"

# department -> source PDF filename stem
PDF_FOR_DEPT = {
    "CITY CIVIL REGISTRY OFFICE": "city_civil_registry_office",
    "CITY TREASURY MANAGEMENT OFFICE": "city_treasury_management_office",
    "CITY AGRICULTURAL SERVICES DEPARTMENT": "city_agricultural_services_office",
    "CITY BUDGET MANAGEMENT OFFICE": "city_budget_management_office",
    "HOUSING AND SETTLEMENTS DEPARTMENT": "housing_and_settlements_department",
    "LEGISLATIVE SERVICES OFFICE": "legislative_services_office",
}

CANONICAL = ["service", "subservice", "department", "source_id", "source_url",
             "classification", "type_of_transaction", "who_may_avail",
             "requirements", "steps"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("parsed")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    parsed = json.loads(Path(args.parsed).read_text(encoding="utf-8"))

    existing_ids = {str(s.get("source_id")) for s in corpus}
    have = {(s.get("department", ""), s.get("subservice", "")) for s in corpus}

    next_id, added, skipped = 1001, [], 0
    for p in parsed:
        key = (p.get("department", ""), p.get("subservice", ""))
        if key in have:
            skipped += 1
            continue
        while str(next_id) in existing_ids:
            next_id += 1
        stem = PDF_FOR_DEPT.get(p["department"], "")
        row = {
            "service": p.get("service", ""),
            "subservice": p.get("subservice", ""),
            "department": p.get("department", ""),
            "source_id": str(next_id),
            "source_url": f"{PDF_BASE}{stem}.pdf#page={p.get('_page', 1)}" if stem else "",
            "classification": p.get("classification", ""),
            "type_of_transaction": p.get("type_of_transaction", ""),
            "who_may_avail": p.get("who_may_avail", ""),
            "requirements": p.get("requirements", []),
            "steps": p.get("steps", []),
        }
        added.append({k: row[k] for k in CANONICAL})
        existing_ids.add(str(next_id))
        next_id += 1

    merged = corpus + added
    depts = sorted({s.get("department", "") for s in merged if s.get("department")})

    print(f"existing corpus : {len(corpus)}")
    print(f"parsed rows     : {len(parsed)}  (skipped as duplicate: {skipped})")
    print(f"added           : {len(added)}")
    print(f"MERGED TOTAL    : {len(merged)}")
    print(f"departments     : {len(depts)}")
    for d in depts:
        n = sum(1 for s in merged if s.get("department") == d)
        mark = "  <-- NEW" if d in PDF_FOR_DEPT else ""
        print(f"    {n:>4}  {d}{mark}")

    if args.dry_run:
        print("\n(dry run - nothing written)")
        return

    bak = CORPUS.with_suffix(f".json.bak_pre_merge_{date.today():%Y%m%d}")
    if not bak.exists():
        shutil.copy2(CORPUS, bak)
        print(f"\nbackup -> {bak.name}")
    CORPUS.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {CORPUS} ({len(merged)} services)")


if __name__ == "__main__":
    main()
