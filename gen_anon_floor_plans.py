"""
Generate 4 anonymized floor plan PNGs (Lower Ground, Ground, 2nd, 3rd) for
Calamba City Hall. Octagonal layout — simple, clean, labelled with department
names that match departments.json. Output is suitable to share publicly.
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

# ── Output config ────────────────────────────────────────────────────────────
OUT_DIR = Path(r"C:\Users\Jace\Desktop\College Files\diko\dissertation\anon_floor_plans")
OUT_DIR.mkdir(parents=True, exist_ok=True)

W, H = 1400, 1000
CX, CY = W // 2, H // 2
R_OUTER = 420       # outer octagon radius
R_INNER = 180       # inner atrium radius
ROOM_DEPTH = 110    # how deep rooms extend inward from outer wall

# Palette
BG       = (250, 250, 252)
WALL     = (30, 41, 59)
ROOM_BG  = (241, 245, 249)
ROOM_HL  = (219, 234, 254)
ATRIUM   = (226, 232, 240)
STAIR    = (251, 191, 36)
ENTRY    = (34, 197, 94)
TEXT     = (15, 23, 42)
TITLE    = (15, 23, 42)
SUB      = (100, 116, 139)
LABEL_BG = (255, 255, 255)


def get_font(size: int, bold: bool = False):
    try:
        name = "arialbd.ttf" if bold else "arial.ttf"
        return ImageFont.truetype(name, size)
    except (IOError, OSError):
        return ImageFont.load_default()


def octagon_vertices(cx, cy, r, rotation_deg=22.5):
    """Return 8 vertices of an octagon centred at (cx, cy) with circumradius r."""
    verts = []
    for i in range(8):
        angle = math.radians(rotation_deg + i * 45)
        verts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return verts


def draw_room(draw, p1, p2, inner_p1, inner_p2, fill, outline=WALL, width=3):
    """Draw a trapezoidal room between outer and inner octagon edges."""
    draw.polygon([p1, p2, inner_p2, inner_p1], fill=fill, outline=outline, width=width)


def draw_label(draw, x, y, text, font, max_width=180, fill=TEXT, anchor="mm"):
    """Draw text with auto word-wrap, centred on (x, y)."""
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = (current + " " + word).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)

    line_height = font.size + 2
    total_h = len(lines) * line_height
    start_y = y - total_h // 2 + line_height // 2

    for i, line in enumerate(lines):
        draw.text((x, start_y + i * line_height), line, font=font,
                  fill=fill, anchor=anchor)


def midpoint(p1, p2):
    return ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)


def lerp(p1, p2, t):
    return (p1[0] + (p2[0] - p1[0]) * t,
            p1[1] + (p2[1] - p1[1]) * t)


def build_floor(title: str, subtitle: str, rooms: list, main_entry_side: int,
                stair_sides: list, filename: str, north_deg: int = 0):
    """
    rooms: list of dicts {side: 0-7, label: str, sub: str|None, highlight: bool}
           OR a list of lists if a side has multiple rooms (split that side).
    main_entry_side: which octagon side (0-7) has the public entrance arrow.
    stair_sides: list of (side, position) tuples — position is "left"/"right"/"center"
    """
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Title
    f_title = get_font(28, bold=True)
    f_sub   = get_font(16)
    f_room  = get_font(13, bold=True)
    f_small = get_font(11)
    f_legend = get_font(13)
    f_north = get_font(20, bold=True)

    draw.text((W // 2, 38), title, font=f_title, fill=TITLE, anchor="mm")
    draw.text((W // 2, 70), subtitle, font=f_sub, fill=SUB, anchor="mm")

    # North indicator (top-right corner)
    nx, ny = W - 80, 100
    draw.ellipse([nx - 28, ny - 28, nx + 28, ny + 28], outline=WALL, width=2, fill=LABEL_BG)
    # north arrow
    arr_angle = math.radians(north_deg - 90)
    ax = nx + 18 * math.cos(arr_angle)
    ay = ny + 18 * math.sin(arr_angle)
    bx = nx - 10 * math.cos(arr_angle)
    by = ny - 10 * math.sin(arr_angle)
    draw.line([(bx, by), (ax, ay)], fill=(220, 38, 38), width=3)
    # arrowhead
    head_l = math.radians(north_deg - 90 + 150)
    head_r = math.radians(north_deg - 90 - 150)
    draw.line([(ax, ay), (ax + 8 * math.cos(head_l), ay + 8 * math.sin(head_l))],
              fill=(220, 38, 38), width=3)
    draw.line([(ax, ay), (ax + 8 * math.cos(head_r), ay + 8 * math.sin(head_r))],
              fill=(220, 38, 38), width=3)
    draw.text((nx, ny + 42), "N", font=f_north, fill=WALL, anchor="mm")

    # Octagon outer and inner walls
    outer = octagon_vertices(CX, CY, R_OUTER)
    inner = octagon_vertices(CX, CY, R_INNER)

    # Build room segments — group rooms by side
    rooms_by_side = {}
    for r in rooms:
        rooms_by_side.setdefault(r["side"], []).append(r)

    # Draw rooms first (so walls overlay)
    for side, side_rooms in rooms_by_side.items():
        p1_out = outer[side]
        p2_out = outer[(side + 1) % 8]
        p1_in  = inner[side]
        p2_in  = inner[(side + 1) % 8]

        n = len(side_rooms)
        for i, room in enumerate(side_rooms):
            t1 = i / n
            t2 = (i + 1) / n
            a_out = lerp(p1_out, p2_out, t1)
            b_out = lerp(p1_out, p2_out, t2)
            a_in  = lerp(p1_in,  p2_in,  t1)
            b_in  = lerp(p1_in,  p2_in,  t2)

            fill = ROOM_HL if room.get("highlight") else ROOM_BG
            draw.polygon([a_out, b_out, b_in, a_in], fill=fill, outline=WALL, width=2)

            # Label position — middle of trapezoid
            cx_lbl = (a_out[0] + b_out[0] + a_in[0] + b_in[0]) / 4
            cy_lbl = (a_out[1] + b_out[1] + a_in[1] + b_in[1]) / 4

            # Main label
            draw_label(draw, cx_lbl, cy_lbl - 6, room["label"], f_room,
                       max_width=140, fill=TEXT)
            if room.get("sub"):
                draw.text((cx_lbl, cy_lbl + 22), room["sub"], font=f_small,
                          fill=SUB, anchor="mm")

    # Atrium (central open area)
    draw.polygon(inner, fill=ATRIUM, outline=WALL, width=2)
    draw.text((CX, CY - 12), "CENTRAL", font=f_room, fill=SUB, anchor="mm")
    draw.text((CX, CY + 10), "ATRIUM",  font=f_room, fill=SUB, anchor="mm")

    # Stairs (small yellow squares between outer and inner)
    for side, pos in stair_sides:
        p1_out = outer[side]
        p2_out = outer[(side + 1) % 8]
        p1_in  = inner[side]
        p2_in  = inner[(side + 1) % 8]
        t = {"left": 0.15, "center": 0.5, "right": 0.85}[pos]
        sx_out = lerp(p1_out, p2_out, t)
        sx_in  = lerp(p1_in,  p2_in,  t)
        scx = (sx_out[0] + sx_in[0]) / 2
        scy = (sx_out[1] + sx_in[1]) / 2
        draw.rectangle([scx - 16, scy - 16, scx + 16, scy + 16],
                       fill=STAIR, outline=WALL, width=2)
        draw.text((scx, scy), "S", font=f_room, fill=WALL, anchor="mm")

    # Main entrance arrow
    p1_out = outer[main_entry_side]
    p2_out = outer[(main_entry_side + 1) % 8]
    mid_out = midpoint(p1_out, p2_out)
    # vector pointing inward (toward centre)
    dx, dy = CX - mid_out[0], CY - mid_out[1]
    ml = math.hypot(dx, dy)
    dx, dy = dx / ml, dy / ml
    # arrow start (outside the building)
    ax_start = mid_out[0] - dx * 60
    ay_start = mid_out[1] - dy * 60
    ax_end   = mid_out[0] - dx * 10
    ay_end   = mid_out[1] - dy * 10
    draw.line([(ax_start, ay_start), (ax_end, ay_end)], fill=ENTRY, width=5)
    # arrowhead
    head_angle = math.atan2(dy, dx)
    h1 = head_angle + math.radians(150)
    h2 = head_angle - math.radians(150)
    draw.line([(ax_end, ay_end),
               (ax_end + 14 * math.cos(h1), ay_end + 14 * math.sin(h1))],
              fill=ENTRY, width=5)
    draw.line([(ax_end, ay_end),
               (ax_end + 14 * math.cos(h2), ay_end + 14 * math.sin(h2))],
              fill=ENTRY, width=5)
    # label
    label_x = ax_start - dx * 30
    label_y = ay_start - dy * 30
    draw.text((label_x, label_y), "MAIN ENTRY", font=f_room, fill=ENTRY, anchor="mm")

    # Legend (bottom-left)
    lx, ly = 50, H - 130
    draw.rectangle([lx, ly, lx + 230, ly + 110], fill=LABEL_BG,
                   outline=WALL, width=2)
    draw.text((lx + 12, ly + 12), "LEGEND", font=f_room, fill=TEXT, anchor="lt")

    # Stair swatch
    draw.rectangle([lx + 14, ly + 38, lx + 30, ly + 54],
                   fill=STAIR, outline=WALL, width=1)
    draw.text((lx + 40, ly + 46), "Stairs / Elevator",
              font=f_legend, fill=TEXT, anchor="lm")

    # Entry swatch
    draw.line([(lx + 14, ly + 70), (lx + 30, ly + 70)], fill=ENTRY, width=4)
    draw.text((lx + 40, ly + 70), "Main entrance",
              font=f_legend, fill=TEXT, anchor="lm")

    # Atrium swatch
    draw.rectangle([lx + 14, ly + 88, lx + 30, ly + 100],
                   fill=ATRIUM, outline=WALL, width=1)
    draw.text((lx + 40, ly + 94), "Open / Atrium",
              font=f_legend, fill=TEXT, anchor="lm")

    # Footer note
    draw.text((W // 2, H - 30),
              "Simplified anonymized floor plan — for wayfinding system development",
              font=f_small, fill=SUB, anchor="mm")

    out_path = OUT_DIR / filename
    img.save(out_path, "PNG")
    print(f"Saved: {out_path}")


# ── Floor data ────────────────────────────────────────────────────────────────
# Side numbering (rotation 22.5°): 0 = right, going clockwise
#   0 = E,   1 = SE,  2 = S,   3 = SW,
#   4 = W,   5 = NW,  6 = N,   7 = NE
#
# Each room: { side: int, label: str, sub: str|None, highlight: bool }

LOWER_GROUND = [
    {"side": 6, "label": "City Social Services",      "sub": "CSSYDO"},
    {"side": 5, "label": "Investment & Employment",   "sub": "IIPESO"},
    {"side": 4, "label": "City Treasury Annex",       "sub": None},
    {"side": 4, "label": "City Health Services",      "sub": None},
    {"side": 3, "label": "Partner Bank Counter",      "sub": "Out of scope"},
    {"side": 2, "label": "Housing Office",            "sub": "Out of scope"},
    {"side": 2, "label": "COMELEC",                   "sub": "Out of scope"},
    {"side": 1, "label": "Cooperatives & Livelihood", "sub": "COOP"},
    {"side": 1, "label": "City Legal / Prosecutor",   "sub": "Verify"},
    {"side": 0, "label": "PWD Affairs Office",        "sub": "PDAO"},
    {"side": 7, "label": "Agriculture Office",        "sub": None},
    {"side": 7, "label": "Veterinary Services",       "sub": None},
]

GROUND = [
    {"side": 6, "label": "City Treasury Office",      "sub": "Main"},
    {"side": 5, "label": "General Services Office",   "sub": "GSO"},
    {"side": 4, "label": "Local Civil Registry",      "sub": None},
    {"side": 3, "label": "Tourism Office",            "sub": None},
    {"side": 2, "label": "Lobby / Information",       "sub": None, "highlight": True},
    {"side": 1, "label": "Business Permits",          "sub": "BPLO"},
    {"side": 0, "label": "MOPAC",                     "sub": "Verify"},
    {"side": 7, "label": "City Assessment Office",    "sub": None},
]

SECOND = [
    {"side": 7, "label": "VMO Extension",             "sub": None},
    {"side": 6, "label": "Building Regulatory",       "sub": None},
    {"side": 0, "label": "Engineering Services",      "sub": "Verify"},
    {"side": 0, "label": "MOEA",                      "sub": "Verify"},
    {"side": 1, "label": "City Population Office",    "sub": None},
    {"side": 1, "label": "City Planning & Dev't",     "sub": None},
    {"side": 2, "label": "City Budget Office",        "sub": "Verify"},
    {"side": 3, "label": "City Accounting",           "sub": None},
    {"side": 4, "label": "Human Resources",           "sub": "HR"},
    {"side": 5, "label": "DILG",                      "sub": "Out of scope"},
    {"side": 5, "label": "Sectoral Affairs",          "sub": "Verify"},
    {"side": 6, "label": "Environment / CENRO",       "sub": None},
]

THIRD = [
    {"side": 6, "label": "Sangguniang Bayan",         "sub": "Secretariat"},
    {"side": 5, "label": "Office of the Vice Mayor",  "sub": None},
    {"side": 4, "label": "Councillors' Offices",      "sub": "Multiple"},
    {"side": 3, "label": "CCEMPC",                    "sub": "Verify"},
    {"side": 3, "label": "Population (Annex)",        "sub": None},
    {"side": 2, "label": "Councillors' Offices",      "sub": "Multiple"},
    {"side": 1, "label": "Councillors' Offices",      "sub": "Multiple"},
    {"side": 0, "label": "City Administration",       "sub": None},
    {"side": 7, "label": "Office of the City Mayor",  "sub": None, "highlight": True},
]


# ── Generate all four floors ─────────────────────────────────────────────────

build_floor(
    title="LOWER GROUND FLOOR",
    subtitle="Calamba City Hall — Anonymized layout · Floor 0",
    rooms=LOWER_GROUND,
    main_entry_side=2,   # south side
    stair_sides=[(4, "left"), (0, "right"), (6, "center")],
    filename="floor_0_lower_ground.png",
)

build_floor(
    title="GROUND FLOOR",
    subtitle="Calamba City Hall — Anonymized layout · Floor 1 · Public entry level",
    rooms=GROUND,
    main_entry_side=2,
    stair_sides=[(4, "left"), (0, "right"), (6, "center")],
    filename="floor_1_ground.png",
)

build_floor(
    title="SECOND FLOOR",
    subtitle="Calamba City Hall — Anonymized layout · Floor 2",
    rooms=SECOND,
    main_entry_side=2,
    stair_sides=[(4, "left"), (0, "right"), (6, "center")],
    filename="floor_2_second.png",
)

build_floor(
    title="THIRD FLOOR",
    subtitle="Calamba City Hall — Anonymized layout · Floor 3 · Executive level",
    rooms=THIRD,
    main_entry_side=2,
    stair_sides=[(4, "left"), (0, "right"), (6, "center")],
    filename="floor_3_third.png",
)

print(f"\nAll 4 floor plans saved to: {OUT_DIR}")
