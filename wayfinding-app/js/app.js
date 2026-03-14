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
  currentFloor: 0,       // active floor index (0 = ground)
  paintType:    'wall',  // active paint type: 'wall' | 'door' | 'stair' | 'erase'
};

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

document.addEventListener('DOMContentLoaded', () => {
  loadStampPlacements();
  loadStampPresets();
  navInit();       // initialise NAV.position to grid center
  loadGridState(); // restore saved floor plan (after navInit so NODES exist)

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
  DOM.stampBtn.addEventListener('click', () => setToolsPanel(!STATE.panelOpen));
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

    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

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
      addStampPlacement(name, row, col, STAMP_SIZE);
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
  if (active && STATE.panelOpen)   setToolsPanel(false);
  if (active && STATE.selectMode)  setSelectMode(false);
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
  if (open && STATE.wallMode) setWallMode(false);
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
    if (STATE.wallMode)   setWallMode(false);
    if (STATE.panelOpen)  setToolsPanel(false);
    if (STATE.selectMode) setSelectMode(false);
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

// ── Select mode ───────────────────────────────────────────────────────────────
function setSelectMode(active) {
  if (active) {
    if (STATE.wallMode)  setWallMode(false);
    if (STATE.panelOpen) setToolsPanel(false);
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
  try {
    const raw = localStorage.getItem('wayfinding-grid-v1');
    if (raw) {
      hasLocal = true;
      const { floorWalls, currentFloor } = JSON.parse(raw);
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
    }
  } catch (_) {}
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
  STAMP_PLACEMENTS.forEach(({ id, name, row, col, size }) => {
    const div = document.createElement('div');
    div.className = 'cat-item';
    div.innerHTML =
      `<div class="cat-item-info">` +
        `<span class="cat-item-name">${escHtml(name)}</span>` +
        `<span class="cat-item-coord">(${col},\u202F${row}) · ${size}×${size}</span>` +
      `</div>` +
      `<div class="cat-item-btns">` +
        `<button class="btn-cat-go"  data-id="${id}">Go</button>` +
        `<button class="btn-cat-del" data-id="${id}">✕</button>` +
      `</div>`;
    list.appendChild(div);
  });

  list.querySelectorAll('.btn-cat-go').forEach(btn =>
    btn.addEventListener('click', () => goToStamp(btn.dataset.id)));
  list.querySelectorAll('.btn-cat-del').forEach(btn =>
    btn.addEventListener('click', () => {
      deleteStampPlacement(btn.dataset.id);
      renderCatalogue();
    }));
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
  if (STATE.stampMode)       DOM.canvas.style.cursor = 'copy';
  else if (STATE.wallMode)   DOM.canvas.style.cursor = 'cell';
  else if (STATE.selectMode) DOM.canvas.style.cursor = floatingData ? 'copy' : 'crosshair';
  else                       DOM.canvas.style.cursor = 'crosshair';

  if (STATE.stampMode) {
    DOM.hintBar.innerHTML = 'Click the grid to <strong>place the stamp</strong>. Name it in the panel to save it to the catalogue.';
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
