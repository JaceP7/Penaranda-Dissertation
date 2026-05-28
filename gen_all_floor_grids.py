"""
Generate 75×75 grid layouts for ALL FOUR floors of Calamba City Hall.

  Floor 0 — Lower Ground
  Floor 1 — Ground (public entry)
  Floor 2 — Second
  Floor 3 — Third (executive)

For each floor, produces:
  - {floor}_grid.png        large printable grid for survey
  - {floor}_grid.json       drop-in data for the wayfinding-app
  - {floor}_reference.md    seed-coordinate reference per office

Some floors have more than 8 offices — those octants are split into two
half-rooms (left + right of the radial axis).
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math
import json

# ── Config ───────────────────────────────────────────────────────────────────
GRID_SIZE = 75
CENTER = (37, 37)

OUT_DIR = Path(r"C:\Users\Jace\Desktop\College Files\diko\dissertation\anon_floor_plans")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# FLAT-TOP octagon (flat edges at top/bottom/left/right) so the layout matches
# how the real building sits — not rotated. Vertices sit at the octant
# boundaries (±22.5° offsets) so radial walls cleanly separate the 8 rooms.
# OUTER[i] / INNER[i] are the wall between octant (i-1) and octant i.
OUTER = [
    (24, 68),   # i=0  boundary  -22.5deg (NE corner of E edge)
    (50, 68),   # i=1  boundary   22.5deg (SE corner of E edge)
    (68, 50),   # i=2  boundary   67.5deg (SE corner of S edge)
    (68, 24),   # i=3  boundary  112.5deg (SW corner of S edge)
    (50, 6),    # i=4  boundary  157.5deg (SW corner of W edge)
    (24, 6),    # i=5  boundary  202.5deg (NW corner of W edge)
    (6, 24),    # i=6  boundary  247.5deg (NW corner of N edge)
    (6, 50),    # i=7  boundary  292.5deg (NE corner of N edge)
]
INNER = [
    (32, 49),   # i=0
    (42, 49),   # i=1
    (49, 42),   # i=2
    (49, 32),   # i=3
    (42, 25),   # i=4
    (32, 25),   # i=5
    (25, 32),   # i=6
    (25, 42),   # i=7
]

# Stair positions — same on every floor for inter-floor consistency.
# Placed in the atrium ring near the four flat edges.
STAIRS = [(13, 37), (37, 13), (37, 58), (58, 37)]

# Main entry — only Ground Floor has it. Bottom flat edge spans cols ~24-50.
MAIN_ENTRY_GROUND = [(68, 35), (68, 36), (68, 37), (68, 38), (68, 39)]


# ── Floor data ───────────────────────────────────────────────────────────────
# Each room: {"side": 0–7, "half": "full"|"left"|"right", "name", "code", "colour"}
# Side numbering: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE  (CW from East)

PALETTE = {
    "peach":  (254, 215, 170),
    "yellow": (253, 230, 138),
    "mint":   (167, 243, 208),
    "sky":    (191, 219, 254),
    "violet": (196, 181, 253),
    "pink":   (252, 165, 165),
    "orange": (253, 186, 116),
    "green":  (134, 239, 172),
    "rose":   (251, 207, 232),
    "amber":  (252, 211, 77),
    "lime":   (190, 242, 100),
    "cyan":   (165, 243, 252),
    "indigo": (199, 210, 254),
    "teal":   (153, 246, 228),
    "gray":   (226, 232, 240),
}

# ── FLOOR 0 — LOWER GROUND ────────────────────────────────────────────────────
# 12 offices arranged around octagon (4 sides have 2 rooms each)
FLOOR_0 = {
    "title": "LOWER GROUND FLOOR",
    "subtitle": "Calamba City Hall · Floor 0 · 75×75 grid (~0.6 m/cell)",
    "filename_base": "floor_0_lower_ground",
    "has_main_entry": False,
    "rooms": [
        {"side": 6, "half": "left",  "name": "City Social Services",      "code": "CSSYDO",  "colour": PALETTE["pink"]},
        {"side": 6, "half": "right", "name": "Veterinary Services",       "code": "VET",     "colour": PALETTE["green"]},
        {"side": 7, "half": "full",  "name": "Agriculture Office",        "code": "AGRI",    "colour": PALETTE["lime"]},
        {"side": 0, "half": "full",  "name": "PWD Affairs Office",        "code": "PDAO",    "colour": PALETTE["amber"]},
        {"side": 1, "half": "left",  "name": "City Legal / Prosecutor",   "code": "LEGAL",   "colour": PALETTE["orange"]},
        {"side": 1, "half": "right", "name": "Cooperatives & Livelihood", "code": "COOP",    "colour": PALETTE["yellow"]},
        {"side": 2, "half": "left",  "name": "COMELEC (partner)",         "code": "COMELEC", "colour": PALETTE["gray"]},
        {"side": 2, "half": "right", "name": "Housing Office",            "code": "HOUSE",   "colour": PALETTE["mint"]},
        {"side": 3, "half": "full",  "name": "Landbank (partner)",        "code": "BANK",    "colour": PALETTE["sky"]},
        {"side": 4, "half": "full",  "name": "City Health Services",      "code": "HEALTH",  "colour": PALETTE["rose"]},
        {"side": 5, "half": "left",  "name": "Investment & Employment",   "code": "IIPESO",  "colour": PALETTE["violet"]},
        {"side": 5, "half": "right", "name": "City Treasury Annex",       "code": "TREAS-A", "colour": PALETTE["indigo"]},
    ],
}

# ── FLOOR 1 — GROUND ──────────────────────────────────────────────────────────
FLOOR_1 = {
    "title": "GROUND FLOOR",
    "subtitle": "Calamba City Hall · Floor 1 · Public entry level · 75×75 grid",
    "filename_base": "floor_1_ground",
    "has_main_entry": True,
    "rooms": [
        {"side": 0, "half": "full", "name": "MOPAC",                       "code": "MOPAC",  "colour": PALETTE["peach"]},
        {"side": 1, "half": "full", "name": "Business Permits",            "code": "BPLO",   "colour": PALETTE["yellow"]},
        {"side": 2, "half": "full", "name": "Lobby / Information",         "code": "LOBBY",  "colour": PALETTE["mint"]},
        {"side": 3, "half": "full", "name": "Tourism Office",              "code": "TOUR",   "colour": PALETTE["sky"]},
        {"side": 4, "half": "full", "name": "Local Civil Registry",        "code": "LCR",    "colour": PALETTE["violet"]},
        {"side": 5, "half": "full", "name": "General Services Office",     "code": "GSO",    "colour": PALETTE["pink"]},
        {"side": 6, "half": "full", "name": "City Treasury Office (Main)", "code": "TREAS",  "colour": PALETTE["orange"]},
        {"side": 7, "half": "full", "name": "City Assessment Office",      "code": "ASSESS", "colour": PALETTE["green"]},
    ],
}

# ── FLOOR 2 — SECOND ─────────────────────────────────────────────────────────
FLOOR_2 = {
    "title": "SECOND FLOOR",
    "subtitle": "Calamba City Hall · Floor 2 · 75×75 grid (~0.6 m/cell)",
    "filename_base": "floor_2_second",
    "has_main_entry": False,
    "rooms": [
        {"side": 6, "half": "left",  "name": "VMO Extension",            "code": "VMOX",   "colour": PALETTE["gray"]},
        {"side": 6, "half": "right", "name": "Building Regulatory",      "code": "BREG",   "colour": PALETTE["amber"]},
        {"side": 7, "half": "full",  "name": "Engineering Services",     "code": "ENGR",   "colour": PALETTE["green"]},
        {"side": 0, "half": "left",  "name": "MOEA",                     "code": "MOEA",   "colour": PALETTE["teal"]},
        {"side": 0, "half": "right", "name": "City Population Office",   "code": "POP",    "colour": PALETTE["lime"]},
        {"side": 1, "half": "full",  "name": "City Planning & Dev't",    "code": "CPDO",   "colour": PALETTE["mint"]},
        {"side": 2, "half": "full",  "name": "City Budget Office",       "code": "BUDGET", "colour": PALETTE["cyan"]},
        {"side": 3, "half": "full",  "name": "City Accounting",          "code": "ACCT",   "colour": PALETTE["sky"]},
        {"side": 4, "half": "full",  "name": "Human Resources",          "code": "HR",     "colour": PALETTE["violet"]},
        {"side": 5, "half": "left",  "name": "DILG (partner)",           "code": "DILG",   "colour": PALETTE["indigo"]},
        {"side": 5, "half": "right", "name": "Sectoral Affairs",         "code": "SECT",   "colour": PALETTE["pink"]},
        # CENRO wraps around to the side-6 left? No, let's give it a clean position
        # Already filled all 8 sides + 4 splits = 12 rooms; CENRO replaces VMOX label
        # Instead, swap one: actually let's keep VMOX, drop the duplicate. CENRO goes between HR and DILG slot... reposition:
    ],
}
# Fix: add CENRO by moving one item. We'll reshuffle floor 2 properly:
FLOOR_2["rooms"] = [
    {"side": 6, "half": "left",  "name": "Environment / CENRO",     "code": "CENRO",  "colour": PALETTE["lime"]},
    {"side": 6, "half": "right", "name": "Building Regulatory",     "code": "BREG",   "colour": PALETTE["amber"]},
    {"side": 7, "half": "full",  "name": "VMO Extension",           "code": "VMOX",   "colour": PALETTE["gray"]},
    {"side": 0, "half": "left",  "name": "Engineering Services",    "code": "ENGR",   "colour": PALETTE["green"]},
    {"side": 0, "half": "right", "name": "MOEA",                    "code": "MOEA",   "colour": PALETTE["teal"]},
    {"side": 1, "half": "left",  "name": "City Population Office",  "code": "POP",    "colour": PALETTE["mint"]},
    {"side": 1, "half": "right", "name": "City Planning & Dev't",   "code": "CPDO",   "colour": PALETTE["yellow"]},
    {"side": 2, "half": "full",  "name": "City Budget Office",      "code": "BUDGET", "colour": PALETTE["cyan"]},
    {"side": 3, "half": "full",  "name": "City Accounting",         "code": "ACCT",   "colour": PALETTE["sky"]},
    {"side": 4, "half": "full",  "name": "Human Resources",         "code": "HR",     "colour": PALETTE["violet"]},
    {"side": 5, "half": "left",  "name": "DILG (partner)",          "code": "DILG",   "colour": PALETTE["indigo"]},
    {"side": 5, "half": "right", "name": "Sectoral Affairs",        "code": "SECT",   "colour": PALETTE["pink"]},
]

# ── FLOOR 3 — THIRD ──────────────────────────────────────────────────────────
FLOOR_3 = {
    "title": "THIRD FLOOR",
    "subtitle": "Calamba City Hall · Floor 3 · Executive level · 75×75 grid",
    "filename_base": "floor_3_third",
    "has_main_entry": False,
    "rooms": [
        {"side": 6, "half": "left",  "name": "Sangguniang Bayan Secretariat", "code": "SB-SEC",  "colour": PALETTE["amber"]},
        {"side": 6, "half": "right", "name": "Office of the City Mayor",      "code": "MAYOR",   "colour": PALETTE["orange"]},
        {"side": 7, "half": "full",  "name": "City Administration",           "code": "ADMIN",   "colour": PALETTE["yellow"]},
        {"side": 0, "half": "full",  "name": "Councillors' Offices (E)",      "code": "COUN-E",  "colour": PALETTE["green"]},
        {"side": 1, "half": "full",  "name": "Councillors' Offices (SE)",     "code": "COUN-SE", "colour": PALETTE["mint"]},
        {"side": 2, "half": "left",  "name": "Councillors' Offices (S)",      "code": "COUN-S",  "colour": PALETTE["cyan"]},
        {"side": 2, "half": "right", "name": "Population (Annex)",            "code": "POP-A",   "colour": PALETTE["sky"]},
        {"side": 3, "half": "full",  "name": "CCEMPC",                        "code": "CCEMPC",  "colour": PALETTE["indigo"]},
        {"side": 4, "half": "full",  "name": "Councillors' Offices (W)",      "code": "COUN-W",  "colour": PALETTE["violet"]},
        {"side": 5, "half": "left",  "name": "Office of the Vice Mayor",      "code": "VMAYOR",  "colour": PALETTE["pink"]},
        {"side": 5, "half": "right", "name": "Councillors' Offices (NW)",     "code": "COUN-NW", "colour": PALETTE["rose"]},
    ],
}

FLOORS = [FLOOR_0, FLOOR_1, FLOOR_2, FLOOR_3]


# ── Geometry helpers ─────────────────────────────────────────────────────────

def point_in_polygon(p, poly):
    r, c = p
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        ri, ci = poly[i]
        rj, cj = poly[j]
        if ((ri > r) != (rj > r)) and \
           (c < (cj - ci) * (r - ri) / (rj - ri + 1e-9) + ci):
            inside = not inside
        j = i
    return inside


def cell_subangle(r, c):
    """Return (octant 0–7, subangle in [-22.5, 22.5] within the octant)."""
    dr = r - CENTER[0]
    dc = c - CENTER[1]
    if dr == 0 and dc == 0:
        return 0, 0.0
    angle = math.degrees(math.atan2(dr, dc))  # -180..180
    if angle < 0:
        angle += 360
    octant_pos = (angle + 22.5) % 360
    octant = int(octant_pos // 45)
    sub = (octant_pos % 45) - 22.5
    return octant, sub


def trace_line(p1, p2):
    r1, c1 = p1
    r2, c2 = p2
    steps = max(abs(r2 - r1), abs(c2 - c1)) + 1
    cells = []
    for i in range(steps):
        t = i / max(steps - 1, 1)
        r = round(r1 + (r2 - r1) * t)
        c = round(c1 + (c2 - c1) * t)
        if 0 <= r < GRID_SIZE and 0 <= c < GRID_SIZE:
            cells.append((r, c))
    return cells


def thick_line(p1, p2, thickness=2):
    cells = set(trace_line(p1, p2))
    for _ in range(thickness - 1):
        more = set()
        for (r, c) in cells:
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    more.add((r + dr, c + dc))
        cells |= more
    return [(r, c) for r, c in cells
            if 0 <= r < GRID_SIZE and 0 <= c < GRID_SIZE]


def radial_line(octant_index):
    """A line from centre outward along the boundary between octant i-1 and i."""
    # The boundary lies at angle = octant_index * 45° - 22.5° from east
    angle = math.radians(octant_index * 45 - 22.5)
    r_out = CENTER[0] + 35 * math.sin(angle)
    c_out = CENTER[1] + 35 * math.cos(angle)
    return trace_line(CENTER, (round(r_out), round(c_out)))


# ── Build one floor ──────────────────────────────────────────────────────────

def build_floor(floor_cfg):
    rooms_cfg = floor_cfg["rooms"]
    has_entry = floor_cfg["has_main_entry"]

    # Lookup: (side, half) → room code
    # If a side has any "left"/"right" entry, treat as split. Otherwise "full".
    side_layout = {}
    for room in rooms_cfg:
        side = room["side"]
        if room["half"] == "full":
            side_layout.setdefault(side, {})["full"] = room
        else:
            side_layout.setdefault(side, {})[room["half"]] = room

    grid = [["outside"] * GRID_SIZE for _ in range(GRID_SIZE)]
    room_map = [[None] * GRID_SIZE for _ in range(GRID_SIZE)]

    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            pt = (r + 0.5, c + 0.5)
            if not point_in_polygon(pt, OUTER):
                grid[r][c] = "outside"
                continue
            if point_in_polygon(pt, INNER):
                grid[r][c] = "atrium"
                continue
            oct_idx, sub = cell_subangle(r, c)
            slots = side_layout.get(oct_idx, {})
            chosen = None
            if "full" in slots:
                chosen = slots["full"]
            elif "left" in slots or "right" in slots:
                # split — sub < 0 → "left" (CCW half), sub > 0 → "right"
                if sub <= 0 and "left" in slots:
                    chosen = slots["left"]
                elif sub > 0 and "right" in slots:
                    chosen = slots["right"]
                else:
                    chosen = slots.get("left") or slots.get("right")
            if chosen:
                grid[r][c] = "open"
                room_map[r][c] = chosen["code"]

    # Walls along octant boundaries (outer→inner radial lines)
    for i in range(8):
        for cell in thick_line(OUTER[i], INNER[i], thickness=2):
            if grid[cell[0]][cell[1]] not in ("outside", "atrium"):
                grid[cell[0]][cell[1]] = "wall"
                room_map[cell[0]][cell[1]] = None

    # Walls between sub-rooms in split octants (radial from centre to inner vertex)
    for side, slots in side_layout.items():
        if "left" in slots and "right" in slots:
            # mid-radial line: from atrium edge to outer edge, midway between
            # the two side vertices
            outer_mid = (
                (OUTER[side][0] + OUTER[(side + 1) % 8][0]) // 2,
                (OUTER[side][1] + OUTER[(side + 1) % 8][1]) // 2,
            )
            inner_mid = (
                (INNER[side][0] + INNER[(side + 1) % 8][0]) // 2,
                (INNER[side][1] + INNER[(side + 1) % 8][1]) // 2,
            )
            for cell in thick_line(outer_mid, inner_mid, thickness=2):
                if grid[cell[0]][cell[1]] not in ("outside", "atrium"):
                    grid[cell[0]][cell[1]] = "wall"
                    room_map[cell[0]][cell[1]] = None

    # Inner atrium perimeter walls + doors at midpoints
    inner_perimeter = []
    for i in range(8):
        inner_perimeter.extend(trace_line(INNER[i], INNER[(i + 1) % 8]))

    door_cells = set()
    for side, slots in side_layout.items():
        line = trace_line(INNER[side], INNER[(side + 1) % 8])
        if "full" in slots:
            mid = len(line) // 2
            for di in (-1, 0, 1):
                if 0 <= mid + di < len(line):
                    door_cells.add(line[mid + di])
        else:
            # Two rooms: place doors at 1/4 and 3/4 along the edge
            for frac in (0.25, 0.75):
                idx = int(len(line) * frac)
                for di in (-1, 0, 1):
                    if 0 <= idx + di < len(line):
                        door_cells.add(line[idx + di])

    for cell in inner_perimeter:
        if cell in door_cells:
            continue
        if grid[cell[0]][cell[1]] == "atrium":
            grid[cell[0]][cell[1]] = "wall"
            room_map[cell[0]][cell[1]] = None

    # Outer wall + main entry
    outer_perimeter = []
    for i in range(8):
        outer_perimeter.extend(trace_line(OUTER[i], OUTER[(i + 1) % 8]))

    main_entry_set = set(MAIN_ENTRY_GROUND) if has_entry else set()
    for cell in outer_perimeter:
        if cell in main_entry_set:
            grid[cell[0]][cell[1]] = "entry"
            continue
        grid[cell[0]][cell[1]] = "wall"
        room_map[cell[0]][cell[1]] = None

    for cell in door_cells:
        grid[cell[0]][cell[1]] = "door"

    for r, c in STAIRS:
        for dr in (0, 1):
            for dc in (0, 1):
                rr, cc = r + dr, c + dc
                if 0 <= rr < GRID_SIZE and 0 <= cc < GRID_SIZE:
                    grid[rr][cc] = "stair"

    return grid, room_map, rooms_cfg


# ── PNG rendering ────────────────────────────────────────────────────────────

CELL = 14
PAD_L = 80
PAD_T = 130
PAD_R = 400
PAD_B = 90
IMG_W = PAD_L + CELL * GRID_SIZE + PAD_R
IMG_H = PAD_T + CELL * GRID_SIZE + PAD_B

CELL_COLOURS = {
    "outside": (235, 235, 240),
    "wall":    (30, 41, 59),
    "open":    (255, 255, 255),
    "door":    (250, 204, 21),
    "stair":   (251, 146, 60),
    "atrium":  (226, 232, 240),
    "entry":   (34, 197, 94),
}


def get_font(size, bold=False):
    try:
        return ImageFont.truetype("arialbd.ttf" if bold else "arial.ttf", size)
    except (IOError, OSError):
        return ImageFont.load_default()


def render_floor(floor_cfg, grid, room_map, rooms_cfg):
    img = Image.new("RGB", (IMG_W, IMG_H), (250, 250, 252))
    draw = ImageDraw.Draw(img)

    f_title  = get_font(30, bold=True)
    f_sub    = get_font(15)
    f_axis   = get_font(10, bold=True)
    f_axis_M = get_font(11, bold=True)
    f_room   = get_font(14, bold=True)
    f_legend = get_font(12)
    f_small  = get_font(11)
    f_header = get_font(14, bold=True)

    draw.text((PAD_L, 30), floor_cfg["title"], font=f_title, fill=(15, 23, 42))
    draw.text((PAD_L, 75), floor_cfg["subtitle"], font=f_sub, fill=(100, 116, 139))

    # Axis labels every 5 cells
    for c in range(GRID_SIZE):
        x = PAD_L + c * CELL + CELL // 2
        if c % 5 == 0:
            draw.text((x, PAD_T - 22), str(c), font=f_axis_M,
                      fill=(15, 23, 42), anchor="mm")
    for r in range(GRID_SIZE):
        y = PAD_T + r * CELL + CELL // 2
        if r % 5 == 0:
            draw.text((PAD_L - 22, y), str(r), font=f_axis_M,
                      fill=(15, 23, 42), anchor="mm")

    room_fill = {room["code"]: room["colour"] for room in rooms_cfg}

    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            x1 = PAD_L + c * CELL
            y1 = PAD_T + r * CELL
            x2, y2 = x1 + CELL, y1 + CELL
            kind = grid[r][c]
            if kind == "open" and room_map[r][c]:
                colour = room_fill[room_map[r][c]]
            else:
                colour = CELL_COLOURS[kind]
            major = (r % 5 == 0 or c % 5 == 0)
            border = (180, 195, 215) if major else (220, 228, 240)
            draw.rectangle([x1, y1, x2, y2], fill=colour,
                           outline=border, width=1)

    # Major gridlines
    for k in range(0, GRID_SIZE + 1, 5):
        x = PAD_L + k * CELL
        draw.line([(x, PAD_T), (x, PAD_T + GRID_SIZE * CELL)],
                  fill=(148, 163, 184), width=1)
        y = PAD_T + k * CELL
        draw.line([(PAD_L, y), (PAD_L + GRID_SIZE * CELL, y)],
                  fill=(148, 163, 184), width=1)

    # Marker text
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            kind = grid[r][c]
            marker = {"stair": "S", "door": "D", "entry": "E"}.get(kind)
            if marker:
                x1 = PAD_L + c * CELL
                y1 = PAD_T + r * CELL
                draw.text((x1 + CELL // 2, y1 + CELL // 2), marker,
                          font=f_axis_M, fill=(15, 23, 42), anchor="mm")

    # Room labels
    room_cells = {room["code"]: [] for room in rooms_cfg}
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            if grid[r][c] == "open" and room_map[r][c]:
                room_cells[room_map[r][c]].append((r, c))

    suggested = {}
    for room in rooms_cfg:
        cells = room_cells[room["code"]]
        if not cells:
            continue
        avg_r = sum(rr for rr, _ in cells) / len(cells)
        avg_c = sum(cc for _, cc in cells) / len(cells)
        cx = PAD_L + avg_c * CELL + CELL // 2
        cy = PAD_T + avg_r * CELL + CELL // 2
        # Use short code on the map, full name in legend
        label = room["code"]
        bbox = draw.textbbox((cx, cy), label, font=f_room, anchor="mm")
        pad = 5
        draw.rectangle([bbox[0] - pad, bbox[1] - pad,
                        bbox[2] + pad, bbox[3] + pad],
                       fill=(255, 255, 255), outline=(15, 23, 42), width=2)
        draw.text((cx, cy), label, font=f_room, fill=(15, 23, 42), anchor="mm")

        suggested[room["name"]] = {
            "floor": FLOORS.index(floor_cfg),
            "row": round(avg_r),
            "col": round(avg_c),
            "code": room["code"],
        }

    # Legend
    lx = PAD_L + CELL * GRID_SIZE + 30
    ly = PAD_T

    draw.text((lx, ly), "LEGEND", font=f_header, fill=(15, 23, 42))
    ly += 28
    for label, colour in [
        ("Wall / Outside", (30, 41, 59)),
        ("Atrium (open)",  (226, 232, 240)),
        ("Door (D)",       (250, 204, 21)),
        ("Stair (S)",      (251, 146, 60)),
        ("Main Entry (E)", (34, 197, 94)),
    ]:
        draw.rectangle([lx, ly, lx + 22, ly + 22], fill=colour,
                       outline=(15, 23, 42), width=1)
        draw.text((lx + 30, ly + 11), label, font=f_legend,
                  fill=(15, 23, 42), anchor="lm")
        ly += 28

    ly += 10
    draw.text((lx, ly), "ROOMS", font=f_header, fill=(15, 23, 42))
    ly += 24
    for room in rooms_cfg:
        draw.rectangle([lx, ly, lx + 22, ly + 22], fill=room["colour"],
                       outline=(15, 23, 42), width=1)
        draw.text((lx + 30, ly + 11),
                  f"{room['code']}  —  {room['name']}",
                  font=f_legend, fill=(15, 23, 42), anchor="lm")
        ly += 24

    ly += 10
    draw.text((lx, ly), "SCALE", font=f_header, fill=(15, 23, 42))
    ly += 22
    for n in ["• 1 cell ≈ 0.6 m",
              "• Grid: 75 × 0.6 m = 45 m",
              "• Major gridlines: every 5 cells (~3 m)"]:
        draw.text((lx, ly), n, font=f_legend, fill=(71, 85, 105))
        ly += 18

    draw.text((IMG_W // 2, IMG_H - 40),
              "Print at A2 or larger for on-site annotation",
              font=f_small, fill=(100, 116, 139), anchor="mm")

    out = OUT_DIR / f"{floor_cfg['filename_base']}_grid.png"
    img.save(out, "PNG")
    print(f"PNG:  {out}")
    return suggested, room_cells


# ── JSON + MD export ─────────────────────────────────────────────────────────

def export_floor_data(floor_cfg, grid, room_map, rooms_cfg, suggested, room_cells):
    walls, stairs_l, doors_l, entries_l = [], [], [], []
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            kind = grid[r][c]
            if kind in ("wall", "outside"):
                walls.append([r, c])
            elif kind == "stair":
                stairs_l.append([r, c])
            elif kind == "door":
                doors_l.append([r, c])
            elif kind == "entry":
                entries_l.append([r, c])

    floor_idx = FLOORS.index(floor_cfg)
    data = {
        "floor_index": floor_idx,
        "floor_label": floor_cfg["title"].title(),
        "grid_size": GRID_SIZE,
        "metres_per_cell_estimate": 0.6,
        "walls": walls,
        "stairs": stairs_l,
        "doors": doors_l,
        "entries": entries_l,
        "rooms": {
            room["code"]: {
                "name": room["name"],
                "cells": [[r, c] for r, c in room_cells[room["code"]]],
            }
            for room in rooms_cfg
        },
        "suggested_department_coords": suggested,
    }
    j = OUT_DIR / f"{floor_cfg['filename_base']}_grid.json"
    j.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"JSON: {j}")

    md = [
        f"# {floor_cfg['title']} — 75×75 Grid Reference",
        "",
        f"{floor_cfg['subtitle']}",
        "",
        "| Code | Office | Floor | Row | Col | Open Cells |",
        "|---|---|---|---|---|---|",
    ]
    for room in rooms_cfg:
        s = suggested.get(room["name"])
        if s:
            n_cells = len(room_cells[room["code"]])
            md.append(f"| {room['code']} | {room['name']} | "
                      f"{s['floor']} | {s['row']} | {s['col']} | {n_cells} |")

    md.extend([
        "",
        "## Stair cells (floor transitions)",
        "",
    ])
    for r, c in STAIRS:
        md.append(f"- Stair anchor at row **{r}**, col **{c}** (2×2 footprint)")

    if floor_cfg["has_main_entry"]:
        md.extend(["", "## Main entry cells (south wall)", ""])
        for r, c in MAIN_ENTRY_GROUND:
            md.append(f"- Entry at row **{r}**, col **{c}**")

    n_open    = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                    if grid[r][c] == "open")
    n_atrium  = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                    if grid[r][c] == "atrium")
    n_wall    = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                    if grid[r][c] == "wall")
    n_outside = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                    if grid[r][c] == "outside")

    md.extend([
        "",
        "## Cell counts",
        "",
        f"- Open (walkable office floor): {n_open}",
        f"- Atrium (central corridor):    {n_atrium}",
        f"- Wall:                          {n_wall}",
        f"- Outside (unreachable):         {n_outside}",
        f"- Door:                          {len(doors_l)}",
        f"- Stair:                         {len(stairs_l)}",
        f"- Entry:                         {len(entries_l)}",
    ])
    m = OUT_DIR / f"{floor_cfg['filename_base']}_reference.md"
    m.write_text("\n".join(md), encoding="utf-8")
    print(f"MD:   {m}")


# ── Run all floors ───────────────────────────────────────────────────────────

all_suggested = {}
for fcfg in FLOORS:
    print(f"\n=== {fcfg['title']} ===")
    grid, room_map, rooms_cfg = build_floor(fcfg)
    suggested, room_cells = render_floor(fcfg, grid, room_map, rooms_cfg)
    export_floor_data(fcfg, grid, room_map, rooms_cfg, suggested, room_cells)
    all_suggested[fcfg["title"]] = suggested

# Combined departments.json suggestion
all_path = OUT_DIR / "all_floors_suggested_coords.json"
all_path.write_text(json.dumps(all_suggested, indent=2), encoding="utf-8")
print(f"\nCombined suggested coords: {all_path}")
print(f"\nAll outputs in: {OUT_DIR}")
