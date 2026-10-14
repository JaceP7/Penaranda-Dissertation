/**
 * app.js — Grid pathfinder controller
 *
 * Start is always (0,0).  Click any cell to set the destination.
 * Wall Mode: drag to paint/erase walls.
 * Stamp & Places panel: design a named n×n pattern, stamp it onto the grid,
 *   and each named placement is recorded in the catalogue.
 * Undo/Redo: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z).
 * Multi-floor: floor selector in header; each floor has independent walls.
 * Grid persistence: walls auto-saved to localStorage (wayfinding-grid-v1).
 */

'use strict';

// ── Floor wall cache ───────────────────────────────────────────────────────────
// Walls for non-active floors are cached here; the active floor always lives in NODES.
const FLOOR_WALLS = {};

// ── State ─────────────────────────────────────────────────────────────────────
const STATE = {
  startId:      '0,0',
  endId:        null,
  wallMode:     false,
  stampMode:    false,   // clicking grid places stamp
  selectMode:   false,   // drag to select; toolbar shows CW/CCW/Move/Delete
  panelOpen:    false,   // tools panel visible
  navMode:      false,   // navigate mode: position tracks PDR/QR, path from ME → tapped cell
  captureMode:  false,   // fieldwork: tap a cell (or use PDR pos) to record an office coordinate
  setPosMode:   false,   // sub-mode within capture: taps SET position instead of capturing
  currentFloor: 1,       // active floor index — default lands on Ground (idx 1; LG is idx 0)
  viewMode:     'user',  // 'user' (citizen, chat-first) | 'admin' (full editor). NOT persisted.
  paintType:    'wall',  // active paint type: 'wall' | 'door' | 'stair' | 'erase'
};

// Tracks whether Shift is currently held — used for Shift+click "teleport" in Capture Mode
// (sets NAV.position to the clicked cell instead of capturing the selected office).
let _shiftHeld = false;

// ── View mode (user / admin) + admin gate ──────────────────────────────────
// The staff PIN is NOT in this file any more — it is compared server-side by
// api/adminauth.js, so it no longer ships to the browser. That endpoint is a
// deterrent, not a security boundary: the admin/citizen split is a body class,
// so devtools can still reveal the editor. Nothing is protected by that alone —
// every write to the shared map goes through api/mapstate.js, which verifies
// MAP_ADMIN_TOKEN server-side. The view mode is NOT persisted; every reload
// returns to the citizen view (kiosk-safe).

/** Ask the server whether this PIN opens the editor. Returns true/false. */
async function _adminPinAccepted(pin) {
  try {
    const res  = await fetch('/api/adminauth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (data.configured === false) {
        console.warn('[wayfinding] ADMIN_PIN is not set in Vercel — the fallback PIN is in use. ' +
                     'Set ADMIN_PIN in the project environment and redeploy.');
      }
      return true;
    }
    return false;
  } catch (_) {
    // Endpoint unreachable (offline, or running from file://). Refuse rather
    // than fall back to a client-side comparison, which is what we just removed.
    alert('Cannot reach the server to check the PIN. Connect to the internet and try again.');
    return false;
  }
}

// Set while an admin is previewing the citizen view, so Exit Preview can return
// them to the editor without a second PIN prompt.
let _previewingAsCitizen = false;

function setViewMode(mode) {
  STATE.viewMode = (mode === 'admin') ? 'admin' : 'user';
  document.body.classList.toggle('view-admin', STATE.viewMode === 'admin');
  document.body.classList.toggle('view-user',  STATE.viewMode === 'user');
  if (STATE.viewMode === 'admin') {
    document.body.classList.remove('route-active');   // admin sees the full map
    if (typeof _hideNavStep === 'function') _hideNavStep();
    if (typeof _refreshDraftBadge === 'function') _refreshDraftBadge();
  } else if (!_previewingAsCitizen) {
    // Leaving admin for real: drop the cached publish token so a shared or kiosk
    // device cannot publish after the admin walks away.
    try { sessionStorage.removeItem(PUBLISH_TOKEN_SS_KEY); } catch (_) {}
  }
  // Citizen view starts collapsed: the Calamba hero shows with the labeled
  // "City Services Assistant 💬" button as the call-to-action. Tapping it opens
  // the assistant. (No auto-open — the button is the entry point.)
  if (typeof renderer !== 'undefined' && renderer && renderer.resize) renderer.resize();
}

// ── Floor display names (bundled FLOOR_NAMES + per-device override) ──────────
const FLOOR_NAMES_LS_KEY = 'wayfinding-floor-names';
let _floorNames = {};
function _loadFloorNames() {
  _floorNames = Object.assign({}, (typeof FLOOR_NAMES !== 'undefined' ? FLOOR_NAMES : {}));
  try {
    const raw = localStorage.getItem(FLOOR_NAMES_LS_KEY);
    if (raw) Object.assign(_floorNames, JSON.parse(raw));
  } catch (_) {}
}
function _floorLabel(f) {
  return _floorNames[f] || `Floor ${f + 1}`;
}
function renameCurrentFloor() {
  const cur = _floorLabel(STATE.currentFloor);
  const name = prompt(`Rename "${cur}":`, cur);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  _floorNames[STATE.currentFloor] = trimmed;
  try { localStorage.setItem(FLOOR_NAMES_LS_KEY, JSON.stringify(_floorNames)); } catch (_) {}
  _syncFloorDisplay();
  _flashCaptureFeedback(`Floor renamed to "${trimmed}". Use Floors → Deploy to publish to all devices.`);
}

// ── Capture points (fieldwork coordinate capture) ──────────────────────────────
// Each entry: { floor, row, col, name }  keyed by office name (one coord per office).
const CAPTURED_POINTS = {};
const CAPTURE_LS_KEY  = 'wayfinding-captures-v1';
const CUSTOM_OFFICES_LS_KEY = 'wayfinding-custom-offices-v1';

// ── Walk recorder (PDR testing instrumentation, supports F1/F2/F3 validation) ──
//
// While recording, samples NAV.position + NAV.heading + the compass's current
// EMA alpha at 5 Hz. Walks persist in localStorage and can be exported as JSON
// for offline analysis (e.g. comparing F1-on vs F1-off heading stability).
//
//   Schema (one walk):
//     {
//       startedAt:  <epoch ms>,
//       endedAt:    <epoch ms>,
//       duration_ms,
//       floor:      <floor number at recording start>,
//       startCell:  { row, col },  endCell: { row, col },
//       sample_count,
//       samples:    [ { t, row, col, heading, alpha }, ... ],
//       app:        <build version string>,
//       ua:         <truncated user agent>
//     }
const WALKS_LS_KEY  = 'wayfinding-walks-v1';
const WALK_SAMPLE_MS = 200;   // 5 Hz sampling
let   RECORDED_WALKS = [];    // loaded from localStorage on init
let   _walkRecorder  = null;  // active walk being recorded, or null
let   _walkTimer     = null;  // setInterval handle

// Offices added on-site that aren't in departments.json (persisted).
let CUSTOM_OFFICES = [];

// Hardcoded fallback so the capture dropdown ALWAYS has the canonical offices,
// even if data/departments.json fails to load over the network.
// Source: official Calamba City Citizen's Charter (28 charter offices) + 3
// well-known sub-units (OSCA, PDAO, CDRRMD-MO) that floor plans label separately
// = 31 canonical entries.
const OFFICE_FALLBACK = [
  // 28 Citizen's Charter offices
  'BUILDINGS REGULATORY SERVICES DEPARTMENT',
  'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE',
  'CITY ACCOUNTING AND INTERNAL CONTROL OFFICE',
  'CITY ADMINISTRATION OFFICE',
  'CITY AGRICULTURAL SERVICES DEPARTMENT',
  'CITY ASSESSMENT OFFICE',
  'CITY BUDGET MANAGEMENT OFFICE',
  'CITY CIVIL REGISTRY OFFICE',
  'CITY COLLEGE OF CALAMBA',
  'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT',
  'CITY ENVIRONMENT AND NATURAL RESOURCES DEPARTMENT',
  'CITY GENERAL SERVICES OFFICE',
  'CITY HEALTH SERVICES DEPARTMENT',
  'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE',
  'CITY LEGAL SERVICES OFFICE',
  'CITY PLANNING AND DEVELOPMENT OFFICE',
  'CITY POPULATION MANAGEMENT OFFICE',
  'CITY SOCIAL SERVICES OFFICE',
  'CITY TREASURY MANAGEMENT OFFICE',
  'CITY VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE',
  'COOPERATIVES AND LIVELIHOOD DEVELOPMENT DEPARTMENT',
  'CULTURAL AFFAIRS, TOURISM AND SPORTS DEVELOPMENT DEPARTMENT',
  'HOUSING AND SETTLEMENTS DEPARTMENT',
  'INFORMATION, INVESTMENT PROMOTIONS AND EMPLOYMENT SERVICES OFFICE',
  'LEGISLATIVE SERVICES OFFICE',
  'OFFICE OF THE MAYOR',
  'OFFICE OF THE VICE MAYOR',
  'PUBLIC ORDER AND SAFETY OFFICE',
  // Sub-units / auxiliary offices citizens label separately
  'OFFICE FOR THE SENIOR CITIZENS AFFAIRS',
  'PERSONS WITH DISABILITY AFFAIRS OFFICE',
  'CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO',
];

const ADD_NEW_SENTINEL = '__ADD_NEW__';

// ── Selection state ───────────────────────────────────────────────────────────
let selectionData = null;  // { r1, c1, r2, c2, pattern } — captured selection
let floatingData  = null;  // { pattern, rows, cols } — lifted cells waiting to drop

let _wallGestureNew = true;   // true at the start of each wall-paint gesture

// ── Undo / Redo ───────────────────────────────────────────────────────────────
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 50;

function snapshotWalls() {
  return NODES.map(n => ({ wall: n.wall, cellType: n.cellType || 'open' }));
}
function restoreWalls(snap) {
  NODES.forEach((n, i) => {
    const s = snap[i];
    if (typeof s === 'boolean') {        // backward-compat: pre-cellType snapshots
      n.wall = s;  n.cellType = s ? 'wall' : 'open';
    } else {
      n.cellType = s.cellType || 'open';
      n.wall     = n.cellType === 'wall';
    }
  });
}

function pushUndo() {
  undoStack.push(snapshotWalls());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  _updateUndoRedoBtns();
  saveGridState();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotWalls());
  restoreWalls(undoStack.pop());
  _afterWallRestore();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotWalls());
  restoreWalls(redoStack.pop());
  _afterWallRestore();
}

function _afterWallRestore() {
  if (STATE.endId && NODE_MAP[STATE.endId].wall) {
    STATE.endId = null;
    renderer.clearEnd();
  }
  recompute();
  renderer._draw();
  _updateUndoRedoBtns();
  saveGridState();
}

function _updateUndoRedoBtns() {
  DOM.undoBtn.disabled = undoStack.length === 0;
  DOM.redoBtn.disabled = redoStack.length === 0;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const DOM = {
  canvas:          $('gridCanvas'),
  undoBtn:         $('undoBtn'),
  redoBtn:         $('redoBtn'),
  wallBtn:         $('wallModeBtn'),
  paintTypeBar:    $('paintTypeBar'),
  ptWallBtn:       $('ptWallBtn'),
  ptDoorBtn:       $('ptDoorBtn'),
  ptStairBtn:      $('ptStairBtn'),
  ptEraseBtn:      $('ptEraseBtn'),
  spWallBtn:       $('spWallBtn'),
  spDoorBtn:       $('spDoorBtn'),
  spStairBtn:      $('spStairBtn'),
  spEraseBtn:      $('spEraseBtn'),
  stampBtn:        $('stampModeBtn'),
  clearBtn:        $('clearWallsBtn'),
  resetBtn:        $('resetBtn'),
  newMapBtn:       $('newMapBtn'),
  syncBtn:         $('syncBtn'),
  exportFloorsBtn: $('exportFloorsBtn'),
  deployFloorsBtn: $('deployFloorsBtn'),
  publishCloudBtn: $('publishCloudBtn'),
  previewCitizenBtn: $('previewCitizenBtn'),
  mapHistoryBtn:   $('mapHistoryBtn'),
  mapHistoryModal: $('mapHistoryModal'),
  mapHistoryList:  $('mapHistoryList'),
  mapHistoryClose: $('mapHistoryClose'),
  draftBadge:      $('draftBadge'),
  draftBadgeText:  $('draftBadgeText'),
  revertDraftBtn:  $('revertDraftBtn'),
  exitPreviewBtn:  $('exitPreviewBtn'),
  dupFloorBtn:     $('dupFloorBtn'),
  exportStampsBtn: $('exportStampsBtn'),
  deployStampsBtn: $('deployStampsBtn'),
  floorActionsBtn: $('floorActionsBtn'),
  floorActionsMenu:$('floorActionsMenu'),
  mobileMenuBtn:   $('mobileMenuBtn'),
  headerSecondary: $('headerSecondary'),
  floorDown:       $('floorDown'),
  floorUp:         $('floorUp'),
  floorDisplay:    $('floorDisplay'),
  renameFloorBtn:  $('renameFloorBtn'),
  adminToggleBtn:  $('adminToggleBtn'),
  arrivalReminder: $('arrivalReminder'),
  askAgainBtn:     $('askAgainBtn'),
  landingCtaBtn:   $('landingCtaBtn'),
  tempAdminBtn:    $('tempAdminBtn'),   // TEMPORARY — see index.html

  infoStart:       $('infoStart'),
  infoEnd:         $('infoEnd'),
  infoSteps:       $('infoSteps'),
  infoMsg:         $('infoMsg'),
  hintBar:         $('hintBar'),
  // Mode buttons
  selectBtn:       $('selectModeBtn'),
  navBtn:          $('navModeBtn'),
  captureBtn:      $('captureModeBtn'),
  // Capture bar
  captureBar:        $('captureBar'),
  captureDeptSelect: $('captureDeptSelect'),
  captureSetPosBtn:  $('captureSetPosBtn'),
  captureAlignBtn:   $('captureAlignBtn'),
  captureHereBtn:    $('captureHereBtn'),
  captureRecBtn:        $('captureRecBtn'),
  captureExportWalksBtn:$('captureExportWalksBtn'),
  walkCount:            $('walkCount'),
  captureCount:      $('captureCount'),
  captureExportBtn:  $('captureExportBtn'),
  captureClearBtn:   $('captureClearBtn'),
  // Nav panel
  navPanel:        $('navPanel'),
  navPosDisplay:   $('navPosDisplay'),
  compassNeedle:   $('compassNeedle'),
  compassHdgText:  $('compassHdgText'),
  driftDisplay:    $('driftDisplay'),
  scanQRBtn:       $('scanQRBtn'),
  pdrToggleBtn:    $('pdrToggleBtn'),
  genQRBtn:        $('genQRBtn'),
  recalBtn:        $('recalBtn'),
  // QR location prompt (gates the route after "Take me there", citizen view)
  qrPromptModal:   $('qrPromptModal'),
  qrPromptScanBtn: $('qrPromptScanBtn'),
  qrPromptSkipBtn: $('qrPromptSkipBtn'),
  // TEMPORARY — manual location entry; see index.html
  manualLocToggle: $('manualLocToggle'),
  manualLocPanel:  $('manualLocPanel'),
  manualLocFloor:  $('manualLocFloor'),
  manualLocRow:    $('manualLocRow'),
  manualLocCol:    $('manualLocCol'),
  manualLocGo:     $('manualLocGo'),
  manualLocMsg:    $('manualLocMsg'),
  navRescanBtn:    $('navRescanBtn'),
  navStairBtn:     $('navStairBtn'),
  navHereBtn:      $('navHereBtn'),
  // QR camera overlay
  qrOverlay:       $('qrOverlay'),
  qrVideo:         $('qrVideo'),
  qrCanvas:        $('qrCanvas'),
  qrCloseBtn:      $('qrCloseBtn'),
  // QR generator modal
  qrGenModal:      $('qrGenModal'),
  qrGenFloorInput: $('qrGenFloorInput'),
  qrGenRowInput:   $('qrGenRowInput'),
  qrGenColInput:   $('qrGenColInput'),
  qrGenGoBtn:      $('qrGenGoBtn'),
  qrGenCanvas:     $('qrGenCanvas'),
  qrGenLabel:      $('qrGenLabel'),
  qrSaveBtn:       $('qrSaveBtn'),
  qrGenCloseBtn:   $('qrGenCloseBtn'),
  // Selection toolbar
  selToolbar:      $('selToolbar'),
  selRotCCW:       $('selRotCCW'),
  selRotCW:        $('selRotCW'),
  selMove:         $('selMove'),
  selDelete:       $('selDelete'),
  selDeselect:     $('selDeselect'),
  // Tools panel
  toolsPanel:      $('toolsPanel'),
  stampCanvas:     $('stampCanvas'),
  stampSizeInput:  $('stampSizeInput'),
  rotateCCWBtn:    $('rotateCCWBtn'),
  rotateCWBtn:     $('rotateCWBtn'),
  clearStampBtn:   $('clearStampBtn'),
  savePresetBtn:   $('savePresetBtn'),
  stampNameInput:  $('stampNameInput'),
  catalogueList:   $('catalogueList'),
  presetList:      $('presetList'),
};

// ── Init ──────────────────────────────────────────────────────────────────────
let renderer;

// ── Department navigation (called by CHAT "Take me there") ────────────────────
let _departments = null;

async function _loadDepartments() {
  if (_departments) return _departments;
  try {
    const res = await fetch('data/departments.json');
    _departments = await res.json();
  } catch (e) {
    _departments = {};
  }
  return _departments;
}

// Human floor names for routing messages.
function _floorName(f) {
  return ({ 0: "the Lower Ground Floor", 1: "the Ground Floor",
            2: "the 2nd Floor", 3: "the 3rd Floor" }[f]) || `Floor ${f + 1}`;
}

// Nearest 'stair' cell on the CURRENT floor to (row,col), or null if none.
function _nearestStairOnCurrentFloor(row, col) {
  let best = null, bestD = Infinity;
  for (const n of NODES) {
    if (n.cellType !== "stair") continue;
    const d = Math.abs(n.row - row) + Math.abs(n.col - col);
    if (d < bestD) { bestD = d; best = { row: n.row, col: n.col }; }
  }
  return best;
}

// Nearest walkable (non-wall) cell on the CURRENT floor to (row,col), or null.
function _nearestOpenCell(row, col) {
  let best = null, bestD = Infinity;
  for (const n of NODES) {
    if (n.wall) continue;
    const d = Math.abs(n.row - row) + Math.abs(n.col - col);
    if (d < bestD) { bestD = d; best = { row: n.row, col: n.col }; }
  }
  return best;
}

// Nearest walkable cell to (targetRow,targetCol) that is REACHABLE from startId
// (same connected walkable region). Guarantees a route exists from start to the
// result. Returns { row, col, dist } where dist is the Manhattan gap left to the
// target (0 = exact hit), or null if the start cell itself isn't walkable.
// This avoids "No path" when an office's stamp anchor lands on a wall or in a
// pocket the user can't reach.
function _nearestReachableCell(targetRow, targetCol, startId) {
  const start = NODE_MAP[startId];
  if (!start || start.wall) return null;
  const seen  = new Set([startId]);
  const queue = [startId];
  const dirs  = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  let best  = { row: start.row, col: start.col };
  let bestD = Math.abs(start.row - targetRow) + Math.abs(start.col - targetCol);
  let head  = 0;
  while (head < queue.length) {
    const n = NODE_MAP[queue[head++]];
    const d = Math.abs(n.row - targetRow) + Math.abs(n.col - targetCol);
    if (d < bestD) { bestD = d; best = { row: n.row, col: n.col }; if (d === 0) break; }
    for (const [dr, dc] of dirs) {
      const nr = n.row + dr, nc = n.col + dc;
      if (nr < 0 || nc < 0 || nr >= GRID_ROWS || nc >= GRID_COLS) continue;
      const nid = nodeId(nr, nc);
      if (seen.has(nid)) continue;
      const nb = NODE_MAP[nid];
      if (!nb || nb.wall) continue;
      seen.add(nid); queue.push(nid);
    }
  }
  best.dist = bestD;
  return best;
}

// ── Cross-floor routing ──────────────────────────────────────────────────────
// A trip to another floor is two walks, not one: current position → stairs, then
// stairs → office. The old code showed only the second, jumping the map to the
// destination floor and planting "you are here" on a stairwell the citizen had
// not reached yet, which threw away the position they had just set.
//
// The stair is chosen by minimising BOTH legs together. Picking the stair
// nearest the office (the previous rule, and by straight-line distance at that,
// ignoring walls) was sub-optimal on 24 of 35 cross-floor routes measured
// against the real layouts — worst case 157 cells walked where 59 would do.

let _crossFloorTrip = null;   // { leg, stair, destFloor, destCell, dept, subservice, answerText }

/** cellType array for a floor. The active floor lives in NODES, the rest in FLOOR_WALLS. */
function _floorCellTypes(floor) {
  if (floor === STATE.currentFloor) return NODES.map(n => n.cellType || 'open');
  const w = FLOOR_WALLS[floor];
  if (!w) return null;
  return w.map(v => (typeof v === 'boolean' ? (v ? 'wall' : 'open') : (v || 'open')));
}

/** Step distances from one cell across a floor, -1 where unreachable. */
function _bfsDistances(types, startRow, startCol) {
  const n = GRID_ROWS * GRID_COLS;
  const dist = new Int32Array(n).fill(-1);
  const s = startRow * GRID_COLS + startCol;
  if (types[s] === 'wall') return dist;
  dist[s] = 0;
  const queue = [s];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    const ur = (u / GRID_COLS) | 0, uc = u % GRID_COLS;
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nr = ur + dr, nc = uc + dc;
      if (nr < 0 || nc < 0 || nr >= GRID_ROWS || nc >= GRID_COLS) continue;
      const v = nr * GRID_COLS + nc;
      if (dist[v] !== -1 || types[v] === 'wall') continue;
      dist[v] = dist[u] + 1;
      queue.push(v);
    }
  }
  return dist;
}

