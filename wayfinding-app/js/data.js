/**
 * data.js — 100×100 grid graph for pathfinding
 *
 * Node IDs: "row,col"  e.g. "0,0" = top-left, "99,99" = bottom-right.
 * All edges are 4-directional (up/down/left/right), weight = 1.
 */

"use strict";

const GRID_ROWS = 25;
const GRID_COLS = 25;

// ── Generate nodes ────────────────────────────────────────────────────────────
const NODES = [];
for (let r = 0; r < GRID_ROWS; r++) {
  for (let c = 0; c < GRID_COLS; c++) {
    NODES.push({ id: `${r},${c}`, row: r, col: c, wall: false, cellType: 'open' });
  }
}

const NODE_MAP = Object.fromEntries(NODES.map((n) => [n.id, n]));

function nodeId(row, col) {
  return `${row},${col}`;
}

// ── Build adjacency list (call after toggling walls) ──────────────────────────
function buildAdjacency() {
  const adj = {};
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];

  NODES.forEach((n) => {
    adj[n.id] = [];
  });

  NODES.forEach((n) => {
    if (n.wall) return;
    dirs.forEach(([dr, dc]) => {
      const nr = n.row + dr,
        nc = n.col + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) return;
      const nb = NODE_MAP[nodeId(nr, nc)];
      if (!nb.wall) adj[n.id].push({ to: nb.id, weight: 1 });
    });
  });

  return adj;
}

// ── Stamp ─────────────────────────────────────────────────────────────────────
// A reusable n×n wall pattern that can be stamped onto the main grid.

let STAMP_SIZE = 5;
let STAMP_PATTERN = Array.from({ length: STAMP_SIZE }, () =>
  new Array(STAMP_SIZE).fill('open'),
);

/** Resize stamp, preserving the overlapping portion of the existing pattern. */
function setStampSize(n) {
  const newSize = Math.max(2, Math.min(20, n));
  STAMP_PATTERN = Array.from({ length: newSize }, (_, r) =>
    Array.from({ length: newSize }, (_, c) =>
      r < STAMP_SIZE && c < STAMP_SIZE ? STAMP_PATTERN[r][c] : 'open',
    ),
  );
  STAMP_SIZE = newSize;
}

/** Toggle a single cell in the stamp editor (legacy boolean toggle — use paintStampCell instead). */
function toggleStampCell(row, col) {
  if (row >= 0 && row < STAMP_SIZE && col >= 0 && col < STAMP_SIZE) {
    STAMP_PATTERN[row][col] = STAMP_PATTERN[row][col] === 'open' ? 'wall' : 'open';
  }
}

/** Paint a stamp editor cell with the given type ('wall'|'door'|'stair'|'erase'→'open'). */
function paintStampCell(row, col, type) {
  if (row >= 0 && row < STAMP_SIZE && col >= 0 && col < STAMP_SIZE) {
    const ct = type === 'erase' ? 'open' : type;
    // clicking same type again → erase
    STAMP_PATTERN[row][col] = STAMP_PATTERN[row][col] === ct ? 'open' : ct;
  }
}

/** Clear the stamp pattern. */
function clearStamp() {
  STAMP_PATTERN = Array.from({ length: STAMP_SIZE }, () =>
    new Array(STAMP_SIZE).fill('open'),
  );
}

/**
 * Stamp the pattern onto the main grid starting at (startRow, startCol).
 * Each cell's cellType is set from STAMP_PATTERN; wall is derived.
 */
function applyStamp(startRow, startCol) {
  for (let r = 0; r < STAMP_SIZE; r++) {
    for (let c = 0; c < STAMP_SIZE; c++) {
      const nr = startRow + r,
        nc = startCol + c;
      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS) {
        const nd  = NODE_MAP[nodeId(nr, nc)];
        const val = STAMP_PATTERN[r][c];
        // support old boolean patterns saved before this update
        const ct  = typeof val === 'boolean' ? (val ? 'wall' : 'open') : (val || 'open');
        // open cells are transparent — they don't overwrite existing content
        if (ct === 'open') continue;
        nd.cellType = ct;
        nd.wall     = ct === 'wall';
      }
    }
  }
}

// ── Stamp rotation ────────────────────────────────────────────────────────────

/** Rotate STAMP_PATTERN 90° clockwise in-place (square pattern). */
function rotateStampCW() {
  const n = STAMP_SIZE;
  const r = Array.from({ length: n }, () => Array(n).fill('open'));
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++)
      r[col][n - 1 - row] = STAMP_PATTERN[row][col];
  STAMP_PATTERN = r;
}

/** Rotate STAMP_PATTERN 90° counter-clockwise in-place (square pattern). */
function rotateStampCCW() {
  const n = STAMP_SIZE;
  const r = Array.from({ length: n }, () => Array(n).fill('open'));
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++)
      r[n - 1 - col][row] = STAMP_PATTERN[row][col];
  STAMP_PATTERN = r;
}

// ── Grid region helpers ───────────────────────────────────────────────────────

