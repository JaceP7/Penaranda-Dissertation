/**
 * test_map_phone.js - the citizen map on a phone, the chat button, and the
 * staff entry (2026-11-09, Jace chose option A for the staff button).
 *
 * Measured before the fix:
 *   - 375 x 812: a route from the main entrance zoomed onto the citizen's
 *     position (the bottom row of the building), so the lower half of the
 *     screen was empty and the step bar covered the top. About 200 px of the
 *     812 px screen showed map.
 *   - Turning the phone sideways reset the map to the whole building at
 *     4 px per cell, with the step bar over 60% of the height.
 *   - Step numbers were drawn on every path cell at 9 px in 8.8 px cells and
 *     ran together ("2120 19").
 *   - An empty 44 px white strip (the editor's info bar) sat under the map.
 *   - The round chat button stayed on screen while the chat was open on any
 *     screen wider than 640 px.
 *   - Citizens saw "Staff: open map editor" on the landing card and a dim
 *     wrench in the corner.
 *
 * Layout is also checked in the browser at 375 x 812, 320 x 640, 812 x 375
 * and 1280 x 800; this file pins the rules and the framing maths.
 *
 * Run: node tools/test_map_phone.js <repo-root>
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
const admin = read('wayfinding-app/admin.html');
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
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('\n--- staff entry: none on the citizen screen (option A) ---');
ok('the landing card has no "Staff: open map editor" button',
   !/tempAdminBtn|temp-admin-entry|open map editor/i.test(html));
ok('app.js no longer wires the landing-card button', !/tempAdminBtn/.test(app));
ok('the temporary landing-card styles are gone', !/\.temp-admin-(entry|btn|note)/.test(css));
ok('the corner wrench is hidden in the citizen view unless staff asked for it',
   /body\.view-user:not\(\.staff-entry\) \.admin-toggle\s*\{\s*display:\s*none !important/.test(css));
{
  const ctx = load(app, ['_staffEntryFlag']);
  ok('_staffEntryFlag(search, store) exists', !!ctx);
  if (ctx) {
    const mk = () => { const m = {}; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
    let s = mk();
    ok('?staff=1 turns the staff entry on', ctx._staffEntryFlag('?staff=1', s) === true);
    ok('...and it stays on for the tab without the parameter', ctx._staffEntryFlag('', s) === true);
    ok('?staff=0 turns it off again', ctx._staffEntryFlag('?staff=0', s) === false && ctx._staffEntryFlag('', s) === false);
    s = mk();
    ok('a citizen with no parameter never gets it', ctx._staffEntryFlag('', s) === false);
    ok('it rides along with a QR deep link', ctx._staffEntryFlag('?qr=1:73,37&staff=1', mk()) === true);
    ok('a storage that throws (private mode) does not break it',
       ctx._staffEntryFlag('?staff=1', { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } }) === true);
  }
  ok('startup puts staff-entry on <body> when asked', /classList\.toggle\('staff-entry',\s*_staffEntryFlag\(/.test(app));
}
ok('the analytics page links staff to the map editor', /href="\/\?staff=1"/.test(admin) || /href="index\.html\?staff=1"/.test(admin));

console.log('\n--- chat button hides while the chat is open, at every width ---');
ok('top-level body.chat-showing rule hides the round chat button',
   /(^|\n)body\.chat-showing \.chat-toggle-btn\s*\{\s*display:\s*none !important/.test(css));

console.log('\n--- route framing ---');
{
  const ctx = load(rend, ['fitCellsTransform']);
  ok('renderer.js has a pure fitCellsTransform()', !!ctx);
  if (ctx) {
    const f = ctx.fitCellsTransform;
    // 375 x 812 phone: base cell 4 px, visible band under the step bar and above "Ask again".
    const box = { left: 12, top: 235, right: 363, bottom: 712 };
    const b = { r1: 55, c1: 20, r2: 73, c2: 40 };
    const t = f(b, box, 4, 1, 7);
    const cs = 4 * t.scale;
    const L = t.tx + b.c1 * cs, R = t.tx + (b.c2 + 1) * cs, T = t.ty + b.r1 * cs, B = t.ty + (b.r2 + 1) * cs;
    ok('the route box lands inside the visible band', L >= box.left - 0.01 && R <= box.right + 0.01 && T >= box.top - 0.01 && B <= box.bottom + 0.01,
       JSON.stringify({ L, R, T, B }));
    ok('...centred in it', near((L + R) / 2, (box.left + box.right) / 2) && near((T + B) / 2, (box.top + box.bottom) / 2));
    ok('...and as large as fits (one side touches)', near(R - L, box.right - box.left) || near(B - T, box.bottom - box.top));
    const tiny = f({ r1: 70, c1: 36, r2: 72, c2: 38 }, box, 4, 1, 7);
    ok('a very short route stops at the zoom cap', tiny.scale === 7, tiny.scale);
    const all = f({ r1: 0, c1: 0, r2: 74, c2: 74 }, { left: 0, top: 0, right: 200, bottom: 200 }, 4, 1, 7);
    ok('a route bigger than the screen stops at the zoom-out limit', all.scale === 1, all.scale);
  }
}
{
  const ctx = load(app, ['_mapBoxAround']);
  ok('app.js has a pure _mapBoxAround(box, rect)', !!ctx);
  if (ctx) {
    const canvas = { left: 0, top: 0, right: 375, bottom: 812 };
    const below = ctx._mapBoxAround(canvas, { left: 8, top: 8, right: 367, bottom: 223 });
    ok('portrait: a step bar across the top leaves the area below it', below.top === 223 && below.bottom === 812 && below.left === 0 && below.right === 375,
       JSON.stringify(below));
    const land = { left: 0, top: 0, right: 812, bottom: 375 };
    const right = ctx._mapBoxAround(land, { left: 8, top: 8, right: 360, bottom: 300 });
    ok('landscape: a step bar down the left side leaves the area to its right', right.left === 360 && right.right === 812 && right.top === 0 && right.bottom === 375,
       JSON.stringify(right));
    const ask = ctx._mapBoxAround({ left: 0, top: 223, right: 375, bottom: 812 }, { left: 220, top: 740, right: 355, bottom: 792 });
    ok('"Ask again" in the bottom corner trims the bottom, not the side', ask.bottom === 740 && ask.left === 0 && ask.right === 375, JSON.stringify(ask));
    const same = ctx._mapBoxAround(canvas, { left: 400, top: 900, right: 500, bottom: 950 });
    ok('something off the canvas changes nothing', JSON.stringify(same) === JSON.stringify(canvas), JSON.stringify(same));
  }
}
{
  const nav = lift(app, 'navigateToDepartment') || '';
  ok('a new route is framed, not zoomed onto the start cell', /_frameRoute\(/.test(nav) && !/focusOnCell\(startCell\.row, startCell\.col, 2\.2\)/.test(nav));
  const leg2 = lift(app, '_startCrossFloorLegTwo') || '';
  ok('the second floor of a trip is framed too', /_frameRoute\(/.test(leg2) && !/focusOnCell\(/.test(leg2));
  ok('turning the phone (resize) re-frames the route instead of resetting the map',
     /addEventListener\('resize',[^\n]*_frameRoute|function _onMapResize\(\)[\s\S]{0,400}_frameRoute\(/.test(app));
  ok('walking keeps the "you are here" dot inside the visible area',
     /renderer\.centerOnCell\(row, col, _visibleMapBox\(\)\)/.test(app));
  ok('renderer.centerOnCell accepts the visible box', /centerOnCell\(row, col, box\)/.test(rend));
  // 320 x 640: the opening message sat on top of the "you are here" dot.
  const vis = lift(app, '_visibleMapBox') || '';
  ok('the framing also avoids a message that is showing', /stairToast/.test(vis) && /classList\.contains\('visible'\)/.test(vis));
}

console.log('\n--- map drawing on a small screen ---');
{
  const ctx = load(rend, ['stepLabelFits']);
  ok('renderer.js has stepLabelFits(textWidth, cellPx)', !!ctx);
  if (ctx) {
    ok('a two-digit step number is skipped in an 8.8 px cell', ctx.stepLabelFits(11, 8.8) === false);
    ok('...and drawn in a 20 px cell', ctx.stepLabelFits(11, 20) === true);
  }
  ok('the path drawing uses it', /stepLabelFits\(ctx\.measureText\(/.test(rend));
}
ok('the empty editor info bar is gone from the citizen view',
   /body\.view-user \.info-bar\s*\{\s*display:\s*none !important/.test(css));
ok('a phone on its side puts the step bar down the left edge',
   /@media \(orientation: landscape\) and \(max-height: 500px\)\s*\{[\s\S]{0,300}\.nav-step-prompt\s*\{[^}]*transform:\s*none/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