/**
 * The stairwell that makes the whole journey shortest.
 *
 * Considers only cells that are stairs on BOTH floors — a landing that exists
 * on one side is not a way through. Returns null when no such stair is
 * reachable, so the caller can fall back rather than route into nothing.
 */
function _bestStairFor(fromFloor, fromRow, fromCol, toFloor, toRow, toCol) {
  const a = _floorCellTypes(fromFloor);
  const b = _floorCellTypes(toFloor);
  if (!a || !b) return null;

  // Office stamp anchors are frequently wall cells — 7 of the 11 on the 3rd
  // floor are. Measuring the second leg from a wall would make every BFS come
  // back empty and quietly disable two-leg routing for most offices, so snap
  // both ends onto walkable ground first.
  const snap = (types, row, col) => {
    if (types[row * GRID_COLS + col] !== 'wall') return { row, col };
    let best = null, bd = Infinity;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'wall') continue;
      const d = Math.abs(((i / GRID_COLS) | 0) - row) + Math.abs((i % GRID_COLS) - col);
      if (d < bd) { bd = d; best = { row: (i / GRID_COLS) | 0, col: i % GRID_COLS }; }
    }
    return best;
  };
  const start = snap(a, fromRow, fromCol);
  const end   = snap(b, toRow, toCol);
  if (!start || !end) return null;

  const dFrom = _bfsDistances(a, start.row, start.col);
  const dTo   = _bfsDistances(b, end.row, end.col);

  let best = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 'stair' || b[i] !== 'stair') continue;
    if (dFrom[i] < 0 || dTo[i] < 0) continue;          // unreachable on either side
    const total = dFrom[i] + dTo[i];
    if (!best || total < best.total) {
      best = { row: (i / GRID_COLS) | 0, col: i % GRID_COLS,
               legOne: dFrom[i], legTwo: dTo[i], total };
    }
  }
  return best;
}

/** Begin the second leg: cross to the destination floor and route to the office. */
function _startCrossFloorLegTwo() {
  const t = _crossFloorTrip;
  if (!t || t.leg !== 1) return;

  switchFloor(t.destFloor);
  navSetPosition(t.stair.row, t.stair.col);     // they came out of this stairwell
  NAV._stepsSinceQR = 0;

  t.leg = 2;
  STATE.startId = nodeId(t.stair.row, t.stair.col);
  renderer.startId = STATE.startId;

  const reach = _nearestReachableCell(t.destCell.row, t.destCell.col, STATE.startId);
  const end   = reach || t.destCell;
  STATE.endId = nodeId(end.row, end.col);
  renderer.setEnd(STATE.endId);
  recompute();

  renderer.navActive = true;
  renderer.focusOnCell(t.stair.row, t.stair.col, 2.2);
  document.body.classList.add('route-active');
  if (DOM.navStairBtn) DOM.navStairBtn.hidden = true;

  _navStepReset();
  _updateNavInstruction();
  _showStairToast(`🪜 ${_floorName(t.destFloor)} — follow the route to ${t.label || 'your office'}.`);
}

// ── Navigation telemetry ─────────────────────────────────────────────────────
// The chat log records what people asked; this records where they actually
// needed to go and whether they got there — route-completion rate and
// task-completion time (SOP 4.2.2), neither of which was measurable before.
//
// Privacy (RA 10173): the session id is a random token held only for this tab,
// used to pair a start with its arrival. Nothing identifies a person, nothing
// persists across visits, and no free text is sent.
//
// Only the citizen view is logged. An admin dragging routes around in the
// editor is not a citizen trip, and counting it would corrupt the demand data.

const NAV_SID_SS_KEY = 'wf-nav-sid';
let _navTrip = null;

function _navSid() {
  try {
    let s = sessionStorage.getItem(NAV_SID_SS_KEY);
    if (!s) {
      s = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(NAV_SID_SS_KEY, s);
    }
    return s;
  } catch (_) { return 'nosession'; }
}

/** Fire-and-forget. keepalive so an event sent as the page closes still lands. */
function _navLog(event, extra) {
  if (STATE.viewMode !== 'user') return;
  const body = JSON.stringify(Object.assign({ event, sid: _navSid() }, extra || {}));
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/navlog', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch (_) { /* fall through to fetch */ }
  try {
    fetch('/api/navlog', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body, keepalive: true,
    }).catch(() => {});
  } catch (_) { /* telemetry must never break navigation */ }
}

function _navTripStart(dept, subservice, from, to, pathLen) {
  // A new route while one is open means the previous trip was given up on.
  if (_navTrip && !_navTrip.arrived) _navTripAbandon();
  _navTrip = {
    startedAt: Date.now(), department: dept || null, subservice: subservice || null,
    from, to, pathLen, rescans: 0, arrived: false,
  };
  _navLog('nav_start', {
    department: dept, subservice,
    fromFloor: from.floor, fromRow: from.row, fromCol: from.col,
    toFloor: to.floor, toRow: to.row, toCol: to.col, pathLen,
  });
}

function _navTripArrive() {
  if (!_navTrip || _navTrip.arrived) return;
  _navTrip.arrived = true;
  _navLog('nav_arrive', {
    department: _navTrip.department, subservice: _navTrip.subservice,
    toFloor: _navTrip.to.floor, toRow: _navTrip.to.row, toCol: _navTrip.to.col,
    pathLen: _navTrip.pathLen, rescans: _navTrip.rescans,
    elapsed_ms: Date.now() - _navTrip.startedAt,
  });
}

function _navTripAbandon() {
  if (!_navTrip || _navTrip.arrived) { _navTrip = null; return; }
  _navLog('nav_abandon', {
    department: _navTrip.department, subservice: _navTrip.subservice,
    toFloor: _navTrip.to.floor, toRow: _navTrip.to.row, toCol: _navTrip.to.col,
    pathLen: _navTrip.pathLen, rescans: _navTrip.rescans,
    elapsed_ms: Date.now() - _navTrip.startedAt,
  });
  _navTrip = null;
}

// A tab closed mid-route is an abandon too, otherwise the completion rate
// quietly counts only the people who stayed.
window.addEventListener('pagehide', () => {
  if (_navTrip && !_navTrip.arrived) _navTripAbandon();
});

/**
 * Route the user to a department/service resolved by the RAG answer.
 * Uses service_locations.js to map the department → a stamp cell, picks the
 * nearest window to the user, switches floor if needed (routing from the
 * dest-floor stairs for cross-floor trips), and draws the path.
 *
 * @param {string} deptName    - canonical department from the RAG "Go to:" line
 * @param {string} [subservice] - the specific service (enables overrides)
 */
function navigateToDepartment(deptName, subservice, answerText) {
  if (typeof resolveServiceLocation !== "function") {
    alert(`Location for "${deptName}" has not been mapped yet.\nPlease ask at the Information desk.`);
    return;
  }

  // Where is the user now? PDR fix if available, else the default GF entrance.
  const from = NAV.position
    ? { floor: STATE.currentFloor, row: NAV.position.row, col: NAV.position.col }
    : SERVICE_DEFAULT_ENTRANCE;

  const loc = resolveServiceLocation(deptName, subservice, from);

  if (!loc) {
    alert(`Location for "${deptName}" isn't mapped yet.\nPlease ask at the Information desk.`);
    return;
  }
  if (loc.separateCampus) {
    _showStairToast(`📍 ${deptName} is at a separate campus, not inside City Hall.`);
    return;
  }

  const crossFloor = loc.floor !== STATE.currentFloor;

  // Cross-floor is two walks. Leg one goes from where the citizen actually is to
  // the stairwell that makes the whole journey shortest; leg two starts when
  // they confirm they have changed floors. The stair is picked over both legs,
  // not just proximity to the office.
  _crossFloorTrip = null;
  let stair = null;
  if (crossFloor) {
    stair = _bestStairFor(STATE.currentFloor, from.row, from.col, loc.floor, loc.row, loc.col);
    if (stair) {
      _crossFloorTrip = {
        leg: 1, stair,
        destFloor: loc.floor,
        destCell:  { row: loc.row, col: loc.col },
        label:     loc.label || deptName,
        dept: deptName, subservice, answerText,
      };
    } else {
      // No stairwell is a stair on BOTH floors and reachable from here — the map
      // cannot describe the climb. Fall back to the old destination-floor-only
      // route so the citizen still gets something usable.
      switchFloor(loc.floor);
    }
  }

  // Start cell: where the citizen is, except in the fallback above, which has
  // nothing better to offer than the dest-floor stairs nearest the office.
  let startCell;
  if (crossFloor && !stair) {
    startCell = _nearestStairOnCurrentFloor(loc.row, loc.col) || { row: loc.row, col: loc.col };
  } else {
    startCell = { row: from.row, col: from.col };
  }
  // Safety: the default entrance (38,72) sits on the outer wall — a route can't
  // start on a wall. Snap to the nearest walkable cell so navigation works even
  // before the user repositions via QR.
  const _startNode = NODE_MAP[nodeId(startCell.row, startCell.col)];
  if (_startNode && _startNode.wall) {
    startCell = _nearestOpenCell(startCell.row, startCell.col) || startCell;
    // Same floor: also move the LIVE position onto the walkable cell, so the
    // per-step recompute (PDR/WASD) never starts on a wall and flashes "blocked".
    if (!crossFloor && NAV.position) NAV.position = { row: startCell.row, col: startCell.col };
  }
  STATE.startId    = nodeId(startCell.row, startCell.col);
  renderer.startId = STATE.startId;

  // Destination: the office's stamp anchor is often a wall (or sits in a
  // walkable region the start can't reach), which would make recompute() report
  // "No path — walls are blocking the route." Snap the end to the nearest cell
  // actually reachable from the start so a route always draws.
  // On leg one the destination is the stairwell, not the office.
  const target = (_crossFloorTrip && _crossFloorTrip.leg === 1)
    ? _crossFloorTrip.stair
    : { row: loc.row, col: loc.col };
  const reach   = _nearestReachableCell(target.row, target.col, STATE.startId);
  const endCell = reach || { row: target.row, col: target.col };
  const reachGap = reach ? reach.dist : Infinity;   // 0 = exact target cell
  STATE.endId = nodeId(endCell.row, endCell.col);
  renderer.setEnd(STATE.endId);
  recompute();

  // User (chat-first) view: reveal the map, show the "you are here" marker at
  // the (default or PDR) start tile, and focus/zoom on it for follow-cam — no
  // Capture needed. Each PDR step re-centers via NAV.onPositionChange.
  if (STATE.viewMode === 'user') {
    document.body.classList.add('route-active');
    renderer.navActive = true;                       // draw "ME" at the start tile
    renderer.focusOnCell(startCell.row, startCell.col, 2.2);  // zoom in + center
    _ensurePdrOn();                                  // start step-tracking so the dot moves as they walk
  }

  // One live instruction at a time (like the arrival prompt), updated as the
  // user walks. Reset the wrong-way baseline for this fresh route.
  _navStepReset();
  _updateNavInstruction();

  // Carry the requirements to the arrival prompt. Built here rather than on
  // arrival because the chat answer is only in scope at this point.
  _arrivalReminder = _buildArrivalReminder(answerText, deptName, subservice);

  // Telemetry: this is the moment a trip begins. pathLen comes from the drawn
  // route, so it reflects the path actually given rather than a straight line.
  _navTripStart(
    deptName, subservice,
    { floor: STATE.currentFloor, row: startCell.row, col: startCell.col },
    { floor: loc.floor,          row: endCell.row,   col: endCell.col   },
    (renderer && renderer._path) ? renderer._path.length - 1 : null,
  );

  // Tell the user what's happening.
  if (loc.fallback) {
    _showStairToast(`📍 ${deptName} isn't pinned yet — routing to the Information desk. Please ask there.`);
  } else if (reachGap > 6) {
    // Couldn't get near the office — the floor map is probably missing a
    // doorway between regions. Guide as close as possible and say so.
    _showStairToast(`📍 Couldn't map a full path to ${loc.label} (a doorway may be missing on the map). Guiding you as close as possible — please ask at the desk.`);
  } else if (_crossFloorTrip && _crossFloorTrip.leg === 1) {
    const mpc = (typeof NAV !== 'undefined' && NAV.metresPerCell) ? NAV.metresPerCell : 1;
    const m   = Math.max(1, Math.round(_crossFloorTrip.stair.legOne * mpc));
    _showStairToast(`📍 ${loc.label} is on ${_floorName(loc.floor)}. First walk about ${m} m ` +
                    `to the stairs — the route shows the way.`);
    if (DOM.navStairBtn) DOM.navStairBtn.hidden = false;
  } else if (crossFloor) {
    _showStairToast(`📍 ${loc.label} is on ${_floorName(loc.floor)}. Take the stairs/elevator, then follow the route.`);
  } else {
    _showStairToast(`📍 Routing to ${loc.label}.`);
  }
}

// ── Live single-instruction turn-by-turn ────────────────────────────────────
// Instead of a full step list, show ONE instruction at a time (like the arrival
// prompt) that updates as the user walks: e.g. "Turn left, then walk about 8 m".
// Also warns when the user is heading the wrong way. Because onPositionChange
// recomputes the path from the current cell each step, renderer._path is always
// the REMAINING route — its first segment is the direction to walk right now.

let _navPrevPathLen = null;   // remaining path length last step (wrong-way detection)
let _navWrongStreak = 0;      // consecutive steps the route has grown
let _lastMeCell     = null;   // previous ME cell, for movement-based facing
const NAV_WRONG_WAY_STEPS = 2; // warn only after this many growth steps (PDR-drift tolerance)

function _navStepReset() {
  _navPrevPathLen = null;
  _navWrongStreak = 0;
  // a fresh route gets the "already here" option back
  if (DOM.navHereBtn) DOM.navHereBtn.hidden = false;
}

function _hideNavStep() {
  const el = document.getElementById('navStepPrompt');
  if (el) el.style.display = 'none';
}

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ME-puck facing, snapped strictly to the four grid cardinals (matches the PDR
// step mapping: grid up = North, right = East, down = South, left = West).
function _cardinalFromDelta(dr, dc) {
  if (dr === 0 && dc === 0) return null;
  if (Math.abs(dr) >= Math.abs(dc)) return dr < 0 ? 'N' : 'S';
  return dc > 0 ? 'E' : 'W';
}
function _cardinalFromHeading() {
  const h = ((NAV.heading - NAV.headingOffset) % 360 + 360) % 360;
  if (h < 45 || h >= 315) return 'N';
  if (h < 135) return 'E';
  if (h < 225) return 'S';
  return 'W';
}

/** Update the single live instruction from the remaining path. */
function _updateNavInstruction() {
  const el = document.getElementById('navStepPrompt');
  if (!el) return;

  // Only in the citizen view while a route is active.
  if (STATE.viewMode !== 'user' || !document.body.classList.contains('route-active') || !STATE.endId) {
    _hideNavStep(); return;
  }
  const path = (renderer && renderer._path) ? renderer._path : null;
  if (!path || path.length < 2) { _hideNavStep(); return; }   // arrived / no path

  const icon = document.getElementById('navStepIcon');
  const text = document.getElementById('navStepText');
  const remLen = path.length;

  // Wrong-way: the shortest remaining route grew vs the last step. A single
  // growth can be PDR jitter, so only warn after NAV_WRONG_WAY_STEPS consecutive
  // growth steps; any step toward the destination resets the streak.
  if (_navPrevPathLen != null && remLen > _navPrevPathLen) {
    _navWrongStreak++;
  } else {
    _navWrongStreak = 0;
  }
  _navPrevPathLen = remLen;

  if (_navWrongStreak >= NAV_WRONG_WAY_STEPS) {
    el.classList.add('wrong-way');
    icon.textContent = '⚠️';
    text.textContent = 'Wrong way — turn around and head back to the blue line';
    el.style.display = '';
    return;
  }
  el.classList.remove('wrong-way');

  // Compress the remaining path into straight runs.
  const pts = path.map(id => { const [r, c] = id.split(',').map(Number); return { r, c }; });
  const segs = [];
  let dir = null, len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dr = Math.sign(pts[i].r - pts[i - 1].r);
    const dc = Math.sign(pts[i].c - pts[i - 1].c);
    if (dir && dr === dir.dr && dc === dir.dc) { len++; }
    else { if (dir) segs.push({ dr: dir.dr, dc: dir.dc, len }); dir = { dr, dc }; len = 1; }
  }
  if (dir) segs.push({ dr: dir.dr, dc: dir.dc, len });

  const mpc = (typeof NAV !== 'undefined' && NAV.metresPerCell) ? NAV.metresPerCell : 1;
  const m   = cells => Math.max(1, Math.round(cells * mpc));
  const s0  = segs[0];

  if (segs.length === 1) {
    icon.textContent = '🏁';
    text.textContent = s0.len <= 2
      ? 'Almost there — your destination is just ahead'
      : `Walk about ${m(s0.len)} m to your destination`;
  } else {
    const s1    = segs[1];
    const cross = s0.dc * s1.dr - s0.dr * s1.dc;   // >0 right, <0 left (y-down)
    const dot   = s0.dc * s1.dc + s0.dr * s1.dr;
    let tword = 'turn', ticon = '➡️';
    if (dot < 0)        { tword = 'make a U-turn'; ticon = '↩️'; }
    else if (cross > 0) { tword = 'turn right';    ticon = '➡️'; }
    else if (cross < 0) { tword = 'turn left';     ticon = '⬅️'; }

    if (s0.len <= 2) {
      // At the corner → the user's requested phrasing.
      icon.textContent = ticon;
      text.textContent = `${_cap(tword)}, then walk about ${m(s1.len)} m`;
    } else {
      icon.textContent = '🚶';
      text.textContent = `Walk about ${m(s0.len)} m, then ${tword}`;
    }
  }
  el.style.display = '';
}

// Start PDR step-tracking if it isn't already running, so the ME dot moves as
// the citizen walks. Silent on devices without motion sensors (desktop testing
// uses WASD/arrows instead) — no "not supported" alert.
function _ensurePdrOn() {
  if (NAV.pdrActive) return;
  if (typeof DeviceMotionEvent === 'undefined') return;
  const started = navStartPDR();
  if (started && DOM.pdrToggleBtn) {
    DOM.pdrToggleBtn.textContent = '🚶 PDR: On';
    DOM.pdrToggleBtn.classList.add('active');
  }
}

