"""Draw the Ground floor with every perimeter door marked, for on-site checking.

The app's default start position is an inference from the baked layout, not an
observation: the main public door was identified as the bottom-centre opening
because row 74 carries four adjacent door cells (36-39) - the only doorway in
the plan wider than one cell - approached by entrance steps at rows 71-73, cols
29 and 46, which are stair cells present on the Ground floor and on no other.
The Lobby / Information desk at down 60 across 37 sits straight up that axis.

That reasoning can be wrong. A plan can show a door the public never uses, and
a wide opening can be a fire exit or a service bay. This figure exists so the
inference can be falsified by walking up to the building and looking.

Labels live in the margins with leader lines to their cells, so nothing can
overlap the plan or another label however the layout changes.

Output: entrance_check/Ground_Floor_Entrances.png

Run: python tools/draw_entrances.py
"""
import io
import json
import os
import re
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFont

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "entrance_check")
N = 75
DIRS = [(0, 1), (0, -1), (1, 0), (-1, 0)]

CS = 13                      # cell side, px
ML, MR, MT, MB = 250, 250, 118, 226     # margins: left, right, top, bottom


def load():
    src = io.open(os.path.join(ROOT, "wayfinding-app", "js", "floor_presets.js"),
                  encoding="utf-8").read()

    def block(name):
        i = src.index("const %s = " % name)
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


FLOORS, DEPTS = load()
CELLS = [c or "open" for c in FLOORS["1"]]
idx = lambda r, c: r * N + c                      # noqa: E731
px = lambda r, c: (ML + c * CS, MT + r * CS)      # noqa: E731


def walk(sr, sc):
    """Shortest-path distance in cells from (sr,sc) to every walkable cell."""
    d = [-1] * (N * N)
    d[idx(sr, sc)] = 0
    q = deque([idx(sr, sc)])
    while q:
        u = q.popleft()
        ur, uc = divmod(u, N)
        for dr, dc in DIRS:
            nr, nc = ur + dr, uc + dc
            if 0 <= nr < N and 0 <= nc < N:
                v = idx(nr, nc)
                if CELLS[v] != "wall" and d[v] < 0:
                    d[v] = d[u] + 1
                    q.append(v)
    return d


_FC = {}


def font(sz, bold=False):
    key = (sz, bold)
    if key in _FC:
        return _FC[key]
    f = None
    for nm in (("arialbd.ttf",) if bold else ("arial.ttf",)):
        for p in (r"C:\Windows\Fonts\%s" % nm, nm):
            try:
                f = ImageFont.truetype(p, sz)
                break
            except Exception:
                pass
        if f:
            break
    _FC[key] = f or ImageFont.load_default()
    return _FC[key]


# (row, col, label, side, is_main) - side says which margin the label sits in
DOORS = [
    (73, 37, "MAIN ENTRANCE",   "bottom", True),
    (38, 71, "East side door",  "right",  False),
    (36,  4, "West side door",  "left",   False),
    (4,  38, "North side door", "top",    False),
]


