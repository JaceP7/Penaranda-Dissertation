/**
 * test_editor_phone.js - the staff map editor on a phone (Jace, 2026-11-10:
 * "revamp the map editor pane, make it easier to use on phones").
 *
 * Measured before the change, at 375 x 812:
 *   - The whole 75 x 75 floor was drawn at 4 px per cell, and in Wall Mode
 *     a one-finger drag painted, so the map could not be moved at all
 *     (two fingers only zoomed, about a fixed point). Select Mode could not
 *     move the map either.
 *   - The first finger of a pinch painted a wall before the second landed.
 *   - Every rotation of the phone or URL-bar slide reset the zoom.
 *   - The header took two rows (about 130 px); Wall / Select / Stamp were
 *     behind the "..." menu, and opening it pushed the map down.
 *   - The stamp panel took 60% of the width beside a squeezed map.
 *   - The citizen chat pill and the wrench covered the bottom of the map.
 *
 * Run: node tools/test_editor_phone.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const html = read('wayfinding-app/index.html');
const css = read('wayfinding-app/css/app.css');
const app = read('wayfinding-app/js/app.js');
const rend = read('wayfinding-app/js/renderer.js');

function lift(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}
function load(src, names) {
  const ctx = {};
  vm.createContext(ctx);
  for (const n of names) {
    const body = lift(src, n);
    if (!body) return null;
    vm.runInContext(body, ctx);
  }
  return ctx;
}
/** The body of a class method, e.g. method(rend, '_onPointerMove'). */
function method(src, name) {
  const re = new RegExp('\\n  ' + name + '\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return '';
  let depth = 0, k = src.indexOf('{', m.index);
  const start = k;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, k + 1);
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('\n--- two fingers move and zoom the map, in every tool ---');
{
  const ctx = load(rend, ['twoFingerTransform']);
  ok('twoFingerTransform(prevA, prevB, curA, curB, view, minScale, maxScale) exists', !!ctx);
  if (ctx) {
    const view = { scale: 2, tx: 10, ty: 20 };
    let t = ctx.twoFingerTransform({ x: 100, y: 100 }, { x: 200, y: 100 },
                                   { x: 130, y: 90 }, { x: 230, y: 90 }, view, 1, 10);
    ok('two fingers sliding together pan by the same amount', near(t.scale, 2) && near(t.tx, 40) && near(t.ty, 10),
       JSON.stringify(t));
    t = ctx.twoFingerTransform({ x: 100, y: 100 }, { x: 200, y: 100 },
                               { x: 50, y: 100 }, { x: 250, y: 100 }, view, 1, 10);
    ok('spreading the fingers doubles the zoom', near(t.scale, 4), JSON.stringify(t));
    // The map point under the midpoint (150,100) stays under it.
    const gx = (150 - view.tx) / view.scale, gy = (100 - view.ty) / view.scale;
    ok('...about the point between the fingers', near(t.tx + gx * t.scale, 150) && near(t.ty + gy * t.scale, 100),
       JSON.stringify(t));
    t = ctx.twoFingerTransform({ x: 100, y: 100 }, { x: 110, y: 100 },
                               { x: 0, y: 100 }, { x: 400, y: 100 }, view, 1, 10);
    ok('zoom is held at the maximum', near(t.scale, 10), JSON.stringify(t));
    t = ctx.twoFingerTransform({ x: 0, y: 100 }, { x: 400, y: 100 },
                               { x: 195, y: 100 }, { x: 205, y: 100 }, view, 1, 10);
    ok('...and at the minimum', near(t.scale, 1), JSON.stringify(t));
  }
  const mv = method(rend, '_onPointerMove');
  ok('the renderer uses it for every two-finger move', /twoFingerTransform\(/.test(mv));
  ok('select mode no longer swallows a second finger before the gesture check',
     mv.indexOf('twoFingerTransform(') > -1 && mv.indexOf('twoFingerTransform(') < mv.indexOf('this.selectMode && this._selectStart'));
}

console.log('\n--- a pinch never paints: touch waits before it draws ---');
{
  const ctx = load(rend, ['touchPaintReady']);
  ok('touchPaintReady(pointerType, movedPx, heldMs, pointerCount) exists', !!ctx);
  if (ctx) {
    ok('a mouse paints straight away', ctx.touchPaintReady('mouse', 0, 0, 1) === true);
    ok('a pen paints straight away', ctx.touchPaintReady('pen', 0, 0, 1) === true);
    ok('a finger just landed does not paint yet', ctx.touchPaintReady('touch', 3, 40, 1) === false);
    ok('a finger held a moment paints', ctx.touchPaintReady('touch', 0, 130, 1) === true);
    ok('a finger dragged clearly paints', ctx.touchPaintReady('touch', 20, 60, 1) === true);
    ok('two fingers never paint', ctx.touchPaintReady('touch', 40, 400, 2) === false);
  }
  const down = method(rend, '_onPointerDown');
  const mv = method(rend, '_onPointerMove');
  const up = method(rend, '_onPointerUp');
  ok('a second finger turns the touch into a gesture', /this\._gesture\s*=\s*true/.test(down));
  ok('...and cancels a selection box that had started', /this\.dragRect\s*=\s*null/.test(down));
  ok('painting during a drag waits for touchPaintReady', /touchPaintReady\(/.test(mv));
  ok('a gesture ends without a tap or paint', /this\._gesture/.test(up) && /if\s*\(\s*this\._gesture/.test(up));
}

console.log('\n--- the editor keeps its zoom when the screen size changes ---');
{
  const rs = method(rend, 'resize');
  ok('resize(keepView) keeps the centre cell and cell size', /keepView/.test(rs));
  ok('the editor passes keepView on a resize', /renderer\.resize\(\s*true\s*\)/.test(lift(app, '_onMapResize') || ''));
  ok('opening the stamp panel keeps the view', /renderer\.resize\(\s*true\s*\)/.test(lift(app, 'setToolsPanel') || ''));
  ok('zoomBy(factor) and fitAll() are public', /\n  zoomBy\(/.test(rend) && /\n  fitAll\(/.test(rend));
}

console.log('\n--- the tool bar along the bottom (thumb reach) ---');
{
  ok('#editorDock exists', /id="editorDock"/.test(html));
  for (const id of ['dockMove', 'dockPaint', 'dockSelect', 'dockStamp', 'dockUndo', 'dockRedo']) {
    ok(`  with #${id}`, new RegExp(`id="${id}"`).test(html));
  }
  ok('each tool has a visible word, not only an icon',
     /id="dockPaint"[^>]*>[\s\S]{0,200}Paint/.test(html) && /id="dockStamp"[^>]*>[\s\S]{0,200}Stamp/.test(html));
  const ctx = load(app, ['_dockTool']);
  ok('_dockTool(state) exists', !!ctx);
  if (ctx) {
    ok('wall mode -> paint', ctx._dockTool({ wallMode: true }) === 'paint');
    ok('select mode -> select', ctx._dockTool({ selectMode: true }) === 'select');
    ok('stamp panel -> stamp', ctx._dockTool({ stampMode: true }) === 'stamp');
    ok('none -> move', ctx._dockTool({}) === 'move');
  }
  for (const fn of ['setWallMode', 'setSelectMode', 'setToolsPanel', 'setNavMode', 'setCaptureMode']) {
    ok(`${fn} keeps the dock in step`, /_syncDock\(\)/.test(lift(app, fn) || ''));
  }
  ok('undo/redo keep the dock buttons in step', /dockUndo|_syncDock\(\)/.test(lift(app, '_updateUndoRedoBtns') || ''));
  ok('the dock is shown only in the editor on a phone',
     /\.editor-dock\s*\{[^}]*display:\s*none/.test(css) &&
     /@media \(max-width: 640px\)[\s\S]*body\.view-admin \.editor-dock\s*\{[^}]*display:\s*flex/.test(css));
  ok('dock buttons are at least 48 px tall', /\.dock-btn\s*\{[^}]*min-height:\s*(4[89]|5\d)px/.test(css));
}

console.log('\n--- zoom buttons ---');
{
  for (const id of ['zoomInBtn', 'zoomOutBtn', 'zoomFitBtn']) ok(`#${id} exists`, new RegExp(`id="${id}"`).test(html));
  ok('they have accessible names', /id="zoomInBtn"[^>]*aria-label=/.test(html) && /id="zoomOutBtn"[^>]*aria-label=/.test(html));
  ok('they are hidden from citizens', /body\.view-user \.zoom-ctrls\s*\{\s*display:\s*none/.test(css));
  ok('app wires them to zoomBy / fitAll', /zoomInBtn[\s\S]{0,120}zoomBy\(/.test(app) && /zoomFitBtn[\s\S]{0,120}fitAll\(/.test(app));
}

console.log('\n--- a compact top bar; the menu floats over the map ---');
{
  ok('_setEditorMenu(open) exists', /function _setEditorMenu\(open\)/.test(app));
  ok('it marks the body so CSS can show the menu', /editor-menu-open/.test(lift(app, '_setEditorMenu') || ''));
  ok('touching the map closes the menu', /canvas\.addEventListener\('pointerdown',[^\n]*_setEditorMenu\(false\)/.test(app));
  const phone = css.slice(css.indexOf('/* ── Map editor on a phone'));
  ok('there is a phone block for the editor', phone.length > 100);
  ok('the header is fixed, so opening the menu never resizes the map',
     /body\.view-admin \.app-header\s*\{[^}]*position:\s*fixed/.test(phone));
  ok('the title is hidden in the editor on a phone', /body\.view-admin \.app-header h1\s*\{\s*display:\s*none/.test(phone));
  ok('tools that moved to the dock are not repeated in the menu',
     /body\.view-admin #undoBtn,[\s\S]{0,200}#stampModeBtn\s*\{\s*display:\s*none/.test(phone));
  ok('menu buttons are at least 44 px tall', /body\.view-admin\.editor-menu-open[^{]*\.btn[^{]*\{[^}]*min-height:\s*4[4-9]px/.test(phone));
  ok('the chat pill is hidden in the editor on a phone', /body\.view-admin \.chat-toggle-btn\s*\{\s*display:\s*none/.test(phone));
  ok('the wrench moves to the top bar', /body\.view-admin \.admin-toggle\s*\{[^}]*top:/.test(phone));
}

console.log('\n--- stamps: a sheet from the bottom, not a side panel ---');
{
  ok('#toolsPanelHandle exists', /id="toolsPanelHandle"/.test(html));
  ok('it says what it does', /id="toolsPanelHandle"[^>]*aria-expanded=/.test(html));
  const phone = css.slice(css.indexOf('/* ── Map editor on a phone'));
  ok('the panel sits along the bottom on a phone',
     /body\.view-admin \.tools-panel\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*0/.test(phone));
  ok('it can be folded down to its handle', /\.tools-panel\.collapsed/.test(phone));
  ok('paint, selection and capture bars sit just above the dock', /#paintTypeBar[^{]*\{[^}]*margin-top:\s*auto/.test(phone));
}

console.log('\n--- a tap on the stamp pattern lands on the square under the finger ---');
{
  // The 180 px pattern canvas is stretched to the panel width (about 365 px on
  // a phone); taps were divided by the unstretched square size, so a tap on
  // the second square painted the fourth.
  const ctx = load(app, ['_stampCellAt']);
  ok('_stampCellAt(x, y, shownW, shownH, size) exists', !!ctx);
  if (ctx) {
    let c = ctx._stampCellAt(110, 10, 365, 365, 5);     // second square of five, stretched
    ok('stretched: x 110 of 365 is column 1', c.col === 1 && c.row === 0, JSON.stringify(c));
    c = ctx._stampCellAt(179, 179, 180, 180, 5);
    ok('unstretched: the last pixel is the last square', c.col === 4 && c.row === 4, JSON.stringify(c));
    c = ctx._stampCellAt(400, -3, 365, 365, 5);
    ok('outside the canvas is clamped to the edge squares', c.col === 4 && c.row === 0, JSON.stringify(c));
  }
  ok('stampEditorTap uses it', /_stampCellAt\(/.test(lift(app, 'stampEditorTap') || ''));
}

console.log('\n--- words for fingers, not a mouse ---');
{
  const ctx = load(app, ['_editorHint']);
  ok('_editorHint(mode, touch) exists', !!ctx);
  if (ctx) {
    const t = ctx._editorHint('wall', true), m = ctx._editorHint('wall', false);
    ok('on a phone it says tap and two fingers', /tap/i.test(t) && /two fingers/i.test(t) && !/click/i.test(t), t);
    ok('with a mouse it still says click', /click/i.test(m), m);
    ok('select on a phone says drag with one finger', /one finger/i.test(ctx._editorHint('select', true)));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
