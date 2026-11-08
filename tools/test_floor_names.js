/**
 * test_floor_names.js - floors are called by their names everywhere a person
 * reads them (Lower Ground Floor, Ground Floor, 2nd Floor, 3rd Floor), never
 * "Floor 1-4".
 *
 * "Floor 2" meant the Ground Floor after floors 0/1 were swapped, and the QR
 * generator's own hint still said "1 = ground floor", which was wrong.
 *
 * Checks the shared helper floorName() in data.js, then scans every file that
 * builds visible text for a numbered floor label.
 *
 * Run: node tools/test_floor_names.js <repo-root>
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

console.log('\n--- floorName() in data.js ---');
const dataSrc = read('wayfinding-app/js/data.js');
const bare = { console };
vm.createContext(bare);
vm.runInContext(lift(dataSrc, 'floorName') + '\n;this.floorName = floorName;', bare);
const want = ['Lower Ground Floor', 'Ground Floor', '2nd Floor', '3rd Floor'];
want.forEach((n, f) => ok(`floor ${f} is "${n}" without FLOOR_NAMES loaded`, bare.floorName(f) === n, bare.floorName(f)));
ok('a floor added above the 3rd is the "4th Floor"', bare.floorName(4) === '4th Floor', bare.floorName(4));
ok('and the top allowed one the "9th Floor"', bare.floorName(9) === '9th Floor', bare.floorName(9));
ok('a string index works too', bare.floorName('1') === 'Ground Floor');

const withNames = { console, FLOOR_NAMES: { 0: 'Lower Ground Floor', 1: 'Main Lobby' } };
vm.createContext(withNames);
vm.runInContext(lift(dataSrc, 'floorName') + '\n;this.floorName = floorName;', withNames);
ok('a deployed rename in FLOOR_NAMES wins', withNames.floorName(1) === 'Main Lobby', withNames.floorName(1));
ok('  and floors it does not name fall back to the built-in names', withNames.floorName(2) === '2nd Floor');

console.log('\n--- no numbered floor labels left in what people read ---');
// A template literal that prints "Floor ${...}" is how every numbered label
// was built ("Floor ${f + 1}", "Floor ${fDisp}").
const NUMBERED = /`[^`]*\bFloor \$\{/;
for (const f of ['wayfinding-app/js/app.js', 'wayfinding-app/js/renderer.js',
                 'wayfinding-app/js/service_locations.js', 'wayfinding-app/js/nav.js',
                 'wayfinding-app/js/chat.js']) {
  const lines = read(f).split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => NUMBERED.test(l) && !/^\s*(\/\/|\*)/.test(l));
  ok(`${path.basename(f)} builds no "Floor <number>" text`, lines.length === 0,
     lines.map(([n, l]) => `${n}: ${l.trim()}`).join(' | '));
}

const html = read('wayfinding-app/index.html');
ok('the floor indicator starts as "Ground Floor"', /id="floorDisplay"[^>]*>Ground Floor</.test(html));
const manual = (html.match(/<select id="manualLocFloor">([\s\S]*?)<\/select>/) || [])[1] || '';
const manualOpts = [...manual.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1].trim());
ok('manual location lists the four floors by name only',
   manualOpts.join('|') === want.join('|'), manualOpts.join('|'));
ok('  with the Ground Floor preselected', /<option value="2" selected>Ground Floor<\/option>/.test(manual));
ok('the QR generator picks a floor by name, not a number box',
   /<select id="qrGenFloorInput"/.test(html) && !/id="qrGenFloorInput" type="number"/.test(html));
ok('the wrong "1 = ground floor" hint is gone', !/1 = ground floor/i.test(html));

const app = read('wayfinding-app/js/app.js');
ok('app.js labels floors through floorName()', /floorName\(/.test(app));
ok('the QR generator fills its floor list with names', /qrGenFloorInput[\s\S]{0,400}floorName\(|_fillFloorSelect\(/.test(app));

const sign = read('tools/make_qr_anchors.py');
ok('printed QR signs do not say "Floor N"', !/Floor \{floor \+ 1\}/.test(sign));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
