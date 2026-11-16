/**
 * test_spot_routing.js - routing, office sentences and the map drawing use
 * spots (Task 4 of the office-assignment plan).
 *
 * Runs the real data.js, spots.js and service_locations.js in one vm context,
 * the way index.html loads them, with the test filling STAMP_PLACEMENTS:
 *   - a migrated map (placements carry `kind`) routes through SPOTS.placesFor;
 *   - today's unmigrated stamp_presets.js still routes through DEPT_STAMP_NAMES;
 *   - desks block the walkway (buildAdjacency's extra blocked set);
 *   - the Public Assistance Center and COMELEC follow their otherKey spot.
 * Then checks app.js, renderer.js and index.html statically.
 *
 * Run: node tools/test_spot_routing.js <repo-root>
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
vm.runInContext(read('wayfinding-app/js/data.js'), sb);
vm.runInContext(read('wayfinding-app/js/spots.js'), sb);
vm.runInContext(read('wayfinding-app/js/stamp_presets.js'), sb);
vm.runInContext(read('wayfinding-app/js/service_locations.js') +
  '\n;this.resolve = resolveServiceLocation; this.status = serviceLocationStatus;' +
  'this.describe = describeOfficeLocation; this.HELP = OFFICE_HELP_DEPT;' +
  'this.ownDeskNote = typeof ownDeskNote === "function" ? ownDeskNote : null;' +
  'this.officeTitle = typeof _svcOfficeTitle === "function" ? _svcOfficeTitle : null;' +
  'this.buildAdjacency = buildAdjacency; this.BUNDLED = STAMP_PLACEMENTS_BUNDLED;' +
  // data.js owns STAMP_PLACEMENTS (a const array), so the test refills it in place.
  'this.setPlacements = (a) => { STAMP_PLACEMENTS.length = 0; STAMP_PLACEMENTS.push(...a); };' +
  'this.placements = () => STAMP_PLACEMENTS;', sb);

const OSCA = 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS';
const CSWD = 'CITY SOCIAL SERVICES OFFICE';
const CCRO = 'CITY CIVIL REGISTRY OFFICE';
const CTMO = 'CITY TREASURY MANAGEMENT OFFICE';
const BPLO = 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE';
const COMELEC = 'COMMISSION ON ELECTIONS';

const migrated = () => [
  { id: 's-cswd', name: 'GF 14 CSWD', floor: 1, row: 30, col: 10, size: 3,
    kind: 'office', dept: CSWD, services: [] },
  { id: 'd-osca', name: 'OSCA desk', floor: 1, row: 34, col: 11, size: 2,
    kind: 'desk', dept: OSCA, services: ['Senior Citizens ID'], deskBehind: false,
    confirmedAt: '2026-11-14T00:00:00Z' },
  { id: 's-ccro', name: 'GF 02a CCRO', floor: 1, row: 50, col: 20, size: 3,
    kind: 'office', dept: CCRO, services: ['Birth Certificate'] },
  { id: 's-ctmo', name: 'GF 05a CTMO', floor: 1, row: 40, col: 60, size: 3,
    kind: 'office', dept: CTMO, services: ['Real Property Tax'] },
  { id: 'd-ctmo', name: 'CTMO desk', floor: 1, row: 44, col: 60, size: 2,
    kind: 'desk', dept: CTMO, services: ['Cedula'], deskBehind: true,
    confirmedAt: '2026-11-14T00:00:00Z' },
  { id: 's-pac', name: 'MOPAC', floor: 1, row: 60, col: 40, size: 2,
    kind: 'other', otherKey: 'public-assistance' },
  { id: 's-comelec', name: 'LG 19 COA', floor: 0, row: 20, col: 20, size: 3,
    kind: 'other', otherKey: 'comelec' },
  { id: 's-empty', name: 'GF 30', floor: 1, row: 10, col: 10, size: 3 },
];

console.log('\n--- a migrated map routes to spots and desks ---');
sb.setPlacements(migrated());
let r = sb.resolve(OSCA, 'Senior Citizens ID');
ok('"Senior Citizens ID" for OSCA resolves to the OSCA desk cell',
   r && r.floor === 1 && r.row === 34 && r.col === 11, JSON.stringify(r));
ok('  as the desk spot, kind desk', r && r.spotId === 'd-osca' && r.kind === 'desk', JSON.stringify(r));
// Citizens read the office the desk stands in front of, in title case, never
// the stamp code (spec section 3; coordinator ruling, fix round 1).
ok('  with a deskPhrase "in front of" the nearest office, by its office name',
   r && r.deskPhrase === 'OSCA desk, in front of City Social Services Office', r && r.deskPhrase);
ok('  and no stamp code in it', r && !/GF 14|CSWD/.test(r.deskPhrase), r && r.deskPhrase);
{
  // The office title follows app.js _officeTitle exactly (app.js loads later,
  // so service_locations.js keeps its own copy).
  const src = read('wayfinding-app/js/app.js');
  const i = src.indexOf('function _officeTitle(');
  const ctx = {}; vm.createContext(ctx);
  const end = i < 0 ? -1 : src.slice(i).search(/\r?\n\}\r?\n/);
  vm.runInContext((i < 0 || end < 0 ? 'function _officeTitle(n) { return null; }' :
                   src.slice(i, i + end) + '\n}') + ';this.f = _officeTitle;', ctx);
  const names = [CSWD, OSCA, BPLO, 'PERSONS WITH DISABILITY AFFAIRS OFFICE', "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER",
                 'CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO', 'Already Mixed Case'];
  const diff = names.filter((n) => !sb.officeTitle || sb.officeTitle(n) !== ctx.f(n));
  ok('the front office is titled by the same rule as app.js _officeTitle', diff.length === 0, diff.join('; '));
}
ok('  and keeps today\'s shape (label, stampName)', r && r.label === OSCA && r.stampName === 'OSCA desk',
   JSON.stringify(r));
ok('serviceLocationStatus(OSCA) is mapped', sb.status(OSCA) === 'mapped', sb.status(OSCA));
ok('an office with no spot on a migrated map is unmapped (no stamp-name fallback)',
   sb.status(BPLO) === 'unmapped' && sb.resolve(BPLO).unmapped === true, sb.status(BPLO));
ok('the City College is still outside', sb.status('CITY COLLEGE OF CALAMBA') === 'outside');

r = sb.resolve(CCRO, 'Birth Certificate');
ok('an office spot resolves to it, kind office, no deskPhrase',
   r && r.spotId === 's-ccro' && r.kind === 'office' && !r.deskPhrase, JSON.stringify(r));
r = sb.resolve(CTMO, 'Cedula');
ok('a ticked own-office desk is the place for its service', r && r.spotId === 'd-ctmo' && r.kind === 'desk',
   JSON.stringify(r));
r = sb.resolve(CTMO, 'Real Property Tax');
ok('  other services still go to the office spot', r && r.spotId === 's-ctmo' && r.kind === 'office',
   JSON.stringify(r));

console.log('\n--- the own-desk note ---');
ok('ownDeskNote() exists', typeof sb.ownDeskNote === 'function');
if (sb.ownDeskNote) {
  ok('  English, word for word',
     sb.ownDeskNote(CTMO, 'City Treasury Management Office', 'en') ===
     'City Treasury Management Office also has a desk in the corridor in front of the office. You may be asked to line up there first.',
     sb.ownDeskNote(CTMO, 'City Treasury Management Office', 'en'));
  ok('  Filipino, word for word',
     sb.ownDeskNote(CTMO, 'City Treasury Management Office', 'fil') ===
     'May mesa rin ang City Treasury Management Office sa pasilyo sa harap ng opisina. Baka doon ka muna papipilahin.',
     sb.ownDeskNote(CTMO, 'City Treasury Management Office', 'fil'));
  ok('  none for an office without its own desk', !sb.ownDeskNote(CCRO, 'City Civil Registry Office', 'en'));
}

console.log('\n--- the Public Assistance Center and COMELEC move with their spot ---');
r = sb.resolve(sb.HELP);
ok('OFFICE_HELP_DEPT resolves through otherKey public-assistance', r && r.spotId === 's-pac', JSON.stringify(r));
sb.placements().find((p) => p.id === 's-pac').name = 'Help Desk';
r = sb.resolve(sb.HELP);
ok('  and still after it is renamed "Help Desk"',
   r && r.spotId === 's-pac' && r.stampName === 'Help Desk' && r.row === 60, JSON.stringify(r));
let d = sb.describe({ dept: sb.HELP, name: 'Public Assistance Center', abbr: null }, 'en');
ok('  and the office sentence still finds it', d.navDept === sb.HELP && /Ground Floor/.test(d.text), d.text);
r = sb.resolve(COMELEC);
ok('COMELEC resolves through otherKey comelec', r && r.spotId === 's-comelec' && r.floor === 0, JSON.stringify(r));
ok('  and is mapped', sb.status(COMELEC) === 'mapped');

console.log('\n--- office sentences use the desk wording ---');
d = sb.describe({ dept: OSCA, name: 'Office for the Senior Citizens Affairs', abbr: 'OSCA' }, 'en');
ok('OSCA in English names the desk and what it is in front of',
   /OSCA desk, in front of City Social Services Office/.test(d.text) && /Ground Floor/.test(d.text) &&
   !/GF 14/.test(d.text), d.text);
ok('  and routes to OSCA', d.navDept === OSCA, d.navDept);
d = sb.describe({ dept: OSCA, name: 'Office for the Senior Citizens Affairs', abbr: 'OSCA' }, 'fil');
ok('OSCA in Filipino keeps the sentence and inserts the desk',
   d.text.startsWith('Ang OSCA') && /ay nasa OSCA desk, in front of City Social Services Office/.test(d.text) &&
   /Ground Floor/.test(d.text), d.text);
d = sb.describe({ dept: CCRO, name: 'City Civil Registry Office', abbr: 'CCRO' }, 'en');
ok('an office spot keeps the position sentence',
   d.text.startsWith('CCRO (City Civil Registry Office) is on the Ground Floor') && !/in front of/.test(d.text), d.text);
d = sb.describe({ dept: BPLO, name: 'Business Permits', abbr: 'BPLO' }, 'en');
ok('an office with no spot says it is not on this map', d.place === 'unmapped', d.text);

console.log('\n--- Review Focus 1: an unmigrated map behaves as before ---');
sb.setPlacements(sb.BUNDLED.map((p) => Object.assign({}, p)));
ok('the bundled placements carry no kind', !sb.placements().some((p) => p.kind));
r = sb.resolve(CCRO);
ok('CCRO resolves to a GF 02 stamp', r && /^GF 02/.test(r.stampName) && r.floor === 1, JSON.stringify(r));
ok('  with no spot fields', r && r.spotId === undefined && r.kind === undefined && r.deskPhrase === undefined,
   JSON.stringify(r));
ok('BPLO is mapped, OSCA unmapped, as before',
   sb.status(BPLO) === 'mapped' && sb.status(OSCA) === 'unmapped');
r = sb.resolve(sb.HELP);
ok('the Public Assistance Center resolves to MOPAC', r && r.stampName === 'MOPAC', JSON.stringify(r));
if (sb.ownDeskNote) ok('no own-desk note on an unmigrated map', !sb.ownDeskNote(CTMO, 'City Treasury', 'en'));

console.log('\n--- C1: the editor cannot leave a partly migrated map ---');
let c1Done = Promise.resolve();
// The final review's simulation on the bundled map: assigning OSCA to GF 06, or
// adding one desk, before "Move them" made CCRO, CTMO and MOPAC unmapped. Here
// every editor path runs (on a small fake page) against the bundled map; none
// may give a placement a kind, so citizens keep today's routes.
{
  class El {
    constructor(tag, id) {
      this.tagName = String(tag).toUpperCase(); this.id = id || ''; this.children = []; this.parentNode = null;
      this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; this._t = '';
      this.attrs = {}; this.listeners = {}; this.style = {};
      this.classList = { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); } };
    }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._t = String(v); }
    set innerHTML(v) { this.children = []; this._t = ''; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    dispatch(t, ev) { (this.listeners[t] || []).forEach((fn) => fn(Object.assign({ type: t, target: this, preventDefault() {} }, ev || {}))); }
    click() { if (!this.disabled) this.dispatch('click'); }
    scrollIntoView() {} focus() {}
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0 }; }
  }
  const els = {};
  const store = () => ({ _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } });
  Object.assign(sb, {
    document: { readyState: 'complete', getElementById: (id) => (els[id] = els[id] || new El('div', id)),
                createElement: (t) => new El(t), addEventListener() {} },
    STATE: { currentFloor: 1, viewMode: 'admin', spotMode: false },
    REMOVED_REQUIREMENTS: {},
    sessionStorage: store(),
    confirm: () => true, alert: () => {},
    fetch: async (url) => ({ ok: true, json: async () => (/services\.json/.test(url)
      ? [{ department: OSCA, subservice: 'Senior Citizens ID', requirements: [] },
         { department: CTMO, subservice: 'Cedula', requirements: [] }] : {}) }),
  });
  vm.runInContext(read('wayfinding-app/js/charter_pick.js') + '\n' + read('wayfinding-app/js/spot_editor.js') + '\n' +
    read('wayfinding-app/js/desk_editor.js') + '\n;this.SE = SPOT_EDITOR; this.DE = DESK_EDITOR;', sb);
  const $ = (id) => sb.document.getElementById(id);
  sb.setPlacements(sb.BUNDLED.map((p) => Object.assign({}, p)));
  const depts = Object.keys(vm.runInContext('DEPT_STAMP_NAMES', sb));
  const statusBefore = depts.map((d) => d + '=' + sb.status(d)).join('; ');
  const snap = JSON.stringify(sb.placements());
  const gf06 = sb.placements().find((p) => p.name === 'GF 06');
  let empty = null;   // a walkable Ground Floor cell with no spot
  for (let r = 60; r < 75 && !empty; r++) for (let c = 30; c < 45 && !empty; c++) {
    const n = vm.runInContext(`NODE_MAP["${r},${c}"]`, sb);
    if (n && !n.wall && !vm.runInContext(`SPOTS.spotAt(STAMP_PLACEMENTS, 1, ${r}, ${c})`, sb)) empty = { r, c };
  }
  c1Done = (async () => {
    await sb.SE.loadCharter();
    sb.SE.toggleMode();                     // the Offices button
    ok('C1: the Offices button does not enter Offices mode on the bundled map', sb.STATE.spotMode === false);
    sb.STATE.spotMode = true;               // and even if Offices mode were on anyway
    sb.SE.onTap(gf06.row + 1, gf06.col + 1);
    $('ssOfficeInput').value = 'Office for the Senior Citizens Affairs';
    $('ssSaveBtn').click();
    sb.SE.openSheet(gf06.id);
    $('ssOfficeInput').value = 'Office for the Senior Citizens Affairs';
    $('ssSaveBtn').click();
    if (empty) {
      sb.SE.onTap(empty.r, empty.c);
      $('ssAddSpot').click();
      sb.SE.onTap(empty.r, empty.c);
      $('ssAddDesk').click();
      $('dsSaveBtn').click();
      sb.DE.openNew(empty.r, empty.c, 1);
      $('dsOtherBtn').click();
      $('dsOfficeInput').value = 'City Treasury Management Office';
      $('dsSaveBtn').click();
      $('dsWarnYes').click();
    }
    sb.SE.addDesk(empty ? empty.r : 70, empty ? empty.c : 37, { dept: CTMO, deskBehind: false, services: [] });
    sb.DE.addDesk(empty ? empty.r : 70, empty ? empty.c : 37, { dept: CTMO, deskBehind: false, services: [] });
    ok('C1: on the unmigrated bundled map every editor path leaves the placements as they were',
       JSON.stringify(sb.placements()) === snap && !sb.placements().some((p) => p.kind),
       sb.placements().filter((p) => p.kind).map((p) => p.name + ':' + p.kind).join(', '));
    const statusAfter = depts.map((d) => d + '=' + sb.status(d)).join('; ');
    ok('C1: ...so every office routes as before (CCRO, CTMO and MOPAC still mapped)',
       statusAfter === statusBefore && sb.status(CCRO) === 'mapped' && sb.status(CTMO) === 'mapped' && sb.status(sb.HELP) === 'mapped',
       statusAfter);
  })().catch((e) => ok('C1 run', false, e.stack));
}

console.log('\n--- desks block the walkway ---');
let adj = sb.buildAdjacency(new Set(['10,10']));
ok('a blocked node has no edges', adj['10,10'].length === 0, JSON.stringify(adj['10,10']));
const nbrs = ['9,10', '11,10', '10,9', '10,11'];
ok('  and no neighbour lists it', nbrs.every((n) => !adj[n].some((e) => e.to === '10,10')),
   JSON.stringify(nbrs.map((n) => adj[n])));
adj = sb.buildAdjacency();
ok('without the set, the node keeps its four edges', adj['10,10'].length === 4, adj['10,10'].length);

console.log('\n--- wired into the app, the renderer and the page ---');
const app = read('wayfinding-app/js/app.js');
const rend = read('wayfinding-app/js/renderer.js');
const html = read('wayfinding-app/index.html');
{
  const i = app.indexOf('function recompute()');
  // app.js has CRLF line ends: a function ends at the first "}" alone on a line.
  const fnEnd = (k) => { const e = app.slice(k).search(/\r?\n\}\r?\n/); return e < 0 ? k : k + e; };
  const body = i < 0 ? '' : app.slice(i, fnEnd(i));
  ok('recompute() passes the desk cells to buildAdjacency',
     /const blocked = new Set\(SPOTS\.deskCells\(STAMP_PLACEMENTS, STATE\.currentFloor\)\)/.test(body) &&
     /buildAdjacency\(blocked\)/.test(body));
  const j = app.indexOf('function _nearestReachableCell(');
  const reach = j < 0 ? '' : app.slice(j, fnEnd(j));
  ok('  and the end snaps beside a desk, not onto it',
     /SPOTS\.deskCells\(STAMP_PLACEMENTS, STATE\.currentFloor\)/.test(reach) && /desks\.has\(nid\)/.test(reach));
}
ok('app.js sets destSpotId', /destSpotId/.test(app));
ok('renderer.js reads destSpotId', /this\.destSpotId/.test(rend));
ok('renderer.js labels spots with SPOTS.labelStyle', /SPOTS\.labelStyle\(/.test(rend));
ok('navigateToDepartment shows the own-desk note', /ownDeskNote\(/.test(app));
// I1 (final review): a citizen routed by service to a desk reads the desk
// wording on the route messages and the arrival card, not just the office.
{
  const liftApp = (name) => {
    const i = app.indexOf(`function ${name}(`);
    if (i < 0) return `function ${name}() { return null; }`;
    let k = app.indexOf('{', i), depth = 0;
    for (; k < app.length; k++) {
      if (app[k] === '{') depth++;
      else if (app[k] === '}') { depth--; if (depth === 0) break; }
    }
    return app.slice(i, k + 1);
  };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(liftApp('_officeTitle') + '\n' + liftApp('_navDestName') + ';this.f = _navDestName;', ctx);
  const saved = sb.placements().map((p) => Object.assign({}, p));
  sb.setPlacements(migrated());
  const deskLoc = sb.resolve(OSCA, 'Senior Citizens ID');
  const officeLoc = sb.resolve(CCRO, 'Birth Certificate');
  // I3 (final review): a service added to another office's spot is routed to.
  sb.placements().find((p) => p.id === 's-ctmo').services.push('Birth Certificate');
  const nearCtmo = sb.resolve(CCRO, 'Birth Certificate', { floor: 1, row: 40, col: 63 });
  const nearCcro = sb.resolve(CCRO, 'Birth Certificate', { floor: 1, row: 50, col: 23 });
  sb.setPlacements(saved);   // the C1 run above uses the bundled map
  ok('I3: Birth Certificate added to the CTMO spot routes there for a citizen standing by it',
     nearCtmo && nearCtmo.spotId === 's-ctmo', JSON.stringify(nearCtmo));
  ok('I3: ...and to the CCRO spot for a citizen standing by that one', nearCcro && nearCcro.spotId === 's-ccro', JSON.stringify(nearCcro));
  ok('I1: a desk destination is named by its desk wording',
     ctx.f(deskLoc, OSCA) === 'OSCA desk, in front of City Social Services Office', ctx.f(deskLoc, OSCA));
  ok('I1: an office destination is still the office title',
     ctx.f(officeLoc, CCRO) === 'City Civil Registry Office', ctx.f(officeLoc, CCRO));
  const nav = liftApp('navigateToDepartment');
  ok('I1: navigateToDepartment names the route (and so the arrival card) with _navDestName',
     /_navDestLabel = _navDestName\(loc, deptName\)/.test(nav), nav.slice(0, 0));
  ok('I1: the second leg of a cross-floor trip says the same name',
     /label:\s*_navDestLabel/.test(nav));
}
const at = (f) => html.indexOf('js/' + f + '?v=');
ok('index.html loads spots.js?v=3 (bumped by the final review fixes)', /<script src="js\/spots\.js\?v=3"><\/script>/.test(html));
ok('  after stamp_presets.js and before service_locations.js',
   at('spots.js') > at('stamp_presets.js') && at('spots.js') < at('service_locations.js'));

c1Done.then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