// Hide the dev-server-only buttons (Sync / Deploy Floors / Deploy Stamps).
function _hideDevOnlyButtons() {
  [DOM.syncBtn, DOM.deployFloorsBtn, DOM.deployStampsBtn].forEach(b => {
    if (b) b.style.display = 'none';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadStampPlacements();
  loadStampPresets();
  // After loading per-device localStorage, apply any newer bundled stamp data
  // (from stamp_presets.js, shipped via git+Vercel). Idempotent: only runs
  // when STAMP_PRESETS_VERSION exceeds the stored version on this device.
  if (typeof syncStampPresetsBundle === 'function') syncStampPresetsBundle();
  loadCaptures();         // restore any fieldwork coordinate captures
  _loadCustomOffices();   // restore any on-site custom offices
  _loadFloorNames();      // bundled FLOOR_NAMES + any local rename overrides
  navInit();       // initialise NAV.position to the default entrance tile
  loadGridState(); // restore saved floor plan (after navInit so NODES exist)

  // Init chat widget
  CHAT.init();
  CHAT.onNavigate(requestNavigation);   // gates a QR location fix before routing

  renderer = new GridRenderer(DOM.canvas);
  renderer.currentFloor = STATE.currentFloor;
  renderer.onCellTap    = (row, col) => handleCellTap(row, col);
  renderer.onPointerUp  = () => { _wallGestureNew = true; };
  renderer.onSelectRect = (r1, c1, r2, c2) => {
    const pattern = getRegionWalls(r1, c1, r2, c2);
    selectionData = { r1, c1, r2, c2, pattern };
    floatingData  = null;
    renderer.floatingPattern = null;
    _showSelToolbar(true);
  };

  // NAV callbacks
  NAV.onPositionChange = (row, col) => {
    const id          = nodeId(row, col);
    STATE.startId     = id;
    renderer.startId  = id;
    DOM.navPosDisplay.textContent = `${row}, ${col}`;   // row,col — matches the signs
    // Face the way they just moved (only for a real step; QR teleports/heading
    // handle their own facing). Snapped strictly to a cardinal.
    if (_lastMeCell) {
      const card = _cardinalFromDelta(row - _lastMeCell.row, col - _lastMeCell.col);
      if (card) renderer.meFacing = card;
    }
    _lastMeCell = { row, col };
    renderer.centerOnCell(row, col);
    updateDriftIndicator();
    recompute();
    renderer._draw();
    // Arrival detection. On leg one of a cross-floor trip the "destination" is
    // the stairwell, so reaching it starts the climb rather than celebrating.
    if (STATE.endId && id === STATE.endId && _crossFloorTrip && _crossFloorTrip.leg === 1) {
      _hideNavStep();
      _showStairConfirm(_crossFloorTrip.destFloor);
    } else if (STATE.endId && id === STATE.endId) {
      _hideNavStep();
      _showArrivalPrompt();
    } else {
      _updateNavInstruction();   // refresh the one live instruction as they walk
    }
  };

  NAV.onFloorChange = (floor) => { switchFloor(floor); };

  // Stair detection: when user lands on a stair cell, show a direction prompt
  // if both floors are reachable, or auto-switch if only one direction is possible.
  // Cooldown prevents re-firing while standing on the same cell.
  let _stairCooldown = false;
  NAV.onStairCell = (row, col) => {
    if (_stairCooldown) return;
    _stairCooldown = true;
    setTimeout(() => { _stairCooldown = false; }, 2000);

    const f   = STATE.currentFloor;
    const idx = row * GRID_COLS + col;

    // Returns true if the given floor has a stair at (row, col)
    function _hasStairAt(floor) {
      if (floor < 0 || floor > 9) return false;
      if (floor === f) return true;
      const data = FLOOR_WALLS[floor];
      if (!data) return false;
      return data[idx] === 'stair';
    }

    const upOk   = _hasStairAt(f + 1);
    const downOk = _hasStairAt(f - 1);

    if (!upOk && !downOk) {
      // Isolated stair — no matching stair on any adjacent floor
      _showStairToast('🪜 Stair — no connected floor found');
      return;
    }

    if (upOk && !downOk) {
      // One direction — ask if user has already climbed before switching
      _showStairConfirm(f + 1);
    } else if (downOk && !upOk) {
      _showStairConfirm(f - 1);
    } else {
      // Both directions possible — ask the user which floor
      _showStairPrompt(f - 1, f + 1);
    }
  };

  NAV.onHeadingChange = (h) => {
    DOM.compassNeedle.style.transform = `rotate(${h}deg)`;
    DOM.compassHdgText.textContent = `${Math.round(h)}°`;
    // Turn the ME-puck triangle to the way they're facing. Snapped to a cardinal,
    // so we only redraw when it actually flips (crossing a 45° boundary) — cheap.
    if (renderer && renderer.navActive) {
      const card = _cardinalFromHeading();
      if (card !== renderer.meFacing) { renderer.meFacing = card; renderer._draw(); }
    }
  };

  // Header buttons
  DOM.undoBtn.addEventListener('click',  undo);
  DOM.redoBtn.addEventListener('click',  redo);
  DOM.wallBtn.addEventListener('click',  () => setWallMode(!STATE.wallMode));
  // Paint type buttons — header bar (wall mode) + stamp panel, both call the same fn
  [DOM.ptWallBtn, DOM.ptDoorBtn, DOM.ptStairBtn, DOM.ptEraseBtn,
   DOM.spWallBtn, DOM.spDoorBtn, DOM.spStairBtn, DOM.spEraseBtn].forEach(btn => {
    btn.addEventListener('click', () => setPaintType(btn.dataset.type));
  });
  DOM.selectBtn.addEventListener('click',() => setSelectMode(!STATE.selectMode));
  DOM.navBtn.addEventListener('click',   () => setNavMode(!STATE.navMode));
  DOM.captureBtn.addEventListener('click', () => setCaptureMode(!STATE.captureMode));
  DOM.stampBtn.addEventListener('click', () => setToolsPanel(!STATE.panelOpen));

  // Capture bar buttons
  DOM.captureDeptSelect.addEventListener('change', _onCaptureDeptChange);
  DOM.captureHereBtn.addEventListener('click', captureAtPosition);
  DOM.captureSetPosBtn.addEventListener('click', () => setSetPosMode(!STATE.setPosMode));
  DOM.captureAlignBtn.addEventListener('click', () => {
    if (typeof navAlignForward !== 'function') return;
    const ok = navAlignForward();
    _flashCaptureFeedback(ok
      ? `Aligned. Forward = phone's current direction (raw compass ${Math.round(NAV.heading)}°).`
      : 'Aligning… will lock on the next compass reading.');
  });
  DOM.captureExportBtn.addEventListener('click', exportCaptures);
  DOM.captureClearBtn.addEventListener('click', clearCaptures);
  DOM.captureRecBtn.addEventListener('click', () => {
    if (_walkRecorder) stopWalkRecording();
    else                startWalkRecording();
  });
  DOM.captureExportWalksBtn.addEventListener('click', exportRecordedWalks);
  _loadRecordedWalks();
  _updateWalkCount();
  DOM.clearBtn.addEventListener('click', clearWalls);
  DOM.resetBtn.addEventListener('click', reset);
  DOM.newMapBtn.addEventListener('click', clearGridState);
  DOM.syncBtn.addEventListener('click', async () => {
    DOM.syncBtn.textContent  = '☁ Syncing…';
    DOM.syncBtn.disabled     = true;
    const ok = await pullStateFromServer();
    DOM.syncBtn.textContent  = ok ? '✓ Synced' : '✗ No server';
    DOM.syncBtn.disabled     = false;
    setTimeout(() => { DOM.syncBtn.textContent = '☁ Sync'; }, 2000);
  });

  DOM.exportFloorsBtn.addEventListener('click', exportFloorPresetsFile);
  DOM.deployFloorsBtn.addEventListener('click', deployFloorPresetsToGit);
  // Wrapped, not passed directly: the click Event would arrive as `force` and
  // turn every publish into a silent overwrite.
  if (DOM.publishCloudBtn) DOM.publishCloudBtn.addEventListener('click', () => publishMapToCloud(false));
  DOM.dupFloorBtn.addEventListener('click', duplicateCurrentFloor);
  DOM.renameFloorBtn.addEventListener('click', renameCurrentFloor);

  // View-mode controls. Shared by the permanent 🔧 toggle and the temporary
  // landing-page button, so the PIN gate exists in exactly one place.
  async function _enterAdminWithPin(btn) {
    const pin = prompt('Enter staff PIN to access admin tools:');
    if (pin === null) return;
    if (btn) btn.disabled = true;
    const ok = await _adminPinAccepted(pin.trim());
    if (btn) btn.disabled = false;
    if (ok) setViewMode('admin');
    else alert('Incorrect PIN.');
  }

  /** Leave the editor, warning first if this device holds unpublished edits. */
  function _leaveAdminView() {
    if (isMapDirty()) {
      const go = confirm('You have map changes that have NOT been published.\n\n' +
                         'They stay saved on this device, but citizens will not see them ' +
                         'until you publish.\n\nLeave the editor anyway?');
      if (!go) return;
    }
    _previewingAsCitizen = false;
    setViewMode('user');
  }

  DOM.adminToggleBtn.addEventListener('click', () => {
    if (STATE.viewMode === 'admin') { _leaveAdminView(); return; }   // exit needs no PIN
    _enterAdminWithPin(DOM.adminToggleBtn);
  });

  // TEMPORARY — remove with the matching block in index.html and app.css.
  if (DOM.tempAdminBtn) {
    DOM.tempAdminBtn.addEventListener('click', () => _enterAdminWithPin(DOM.tempAdminBtn));
  }

  // Admin safety rail: preview, revert, history
  if (DOM.previewCitizenBtn) DOM.previewCitizenBtn.addEventListener('click', enterCitizenPreview);
  if (DOM.exitPreviewBtn)    DOM.exitPreviewBtn.addEventListener('click', exitCitizenPreview);
  if (DOM.revertDraftBtn)    DOM.revertDraftBtn.addEventListener('click', revertToPublished);
  if (DOM.mapHistoryBtn)     DOM.mapHistoryBtn.addEventListener('click', showMapHistory);
  if (DOM.mapHistoryClose)   DOM.mapHistoryClose.addEventListener('click', hideMapHistory);
  // Landing call-to-action: the primary entry point on the citizen's first screen.
  if (DOM.landingCtaBtn) {
    DOM.landingCtaBtn.addEventListener('click', () => {
      if (typeof CHAT !== 'undefined' && CHAT.open) CHAT.open();
    });
  }

  DOM.askAgainBtn.addEventListener('click', () => {
    // Was only hiding the chrome, which left the trip open: no nav_abandon was
    // recorded, the QR prompt stayed suppressed, and the old arrival reminder
    // survived into the next journey. Ending the route properly, exactly as the
    // arrival prompt's own "Ask again" does.
    _clearFinishedRoute();
    _hideNavStep();
    if (typeof CHAT !== 'undefined' && CHAT.open) CHAT.open();
  });

  DOM.exportStampsBtn.addEventListener('click', exportStampPresetsFile);
  DOM.deployStampsBtn.addEventListener('click', deployStampPresetsToGit);

  // Floor-actions dropdown: toggle on its button, close on outside click,
  // close after any item is picked.
  const _closeFloorMenu = () => {
    if (!DOM.floorActionsMenu) return;
    DOM.floorActionsMenu.setAttribute('hidden', '');
    if (DOM.floorActionsBtn) DOM.floorActionsBtn.setAttribute('aria-expanded', 'false');
  };
  DOM.floorActionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !DOM.floorActionsMenu.hasAttribute('hidden');
    if (isOpen) { _closeFloorMenu(); return; }
    DOM.floorActionsMenu.removeAttribute('hidden');
    DOM.floorActionsBtn.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', (e) => {
    if (DOM.floorActionsMenu.hasAttribute('hidden')) return;
    if (!DOM.floorActionsMenu.contains(e.target) && e.target !== DOM.floorActionsBtn) {
      _closeFloorMenu();
    }
  });
  [DOM.publishCloudBtn, DOM.dupFloorBtn, DOM.exportFloorsBtn, DOM.deployFloorsBtn,
   DOM.exportStampsBtn, DOM.deployStampsBtn].forEach(btn => {
    if (btn) btn.addEventListener('click', _closeFloorMenu);
  });

  // Sync, Deploy Floors, and Deploy Stamps all need the local dev server
  // (serve_https.py) — Vercel exposes neither /api/state nor /api/deploy-*.
  // One probe hides all three when it's unreachable; the download-only Export
  // buttons stay visible everywhere.
  (() => {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2000);
    fetch('/api/state', { method: 'GET', signal: controller.signal })
      .then(res => { clearTimeout(tid); if (!res.ok) _hideDevOnlyButtons(); })
      .catch(() => { clearTimeout(tid); _hideDevOnlyButtons(); });
  })();
  DOM.mobileMenuBtn.addEventListener('click', () => {
    const open = DOM.headerSecondary.classList.toggle('open');
    DOM.mobileMenuBtn.textContent = open ? '✕' : '⋯';
    DOM.mobileMenuBtn.title = open ? 'Close map tools' : 'Map editing tools';
  });
  // Close the overflow menu whenever a mode button inside it is tapped
  DOM.headerSecondary.addEventListener('click', e => {
    if (e.target.closest('.btn')) {
      DOM.headerSecondary.classList.remove('open');
      DOM.mobileMenuBtn.textContent = '⋯';
    }
  });

  DOM.floorDown.addEventListener('click', () => switchFloor(STATE.currentFloor - 1));
  DOM.floorUp.addEventListener('click',   () => switchFloor(STATE.currentFloor + 1));

  // Arrival prompt close button
  document.getElementById('arrivalCloseBtn').addEventListener('click', _hideArrivalPrompt);
  document.getElementById('arrivalAskAgainBtn').addEventListener('click', _arrivalAskAgain);
  document.getElementById('arrivalHomeBtn').addEventListener('click', _arrivalGoHome);

  // Nav panel buttons
  DOM.scanQRBtn.addEventListener('click', () => {
    DOM.qrOverlay.style.display = 'flex';
    navStartQRScan(DOM.qrVideo, DOM.qrCanvas, (r, c) => {
      NAV._stepsSinceQR = 0;
      updateDriftIndicator();
      DOM.qrOverlay.style.display = 'none';
    });
  });

  DOM.pdrToggleBtn.addEventListener('click', () => {
    if (NAV.pdrActive) {
      navStopPDR();
      DOM.pdrToggleBtn.textContent = '🚶 PDR: Off';
      DOM.pdrToggleBtn.classList.remove('active');
    } else {
      const started = navStartPDR();
      if (started) {
        DOM.pdrToggleBtn.textContent = '🚶 PDR: On';
        DOM.pdrToggleBtn.classList.add('active');
      }
    }
  });

  DOM.recalBtn.addEventListener('click', () => {
    navRecalibrate();
  });

  DOM.genQRBtn.addEventListener('click', () => {
    const hover = renderer._hoverCell;
    const def   = hover || NAV.position || { row: 0, col: 0 };
    // Input shows 1-indexed floor (Floor 1 = ground) to match what users expect
    DOM.qrGenFloorInput.value = STATE.currentFloor + 1;
    DOM.qrGenRowInput.value   = def.row;
    DOM.qrGenColInput.value   = def.col;
    DOM.qrGenLabel.textContent = `${def.row},${def.col} · Floor ${STATE.currentFloor + 1}`;
    navGenerateQR(STATE.currentFloor, def.row, def.col, DOM.qrGenCanvas);
    DOM.qrGenModal.style.display = 'flex';
  });

  DOM.qrGenGoBtn.addEventListener('click', () => {
    const fDisp = parseInt(DOM.qrGenFloorInput.value);  // 1-indexed display value
    const r     = parseInt(DOM.qrGenRowInput.value);
    const c     = parseInt(DOM.qrGenColInput.value);
    if (isNaN(r) || isNaN(c) || isNaN(fDisp)) return;
    DOM.qrGenLabel.textContent = `${r},${c} · Floor ${fDisp}`;
    navGenerateQR(fDisp - 1, r, c, DOM.qrGenCanvas);  // convert to 0-indexed internally
  });

  DOM.qrSaveBtn.addEventListener('click', () => {
    const fDisp = parseInt(DOM.qrGenFloorInput.value);  // 1-indexed
    const f     = fDisp - 1;                            // 0-indexed for filename match
    const r = parseInt(DOM.qrGenRowInput.value);
    const c = parseInt(DOM.qrGenColInput.value);
    const cvs = DOM.qrGenCanvas.querySelector('canvas');
    if (!cvs) return;
    const link = document.createElement('a');
    link.download = `qr_f${f}_r${r}_c${c}.png`;
    link.href     = cvs.toDataURL('image/png');
    link.click();
  });

  DOM.qrCloseBtn.addEventListener('click', () => {
    navStopQRScan();
    DOM.qrOverlay.style.display = 'none';
    _restoreLandingIfIdle();
    _resumePendingNav();   // cancelled the scan → still route (from default/current)
  });

  DOM.qrGenCloseBtn.addEventListener('click', () => {
    DOM.qrGenModal.style.display = 'none';
  });

  // Selection toolbar
  DOM.selRotCCW.addEventListener('click',   () => rotateSelection(-1));
  DOM.selRotCW.addEventListener('click',    () => rotateSelection(1));
  DOM.selMove.addEventListener('click',     liftSelection);
  DOM.selDelete.addEventListener('click',   deleteSelection);
  DOM.selDeselect.addEventListener('click', clearSelectionState);

  // Stamp editor — rotation buttons
  DOM.rotateCCWBtn.addEventListener('click', () => {
    rotateStampCCW();
    drawStampEditor();
    if (STATE.stampMode) renderer._draw();
  });
  DOM.rotateCWBtn.addEventListener('click', () => {
    rotateStampCW();
    drawStampEditor();
    if (STATE.stampMode) renderer._draw();
  });
  DOM.clearStampBtn.addEventListener('click', () => {
    clearStamp();
    drawStampEditor();
    if (STATE.stampMode) renderer._draw();
  });
  DOM.savePresetBtn.addEventListener('click', () => {
    const name = DOM.stampNameInput.value.trim() || `Preset ${STAMP_PRESETS.length + 1}`;
    saveStampPreset(name);
    renderPresets();
  });
  DOM.stampSizeInput.addEventListener('change', e => {
    setStampSize(parseInt(e.target.value) || 5);
    DOM.stampSizeInput.value = STAMP_SIZE;
    drawStampEditor();
    if (STATE.stampMode) renderer._draw();
  });
  DOM.stampCanvas.addEventListener('click', stampEditorTap);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { clearSelectionState(); return; }

    // Move the nav cursor with arrows OR WASD (laptop fallback for on-site PDR).
    // Active in admin Navigate/Capture modes, and in the citizen view once a
    // route is drawn — so the walking flow is testable without a phone.
    // navSetPosition clamps to grid bounds and silently stops at walls.
    const canWalk = STATE.navMode || STATE.captureMode ||
      (STATE.viewMode === 'user' && document.body.classList.contains('route-active'));
    if (canWalk && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const { row, col } = NAV.position || { row: 0, col: 0 };
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowUp'    || k === 'w') { e.preventDefault(); navSetPosition(row - 1, col); return; }
      if (e.key === 'ArrowDown'  || k === 's') { e.preventDefault(); navSetPosition(row + 1, col); return; }
      if (e.key === 'ArrowLeft'  || k === 'a') { e.preventDefault(); navSetPosition(row, col - 1); return; }
      if (e.key === 'ArrowRight' || k === 'd') { e.preventDefault(); navSetPosition(row, col + 1); return; }
    }

    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  // Track Shift state for Shift+click "teleport" in Capture Mode.
  // (e.shiftKey is true whenever Shift is currently held, regardless of which
  // key fired the event, so this stays in sync without a dedicated keyup match.)
  const _trackShift = e => { _shiftHeld = e.shiftKey; };
  document.addEventListener('keydown', _trackShift);
  document.addEventListener('keyup',   _trackShift);
  window.addEventListener('blur',      () => { _shiftHeld = false; });

  window.addEventListener('resize', () => renderer.resize());

  drawStampEditor();
  renderCatalogue();
  renderPresets();
  updateInfoBar();
  _syncFloorDisplay();

  // Default to the citizen (chat-first) view. Kiosk-safe: never starts in admin.
  setViewMode('user');

  // Pull the cloud-published map (rooms/labels admins published) and apply it if
  // newer than this device's copy. Fire-and-forget — never blocks first paint.
  pullCloudMapState();

  // QR-first positioning: if the page was opened from a posted-QR deep link
  // (e.g. ?qr=1:38,72 scanned with the phone's native camera), set the user's
  // start location/floor now that the renderer + NAV callbacks are wired. This
  // also sets NAV._hasQRFix, which suppresses the later "Take me there" prompt.
  _applyStartupDeepLink();

  // Unless a QR/deep-link already placed the citizen precisely, open on the
  // Ground Floor where the default entrance position lives (a stale restored
  // floor must not strand the start marker / routing on the wrong floor).
  if (!NAV._hasQRFix) _pinCitizenStartFloor();

  // QR location prompt buttons. The prompt itself is shown AFTER "Take me there"
  // (see requestNavigation); each button then resumes the pending route.
  if (DOM.qrPromptScanBtn) DOM.qrPromptScanBtn.addEventListener('click', () => {
    _hideQrPrompt();
    _openQrScan(_resumePendingNav);     // route from the freshly-scanned position
  });
  if (DOM.qrPromptSkipBtn) DOM.qrPromptSkipBtn.addEventListener('click', () => {
    _hideQrPrompt();
    _resumePendingNav();                // route from the default/current position
  });

  // TEMPORARY — manual location entry. Remove with the matching blocks in
  // index.html and app.css. See the comment there.
  if (DOM.manualLocToggle) {
    DOM.manualLocToggle.addEventListener('click', () => {
      const open = DOM.manualLocPanel.hasAttribute('hidden');
      DOM.manualLocPanel.toggleAttribute('hidden', !open);
      DOM.manualLocToggle.setAttribute('aria-expanded', String(open));
    });
  }
  if (DOM.manualLocGo) {
    DOM.manualLocGo.addEventListener('click', () => {
      const f   = parseInt(DOM.manualLocFloor.value, 10) - 1;   // select is 1-indexed
      const row = parseInt(DOM.manualLocRow.value, 10);
      const col = parseInt(DOM.manualLocCol.value, 10);
      const say = (msg, bad) => {
        if (!DOM.manualLocMsg) return;
        DOM.manualLocMsg.textContent = msg;
        DOM.manualLocMsg.classList.toggle('bad', !!bad);
      };
      if (!Number.isFinite(row) || !Number.isFinite(col) ||
          row < 0 || col < 0 || row >= GRID_ROWS || col >= GRID_COLS) {
        say(`Row and column must be between 0 and ${GRID_ROWS - 1}.`, true);
        return;
      }
      const applied = _applyManualLocation(f, row, col);
      say(applied.message, false);
      if (applied.ok) {
        setTimeout(() => { _hideQrPrompt(); _resumePendingNav(); }, 700);
      }
    });
  }

  // Re-anchor mid-walk: scan a fresh QR to correct accumulated PDR drift. The
  // scan re-fixes NAV.position (via navSetPosition inside the scanner), which
  // recomputes the route from the new cell; we just clear the wrong-way streak
  // so the teleport isn't mistaken for walking backwards.
  // Manual leg-two trigger. PDR is unreliable enough that waiting for the ME
  // tile to land exactly on the stair cell would strand people mid-journey.
  if (DOM.navStairBtn) {
    DOM.navStairBtn.addEventListener('click', () => {
      if (_crossFloorTrip && _crossFloorTrip.leg === 1) _startCrossFloorLegTwo();
    });
  }

  // "I'm already here": the citizen found the office without following the route
  // to its last cell. Records the tile they were standing on, which is the only
  // ground truth available for how close the mapped anchor actually is.
  if (DOM.navHereBtn) {
    DOM.navHereBtn.addEventListener('click', _markAlreadyHere);
  }

  if (DOM.navRescanBtn) DOM.navRescanBtn.addEventListener('click', () => {
    _openQrScan(() => {
      _navStepReset();
      _updateNavInstruction();
      // Re-anchoring mid-route usually means they lost track of where they
      // were, so the count stands in for disorientation on that trip.
      if (_navTrip) {
        _navTrip.rescans++;
        _navLog('qr_rescan', {
          department: _navTrip.department,
          rescans:    _navTrip.rescans,
          elapsed_ms: Date.now() - _navTrip.startedAt,
        });
      }
    });
  });
});

