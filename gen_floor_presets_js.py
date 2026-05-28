"""
Bundle the 4 floor grid JSON files into a single JS preset module that the
wayfinding-app can consume without a network fetch.

Output: wayfinding-app/js/floor_presets.js
"""

import json
from pathlib import Path

SRC_DIR = Path(r"C:\Users\Jace\Desktop\College Files\diko\dissertation\anon_floor_plans")
OUT_FILE = Path(r"C:\Users\Jace\Desktop\College Files\diko\dissertation\wayfinding-app\js\floor_presets.js")

FLOOR_FILES = [
    (0, "floor_0_lower_ground_grid.json"),
    (1, "floor_1_ground_grid.json"),
    (2, "floor_2_second_grid.json"),
    (3, "floor_3_third_grid.json"),
]

GRID_SIZE = 75

# ── Build flat cellType array per floor ──────────────────────────────────────

presets = {}
suggested = {}

for floor_idx, fname in FLOOR_FILES:
    data = json.loads((SRC_DIR / fname).read_text(encoding="utf-8"))
    # Start with all 'open'
    cells = ["open"] * (GRID_SIZE * GRID_SIZE)
    # Walls (includes outside)
    for r, c in data["walls"]:
        cells[r * GRID_SIZE + c] = "wall"
    # Doors
    for r, c in data["doors"]:
        cells[r * GRID_SIZE + c] = "door"
    # Stairs
    for r, c in data["stairs"]:
        cells[r * GRID_SIZE + c] = "stair"
    # Entries — treat as open (walkable, breaks outer wall)
    for r, c in data["entries"]:
        cells[r * GRID_SIZE + c] = "open"
    presets[floor_idx] = cells
    suggested[floor_idx] = data["suggested_department_coords"]

# ── Emit JS module ───────────────────────────────────────────────────────────

# Compact emission: one floor per line, no whitespace inside arrays
js_lines = [
    "/**",
    " * floor_presets.js — pre-built 75×75 grid layouts for all 4 floors of",
    " * Calamba City Hall, generated from the anonymized floor plans.",
    " *",
    " * Loaded automatically on first app start (or after grid-size mismatch).",
    " * After load, the user can edit freely in the Map Editor as usual.",
    " */",
    "",
    '"use strict";',
    "",
    f"const FLOOR_PRESETS_GRID_SIZE = {GRID_SIZE};",
    "// Bump this whenever the bundled layout changes — the app re-applies presets",
    "// (overwriting stale localStorage) when the stored version differs.",
    "const FLOOR_PRESETS_VERSION = 2;   // v2 = flat-top octagon (was tilted in v1)",
    "",
    "const FLOOR_PRESETS = {",
]

for floor_idx, cells in presets.items():
    arr_str = ",".join(f'"{c}"' for c in cells)
    js_lines.append(f"  {floor_idx}: [{arr_str}],")

js_lines.append("};")
js_lines.append("")
js_lines.append("/** Suggested department centroids per floor, keyed by office name. */")
js_lines.append("const FLOOR_PRESETS_DEPARTMENTS = " +
                json.dumps(suggested, indent=2).replace("\n", "\n") + ";")
js_lines.append("")
js_lines.append("/**")
js_lines.append(" * Populate FLOOR_WALLS from the bundled presets.")
js_lines.append(" * Returns the number of floors populated.")
js_lines.append(" */")
js_lines.append("function applyFloorPresets() {")
js_lines.append("  let n = 0;")
js_lines.append("  for (const [floor, cells] of Object.entries(FLOOR_PRESETS)) {")
js_lines.append("    FLOOR_WALLS[Number(floor)] = cells.slice();")
js_lines.append("    n++;")
js_lines.append("  }")
js_lines.append("  return n;")
js_lines.append("}")

OUT_FILE.write_text("\n".join(js_lines), encoding="utf-8")
size_kb = OUT_FILE.stat().st_size / 1024
print(f"Wrote {OUT_FILE} ({size_kb:.1f} KB)")
print(f"  Floors: {list(presets.keys())}")
print(f"  Cells per floor: {GRID_SIZE * GRID_SIZE}")
