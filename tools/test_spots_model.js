/**
 * test_spots_model.js - the spot model (office assignment map editing, Task 2):
 * stamp migration, place lookup per service, desks, removed requirements.
 *
 * Run: node tools/test_spots_model.js <repo-root>
 */
'use strict';
const path = require('path');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const SPOTS = require(path.resolve(ROOT, 'wayfinding-app/js/spots.js'));

const CCRO = 'CITY CIVIL REGISTRY OFFICE';
const MOPAC = "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER";
const OSCA = 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS';
const CTMO = 'CITY TRAFFIC MANAGEMENT OFFICE';

const stamps = [
  { id: 1, name: 'GF 02a CCRO', row: 10, col: 10, size: 3, floor: 1, source: 'x' },
  { id: 2, name: 'GF 06', row: 20, col: 20, size: 2, floor: 1, source: 'x' },
  { id: 3, name: 'MOPAC', row: 30, col: 30, size: 2, floor: 1, source: 'x' },
  { id: 4, name: 'Ground Floor', row: 1, col: 1, size: 1, floor: 1, source: 'x' },
];
const names = { [CCRO]: ['GF 02a CCRO'], [MOPAC]: ['MOPAC'] };
const svc = { [CCRO]: ['Birth Certificate', 'Marriage License'] };

// ---- Migration
const frozen = JSON.parse(JSON.stringify(stamps));
const m = SPOTS.migrateStamps(stamps, names, svc);
ok('migrate does not mutate input', JSON.stringify(stamps) === JSON.stringify(frozen));
const byId = (id) => m.placements.find((p) => p.id === id);
ok('CCRO becomes an office', byId(1).kind === 'office' && byId(1).dept === CCRO);
ok('CCRO services = both names', JSON.stringify(byId(1).services) === JSON.stringify(svc[CCRO]));
ok('MOPAC becomes other/public-assistance', byId(3).kind === 'other' && byId(3).otherKey === 'public-assistance');
ok('GF 06 keeps no kind', byId(2).kind === undefined);
ok('GF 06 in checkThese as unnamed', m.checkThese.some((c) => c.id === 2 && c.reason === 'unnamed'));
ok('floor label becomes other', byId(4).kind === 'other');
const m2 = SPOTS.migrateStamps(m.placements, names, svc);
ok('second run is a no-op', JSON.stringify(m2.placements) === JSON.stringify(m.placements));
const two = SPOTS.migrateStamps([{ id: 9, name: 'X1', row: 0, col: 0, size: 1, floor: 1 }], { A: ['X1'], B: ['X1'] }, {});
ok('two departments -> two offices', two.placements[0].kind === undefined && two.checkThese[0].reason === 'two offices');
ok('isMigrated', SPOTS.isMigrated({ schema: 2 }) && !SPOTS.isMigrated({}) && !SPOTS.isMigrated({ schema: 1 }));
ok('FIXED_KEYS', SPOTS.FIXED_KEYS[MOPAC] === 'public-assistance' && SPOTS.FIXED_KEYS['COMMISSION ON ELECTIONS'] === 'comelec');

// ---- spotAt
const big = [{ id: 1, name: 'A', row: 10, col: 10, size: 3, floor: 1 }];
ok('spotAt inside', SPOTS.spotAt(big, 1, 12, 12) === big[0]);
ok('spotAt outside', SPOTS.spotAt(big, 1, 13, 10) === null);
ok('spotAt other floor', SPOTS.spotAt(big, 2, 10, 10) === null);

// ---- placesFor
const o1 = { id: 1, kind: 'office', dept: CCRO, services: [], row: 0, col: 0, size: 2, floor: 1 };
const o2 = { id: 2, kind: 'office', dept: CCRO, services: ['Birth Certificate'], row: 10, col: 0, size: 2, floor: 1 };
const osca = { id: 3, kind: 'desk', dept: OSCA, services: [], deskBehind: false, row: 5, col: 5, size: 1, floor: 1, confirmedAt: new Date().toISOString() };
const ctmo = { id: 4, kind: 'desk', dept: CTMO, services: ['Cedula'], deskBehind: true, row: 6, col: 6, size: 1, floor: 1 };
const ctmoOffice = { id: 5, kind: 'office', dept: CTMO, services: [], row: 40, col: 40, size: 2, floor: 1 };
const all = [o1, o2, osca, ctmo, ctmoOffice];
const ids = (a) => a.map((p) => p.id).sort().join(',');
ok('unassigned service -> both CCRO spots', ids(SPOTS.placesFor(all, CCRO, 'Marriage License')) === '1,2');
ok('assigned service -> only that spot', ids(SPOTS.placesFor(all, CCRO, 'Birth Certificate')) === '2');
ok('OSCA desk is a place', ids(SPOTS.placesFor(all, OSCA, 'Anything')) === '3');
ok('Cedula -> only the desk behind', ids(SPOTS.placesFor(all, CTMO, 'Cedula')) === '4');
ok('other CTMO service -> desk is not a place', ids(SPOTS.placesFor(all, CTMO, 'Permit')) === '5');

