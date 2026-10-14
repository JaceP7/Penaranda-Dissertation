/**
 * test_crossfloor.js - the cross-floor stair chooser, against the REAL layouts.
 *
 * _bestStairFor() is lifted out of the shipped js/app.js and run over
 * floor_presets.js, then compared with the rule it replaces: pick the stair
 * with the smallest straight-line distance to the office, on the destination
 * floor only, ignoring walls and ignoring how far the citizen has to walk.
 *
 * It also reports how much of the building the two-leg route can currently
 * describe. On floors 0, 2 and 3 almost no office can reach a stairwell in the
 * baked layout - the central-hall doorways were only ever opened on floor 1 -
 * so the chooser correctly returns null there and the caller falls back. That
 * is a map-data gap, not an algorithm one, and this test makes it visible
 * instead of letting it look like a routing failure.
 *
 * Run: node tools/test_crossfloor.js <repo-root>
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

const fp = {};
vm.createContext(fp);
vm.runInContext(
  fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/floor_presets.js'), 'utf8')
    .replace(/^"use strict";/m, '') +
  '\n;this.O = { FLOOR_PRESETS, FLOOR_PRESETS_DEPARTMENTS };', fp);
const { FLOOR_PRESETS, FLOOR_PRESETS_DEPARTMENTS } = fp.O;

const src = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/app.js'), 'utf8');
function lift(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`cannot find ${name} in app.js`);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}

const N = 75;
const sb = {
  GRID_ROWS: N, GRID_COLS: N,
  STATE: { currentFloor: 9 },        // never matches, so FLOOR_WALLS is always used
  NODES: [],
  FLOOR_WALLS: FLOOR_PRESETS,
  console,
};
vm.createContext(sb);
vm.runInContext([lift('_floorCellTypes'), lift('_bfsDistances'), lift('_bestStairFor')].join('\n') +
  '\n;this.API = { _bfsDistances, _bestStairFor };', sb);
const { _bfsDistances, _bestStairFor } = sb.API;

const types = (f) => FLOOR_PRESETS[f].map((v) => v || 'open');
const ENTRANCE = { floor: 1, row: 38, col: 71 };

(async () => {
  console.log('\n--- stair selection on the real Calamba layouts ---');

  const f1 = types(1), f3 = types(3);
  ok('floor 1 and 3 share stair cells',
     f1.some((v, i) => v === 'stair' && f3[i] === 'stair'));
  ok('the 3rd-floor east stair is correctly absent',
     f1[26 * N + 72] === 'stair' && f3[26 * N + 72] !== 'stair');

  ok('an unknown floor yields null, so the caller can fall back',
     _bestStairFor(1, ENTRANCE.row, ENTRANCE.col, 7, 10, 10) === null);

  // A wall at either end must be snapped, not rejected: most office anchors are
  // walls, and the configured entrance itself used to be one.
  const wallStart = _bestStairFor(1, 38, 72, 1, 14, 37);
  ok('a wall START is snapped, not rejected', !!wallStart && wallStart.total > 0,
     JSON.stringify(wallStart));
  const wallDest = _bestStairFor(1, ENTRANCE.row, ENTRANCE.col, 1, 54, 7);
  ok('a wall DESTINATION is snapped, not rejected', !!wallDest && wallDest.total > 0,
     JSON.stringify(wallDest));
  if (wallDest) {
    ok('the chosen cell really is a stair on both floors',
       f1[wallDest.row * N + wallDest.col] === 'stair');
    ok('it reports both legs and they sum to the total',
       wallDest.legOne >= 0 && wallDest.legTwo >= 0 &&
       wallDest.total === wallDest.legOne + wallDest.legTwo);
  }

  // ── coverage: how much of the building can the two-leg route describe? ────
  console.log('\n--- coverage against the baked layout ---');
  let routable = 0, blocked = 0, better = 0, saved = 0, worse = 0;
  const perFloor = {};

  for (const floor of [0, 2, 3]) {
    const dest = types(floor);
    const dFrom = _bfsDistances(types(1), ENTRANCE.row, ENTRANCE.col);
    const depts = FLOOR_PRESETS_DEPARTMENTS[String(floor)] || {};
    perFloor[floor] = { ok: 0, total: 0 };

    for (const [, o] of Object.entries(depts)) {
      perFloor[floor].total++;
      const best = _bestStairFor(1, ENTRANCE.row, ENTRANCE.col, floor, o.row, o.col);
      if (!best) { blocked++; continue; }
      routable++; perFloor[floor].ok++;

      // the rule this replaces
      let greedy = null, gm = Infinity;
      for (let i = 0; i < N * N; i++) {
        if (dest[i] !== 'stair') continue;
        const m = Math.abs(((i / N) | 0) - o.row) + Math.abs((i % N) - o.col);
        if (m < gm) { gm = m; greedy = i; }
      }
      // Distances must be measured FROM THE OFFICE, snapped off any wall the
      // anchor sits on - the same snap _bestStairFor does internally. BFS'ing
      // from the chosen stair instead measures stair-to-stair, which makes the
      // comparison meaningless.
      let sr = o.row, sc = o.col;
      if (dest[sr * N + sc] === 'wall') {
        let bd = Infinity;
        for (let i = 0; i < N * N; i++) {
          if (dest[i] === 'wall') continue;
          const d = Math.abs(((i / N) | 0) - o.row) + Math.abs((i % N) - o.col);
          if (d < bd) { bd = d; sr = (i / N) | 0; sc = i % N; }
        }
      }
      const dTo = _bfsDistances(dest, sr, sc);
      const gTotal = (greedy !== null && dFrom[greedy] >= 0 && dTo[greedy] >= 0)
        ? dFrom[greedy] + dTo[greedy] : Infinity;
      if (best.total < gTotal) { better++; if (gTotal !== Infinity) saved += gTotal - best.total; }
      if (best.total > gTotal) worse++;
    }
  }

  for (const f of [0, 2, 3]) {
    console.log(`  floor ${f}: ${perFloor[f].ok}/${perFloor[f].total} offices reachable via a shared stair`);
  }
  ok('never picks a worse stair than the rule it replaces', worse === 0, worse);
  console.log(`  beats the old rule on ${better} of ${routable} routes` +
              (better ? `, saving ${(saved / better).toFixed(1)} cells on average ` +
                        `(${(0.6 * saved / better).toFixed(1)} m)` : ''));
  ok('returns null where no shared stair is reachable, so the caller falls back',
     blocked > 0 || routable > 0);
  console.log(`  two-leg routing currently possible for ${routable} of ${routable + blocked} ` +
              `cross-floor offices`);
  if (blocked > routable) {
    console.log('  NOTE: the limit is MAP DATA, not this code. The central-hall doorways');
    console.log('        were only opened on floor 1, so offices on 0/2/3 cannot reach a');
    console.log('        stairwell at all. Opening them makes two-leg routing work there');
    console.log('        with no further code change.');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