/**
 * Apply a posted-QR deep link (?qr= / ?loc= / ?at=) to set the citizen's
 * starting floor + cell. This is the primary, most accurate way a citizen on
 * their own phone gets localised — PDR step-counting is only the backup.
 * Returns true if a deep link was applied.
 */
/**
 * TEMPORARY — set the citizen's position from typed coordinates.
 *
 * Does exactly what a scanned QR does (_applyStartupDeepLink), so a test run is
 * not blocked by a sign that will not scan. A wall cell is snapped to the
 * nearest walkable one and the snap is reported, rather than silently leaving
 * the marker inside a wall.
 *
 * Remove with the matching blocks in index.html and css/app.css.
 *
 * @returns {{ok: boolean, message: string}}
 */
function _applyManualLocation(floor, row, col) {
  const f = Math.max(0, Math.min(9, floor));
  if (f !== STATE.currentFloor) switchFloor(f);

  let r = row, c = col, snapped = false;
  const node = NODE_MAP[nodeId(r, c)];
  if (!node || node.wall) {
    const open = _nearestOpenCell(r, c);
    if (!open) return { ok: false, message: 'That floor has no walkable cell near there.' };
    r = open.row; c = open.col; snapped = true;
  }

  navSetPosition(r, c);
  NAV._hasQRFix     = true;          // treat as a real fix, same as a scan
  NAV._stepsSinceQR = 0;
  if (typeof updateDriftIndicator === 'function') updateDriftIndicator();

  // Spell the axes out: '38,71' alone reads as x,y to most people, which is
  // the reverse of the convention used by the node ids, the QR links and the
  // printed signs.
  const where = `${_floorName(f)} at across ${c}, down ${r}`;
  return {
    ok: true,
    message: snapped
      ? `across ${col}, down ${row} is a wall — moved you to the nearest open cell: ${where}.`
      : `Location set: ${where}.`,
  };
}

function _applyStartupDeepLink() {
  if (typeof navParseDeepLink !== 'function') return false;
  let raw;
  try {
    const params = new URLSearchParams(location.search);
    raw = params.get('qr') || params.get('loc') || params.get('at');
  } catch (_) { return false; }
  if (!raw) return false;

  const loc = navParseDeepLink(raw);
  if (!loc) return false;

  const f = Math.max(0, Math.min(9, loc.floor));
  if (f !== STATE.currentFloor) switchFloor(f);
  navSetPosition(loc.row, loc.col);          // fires onPositionChange (renderer ready)
  NAV._hasQRFix     = true;                  // treat as a real fix (A2)
  NAV._stepsSinceQR = 0;
  if (typeof updateDriftIndicator === 'function') updateDriftIndicator();
  _showStairToast(`📍 Location set from QR — you're on ${_floorName(f)}.`);
  return true;
}

// ── QR location prompt — gates the route after "Take me there" ───────────────
//
// Skipping suppresses the prompt for THIS journey only, not the whole session.
// Suppressing it session-wide meant one "Skip" silenced every later route until
// the tab was closed, which both hid the feature during on-site testing and
// meant a citizen who skipped once was never offered an accurate fix again.
// Cleared when a route ends (_clearFinishedRoute), so the next "Take me there"
// asks again. Someone who actually scanned has NAV._hasQRFix set and is never
// re-prompted regardless.
const QR_PROMPT_SS_KEY = 'wf-qr-prompt-dismissed';
let _pendingNav = null;   // {deptName, subservice} awaiting the QR-fix decision

function _hideQrPrompt() {
  if (DOM.qrPromptModal) DOM.qrPromptModal.style.display = 'none';
  try { sessionStorage.setItem(QR_PROMPT_SS_KEY, '1'); } catch (_) {}
}

function _qrPromptDismissed() {
  try { return sessionStorage.getItem(QR_PROMPT_SS_KEY) === '1'; } catch (_) { return false; }
}

/** Let the next route offer the QR prompt again. */
function _resetQrPrompt() {
  try { sessionStorage.removeItem(QR_PROMPT_SS_KEY); } catch (_) {}
}

/**
 * Open the camera QR scanner. On a successful scan the scanner re-fixes
 * NAV.position itself (navSetPosition → onPositionChange), so this just manages
 * the overlay and runs `onDone` afterwards. Used by both the initial prompt and
 * the mid-walk re-anchor button.
 */
/**
 * The landing card hides itself whenever `chat-showing` is on <body>. Opening
 * the scanner from the chat leaves that class behind if the panel closes
 * without toggling, so the citizen comes back from a scan to an empty screen
 * with no way to ask anything. Restore it whenever nothing else is on top.
 */
function _restoreLandingIfIdle() {
  if (STATE.viewMode !== 'user') return;
  if (document.body.classList.contains('route-active')) return;
  const panel = document.getElementById('chatPanel');
  const chatOpen = panel && panel.classList.contains('chat-open');
  if (!chatOpen) document.body.classList.remove('chat-showing');
}

function _openQrScan(onDone) {
  DOM.qrOverlay.style.display = 'flex';
  navStartQRScan(DOM.qrVideo, DOM.qrCanvas, () => {
    NAV._stepsSinceQR = 0;
    updateDriftIndicator();
    DOM.qrOverlay.style.display = 'none';
    _restoreLandingIfIdle();
    if (onDone) onDone();
  });
}

/**
 * Chat "Take me there" entry point. In the citizen view, the first time the user
 * navigates we offer a QR location fix (Scan / Skip) BEFORE drawing the route,
 * so directions start from where they actually are. Once they've scanned (or
 * skipped once, or arrived via a ?qr= deep link) we route immediately.
 */
function requestNavigation(deptName, subservice, answerText) {
  const needFix = STATE.viewMode === 'user' && !NAV._hasQRFix && !_qrPromptDismissed();
  if (needFix && DOM.qrPromptModal) {
    _pendingNav = { deptName, subservice, answerText };
    DOM.qrPromptModal.style.display = 'flex';
    return;
  }
  navigateToDepartment(deptName, subservice, answerText);
}

/** Resume the route that was waiting on the QR prompt (after scan / skip / cancel). */
function _resumePendingNav() {
  if (!_pendingNav) return;
  const { deptName, subservice, answerText } = _pendingNav;
  _pendingNav = null;
  navigateToDepartment(deptName, subservice, answerText);
}

// ── Arrival reminder ─────────────────────────────────────────────────────────
// The requirements are in the chat answer, but the chat is closed by the time
// the citizen reaches the counter — exactly when they need to know what to hand
// over. Carry them to the arrival prompt instead of making them scroll back.

let _arrivalReminder = null;   // { dept, service, items[] }

/**
 * Pull the requirement lines out of a RAG answer.
 *
 * Answers look like a numbered list followed by a "Go to:" line, e.g.
 *   1. Income Tax Return (secure at: BIR)
 *   Go to: CITY TREASURY MANAGEMENT OFFICE
 * The routing line is for the app, not the citizen, so it is dropped.
 */
function _buildArrivalReminder(answerText, dept, service) {
  const items = [];
  for (let raw of String(answerText || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^go to\s*:/i.test(line)) continue;               // routing directive
    const m = line.match(/^(?:\d+[.)]|[-•*])\s*(.+)$/);   // 1. / 1) / - / •
    if (!m || !m[1].trim()) continue;
    // The model emits markdown emphasis. The reminder is rendered as escaped
    // text, so **bold** would otherwise show as literal asterisks.
    const text = m[1]
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$)/g, '$1$2')
      .trim();
    if (text) items.push(text);
  }
  return { dept: dept || null, service: service || null, items: items.slice(0, 8) };
}

/** Render the reminder into the arrival prompt, or hide it if there is none. */
function _renderArrivalReminder() {
  const box = DOM.arrivalReminder;
  if (!box) return;
  const r = _arrivalReminder;
  if (!r || (!r.items.length && !r.service)) { box.hidden = true; return; }

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let html = '';
  if (r.service) html += `<p class="arrival-service">${esc(r.service)}</p>`;
  if (r.items.length) {
    html += '<p class="arrival-reminder-head">Ihanda / Have ready:</p><ul class="arrival-list">' +
            r.items.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';
  } else {
    html += '<p class="arrival-reminder-head">Ask at the counter for this service.</p>';
  }
  box.innerHTML = html;
  box.hidden = false;
}

// ── Cell interaction ──────────────────────────────────────────────────────────
function handleCellTap(row, col) {
  // Citizen (user) view: the map is read-only. The destination is set only by
  // the chat's "Take me there" — tapping the grid must NOT move the end tile.
  if (STATE.viewMode === 'user') return;

  const id   = nodeId(row, col);
  const node = NODE_MAP[id];

  // ── Capture mode ──────────────────────────────────────────────────────────
  // - "Set position" sub-mode (toggle button, mobile-friendly) OR Shift+click
  //   (laptop shortcut) teleports NAV.position here without recording an office.
  //   Useful for jumping to a starting cell before walking with PDR / WASD.
  // - Plain tap (sub-mode off, no Shift) captures the selected office at this cell.
  if (STATE.captureMode) {
    if (STATE.setPosMode || _shiftHeld) {
      navSetPosition(row, col);
      _flashCaptureFeedback(`Position set to F${STATE.currentFloor} (${row},${col})`);
      return;
    }
    const name = DOM.captureDeptSelect.value;
    if (!name) {
      _flashCaptureFeedback('Pick an office from the dropdown, then tap its location.');
      return;
    }
    captureOfficeAt(name, STATE.currentFloor, row, col);
    _flashCaptureFeedback(`Captured ${_shortName(name)} @ F${STATE.currentFloor} (${row},${col})`);
    return;
  }

  if (id === STATE.startId) return;

  // ── Drop floating selection ──────────────────────────────────────────────
  if (STATE.selectMode && floatingData) {
    const { pattern, rows, cols } = floatingData;
    pushUndo();
    applyRegionWalls(row, col, pattern);
    floatingData             = null;
    renderer.floatingPattern = null;
    const r2 = Math.min(row + rows - 1, GRID_ROWS - 1);
    const c2 = Math.min(col + cols - 1, GRID_COLS - 1);
    selectionData       = { r1: row, c1: col, r2, c2, pattern };
    renderer.selectionRect = { r1: row, c1: col, r2, c2 };
    _showSelToolbar(true);
    recompute();
    renderer._draw();
    return;
  }

  if (STATE.stampMode) {
    pushUndo();
    applyStamp(row, col);

    const name = DOM.stampNameInput.value.trim();
    if (name) {
      addStampPlacement(name, row, col, STAMP_SIZE, STATE.currentFloor);
      renderCatalogue();
    }

    if (STATE.endId && NODE_MAP[STATE.endId].wall) {
      STATE.endId = null;
      renderer.clearEnd();
    }
    recompute();
    renderer._draw();
    return;
  }

  if (STATE.wallMode) {
    if (_wallGestureNew) {
      pushUndo();
      _wallGestureNew = false;
    }
    const pt = STATE.paintType;
    if (pt === 'erase' || node.cellType === pt) {
      // Clicking same type or erase tool clears the cell
      node.cellType = 'open';
      node.wall     = false;
    } else {
      node.cellType = pt;
      node.wall     = (pt === 'wall');
    }
    if (node.wall && id === STATE.endId) {
      STATE.endId = null;
      renderer.clearEnd();
    }
    recompute();
    renderer._draw();
  } else {
    if (node.wall) return;
    STATE.endId = id;
    renderer.setEnd(id);
    recompute();
  }
}

// ── Pathfinding ───────────────────────────────────────────────────────────────
function recompute() {
  if (!STATE.endId) {
    renderer.clearPath();
    updateInfoBar();
    return;
  }

  const adj    = buildAdjacency();
  const result = dijkstra(STATE.startId, STATE.endId, adj);

  if (result) {
    const newLen = result.path.length;
    const curLen = renderer._path ? renderer._path.length : -1;
    const curPathBlocked = renderer._path
      ? renderer._path.some(id => NODE_MAP[id].wall)
      : false;
    const pathWrongDest = renderer._path
      ? renderer._path[renderer._path.length - 1] !== STATE.endId
      : true;
    if (newLen !== curLen || curPathBlocked || pathWrongDest) {
      renderer.setPath(result.path);
    }
    updateInfoBar(newLen - 1, null);
  } else {
    renderer.clearPath();
    updateInfoBar(null, 'No path — walls are blocking the route.');
  }
}

// ── Wall controls ─────────────────────────────────────────────────────────────
function setWallMode(active) {
  if (active && STATE.panelOpen)    setToolsPanel(false);
  if (active && STATE.selectMode)   setSelectMode(false);
  if (active && STATE.captureMode)  setCaptureMode(false);
  STATE.wallMode    = active;
  renderer.wallMode = active;
  DOM.wallBtn.classList.toggle('active', active);
  DOM.wallBtn.setAttribute('aria-pressed', active);
  DOM.paintTypeBar.style.display = active ? 'flex' : 'none';
  updateCursorAndHint();
}

/** Set the active paint type and update both toolbar sets (header bar + stamp panel). */
function setPaintType(type) {
  STATE.paintType    = type;
  renderer.paintType = type;
  [DOM.ptWallBtn, DOM.ptDoorBtn, DOM.ptStairBtn, DOM.ptEraseBtn,
   DOM.spWallBtn, DOM.spDoorBtn, DOM.spStairBtn, DOM.spEraseBtn].forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

function clearWalls() {
  pushUndo();
  NODES.forEach(n => { n.wall = false; n.cellType = 'open'; });
  recompute();
  renderer._draw();
}

function reset() {
  undoStack.length = 0;
  redoStack.length = 0;
  _updateUndoRedoBtns();
  NODES.forEach(n => { n.wall = false; n.cellType = 'open'; });
  STATE.endId = null;
  renderer.clearEnd();
  renderer.clearPath();
  setWallMode(false);
  if (STATE.selectMode) setSelectMode(false);
  if (STATE.panelOpen)  setToolsPanel(false);
  updateInfoBar();
  saveGridState();
}

// ── Tools panel ───────────────────────────────────────────────────────────────
function setToolsPanel(open) {
  if (open && STATE.wallMode)    setWallMode(false);
  if (open && STATE.captureMode) setCaptureMode(false);
  STATE.panelOpen    = open;
  STATE.stampMode    = open;
  renderer.stampMode = open;
  DOM.stampBtn.classList.toggle('active', open);
  DOM.stampBtn.setAttribute('aria-pressed', open);
  DOM.toolsPanel.style.display = open ? '' : 'none';
  if (!open) renderer._draw();
  requestAnimationFrame(() => renderer.resize());
  updateCursorAndHint();
}

// ── Navigate mode ─────────────────────────────────────────────────────────────
function setNavMode(active) {
  if (active) {
    if (STATE.wallMode)    setWallMode(false);
    if (STATE.panelOpen)   setToolsPanel(false);
    if (STATE.selectMode)  setSelectMode(false);
    if (STATE.captureMode) setCaptureMode(false);
  } else {
    navStopPDR();
    navStopQRScan();
    NAV._trail        = [];
    NAV._stepsSinceQR = 0;
    NAV._hasQRFix     = false;
    DOM.pdrToggleBtn.textContent = '🚶 PDR: Off';
    DOM.pdrToggleBtn.classList.remove('active');
    DOM.qrOverlay.style.display  = 'none';
    DOM.qrGenModal.style.display = 'none';
    DOM.driftDisplay.textContent = 'Fix: —';
    DOM.driftDisplay.className   = 'nav-drift';
    STATE.startId    = '0,0';
    renderer.startId = '0,0';
    _hideArrivalPrompt();
    _hideStairConfirm();
    _hideStairPrompt();
  }

  STATE.navMode      = active;
  renderer.navActive = active;
  DOM.navBtn.classList.toggle('active', active);
  DOM.navBtn.setAttribute('aria-pressed', active);
  DOM.navPanel.style.display = active ? 'flex' : 'none';

  if (active) {
    const { row, col } = NAV.position;
    const id            = nodeId(row, col);
    STATE.startId       = id;
    renderer.startId    = id;
    DOM.navPosDisplay.textContent = `${row}, ${col}`;   // row,col — matches the signs
    updateDriftIndicator();
  }

  recompute();
  renderer._draw();
  updateCursorAndHint();
}

// ── Capture mode (fieldwork coordinate capture) ───────────────────────────────
function setCaptureMode(active) {
  if (active) {
    if (STATE.wallMode)   setWallMode(false);
    if (STATE.panelOpen)  setToolsPanel(false);
    if (STATE.selectMode) setSelectMode(false);
    _populateCaptureDropdown();
    _updateCaptureCount();
  } else {
    // Exiting Capture Mode also exits the "Set position" sub-mode.
    if (STATE.setPosMode) setSetPosMode(false);
    // Also stop any active walk recording so the timer doesn't keep firing.
    if (_walkRecorder)   stopWalkRecording();
  }
  STATE.captureMode      = active;
  renderer.captureActive = active;
  DOM.captureBtn.classList.toggle('active', active);
  DOM.captureBtn.setAttribute('aria-pressed', active);
  DOM.captureBar.style.display = active ? 'flex' : 'none';
  renderer._draw();
  updateCursorAndHint();
}

/**
 * Toggle "Set position" sub-mode (only meaningful while Capture Mode is on).
 * When ON, plain taps move NAV.position instead of recording an office.
 * Mobile-friendly equivalent of Shift+click teleport.
 */
function setSetPosMode(active) {
  STATE.setPosMode = !!active;
  DOM.captureSetPosBtn.classList.toggle('active', !!active);
  DOM.captureSetPosBtn.setAttribute('aria-pressed', !!active);
  if (active) _flashCaptureFeedback('Set-position mode: tap a cell to put yourself there.');
}

/**
 * Fill the office dropdown. Runs in two phases:
 *  1. SYNCHRONOUS — populate immediately from the hardcoded fallback + custom
 *     offices so the list is NEVER empty (even if the network fetch fails).
 *  2. ASYNC enrich — try to load departments.json to pick up any extra offices.
 */
function _populateCaptureDropdown(preserveValue) {
  const sel = DOM.captureDeptSelect;
  const keep = preserveValue !== undefined ? preserveValue : sel.value;

  // Merge: fallback offices + any loaded departments + custom-added offices
  const loaded = _departments ? Object.keys(_departments) : [];
  const names = Array.from(new Set([...OFFICE_FALLBACK, ...loaded, ...CUSTOM_OFFICES]))
    .sort((a, b) => a.localeCompare(b));

  sel.innerHTML = '<option value="">— select office —</option>';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    const isCustom = CUSTOM_OFFICES.includes(name) && !OFFICE_FALLBACK.includes(name);
    const tick = CAPTURED_POINTS[name] ? '✓ ' : '';
    opt.textContent = `${tick}${name}${isCustom ? ' (custom)' : ''}`;
    sel.appendChild(opt);
  });

  // "Add new office" option at the very bottom
  const addOpt = document.createElement('option');
  addOpt.value = ADD_NEW_SENTINEL;
  addOpt.textContent = '➕ Add new office…';
  sel.appendChild(addOpt);

  // Restore prior selection if still valid
  if (keep && names.includes(keep)) sel.value = keep;

  // Async enrich from departments.json (non-blocking; refreshes if it adds names)
  _loadDepartments().then(deps => {
    const extra = Object.keys(deps).filter(n => !names.includes(n));
    if (extra.length) _populateCaptureDropdown(sel.value);
  }).catch(() => {});
}