// I3 (final review): a service added to another office's spot is a place for it
// too, but only when the asked office has no spot (or own desk) listing it
// (I3 residual, 2026-11-17: the resolver picks the nearest, so order alone
// would let another office win).
{
  const cashier = { id: 6, kind: 'office', dept: CTMO, services: ['Birth Certificate'], row: 50, col: 50, size: 2, floor: 1 };
  const order = (a) => a.map((p) => p.id).join(',');
  ok('I3: the asked office\'s spots listing the service are the places; other offices\' spots listing it are not',
     order(SPOTS.placesFor([...all, cashier], CCRO, 'Birth Certificate')) === '2',
     order(SPOTS.placesFor([...all, cashier], CCRO, 'Birth Certificate')));
  const ccroDesk = { id: 9, kind: 'desk', dept: CCRO, services: [], deskBehind: false, row: 70, col: 70, size: 1, floor: 1 };
  ok('I3: ...with the asked office\'s own desks after them, still no other office',
     order(SPOTS.placesFor([...all, cashier, ccroDesk], CCRO, 'Birth Certificate')) === '2,9',
     order(SPOTS.placesFor([...all, cashier, ccroDesk], CCRO, 'Birth Certificate')));
  const onlyThere = { ...cashier, services: ['Marriage License'] };
  ok('I3: listed only by another office -> that office\'s spot, not every CCRO spot',
     order(SPOTS.placesFor([o1, o2, onlyThere], CCRO, 'Marriage License')) === '6',
     order(SPOTS.placesFor([o1, o2, onlyThere], CCRO, 'Marriage License')));
  ok('I3: listed by nobody -> all of the asked office\'s spots, as before',
     ids(SPOTS.placesFor([...all, cashier], CCRO, 'Death Certificate')) === '1,2');
  const ccroCedula = { id: 7, kind: 'office', dept: CCRO, services: ['Cedula'], row: 60, col: 60, size: 2, floor: 1 };
  ok('I3: an own desk ticked for the service still stands in for the own office; other offices\' spots are not places',
     order(SPOTS.placesFor([...all, ccroCedula], CTMO, 'Cedula')) === '4',
     order(SPOTS.placesFor([...all, ccroCedula], CTMO, 'Cedula')));
  ok('I3: the asked office\'s own desks come before other offices\' spots',
     order(SPOTS.placesFor([...all, { ...cashier, dept: CCRO, id: 8, services: ['Anything'] }], OSCA, 'Anything')) === '3,8',
     order(SPOTS.placesFor([...all, { ...cashier, dept: CCRO, id: 8, services: ['Anything'] }], OSCA, 'Anything')));
}

// ---- desks
ok('deskCells', SPOTS.deskCells(all, 1).sort().join('|') === '5,5|6,6');
ok('deskCells other floor', SPOTS.deskCells(all, 2).length === 0);
ok('frontOf nearest office', SPOTS.frontOf(all, osca).id === 1);
ok('frontOf none -> null', SPOTS.frontOf([osca], osca) === null);
ok('unplacedOffices', JSON.stringify(SPOTS.unplacedOffices([o1, ctmoOffice], [CCRO, CTMO, OSCA])) === JSON.stringify([OSCA]));
ok('desk counts as placed', SPOTS.unplacedOffices(all, [OSCA]).length === 0);

// ---- staleDesks
const now = Date.now();
const day = 86400000;
const old = { id: 7, kind: 'desk', dept: OSCA, confirmedAt: new Date(now - 31 * day).toISOString() };
const fresh = { id: 8, kind: 'desk', dept: OSCA, confirmedAt: new Date(now - 29 * day).toISOString() };
const none = { id: 9, kind: 'desk', dept: OSCA };
const st = SPOTS.staleDesks([old, fresh, none, o1], now).map((p) => p.id);
ok('31 days stale, 29 not', st.includes(7) && !st.includes(8));
ok('no confirmedAt is stale', st.includes(9));
ok('offices never stale', !st.includes(1));

// ---- requirementsFor
const removed = { 'Voters Cert|COMELEC': ["2. Voter's Certification"] };
const rm = ["2. Voter's Certification"];
const reqs = ['1. Form', "2. Voter's Certification"];
ok('removed requirement hidden', JSON.stringify(SPOTS.requirementsFor(removed, 'Voters Cert', 'COMELEC', reqs.slice())) === JSON.stringify(['1. Form']));
ok('numbering, case, spacing, curly apostrophe ignored',
  SPOTS.requirementsFor({ 'S|D': ['2)  voter\u2019s   CERTIFICATION'] }, 'S', 'D', reqs).length === 1);
ok('reworded requirement NOT hidden',
  SPOTS.requirementsFor({ 'S|D': rm }, 'S', 'D', ["2. Voter's Certificate (photocopy)"]).length === 1);
ok('no removal entry -> unchanged', SPOTS.requirementsFor({}, 'S', 'D', reqs).length === 2);
ok('undefined removed ok', SPOTS.requirementsFor(undefined, 'S', 'D', reqs).length === 2);

// ---- labelStyle
ok('label empty', SPOTS.labelStyle({ name: 'GF 06' }).text === 'No office yet' && SPOTS.labelStyle({ name: 'GF 06' }).look === 'empty');
ok('label office', SPOTS.labelStyle(o1).look === 'office' && SPOTS.labelStyle(o1).text === CCRO);
ok('label other', SPOTS.labelStyle({ kind: 'other', name: 'Lobby' }).look === 'other');
ok('label desk', SPOTS.labelStyle(osca).look === 'desk');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
