/**
 * test_map_legibility.js - feedback of 2026-11-09:
 *   #1 "the S and D are not self explanatory"
 *   #5 offices not in the building: no silent fallback; offer the help desk,
 *      then the nearest exits
 *   #7 "users should be able to set pins" (Jace chose: tap -> I'm here / Go here)
 *
 * Before: stairs and doors carried a bare "S" and "D", the destination an "E";
 * 37 of 173 trips that day were re-pointed to the Public Assistance Center
 * without saying so (CDRRMD and OSCA are not on the map); and a tap on the
 * citizen map did nothing.
 *
 * Run: node tools/test_map_legibility.js <repo-root>
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
const EMOJI = /\p{Extended_Pictographic}/u;

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
function block(id) {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return '';
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf('<!-- /' + id + ' -->', i);
  return end > 0 ? html.slice(start, end) : html.slice(start, start + 1500);
}

console.log('\n--- #1 a map citizens can read ---');
{
  const ctx = {}; vm.createContext(ctx);
  const src = lift(rend, 'stairClusters');
  ok('renderer.js has stairClusters(cells, n)', !!src);
  if (src) {
    vm.runInContext(src, ctx);
    const N = 10, g = Array(N * N).fill('open');
    [[1, 1], [1, 2], [2, 1], [2, 2], [7, 7], [8, 7]].forEach(([r, c]) => { g[r * N + c] = 'stair'; });
    const cl = ctx.stairClusters(g, N);
    ok('  finds two separate stairwells', cl.length === 2, JSON.stringify(cl));
    ok('  each with its centre', cl.some((c) => c.row === 1.5 && c.col === 1.5) && cl.some((c) => c.row === 7.5 && c.col === 7), JSON.stringify(cl));
    // The Ground Floor's flights at 60,26 / 61,25 touch only at a corner; as
    // two clusters they drew two overlapping "Stairs" labels.
    const g2 = Array(N * N).fill('open'); g2[5 * N + 5] = 'stair'; g2[6 * N + 4] = 'stair';
    ok('  a diagonal flight is one stairwell', ctx.stairClusters(g2, N).length === 1, JSON.stringify(ctx.stairClusters(g2, N)));
  }
  ok('the renderer has a citizen-view switch', /this\.citizenView\s*=\s*false/.test(rend));
  ok('setViewMode turns it on for citizens', /renderer\.citizenView\s*=\s*\(?STATE\.viewMode === 'user'\)?/.test(app));
  ok('no "D" on doors for citizens', /ct === 'door' && cs >= 10 && !this\.citizenView/.test(rend));
  ok('no "S" on stairs for citizens', /ct === 'stair' && cs >= 10 && !this\.citizenView/.test(rend));
  ok('doors are drawn as openings for citizens', /this\.citizenView && ct === 'door'/.test(rend));
  ok('every stairwell is labelled "Stairs"', /stairClusters\(/.test(rend) && /'Stairs'/.test(rend));
  ok('the destination is a pin, not "E", for citizens', /_drawPin\(/.test(rend) && /this\.citizenView \? '' : 'E'|!this\.citizenView\) [^\n]*'E'/.test(rend));
  ok('exits are labelled "Exit" on their floor', /'Exit'/.test(rend) && /this\.exits/.test(rend));
}

console.log('\n--- #5 offices outside or not on the map ---');
const sb = { console, localStorage: { getItem() { return null; }, setItem() {} }, window: {} };
vm.createContext(sb);
vm.runInContext(read('wayfinding-app/js/floor_presets.js'), sb);
vm.runInContext(read('wayfinding-app/js/stamp_presets.js') + '\n;var STAMP_PLACEMENTS = STAMP_PLACEMENTS_BUNDLED.slice();', sb);
vm.runInContext(read('wayfinding-app/js/service_locations.js') +
  '\n;this.resolve = resolveServiceLocation; this.status = typeof serviceLocationStatus === "function" ? serviceLocationStatus : null;' +
  'this.exits = typeof BUILDING_EXITS !== "undefined" ? BUILDING_EXITS : null; this.nearestExit = typeof nearestExit === "function" ? nearestExit : null;' +
  'this.describe = describeOfficeLocation;', sb);
const CDRRMD = 'CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO';
const r = sb.resolve(CDRRMD);
ok('an office not on the map is reported, not re-pointed to the help desk',
   r && r.unmapped === true && r.row == null && !r.fallback, JSON.stringify(r));
ok('serviceLocationStatus() exists', typeof sb.status === 'function');
if (sb.status) {
  ok('  mapped for BPLO', sb.status('BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE') === 'mapped');
  ok('  outside for City College', sb.status('CITY COLLEGE OF CALAMBA') === 'outside');
  ok('  unmapped for CDRRMD and OSCA', sb.status(CDRRMD) === 'unmapped' && sb.status('OFFICE FOR THE SENIOR CITIZENS AFFAIRS') === 'unmapped');
  ok('  mapped for COMELEC (LG 19)', sb.status('COMMISSION ON ELECTIONS') === 'mapped');
}
ok('BUILDING_EXITS lists the four Ground Floor doors', Array.isArray(sb.exits) && sb.exits.length === 4 && sb.exits.every((e) => e.floor === 1),
   JSON.stringify(sb.exits));
if (Array.isArray(sb.exits)) {
  const g = vm.runInContext('FLOOR_PRESETS[1]', sb);
  ok('  each exit cell is walkable', sb.exits.every((e) => g[e.row * 75 + e.col] !== 'wall'));
}
if (sb.nearestExit) {
  const man = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  ok('nearestExit picks the closest door', sb.nearestExit({ floor: 1, row: 40, col: 70 }, sb.exits, man).col === 71);
  ok('  and the main entrance from near it', sb.nearestExit({ floor: 1, row: 70, col: 36 }, sb.exits, man).row === 73);
} else ok('nearestExit(from, exits, dist) exists', false);
{
  const d = sb.describe({ dept: CDRRMD, name: 'City Disaster Risk Reduction and Management Division', abbr: 'CDRRMD' }, 'en');
  ok('a "where is" answer for it says it may be outside City Hall', /may be outside City Hall/.test(d.text) && d.place === 'unmapped', JSON.stringify(d));
  const c = sb.describe({ dept: 'CITY COLLEGE OF CALAMBA', name: 'City College of Calamba', abbr: null }, 'en');
  ok('  and City College is marked outside', c.place === 'outside', JSON.stringify(c));
}
{
  const nav = lift(app, 'navigateToDepartment') || '';
  ok('navigateToDepartment takes a preset place (pins, exits)', /function navigateToDepartment\(deptName, subservice, answerText, presetLoc\)/.test(app) && /presetLoc \|\|/.test(nav));
  ok('  and never routes an unmapped office anywhere', /loc\.unmapped/.test(nav) && !/loc\.fallback/.test(nav));
  ok('navigateToNearestExit() routes to the nearest exit', /function navigateToNearestExit\(/.test(app) && /nearestExit\(/.test(lift(app, 'navigateToNearestExit') || ''));
}

console.log('\n--- #7 pins ---');
{
  const tap = lift(app, 'handleCellTap') || '';
  ok('a tap on the citizen map drops a pin', /STATE\.viewMode === 'user'\) \{?\s*_onCitizenMapTap\(row, col\)/.test(tap));
  const pin = lift(app, '_onCitizenMapTap') || '';
  ok('  which is drawn and opens the pin menu', /renderer\.pin\s*=/.test(pin) && /pinMenu/.test(pin));
  const b = block('pinMenu');
  ok('the pin menu has "Nandito ako" and "Pumunta dito" buttons',
     /id="pinHereBtn"/.test(b) && /id="pinGoBtn"/.test(b) && /Nandito ako/.test(b) && /Pumunta dito/.test(b), b.slice(0, 200));
  ok('  a close button with a label', /id="pinCloseBtn"[^>]*aria-label=/.test(b));
  ok('  no emoji', b && !EMOJI.test(b));
  ok('  44 px buttons', /\.pin-menu button[^{]*\{[^}]*min-height:\s*44px/.test(css));
  ok('"Set me here" uses the manual-location path (snaps off walls)', /_applyManualLocation\(/.test(lift(app, '_pinSetHere') || ''));
  ok('"Go here" routes with a preset place', /navigateToDepartment\([^)]*\{\s*floor/.test(lift(app, '_pinGoHere') || ''));
  ok('the renderer draws the dropped pin', /this\.pin\b/.test(rend));
  // Seen while testing "Go here": a same-floor route after a stairs trip kept
  // the "At the stairs" button from the old trip.
  const nav2 = lift(app, 'navigateToDepartment') || '';
  ok('every new route starts with "At the stairs" hidden', /_crossFloorTrip = null;\s*\n\s*if \(DOM\.navStairBtn\) DOM\.navStairBtn\.hidden = true;/.test(nav2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
