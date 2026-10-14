"""Find candidate doorways connecting offices to the stairwells on floors 0, 2, 3.

Cross-floor routing cannot describe a journey when the destination office has no
walkable path to any stairwell. In the baked layout that is true of nearly every
office on floors 0, 2 and 3: the central-hall doorways were only ever opened on
floor 1, so each wing sits in its own sealed region.

For each floor this finds, for every disconnected office, the CHEAPEST set of
wall cells to open in order to reach the stair region - a 0-1 BFS where stepping
onto an open cell costs nothing and stepping through a wall costs one. The cells
on that path are the candidate doorways, and the cost is how many cells thick
the wall is at that point.

These are CANDIDATES, not decisions. A one-cell crossing is only a doorway if
there is really a door there. Check each against the floor plan, or on site,
before opening it in the editor - routing people through a wall that has no door
is worse than the current honest failure.

Outputs into doorway_candidates/:
  Doorway_Candidates.csv   every candidate, with what it unlocks
  floor_N_doorways.png     the floor drawn with candidates marked

Run: python tools/find_doorways.py
"""
import csv
import io
import os
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFont

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "doorway_candidates")
N = 75
DIRS = [(0, 1), (0, -1), (1, 0), (-1, 0)]


def load_floors():
    """Pull FLOOR_PRESETS / _DEPARTMENTS out of the JS bundle."""
    import json
    import re
    src = io.open(os.path.join(ROOT, "wayfinding-app", "js", "floor_presets.js"),
                  encoding="utf-8").read()

    def block(name):
        i = src.index(f"const {name} = ")
        b = src.index("{", i)
        depth, k = 0, b
        while k < len(src):
            if src[k] == "{":
                depth += 1
            elif src[k] == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        body = src[b:k + 1]
        body = re.sub(r"(^|[{,]\s*)(\d+):", r'\1"\2":', body)
        body = re.sub(r",(\s*[}\]])", r"\1", body)
        return json.loads(body)

    return block("FLOOR_PRESETS"), block("FLOOR_PRESETS_DEPARTMENTS")


