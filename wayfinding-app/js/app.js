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
  currentFloor: 0,       // active floor index (0 = ground)
  paintType:    'wall',  // active paint type: 'wall' | 'door' | 'stair' | 'erase'
};

// Tracks whether Shift is currently held — used for Shift+click "teleport" in Capture Mode
// (sets NAV.position to the clicked cell instead of capturing the selected office).
let _shiftHeld = false;

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
  mobileMenuBtn:   $('mobileMenuBtn'),
  headerSecondary: $('headerSecondary'),
  floorDown:       $('floorDown'),
  floorUp:         $('floorUp'),
  floorDisplay:    $('floorDisplay'),
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

async function navigateToDepartment(deptName) {
  const deps = await _loadDepartments();
  const loc  = deps[deptName];
  if (!loc || loc.floor === null) {
    alert(`Location for "${deptName}" has not been mapped yet.\nPlease ask staff for directions.`);
    return;
  }
  if (loc.floor !== STATE.currentFloor) switchFloor(loc.floor);
  const id = nodeId(loc.row, loc.col);
  STATE.endId = id;
  renderer.setEnd(id);   // setEnd() sets _endId + redraws; direct .endId was wrong
  recompute();
}

document.addEventListener('DOMContentLoaded', () => {
  loadStampPlacements();
  loadStampPresets();
  loadCaptures();         // restore any fieldwork coordinate captures
  _loadCustomOffices();   // restore any on-site custom offices
  navInit();       // initialise NAV.position to grid center
  loadGridState(); // restore saved floor plan (after navInit so NODES exist)

  // Init chat widget
  CHAT.init();
  CHAT.onNavigate(navigateToDepartment);

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
    DOM.navPosDisplay.textContent = `${col}, ${row}`;
    renderer.centerOnCell(row, col);
    updateDriftIndicator();
    recompute();
    renderer._draw();
    // Arrival detection: show celebration when ME tile reaches destination
    if (STATE.endId && id === STATE.endId) {
      _showArrivalPrompt();
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

  // Probe /api/state on init — the sync feature only works against the local
  // dev server (serve_https.py). Vercel doesn't expose this endpoint, so the
  // button is meaningless there. Hide it if the probe fails so users don't
  // tap a button that will only ever fail.
  (() => {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2000);
    fetch('/api/state', { method: 'GET', signal: controller.signal })
      .then(res => {
        clearTimeout(tid);
        if (!res.ok) DOM.syncBtn.style.display = 'none';
      })
      .catch(() => {
        clearTimeout(tid);
        DOM.syncBtn.style.display = 'none';
      });
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
    DOM.qrGenLabel.textContent = `(${def.col}, ${def.row}) Floor ${STATE.currentFloor + 1}`;
    navGenerateQR(STATE.currentFloor, def.row, def.col, DOM.qrGenCanvas);
    DOM.qrGenModal.style.display = 'flex';
  });

  DOM.qrGenGoBtn.addEventListener('click', () => {
    const fDisp = parseInt(DOM.qrGenFloorInput.value);  // 1-indexed display value
    const r     = parseInt(DOM.qrGenRowInput.value);
    const c     = parseInt(DOM.qrGenColInput.value);
    if (isNaN(r) || isNaN(c) || isNaN(fDisp)) return;
    DOM.qrGenLabel.textContent = `(${c}, ${r}) Floor ${fDisp}`;
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

    // Arrow keys: move nav position when nav mode is active (laptop PDR fallback)
    if (STATE.navMode && !e.ctrlKey && !e.metaKey) {
      const { row, col } = NAV.position;
      if (e.key === 'ArrowUp')    { e.preventDefault(); navSetPosition(row - 1, col); return; }
      if (e.key === 'ArrowDown')  { e.preventDefault(); navSetPosition(row + 1, col); return; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navSetPosition(row, col - 1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); navSetPosition(row, col + 1); return; }
    }

    // WASD: walk the position cursor while Capture Mode is on (laptop simulation
    // of on-site PDR — drives the same NAV.position that captureAtPosition reads,
    // so the "Capture here" button works identically to walking on-site).
    // navSetPosition already clamps to grid bounds and silently stops at walls.
    if (STATE.captureMode && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const { row, col } = NAV.position || { row: 0, col: 0 };
      const k = e.key.toLowerCase();
      if (k === 'w') { e.preventDefault(); navSetPosition(row - 1, col); return; }
      if (k === 's') { e.preventDefault(); navSetPosition(row + 1, col); return; }
      if (k === 'a') { e.preventDefault(); navSetPosition(row, col - 1); return; }
      if (k === 'd') { e.preventDefault(); navSetPosition(row, col + 1); return; }
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
});

// ── Cell interaction ──────────────────────────────────────────────────────────
function handleCellTap(row, col) {
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
    DOM.navPosDisplay.textContent = `${col}, ${row}`;
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
  DOM.floorDisplay.textContent = `Floor ${STATE.currentFloor + 1}`;
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

let _arrivalTimer = null;

function _showArrivalPrompt() {
  const el = document.getElementById('arrivalPrompt');
  if (!el) return;
  el.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
  clearTimeout(_arrivalTimer);
  _arrivalTimer = setTimeout(_hideArrivalPrompt, 4000);
}

function _hideArrivalPrompt() {
  clearTimeout(_arrivalTimer);
  const el = document.getElementById('arrivalPrompt');
  if (!el) return;
  el.classList.remove('visible');
  setTimeout(() => { if (!el.classList.contains('visible')) el.style.display = 'none'; }, 300);
}

// ── Grid persistence (localStorage + server sync) ─────────────────────────────

function _buildStatePayload() {
  const allFloors = Object.assign({}, FLOOR_WALLS);
  allFloors[STATE.currentFloor] = NODES.map(n => n.cellType || 'open');
  return {
    grid: { floorWalls: allFloors, currentFloor: STATE.currentFloor },
    stampPlacements: STAMP_PLACEMENTS,
    stampPresets:    STAMP_PRESETS,
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
    if (DOM.floorDisplay) DOM.floorDisplay.textContent = `Floor ${floor + 1}`;
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
  _schedulePush();   // debounced push — avoids race conditions on rapid edits
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
    DOM.infoStart.textContent = `You  (${col}, ${row})`;
  } else {
    DOM.infoStart.textContent = 'Start  (0, 0)';
  }

  if (STATE.endId) {
    const [er, ec]            = STATE.endId.split(',').map(Number);
    DOM.infoEnd.textContent   = `End  (${ec}, ${er})`;
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