/** Handle the dropdown's "Add new office" option. */
function _onCaptureDeptChange() {
  const sel = DOM.captureDeptSelect;
  if (sel.value !== ADD_NEW_SENTINEL) return;
  const name = (prompt('Enter the new office name (as it appears on the door sign):') || '').trim();
  if (!name) { sel.value = ''; return; }
  const upper = name.toUpperCase();
  if (!CUSTOM_OFFICES.includes(upper) && !OFFICE_FALLBACK.includes(upper)) {
    CUSTOM_OFFICES.push(upper);
    _saveCustomOffices();
  }
  _populateCaptureDropdown(upper);   // re-populate and select the new office
}

// ── Walk recorder (PDR testing instrumentation) ─────────────────────────────
//
// Records timestamped position + heading + EMA-alpha samples at 5 Hz while the
// user walks. Used to validate F1 (adaptive EMA), F2 (sensor fusion), F3
// (manual reset) on real hardware. Walks persist in localStorage and can be
// exported as JSON for offline analysis.

function _loadRecordedWalks() {
  try {
    const raw = localStorage.getItem(WALKS_LS_KEY);
    RECORDED_WALKS = raw ? JSON.parse(raw) : [];
  } catch (_) { RECORDED_WALKS = []; }
}

function _saveRecordedWalks() {
  try { localStorage.setItem(WALKS_LS_KEY, JSON.stringify(RECORDED_WALKS)); } catch (_) {}
}

function _updateWalkCount() {
  if (!DOM.walkCount) return;
  const n = RECORDED_WALKS.length;
  DOM.walkCount.textContent = `${n} walk${n === 1 ? '' : 's'}`;
  if (DOM.captureExportWalksBtn) {
    DOM.captureExportWalksBtn.title = n
      ? `Download all ${n} recorded walk${n === 1 ? '' : 's'} as JSON`
      : 'No walks recorded yet';
    DOM.captureExportWalksBtn.disabled = (n === 0);
  }
}

function _walkSampleNow() {
  if (!_walkRecorder) return;
  if (!NAV.position) return;
  const { row, col } = NAV.position;
  _walkRecorder.samples.push({
    t:       Date.now() - _walkRecorder.startedAt,
    row, col,
    heading: Math.round((NAV.heading || 0) * 10) / 10,
    alpha:   (NAV._compass && NAV._compass._lastAlpha != null)
                ? Math.round(NAV._compass._lastAlpha * 1000) / 1000
                : null,
  });
}

function startWalkRecording() {
  if (_walkRecorder) return;  // already recording

  // Auto-start PDR if it isn't running yet — the recorder is meaningless
  // without position updates flowing. navStartPDR() is idempotent and on
  // iOS will trigger the motion-permission prompt asynchronously; we still
  // start the recording immediately so the user doesn't have to coordinate
  // two taps. If permission is later denied, the user just sees a static
  // position in the recording (which itself is useful diagnostic info).
  const pdrAlreadyOn = !!(typeof NAV !== 'undefined' && NAV.pdrActive);
  let pdrAttempted   = false;
  if (!pdrAlreadyOn && typeof navStartPDR === 'function') {
    try {
      navStartPDR();
      pdrAttempted = true;
      // Sync the PDR toggle button label if present so the UI is consistent
      if (DOM.pdrToggleBtn) {
        DOM.pdrToggleBtn.textContent = '🚶 PDR: On';
        DOM.pdrToggleBtn.classList.add('active');
      }
    } catch (e) { /* fall through — record anyway */ }
  }

  _walkRecorder = {
    startedAt:    Date.now(),
    floor:        STATE.currentFloor,
    startCell:    NAV.position ? { ...NAV.position } : null,
    samples:      [],
    pdrAtStart:   pdrAlreadyOn,    // diagnostics: was PDR already on?
    app:          'app.js?v=37',
    ua:           (navigator.userAgent || '').slice(0, 140),
  };
  _walkSampleNow();   // initial sample at t=0
  _walkTimer = setInterval(_walkSampleNow, WALK_SAMPLE_MS);
  DOM.captureRecBtn.classList.add('active');
  DOM.captureRecBtn.setAttribute('aria-pressed', 'true');
  DOM.captureRecBtn.textContent = '⏹ Stop';

  // Tell the user what just happened so they understand if iOS prompts them.
  if (pdrAlreadyOn) {
    _flashCaptureFeedback('Recording walk… tap ⏹ Stop when done.');
  } else if (pdrAttempted) {
    _flashCaptureFeedback('Recording + auto-starting PDR. If prompted, ALLOW motion access.');
  } else {
    _flashCaptureFeedback('Recording walk (PDR unavailable — only Set-Position taps will move you).');
  }
}

function stopWalkRecording() {
  if (!_walkRecorder) return;
  if (_walkTimer) { clearInterval(_walkTimer); _walkTimer = null; }
  _walkSampleNow();   // final sample
  _walkRecorder.endedAt     = Date.now();
  _walkRecorder.duration_ms = _walkRecorder.endedAt - _walkRecorder.startedAt;
  _walkRecorder.endCell     = NAV.position ? { ...NAV.position } : null;
  _walkRecorder.sample_count = _walkRecorder.samples.length;
  RECORDED_WALKS.push(_walkRecorder);
  _saveRecordedWalks();
  const n = _walkRecorder.sample_count;
  const s = (_walkRecorder.duration_ms / 1000).toFixed(1);
  _flashCaptureFeedback(`Walk saved: ${n} samples / ${s}s.`);
  _walkRecorder = null;
  DOM.captureRecBtn.classList.remove('active');
  DOM.captureRecBtn.setAttribute('aria-pressed', 'false');
  DOM.captureRecBtn.textContent = '🔴 Rec';
  _updateWalkCount();
}

function exportRecordedWalks() {
  if (!RECORDED_WALKS.length) {
    _flashCaptureFeedback('No walks recorded yet.');
    return;
  }
  const payload = {
    exported_at:  new Date().toISOString(),
    walk_count:   RECORDED_WALKS.length,
    sample_hz:    Math.round(1000 / WALK_SAMPLE_MS),
    walks:        RECORDED_WALKS,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `pdr_walks_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  _flashCaptureFeedback(`Exported ${RECORDED_WALKS.length} walk(s).`);
}

function _saveCustomOffices() {
  try { localStorage.setItem(CUSTOM_OFFICES_LS_KEY, JSON.stringify(CUSTOM_OFFICES)); } catch (_) {}
}
function _loadCustomOffices() {
  try {
    const raw = localStorage.getItem(CUSTOM_OFFICES_LS_KEY);
    if (raw) CUSTOM_OFFICES = JSON.parse(raw);
  } catch (_) { CUSTOM_OFFICES = []; }
}

/** Record a capture: office name -> (floor, row, col). */
function captureOfficeAt(name, floor, row, col) {
  if (!name || name === ADD_NEW_SENTINEL) {
    alert('Select an office from the dropdown first.');
    return false;
  }
  CAPTURED_POINTS[name] = { floor, row, col, name };
  _saveCaptures();
  _updateCaptureCount();
  _populateCaptureDropdown();   // refresh the ✓ marks
  renderer._draw();
  return true;
}

/** Capture the currently-selected office at the live PDR/nav position. */
function captureAtPosition() {
  const name = DOM.captureDeptSelect.value;
  const { row, col } = NAV.position;
  if (captureOfficeAt(name, STATE.currentFloor, row, col)) {
    _flashCaptureFeedback(`Captured ${_shortName(name)} @ F${STATE.currentFloor} (${row},${col})`);
  }
}

function clearCaptures() {
  if (!Object.keys(CAPTURED_POINTS).length) return;
  if (!confirm('Clear ALL captured coordinates? This cannot be undone.')) return;
  for (const k of Object.keys(CAPTURED_POINTS)) delete CAPTURED_POINTS[k];
  _saveCaptures();
  _updateCaptureCount();
  _populateCaptureDropdown();
  renderer._draw();
}

/** Export captures as a departments.json-ready file. */
async function exportCaptures() {
  const deps = await _loadDepartments().catch(() => ({}));
  // Union of: fallback 21 + loaded departments + custom offices + anything captured
  const allNames = Array.from(new Set([
    ...OFFICE_FALLBACK,
    ...Object.keys(deps || {}),
    ...CUSTOM_OFFICES,
    ...Object.keys(CAPTURED_POINTS),
  ])).sort((a, b) => a.localeCompare(b));

  const out = {};
  allNames.forEach(name => {
    const cap = CAPTURED_POINTS[name];
    out[name] = cap
      ? { floor: cap.floor, row: cap.row, col: cap.col }
      : { floor: null, row: null, col: null };
  });
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'departments.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const n = Object.keys(CAPTURED_POINTS).length;
  _flashCaptureFeedback(`Exported departments.json (${n} mapped)`);
}

function _updateCaptureCount() {
  const loaded = _departments ? Object.keys(_departments) : [];
  const total  = new Set([...OFFICE_FALLBACK, ...loaded, ...CUSTOM_OFFICES]).size;
  const done   = Object.keys(CAPTURED_POINTS).length;
  if (DOM.captureCount) DOM.captureCount.textContent = `${done} / ${total}`;
}

function _shortName(name) {
  return name.length > 22 ? name.slice(0, 20) + '…' : name;
}

/** Build a short acronym code from a department name for compact map labels. */
function DEPT_CODE(name) {
  const stop = new Set(['and', 'the', 'of', 'for', 'a', 'an', '-']);
  const words = name.split(/\s+/).filter(w => w && !stop.has(w.toLowerCase()));
  const acr = words.map(w => w[0]).join('').toUpperCase();
  return acr.length >= 2 ? acr.slice(0, 6) : name.slice(0, 6).toUpperCase();
}

function _flashCaptureFeedback(msg) {
  DOM.hintBar.textContent = '✓ ' + msg;
  DOM.hintBar.classList.add('hint-success');
  setTimeout(() => { DOM.hintBar.classList.remove('hint-success'); updateCursorAndHint(); }, 2500);
}

function _saveCaptures() {
  try { localStorage.setItem(CAPTURE_LS_KEY, JSON.stringify(CAPTURED_POINTS)); } catch (_) {}
}

function loadCaptures() {
  try {
    const raw = localStorage.getItem(CAPTURE_LS_KEY);
    if (raw) Object.assign(CAPTURED_POINTS, JSON.parse(raw));
  } catch (_) {}
}

// ── Select mode ───────────────────────────────────────────────────────────────
function setSelectMode(active) {
  if (active) {
    if (STATE.wallMode)    setWallMode(false);
    if (STATE.panelOpen)   setToolsPanel(false);
    if (STATE.captureMode) setCaptureMode(false);
  }
  STATE.selectMode        = active;
  renderer.selectMode     = active;
  renderer.selectionRect  = null;
  renderer.dragRect       = null;
  renderer.floatingPattern= null;
  selectionData = null;
  floatingData  = null;
  DOM.selectBtn.classList.toggle('active', active);
  DOM.selectBtn.setAttribute('aria-pressed', active);
  _showSelToolbar(false);
  renderer._draw();
  updateCursorAndHint();
}

function _showSelToolbar(visible) {
  DOM.selToolbar.style.display = visible ? 'flex' : 'none';
}

function rotateSelection(dir) {
  if (!selectionData) return;
  const { r1, c1, r2, c2, pattern } = selectionData;
  const newPat  = dir === 1 ? rotatePatternCW(pattern) : rotatePatternCCW(pattern);
  const newRows = newPat.length, newCols = newPat[0].length;
  pushUndo();
  clearRegion(r1, c1, r2, c2);
  applyRegionWalls(r1, c1, newPat);
  const nr2 = Math.min(r1 + newRows - 1, GRID_ROWS - 1);
  const nc2 = Math.min(c1 + newCols - 1, GRID_COLS - 1);
  selectionData          = { r1, c1, r2: nr2, c2: nc2, pattern: newPat };
  renderer.selectionRect = { r1, c1, r2: nr2, c2: nc2 };
  recompute();
  renderer._draw();
}

function liftSelection() {
  if (!selectionData) return;
  const { r1, c1, r2, c2, pattern } = selectionData;
  const rows = r2 - r1 + 1, cols = c2 - c1 + 1;
  pushUndo();
  clearRegion(r1, c1, r2, c2);
  floatingData             = { pattern, rows, cols };
  renderer.floatingPattern = { pattern, rows, cols };
  renderer.selectionRect   = null;
  selectionData            = null;
  recompute();
  renderer._draw();
  updateCursorAndHint();
}

function deleteSelection() {
  if (!selectionData) return;
  const { r1, c1, r2, c2 } = selectionData;
  pushUndo();
  clearRegion(r1, c1, r2, c2);
  clearSelectionState();
  recompute();
  renderer._draw();
}

function clearSelectionState() {
  selectionData            = null;
  floatingData             = null;
  renderer.selectionRect   = null;
  renderer.floatingPattern = null;
  renderer.dragRect        = null;
  _showSelToolbar(false);
  renderer._draw();
}

// ── Floor management ──────────────────────────────────────────────────────────

/**
 * Switch to a different floor.
 * Saves the current floor's wall state, loads the target floor's walls
 * (blank grid if the floor hasn't been visited yet).
 */
function switchFloor(newFloor) {
  newFloor = Math.max(0, Math.min(9, newFloor));   // A1: cap at floor 9
  if (newFloor === STATE.currentFloor) return;

  // Save current floor walls into cache
  FLOOR_WALLS[STATE.currentFloor] = NODES.map(n => n.cellType || 'open');

  // Switch
  STATE.currentFloor    = newFloor;
  NAV._currentFloor     = newFloor;
  renderer.currentFloor = newFloor;

  // Load new floor walls (blank if new)
  const saved = FLOOR_WALLS[newFloor];
  NODES.forEach((n, i) => {
    const v = saved ? saved[i] : 'open';
    if (typeof v === 'boolean') { n.wall = v; n.cellType = v ? 'wall' : 'open'; }
    else { n.cellType = v || 'open'; n.wall = n.cellType === 'wall'; }
  });

  // Clear destination (it was on the other floor)
  STATE.endId = null;
  renderer.clearEnd();
  renderer.clearPath();

  // Clear nav trail — breadcrumbs from previous floor are misleading
  NAV._trail = [];

  _syncFloorDisplay();
  recompute();
  renderer._draw();
  saveGridState();
}

function _syncFloorDisplay() {
  DOM.floorDisplay.textContent = _floorLabel(STATE.currentFloor);
}

// Pin the citizen's starting floor to the Ground Floor — where the default
// entrance position (navInit → SERVICE_DEFAULT_ENTRANCE) lives. loadGridState()
// restores whatever floor was last saved on this device (an admin may have left
// the editor on Lower Ground), which would otherwise strand the citizen's start
// marker — and the "from floor" used for routing — on the wrong floor. We load
// the Ground floor's walls WITHOUT saveGridState(), so the admin's saved floor
// memory is preserved. A QR/deep-link fix takes priority, so callers skip this
// when NAV._hasQRFix is set.
function _pinCitizenStartFloor() {
  const GF = (typeof SERVICE_DEFAULT_ENTRANCE === 'object' && SERVICE_DEFAULT_ENTRANCE)
    ? SERVICE_DEFAULT_ENTRANCE.floor : 1;
  if (STATE.currentFloor === GF) { _syncFloorDisplay(); return; }
  // Cache the floor we're leaving, then load Ground (mirrors switchFloor, minus
  // the destination-clearing and persistence side effects).
  FLOOR_WALLS[STATE.currentFloor] = NODES.map(n => n.cellType || 'open');
  STATE.currentFloor = GF;
  NAV._currentFloor  = GF;
  if (renderer) renderer.currentFloor = GF;
  const walls = FLOOR_WALLS[GF];
  NODES.forEach((n, i) => {
    const v = walls ? walls[i] : 'open';
    if (typeof v === 'boolean') { n.wall = v; n.cellType = v ? 'wall' : 'open'; }
    else { n.cellType = v || 'open'; n.wall = n.cellType === 'wall'; }
  });
  _syncFloorDisplay();
  if (renderer) { recompute(); renderer._draw(); }
}

// ── Stair UI ──────────────────────────────────────────────────────────────────

let _stairToastTimer   = null;
let _stairPromptTimer  = null;

/** Brief confirmation pill (auto-dismiss). */
function _showStairToast(msg) {
  const el = document.getElementById('stairToast');
  if (!el) return;
  // Hide prompt if open
  _hideStairPrompt();
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_stairToastTimer);
  _stairToastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}

/** Direction prompt — shown when both up and down are possible.
 *  Auto-dismisses after 6 s with no tap. */
function _showStairPrompt(downFloor, upFloor) {
  const prompt    = document.getElementById('stairPrompt');
  const upBtn     = document.getElementById('stairUpBtn');
  const downBtn   = document.getElementById('stairDownBtn');
  const upLabel   = document.getElementById('stairUpLabel');
  const downLabel = document.getElementById('stairDownLabel');
  const stayBtn   = document.getElementById('stairStayBtn');
  if (!prompt) return;

  upLabel.textContent   = `Floor ${upFloor + 1}`;
  downLabel.textContent = `Floor ${downFloor + 1}`;

  // Wire buttons — use one-time handlers by cloning nodes to remove old listeners
  const newUp   = upBtn.cloneNode(true);
  const newDown = downBtn.cloneNode(true);
  const newStay = stayBtn.cloneNode(true);
  upBtn.replaceWith(newUp);
  downBtn.replaceWith(newDown);
  stayBtn.replaceWith(newStay);

  newUp.querySelector('span').textContent   = `Floor ${upFloor + 1}`;
  newDown.querySelector('span').textContent = `Floor ${downFloor + 1}`;

  newUp.addEventListener('click', () => {
    _hideStairPrompt();
    switchFloor(upFloor);
    _showStairToast(`🪜 Floor ${upFloor + 1}`);
  });
  newDown.addEventListener('click', () => {
    _hideStairPrompt();
    switchFloor(downFloor);
    _showStairToast(`🪜 Floor ${downFloor + 1}`);
  });
  newStay.addEventListener('click', _hideStairPrompt);

  prompt.style.display = 'flex';
  // Force reflow then animate in
  requestAnimationFrame(() => requestAnimationFrame(() => prompt.classList.add('visible')));

  clearTimeout(_stairPromptTimer);
  _stairPromptTimer = setTimeout(_hideStairPrompt, 6000);
}

function _hideStairPrompt() {
  clearTimeout(_stairPromptTimer);
  const prompt = document.getElementById('stairPrompt');
  if (!prompt) return;
  prompt.classList.remove('visible');
  setTimeout(() => { if (!prompt.classList.contains('visible')) prompt.style.display = 'none'; }, 250);
}

/** Single-direction stair confirm: "Have you climbed to Floor N?" [Yes] [Not yet]. */
let _stairConfirmTimer = null;

function _showStairConfirm(targetFloor) {
  const prompt = document.getElementById('stairConfirmPrompt');
  const label  = document.getElementById('stairConfirmLabel');
  let   yesBtn = document.getElementById('stairConfirmYesBtn');
  let   noBtn  = document.getElementById('stairConfirmNoBtn');
  if (!prompt) return;

  label.textContent = `Climbed to Floor ${targetFloor + 1}?`;

  // Clone to remove any old listeners
  const newYes = yesBtn.cloneNode(true);
  const newNo  = noBtn.cloneNode(true);
  yesBtn.replaceWith(newYes);
  noBtn.replaceWith(newNo);

  newYes.addEventListener('click', () => {
    _hideStairConfirm();
    // Mid-journey: changing floor is leg two starting, not just a map switch.
    if (_crossFloorTrip && _crossFloorTrip.leg === 1 && targetFloor === _crossFloorTrip.destFloor) {
      _startCrossFloorLegTwo();
      return;
    }
    switchFloor(targetFloor);
    _showStairToast(`🪜 Floor ${targetFloor + 1}`);
  });
  newNo.addEventListener('click', _hideStairConfirm);

  prompt.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => prompt.classList.add('visible')));

  clearTimeout(_stairConfirmTimer);
  _stairConfirmTimer = setTimeout(_hideStairConfirm, 8000);
}

function _hideStairConfirm() {
  clearTimeout(_stairConfirmTimer);
  const prompt = document.getElementById('stairConfirmPrompt');
  if (!prompt) return;
  prompt.classList.remove('visible');
  setTimeout(() => { if (!prompt.classList.contains('visible')) prompt.style.display = 'none'; }, 250);
}

// ── Arrival prompt ────────────────────────────────────────────────────────────

/**
 * The citizen says they have arrived before the route ran out.
 *
 * Logged with the cell they were standing on and the cell the route was aiming
 * at. The gap between those two is the only field measurement of how far a
 * mapped office anchor sits from where people actually stop, which is what
 * decides whether an anchor needs re-capturing.
 */
function _markAlreadyHere() {
  const at = NAV.position || { row: null, col: null };
  let want = { row: null, col: null };
  if (STATE.endId) {
    const [r, c] = STATE.endId.split(',').map(Number);
    want = { row: r, col: c };
  }
  const offBy = (at.row != null && want.row != null)
    ? Math.abs(at.row - want.row) + Math.abs(at.col - want.col) : null;

  _navLog('nav_already_here', {
    department: _navTrip ? _navTrip.department : null,
    subservice: _navTrip ? _navTrip.subservice : null,
    fromFloor: STATE.currentFloor, fromRow: at.row, fromCol: at.col,
    toFloor: STATE.currentFloor,  toRow: want.row, toCol: want.col,
    pathLen: offBy,
    elapsed_ms: _navTrip ? Date.now() - _navTrip.startedAt : null,
    rescans: _navTrip ? _navTrip.rescans : 0,
  });

  // Counts as a completed trip: they got where they were going.
  _navTripArrive();
  _hideNavStep();
  if (DOM.navHereBtn) DOM.navHereBtn.hidden = true;
  _renderArrivalReminder();
  const el = document.getElementById('arrivalPrompt');
  if (el) {
    el.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
  }
}

function _showArrivalPrompt() {
  const el = document.getElementById('arrivalPrompt');
  if (!el) return;
  _navTripArrive();            // the trip completed — record time on task
  _renderArrivalReminder();    // show what to hand over at the counter
  el.style.display = 'flex';
  // No auto-dismiss: the prompt now offers "Ask again" / "Back home" actions,
  // so it stays until the citizen chooses one (or taps ✕ to keep viewing the map).
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
}

function _hideArrivalPrompt() {
  const el = document.getElementById('arrivalPrompt');
  if (!el) return;
  el.classList.remove('visible');
  setTimeout(() => { if (!el.classList.contains('visible')) el.style.display = 'none'; }, 300);
}

// Clear the just-finished route (destination, path, ME marker) so the citizen
// returns to a clean state before asking again or going home.
function _clearFinishedRoute() {
  // Closing a route that never arrived is the completion-rate denominator.
  // _navTripAbandon() no-ops when the trip already arrived.
  _navTripAbandon();
  // This journey is over, so the next one asks for a location again.
  //
  // Both halves of the gate have to clear. _resetQrPrompt() undoes a "Skip";
  // _hasQRFix undoes a real scan or a manual entry, which otherwise stayed true
  // for the life of the page and silently suppressed every later prompt. That
  // mattered because the fix is stale the moment the journey ends: the citizen
  // is now standing at the office they were routed to, not where they scanned,
  // and PDR is the known weak link for carrying a position that far.
  // NAV.position is deliberately left alone — it is still the best guess until
  // they scan again, and clearing it would strand them at the default cell.
  _resetQrPrompt();
  _crossFloorTrip = null;
  if (DOM.navStairBtn) DOM.navStairBtn.hidden = true;
  NAV._hasQRFix = false;
  if (typeof updateDriftIndicator === 'function') updateDriftIndicator();
  _arrivalReminder = null;
  STATE.endId = null;
  document.body.classList.remove('route-active');
  _hideNavStep();
  if (renderer) {
    renderer.navActive = false;
    if (renderer.clearEnd)  renderer.clearEnd();
    if (renderer.clearPath) renderer.clearPath();
    renderer._draw();
  }
}

// Arrival → "Ask again": clear the finished route and reopen the assistant.
function _arrivalAskAgain() {
  _hideArrivalPrompt();
  _clearFinishedRoute();
  if (typeof CHAT !== 'undefined' && CHAT.open) CHAT.open();
}

// Arrival → "Back home": clear the finished route and collapse to the hero.
function _arrivalGoHome() {
  _hideArrivalPrompt();
  _clearFinishedRoute();
  if (typeof CHAT !== 'undefined' && CHAT.close) CHAT.close();
}

// ── Grid persistence (localStorage + server sync) ─────────────────────────────

function _buildStatePayload() {
  const allFloors = Object.assign({}, FLOOR_WALLS);
  allFloors[STATE.currentFloor] = NODES.map(n => n.cellType || 'open');
  return {
    grid: { floorWalls: allFloors, currentFloor: STATE.currentFloor },
    stampPlacements: STAMP_PLACEMENTS,
    stampPresets:    STAMP_PRESETS,
    floorNames:      _floorNames,
  };
}

function _applyStatePayload(data) {
  // Grid
  if (data.grid) {
    const { floorWalls, currentFloor } = data.grid;
    if (floorWalls) Object.assign(FLOOR_WALLS, floorWalls);
    const floor = (typeof currentFloor === 'number') ? currentFloor : 0;
    STATE.currentFloor    = floor;
    NAV._currentFloor     = floor;
    if (renderer) renderer.currentFloor = floor;
    const walls = FLOOR_WALLS[floor];
    if (walls) NODES.forEach((n, i) => {
      const v = walls[i];
      if (typeof v === 'boolean') { n.wall = v; n.cellType = v ? 'wall' : 'open'; }
      else { n.cellType = v || 'open'; n.wall = n.cellType === 'wall'; }
    });
    localStorage.setItem('wayfinding-grid-v1', JSON.stringify(data.grid));
    if (DOM.floorDisplay) DOM.floorDisplay.textContent = _floorLabel(floor);
  }
  // Stamp placements
  if (Array.isArray(data.stampPlacements)) {
    STAMP_PLACEMENTS.length = 0;
    STAMP_PLACEMENTS.push(...data.stampPlacements);
    localStorage.setItem('gridPathfinder_stampPlacements', JSON.stringify(STAMP_PLACEMENTS));
  }
  // Stamp presets
  if (Array.isArray(data.stampPresets)) {
    STAMP_PRESETS.length = 0;
    STAMP_PRESETS.push(...data.stampPresets);
    localStorage.setItem('gridPathfinder_stampPresets', JSON.stringify(STAMP_PRESETS));
  }
}

/**
 * Copy the current floor's walls / doors / stairs onto another floor.
 *
 * Common use case: the upper floors of City Hall share the same outer
 * octagonal shell as the ground floor. Design the shell once, duplicate
 * it to floors 2/3/4, then edit interior partitions on each.
 *
 * Behavior:
 *   - Prompts for the target floor number (1-indexed in the UI, matches
 *     what the floor selector shows).
 *   - Refuses to duplicate to the source floor.
 *   - If the target floor already has non-empty content, confirms before
 *     overwriting.
 *   - Records an undo step so a misclick is recoverable.
 *   - Does NOT switch to the target floor automatically — the operation
 *     stays where you are. Use the floor ▼/▲ arrows to inspect the copy.
 *
 * Source cells are read live (active floor's NODES). Target is written
 * into FLOOR_WALLS so the existing floor-switch machinery picks it up.
 */
function duplicateCurrentFloor() {
  const sourceFloor = STATE.currentFloor;
  const sourceCells = NODES.map(n => n.cellType || 'open');

  // Detect occupied floors (anything with at least one non-open cell) to
  // suggest a sensible default target.
  const occupied = new Set([sourceFloor]);
  Object.keys(FLOOR_WALLS).forEach(k => {
    const arr = FLOOR_WALLS[k];
    if (Array.isArray(arr) && arr.some(v => v && v !== 'open')) occupied.add(Number(k));
  });
  // Suggest the next floor number that exists OR the next number above source.
  let suggested = sourceFloor + 1;
  while (suggested <= 9 && occupied.has(suggested)) suggested++;
  if (suggested > 9) suggested = sourceFloor + 1;

  const targetStr = window.prompt(
    `Duplicate Floor ${sourceFloor + 1}'s layout to which floor?\n\n` +
    `Enter a floor number (1 – 10). Current floor stays unchanged; the\n` +
    `target floor's walls / doors / stairs will be overwritten.\n\n` +
    `Current:    Floor ${sourceFloor + 1}\n` +
    `Suggested:  Floor ${suggested + 1}`,
    String(suggested + 1)
  );
  if (targetStr === null) return;  // cancelled

  const target = parseInt(targetStr, 10) - 1;  // UI 1-indexed → internal 0-indexed
  if (isNaN(target) || target < 0 || target > 9) {
    alert('Invalid floor number. Must be between 1 and 10.');
    return;
  }
  if (target === sourceFloor) {
    alert(`That's the same floor you're on. Pick a different one.`);
    return;
  }

  // If the target has non-empty content, warn before overwriting.
  const existing = FLOOR_WALLS[target];
  if (Array.isArray(existing) && existing.some(v => v && v !== 'open')) {
    const ok = window.confirm(
      `Floor ${target + 1} already has content. Overwrite it with Floor ${sourceFloor + 1}?\n\n` +
      `Use Undo (Ctrl+Z) to restore.`
    );
    if (!ok) return;
  }

  // Snapshot for undo, then copy.
  if (typeof pushUndo === 'function') pushUndo();
  FLOOR_WALLS[target] = sourceCells.slice();

  // Persist immediately so the change survives reload even without an explicit save.
  try {
    const stored = JSON.parse(localStorage.getItem('wayfinding-grid-v1') || '{}');
    stored.floorWalls = Object.assign({}, stored.floorWalls || {}, FLOOR_WALLS);
    localStorage.setItem('wayfinding-grid-v1', JSON.stringify(stored));
  } catch (_) {}

  alert(
    `Duplicated Floor ${sourceFloor + 1} → Floor ${target + 1}.\n\n` +
    `Use the floor arrows (▼ / ▲) to switch to Floor ${target + 1} and edit ` +
    `the interior. Click Deploy Floors / Export Floors when ready to ship.`
  );

  // Trigger a redraw so floor previews (if any) update.
  if (typeof renderer !== 'undefined' && renderer._draw) renderer._draw();
}

