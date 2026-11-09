/**
 * test_nav_follow.js - auto-zoom and re-center while navigating (Jace,
 * 2026-11-09: "there should be an auto-zoom and a re-center for the
 * navigation panel").
 *
 * Before: the route was framed once when it started. Each step then only
 * re-centred on the dot at that first zoom, so on a long route the map stayed
 * zoomed out (5-9 px per cell) for the whole walk. And after a drag or pinch
 * there was no way back except waiting for the next step to yank the view.
 *
 * Now, while following (the default), each step frames the dot plus the next
 * stretch of the route, which zooms in as the route gets short. A drag of 8 px
 * or more, a pinch or a wheel stops following and shows "Re-center"; tapping
 * it resumes. A plain tap (to drop a pin) does not count as moving the map.
 *
 * Run: node tools/test_nav_follow.js <repo-root>
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
const app = read('wayfinding-app/js/app.js');
const rend = read('wayfinding-app/js/renderer.js');
const html = read('wayfinding-app/index.html');
const css = read('wayfinding-app/css/app.css');
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

console.log('\n--- auto-zoom: the dot and the stretch ahead ---');
{
  const src = lift(app, '_aheadCells');
  ok('app.js has _aheadCells(path, startId, n)', !!src);
  if (src) {
    const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);
    const p = ['1,1', '1,2', '1,3', '1,4', '1,5', '1,6'];
    const a = ctx._aheadCells(p, '1,2', 2);
    ok('  from the dot, n cells ahead', JSON.stringify(a) === JSON.stringify([{ row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }]), JSON.stringify(a));
    ok('  stops at the end of the route', ctx._aheadCells(p, '1,5', 10).length === 2);
    ok('  a dot off the route starts from the route start', ctx._aheadCells(p, '9,9', 1).length === 2 && ctx._aheadCells(p, '9,9', 1)[0].col === 1);
    ok('  no route, nothing', ctx._aheadCells(null, '1,1', 5).length === 0);
  }
  const fa = lift(app, '_frameAhead') || '';
  ok('_frameAhead fits the dot and the cells ahead into the visible map',
     /_aheadCells\(/.test(fa) && /renderer\.fitCells\(/.test(fa) && /_visibleMapBox\(\)/.test(fa));
  const onPos = (app.match(/NAV\.onPositionChange = \(row, col\) => \{[\s\S]*?\n  \};/) || [''])[0];
  ok('each step frames ahead while following', /_followMode\) _frameAhead\(\)/.test(onPos), onPos.slice(0, 120));
  ok('  and leaves the view alone after the citizen moved the map', /if \(_citizenRoute\(\)\)/.test(onPos));
  ok('  the editor keeps plain centring', /renderer\.centerOnCell\(row, col, _visibleMapBox\(\)\)/.test(onPos));
}

console.log('\n--- moving the map stops following ---');
{
  ok('the renderer reports a drag of 8 px or more', /Math\.hypot\([^)]*_pointerStart[^)]*\)[^;]*>= 8[^;]*\)\s*this\.onUserMove\(\)|_movedEnough\(e\)\) this\.onUserMove\(\)/.test(rend));
  // A two-finger move (pinch or pan) goes through twoFingerTransform since the
  // editor revamp (2026-11-10) and still reports the move.
  ok('  a pinch', /twoFingerTransform\([\s\S]{0,700}?this\._draw\(\);\s*\r?\n\s*if \(this\.onUserMove\) this\.onUserMove\(\);/.test(rend));
  ok('  and the mouse wheel', /_onWheel\(e\) \{[\s\S]{0,300}this\.onUserMove/.test(rend));
  ok('the app turns following off on it', /renderer\.onUserMove = \(\) => \{[^}]*_setFollow\(false\)/.test(app));
  const sf = lift(app, '_setFollow') || '';
  ok('_setFollow shows "Re-center" only when not following', /classList\.toggle\('nav-free', !on\)/.test(sf));
}

console.log('\n--- the Re-center button ---');
{
  const i = html.indexOf('id="navRecenterBtn"');
  const tag = i > 0 ? html.slice(html.lastIndexOf('<', i), html.indexOf('</button>', i)) : '';
  ok('index.html has a Re-center button', /Re-center/.test(tag), tag);
  ok('  with a label for screen readers', /aria-label=/.test(tag));
  ok('  hidden unless a citizen route is up and following is off',
     /\.nav-recenter-btn\s*\{[^}]*display:\s*none/.test(css) &&
     /body\.view-user\.route-active\.nav-free \.nav-recenter-btn\s*\{[^}]*display:\s*inline-flex/.test(css));
  ok('  44 px tall', /\.nav-recenter-btn\s*\{[^}]*min-height:\s*44px/.test(css));
  ok('  tapping it resumes following and frames ahead', /function _recenterNav\(\)[\s\S]{0,200}_setFollow\(true\)[\s\S]{0,100}_frameAhead\(\)/.test(app));
  ok('a new route starts in follow mode', /_setFollow\(true\)/.test(lift(app, 'navigateToDepartment') || '') &&
     /_setFollow\(true\)/.test(lift(app, '_startCrossFloorLegTwo') || ''));
  ok('the visible-map box avoids it', /'navRecenterBtn'/.test(lift(app, '_visibleMapBox') || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
