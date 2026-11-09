"""Office and entrance locations, as a PDF to check on site or hand to staff.

Lists the offices Jace asked about (2026-11-09) and the four public doors,
with where each is on the map, how to describe it in words, and roughly how
far it is to walk from the main entrance. Then one drawing per floor with
every listed office and door marked and numbered to match the tables.

Everything comes from the same data the app uses:
  wayfinding-app/js/floor_presets.js   walls, doors, stairs, floor names
  wayfinding-app/js/stamp_presets.js   where each office's stamp sits
so re-running this after a map change gives an up-to-date sheet.

"Down, across" are the rows and columns of the 75 x 75 grid (down 0 is the
top edge, across 0 the left). Sides are as you face in from the main
entrance at down 73, across 37: low columns are on your left, low rows are
toward the back. Walking distances are shortest paths on the grid at about
0.6 m a cell; for other floors they go via the nearest shared stairs and
leave out the climb itself.

Output: office_locations/Office_and_Entrance_Locations.pdf (git-ignored)

Run: python tools/make_office_locations_pdf.py
"""
import io
import json
import os
import re
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Image as RLImage, PageBreak, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "office_locations")
N = 75
CELL_M = 0.6
ENTRANCE = (1, 73, 37)          # floor, down, across - the main public door
DIRS = [(0, 1), (0, -1), (1, 0), (-1, 0)]

# The offices exactly as Jace listed them, each with the stamps the app routes to.
OFFICES = [
    ("Business Permits and Licensing Office (BPLO)",
     "Business Permits and Tricycle Franchising Office", ["GF 12a BPATFO", "GF 12b BPATFO"]),
    ("City Treasury Department",
     "City Treasury Management Office", ["GF 05a CTMO", "GF 05b CTMO", "LG 08 CTMO"]),
    ("City Civil Registry Office (CCRO)",
     "City Civil Registry Office", ["GF 02a CCRO", "GF 02b CCRO"]),
    ("City Social Services Department (CSSD) / CSWDO",
     "City Social Services Office", ["LG 10a CSSD", "LG 10b CSSD"]),
    ("City Health Services Department",
     "City Health Services Department", ["LG 04 CHSD"]),
    ("Public Employment Service Office (PESO)",
     "Information, Investment Promotions and Employment Services Office", ["LG 09", "Local Recruitment"]),
    ("City Assessor's Office",
     "City Assessment Office", ["GF 09a CAO", "GF 09b CAO"]),
    ("City Engineering Department",
     "City Engineering and Infrastructure Development Department", ["2F 14 CEIDD"]),
    ("Building Official",
     "Buildings Regulatory Services Department", ["2F 13 OOTBO"]),
    ("City Housing and Settlements Department",
     "Housing and Settlements Department", ["LG 01 HASD", "HSD Services"]),
    ("Public Order and Safety Office (POSO)",
     None, []),   # not on the map: the app sends people to the Public Assistance Center
]
HELP_DESK = ("Public Assistance Center", "Mayor's Office Public Assistance Center", ["MOPAC"])

DOORS = [
    ("Main Entrance / Lobby", 73, 37, "The main public door: four door cells wide at the bottom edge, "
                                      "up the entrance steps. The app's default start."),
    ("East side door",  38, 71, "Right side of the building, about halfway in."),
    ("West side door",  36,  4, "Left side of the building, about halfway in."),
    ("North side door",  4, 38, "Back of the building, in the middle."),
]


# ── data ─────────────────────────────────────────────────────────────────────
def _js_block(src, name, opener):
    i = src.index("const %s = " % name)
    b = src.index(opener, i)
    close = "}" if opener == "{" else "]"
    depth, k = 0, b
    while k < len(src):
        if src[k] == opener:
            depth += 1
        elif src[k] == close:
            depth -= 1
            if depth == 0:
                break
        k += 1
    body = src[b:k + 1]
    body = re.sub(r"(^|[{,]\s*)(\d+):", r'\1"\2":', body)
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    return json.loads(body)


def load():
    fp = io.open(os.path.join(ROOT, "wayfinding-app", "js", "floor_presets.js"), encoding="utf-8").read()
    sp = io.open(os.path.join(ROOT, "wayfinding-app", "js", "stamp_presets.js"), encoding="utf-8").read()
    floors = {int(k): [c or "open" for c in v] for k, v in _js_block(fp, "FLOOR_PRESETS", "{").items()}
    names = {int(k): v for k, v in _js_block(fp, "FLOOR_NAMES", "{").items()}
    stamps = _js_block(sp, "STAMP_PLACEMENTS_BUNDLED", "[")
    return floors, names, stamps


