/**
 * test_chips.js - the chat's starter chips (STARTERS in chat.js).
 *
 * They show until the live analytics holds at least three asked services, then
 * the five most-asked replace them. Chosen 2026-11-09 with Jace, after the
 * analytics were reset; each query was tried on the live assistant first:
 * the service ones resolve to one office with a "Go to:" line, and the
 * property-tax one names City Hall because the bare question asks
 * "in person or online?" first.
 *
 * Run: node tools/test_chips.js <repo-root>
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

const chat = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/chat.js'), 'utf8');
const m = chat.match(/const STARTERS = (\[[\s\S]*?\]);/);
const sb = {};
vm.createContext(sb);
const STARTERS = m ? vm.runInContext(m[1], sb) : [];
const F = require(path.resolve(ROOT, 'lib/office_finder.js'));

const WANT = [
  ['Birth certificate', 'How do I get a certified copy of my birth certificate?'],
  ['Cedula', 'How do I get a cedula (community tax certificate)?'],
  ['Real property tax', 'How do I pay my real property tax at City Hall?'],
  ["Mayor's clearance", "How do I get a Mayor's Clearance?"],
  ['Where is BPLO?', 'Where is BPLO?'],
];

console.log('\n--- the starter chips ---');
ok('there are exactly five', STARTERS.length === 5, STARTERS.length);
WANT.forEach(([label, query], i) => {
  const s = STARTERS[i] || {};
  ok(`chip ${i + 1} is "${label}"`, s.label === label && s.query === query, JSON.stringify(s));
});
ok('"Where is BPLO?" is answered by the office finder',
   (F.findOfficeQuestion('Where is BPLO?') || {}).office &&
   F.findOfficeQuestion('Where is BPLO?').office.dept === 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE');
ok('the four service chips go to the assistant, not the office finder',
   WANT.slice(0, 4).every(([, q]) => F.findOfficeQuestion(q) === null),
   WANT.slice(0, 4).filter(([, q]) => F.findOfficeQuestion(q)).map(([, q]) => q).join(' | '));
ok('no emoji in the chip labels', STARTERS.every((s) => !/\p{Extended_Pictographic}/u.test(s.label || '')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
