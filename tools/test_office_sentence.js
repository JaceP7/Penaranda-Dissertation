/**
 * test_office_sentence.js - describeOfficeLocation() in service_locations.js:
 * the sentence a citizen reads after "where is [office]?", written from the
 * live stamps, and the office the "Take me there" button routes to.
 *
 * Runs the real floor_presets.js, stamp_presets.js and service_locations.js in
 * one vm context, the way index.html loads them, and cross-checks chat.js and
 * index.html.
 *
 * Run: node tools/test_office_sentence.js <repo-root>
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

const sb = { console, localStorage: { getItem() { return null; }, setItem() {} }, window: {} };
vm.createContext(sb);
vm.runInContext(read('wayfinding-app/js/floor_presets.js'), sb);
vm.runInContext(read('wayfinding-app/js/stamp_presets.js') +
                '\n;var STAMP_PLACEMENTS = STAMP_PLACEMENTS_BUNDLED.slice();', sb);
vm.runInContext(read('wayfinding-app/js/service_locations.js') +
                '\n;this.describe = describeOfficeLocation; this.resolve = resolveServiceLocation;', sb);

const PAC = "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER";
const BPLO = { dept: 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE',
               name: 'Business Permits and Tricycle Franchising Office', abbr: 'BPLO' };

console.log('\n--- an office on the map ---');
let d = sb.describe(BPLO, 'en');
ok('BPLO in English names the floor first',
   d.text.startsWith('BPLO (Business Permits and Tricycle Franchising Office) is on the Ground Floor'), d.text);
ok('  says which side, from the main entrance', /right side/.test(d.text) && /main entrance/.test(d.text), d.text);
ok('  says how many windows', /2 windows/.test(d.text), d.text);
ok('  routes to BPLO, labelled by name',
   d.navDept === BPLO.dept && d.navLabel === BPLO.name, JSON.stringify([d.navDept, d.navLabel]));
d = sb.describe(BPLO, 'fil');
ok('BPLO in Filipino', d.text.startsWith('Ang BPLO') && /nasa Ground Floor/.test(d.text) && /kanan/.test(d.text),
   d.text);

d = sb.describe({ dept: 'CITY TREASURY MANAGEMENT OFFICE', name: 'City Treasury Management Office', abbr: null }, 'en');
ok('Treasury names both floors it has windows on',
   /Ground Floor/.test(d.text.replace(/Lower Ground Floor/g, '')) && /Lower Ground Floor/.test(d.text), d.text);
ok('  and starts with the name when no abbreviation was typed',
   d.text.startsWith('The City Treasury Management Office'), d.text);

d = sb.describe({ dept: 'CITY HEALTH SERVICES DEPARTMENT', name: 'City Health Services Department', abbr: null }, 'en');
ok('City Health says it is a floor down', /Lower Ground Floor/.test(d.text) &&
   /one floor below the main entrance/.test(d.text), d.text);
d = sb.describe({ dept: 'CITY HEALTH SERVICES DEPARTMENT', name: 'City Health Services Department', abbr: null }, 'fil');
ok('  and in Filipino', /isang palapag pababa/.test(d.text), d.text);

d = sb.describe({ dept: 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT',
                  name: 'City Engineering and Infrastructure Development Department', abbr: null }, 'en');
ok('City Engineering says it is a floor up', /2nd Floor/.test(d.text) && /one floor up/.test(d.text), d.text);

d = sb.describe({ dept: PAC, name: 'Public Assistance Center', abbr: null }, 'en');
ok('the Public Assistance Center is on the map itself',
   d.text.startsWith('The Public Assistance Center is on the Ground Floor') && d.navDept === PAC, d.text);
ok('  and the button routes there', sb.resolve(PAC) && sb.resolve(PAC).stampName === 'MOPAC' &&
   !sb.resolve(PAC).fallback, JSON.stringify(sb.resolve(PAC)));

console.log('\n--- an office not on the map yet ---');
d = sb.describe({ dept: 'PUBLIC ORDER AND SAFETY OFFICE', name: 'Public Order and Safety Office', abbr: 'POSO' }, 'en');
// 2026-11-09 (Jace, #5): no silent re-pointing to the help desk. The chat
// offers the Public Assistance Center and the nearest exit as buttons (place).
ok('POSO says so plainly', d.text.startsWith("POSO (Public Order and Safety Office) isn't on this map; it may be outside City Hall"), d.text);
ok('  and names the Public Assistance Center and the nearest exit', /Public Assistance Center/.test(d.text) &&
   /nearest exit/.test(d.text), d.text);
ok('  with no route of its own, marked unmapped for the chat buttons',
   d.navDept === null && d.place === 'unmapped', JSON.stringify([d.navDept, d.place]));
d = sb.describe({ dept: 'PUBLIC ORDER AND SAFETY OFFICE', name: 'Public Order and Safety Office', abbr: 'POSO' }, 'fil');
ok('  and in Filipino', d.text.startsWith('Wala sa mapang ito ang POSO'), d.text);

console.log('\n--- outside City Hall ---');
d = sb.describe({ dept: 'CITY COLLEGE OF CALAMBA', name: 'City College of Calamba', abbr: null }, 'en');
ok('the City College has its own campus', /own campus/.test(d.text) && /isn't inside City Hall/.test(d.text), d.text);
ok('  and no button', d.navDept === null && d.navLabel === null);

console.log('\n--- a republished map without the office ---');
sb.STAMP_PLACEMENTS = sb.STAMP_PLACEMENTS.filter((p) => !/BPATFO/.test(p.name));
d = sb.describe(BPLO, 'en');
ok('BPLO with its stamps removed gets the not-on-map sentence',
   /isn't on this map/.test(d.text) && d.place === 'unmapped', d.text);

console.log('\n--- wired into the chat and the page ---');
const chat = read('wayfinding-app/js/chat.js');
ok('chat.js describes location replies from the map', /describeOfficeLocation\(/.test(chat));
ok('chat.js labels the button with navLabel when there is one', /msg\.navLabel/.test(chat));
const html = read('wayfinding-app/index.html');
// At least the versions that shipped the office finder; later releases bump them further.
const ver = (f) => {
  const i = html.indexOf('js/' + f + '?v=');
  return i < 0 ? 0 : parseInt(html.slice(i + f.length + 6), 10) || 0;
};
ok('index.html loads service_locations.js v9 or later', ver('service_locations.js') >= 9, ver('service_locations.js'));
ok('index.html loads chat.js v41 or later', ver('chat.js') >= 41, ver('chat.js'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