FLOORS, FLOOR_NAMES, STAMPS = load()
idx = lambda r, c: r * N + c    # noqa: E731


def walkable(f, r, c):
    return 0 <= r < N and 0 <= c < N and FLOORS[f][idx(r, c)] != "wall"


def bfs(f, r0, c0):
    d = [-1] * (N * N)
    d[idx(r0, c0)] = 0
    q = deque([(r0, c0)])
    while q:
        r, c = q.popleft()
        for dr, dc in DIRS:
            nr, nc = r + dr, c + dc
            if walkable(f, nr, nc) and d[idx(nr, nc)] < 0:
                d[idx(nr, nc)] = d[idx(r, c)] + 1
                q.append((nr, nc))
    return d


def snap(f, r, c):
    """Nearest walkable cell to (r, c): a stamp's centre can sit on a wall line."""
    if walkable(f, r, c):
        return r, c
    for rad in range(1, 6):
        for dr in range(-rad, rad + 1):
            for dc in range(-rad, rad + 1):
                if walkable(f, r + dr, c + dc):
                    return r + dr, c + dc
    return r, c


FROM_DOOR = bfs(ENTRANCE[0], ENTRANCE[1], ENTRANCE[2])


def walk_m(f, r, c):
    """Metres from the main entrance to (r, c) on floor f, or None if no path."""
    r, c = snap(f, r, c)
    if f == ENTRANCE[0]:
        d = FROM_DOOR[idx(r, c)]
        return None if d < 0 else d * CELL_M
    back = bfs(f, r, c)
    best = None
    for i in range(N * N):
        if FLOORS[ENTRANCE[0]][i] == "stair" and FLOORS[f][i] == "stair":
            a, b = FROM_DOOR[i], back[i]
            if a >= 0 and b >= 0 and (best is None or a + b < best):
                best = a + b
    return None if best is None else best * CELL_M


def centre(s):
    half = (s.get("size", 1) - 1) // 2
    return s["row"] + half, s["col"] + half


def where(r, c):
    side = ["left side", "middle", "right side"][0 if c < 25 else 1 if c < 50 else 2]
    depth = ["toward the back", "about halfway in", "toward the front"][0 if r < 25 else 1 if r < 50 else 2]
    if side == "middle" and depth == "about halfway in":
        return "in the middle of the floor"
    return ("in the middle, " + depth) if side == "middle" else (side + ", " + depth)


def floor_name(f):
    return FLOOR_NAMES.get(f, "Floor index %d" % f)


def stamp_cells(names):
    return [s for s in STAMPS if s["name"] in names]


# ── drawings ─────────────────────────────────────────────────────────────────
CS = 11
ML, MT, MR, MB = 36, 36, 36, 36
_FC = {}


def font(sz, bold=False):
    key = (sz, bold)
    if key not in _FC:
        f = None
        for p in ((r"C:\Windows\Fonts\arialbd.ttf", "arialbd.ttf") if bold
                  else (r"C:\Windows\Fonts\arial.ttf", "arial.ttf")):
            try:
                f = ImageFont.truetype(p, sz)
                break
            except Exception:
                pass
        _FC[key] = f or ImageFont.load_default()
    return _FC[key]


def badge(d, x, y, text, fill):
    f = font(13, True)
    w = d.textlength(text, font=f)
    r = max(11, int(w / 2) + 6)
    d.ellipse([x - r, y - r, x + r, y + r], fill=fill, outline="white", width=2)
    d.text((x - w / 2, y - 8), text, font=f, fill="white")