/** Return a 2D array of cellType strings for the rectangle (r1,c1)→(r2,c2). */
function getRegionWalls(r1, c1, r2, c2) {
  return Array.from({ length: r2 - r1 + 1 }, (_, r) =>
    Array.from({ length: c2 - c1 + 1 }, (_, c) => {
      const nd = NODE_MAP[nodeId(r1 + r, c1 + c)];
      return nd ? (nd.cellType || 'open') : 'open';
    })
  );
}

/** Apply a 2D cellType pattern to the grid at (r1, c1). Out-of-bounds and open cells ignored. */
function applyRegionWalls(r1, c1, pattern) {
  pattern.forEach((row, r) =>
    row.forEach((val, c) => {
      const nd = NODE_MAP[nodeId(r1 + r, c1 + c)];
      if (nd) {
        // backward compat: old boolean values
        const ct = typeof val === 'boolean' ? (val ? 'wall' : 'open') : (val || 'open');
        // open cells are transparent — don't overwrite existing content
        if (ct === 'open') return;
        nd.cellType = ct;
        nd.wall     = ct === 'wall';
      }
    })
  );
}

/** Clear (open) every cell in the rectangle (r1,c1)→(r2,c2). */
function clearRegion(r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const nd = NODE_MAP[nodeId(r, c)];
      if (nd) { nd.wall = false; nd.cellType = 'open'; }
    }
}

/** Rotate an arbitrary 2D array 90° clockwise. Dimensions are transposed. */
function rotatePatternCW(pat) {
  const rows = pat.length, cols = pat[0].length;
  return Array.from({ length: cols }, (_, c) =>
    Array.from({ length: rows }, (_, r) => pat[rows - 1 - r][c])
  );
}

/** Rotate an arbitrary 2D array 90° counter-clockwise. Dimensions are transposed. */
function rotatePatternCCW(pat) {
  const rows = pat.length, cols = pat[0].length;
  return Array.from({ length: cols }, (_, c) =>
    Array.from({ length: rows }, (_, r) => pat[r][cols - 1 - c])
  );
}

// ── Stamp Presets ─────────────────────────────────────────────────────────────
// Named, reusable stamp patterns: { id, name, size, pattern }
// Persisted via localStorage.

const STAMP_PRESETS = [];

/** Save current stamp (STAMP_SIZE + STAMP_PATTERN) as a named preset. */
function saveStampPreset(name) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  STAMP_PRESETS.push({
    id,
    name: name.trim(),
    size: STAMP_SIZE,
    pattern: STAMP_PATTERN.map(row => [...row]),   // deep copy
  });
  _saveStampPresets();
  return id;
}

/** Delete a preset by id. */
function deleteStampPreset(id) {
  const idx = STAMP_PRESETS.findIndex(p => p.id === id);
  if (idx !== -1) STAMP_PRESETS.splice(idx, 1);
  _saveStampPresets();
}

/** Load a preset back into the active stamp editor (overwrites STAMP_SIZE + STAMP_PATTERN). */
function loadStampPresetById(id) {
  const preset = STAMP_PRESETS.find(p => p.id === id);
  if (!preset) return false;
  STAMP_SIZE    = preset.size;
  // backward compat: convert old boolean[][] to string[][]
  STAMP_PATTERN = preset.pattern.map(row =>
    row.map(v => typeof v === 'boolean' ? (v ? 'wall' : 'open') : (v || 'open'))
  );
  return true;
}

function _saveStampPresets() {
  try {
    localStorage.setItem('gridPathfinder_stampPresets', JSON.stringify(STAMP_PRESETS));
  } catch (_) {}
}

function loadStampPresets() {
  try {
    const raw = localStorage.getItem('gridPathfinder_stampPresets');
    if (raw) STAMP_PRESETS.push(...JSON.parse(raw));
  } catch (_) {}
}

// ── Stamp Placements Catalogue ────────────────────────────────────────────────
// Tracks named stamp placements: { id, name, row, col, size }.
// Persisted via localStorage.

const STAMP_PLACEMENTS = [];

/** Record a named stamp placement. Returns the new entry's id. */
function addStampPlacement(name, row, col, size) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  STAMP_PLACEMENTS.push({ id, name: name.trim(), row, col, size });
  saveStampPlacements();
  return id;
}

/** Remove a placement by id. */
function deleteStampPlacement(id) {
  const idx = STAMP_PLACEMENTS.findIndex(p => p.id === id);
  if (idx !== -1) STAMP_PLACEMENTS.splice(idx, 1);
  saveStampPlacements();
}

/** Persist placements to localStorage. */
function saveStampPlacements() {
  try {
    localStorage.setItem('gridPathfinder_stampPlacements', JSON.stringify(STAMP_PLACEMENTS));
  } catch (_) {}
}

/** Load placements from localStorage (call once on startup). */
function loadStampPlacements() {
  try {
    const raw = localStorage.getItem('gridPathfinder_stampPlacements');
    if (raw) STAMP_PLACEMENTS.push(...JSON.parse(raw));
  } catch (_) {}
}
