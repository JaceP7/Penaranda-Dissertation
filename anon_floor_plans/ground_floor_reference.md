# Ground Floor — 75×75 Grid Reference

Total cells: 5625 · Estimated scale: ~0.6 m per cell · Building width: ~45 m

Suggested seed coordinates for each office. Verify on-site and update `departments.json`.

| Code | Office | Floor | Row | Col | Open Cells |
|---|---|---|---|---|---|
| MOPAC | MOPAC | 1 | 37 | 59 | 249 |
| BPLO | Business Permits | 1 | 53 | 53 | 237 |
| LOBBY | Lobby / Information | 1 | 59 | 37 | 249 |
| TOUR | Tourism Office | 1 | 52 | 22 | 225 |
| LCR | Local Civil Registry | 1 | 37 | 15 | 230 |
| GSO | General Services Office | 1 | 22 | 22 | 214 |
| TREAS | City Treasury Office (Main) | 1 | 15 | 37 | 231 |
| ASSESS | City Assessment Office | 1 | 22 | 52 | 225 |

## Stair cells (floor transitions)

- Stair quadrant anchor at row **15**, col **37** (2×2 footprint extends down/right)
- Stair quadrant anchor at row **37**, col **18** (2×2 footprint extends down/right)
- Stair quadrant anchor at row **37**, col **57** (2×2 footprint extends down/right)
- Stair quadrant anchor at row **57**, col **37** (2×2 footprint extends down/right)

## Main entry cells (south wall)

- Entry at row **70**, col **35**
- Entry at row **70**, col **36**
- Entry at row **70**, col **37**
- Entry at row **70**, col **38**
- Entry at row **70**, col **39**

## Cell counts

- Open (walkable office floor): 1860
- Atrium (central corridor):    433
- Wall:                          678
- Outside (unreachable):         2611
- Door:                          24
- Stair:                         16
- Entry:                         3

## Implications for the live system

- `js/data.js` currently defines a **25×25** grid.
- To deploy this 75×75 layout, change `GRID_SIZE` in `data.js` and regenerate the NODES table from this JSON.
- Dijkstra performance: 75×75 = 5,625 nodes vs 625 — still trivial (<5 ms shortest-path).
- Renderer cell size: adjust so the building fits the canvas viewport.
- Stamp tool / map editor still works — same primitives, just more cells.

## After Survey — Update These

1. Confirm room positions on-site (each office may shift by a few cells)
2. Adjust stair cells if real stairs are at different positions
3. Choose 4–6 QR anchor cells per floor — must be **open** cells
4. Add real-world office hours to each entry in `departments.json`
5. Measure one corridor in metres and confirm `0.6 m per cell` estimate