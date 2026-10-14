"""Generate printable QR anchor signs for the Calamba City Hall wayfinding app.

Each sign encodes a deep link (https://<site>/?qr=<floor>:<row>,<col>) that a
phone's native camera opens - no app install. Scanning sets both position and
floor, which resets accumulated PDR drift to zero.

Every anchor is validated against the baked floor layout before a code is made:
a cell that is a wall is moved to the nearest walkable cell, and a stairwell
that does not exist on a given floor is skipped. A QR pointing at a wall or at
a landing that isn't there is worse than no QR.

Outputs into qr_anchors/:
  *.png                      one image per anchor (the sign, ready to print)
  QR_Anchor_Signs.pdf        all signs, 2 per A4 page
  QR_Anchor_Index.csv        what was generated, what was corrected, what was skipped

Run: python tools/make_qr_anchors.py
"""
import csv
import io
import json
import os
import re
import sys

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw, ImageFont

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS = os.path.join(ROOT, "wayfinding-app", "js", "floor_presets.js")
OUTDIR = os.path.join(ROOT, "qr_anchors")
SITE = "https://penaranda-dissertation.vercel.app"
N = 75

FLOOR_NAMES = {0: "Lower Ground Floor", 1: "Ground Floor", 2: "2nd Floor", 3: "3rd Floor"}

# ── anchor plan (QR_ANCHOR_PLAN.md) ──────────────────────────────────────────
# Tier 2 stairwells repeat on every floor; the script drops the ones that do not
# exist in that floor's layout rather than trusting the table.
STAIRWELLS = [
    ("North-center stairs", 12, 33),
    ("East stairs",         26, 72),
    ("West stairs",         26,  3),
    ("South-left stairs",   60, 26),
    ("South-right stairs",  60, 49),
]

# Which tiers to print. Tier 3 (high-traffic offices) is excluded by default:
# its cells were estimated rather than read from the layout - Civil Registry was
# placed 24 cells from the real department centroid - and its "high-traffic"
# ranking had no query data behind it. Regenerate Tier 3 from measured demand
# once the evaluation period has produced some. Override with --tiers 1,2,3.
TIERS = {1, 2}
# Which floors to print. Default is all; --floors 1 gives a Ground-floor
# starter pack, which is the sensible first on-site test - six signs instead
# of twenty, covering the entrance and every landing people actually use.
FLOORS_WANTED = {0, 1, 2, 3}

SPOTS = [
    # (floor, row, col, name, tier)
    (1, 38, 72, "Main Entrance / Public Assistance", 1),
    (1, 54,  7, "Civil Registry (CCRO)",             3),
    (1, 54, 65, "Business Permits (BPATFO)",         3),
]
for _f in (0, 1, 2, 3):
    for _nm, _r, _c in STAIRWELLS:
        SPOTS.append((_f, _r, _c, _nm, 2))


def load_floors():
    """Pull FLOOR_PRESETS out of the JS bundle without running a JS engine."""
    src = io.open(PRESETS, encoding="utf-8").read()
    start = src.index("const FLOOR_PRESETS = {")
    brace = src.index("{", start)
    depth, i = 0, brace
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = src[brace:i + 1]
    body = re.sub(r"(\d+):", r'"\1":', body)      # 0: -> "0":
    body = re.sub(r",(\s*[}\]])", r"\1", body)     # trailing commas
    return {int(k): v for k, v in json.loads(body).items()}


FLOORS = load_floors()


def cell(floor, r, c):
    return FLOORS[floor][r * N + c]


def nearest_walkable(floor, r, c):
    """Closest non-wall cell, Manhattan. Returns (row, col, distance)."""
    best, bd = None, 10 ** 9
    grid = FLOORS[floor]
    for i, t in enumerate(grid):
        if t == "wall":
            continue
        rr, cc = divmod(i, N)
        d = abs(rr - r) + abs(cc - c)
        if d < bd:
            bd, best = d, (rr, cc)
    return best[0], best[1], bd


# ── fonts ────────────────────────────────────────────────────────────────────
def font(size, bold=False):
    for name in (("arialbd.ttf", "Arial Bold") if bold else ("arial.ttf", "Arial")):
        for path in (rf"C:\Windows\Fonts\{name}", name):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


# A4 at 150 dpi, two signs per page
PAGE_W, PAGE_H = 1240, 1754
SIGN_W, SIGN_H = PAGE_W, PAGE_H // 2


