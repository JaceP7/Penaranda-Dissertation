/**
 * renderer.js — 10×10 grid canvas renderer
 *
 * Draws the grid, walls, start/end cells, and the Dijkstra path.
 * Supports pan (drag) and pinch-to-zoom.
 */

'use strict';

// ── Colours ───────────────────────────────────────────────────────────────────
const COLORS = {
  bg:          '#F1F5F9',
  empty:       '#FFFFFF',
  wall:        '#1E293B',
  wallBorder:  '#0F172A',
  door:        '#FEF3C7',   // warm yellow
  doorBorder:  '#D97706',   // amber
  stair:       '#EDE9FE',   // light purple
  stairBorder: '#7C3AED',   // violet
  start:       '#10B981',   // green
  end:         '#EF4444',   // red
  pathCell:    '#DBEAFE',   // light blue fill
  pathLine:    '#2563EB',   // blue arrow/line
  hover:       '#E2E8F0',
  gridLine:    '#CBD5E1',
  outerBorder: '#64748B',
  coordText:   'rgba(100,116,139,0.55)',
  stepText:    '#1E40AF',
};

// ── GridRenderer class ────────────────────────────────────────────────────────
class GridRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    this._scale     = 1;
    this._tx        = 0;
    this._ty        = 0;
    this._baseCell  = 50;   // pixels per cell at scale 1 (recomputed on resize)
    this._minScale  = 0.2;
    this._maxScale  = 10;

    this._dragging      = false;
    this._lastPointers  = {};
    this._lastPinchDist = null;
    this._pointerStart  = null;

    this._hoverCell    = null;   // { row, col }
    this._path         = null;   // string[] of node IDs
    this._endId        = null;   // destination node ID
    this._lastDragCell = null;   // "row,col" key of last cell painted during drag
    this._selectStart  = null;   // { row, col } — anchor cell of rubber-band drag

    /** Set to true by app when Wall Mode is active — drag paints instead of panning. */
    this.wallMode  = false;
    /** Active paint type ('wall' | 'door' | 'stair' | 'erase') — used for hover colour. */
    this.paintType = 'wall';
    /** Set to true by app when Stamp Mode is active — shows stamp preview on hover. */
    this.stampMode = false;
    /** Set to true by app when Select Mode is active — drag draws a selection rect. */
    this.selectMode = false;
    /** Current start node ID — defaults to '0,0', updated by nav module. */
    this.startId   = '0,0';
    /** When true, draws "ME" label + pulse ring on the start cell. */
    this.navActive = false;
    /** Current floor index — shown as a watermark on the canvas. */
    this.currentFloor = 0;

    /** Fixed selection rectangle { r1,c1,r2,c2 } or null. */
    this.selectionRect   = null;
    /** Rubber-band rectangle in-progress { r1,c1,r2,c2 } or null. */
    this.dragRect        = null;
    /** Floating move ghost { pattern, rows, cols } or null — follows hoverCell. */
    this.floatingPattern = null;

    /** Callback: (row, col) → void */
    this.onCellTap   = null;
    /** Callback: (r1, c1, r2, c2) → void — fired when drag-select finishes. */
    this.onSelectRect = null;
    /** Callback: () → void — fired on every pointer-up (used by app for undo gesture tracking) */
    this.onPointerUp = null;

    this._bindPointers();
    this._fitToCanvas();
    this._draw();
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  setPath(path) { this._path = path;  this._draw(); }
  clearPath()   { this._path = null;  this._draw(); }
  setEnd(id)    { this._endId = id;   this._draw(); }
  clearEnd()    { this._endId = null; this._draw(); }

  /** Pan the view so that (row, col) is centred on screen. */
  centerOnCell(row, col) {
    const cs     = this._cs();
    const cw     = this.canvas.clientWidth;
    const ch     = this.canvas.clientHeight;
    this._tx     = cw / 2 - (col + 0.5) * cs;
    this._ty     = ch / 2 - (row + 0.5) * cs;
  }
  resize()      { this._fitToCanvas(); this._draw(); }

  // ── Fit grid to canvas on load / resize ────────────────────────────────────
  _fitToCanvas() {
    const cw  = this.canvas.clientWidth  || 400;
    const ch  = this.canvas.clientHeight || 400;
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width  = cw * dpr;
    this.canvas.height = ch * dpr;
    this.ctx.scale(dpr, dpr);

    const pad     = 20;
    const cell    = Math.floor(Math.min((cw - pad * 2) / GRID_COLS,
                                        (ch - pad * 2) / GRID_ROWS));
    this._baseCell = Math.max(cell, 2);
    this._scale    = 1;

    const gridW = this._baseCell * GRID_COLS;
    const gridH = this._baseCell * GRID_ROWS;
    this._tx = (cw - gridW) / 2;
    this._ty = (ch - gridH) / 2;
  }

  _cs() { return this._baseCell * this._scale; }  // effective cell size

  _screenToCell(sx, sy) {
    const cs  = this._cs();
    const col = Math.floor((sx - this._tx) / cs);
    const row = Math.floor((sy - this._ty) / cs);
    return { row, col };
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx;
    const cw  = this.canvas.clientWidth;
    const ch  = this.canvas.clientHeight;
    const cs  = this._cs();

    // Canvas background
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    // Build a Set of path IDs and their step indices for fast lookup
    const pathStep = new Map(); // id → step index (0 = start)
    if (this._path) {
      this._path.forEach((id, i) => pathStep.set(id, i));
    }

    // ── Draw each cell ──────────────────────────────────────────────────────
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const id   = nodeId(r, c);
        const node = NODE_MAP[id];
        const x    = this._tx + c * cs;
        const y    = this._ty + r * cs;
        const pad  = 1;                         // 1px gap between cells

        const isStart = id === this.startId;
        const isEnd   = id === this._endId;
        const onPath  = pathStep.has(id) && !isStart && !isEnd;

        // Fill colour
        const ct = node.cellType || (node.wall ? 'wall' : 'open');
        let fill;
        if (ct === 'wall')        fill = COLORS.wall;
        else if (ct === 'door')   fill = COLORS.door;
        else if (ct === 'stair')  fill = COLORS.stair;
        else if (isStart)         fill = COLORS.start;
        else if (isEnd)           fill = COLORS.end;
        else if (onPath)          fill = COLORS.pathCell;
        else                      fill = COLORS.empty;

        ctx.save();
        ctx.fillStyle = fill;
        ctx.fillRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2);

        // Border
        let strokeCol, strokeW;
        if      (ct === 'wall')  { strokeCol = COLORS.wallBorder;  strokeW = 1.5; }
        else if (ct === 'door')  { strokeCol = COLORS.doorBorder;  strokeW = 1.5; }
        else if (ct === 'stair') { strokeCol = COLORS.stairBorder; strokeW = 1.5; }
        else                     { strokeCol = COLORS.gridLine;    strokeW = 0.75; }
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth   = strokeW;
        ctx.strokeRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2);

        // ── Text labels (only when cells are large enough) ───────────────────
        if (cs >= 8) {
          const fontSize = Math.max(9, Math.floor(cs * 0.32));

          if (isStart) {
            ctx.fillStyle    = '#FFFFFF';
            ctx.font         = `bold ${fontSize}px system-ui, sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.navActive ? 'ME' : 'S', x + cs / 2, y + cs / 2);

          } else if (isEnd) {
            ctx.fillStyle    = '#FFFFFF';
            ctx.font         = `bold ${fontSize}px system-ui, sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('E', x + cs / 2, y + cs / 2);

          } else if (onPath) {
            ctx.fillStyle    = COLORS.stepText;
            ctx.font         = `bold ${fontSize}px system-ui, sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pathStep.get(id), x + cs / 2, y + cs / 2);
          }

          // Door / Stair labels
          if (ct === 'door' && cs >= 10) {
            ctx.fillStyle    = COLORS.doorBorder;
            ctx.font         = `bold ${Math.max(8, Math.floor(cs * 0.30))}px system-ui, sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('D', x + cs / 2, y + cs / 2);
          } else if (ct === 'stair' && cs >= 10) {
            ctx.fillStyle    = COLORS.stairBorder;
            ctx.font         = `bold ${Math.max(8, Math.floor(cs * 0.30))}px system-ui, sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('S', x + cs / 2, y + cs / 2);
          }

          // Coordinate label (top-left corner, shown when zoomed in enough)
          if (ct === 'open' && cs >= 32) {
            const coordSize = Math.max(8, Math.floor(cs * 0.17));
            ctx.fillStyle    = onPath || isStart || isEnd
              ? 'rgba(255,255,255,0.65)' : COLORS.coordText;
            ctx.font         = `${coordSize}px system-ui, sans-serif`;
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(`${c},${r}`, x + pad + 3, y + pad + 2);
          }

        }

        ctx.restore();
      }
    }

    // ── Nav breadcrumb trail (past positions) ────────────────────────────────
    if (this.navActive && typeof NAV !== 'undefined' && NAV._trail && NAV._trail.length > 1) {
      // All entries except the last (current position already rendered as ME)
      const trail = NAV._trail.slice(0, -1);
      trail.forEach((pos, i) => {
        const alpha = ((i + 1) / trail.length) * 0.55;  // fade: oldest=faint, newest=solid
        const tx = this._tx + pos.col * cs + cs / 2;
        const ty = this._ty + pos.row * cs + cs / 2;
        ctx.save();
        ctx.fillStyle   = '#10B981';
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(2.5, cs * 0.14), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // ── Nav "ME" pulse ring (drawn on top of the start cell) ─────────────────
    if (this.navActive) {
      const sid = this.startId.split(',').map(Number);
      const nr  = sid[0], nc = sid[1];
      const nx  = this._tx + nc * cs + cs / 2;
      const ny  = this._ty + nr * cs + cs / 2;
      const rad = cs * 0.46;
      ctx.save();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth   = Math.max(1.5, cs * 0.07);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(nx, ny, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Stamp skeleton preview ────────────────────────────────────────────────
    if (this.stampMode && this._hoverCell) {
      const { row: sr, col: sc } = this._hoverCell;
      ctx.save();
      for (let r = 0; r < STAMP_SIZE; r++) {
        for (let c = 0; c < STAMP_SIZE; c++) {
          const nr = sr + r, nc = sc + c;
          if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
          const x = this._tx + nc * cs;
          const y = this._ty + nr * cs;
          const _sv = STAMP_PATTERN[r][c];
          const _sct = typeof _sv === 'boolean' ? (_sv ? 'wall' : 'open') : (_sv || 'open');
          if (_sct !== 'open') {
            // Will become a non-open cell — colour-coded fill + solid outline
            const _fills   = { wall: '#1E293B', door: '#FEF3C7', stair: '#EDE9FE' };
            const _borders = { wall: '#F59E0B', door: '#D97706', stair: '#7C3AED' };
            ctx.globalAlpha = 0.68;
            ctx.fillStyle   = _fills[_sct]   || '#1E293B';
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = _borders[_sct] || '#F59E0B';
            ctx.lineWidth   = 1.5;
            ctx.setLineDash([]);
            ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
          } else {
            // Will stay open — faint tint + dashed outline (skeleton)
            ctx.globalAlpha = 0.14;
            ctx.fillStyle   = '#F59E0B';
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            ctx.globalAlpha = 0.45;
            ctx.strokeStyle = '#F59E0B';
            ctx.lineWidth   = 0.75;
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(x + 1.5, y + 1.5, cs - 3, cs - 3);
            ctx.setLineDash([]);
          }
        }
      }
      // Prominent outer bounding box
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(
        this._tx + sc * cs + 1,
        this._ty + sr * cs + 1,
        STAMP_SIZE * cs - 2,
        STAMP_SIZE * cs - 2
      );
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Draw path connecting lines (behind cells, over grid) ─────────────────
    if (this._path && this._path.length >= 2) {
      ctx.save();
      ctx.strokeStyle  = COLORS.pathLine;
      ctx.lineWidth    = Math.max(2, cs * 0.09);
      ctx.lineCap      = 'round';
      ctx.lineJoin     = 'round';
      ctx.globalAlpha  = 0.55;

      ctx.beginPath();
      this._path.forEach((id, i) => {
        const n  = NODE_MAP[id];
        const px = this._tx + n.col * cs + cs / 2;
        const py = this._ty + n.row * cs + cs / 2;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();

      // Direction arrows at midpoints
      ctx.save();
      ctx.fillStyle   = COLORS.pathLine;
      ctx.globalAlpha = 0.75;
      const arrowSize = Math.max(4, cs * 0.12);

      for (let i = 0; i < this._path.length - 1; i++) {
        const a  = NODE_MAP[this._path[i]];
        const b  = NODE_MAP[this._path[i + 1]];
        const ax = this._tx + a.col * cs + cs / 2;
        const ay = this._ty + a.row * cs + cs / 2;
        const bx = this._tx + b.col * cs + cs / 2;
        const by = this._ty + b.row * cs + cs / 2;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;

        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.atan2(by - ay, bx - ax));
        ctx.beginPath();
        ctx.moveTo( arrowSize,  0);
        ctx.lineTo(-arrowSize, -arrowSize * 0.55);
        ctx.lineTo(-arrowSize,  arrowSize * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // ── Outer grid border ────────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = COLORS.outerBorder;
    ctx.lineWidth   = 2;
    ctx.strokeRect(this._tx, this._ty, cs * GRID_COLS, cs * GRID_ROWS);
    ctx.restore();

    // ── Floor watermark ──────────────────────────────────────────────────────
    ctx.save();
    ctx.font         = `bold ${Math.max(11, Math.floor(cs * 0.55))}px system-ui, sans-serif`;
    ctx.fillStyle    = 'rgba(100,116,139,0.30)';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Floor ${this.currentFloor + 1}`, this._tx + 6, this._ty + 4);
    ctx.restore();

    // ── Selection overlays ───────────────────────────────────────────────────
    const _drawSelRect = (rect, alpha) => {
      if (!rect) return;
      const { r1, c1, r2, c2 } = rect;
      const x = this._tx + c1 * cs, y = this._ty + r1 * cs;
      const w = (c2 - c1 + 1) * cs,  h = (r2 - r1 + 1) * cs;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = '#3B82F6';
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth   = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.setLineDash([]);
      ctx.restore();
    };
    _drawSelRect(this.dragRect,      0.08);
    _drawSelRect(this.selectionRect, 0.15);

    // ── Floating pattern ghost (move) ────────────────────────────────────────
    if (this.floatingPattern && this._hoverCell) {
      const { pattern, rows, cols } = this.floatingPattern;
      const { row: sr, col: sc }    = this._hoverCell;
      ctx.save();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nr = sr + r, nc = sc + c;
          if (nr >= GRID_ROWS || nc >= GRID_COLS) continue;
          const fx = this._tx + nc * cs, fy = this._ty + nr * cs;
          const _fv  = pattern[r][c];
          const _fct = typeof _fv === 'boolean' ? (_fv ? 'wall' : 'open') : (_fv || 'open');
          if (_fct !== 'open') {
            const _fFills   = { wall: '#1E293B', door: '#FEF3C7', stair: '#EDE9FE' };
            ctx.globalAlpha = 0.65;
            ctx.fillStyle   = _fFills[_fct] || '#1E293B';
            ctx.fillRect(fx + 1, fy + 1, cs - 2, cs - 2);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#3B82F6';
            ctx.lineWidth   = 1.5;
            ctx.setLineDash([]);
            ctx.strokeRect(fx + 1, fy + 1, cs - 2, cs - 2);
          } else {
            ctx.globalAlpha = 0.09;
            ctx.fillStyle   = '#3B82F6';
            ctx.fillRect(fx + 1, fy + 1, cs - 2, cs - 2);
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = '#3B82F6';
            ctx.lineWidth   = 0.75;
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(fx + 1.5, fy + 1.5, cs - 3, cs - 3);
            ctx.setLineDash([]);
          }
        }
      }
      // Outer bounding box
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(
        this._tx + sc * cs + 1,
        this._ty + sr * cs + 1,
        cols * cs - 2, rows * cs - 2
      );
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Hover cell highlight (not shown in stamp mode — stamp draws its own preview) ──
    if (this._hoverCell && !this.stampMode) {
      const { row: hr, col: hc } = this._hoverCell;
      const hx = this._tx + hc * cs;
      const hy = this._ty + hr * cs;
      ctx.save();
      const _ptColor = { wall: '#F59E0B', door: COLORS.doorBorder,
                         stair: COLORS.stairBorder, erase: '#EF4444' };
      ctx.strokeStyle = this.wallMode
        ? (_ptColor[this.paintType] || '#F59E0B')
        : '#94A3B8';
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(hx + 1.25, hy + 1.25, cs - 2.5, cs - 2.5);
      ctx.restore();
    }
  }

  // ── Pointer / touch events ─────────────────────────────────────────────────
  _bindPointers() {
    const el = this.canvas;
    el.addEventListener('pointerdown',   e => this._onPointerDown(e));
    el.addEventListener('pointermove',   e => this._onPointerMove(e));
    el.addEventListener('pointerup',     e => this._onPointerUp(e));
    el.addEventListener('pointercancel', e => this._onPointerUp(e));
    el.addEventListener('pointerleave',  () => {
      if (this._hoverCell) { this._hoverCell = null; this._draw(); }
    });
    el.addEventListener('wheel',         e => this._onWheel(e), { passive: false });
    el.style.touchAction = 'none';
  }

  _onPointerDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this._lastPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    this._pointerStart  = { x: e.clientX, y: e.clientY };
    this._lastDragCell  = null;

    // ── Select mode: begin rubber-band (only when not floating a pattern) ──
    if (this.selectMode && !this.floatingPattern) {
      const rect         = this.canvas.getBoundingClientRect();
      const { row, col } = this._screenToCell(e.clientX - rect.left, e.clientY - rect.top);
      if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
        this._selectStart  = { row, col };
        this.selectionRect = null;
        this.dragRect      = { r1: row, c1: col, r2: row, c2: col };
        this._draw();
      }
      // No panning in select mode
      return;
    }

    if (Object.keys(this._lastPointers).length === 1) {
      this._dragging      = true;
      this._lastPinchDist = null;
    } else {
      this._dragging      = false;
      this._lastPinchDist = this._pinchDist();
    }
  }

  _onPointerMove(e) {
    // ── Always update hover cell (fires even on plain mouse-hover, no button held) ──
    const rect         = this.canvas.getBoundingClientRect();
    const { row, col } = this._screenToCell(e.clientX - rect.left, e.clientY - rect.top);
    const inBounds  = row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS;
    const newHover  = inBounds ? { row, col } : null;
    const hoverChanged = JSON.stringify(newHover) !== JSON.stringify(this._hoverCell);
    if (hoverChanged) this._hoverCell = newHover;

    // ── Select mode rubber-band ──────────────────────────────────────────────
    if (this.selectMode && this._selectStart && (e.pointerId in this._lastPointers)) {
      const cr = Math.max(0, Math.min(GRID_ROWS - 1, row));
      const cc = Math.max(0, Math.min(GRID_COLS - 1, col));
      this.dragRect = {
        r1: Math.min(this._selectStart.row, cr),
        c1: Math.min(this._selectStart.col, cc),
        r2: Math.max(this._selectStart.row, cr),
        c2: Math.max(this._selectStart.col, cc),
      };
      this._lastPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      this._draw();
      return;
    }

    if (hoverChanged) this._draw();

    // Drag / pinch logic only applies when a pointer button is held
    if (!(e.pointerId in this._lastPointers)) return;
    const prev = this._lastPointers[e.pointerId];
    const ids  = Object.keys(this._lastPointers);

    if (ids.length === 1 && this._dragging) {
      if (this.wallMode) {
        // Wall Mode: drag paints / erases cells instead of panning
        if (inBounds) {
          const key = `${row},${col}`;
          if (key !== this._lastDragCell) {
            this._lastDragCell = key;
            if (this.onCellTap) this.onCellTap(row, col);
          }
        }
      } else {
        // Normal mode: pan the grid
        this._tx += e.clientX - prev.x;
        this._ty += e.clientY - prev.y;
        this._draw();
      }
    } else if (ids.length === 2) {
      this._lastPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      const dist = this._pinchDist();
      if (this._lastPinchDist) {
        const centre = this._pinchCentre();
        this._zoom(dist / this._lastPinchDist, centre.x, centre.y);
      }
      this._lastPinchDist = dist;
    }
    this._lastPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  }

  _onPointerUp(e) {
    const start = this._pointerStart;
    const dx    = e.clientX - (start?.x ?? e.clientX);
    const dy    = e.clientY - (start?.y ?? e.clientY);
    const isTap = Math.hypot(dx, dy) < 8 && Object.keys(this._lastPointers).length === 1;

    // ── Select mode ──────────────────────────────────────────────────────────
    if (this.selectMode) {
      if (this.floatingPattern && isTap) {
        // Drop floating pattern at tapped cell
        const rect2        = this.canvas.getBoundingClientRect();
        const { row, col } = this._screenToCell(e.clientX - rect2.left, e.clientY - rect2.top);
        if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
          if (this.onCellTap) this.onCellTap(row, col);
        }
      } else if (this._selectStart && this.dragRect) {
        // Finalise rubber-band → fixed selection
        const finalRect    = { ...this.dragRect };
        this.selectionRect = finalRect;
        this.dragRect      = null;
        this._selectStart  = null;
        this._draw();
        if (this.onSelectRect) this.onSelectRect(finalRect.r1, finalRect.c1, finalRect.r2, finalRect.c2);
      }
      delete this._lastPointers[e.pointerId];
      if (Object.keys(this._lastPointers).length === 0) {
        this._dragging = false; this._lastPinchDist = null;
      }
      if (this.onPointerUp) this.onPointerUp();
      return;
    }

    // Tap = single pointer + minimal movement.
    // In wall mode, skip if _onPointerMove already painted a cell (avoids double-toggle).
    if (isTap && !(this.wallMode && this._lastDragCell)) {
      const rect         = this.canvas.getBoundingClientRect();
      const { row, col } = this._screenToCell(e.clientX - rect.left, e.clientY - rect.top);
      if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
        if (this.onCellTap) this.onCellTap(row, col);
      }
    }

    delete this._lastPointers[e.pointerId];
    if (Object.keys(this._lastPointers).length === 0) {
      this._dragging      = false;
      this._lastPinchDist = null;
    }
    if (this.onPointerUp) this.onPointerUp();
  }

  _onWheel(e) {
    e.preventDefault();
    const rect   = this.canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.13 : 0.88;
    this._zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  _zoom(factor, sx, sy) {
    const newScale = Math.min(this._maxScale, Math.max(this._minScale, this._scale * factor));
    const sf       = newScale / this._scale;
    this._tx       = sx - sf * (sx - this._tx);
    this._ty       = sy - sf * (sy - this._ty);
    this._scale    = newScale;
    this._draw();
  }

  _pinchDist() {
    const pts = Object.values(this._lastPointers);
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  }

  _pinchCentre() {
    const pts = Object.values(this._lastPointers);
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
}