def draw_floor(f, marks, path):
    """marks: [(row, col, size, label, colour)]"""
    W, H = ML + N * CS + MR, MT + N * CS + MB
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    pal = {"wall": "#334155", "open": "#F8FAFC", "door": "#FCD34D", "stair": "#FB923C"}
    for i, t in enumerate(FLOORS[f]):
        r, c = divmod(i, N)
        x, y = ML + c * CS, MT + r * CS
        d.rectangle([x, y, x + CS - 1, y + CS - 1], fill=pal.get(t, "#F8FAFC"), outline="#E2E8F0")
    # axis ticks every 10 cells, so "down, across" can be read off the drawing
    for k in range(0, N, 10):
        d.text((ML + k * CS + 2, MT - 16), str(k), font=font(11), fill="#64748B")
        d.text((6, MT + k * CS), str(k), font=font(11), fill="#64748B")
    d.text((ML, H - 26), "across  ->", font=font(11), fill="#64748B")
    d.text((6, MT - 32), "down", font=font(11), fill="#64748B")
    for r, c, size, label, colour in marks:
        x0, y0 = ML + c * CS, MT + r * CS
        side = size * CS
        d.rectangle([x0 - 2, y0 - 2, x0 + side + 1, y0 + side + 1], outline=colour, width=3)
        badge(d, x0 + side / 2, y0 + side / 2, label, colour)
    img.save(path)
    return W, H


# ── PDF ──────────────────────────────────────────────────────────────────────
OFFICE_BLUE, DOOR_RED, HELP_GREEN = "#1D4ED8", "#DC2626", "#047857"