/**
 * Export the current state of all floors as a drop-in replacement for
 * wayfinding-app/js/floor_presets.js, then trigger a browser download.
 *
 * Workflow for shipping a new layout to all users:
 *   1. Edit walls / doors / stairs in the Map Editor (any floor).
 *   2. Click "Export Floors" → downloads floor_presets.js to your Downloads.
 *   3. On the laptop, run:
 *        python tools/replace_floor_presets.py ~/Downloads/floor_presets.js
 *      …which overwrites the bundled file with the new one, showing the diff.
 *   4. git add wayfinding-app/js/floor_presets.js && git commit && git push
 *   5. Vercel auto-deploys → all visitors get the new layout on next reload.
 *
 * Implementation notes:
 *   - FLOOR_PRESETS_VERSION is auto-incremented so existing devices' cached
 *     localStorage (keyed against the old version) is invalidated and the
 *     new bundled layout is applied automatically.
 *   - FLOOR_PRESETS_DEPARTMENTS (suggested office centroids per floor) is
 *     preserved as-is — this export only updates wall structure.
 *   - The currently-active floor is read from NODES (live); inactive floors
 *     are read from FLOOR_WALLS (cache).
 *   - Backward-compatible: legacy boolean cells are upgraded to "wall"/"open"
 *     strings on export.
 */
/**
 * Build the floor_presets.js file content from the current floors. Shared by
 * the Export (download) and Deploy (git push) buttons so the two can never
 * drift apart. Mirrors _buildStampPresetsJS(). Returns the file text plus the
 * version + counts the callers report to the user.
 */
function _buildFloorPresetsJS() {
  const allFloors = Object.assign({}, FLOOR_WALLS);
  allFloors[STATE.currentFloor] = NODES.map(n => n.cellType || 'open');

  const curVer = (typeof FLOOR_PRESETS_VERSION === 'number') ? FLOOR_PRESETS_VERSION : 2;
  const newVer = curVer + 1;
  const stamp  = new Date().toISOString();

  const out = [];
  out.push('/**');
  out.push(' * floor_presets.js — pre-built 75×75 grid layouts for all 4 floors of');
  out.push(' * Calamba City Hall, generated from the anonymized floor plans.');
  out.push(' *');
  out.push(' * Loaded automatically on first app start (or after grid-size mismatch).');
  out.push(' * After load, the user can edit freely in the Map Editor as usual.');
  out.push(' *');
  out.push(` * AUTO-EXPORTED from the running app on ${stamp}.`);
  out.push(' * Do not hand-edit the cell arrays — use Floors ▾ → Export/Deploy Floors instead.');
  out.push(' */');
  out.push('');
  out.push('"use strict";');
  out.push('');
  out.push(`const FLOOR_PRESETS_GRID_SIZE = ${GRID_ROWS};`);
  out.push('// Bump this whenever the bundled layout changes — the app re-applies presets');
  out.push('// (overwriting stale localStorage) when the stored version differs.');
  out.push(`const FLOOR_PRESETS_VERSION = ${newVer};   // baked from app at v${curVer}`);
  out.push('');
  out.push('const FLOOR_NAMES = ' + JSON.stringify(_floorNames, null, 2) + ';');
  out.push('');
  out.push('const FLOOR_PRESETS = {');

  const floors = Object.keys(allFloors).map(Number)
                       .filter(n => !isNaN(n))
                       .sort((a, b) => a - b);
  for (const f of floors) {
    const arr = allFloors[f];
    if (!Array.isArray(arr)) continue;
    const cells = arr.map(v =>
      typeof v === 'boolean' ? (v ? 'wall' : 'open') : (v || 'open'));
    out.push(`  ${f}: [${cells.map(c => `"${c}"`).join(',')}],`);
  }
  out.push('};');
  out.push('');

  out.push('/** Suggested department centroids per floor, keyed by office name. */');
  if (typeof FLOOR_PRESETS_DEPARTMENTS !== 'undefined') {
    out.push('const FLOOR_PRESETS_DEPARTMENTS = '
             + JSON.stringify(FLOOR_PRESETS_DEPARTMENTS, null, 2) + ';');
  } else {
    out.push('const FLOOR_PRESETS_DEPARTMENTS = {};');
  }
  out.push('');

  out.push('/**');
  out.push(' * Populate FLOOR_WALLS from the bundled presets.');
  out.push(' * Returns the number of floors populated.');
  out.push(' */');
  out.push('function applyFloorPresets() {');
  out.push('  let n = 0;');
  out.push('  for (const [floor, cells] of Object.entries(FLOOR_PRESETS)) {');
  out.push('    FLOOR_WALLS[Number(floor)] = cells.slice();');
  out.push('    n++;');
  out.push('  }');
  out.push('  return n;');
  out.push('}');
  out.push('');

  const cellCount = floors.reduce((sum, f) => sum + (allFloors[f]?.length || 0), 0);
  return { content: out.join('\n'), curVer, newVer, floors, cellCount };
}

function exportFloorPresetsFile() {
  const { content, curVer, newVer, floors, cellCount } = _buildFloorPresetsJS();

  const blob = new Blob([content], { type: 'text/javascript;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'floor_presets.js';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  alert(`Exported floor_presets.js\n\n` +
        `Version:  v${curVer} → v${newVer}\n` +
        `Floors:   ${floors.length}\n` +
        `Cells:    ${cellCount.toLocaleString()}\n\n` +
        `Next steps (on the laptop):\n` +
        `  1. python tools/replace_floor_presets.py ~/Downloads/floor_presets.js\n` +
        `  2. git add . && git commit -m "Update floor plans"\n` +
        `  3. git push\n\n` +
        `Vercel deploys in ~60s, then all devices see the new layout on next reload.`);
}

/**
 * Build the same floor_presets.js content the Export Floors button would
 * produce, but POST it to /api/deploy-floors on the local dev server so
 * the dev server writes the file, commits, and pushes to origin/main in
 * one click. Only available when serve_https.py is the host — the button
 * is hidden on Vercel by the probe in init.
 *
 * Includes a confirmation dialog with editable commit message + version
 * preview so an accidental click can't ship bad data. Reports the full
 * git step output on failure (e.g., merge conflict, auth issue).
 */
async function deployFloorPresetsToGit() {
  // Same content as the Export Floors button, via the shared builder.
  const { content, curVer, newVer, floors } = _buildFloorPresetsJS();

  // Confirmation dialog with editable commit message.
  const defaultMsg = `Update floor plans (presets v${curVer} → v${newVer})`;
  const message = window.prompt(
    `Deploy floor plans?\n\n` +
    `Version:   v${curVer} → v${newVer}\n` +
    `Floors:    ${floors.length}\n` +
    `Cells:     ${content.length.toLocaleString()} chars\n\n` +
    `This will:\n` +
    `  1. Overwrite wayfinding-app/js/floor_presets.js\n` +
    `  2. git add + commit + push to origin/main\n` +
    `  3. Vercel auto-deploys (~60s) → live for all users\n\n` +
    `Commit message (editable; OK to deploy, Cancel to abort):`,
    defaultMsg
  );
  if (message === null) {
    return;  // User cancelled
  }

  // Visual busy state on the button.
  const btn = DOM.deployFloorsBtn;
  const origLabel = btn.textContent;
  btn.textContent  = 'Deploying…';
  btn.disabled     = true;

  try {
    const res = await fetch('/api/deploy-floors', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content, message: message.trim() || defaultMsg }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      btn.textContent = '✓ Deployed';
      const summary = `Deployed to git.\n\n` +
                      `Commit:  ${message.trim() || defaultMsg}\n` +
                      `Version: v${curVer} → v${newVer}\n\n` +
                      `Vercel will pick this up automatically in ~60s.\n` +
                      `Hard-refresh your phone / other devices after that.`;
      alert(summary);
    } else {
      btn.textContent = '✗ Failed';
      const stepsTxt = (data.steps || [])
        .map(s => `[${s.rc === 0 ? '✓' : '✗'}] ${s.cmd}\n${s.stderr || s.stdout || ''}`)
        .join('\n\n');
      alert(`Deploy failed:\n\n${data.error || 'Unknown error'}\n\n${stepsTxt}`);
    }
  } catch (err) {
    btn.textContent = '✗ Network';
    alert(`Deploy failed: ${err.message}\n\nIs the dev server still running?`);
  } finally {
    setTimeout(() => {
      btn.textContent = origLabel;
      btn.disabled    = false;
    }, 2500);
  }
}