def make_sign(name, floor, r, c, url):
    img = Image.new("RGB", (SIGN_W, SIGN_H), "white")
    d = ImageDraw.Draw(img)

    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_H, box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    code = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    side = 400
    code = code.resize((side, side), Image.NEAREST)

    qx, qy = 70, (SIGN_H - side) // 2 + 10
    img.paste(code, (qx, qy))

    tx = qx + side + 55
    y = qy - 10

    d.text((tx, y), "SCAN MO AKO", font=font(46, True), fill="black")
    y += 58
    d.text((tx, y), "Para malaman kung nasaan ka", font=font(25), fill="#444444")
    y += 36
    d.text((tx, y), "Scan to locate yourself", font=font(25), fill="#444444")
    y += 54

    d.line([(tx, y), (SIGN_W - 70, y)], fill="#cccccc", width=2)
    y += 26

    # Location, wrapped so a long office name cannot run off the sign.
    f_name, f_size = font(37, True), 37
    words, line = name.split(), ""
    avail = SIGN_W - tx - 70
    for w in words:
        trial = (line + " " + w).strip()
        if d.textlength(trial, font=f_name) > avail and line:
            d.text((tx, y), line, font=f_name, fill="black")
            y += f_size + 6
            line = w
        else:
            line = trial
    if line:
        d.text((tx, y), line, font=f_name, fill="black")
        y += f_size + 10

    d.text((tx, y), FLOOR_NAMES[floor], font=font(30), fill="#1E40AF")
    y += 46

    d.text((tx, y), "Buksan ang camera at ituro dito.", font=font(22), fill="#555555")
    y += 30
    d.text((tx, y), "Open your camera and point here.", font=font(22), fill="#555555")

    # Admin footer: which anchor this is, and the link in plain text as a fallback.
    # Label the axes. A bare "38,71" reads as across,down to most people,
    # which is the reverse of the row,col the deep link carries - so an admin
    # copying it into the app would land somewhere else entirely.
    d.text((qx, SIGN_H - 62), f"Floor {floor + 1}  ·  down {r}  ·  across {c}",
           font=font(19), fill="#888888")
    d.text((qx, SIGN_H - 36), url, font=font(17), fill="#aaaaaa")
    d.line([(0, SIGN_H - 1), (SIGN_W, SIGN_H - 1)], fill="#dddddd", width=1)
    return img


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    signs, index = [], []
    made = skipped = moved = 0

    for floor, r, c, name, tier in SPOTS:
        if tier not in TIERS or floor not in FLOORS_WANTED:
            continue
        t = cell(floor, r, c)

        # A stairwell that does not exist on this floor gets no sign.
        if tier == 2 and t != "stair":
            print(f"  SKIP   {floor}:{r},{c}  {name} on {FLOOR_NAMES[floor]} "
                  f"- no stair here (cell is '{t}')")
            index.append([floor, r, c, name, tier, "", "skipped: no stair on this floor", ""])
            skipped += 1
            continue

        ar, ac, note = r, c, "ok"
        if t == "wall":
            ar, ac, dist = nearest_walkable(floor, r, c)
            note = f"moved off wall to {ar},{ac} ({dist} cell)"
            print(f"  MOVED  {floor}:{r},{c} -> {floor}:{ar},{ac}  {name} (was a wall cell)")
            moved += 1

        url = f"{SITE}/?qr={floor}:{ar},{ac}"
        img = make_sign(name, floor, ar, ac, url)
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        fn = f"F{floor}_{slug}_{ar}-{ac}.png"
        img.save(os.path.join(OUTDIR, fn))
        signs.append(img)
        index.append([floor, r, c, name, tier, f"{ar},{ac}", note, url])
        made += 1

    # Two signs per A4 page.
    pages = []
    for i in range(0, len(signs), 2):
        page = Image.new("RGB", (PAGE_W, PAGE_H), "white")
        page.paste(signs[i], (0, 0))
        if i + 1 < len(signs):
            page.paste(signs[i + 1], (0, SIGN_H))
        pages.append(page)
    if pages:
        pages[0].save(os.path.join(OUTDIR, "QR_Anchor_Signs.pdf"),
                      save_all=True, append_images=pages[1:], resolution=150.0)

    with io.open(os.path.join(OUTDIR, "QR_Anchor_Index.csv"), "w",
                 encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["floor", "planned_row", "planned_col", "location", "tier",
                    "actual_cell", "note", "url"])
        w.writerows(index)

    print(f"\n{made} signs generated, {moved} moved off a wall, {skipped} skipped")
    print(f"{len(pages)} page PDF -> qr_anchors/QR_Anchor_Signs.pdf")


if __name__ == "__main__":
    for i, a in enumerate(sys.argv):
        if a == "--tiers" and i + 1 < len(sys.argv):
            TIERS = {int(x) for x in sys.argv[i + 1].split(",") if x.strip()}
        if a == "--floors" and i + 1 < len(sys.argv):
            FLOORS_WANTED = {int(x) for x in sys.argv[i + 1].split(",") if x.strip()}
        if a == "--out" and i + 1 < len(sys.argv):
            OUTDIR = os.path.join(ROOT, sys.argv[i + 1])
    print("Generating tiers %s, floors %s" % (sorted(TIERS), sorted(FLOORS_WANTED)))
    print("into " + os.path.relpath(OUTDIR, ROOT))
    print()
    main()
