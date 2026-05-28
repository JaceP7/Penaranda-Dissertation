"""
Generate the 75×75 grid layout for the Ground Floor of Calamba City Hall.

Outputs:
  1. ground_floor_grid.png      — large printable grid for survey use
  2. ground_floor_grid.json     — drop-in for wayfinding-app data
  3. ground_floor_reference.md  — text reference table

The grid maps the octagonal building footprint onto 75×75 cells, sized to
roughly match the real building proportions. At ~0.6 m per cell, a 75-cell
edge corresponds to ~45 m of building width — close to actual scale.

Cell types: open ('.'), wall ('#'), door ('D'), stair ('S')

NOTE: The current wayfinding-app/js/data.js is built for a 25×25 grid.
If you want to use this 75×75 layout in the live app, you'll need to update
the GRID_SIZE constant in data.js and rebuild the NODES table.
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

# Outer octagon vertices in (row, col) — clockwise from N
# Span row 5–70, col 5–70 → leaves 5-cell margin on all sides
OUTER = [
    (5, 37),    # N
    (15, 60),   # NE
    (37, 70),   # E
    (60, 60),   # SE
    (70, 37),   # S
    (60, 15),   # SW
    (37, 5),    # W
    (15, 15),   # NW
]
# Inner atrium octagon vertices (~13 cells from centre)
INNER = [
    (24, 37),
    (28, 46),
    (37, 50),
    (46, 46),
    (50, 37),
    (46, 28),
    (37, 24),
    (28, 28),
]

# ── Room assignments per octant ──────────────────────────────────────────────
# Octant 0..7 starting at East, going clockwise (image coords: row increases down)
# matches angle ranges: E, SE, S, SW, W, NW, N, NE
ROOMS = [
    (0, "MOPAC",                        "MOPAC",  (254, 215, 170)),
    (1, "Business Permits",             "BPLO",   (253, 230, 138)),
    (2, "Lobby / Information",          "LOBBY",  (167, 243, 208)),
    (3, "Tourism Office",               "TOUR",   (191, 219, 254)),
    (4, "Local Civil Registry",         "LCR",    (196, 181, 253)),
    (5, "General Services Office",      "GSO",    (252, 165, 165)),
    (6, "City Treasury Office (Main)",  "TREAS",  (253, 186, 116)),
    (7, "City Assessment Office",       "ASSESS", (134, 239, 172)),
]

# Stair / elevator cells — between outer wall and atrium
STAIRS = [
    (15, 37),   # north stair
    (37, 18),   # west stair
    (37, 57),   # east stair
    (57, 37),   # south stair
]

# Main entry — south side, wider opening (~3 m at 0.6 m/cell ≈ 5 cells)
MAIN_ENTRY = [(70, 35), (70, 36), (70, 37), (70, 38), (70, 39)]


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


def cell_octant(r, c):
    dr = r - CENTER[0]
    dc = c - CENTER[1]
    if dr == 0 and dc == 0:
        return 0
    angle = math.degrees(math.atan2(dr, dc))
    if angle < 0:
        angle += 360
    octant = int(((angle + 22.5) % 360) // 45)
    return octant


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
    """Trace a line and dilate by `thickness` cells perpendicular to it."""
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


# ── Build the grid ───────────────────────────────────────────────────────────

grid = [["outside" for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]
room_map = [[None for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]

for r in range(GRID_SIZE):
    for c in range(GRID_SIZE):
        pt = (r + 0.5, c + 0.5)
        if not point_in_polygon(pt, OUTER):
            grid[r][c] = "outside"
            continue
        if point_in_polygon(pt, INNER):
            grid[r][c] = "atrium"
            continue
        oct_idx = cell_octant(r, c)
        grid[r][c] = "open"
        for o, name, code, _ in ROOMS:
            if o == oct_idx:
                room_map[r][c] = code
                break

# Walls between rooms — from outer to inner vertex, thick=2
for i in range(8):
    for cell in thick_line(OUTER[i], INNER[i], thickness=2):
        if grid[cell[0]][cell[1]] not in ("outside", "atrium"):
            grid[cell[0]][cell[1]] = "wall"
            room_map[cell[0]][cell[1]] = None

# Inner atrium perimeter walls — except door midpoints
inner_perimeter = []
for i in range(8):
    p1 = INNER[i]
    p2 = INNER[(i + 1) % 8]
    inner_perimeter.extend(trace_line(p1, p2))

door_cells = set()
for i in range(8):
    p1 = INNER[i]
    p2 = INNER[(i + 1) % 8]
    line = trace_line(p1, p2)
    # door is 3 cells wide at the midpoint of each inner edge
    mid_i = len(line) // 2
    for di in (-1, 0, 1):
        idx = mid_i + di
        if 0 <= idx < len(line):
            door_cells.add(line[idx])

for cell in inner_perimeter:
    if cell in door_cells:
        continue
    if grid[cell[0]][cell[1]] == "atrium":
        grid[cell[0]][cell[1]] = "wall"
        room_map[cell[0]][cell[1]] = None

# Outer perimeter walls — except main entry
outer_perimeter = []
for i in range(8):
    p1 = OUTER[i]
    p2 = OUTER[(i + 1) % 8]
    outer_perimeter.extend(trace_line(p1, p2))

main_entry_set = set(MAIN_ENTRY)
for cell in outer_perimeter:
    if cell in main_entry_set:
        grid[cell[0]][cell[1]] = "entry"
        room_map[cell[0]][cell[1]] = "LOBBY"
        continue
    grid[cell[0]][cell[1]] = "wall"
    room_map[cell[0]][cell[1]] = None

# Doors
for cell in door_cells:
    grid[cell[0]][cell[1]] = "door"

# Stairs (2×2 footprint — closer to a real stairwell)
expanded_stairs = []
for r, c in STAIRS:
    for dr in (0, 1):
        for dc in (0, 1):
            rr, cc = r + dr, c + dc
            if 0 <= rr < GRID_SIZE and 0 <= cc < GRID_SIZE:
                grid[rr][cc] = "stair"
                expanded_stairs.append((rr, cc))


# ── Visualization PNG ────────────────────────────────────────────────────────

CELL = 14
PAD_L = 80
PAD_T = 130
PAD_R = 360
PAD_B = 90
W = PAD_L + CELL * GRID_SIZE + PAD_R
H = PAD_T + CELL * GRID_SIZE + PAD_B

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


img = Image.new("RGB", (W, H), (250, 250, 252))
draw = ImageDraw.Draw(img)

f_title = get_font(30, bold=True)
f_sub   = get_font(15)
f_axis  = get_font(10, bold=True)
f_axis_major = get_font(11, bold=True)
f_room  = get_font(16, bold=True)
f_legend = get_font(13)
f_small = get_font(11)

# Title
draw.text((PAD_L, 30), "GROUND FLOOR · 75×75 GRID (Floor 1)",
          font=f_title, fill=(15, 23, 42))
draw.text((PAD_L, 75),
          "Survey reference — proportional to actual building "
          "(~0.6 m per cell)",
          font=f_sub, fill=(100, 116, 139))

# Axis labels — every 5 cells
for c in range(GRID_SIZE):
    x = PAD_L + c * CELL + CELL // 2
    if c % 5 == 0:
        draw.text((x, PAD_T - 22), str(c), font=f_axis_major,
                  fill=(15, 23, 42), anchor="mm")
    elif c % 5 == 4:
        draw.text((x, PAD_T - 22), str(c), font=f_axis,
                  fill=(148, 163, 184), anchor="mm")
for r in range(GRID_SIZE):
    y = PAD_T + r * CELL + CELL // 2
    if r % 5 == 0:
        draw.text((PAD_L - 22, y), str(r), font=f_axis_major,
                  fill=(15, 23, 42), anchor="mm")
    elif r % 5 == 4:
        draw.text((PAD_L - 22, y), str(r), font=f_axis,
                  fill=(148, 163, 184), anchor="mm")

room_fill = {code: col for _, _, code, col in ROOMS}

# Draw cells
for r in range(GRID_SIZE):
    for c in range(GRID_SIZE):
        x1 = PAD_L + c * CELL
        y1 = PAD_T + r * CELL
        x2 = x1 + CELL
        y2 = y1 + CELL

        kind = grid[r][c]
        if kind == "open" and room_map[r][c]:
            colour = room_fill[room_map[r][c]]
        else:
            colour = CELL_COLOURS[kind]

        # Lighter border every 5 cells creates a faint major-grid
        major = (r % 5 == 0 or c % 5 == 0)
        border = (180, 195, 215) if major else (220, 228, 240)
        draw.rectangle([x1, y1, x2, y2], fill=colour,
                       outline=border, width=1)

# Major gridlines (every 5 cells) — thicker overlay
for k in range(0, GRID_SIZE + 1, 5):
    x = PAD_L + k * CELL
    y0 = PAD_T
    y1 = PAD_T + GRID_SIZE * CELL
    draw.line([(x, y0), (x, y1)], fill=(148, 163, 184), width=1)
    y = PAD_T + k * CELL
    x0 = PAD_L
    x1 = PAD_L + GRID_SIZE * CELL
    draw.line([(x0, y), (x1, y)], fill=(148, 163, 184), width=1)

# Markers for special cells
for r in range(GRID_SIZE):
    for c in range(GRID_SIZE):
        kind = grid[r][c]
        marker = None
        if kind == "stair":
            marker = "S"
        elif kind == "door":
            marker = "D"
        elif kind == "entry":
            marker = "E"
        if marker:
            x1 = PAD_L + c * CELL
            y1 = PAD_T + r * CELL
            draw.text((x1 + CELL // 2, y1 + CELL // 2), marker,
                      font=f_axis_major, fill=(15, 23, 42), anchor="mm")

# Room name labels (centred on each room's open area)
room_cells = {code: [] for _, _, code, _ in ROOMS}
for r in range(GRID_SIZE):
    for c in range(GRID_SIZE):
        if grid[r][c] == "open" and room_map[r][c]:
            room_cells[room_map[r][c]].append((r, c))

for _, name, code, _ in ROOMS:
    cells = room_cells[code]
    if not cells:
        continue
    avg_r = sum(rr for rr, _ in cells) / len(cells)
    avg_c = sum(cc for _, cc in cells) / len(cells)
    cx = PAD_L + avg_c * CELL + CELL // 2
    cy = PAD_T + avg_r * CELL + CELL // 2
    bbox = draw.textbbox((cx, cy), name, font=f_room, anchor="mm")
    pad = 6
    draw.rectangle([bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad],
                   fill=(255, 255, 255), outline=(15, 23, 42), width=2)
    draw.text((cx, cy), name, font=f_room, fill=(15, 23, 42), anchor="mm")

# Legend panel
lx = PAD_L + CELL * GRID_SIZE + 40
ly = PAD_T

draw.text((lx, ly), "LEGEND", font=f_room, fill=(15, 23, 42))
ly += 32

legend_items = [
    ("Wall / Outside",    (30, 41, 59)),
    ("Atrium (open)",     (226, 232, 240)),
    ("Door (D)",          (250, 204, 21)),
    ("Stair (S)",         (251, 146, 60)),
    ("Main Entry (E)",    (34, 197, 94)),
]
for label, colour in legend_items:
    draw.rectangle([lx, ly, lx + 22, ly + 22], fill=colour,
                   outline=(15, 23, 42), width=1)
    draw.text((lx + 32, ly + 11), label, font=f_legend,
              fill=(15, 23, 42), anchor="lm")
    ly += 30

ly += 12
draw.text((lx, ly), "ROOMS", font=f_room, fill=(15, 23, 42))
ly += 28

for _, name, code, colour in ROOMS:
    draw.rectangle([lx, ly, lx + 22, ly + 22], fill=colour,
                   outline=(15, 23, 42), width=1)
    draw.text((lx + 32, ly + 11), f"{code}  —  {name}",
              font=f_legend, fill=(15, 23, 42), anchor="lm")
    ly += 30

ly += 16
draw.text((lx, ly), "SCALE", font=f_room, fill=(15, 23, 42))
ly += 24
scale_notes = [
    "• 1 cell ≈ 0.6 m",
    "• Grid edge: 75 × 0.6 m = 45 m",
    "• Atrium diameter ≈ 16 m",
    "• Room depth ≈ 6–10 m",
]
for n in scale_notes:
    draw.text((lx, ly), n, font=f_legend, fill=(71, 85, 105))
    ly += 20

ly += 12
draw.text((lx, ly), "SURVEY NOTES", font=f_room, fill=(15, 23, 42))
ly += 22
notes = [
    "• Walk each office perimeter",
    "  and mark corner cells",
    "• Adjust door positions",
    "  if different from grid",
    "• Choose 4–6 QR anchor cells",
    "  (must be open cells)",
    "• Measure one corridor",
    "  to confirm metresPerCell",
]
for n in notes:
    draw.text((lx, ly), n, font=f_legend, fill=(71, 85, 105))
    ly += 18

# Footer
draw.text((W // 2, H - 40),
          "Print at A2 or larger for on-site annotation. "
          "Major gridlines every 5 cells = ~3 m.",
          font=f_small, fill=(100, 116, 139), anchor="mm")

png_path = OUT_DIR / "ground_floor_grid.png"
img.save(png_path, "PNG")
print(f"PNG:  {png_path}  ({W}×{H} px)")


# ── JSON export ──────────────────────────────────────────────────────────────

wall_cells = []
stair_cells = []
door_cells_list = []
entry_cells_list = []
room_assignments = {code: [] for _, _, code, _ in ROOMS}

for r in range(GRID_SIZE):
    for c in range(GRID_SIZE):
        kind = grid[r][c]
        if kind in ("wall", "outside"):
            wall_cells.append([r, c])
        elif kind == "stair":
            stair_cells.append([r, c])
        elif kind == "door":
            door_cells_list.append([r, c])
        elif kind == "entry":
            entry_cells_list.append([r, c])
        if kind == "open" and room_map[r][c]:
            room_assignments[room_map[r][c]].append([r, c])

# Suggested seed coordinates per office
suggested_targets = {}
for _, name, code, _ in ROOMS:
    cells = room_assignments[code]
    if cells:
        avg_r = round(sum(cr for cr, _ in cells) / len(cells))
        avg_c = round(sum(cc for _, cc in cells) / len(cells))
        suggested_targets[name] = {
            "floor": 1,
            "row": avg_r,
            "col": avg_c,
            "code": code,
        }

export = {
    "floor_index": 1,
    "floor_label": "Ground Floor",
    "grid_size": GRID_SIZE,
    "metres_per_cell_estimate": 0.6,
    "walls":   wall_cells,
    "stairs":  stair_cells,
    "doors":   door_cells_list,
    "entries": entry_cells_list,
    "rooms": {
        code: {
            "name":   name,
            "cells":  room_assignments[code],
        }
        for _, name, code, _ in ROOMS
    },
    "suggested_department_coords": suggested_targets,
    "note": (
        "75×75 grid. Suggested coordinates are centroids — verify on-site. "
        "Update departments.json after survey. NOTE: js/data.js currently "
        "uses 25×25; bump GRID_SIZE there to use this layout in the app."
    ),
}

json_path = OUT_DIR / "ground_floor_grid.json"
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(export, f, indent=2)
print(f"JSON: {json_path}")


# ── Markdown reference table ─────────────────────────────────────────────────

n_open    = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                if grid[r][c] == "open")
n_atrium  = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                if grid[r][c] == "atrium")
n_wall    = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                if grid[r][c] == "wall")
n_outside = sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                if grid[r][c] == "outside")

md_lines = [
    "# Ground Floor — 75×75 Grid Reference",
    "",
    f"Total cells: {GRID_SIZE * GRID_SIZE} · "
    f"Estimated scale: ~0.6 m per cell · "
    f"Building width: ~{GRID_SIZE * 0.6:.0f} m",
    "",
    "Suggested seed coordinates for each office. Verify on-site and update "
    "`departments.json`.",
    "",
    "| Code | Office | Floor | Row | Col | Open Cells |",
    "|---|---|---|---|---|---|",
]
for _, name, code, _ in ROOMS:
    s = suggested_targets.get(name)
    n_cells = len(room_assignments[code])
    if s:
        md_lines.append(
            f"| {code} | {name} | {s['floor']} | {s['row']} | {s['col']} | "
            f"{n_cells} |"
        )

md_lines.extend([
    "",
    "## Stair cells (floor transitions)",
    "",
])
for r, c in STAIRS:
    md_lines.append(f"- Stair quadrant anchor at row **{r}**, col **{c}** "
                    f"(2×2 footprint extends down/right)")

md_lines.extend([
    "",
    "## Main entry cells (south wall)",
    "",
])
for r, c in MAIN_ENTRY:
    md_lines.append(f"- Entry at row **{r}**, col **{c}**")

md_lines.extend([
    "",
    "## Cell counts",
    "",
    f"- Open (walkable office floor): {n_open}",
    f"- Atrium (central corridor):    {n_atrium}",
    f"- Wall:                          {n_wall}",
    f"- Outside (unreachable):         {n_outside}",
    f"- Door:                          {len(door_cells_list)}",
    f"- Stair:                         {len(stair_cells)}",
    f"- Entry:                         {len(entry_cells_list)}",
    "",
    "## Implications for the live system",
    "",
    "- `js/data.js` currently defines a **25×25** grid.",
    "- To deploy this 75×75 layout, change `GRID_SIZE` in `data.js` and "
    "regenerate the NODES table from this JSON.",
    "- Dijkstra performance: 75×75 = 5,625 nodes vs 625 — still trivial "
    "(<5 ms shortest-path).",
    "- Renderer cell size: adjust so the building fits the canvas viewport.",
    "- Stamp tool / map editor still works — same primitives, just more cells.",
    "",
    "## After Survey — Update These",
    "",
    "1. Confirm room positions on-site (each office may shift by a few cells)",
    "2. Adjust stair cells if real stairs are at different positions",
    "3. Choose 4–6 QR anchor cells per floor — must be **open** cells",
    "4. Add real-world office hours to each entry in `departments.json`",
    "5. Measure one corridor in metres and confirm `0.6 m per cell` estimate",
])

md_path = OUT_DIR / "ground_floor_reference.md"
with open(md_path, "w", encoding="utf-8") as f:
    f.write("\n".join(md_lines))
print(f"MD:   {md_path}")

print(f"\nAll outputs in: {OUT_DIR}")