def label(d, anchor_xy, lines, side, colour, bold):
    """Draw a text block in the margin with a leader line back to the cell."""
    ax, ay = anchor_xy
    f = font(16, True) if bold else font(14)
    fh = f.size + 4
    w = max(d.textlength(t, font=f) for t in lines)
    h = fh * len(lines)

    if side == "right":
        tx, ty = ML + N * CS + 42, ay - h // 2
        lead = [(ax + CS, ay + CS // 2), (tx - 10, ty + h // 2)]
    elif side == "left":
        tx, ty = ML - 42 - w, ay - h // 2
        lead = [(ax, ay + CS // 2), (tx + w + 10, ty + h // 2)]
    elif side == "top":
        tx, ty = ax - w // 2, MT - 38 - h
        lead = [(ax + CS // 2, ay), (tx + w // 2, ty + h + 8)]
    else:                                   # bottom
        tx, ty = ax - w // 2, MT + N * CS + 30
        lead = [(ax + CS // 2, ay + CS), (tx + w // 2, ty - 8)]

    d.line(lead, fill=colour, width=2)
    for i, t in enumerate(lines):
        d.text((tx, ty + i * fh), t, font=f, fill=colour)
    return tx, ty, tx + w, ty + h


def main():
    os.makedirs(OUT, exist_ok=True)
    W = ML + N * CS + MR
    H = MT + N * CS + MB
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)

    colour = {"wall": "#334155", "open": "#F8FAFC",
              "door": "#FCD34D", "stair": "#FB923C"}
    for i, t in enumerate(CELLS):
        r, c = divmod(i, N)
        x, y = px(r, c)
        d.rectangle([x, y, x + CS - 1, y + CS - 1],
                    fill=colour.get(t, "#F8FAFC"), outline="#E2E8F0")

    # office anchors
    lobby = DEPTS["1"]["Lobby / Information"]
    for nm, o in DEPTS["1"].items():
        x, y = px(o["row"], o["col"])
        d.ellipse([x - 4, y - 4, x + CS + 3, y + CS + 3], outline="#2563EB", width=2)

    # the four-cell-wide opening and the entrance steps, outlined in place
    x0, _ = px(74, 36)
    x1, y0 = px(74, 39)
    d.rectangle([x0 - 3, y0 - 3, x1 + CS + 2, y0 + CS + 2], outline="#DC2626", width=3)
    for c in (29, 46):
        sx, sy = px(71, c)
        d.rectangle([sx - 3, sy - 3, sx + CS + 2, sy + 3 * CS + 2],
                    outline="#EA580C", width=2)

    # the Lobby desk, ringed and labelled into the right margin
    lx, ly = px(lobby["row"], lobby["col"])
    d.ellipse([lx - 8, ly - 8, lx + CS + 7, ly + CS + 7], outline="#1D4ED8", width=4)
    label(d, (lx, ly), ["Lobby / Information desk",
                        "down %d, across %d" % (lobby["row"], lobby["col"])],
          "right", "#1D4ED8", False)

    # the doors
    for r, c, text, side, is_main in DOORS:
        x, y = px(r, c)
        col = "#DC2626" if is_main else "#7C3AED"
        rad = 11 if is_main else 7
        d.ellipse([x - rad, y - rad, x + CS + rad - 1, y + CS + rad - 1],
                  outline=col, width=4 if is_main else 3)
        m = 0.6 * walk(r, c)[idx(lobby["row"], lobby["col"])]
        lines = [text, "down %d, across %d" % (r, c), "%.0f m to the Lobby desk" % m]
        if is_main:
            lines.insert(1, "the four door cells at 74,36-39")
        label(d, (x, y), lines, side, col, is_main)

    # the entrance-steps note, in the right margin clear of everything
    sx, sy = px(72, 46)
    label(d, (sx, sy), ["Entrance steps", "Ground floor only"], "right", "#EA580C", False)

    # axis ticks
    for k in range(0, N, 10):
        d.text((ML + k * CS + 1, MT - 20), str(k), font=font(13), fill="#64748B")
        d.text((ML - 32, MT + k * CS - 3), str(k), font=font(13), fill="#64748B")
    d.text((ML - 4, MT - 56), "across \u2192", font=font(13), fill="#64748B")
    d.text((ML - 80, MT - 3), "down \u2193", font=font(13), fill="#64748B")

    by = MT + N * CS + 148
    d.text((ML, by), "Ground Floor \u2014 where are the public doors?",
           font=font(20, True), fill="#111827")
    d.text((ML, by + 30),
           "red = the door the app now defaults to   \u00b7   purple = the other three "
           "perimeter doors   \u00b7   blue = office anchors   \u00b7   "
           "yellow = door cell, orange = stair cell",
           font=font(14), fill="#374151")
    d.text((ML, by + 52),
           "Inferred from the plan, NOT observed. Check on site: is the bottom-centre "
           "opening really the public entrance, and are the other three open or staff-only?",
           font=font(14, True), fill="#B91C1C")

    p = os.path.join(OUT, "Ground_Floor_Entrances.png")
    img.save(p)
    print("  wrote " + os.path.relpath(p, ROOT))
    for r, c, text, _side, _m in DOORS:
        m = 0.6 * walk(r, c)[idx(lobby["row"], lobby["col"])]
        print("  %-16s down %2d, across %2d   %4.0f m to the Lobby desk"
              % (text, r, c, m))


if __name__ == "__main__":
    main()