// ── Stamp bundle export / deploy ───────────────────────────────────────
//
// Parallel of exportFloorPresetsFile() / deployFloorPresetsToGit() but for
// stamp_presets.js. Bake the current STAMP_PLACEMENTS + STAMP_PRESETS into
// a JS bundle, auto-bump STAMP_PRESETS_VERSION, and either download (Export)
// or POST to /api/deploy-stamps so the local dev server writes + git pushes
// in one click (Deploy).

function _buildStampPresetsJS() {
  const stamp = new Date().toISOString();
  const curVer = (typeof STAMP_PRESETS_VERSION === 'number') ? STAMP_PRESETS_VERSION : 0;
  const newVer = curVer + 1;

  // Tag every placement as bundled in the export, so other devices' merge
  // logic knows these came from the deploy (and not local-only).
  const placements = STAMP_PLACEMENTS.map(p => Object.assign({}, p, { source: 'bundled' }));
  // Pattern presets need a deep-ish copy so we don't mutate the live array.
  const presets = STAMP_PRESETS.map(p => Object.assign({}, p, {
    pattern: p.pattern.map(row => row.slice()),
  }));

  const out = [];
  out.push('/**');
  out.push(' * stamp_presets.js — bundled stamp placements + pattern presets for the');
  out.push(' * Calamba City Hall wayfinding app.');
  out.push(' *');
  out.push(' * Loaded automatically on first app start or when STAMP_PRESETS_VERSION');
  out.push(" * differs from what's cached in localStorage. Bundled placements OVERRIDE");
  out.push(' * matching IDs in localStorage; any locally-placed stamps without a');
  out.push(' * matching ID in the bundle are preserved (the merge logic lives in');
  out.push(' * applyStampPresets() in stamp_presets.js).');
  out.push(' *');
  out.push(` * AUTO-EXPORTED from the running app on ${stamp}.`);
  out.push(' * Do not hand-edit — use Floors ▾ → Export/Deploy Stamps instead.');
  out.push(' */');
  out.push('');
  out.push('"use strict";');
  out.push('');
  out.push(`const STAMP_PRESETS_VERSION = ${newVer};   // exported from app at v${curVer}`);
  out.push('');
  out.push('const STAMP_PLACEMENTS_BUNDLED = ' + JSON.stringify(placements, null, 2) + ';');
  out.push('');
  out.push('const STAMP_PRESETS_BUNDLED = ' + JSON.stringify(presets, null, 2) + ';');
  out.push('');
  out.push('function applyStampPresets() {');
  out.push("  if (typeof STAMP_PLACEMENTS !== 'undefined') {");
  out.push('    const bundledIds = new Set(STAMP_PLACEMENTS_BUNDLED.map(p => p.id));');
  out.push("    const locallyOnly = STAMP_PLACEMENTS.filter(p => !bundledIds.has(p.id) && p.source !== 'bundled');");
  out.push('    STAMP_PLACEMENTS.length = 0;');
  out.push('    STAMP_PLACEMENTS.push(');
  out.push('      ...STAMP_PLACEMENTS_BUNDLED.map(p => Object.assign({}, p)),');
  out.push('      ...locallyOnly,');
  out.push('    );');
  out.push("    if (typeof saveStampPlacements === 'function') saveStampPlacements();");
  out.push('  }');
  out.push("  if (typeof STAMP_PRESETS !== 'undefined') {");
  out.push('    STAMP_PRESETS.length = 0;');
  out.push('    STAMP_PRESETS.push(');
  out.push('      ...STAMP_PRESETS_BUNDLED.map(p => Object.assign({}, p, {');
  out.push('        pattern: p.pattern.map(row => row.slice()),');
  out.push('      })),');
  out.push('    );');
  out.push("    if (typeof _saveStampPresets === 'function') _saveStampPresets();");
  out.push('  }');
  out.push('}');
  out.push('');
  return { content: out.join('\n'), curVer, newVer, placementCount: placements.length, presetCount: presets.length };
}

function exportStampPresetsFile() {
  const { content, curVer, newVer, placementCount, presetCount } = _buildStampPresetsJS();
  const blob = new Blob([content], { type: 'text/javascript;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'stamp_presets.js';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  alert(
    `Exported stamp_presets.js\n\n` +
    `Version:     v${curVer} → v${newVer}\n` +
    `Placements:  ${placementCount}\n` +
    `Presets:     ${presetCount}\n` +
    `Size:        ${content.length.toLocaleString()} chars\n\n` +
    `Next steps (on the laptop):\n` +
    `  1. python tools/replace_stamp_presets.py ~/Downloads/stamp_presets.js\n` +
    `  2. git add . && git commit -m "Update stamps"\n` +
    `  3. git push\n\n` +
    `Vercel deploys in ~60s. All devices apply the new bundle on next reload.`
  );
}

async function deployStampPresetsToGit() {
  const { content, curVer, newVer, placementCount, presetCount } = _buildStampPresetsJS();
  const defaultMsg = `Update stamps (stamp_presets v${curVer} → v${newVer})`;
  const message = window.prompt(
    `Deploy stamp placements?\n\n` +
    `Version:     v${curVer} → v${newVer}\n` +
    `Placements:  ${placementCount}\n` +
    `Presets:     ${presetCount}\n\n` +
    `This will:\n` +
    `  1. Overwrite wayfinding-app/js/stamp_presets.js\n` +
    `  2. git add + commit + push to origin/main\n` +
    `  3. Vercel auto-deploys (~60s) → live for all users\n\n` +
    `Commit message (editable; OK to deploy, Cancel to abort):`,
    defaultMsg
  );
  if (message === null) return;

  const btn = DOM.deployStampsBtn;
  const origLabel = btn.textContent;
  btn.textContent = 'Deploying…';
  btn.disabled    = true;

  try {
    const res = await fetch('/api/deploy-stamps', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content, message: message.trim() || defaultMsg }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      btn.textContent = '✓ Deployed';
      alert(
        `Deployed stamps to git.\n\n` +
        `Commit:  ${message.trim() || defaultMsg}\n` +
        `Version: v${curVer} → v${newVer}\n\n` +
        `Vercel picks this up in ~60s.\n` +
        `Hard-refresh your phone / other devices after that — applyStampPresets() runs automatically.`
      );
    } else {
      btn.textContent = '✗ Failed';
      const stepsTxt = (data.steps || [])
        .map(s => `[${s.rc === 0 ? '✓' : '✗'}] ${s.cmd}\n${s.stderr || s.stdout || ''}`)
        .join('\n\n');
      alert(`Deploy failed:\n\n${data.error || 'Unknown error'}\n\n${stepsTxt}`);
    }
  } catch (err) {
    btn.textContent = '✗ Network';
    alert(`Deploy failed: ${err.message}\n\nIs the dev server still running?`);
  } finally {
    setTimeout(() => {
      btn.textContent = origLabel;
      btn.disabled    = false;
    }, 2500);
  }
}

async function pushStateToServer() {
  try {
    await fetch('/api/state', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(_buildStatePayload()),
    });
  } catch (_) {}   // silently ignore if server unreachable
}

async function pullStateFromServer() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || !data.grid) return false;
    _applyStatePayload(data);
    if (renderer) {
      recompute();
      renderer._draw();
      renderCatalogue();
      renderPresets();
    }
    return true;
  } catch (_) {
    return false;
  }
}

// ── Cloud-published map state (multi-admin, all-devices via Upstash) ───────────
// Unlike the dev-only /api/state path above (localhost serve_https.py), this
// works on Vercel: an admin edits rooms in the in-app editor, taps "Publish to
// all devices", and every visitor's device pulls the shared map on next load.
// Backed by api/mapstate.js (Upstash Redis, key wf:mapstate). Publishing is
// gated by MAP_ADMIN_TOKEN set server-side in Vercel.
const CLOUD_MAP_VER_LS_KEY = 'wf-cloud-mapver';
const PUBLISH_TOKEN_SS_KEY = 'wf-publish-token';
const PUBLISHED_FP_LS_KEY  = 'wf-published-fp';     // fingerprint of the live map
const ADMIN_NAME_LS_KEY    = 'wf-admin-name';       // who is editing, for the audit trail

// ── Draft vs published ───────────────────────────────────────────────────────
// Edits live in localStorage and only reach citizens on publish. Without a signal
// an admin cannot tell which of their changes are live, so every edit updates a
// fingerprint and the header shows whether this device is ahead of the cloud.

/** FNV-1a over the serialised payload. Cheap, and we only need change detection. */
function _mapFingerprint(payload) {
  const s = JSON.stringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36) + ':' + s.length;
}

