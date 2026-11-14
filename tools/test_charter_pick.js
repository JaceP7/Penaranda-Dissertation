/**
 * test_charter_pick.js - Charter-only type-ahead (office assignment map editing, Task 3).
 *
 * Run: node tools/test_charter_pick.js <repo-root>
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const CP = require(path.resolve(ROOT, 'wayfinding-app/js/charter_pick.js'));
const services = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/data/services.json'), 'utf8'));
const glossary = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/data/service_glossary.json'), 'utf8'));
const idx = CP.buildIndex(services, glossary);

const OSCA = 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS';
const SCID = 'Senior Citizens ID|' + OSCA;

ok('fold strips accents', CP.fold('Bañadero') === 'banadero');
ok('fold collapses punctuation', CP.fold("  Mayor's  Office/ID ") === 'mayor s office id');

const off = CP.suggest(idx, 'office', 'sen');
ok('office "sen" first is OSCA', off.length && off[0].value === OSCA, JSON.stringify(off[0]));
ok('office label = value', off[0].label === off[0].value);

const own = CP.suggest(idx, 'service', 'phil', { dept: OSCA });
ok('service "phil" own first', own.length && own[0].own === true && /PhilHealth/.test(own[0].value), JSON.stringify(own[0]));
ok('service without dept has no own', CP.suggest(idx, 'service', 'phil').every((s) => s.own === false));

const cctv = CP.suggest(idx, 'service', 'cctv');
ok('glossary terms match', cctv.some((s) => s.value === 'Request to View or Get a Copy of CCTV Footage'), JSON.stringify(cctv));

ok('limit respected', CP.suggest(idx, 'service', 'a', {}, 3).length <= 3);
ok('empty text returns []', CP.suggest(idx, 'requirement', '', { serviceKey: SCID }).length === 0);
ok('all query words must match', CP.suggest(idx, 'office', 'senior zzzz').length === 0);

const reqs = CP.suggest(idx, 'requirement', 'a', { serviceKey: SCID }, 50);
const ownReqs = services.find((s) => s.subservice === 'Senior Citizens ID').requirements.map((r) => r.requirement);
ok('requirements: own first', reqs.length && reqs[0].own === true && ownReqs.includes(reqs[0].value), JSON.stringify(reqs[0]));
ok('requirements: own flag only on own', reqs.filter((r) => r.own).every((r) => ownReqs.includes(r.value)));
ok('requirements: others follow', reqs.some((r) => !r.own));

ok('requirement not in Charter', CP.isCharterItem(idx, 'requirement', 'barangay cert', { serviceKey: SCID }) === false);
ok('closest gives something', CP.closest(idx, 'requirement', 'barangay cert', { serviceKey: SCID }).length >= 1);
ok('closest items have value+label', CP.closest(idx, 'requirement', 'barangay cert', { serviceKey: SCID }).every((c) => c.value && c.label));
ok('real requirement is Charter item', CP.isCharterItem(idx, 'requirement', ownReqs[0], { serviceKey: SCID }) === true);
ok('office case-insensitive', CP.isCharterItem(idx, 'office', 'Office for the Senior Citizens Affairs') === true);
ok('office not in Charter', CP.isCharterItem(idx, 'office', 'Department of Magic') === false);
ok('service in Charter', CP.isCharterItem(idx, 'service', 'senior citizens id', { dept: OSCA }) === true);
ok('service at wrong office is not', CP.isCharterItem(idx, 'service', 'senior citizens id', { dept: 'CITY CIVIL REGISTRY OFFICE' }) === false);

const dupSvc = idx.servicesByDept[OSCA].filter((s) => s.value === 'Request for Certificate (Cancellation / Verification / Late Birth Registration / No Record)');
ok('duplicate subservice at one office counted once', dupSvc.length === 1);

ok('NO_MATCH exact', CP.NO_MATCH === "Not in the Charter. Only items in the Citizen's Charter can be added. If the office now asks for this, the Charter has to be updated first.");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