FLOORS, DEPTS = load_floors()
idx = lambda r, c: r * N + c                      # noqa: E731
rc = lambda i: (i // N, i % N)                    # noqa: E731


def components(cells):
    """Label each walkable cell with its connected-region id."""
    comp = [-1] * (N * N)
    cid = 0
    for s in range(N * N):
        if cells[s] == "wall" or comp[s] != -1:
            continue
        q = deque([s])
        comp[s] = cid
        while q:
            u = q.popleft()
            ur, uc = rc(u)
            for dr, dc in DIRS:
                nr, ncl = ur + dr, uc + dc
                if not (0 <= nr < N and 0 <= ncl < N):
                    continue
                v = idx(nr, ncl)
                if cells[v] != "wall" and comp[v] == -1:
                    comp[v] = cid
                    q.append(v)
        cid += 1
    return comp, cid


def snap(cells, r, c):
    if cells[idx(r, c)] != "wall":
        return r, c
    best, bd = None, 10 ** 9
    for i in range(N * N):
        if cells[i] == "wall":
            continue
        rr, cc = rc(i)
        d = abs(rr - r) + abs(cc - c)
        if d < bd:
            bd, best = d, (rr, cc)
    return best


def cheapest_crossing(cells, sources):
    """0-1 BFS: cost = number of wall cells stepped through. Returns (dist, prev)."""
    INF = 10 ** 9
    dist = [INF] * (N * N)
    prev = [-1] * (N * N)
    dq = deque()
    for s in sources:
        dist[s] = 0
        dq.append(s)
    while dq:
        u = dq.popleft()
        ur, uc = rc(u)
        for dr, dc in DIRS:
            nr, ncl = ur + dr, uc + dc
            if not (0 <= nr < N and 0 <= ncl < N):
                continue
            v = idx(nr, ncl)
            w = 1 if cells[v] == "wall" else 0
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                prev[v] = u
                (dq.appendleft if w == 0 else dq.append)(v)
    return dist, prev


def main():
    os.makedirs(OUT, exist_ok=True)
    f1 = FLOORS["1"]
    rows_out = []

    for fk in ("0", "2", "3"):
        cells = FLOORS[fk]
        comp, _ = components(cells)

        # stair region = the component holding the most stairs shared with floor 1
        tally = {}
        for i in range(N * N):
            if cells[i] == "stair" and f1[i] == "stair" and comp[i] != -1:
                tally[comp[i]] = tally.get(comp[i], 0) + 1
        if not tally:
            print(f"floor {fk}: no shared stairs at all, skipping")
            continue
        stair_comp = max(tally, key=tally.get)
        sources = [i for i in range(N * N) if comp[i] == stair_comp]
        dist, prev = cheapest_crossing(cells, sources)

        # group offices by the region they sit in
        regions = {}
        for name, o in DEPTS.get(fk, {}).items():
            r, c = snap(cells, o["row"], o["col"])
            k = comp[idx(r, c)]
            regions.setdefault(k, []).append(name)

        print(f"\nfloor {fk}: stair region holds {tally[stair_comp]} shared stairs; "
              f"{len(regions)} office region(s)")

        marks = []
        for k, names in sorted(regions.items(), key=lambda kv: -len(kv[1])):
            if k == stair_comp:
                print(f"  already connected: {', '.join(sorted(names))}")
                continue
            # cheapest cell of this region to reach from the stair side
            tgt = min((i for i in range(N * N) if comp[i] == k), key=lambda i: dist[i])
            if dist[tgt] >= 10 ** 9:
                print(f"  UNREACHABLE at any cost: {', '.join(sorted(names))}")
                continue
            # walk back, collecting the wall cells crossed
            doors, u = [], tgt
            while u != -1 and dist[u] > 0:
                if cells[u] == "wall":
                    doors.append(u)
                u = prev[u]
            doors = sorted(set(doors))
            marks.extend(doors)
            cellstr = " + ".join(f"{rc(d)[0]},{rc(d)[1]}" for d in doors)
            print(f"  open {len(doors)} cell(s): {cellstr}")
            print(f"     unlocks {len(names)}: {', '.join(sorted(names))}")
            for d in doors:
                dr_, dc_ = rc(d)
                rows_out.append([fk, dr_, dc_, len(doors), len(names),
                                 "; ".join(sorted(names))])

        draw_floor(fk, cells, marks)

    with io.open(os.path.join(OUT, "Doorway_Candidates.csv"), "w",
                 encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["floor", "down_row", "across_col", "cells_in_this_doorway",
                    "offices_unlocked", "offices"])
        w.writerows(rows_out)
    print(f"\n{len(rows_out)} candidate cell(s) -> doorway_candidates/")


def draw_floor(fk, cells, marks):
    CS, PAD = 11, 46
    img = Image.new("RGB", (N * CS + PAD * 2, N * CS + PAD * 2 + 30), "white")
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 13)
        fb = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 15)
    except Exception:
        f = fb = ImageFont.load_default()

    colour = {"wall": "#334155", "open": "#F8FAFC",
              "door": "#FCD34D", "stair": "#FB923C"}
    for i, t in enumerate(cells):
        r, c = rc(i)
        x, y = PAD + c * CS, PAD + r * CS
        d.rectangle([x, y, x + CS - 1, y + CS - 1],
                    fill=colour.get(t, "#F8FAFC"), outline="#E2E8F0")

    for o in DEPTS.get(fk, {}).values():
        x, y = PAD + o["col"] * CS, PAD + o["row"] * CS
        d.ellipse([x - 3, y - 3, x + CS + 2, y + CS + 2], outline="#2563EB", width=2)

    for m in marks:
        r, c = rc(m)
        x, y = PAD + c * CS, PAD + r * CS
        d.rectangle([x - 2, y - 2, x + CS + 1, y + CS + 1], fill="#DC2626")
        d.text((x + CS + 4, y - 2), f"{r},{c}", font=f, fill="#DC2626")

    # ticks every 10 cells, so a candidate can be located by eye
    for k in range(0, N, 10):
        d.text((PAD + k * CS + 1, PAD - 16), str(k), font=f, fill="#64748B")
        d.text((PAD - 26, PAD + k * CS - 2), str(k), font=f, fill="#64748B")
    d.text((PAD - 26, 12), "down \u2193", font=f, fill="#64748B")
    d.text((PAD, 12), "across \u2192", font=f, fill="#64748B")

    name = {"0": "Lower Ground", "2": "2nd Floor", "3": "3rd Floor"}.get(fk, fk)
    d.text((PAD, N * CS + PAD + 6),
           f"Floor {int(fk) + 1} \u2014 {name}   "
           f"red = candidate doorway (down,across)   orange = stairs   blue ring = office",
           font=fb, fill="#111827")
    img.save(os.path.join(OUT, f"floor_{fk}_doorways.png"))


if __name__ == "__main__":
    main()