function _publishedFingerprint() {
  try { return localStorage.getItem(PUBLISHED_FP_LS_KEY) || ''; } catch (_) { return ''; }
}
function _publishedVersion() {
  try { return parseInt(localStorage.getItem(CLOUD_MAP_VER_LS_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
function _rememberPublished(version, fp) {
  try {
    localStorage.setItem(CLOUD_MAP_VER_LS_KEY, String(version));
    localStorage.setItem(PUBLISHED_FP_LS_KEY, fp || _mapFingerprint(_buildStatePayload()));
  } catch (_) {}
  _refreshDraftBadge();
}

/** True when this device holds map edits that have not been published. */
function isMapDirty() {
  const live = _publishedFingerprint();
  if (!live) return false;            // nothing pulled yet — cannot tell, assume clean
  try { return _mapFingerprint(_buildStatePayload()) !== live; }
  catch (_) { return false; }
}

/** Who is editing. Asked once, then remembered, so publishes carry a real name. */
function _adminName(forcePrompt) {
  let name = '';
  try { name = localStorage.getItem(ADMIN_NAME_LS_KEY) || ''; } catch (_) {}
  if (!name || forcePrompt) {
    const typed = prompt('Your name or office (recorded with each publish, so the ' +
                         'team can see who changed the map):', name || '');
    if (typed === null) return name || '';
    name = typed.trim().slice(0, 60);
    try { localStorage.setItem(ADMIN_NAME_LS_KEY, name); } catch (_) {}
  }
  return name;
}

let _draftBadgeTimer = null;
/** Recompute the badge a beat after the last edit — fingerprinting is not free. */
function _scheduleDraftBadge() {
  clearTimeout(_draftBadgeTimer);
  _draftBadgeTimer = setTimeout(_refreshDraftBadge, 400);
}

function _refreshDraftBadge() {
  if (!DOM.draftBadge) return;
  if (STATE.viewMode !== 'admin') { DOM.draftBadge.hidden = true; return; }
  const dirty = isMapDirty();
  DOM.draftBadge.hidden = !dirty;
  if (dirty && DOM.draftBadgeText) {
    const v = _publishedVersion();
    DOM.draftBadgeText.textContent = v
      ? `Unpublished changes — citizens still see v${v}`
      : 'Unpublished changes';
  }
}

/** Count what differs between the working map and the published one. */
function _diffMapStates(mine, live) {
  const out = { cells: 0, floors: [], stampsAdded: 0, stampsRemoved: 0, stampsMoved: 0, namesChanged: 0 };
  if (!live) return out;

  const a = (mine.grid && mine.grid.floorWalls) || {};
  const b = (live.grid && live.grid.floorWalls) || {};
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[f] || [], y = b[f] || [];
    let n = 0;
    const len = Math.max(x.length, y.length);
    for (let i = 0; i < len; i++) if ((x[i] || 'open') !== (y[i] || 'open')) n++;
    if (n) { out.cells += n; out.floors.push({ floor: Number(f), cells: n }); }
  }

  const mapById = (arr) => Object.fromEntries((arr || []).map((p) => [p.id, p]));
  const am = mapById(mine.stampPlacements), bm = mapById(live.stampPlacements);
  for (const id of Object.keys(am)) {
    if (!bm[id]) { out.stampsAdded++; continue; }
    const p = am[id], q = bm[id];
    if (p.row !== q.row || p.col !== q.col || p.floor !== q.floor || p.name !== q.name) out.stampsMoved++;
  }
  for (const id of Object.keys(bm)) if (!am[id]) out.stampsRemoved++;

  const an = mine.floorNames || {}, bn = live.floorNames || {};
  for (const k of new Set([...Object.keys(an), ...Object.keys(bn)])) {
    if ((an[k] || '') !== (bn[k] || '')) out.namesChanged++;
  }
  return out;
}

/** Plain-language summary of a diff, for the publish confirmation. */
function _describeDiff(d) {
  const bits = [];
  if (d.cells) {
    const where = d.floors
      .sort((p, q) => q.cells - p.cells)
      .map((f) => `${_floorName(f.floor)} (${f.cells})`)
      .join(', ');
    bits.push(`${d.cells} wall/door/stair cell${d.cells === 1 ? '' : 's'} changed — ${where}`);
  }
  if (d.stampsAdded)   bits.push(`${d.stampsAdded} room${d.stampsAdded === 1 ? '' : 's'} added`);
  if (d.stampsRemoved) bits.push(`${d.stampsRemoved} room${d.stampsRemoved === 1 ? '' : 's'} removed`);
  if (d.stampsMoved)   bits.push(`${d.stampsMoved} room${d.stampsMoved === 1 ? '' : 's'} moved or renamed`);
  if (d.namesChanged)  bits.push(`${d.namesChanged} floor name${d.namesChanged === 1 ? '' : 's'} changed`);
  return bits.length ? bits.map((b) => '  • ' + b).join('\n') : '  • no differences detected';
}

/**
 * Apply a published map WITHOUT moving the viewer (a citizen mid-route must not
 * be teleported). Merges every floor's walls, refreshes the active floor in
 * NODES, replaces stamp placements + floor names. Persists so it survives reload.
 */
function _applyCloudState(state) {
  if (!state || typeof state !== 'object') return;
  if (state.grid && state.grid.floorWalls) {
    Object.assign(FLOOR_WALLS, state.grid.floorWalls);
    const walls = FLOOR_WALLS[STATE.currentFloor];
    if (walls) NODES.forEach((n, i) => {
      const v = walls[i];
      if (typeof v === 'boolean') { n.wall = v; n.cellType = v ? 'wall' : 'open'; }
      else { n.cellType = v || 'open'; n.wall = n.cellType === 'wall'; }
    });
    try {
      localStorage.setItem('wayfinding-grid-v1', JSON.stringify({
        floorWalls: FLOOR_WALLS, currentFloor: STATE.currentFloor,
      }));
    } catch (_) {}
  }
  if (Array.isArray(state.stampPlacements)) {
    STAMP_PLACEMENTS.length = 0;
    STAMP_PLACEMENTS.push(...state.stampPlacements);
    try { localStorage.setItem('gridPathfinder_stampPlacements', JSON.stringify(STAMP_PLACEMENTS)); } catch (_) {}
  }
  if (state.floorNames && typeof state.floorNames === 'object') {
    Object.assign(_floorNames, state.floorNames);
    try { localStorage.setItem(FLOOR_NAMES_LS_KEY, JSON.stringify(_floorNames)); } catch (_) {}
  }
  if (renderer) { recompute(); renderer._draw(); }
  if (typeof renderCatalogue === 'function') renderCatalogue();
  _syncFloorDisplay();
}

/**
 * On load: pull the published map; apply only if newer than what we hold.
 *
 * An admin with unpublished edits is NOT overwritten — their work would vanish
 * with no warning. They are told instead, and can Revert when ready.
 */
async function pullCloudMapState() {
  const stored = _publishedVersion();
  try {
    const res = await fetch('/api/mapstate', { method: 'GET' });
    if (!res.ok) return;
    const doc = await res.json();
    if (!doc || !doc.state || typeof doc.version !== 'number') return;
    if (doc.version <= stored) { _refreshDraftBadge(); return; }

    if (isMapDirty()) {
      console.warn(`[wayfinding] cloud map v${doc.version} available, but this device has ` +
                   'unpublished edits — keeping them. Use Revert to discard and take the live map.');
      _refreshDraftBadge();
      return;
    }
    _applyCloudState(doc.state);
    _rememberPublished(doc.version, _mapFingerprint(_buildStatePayload()));
    console.info(`[wayfinding] applied cloud map v${doc.version} (by ${doc.updatedBy || '?'})`);
  } catch (_) { /* offline / not configured — keep local */ }
}

/** Discard local edits and take whatever is currently published. */
async function revertToPublished() {
  if (!confirm('Discard the unpublished changes on this device and reload the live map?\n\n' +
               'This cannot be undone locally. Anything already published is unaffected.')) return;
  try {
    const res = await fetch('/api/mapstate', { method: 'GET' });
    const doc = await res.json().catch(() => null);
    if (!doc || !doc.state) { alert('Nothing has been published yet, so there is no live map to return to.'); return; }
    _applyCloudState(doc.state);
    _rememberPublished(doc.version, _mapFingerprint(_buildStatePayload()));
    alert(`Reverted to the published map (v${doc.version}).`);
  } catch (err) {
    alert(`Could not reach the server: ${err.message}`);
  }
}

// ── Preview as citizen ───────────────────────────────────────────────────────
// Lets an admin check the visitor experience without exiting admin and losing
// their place. Editing is suspended while previewing, exactly as for a citizen.

function enterCitizenPreview() {
  _previewingAsCitizen = true;
  setViewMode('user');
  document.body.classList.add('previewing');
  if (DOM.exitPreviewBtn) DOM.exitPreviewBtn.hidden = false;
}

function exitCitizenPreview() {
  _previewingAsCitizen = false;
  document.body.classList.remove('previewing', 'route-active');
  if (DOM.exitPreviewBtn) DOM.exitPreviewBtn.hidden = true;
  if (typeof CHAT !== 'undefined' && CHAT.close) CHAT.close();
  setViewMode('admin');
}

// ── Version history + rollback ───────────────────────────────────────────────

function hideMapHistory() {
  if (DOM.mapHistoryModal) DOM.mapHistoryModal.hidden = true;
}

/** List published versions, newest first, each restorable. */
async function showMapHistory() {
  if (!DOM.mapHistoryModal || !DOM.mapHistoryList) return;
  DOM.mapHistoryModal.hidden = false;
  DOM.mapHistoryList.innerHTML = '<p class="history-empty">Loading…</p>';
  let doc;
  try {
    const res = await fetch('/api/mapstate?history=1');
    doc = await res.json();
  } catch (err) {
    DOM.mapHistoryList.innerHTML = `<p class="history-empty">Could not load history: ${err.message}</p>`;
    return;
  }
  const rows = (doc && doc.history) || [];
  const cur  = (doc && doc.currentVersion) || 0;
  if (!rows.length && !cur) {
    DOM.mapHistoryList.innerHTML = '<p class="history-empty">Nothing has been published yet.</p>';
    return;
  }
  const fmt = (t) => (t ? new Date(t).toLocaleString() : 'unknown time');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let html = `<p class="history-current">Live now: <strong>v${cur}</strong></p>`;
  html += rows.map((r) => `
    <div class="history-row">
      <div class="history-meta">
        <strong>v${r.version}</strong>
        <span>${esc(r.updatedBy || 'unknown')}</span>
        <span class="history-time">${fmt(r.updatedAt)}</span>
      </div>
      <button class="btn btn-ghost history-restore" data-version="${r.version}">Restore</button>
    </div>`).join('');
  html += '<p class="history-note">Restoring publishes the old map as a new version. ' +
          'Nothing is deleted, so a restore can itself be undone.</p>';
  DOM.mapHistoryList.innerHTML = html;

  DOM.mapHistoryList.querySelectorAll('.history-restore').forEach((btn) => {
    btn.addEventListener('click', () => rollbackMapTo(parseInt(btn.dataset.version, 10)));
  });
}

/** Republish an archived version as the newest one. */
async function rollbackMapTo(version) {
  if (!Number.isFinite(version)) return;
  if (!confirm(`Restore map version ${version} and make it live for everyone?`)) return;
  const token = await _ensurePublishToken();
  if (!token) return;
  try {
    const res = await fetch('/api/mapstate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ rollbackTo: version, updatedBy: _adminName() || 'admin' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (res.status === 401) { try { sessionStorage.removeItem(PUBLISH_TOKEN_SS_KEY); } catch (_) {} }
      alert(`Restore failed: ${data.error || res.status}`);
      return;
    }
    try { sessionStorage.setItem(PUBLISH_TOKEN_SS_KEY, token); } catch (_) {}
    const live = await (await fetch('/api/mapstate')).json();
    if (live && live.state) {
      _applyCloudState(live.state);
      _rememberPublished(live.version, _mapFingerprint(_buildStatePayload()));
    }
    hideMapHistory();
    alert(`Restored v${version}. It is now live as v${data.version}.`);
  } catch (err) {
    alert(`Restore failed: ${err.message}`);
  }
}

/** Fetch the publish token from this session, asking once if needed. */
async function _ensurePublishToken() {
  let token = '';
  try { token = sessionStorage.getItem(PUBLISH_TOKEN_SS_KEY) || ''; } catch (_) {}
  if (token) return token;
  token = prompt('Enter the publish token (MAP_ADMIN_TOKEN) to change the map everyone sees:');
  if (!token) return '';
  return token.trim();
}

/**
 * Admin action: publish the current floors/rooms/labels to every device.
 *
 * Shows what will change before asking, and carries the version these edits were
 * based on so the server can refuse a publish that would silently overwrite
 * someone else's work. On conflict the admin chooses explicitly rather than
 * losing either side by accident.
 */
async function publishMapToCloud(force) {
  const mine = _buildStatePayload();
  const base = _publishedVersion();

  // Pull the live map to describe the change and to spot a conflict up front.
  let live = null;
  try {
    const res = await fetch('/api/mapstate');
    live = await res.json().catch(() => null);
  } catch (_) { /* offline — the server still enforces the version check */ }

  if (!force && live && typeof live.version === 'number' && live.version !== base && live.state) {
    const who  = live.updatedBy || 'someone';
    const when = live.updatedAt ? new Date(live.updatedAt).toLocaleString() : 'recently';
    const pick = prompt(
      `${who} published v${live.version} (${when}) while you were editing.\n` +
      `Your edits are based on v${base}.\n\n` +
      'Type one:\n' +
      '  keep     — overwrite theirs with your version\n' +
      '  discard  — throw away your edits and take theirs\n' +
      '  cancel   — do nothing for now', 'cancel');
    const choice = String(pick || 'cancel').trim().toLowerCase();
    if (choice === 'discard') { await revertToPublished(); return; }
    if (choice !== 'keep')    return;
    return publishMapToCloud(true);
  }

  const diff = _diffMapStates(mine, live && live.state);
  if (!force && live && live.state && diff.cells === 0 && !diff.stampsAdded &&
      !diff.stampsRemoved && !diff.stampsMoved && !diff.namesChanged) {
    alert('Nothing to publish — this device already matches the live map.');
    _rememberPublished(live.version, _mapFingerprint(mine));
    return;
  }

  const name = _adminName();
  if (!confirm(
      'Publish to ALL devices?\n\n' +
      'This becomes the live map every citizen sees:\n' +
      _describeDiff(diff) + '\n\n' +
      `Published by: ${name || 'admin'}`)) return;

  const token = await _ensurePublishToken();
  if (!token) return;

  try {
    const res = await fetch('/api/mapstate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({
        state:       mine,
        updatedBy:   name || 'admin',
        baseVersion: base,
        force:       !!force,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      try { sessionStorage.setItem(PUBLISH_TOKEN_SS_KEY, token); } catch (_) {}
      _rememberPublished(data.version, _mapFingerprint(mine));
      alert(`Published as version ${data.version}.\nOther devices get it on their next reload.`);
    } else if (res.status === 409) {
      // Someone published between our check and our write.
      if (confirm(`${data.updatedBy || 'Someone'} published v${data.currentVersion} just now.\n\n` +
                  'Overwrite their version with yours?')) {
        return publishMapToCloud(true);
      }
    } else if (res.status === 401) {
      try { sessionStorage.removeItem(PUBLISH_TOKEN_SS_KEY); } catch (_) {}
      alert('Publish failed: invalid token. Tap Publish again to retry.');
    } else if (res.status === 503) {
      alert('Publishing is not enabled yet — set MAP_ADMIN_TOKEN in the Vercel project, then redeploy.');
    } else {
      alert(`Publish failed: ${data.error || res.status}`);
    }
  } catch (err) {
    alert(`Publish failed: ${err.message}`);
  }
}

// Debounce timer — rapid edits (wall painting, stamps) are coalesced into
// a single push that fires 600 ms after the last change, preventing out-of-order
// HTTP requests from overwriting newer state with an older payload.
let _pushTimer = null;
function _schedulePush() {
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(pushStateToServer, 600);
}

function saveGridState() {
  try {
    const allFloors = Object.assign({}, FLOOR_WALLS);
    allFloors[STATE.currentFloor] = NODES.map(n => n.cellType || 'open');
    localStorage.setItem('wayfinding-grid-v1', JSON.stringify({
      floorWalls:   allFloors,
      currentFloor: STATE.currentFloor,
    }));
  } catch (_) {}
  _schedulePush();        // debounced push — avoids race conditions on rapid edits
  _scheduleDraftBadge();  // this device is now potentially ahead of the live map
}

function loadGridState() {
  let hasLocal = false;
  const expectedLen = GRID_ROWS * GRID_COLS;

  // ── Preset version migration ──────────────────────────────────────────────
  // If the bundled presets are NEWER than what was last applied on this device,
  // discard the cached grid so the new layout (e.g. flat-top octagon) loads.
  // Captures (separate localStorage key) are NOT touched.
  try {
    if (typeof FLOOR_PRESETS_VERSION !== 'undefined') {
      const storedVer = parseInt(localStorage.getItem('wayfinding-preset-version') || '0', 10);
      if (storedVer < FLOOR_PRESETS_VERSION) {
        localStorage.removeItem('wayfinding-grid-v1');
        localStorage.setItem('wayfinding-preset-version', String(FLOOR_PRESETS_VERSION));
        console.info(`[wayfinding] preset v${storedVer} -> v${FLOOR_PRESETS_VERSION}; loading new layout`);
      }
    }
  } catch (_) {}

  try {
    const raw = localStorage.getItem('wayfinding-grid-v1');
    if (raw) {
      const { floorWalls, currentFloor } = JSON.parse(raw);
      // ── Grid-size migration ───────────────────────────────────────────────
      // If saved floors don't match current GRID_ROWS×GRID_COLS, the layout
      // is from a previous size — discard and fall through to preset load.
      const sizeOk = floorWalls && Object.values(floorWalls).every(
        arr => Array.isArray(arr) && arr.length === expectedLen
      );
      if (sizeOk) {
        hasLocal = true;
        if (floorWalls) Object.assign(FLOOR_WALLS, floorWalls);
        const floor = (typeof currentFloor === 'number') ? currentFloor : 0;
        STATE.currentFloor = floor;
        NAV._currentFloor  = floor;
        const walls = FLOOR_WALLS[floor];
        if (walls) NODES.forEach((n, i) => {
          const v = walls[i];
          if (typeof v === 'boolean') { n.wall = v; n.cellType = v ? 'wall' : 'open'; }
          else { n.cellType = v || 'open'; n.wall = n.cellType === 'wall'; }
        });
      } else {
        // Wipe stale data so the preset path runs cleanly
        localStorage.removeItem('wayfinding-grid-v1');
        console.info('[wayfinding] cleared stale localStorage — grid size changed');
      }
    }
  } catch (_) {}

  // ── First-run preset load ──────────────────────────────────────────────────
  // When this device has no local map yet (or it was just wiped above),
  // try to populate from the bundled FLOOR_PRESETS — gives the user a
  // ready-to-use Calamba City Hall layout instead of an empty grid.
  if (!hasLocal && typeof applyFloorPresets === 'function') {
    try {
      const n = applyFloorPresets();
      if (n > 0) {
        const floor = STATE.currentFloor || 0;
        const walls = FLOOR_WALLS[floor];
        if (walls) NODES.forEach((nd, i) => {
          nd.cellType = walls[i] || 'open';
          nd.wall     = nd.cellType === 'wall';
        });
        saveGridState();
        console.info(`[wayfinding] loaded ${n} floors from bundled presets`);
        return;   // skip server pull — we already have a map
      }
    } catch (e) { console.warn('[wayfinding] preset load failed:', e); }
  }

  // Auto-pull from server ONLY when this device has no local state yet
  // (i.e. first time on this device / phone).
  // On devices that already have a map, use the Sync button to pull manually —
  // this prevents a background fetch from racing with the user's edits.
  if (!hasLocal) pullStateFromServer();
}

/**
 * Erase the entire saved floor plan after user confirmation.
 * Reloads the page so the app starts fresh.
 */
function clearGridState() {
  if (!confirm('Erase the entire floor plan on all floors? This cannot be undone.')) return;
  localStorage.removeItem('wayfinding-grid-v1');
  // Clear server state too
  fetch('/api/state', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{}',
  }).catch(() => {});
  location.reload();
}

// ── Drift indicator ───────────────────────────────────────────────────────────

function updateDriftIndicator() {
  // A2: show neutral state until the first real QR fix has occurred
  if (!NAV._hasQRFix) {
    DOM.driftDisplay.textContent = 'Fix: —';
    DOM.driftDisplay.className   = 'nav-drift';
    return;
  }
  const s = NAV._stepsSinceQR;
  let label, cls;
  if      (s === 0)  { label = 'just fixed';                        cls = 'drift-ok'; }
  else if (s <= 5)   { label = `${s} step${s !== 1 ? 's' : ''} ago`; cls = 'drift-ok'; }
  else if (s <= 15)  { label = `${s} steps ago`;                    cls = 'drift-warn'; }
  else               { label = `${s} steps ago`;                    cls = 'drift-bad'; }
  DOM.driftDisplay.textContent = `Fix: ${label}`;
  DOM.driftDisplay.className   = `nav-drift ${cls}`;
}

// ── Stamp editor ──────────────────────────────────────────────────────────────
const STAMP_EDITOR_PX = 180;

const _STAMP_CELL_FILL   = { open: '#FFFFFF', wall: '#1E293B', door: '#FEF3C7', stair: '#EDE9FE' };
const _STAMP_CELL_BORDER = { open: '#CBD5E1', wall: '#475569', door: '#D97706', stair: '#7C3AED' };

function drawStampEditor() {
  const canvas = DOM.stampCanvas;
  const cs     = Math.max(4, Math.floor(STAMP_EDITOR_PX / STAMP_SIZE));
  canvas.width  = cs * STAMP_SIZE;
  canvas.height = cs * STAMP_SIZE;
  const ctx = canvas.getContext('2d');

  for (let r = 0; r < STAMP_SIZE; r++) {
    for (let c = 0; c < STAMP_SIZE; c++) {
      const x  = c * cs, y = r * cs;
      // support old boolean patterns still in memory
      const raw = STAMP_PATTERN[r][c];
      const ct  = typeof raw === 'boolean' ? (raw ? 'wall' : 'open') : (raw || 'open');
      ctx.fillStyle   = _STAMP_CELL_FILL[ct]   || '#FFFFFF';
      ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      ctx.strokeStyle = _STAMP_CELL_BORDER[ct] || '#CBD5E1';
      ctx.lineWidth   = ct === 'open' ? 0.5 : 1;
      ctx.strokeRect(x, y, cs, cs);
      // draw label when cells are big enough
      if (cs >= 14) {
        if (ct === 'door')  { ctx.fillStyle = '#D97706'; ctx.font = `bold ${Math.floor(cs * 0.5)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('D', x + cs / 2, y + cs / 2); }
        if (ct === 'stair') { ctx.fillStyle = '#7C3AED'; ctx.font = `bold ${Math.floor(cs * 0.5)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', x + cs / 2, y + cs / 2); }
      }
    }
  }
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
}

function stampEditorTap(e) {
  const rect = DOM.stampCanvas.getBoundingClientRect();
  const cs   = Math.max(4, Math.floor(STAMP_EDITOR_PX / STAMP_SIZE));
  const col  = Math.floor((e.clientX - rect.left) / cs);
  const row  = Math.floor((e.clientY - rect.top)  / cs);
  paintStampCell(row, col, STATE.paintType);
  drawStampEditor();
  if (STATE.stampMode) renderer._draw();
}

// ── Catalogue ─────────────────────────────────────────────────────────────────
function goToStamp(id) {
  const p = STAMP_PLACEMENTS.find(p => p.id === id);
  if (!p) return;
  const cs = renderer._cs();
  renderer._tx = DOM.canvas.clientWidth  / 2 - (p.col + p.size / 2) * cs;
  renderer._ty = DOM.canvas.clientHeight / 2 - (p.row + p.size / 2) * cs;
  renderer._draw();
}

function renderCatalogue() {
  _scheduleDraftBadge();   // room add/move/rename also diverges from the live map
  const list = DOM.catalogueList;

  if (STAMP_PLACEMENTS.length === 0) {
    list.innerHTML =
      '<p class="cat-empty">No named stamps yet.<br>' +
      'Enter a name above, then click the grid to stamp it.</p>';
    return;
  }

  list.innerHTML = '';
  STAMP_PLACEMENTS.forEach(({ id, name, row, col, size, floor }) => {
    const div = document.createElement('div');
    div.className = 'cat-item';
    const floorBadge = (typeof floor === 'number')
      ? `<span class="cat-item-floor">F${floor}</span>`
      : '';
    div.innerHTML =
      `<div class="cat-item-info">` +
        `<span class="cat-item-name">${escHtml(name)}</span>` +
        `<span class="cat-item-coord">${floorBadge}(${col},\u202F${row}) · ${size}×${size}</span>` +
      `</div>` +
      `<div class="cat-item-btns">` +
        `<button class="btn-cat-copy" data-id="${id}" title="Copy this stamp into the editor — your next stamp click pastes a duplicate">Copy</button>` +
        `<button class="btn-cat-go"   data-id="${id}" title="Jump to this stamp on the map">Go</button>` +
        `<button class="btn-cat-del"  data-id="${id}" title="Delete this label (cells on the grid stay; only the catalogue entry is removed)">✕</button>` +
      `</div>`;
    list.appendChild(div);
  });

  list.querySelectorAll('.btn-cat-copy').forEach(btn =>
    btn.addEventListener('click', () => copyPlacementToStamp(btn.dataset.id)));
  list.querySelectorAll('.btn-cat-go').forEach(btn =>
    btn.addEventListener('click', () => goToStamp(btn.dataset.id)));
  list.querySelectorAll('.btn-cat-del').forEach(btn =>
    btn.addEventListener('click', () => {
      deleteStampPlacement(btn.dataset.id);
      renderCatalogue();
    }));
}

/**
 * Copy a placement into the active stamp editor (mobile-friendly copy/paste).
 *
 *   1. Switches to the placement's floor if needed.
 *   2. Reads the current cell types in the placement's bounding box and uses
 *      them as the new STAMP_PATTERN. (Reads from the live grid, so if you
 *      edited cells inside the box after stamping, the copy reflects those
 *      edits — usually what you want.)
 *   3. Updates STAMP_SIZE, the size input, the name input, and redraws the
 *      stamp editor.
 *   4. Opens the tools panel so the next grid click pastes a duplicate.
 */
function copyPlacementToStamp(id) {
  const p = STAMP_PLACEMENTS.find(x => x.id === id);
  if (!p) return;

  if (typeof p.floor === 'number' && p.floor !== STATE.currentFloor) {
    switchFloor(p.floor);
  }

  STAMP_SIZE    = p.size;
  STAMP_PATTERN = [];
  for (let r = 0; r < p.size; r++) {
    const patternRow = [];
    for (let c = 0; c < p.size; c++) {
      const node = NODE_MAP[nodeId(p.row + r, p.col + c)];
      patternRow.push(node ? (node.cellType || 'open') : 'open');
    }
    STAMP_PATTERN.push(patternRow);
  }

  if (DOM.stampSizeInput) DOM.stampSizeInput.value = STAMP_SIZE;
  if (DOM.stampNameInput) DOM.stampNameInput.value = p.name;
  if (typeof drawStampEditor === 'function') drawStampEditor();

  if (!STATE.panelOpen) setToolsPanel(true);

  renderer._draw();

  if (DOM.hintBar) {
    DOM.hintBar.innerHTML =
      `Copied <strong>${escHtml(p.name)}</strong> ` +
      `(${p.size}×${p.size}, F${typeof p.floor === 'number' ? p.floor : 0}). ` +
      `Click the grid to paste a duplicate.`;
  }
}

// ── Presets ───────────────────────────────────────────────────────────────────
function renderPresets() {
  const list = DOM.presetList;

  if (STAMP_PRESETS.length === 0) {
    list.innerHTML =
      '<p class="preset-empty">No presets yet.<br>Draw a pattern and click <em>Save as Preset</em>.</p>';
    return;
  }

  list.innerHTML = '';
  STAMP_PRESETS.forEach(({ id, name, size }) => {
    const div = document.createElement('div');
    div.className = 'preset-item';
    div.innerHTML =
      `<div class="preset-item-info">` +
        `<span class="preset-item-name">${escHtml(name)}</span>` +
        `<span class="preset-item-meta">${size}×${size}</span>` +
      `</div>` +
      `<div class="preset-item-btns">` +
        `<button class="btn-preset-load" data-id="${id}">Load</button>` +
        `<button class="btn-preset-del"  data-id="${id}">✕</button>` +
      `</div>`;
    list.appendChild(div);
  });

  list.querySelectorAll('.btn-preset-load').forEach(btn =>
    btn.addEventListener('click', () => {
      if (loadStampPresetById(btn.dataset.id)) {
        DOM.stampSizeInput.value = STAMP_SIZE;
        drawStampEditor();
        if (STATE.stampMode) renderer._draw();
      }
    }));
  list.querySelectorAll('.btn-preset-del').forEach(btn =>
    btn.addEventListener('click', () => {
      deleteStampPreset(btn.dataset.id);
      renderPresets();
    }));
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Cursor + hint ─────────────────────────────────────────────────────────────
function updateCursorAndHint() {
  if (STATE.stampMode)        DOM.canvas.style.cursor = 'copy';
  else if (STATE.wallMode)    DOM.canvas.style.cursor = 'cell';
  else if (STATE.captureMode) DOM.canvas.style.cursor = 'crosshair';
  else if (STATE.selectMode)  DOM.canvas.style.cursor = floatingData ? 'copy' : 'crosshair';
  else                        DOM.canvas.style.cursor = 'crosshair';

  if (STATE.stampMode) {
    DOM.hintBar.innerHTML = 'Click the grid to <strong>place the stamp</strong>. Name it in the panel to save it to the catalogue.';
  } else if (STATE.captureMode) {
    DOM.hintBar.innerHTML = '🎯 <strong>Capture:</strong> pick an office, then <strong>tap its location</strong> on the grid (or use <strong>📍 My position</strong>). Re-anchor at the atrium/stairs to reset drift.';
  } else if (STATE.wallMode) {
    DOM.hintBar.innerHTML = 'Click or <strong>drag</strong> to paint walls. Click a wall again to erase it.';
  } else if (STATE.selectMode && floatingData) {
    DOM.hintBar.innerHTML = '<strong>Click</strong> on the grid to drop the selection. Press <strong>Escape</strong> to cancel.';
  } else if (STATE.selectMode) {
    DOM.hintBar.innerHTML = '<strong>Drag</strong> on the grid to select an area, then rotate, move, or delete it.';
  } else if (STATE.navMode) {
    DOM.hintBar.innerHTML = '<strong>Tap</strong> any cell to set destination from your position. Use <strong>arrow keys</strong> to move, or <strong>Scan QR</strong> to jump to an anchor.';
  } else {
    DOM.hintBar.innerHTML = 'Tap any cell to route from <strong>(0,0)</strong> &rarr; that cell. Enable <strong>Wall Mode</strong> to place obstacles.';
  }
}

// ── Info bar ──────────────────────────────────────────────────────────────────
function updateInfoBar(steps, msg) {
  if (STATE.navMode && NAV.position) {
    const { row, col } = NAV.position;
    DOM.infoStart.textContent = `You  ${row},${col}`;
  } else {
    DOM.infoStart.textContent = 'Start  0,0';
  }

  if (STATE.endId) {
    const [er, ec]            = STATE.endId.split(',').map(Number);
    DOM.infoEnd.textContent   = `End  ${er},${ec}`;
    DOM.infoEnd.style.display = '';
  } else {
    DOM.infoEnd.textContent   = 'Tap a cell to set destination';
    DOM.infoEnd.style.display = '';
  }

  if (steps != null) {
    // B3: show estimated metres alongside step count (Weinberg, 2002)
    const m = (steps * NAV.metresPerCell).toFixed(1);
    DOM.infoSteps.textContent   = `${steps} step${steps !== 1 ? 's' : ''} (~${m} m)`;
    DOM.infoSteps.style.display = '';
  } else {
    DOM.infoSteps.style.display = 'none';
  }

  if (msg) {
    DOM.infoMsg.textContent   = msg;
    DOM.infoMsg.style.display = '';
  } else {
    DOM.infoMsg.style.display = 'none';
  }
}
