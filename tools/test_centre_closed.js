/**
 * test_centre_closed.js - routes go around the building, never through the
 * centre (Jace, 2026-11-09: "no passing through the center, only go about the
 * city hall via the circular paths and the stairs").
 *
 * Every floor's centre is the same open octagon (rows 14-60, cols 14-61). Before
 * the fix a door at down 13, across 33 opened into it on all four floors, and
 * the Ground Floor had a second at down 60, across 27, so 19 Ground Floor routes
 * were shortest straight across it. This checks, on the bundled map:
 *   - nothing walkable outside the centre touches it any more;
 *   - every office is still reachable from every other office on its floor,
 *     and from the main entrance (73,37) on the Ground Floor;
 *   - the version was bumped, so phones holding the old map re-apply it.
 *
 * Run: node tools/test_centre_closed.js <repo-root>
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
const ctx = { console, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
for (const f of ['js/data.js', 'js/floor_presets.js', 'js/stamp_presets.js']) {
  vm.runInContext(fs.readFileSync(path.resolve(ROOT, 'wayfinding-app', f), 'utf8'), ctx, { filename: f });
}
const { floors, stamps, version } = vm.runInContext(
  '({ floors: FLOOR_PRESETS, stamps: STAMP_PLACEMENTS_BUNDLED, version: FLOOR_PRESETS_VERSION })', ctx);
const N = 75;
const walk = (g, k) => g[k] !== 'wall';
const nbrs = (k) => {
  const r = Math.floor(k / N), c = k % N, out = [];
  if (r > 0) out.push(k - N); if (r < N - 1) out.push(k + N);
  if (c > 0) out.push(k - 1); if (c < N - 1) out.push(k + 1);
  return out;
};
function reach(g, src) {
  const seen = new Uint8Array(N * N); const q = [src]; seen[src] = 1;
  while (q.length) { const k = q.shift(); for (const n of nbrs(k)) if (!seen[n] && walk(g, n)) { seen[n] = 1; q.push(n); } }
  return seen;
}
function centre(g) {   // the open octagon around (30,37), open cells only
  const s = 30 * N + 37, seen = new Set([s]), q = [s];
  while (q.length) { const k = q.shift(); for (const n of nbrs(k)) if (!seen.has(n) && g[n] === 'open') { seen.add(n); q.push(n); } }
  return seen;
}

ok('FLOOR_PRESETS_VERSION bumped to 11 or later', version >= 11, version);
for (let f = 0; f < 4; f++) {
  const g = floors[f];
  const cen = centre(g);
  ok(`floor ${f}: the centre is the big octagon (${cen.size} cells)`, cen.size > 1500, cen.size);
  const gate = [];
  for (const k of cen) for (const n of nbrs(k)) if (!cen.has(n) && walk(g, n)) gate.push(`${Math.floor(n / N)},${n % N} (${g[n]})`);
  ok(`floor ${f}: no door or walkway leads into the centre`, gate.length === 0, gate.join(' '));
  const stair = g.findIndex((t) => t === 'stair');
  const from = reach(g, stair);
  const offices = stamps.filter((p) => p.floor === f && p.name && !/Floor$/.test(p.name));
  const lost = offices.filter((p) => {
    for (let i = -1; i <= p.size; i++) for (let j = -1; j <= p.size; j++) {
      const r = p.row + i, c = p.col + j;
      if (r >= 0 && r < N && c >= 0 && c < N && from[r * N + c]) return false;
    }
    return true;
  }).map((p) => p.name);
  ok(`floor ${f}: all ${offices.length} offices still reachable from the stairs`, lost.length === 0, lost.join(', '));
  if (f === 1) {
    const ent = reach(g, 73 * N + 37);
    ok('Ground Floor: the main entrance still reaches the stairs', !!ent[stair]);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
