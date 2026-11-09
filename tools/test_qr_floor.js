/**
 * test_qr_floor.js - a scanned or deep-linked position always lands on the
 * floor the QR names, and the dot is never left on the wrong floor.
 *
 * Reported 2026-11-09: "the ground floor qr points me to the correct
 * coordinates but on the lower ground floor". Two causes:
 *
 *  1. A route from the Ground Floor to an office on another floor whose stair
 *     search failed fell back to switchFloor(destination) and left NAV.position
 *     at the Ground Floor coordinates - the dot sat at the scanned cell, on the
 *     Lower Ground map. (The search failure itself is test_crossfloor.js.)
 *  2. The in-app scanner only changed floor when the QR's floor differed from
 *     NAV._currentFloor, a copy that starts at 0 and is never synced on a
 *     device's first run (STATE.currentFloor starts at 1). A Lower Ground
 *     sign scanned there kept the Ground Floor map.
 *
 * Run: node tools/test_qr_floor.js <repo-root>
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
const app = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/app.js'), 'utf8');
const nav = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/nav.js'), 'utf8');

function lift(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`cannot find ${name}`);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}

console.log('\n--- the in-app scanner sets the floor the QR names ---');
{
  // Drive the decode branch of _navQRLoop with a fake camera frame and jsQR.
  const scanned = [];
  const sb = {
    console,
    NAV: { _stream: {}, _currentFloor: 0, onFloorChange: (f) => scanned.push(['floor', f]), _hasQRFix: false },
    jsQR: () => ({ data: 'https://penaranda-dissertation.vercel.app/?qr=0:43,4' }),
    navStopQRScan: () => {},
    navSetPosition: (r, c) => scanned.push(['pos', r, c]),
    requestAnimationFrame: () => 0,
  };
  vm.createContext(sb);
  vm.runInContext([lift(nav, 'navParseDeepLink'), lift(nav, '_navQRLoop')].join('\n') +
                  ';this.loop = _navQRLoop;', sb);
  const video = { readyState: 4, HAVE_ENOUGH_DATA: 4, videoWidth: 10, videoHeight: 10 };
  const canvas = { width: 0, height: 0,
                   getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [], width: 10, height: 10 }) }) };
  // The stale case: NAV thinks floor 0 (its starting value) while the app shows the Ground Floor.
  sb.loop(video, canvas, null);
  ok('a Lower Ground sign asks the app to show the Lower Ground even when NAV._currentFloor already says 0',
     scanned.some((e) => e[0] === 'floor' && e[1] === 0), JSON.stringify(scanned));
  ok('  and then sets the scanned cell', scanned.some((e) => e[0] === 'pos' && e[1] === 43 && e[2] === 4));
}

console.log('\n--- first run: the navigation module starts on the app\'s floor ---');
{
  const body = lift(app, 'loadGridState');
  const firstRun = body.slice(body.indexOf('First-run preset load'));
  ok('the first-run preset branch syncs NAV._currentFloor', /NAV\._currentFloor\s*=/.test(firstRun),
     'NAV._currentFloor is never set on first run');
}

console.log('\n--- a route with no shared stairs does not strand the dot ---');
{
  const body = lift(app, 'navigateToDepartment');
  const i = body.indexOf('if (crossFloor && !stair)');
  const branch = i >= 0 ? body.slice(i, i + 900) : '';
  ok('the fallback moves the dot to where its route starts on the new floor',
     /NAV\.position\s*=\s*\{\s*row:\s*startCell\.row/.test(branch) ||
     /navSetPosition\(\s*startCell\.row/.test(branch), 'NAV.position is left at the old floor\'s cell');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
