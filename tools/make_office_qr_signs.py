"""Printable QR signs for every office window on the map.

Post one at each office door or window. Scanning it with a phone camera opens
the app with the citizen's position set to that spot (?qr=floor:row,col), so
directions start from the right place and PDR drift is reset to zero, the same
as the entrance and stair signs from make_qr_anchors.py.

Where each sign points: the walkable cell nearest the office's stamp that can
be reached from the main entrance (Ground Floor) or from the stairs (other
floors). That is the cell the app's router ends a "Take me there" route on
(_nearestReachableCell in app.js), so a citizen who scans the sign at the
office is standing exactly where the map says the office is.

The office list is the app's own: DEPT_STAMP_NAMES in service_locations.js
(which stamps each office routes to) and the display names and abbreviations
in lib/office_finder.js. Offices with no stamp yet (POSO, General Services,
OSCA, CDRRMD) get no sign; the City College is not in City Hall.

Outputs into qr_anchors/offices/ (git-ignored; re-run after a map change):
  QR_Office_Signs_All.pdf           every office sign, 2 per A4 page
  QR_Office_Signs_<floor>.pdf       the same, one file per floor
  QR_Office_Signs_Index.csv         what each sign points to
  *.png                             one image per sign

Run: python tools/make_office_qr_signs.py
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_qr_anchors as qa  # noqa: E402  (sign drawing, floor layout, site URL)

from PIL import Image  # noqa: E402

ROOT = qa.ROOT
OUTDIR = os.path.join(ROOT, "qr_anchors", "offices")
N = qa.N
ENTRANCE = (1, 73, 37)
DIRS = [(0, 1), (0, -1), (1, 0), (-1, 0)]

# Pull the office list from the app's own files with Node, so the signs can
# never disagree with what the app routes to.
NODE = r"""
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[1];
const sb = { console, localStorage: { getItem() { return null; }, setItem() {} }, window: {} };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(root, 'wayfinding-app/js/stamp_presets.js'), 'utf8') +
                ';var STAMP_PLACEMENTS = STAMP_PLACEMENTS_BUNDLED;', sb);
vm.runInContext(fs.readFileSync(path.join(root, 'wayfinding-app/js/service_locations.js'), 'utf8') +
                ';this.DEPTS = DEPT_STAMP_NAMES; this.CAMPUS = [...SEPARATE_CAMPUS];', sb);
const F = require(path.join(root, 'lib/office_finder.js'));
const out = F.OFFICES.map(o => ({
  dept: o.dept, name: o.name, abbr: o.abbr[0] || null,
  stamps: (sb.DEPTS[o.dept] || []).flatMap(n => sb.STAMP_PLACEMENTS.filter(p => p.name === n)),
  campus: sb.CAMPUS.includes(o.dept),
}));
process.stdout.write(JSON.stringify(out));
"""


def offices():
    res = subprocess.run(["node", "-e", NODE, ROOT], capture_output=True, text=True, encoding="utf-8")
    if res.returncode:
        raise SystemExit("could not read the office list:\n" + res.stderr)
    return json.loads(res.stdout)


def walkable(f, r, c):
    return 0 <= r < N and 0 <= c < N and qa.FLOORS[f][r * N + c] != "wall"


_REACH = {}


def reachable(f):
    """Cells reachable on floor f from the main entrance (Ground) or any stair (others)."""
    if f in _REACH:
        return _REACH[f]
    if f == ENTRANCE[0]:
        starts = [(ENTRANCE[1], ENTRANCE[2])]
    else:
        starts = [divmod(i, N) for i, t in enumerate(qa.FLOORS[f]) if t == "stair"]
    seen = set(starts)
    q = deque(starts)
    while q:
        r, c = q.popleft()
        for dr, dc in DIRS:
            nr, nc = r + dr, c + dc
            if walkable(f, nr, nc) and (nr, nc) not in seen:
                seen.add((nr, nc))
                q.append((nr, nc))
    _REACH[f] = seen
    return seen


def stand_cell(f, r, c):
    """Where a person stands at this stamp: the nearest reachable walkable cell."""
    best = min(reachable(f), key=lambda p: (abs(p[0] - r) + abs(p[1] - c), p[0], p[1]))
    return best[0], best[1], abs(best[0] - r) + abs(best[1] - c)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    for fn in os.listdir(OUTDIR):            # stale signs from an older map
        if fn.endswith(".png"):
            os.remove(os.path.join(OUTDIR, fn))

    signs, index, skipped = [], [], []
    for o in offices():
        if o["campus"]:
            skipped.append((o["name"], "separate campus, not in City Hall"))
            continue
        if not o["stamps"]:
            skipped.append((o["name"], "not on the map yet"))
            continue
        title = "%s (%s)" % (o["name"], o["abbr"]) if o["abbr"] else o["name"]
        stamps = sorted(o["stamps"], key=lambda s: (s["floor"], s["row"], s["col"]))
        for k, s in enumerate(stamps, 1):
            f = s["floor"]
            r, c, gap = stand_cell(f, s["row"], s["col"])
            what = "desk" if o["dept"].endswith("PUBLIC ASSISTANCE CENTER") else "window"
            note = "Map label: %s" % s["name"]
            if len(stamps) > 1:
                note += "   ·   %s %d of %d" % (what, k, len(stamps))
            url = "%s/?qr=%d:%d,%d" % (qa.SITE, f, r, c)
            img = qa.make_sign(title, f, r, c, url, note=note)
            slug = re.sub(r"[^a-z0-9]+", "-", (s["name"] or title).lower()).strip("-")
            img.save(os.path.join(OUTDIR, "F%d_%s_%d-%d.png" % (f, slug, r, c)))
            signs.append((f, img))
            index.append([qa.FLOOR_NAMES[f], o["name"], s["name"], "%d,%d" % (s["row"], s["col"]),
                          "%d,%d" % (r, c), gap, url])

    def pdf(items, path):
        pages = []
        for i in range(0, len(items), 2):
            page = Image.new("RGB", (qa.PAGE_W, qa.PAGE_H), "white")
            page.paste(items[i], (0, 0))
            if i + 1 < len(items):
                page.paste(items[i + 1], (0, qa.SIGN_H))
            pages.append(page)
        if pages:
            pages[0].save(path, save_all=True, append_images=pages[1:], resolution=150.0)
        return len(pages)

    # Ground first (where people come in), then Lower Ground, 2nd, 3rd.
    order = sorted({f for f, _ in signs}, key=lambda f: (f != 1, f))
    signs.sort(key=lambda x: order.index(x[0]))
    n_all = pdf([im for _, im in signs], os.path.join(OUTDIR, "QR_Office_Signs_All.pdf"))
    print("%d office signs, %d pages -> qr_anchors/offices/QR_Office_Signs_All.pdf" % (len(signs), n_all))
    for f in order:
        mine = [im for ff, im in signs if ff == f]
        name = qa.FLOOR_NAMES[f].replace(" ", "_")
        pages = pdf(mine, os.path.join(OUTDIR, "QR_Office_Signs_%s.pdf" % name))
        print("  %-20s %2d signs, %2d pages" % (qa.FLOOR_NAMES[f], len(mine), pages))

    with io.open(os.path.join(OUTDIR, "QR_Office_Signs_Index.csv"), "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["floor", "office", "map_label", "stamp_cell", "sign_cell", "cells_from_stamp", "url"])
        w.writerows(index)

    for name, why in skipped:
        print("  no sign: %s (%s)" % (name, why))


if __name__ == "__main__":
    main()
