"""Parse the City of Calamba per-office Citizen's Charter PDFs into services.json rows.

Why: the online charter catalogue (Users/Home/serviceslist) is JavaScript-rendered
and only exposes 235 services across 25 offices. Six offices publish NO services
there - including City Civil Registry and City Treasury, the two busiest. Their
services exist only in the official per-office PDF charters (2025 1st Edition),
linked from /Users/Home/CitizenCharter.

Each service in those PDFs is a block anchored by an "Office or Division" label,
followed by a 2-column requirements table and a 5-column client-steps table.
Columns are recovered from word x-positions (line order alone interleaves them).

USAGE:
    python tools/parse_charter_pdfs.py <pdf-dir> [--json out.json] [--show N]
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import fitz  # PyMuPDF

# Column boundaries (points). Requirement text runs ~68-220; "where to secure"
# consistently starts at ~293. CLIENT STEPS runs 68-141; AGENCY ACTIONS starts at 167.
REQ_SPLIT_X = 260
STEP_MAX_X = 160

FIELDS = ["Office or Division", "Classification", "Type of Transaction", "Who may avail"]
STOP = FIELDS + ["CHECKLIST OF REQUIREMENTS", "CLIENT STEPS", "WHERE TO SECURE", "Total"]

CATEGORY_RULES = [
    (r"birth|marriage|death|civil registry|certified true cop|certificat|clearance|permit",
     "Certificates, Permits, and IDs"),
    (r"tax|assessment|real property|collection|payment|billing|fees", "Tax"),
    (r"business|trade|franchis", "Business and Trade"),
    (r"health|medical|medicine|patient|clinic", "Health"),
    (r"social|assistance|solo parent|pwd|senior|indigen|burial|financial aid", "Social Services"),
    (r"training|seminar|scholarship|education|orientation", "Education, Training, Seminars, and Competencies"),
    (r"employment|job|worker", "Employment"),
    (r"animal|veterinary|livestock|slaughter", "Veterinary Services"),
    (r"disaster|calamity|weather|emergency", "Disaster and Weather"),
]


def categorise(title):
    t = (title or "").lower()
    for pat, cat in CATEGORY_RULES:
        if re.search(pat, t):
            return cat
    return "Registrations, Applications, Ordinances, and Others"


def doc_rows(doc):
    """Flatten the PDF into ordered rows: (page, y, [words sorted by x])."""
    out = []
    for pno in range(doc.page_count):
        buckets = defaultdict(list)
        for w in doc[pno].get_text("words"):
            buckets[round(w[1] / 3.0) * 3].append(w)
        for y in sorted(buckets):
            out.append((pno, y, sorted(buckets[y], key=lambda a: a[0])))
    return out


def row_text(words, xmin=-1e9, xmax=1e9):
    return " ".join(w[4] for w in words if xmin <= w[0] < xmax).strip()


def clean(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    return re.sub(r"^[:\s]+", "", s).strip()


def parse_pdf(path, department):
    doc = fitz.open(path)
    rows = doc_rows(doc)
    texts = [row_text(r[2]) for r in rows]

    # Service blocks are anchored by the "Office or Division" label.
    anchors = [i for i, t in enumerate(texts) if re.match(r"^Office\s*or\s*Division", t, re.I)]
    services = []

    for n, a in enumerate(anchors):
        end = anchors[n + 1] - 1 if n + 1 < len(anchors) else len(rows)

        # Title: nearest numbered heading above the anchor (may wrap onto 2 lines).
        title, start, desc_lines = "", max(0, a - 8), []
        for j in range(a - 1, start - 1, -1):
            m = re.match(r"^(\d{1,2})[.)]\s+(.{8,})$", texts[j])
            if m:
                title = m.group(2)
                for k in range(j + 1, a):          # absorb wrapped continuation
                    t = texts[k]
                    if not t or re.match(r"^(%s)" % "|".join(STOP), t, re.I):
                        continue
                    # these PDFs often repeat the heading verbatim on the next line
                    if t.strip().lower() in title.strip().lower():
                        continue
                    # a descriptive paragraph follows some headings - that is not
                    # part of the title. Keep it separately instead of absorbing it.
                    if re.match(r"^(Ang|Ito|Ang mga|The|This|Alinsunod|Ayon)", t) or len(title) > 150:
                        desc_lines.append(t)
                        continue
                    title += " " + t
                break
        title = clean(title)
        if not title:
            continue

        # Metadata fields: value may share the row or sit on following rows.
        meta = {}
        for i in range(a, min(end + 1, len(rows))):
            for f in FIELDS:
                if re.match(r"^%s" % f.replace(" ", r"\s*"), texts[i], re.I):
                    val = clean(re.sub(r"^%s\s*:?" % f.replace(" ", r"\s*"), "", texts[i], flags=re.I))
                    j = i + 1
                    while not val and j < len(rows) and j <= end:
                        if re.match(r"^(%s)" % "|".join(STOP), texts[j], re.I):
                            break
                        val = clean(texts[j])
                        j += 1
                    meta.setdefault(f, val)

        def find(pat, lo, hi):
            for i in range(lo, min(hi, len(rows))):
                if re.search(pat, texts[i], re.I):
                    return i
            return None

        r0 = find(r"CHECKLIST OF REQUIREMENTS", a, end)
        s0 = find(r"CLIENT STEPS", a, end)
        # The steps-table header spans several rows and its topmost row ("FEES TO
        # BE", "PROCESSING TIME"...) can sit ABOVE the "CLIENT STEPS" row, so
        # requirements must stop at the first header token, not at CLIENT STEPS.
        hdr = find(r"(CLIENT STEPS|AGENCY ACTIONS|FEES TO|PROCESSING\s+TIME|PERSON\s+RESPONSIBLE)",
                   (r0 + 1) if r0 is not None else a, end)

        # Requirements: numbered item in the left column; right column = where to secure.
        reqs = []
        if r0 is not None:
            stop = hdr if hdr is not None else (s0 if s0 is not None else end)
            cur = None
            for i in range(r0 + 1, min(stop, len(rows))):
                left = row_text(rows[i][2], xmax=REQ_SPLIT_X)
                right = row_text(rows[i][2], xmin=REQ_SPLIT_X)
                if re.match(r"^\d{1,2}[.)]", left):
                    if cur:
                        reqs.append(cur)
                    cur = {"requirement": clean(left), "where_to_secure": clean(right)}
                elif cur is None and left:
                    # unnumbered single requirement (common in the shorter charters)
                    cur = {"requirement": clean(left), "where_to_secure": clean(right)}
                elif cur:
                    if left:
                        cur["requirement"] = clean(cur["requirement"] + " " + left)
                    if right:
                        cur["where_to_secure"] = clean(cur["where_to_secure"] + " " + right)
            if cur:
                reqs.append(cur)

        # Client steps: leftmost column only, grouped by numbered step.
        steps, cur = [], None
        if s0 is not None:
            for i in range(s0 + 1, min(end, len(rows))):
                if re.match(r"^Total", texts[i], re.I):
                    break
                left = row_text(rows[i][2], xmax=STEP_MAX_X)
                if not left or re.match(r"^(AGENCY|FEES|PROCESSING|PERSON)", left, re.I):
                    continue
                if re.match(r"^\d{1,2}[.)]", left):
                    if cur:
                        steps.append(clean(cur))
                    cur = left
                elif cur:
                    cur += " " + left
            if cur:
                steps.append(clean(cur))

        services.append({
            "service": categorise(title),
            "subservice": title,
            "department": department,
            "classification": meta.get("Classification", ""),
            "type_of_transaction": meta.get("Type of Transaction", ""),
            "who_may_avail": meta.get("Who may avail", ""),
            "office_or_division": meta.get("Office or Division", ""),
            "description": clean(" ".join(desc_lines))[:600],
            "requirements": reqs,
            "steps": steps,
            "_page": rows[a][0] + 1,
        })
    return services


# filename stem -> canonical department name in departments.json
DEPT = {
    "city_civil_registry_office": "CITY CIVIL REGISTRY OFFICE",
    "city_treasury_management_office": "CITY TREASURY MANAGEMENT OFFICE",
    "city_agricultural_services_office": "CITY AGRICULTURAL SERVICES DEPARTMENT",
    "city_budget_management_office": "CITY BUDGET MANAGEMENT OFFICE",
    "housing_and_settlements_department": "HOUSING AND SETTLEMENTS DEPARTMENT",
    "legislative_services_office": "LEGISLATIVE SERVICES OFFICE",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf_dir")
    ap.add_argument("--json")
    ap.add_argument("--show", type=int, default=0)
    args = ap.parse_args()

    allsvc = []
    for p in sorted(Path(args.pdf_dir).glob("*.pdf")):
        dept = DEPT.get(p.stem)
        if not dept:
            print("  skip (no dept mapping): %s" % p.name, file=sys.stderr)
            continue
        got = parse_pdf(p, dept)
        print("  %-44s -> %3d services" % (p.stem, len(got)))
        allsvc += got

    print("\nTOTAL parsed: %d" % len(allsvc))

    if args.show:
        for s in allsvc[:args.show]:
            print("\n" + "=" * 74)
            print("[%s] p%s" % (s["department"], s["_page"]))
            print("  subservice : %s" % s["subservice"][:96])
            print("  category   : %s" % s["service"])
            print("  class/type : %s | %s" % (s["classification"], s["type_of_transaction"]))
            print("  who        : %s" % s["who_may_avail"][:80])
            print("  reqs (%d):" % len(s["requirements"]))
            for r in s["requirements"][:4]:
                print("     - %-58s @ %s" % (r["requirement"][:58], r["where_to_secure"][:30]))
            print("  steps (%d):" % len(s["steps"]))
            for x in s["steps"][:4]:
                print("     %s" % x[:88])

    if args.json:
        Path(args.json).write_text(json.dumps(allsvc, ensure_ascii=False, indent=2), encoding="utf-8")
        print("\nwrote %s" % args.json)


if __name__ == "__main__":
    main()