def main():
    os.makedirs(OUT, exist_ok=True)
    ss = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=ss["BodyText"], fontName="Helvetica", fontSize=8, leading=9.6)
    small = ParagraphStyle("s", parent=body, fontSize=7.5, leading=9, textColor=colors.HexColor("#475569"))
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=16, leading=20,
                        alignment=0, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=11.5,
                        leading=14, spaceBefore=8, spaceAfter=4)
    P = lambda t, s=body: Paragraph(t, s)   # noqa: E731

    story = [
        P("Calamba City Hall: office and entrance locations", h1),
        P("From the wayfinding map as deployed on 9 November 2026. <b>Down, across</b> are the rows and "
          "columns of the 75 x 75 map grid (down 0 is the top edge, across 0 the left edge). <b>Sides</b> are "
          "as you face in from the main entrance. <b>Walk</b> is the shortest walking distance from the main "
          "entrance at about 0.6 m per cell; for other floors it goes via the nearest stairs and does not "
          "count the climb. Numbers match the floor drawings that follow.", small),
    ]

    marks = {f: [] for f in FLOORS}
    keys = {f: [] for f in FLOORS}   # (mark, label, row, col) for each floor page's key

    # Entrances
    story.append(P("Public entrances (Ground Floor)", h2))
    rows = [[P("<b>#</b>"), P("<b>Entrance</b>"), P("<b>Down, across</b>"), P("<b>Notes</b>")]]
    for i, (name, r, c, note) in enumerate(DOORS, 1):
        tag = "E%d" % i
        rows.append([P(tag), P("<b>%s</b>" % name), P("%d, %d" % (r, c)), P(note)])
        marks[1].append((r, c, 1, tag, DOOR_RED))
        keys[1].append((tag, name, r, c))
    t = Table(rows, colWidths=[10 * mm, 42 * mm, 24 * mm, 104 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FEE2E2")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t)

    # Offices
    story.append(P("Offices", h2))
    rows = [[P("<b>#</b>"), P("<b>Office (as you listed it)</b>"), P("<b>Name on the map</b>"),
             P("<b>Floor</b>"), P("<b>Where</b>"), P("<b>Down, across</b>"), P("<b>Walk</b>")]]
    spans = []          # (first_row, last_row) of each office, to span its name columns
    help_cells = stamp_cells(HELP_DESK[2])
    for i, (asked, mapped, stamp_names) in enumerate(OFFICES, 1):
        tag = str(i)
        cells = stamp_cells(stamp_names)
        if not cells:
            note = "<b>Not on the map yet.</b> The app says so and sends people to H below."
            rows.append([P(tag), P(asked), P(note), P("-"), P("-"), P("-"), P("-")])
            spans.append((len(rows) - 1, len(rows) - 1))
            continue
        cells.sort(key=lambda s: (abs(s["floor"] - ENTRANCE[0]),
                                  abs(s["row"] - ENTRANCE[1]) + abs(s["col"] - ENTRANCE[2])))
        first = len(rows)
        for k, s in enumerate(cells):
            r, c = centre(s)
            m = walk_m(s["floor"], r, c)
            sub = tag if len(cells) == 1 else "%s%s" % (tag, "abc"[k])
            name = mapped
            if len(cells) > 1:
                name += "<br/><font size=7 color='#475569'>%d windows</font>" % len(cells)
            rows.append([P(sub), P(asked) if k == 0 else "", P(name) if k == 0 else "",
                         P(floor_name(s["floor"])), P(where(r, c)), P("%d, %d" % (s["row"], s["col"])),
                         P("-" if m is None else "~%d m" % round(m))])
            marks[s["floor"]].append((s["row"], s["col"], s.get("size", 1), sub, OFFICE_BLUE))
            keys[s["floor"]].append((sub, asked, s["row"], s["col"]))
        spans.append((first, len(rows) - 1))
    # the Public Assistance Center, because POSO points there
    hp = sorted(help_cells, key=lambda s: abs(s["row"] - ENTRANCE[1]) + abs(s["col"] - ENTRANCE[2]))
    if hp:
        s = hp[0]
        r, c = centre(s)
        m = walk_m(s["floor"], r, c)
        rows.append([P("H"), P("<i>Public Assistance Center</i> (where POSO questions go)"),
                     P("Mayor's Office Public Assistance Center (MOPAC), %d desks" % len(help_cells)),
                     P(floor_name(s["floor"])), P(where(r, c)), P("%d, %d" % (s["row"], s["col"])),
                     P("-" if m is None else "~%d m" % round(m))])
        spans.append((len(rows) - 1, len(rows) - 1))
        for h in help_cells:
            marks[h["floor"]].append((h["row"], h["col"], h.get("size", 1), "H", HELP_GREEN))
        keys[s["floor"]].append(("H", "Public Assistance Center (%d desks)" % len(help_cells), s["row"], s["col"]))
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DBEAFE")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    for n, (a, b) in enumerate(spans):
        if n % 2:
            style.append(("BACKGROUND", (0, a), (-1, b), colors.HexColor("#F8FAFC")))
        if b > a:
            style += [("SPAN", (1, a), (1, b)), ("SPAN", (2, a), (2, b))]
    t = Table(rows, colWidths=[10 * mm, 34 * mm, 39 * mm, 27 * mm, 41 * mm, 15 * mm, 13 * mm], repeatRows=1)
    t.setStyle(TableStyle(style))
    story.append(t)
    story.append(Spacer(1, 4))
    story.append(P("Positions come from the map's office stamps and the main-entrance location is inferred "
                   "from the floor plan; both are worth checking on site. Each office with several windows "
                   "is routed to the window nearest the person.", small))

    # Floor drawings: Ground first (the entrances), then the rest bottom to top
    order = [1, 0] + [f for f in sorted(FLOORS) if f > 1]
    for f in order:
        if not marks[f]:
            continue
        story.append(PageBreak())
        story.append(P(floor_name(f), h2))
        legend = {"E": "red: public entrances", "H": "green: Public Assistance Center",
                  "O": "blue: offices (numbers match the table)"}
        used = []
        if any(m[4] == DOOR_RED for m in marks[f]):
            used.append(legend["E"])
        if any(m[4] == OFFICE_BLUE for m in marks[f]):
            used.append(legend["O"])
        if any(m[4] == HELP_GREEN for m in marks[f]):
            used.append(legend["H"])
        story.append(P("Marked: " + "; ".join(used) + ". Grey is wall, yellow door, orange stairs. "
                       "The main entrance is at the bottom edge of the Ground Floor.", small))
        png = os.path.join(OUT, "floor_%d_%s.png" % (f, floor_name(f).replace(" ", "_")))
        W, H = draw_floor(f, marks[f], png)
        width = 180 * mm
        story.append(RLImage(png, width=width, height=width * H / W))
        # the key, two entries to a row, so the page stands on its own
        ks = keys[f]
        half = (len(ks) + 1) // 2
        krows = []
        for j in range(half):
            row = []
            for e in (ks[j], ks[j + half] if j + half < len(ks) else None):
                row += ([P("<b>%s</b>" % e[0], small), P(e[1], small), P("%d, %d" % (e[2], e[3]), small)]
                        if e else ["", "", ""])
            krows.append(row)
        kt = Table(krows, colWidths=[9 * mm, 62 * mm, 16 * mm] * 2)
        kt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
        story.append(Spacer(1, 4))
        story.append(kt)

    pdf = os.path.join(OUT, "Office_and_Entrance_Locations.pdf")
    SimpleDocTemplate(pdf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                      topMargin=12 * mm, bottomMargin=12 * mm,
                      title="Calamba City Hall: office and entrance locations",
                      author="Jace Penaranda").build(story)
    print("wrote " + pdf)


if __name__ == "__main__":
    main()
