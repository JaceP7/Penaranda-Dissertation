/**
 * test_map_state_v2.js - map state schema 2: the published payload, the change
 * summary for office spots and desks, the server round trip, the Offices panel
 * markup and the SPOT_EDITOR migration.
 *
 * Run: node tools/test_map_state_v2.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));

const appSrc = read('wayfinding-app/js/app.js');
function lift(name) {
  const i = appSrc.indexOf(`function ${name}(`);
  if (i < 0) return `function ${name}() { throw new Error('${name} missing from app.js'); }`;
  let j = appSrc.indexOf('{', i), depth = 0, k = j;
  for (; k < appSrc.length; k++) {
    if (appSrc[k] === '{') depth++;
    else if (appSrc[k] === '}') { depth--; if (depth === 0) break; }
  }
  return appSrc.slice(i, k + 1);
}
const spotsSrc = read('wayfinding-app/js/spots.js');
const charterSrc = read('wayfinding-app/js/charter_pick.js');

const OSCA = 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS';
const CSSO = 'CITY SOCIAL SERVICES OFFICE';

// ── 1. payload ───────────────────────────────────────────────────────────────
console.log('\n--- _buildStatePayload ---');
function payloadBox(placements, removed) {
  const box = {
    FLOOR_WALLS: { 0: ['open'], 1: ['open'] },
    NODES: [{ cellType: 'wall' }],
    STATE: { currentFloor: 1 },
    STAMP_PLACEMENTS: placements,
    STAMP_PRESETS: [],
    _floorNames: { 1: 'Ground' },
    REMOVED_REQUIREMENTS: removed,
  };
  vm.createContext(box);
  vm.runInContext(lift('_buildStatePayload') + '\n' + lift('_mapFingerprint') +
    '\n;this.API = { _buildStatePayload, _mapFingerprint };', box);
  return box.API;
}
const migrated = [
  { id: 's14', name: 'GF 14', row: 10, col: 10, size: 3, floor: 1, kind: 'office', dept: OSCA, services: ['Senior Citizens ID'] },
  { id: 's15', name: 'GF 15', row: 20, col: 20, size: 3, floor: 1 },
];
const removedReqs = { [`Senior Citizens ID|${OSCA}`]: ['Barangay certificate'] };
{
  const api = payloadBox(migrated, removedReqs);
  const p = api._buildStatePayload();
  ok('migrated payload has schema 2', p.schema === 2, JSON.stringify(Object.keys(p)));
  ok('migrated payload carries removedRequirements',
     JSON.stringify(p.removedRequirements) === JSON.stringify(removedReqs));
  ok('payload keeps grid, placements, presets and floor names',
     !!p.grid && p.stampPlacements.length === 2 && Array.isArray(p.stampPresets) && p.floorNames[1] === 'Ground');
}
{
  const legacy = [{ id: 's14', name: 'GF 14', row: 10, col: 10, size: 3, floor: 1 }];
  const api = payloadBox(legacy, {});
  const p = api._buildStatePayload();
  ok('unmigrated payload has no schema', !('schema' in p), JSON.stringify(Object.keys(p)));
  ok('unmigrated payload still carries removedRequirements as {}',
     p.removedRequirements && typeof p.removedRequirements === 'object' &&
     Object.keys(p.removedRequirements).length === 0);
  const old = { grid: p.grid, stampPlacements: p.stampPlacements, stampPresets: p.stampPresets, floorNames: p.floorNames };
  ok('empty removedRequirements fingerprints like a pre-schema-2 payload (no false "unpublished changes")',
     api._mapFingerprint(p) === api._mapFingerprint(old));
  const withReq = Object.assign({}, p, { removedRequirements: removedReqs });
  ok('a non-empty removedRequirements changes the fingerprint',
     api._mapFingerprint(withReq) !== api._mapFingerprint(old));
}

// ── 2. diff + summary ────────────────────────────────────────────────────────
console.log('\n--- _diffMapStates / _describeDiff ---');
const diffBox = { _floorName: (f) => `Floor ${f}`, console };
vm.createContext(diffBox);
vm.runInContext(spotsSrc + '\n;this.SPOTS = SPOTS;', diffBox);
vm.runInContext(
  ['_diffMapStates', '_describeDiff', 'DEPT_CODE', '_officeTitle', '_floorShort'].map(lift).join('\n') +
  '\n;this.API = { _diffMapStates, _describeDiff, _floorShort };', diffBox);
const { _diffMapStates, _describeDiff, _floorShort } = diffBox.API;

ok('floor short codes LG / GF / 2F / 3F',
   [0, 1, 2, 3].map(_floorShort).join(',') === 'LG,GF,2F,3F');

const live = {
  grid: { floorWalls: { 1: ['open', 'open'] } },
  stampPlacements: [
    { id: 's14', name: 'GF 14', row: 10, col: 10, size: 3, floor: 1 },
    { id: 'cs', name: 'GF 20 CSSD', row: 30, col: 30, size: 4, floor: 1, kind: 'office', dept: CSSO, services: ['A'] },
    { id: 'old', name: 'Old desk', row: 40, col: 40, size: 2, floor: 1, kind: 'desk', dept: OSCA, services: [],
      deskBehind: false, confirmedAt: '2026-01-01T00:00:00.000Z' },
  ],
  floorNames: {},
};
const mine = clone(live);
mine.stampPlacements[0] = Object.assign({}, mine.stampPlacements[0],
  { kind: 'office', dept: OSCA, services: ['Senior Citizens ID'] });
mine.stampPlacements.push({ id: 'd1', name: 'OSCA desk', row: 35, col: 30, size: 2, floor: 1, kind: 'desk',
  dept: OSCA, services: [], deskBehind: false, confirmedAt: '2026-11-14T00:00:00.000Z' });
mine.stampPlacements = mine.stampPlacements.filter((p) => p.id !== 'old');
mine.schema = 2;
mine.removedRequirements = { [`Senior Citizens ID|${OSCA}`]: ['Barangay certificate'] };

let d = _diffMapStates(mine, live);
ok('officesAssigned counts the OSCA spot', d.officesAssigned === 1, JSON.stringify(d));
ok('desksAdded counts the new desk', d.desksAdded === 1);
ok('desksRemoved counts the dropped desk', d.desksRemoved === 1);
ok('requirementsChanged counts one removed text', d.requirementsChanged === 1);
ok('desks are not counted as rooms added or removed', d.stampsAdded === 0 && d.stampsRemoved === 0,
   `added ${d.stampsAdded} removed ${d.stampsRemoved}`);
let text = _describeDiff(d);
ok('summary: "OSCA assigned to GF spot GF 14"', text.includes('OSCA assigned to GF spot GF 14'), text);
ok('summary: "Desk added in front of City Social Services Office (OSCA)"',
   text.includes('Desk added in front of City Social Services Office (OSCA)'), text);
ok('summary: "Senior Citizens ID: 1 requirement removed"',
   text.includes('Senior Citizens ID: 1 requirement removed'), text);
ok('summary mentions the removed desk', /Desk .*removed.*\(OSCA\)/.test(text), text);

const two = clone(mine);
two.removedRequirements[`Senior Citizens ID|${OSCA}`].push('Valid ID');
ok('summary pluralises requirements',
   _describeDiff(_diffMapStates(two, live)).includes('Senior Citizens ID: 2 requirements removed'));

// Services edited on an office that was already assigned: still a change.
const svc = clone(live);
svc.stampPlacements[1].services = ['A', 'B'];
d = _diffMapStates(svc, live);
ok('a services edit on an assigned spot is counted (publish is not "nothing to publish")',
   d.spotsChanged === 1 && d.officesAssigned === 0, JSON.stringify(d));

// Confirming a desk is a change too.
const conf = clone(live);
conf.stampPlacements[2].confirmedAt = '2026-11-15T00:00:00.000Z';
ok('a desk confirmation is counted', _diffMapStates(conf, live).spotsChanged === 1);

// Putting a requirement back is a change.
const back = clone(live); back.removedRequirements = {};
const liveReq = clone(live); liveReq.removedRequirements = { [`Senior Citizens ID|${OSCA}`]: ['Valid ID'] };
d = _diffMapStates(back, liveReq);
ok('a requirement put back is counted', d.requirementsRestored === 1, JSON.stringify(d));

ok('identical spot states diff to nothing new', (() => {
  const z = _diffMapStates(clone(mine), mine);
  return !z.officesAssigned && !z.desksAdded && !z.desksRemoved && !z.requirementsChanged &&
         !z.requirementsRestored && !z.spotsChanged && /no differences/.test(_describeDiff(z));
})());
ok('old-style states (no kinds) still diff to nothing new', (() => {
  const a = { stampPlacements: [{ id: 'a', name: 'x', row: 1, col: 1, floor: 0 }] };
  const z = _diffMapStates(clone(a), a);
  return !z.officesAssigned && !z.desksAdded && !z.requirementsChanged && !z.spotsChanged;
})());

// A full migration lists many offices; the summary stays readable.
const many = { stampPlacements: [] }, manyLive = { stampPlacements: [] };
for (let i = 0; i < 30; i++) {
  manyLive.stampPlacements.push({ id: 'm' + i, name: 'GF ' + i, row: i, col: 0, floor: 1 });
  many.stampPlacements.push({ id: 'm' + i, name: 'GF ' + i, row: i, col: 0, floor: 1, kind: 'office', dept: OSCA, services: [] });
}
text = _describeDiff(_diffMapStates(many, manyLive));
ok('a long list is cut short with "and N more"', /and 20 more/.test(text) && text.split('\n').length < 20, text);

// The publish flow must not call a spot-only change "Nothing to publish".
const pubFn = lift('publishMapToCloud');
ok('publish "nothing to publish" check looks at the spot counters',
   /officesAssigned/.test(pubFn) && /spotsChanged/.test(pubFn) && /requirementsChanged/.test(pubFn) &&
   /desksAdded/.test(pubFn) && /desksRemoved/.test(pubFn) && /requirementsRestored/.test(pubFn));

// ── 3. apply restores removedRequirements ────────────────────────────────────
console.log('\n--- _applyCloudState / _applyStatePayload ---');
function applyBox() {
  const ls = {};
  const box = {
    FLOOR_WALLS: {}, NODES: [], STATE: { currentFloor: 0 }, NAV: {}, renderer: null, DOM: {},
    STAMP_PLACEMENTS: [], STAMP_PRESETS: [], _floorNames: {}, FLOOR_NAMES_LS_KEY: 'fn',
    REMOVED_REQUIREMENTS: { stale: ['x'] },
    localStorage: { setItem: (k, v) => { ls[k] = v; }, getItem: (k) => ls[k] || null },
    renderCatalogue: () => {}, _syncFloorDisplay: () => {}, _floorLabel: () => '', console, ls,
  };
  vm.createContext(box);
  vm.runInContext(lift('_applyCloudState') + '\n' + lift('_applyStatePayload') +
    '\n;this.API = { _applyCloudState, _applyStatePayload };', box);
  return box;
}
{
  const box = applyBox();
  box.API._applyCloudState({ stampPlacements: migrated, schema: 2, removedRequirements: removedReqs });
  ok('_applyCloudState restores removedRequirements',
     JSON.stringify(box.REMOVED_REQUIREMENTS) === JSON.stringify(removedReqs), JSON.stringify(box.REMOVED_REQUIREMENTS));
  ok('_applyCloudState persists it to wf-removed-requirements',
     box.ls['wf-removed-requirements'] === JSON.stringify(removedReqs));
  const box2 = applyBox();
  box2.API._applyCloudState({ stampPlacements: [] });
  ok('_applyCloudState resets it to {} when the state has none (a pre-schema-2 version)',
     JSON.stringify(box2.REMOVED_REQUIREMENTS) === '{}', JSON.stringify(box2.REMOVED_REQUIREMENTS));
  ok('_applyCloudState persists the reset', box2.ls['wf-removed-requirements'] === '{}');
  // An unmigrated device that applies an old published map still fingerprints
  // like a pre-schema-2 build, so it does not read as having unpublished edits.
  const box4 = applyBox();
  vm.runInContext(lift('_buildStatePayload') + '\n' + lift('_mapFingerprint') +
    '\n;this.API2 = { _buildStatePayload, _mapFingerprint };', box4);
  const legacyState = { grid: { floorWalls: { 0: [] }, currentFloor: 0 },
    stampPlacements: [{ id: 'x', name: 'GF 01', row: 1, col: 1, size: 2, floor: 1 }], stampPresets: [], floorNames: {} };
  box4.API._applyCloudState(legacyState);
  const after = box4.API2._buildStatePayload();
  const preV2 = { grid: after.grid, stampPlacements: after.stampPlacements, stampPresets: after.stampPresets, floorNames: after.floorNames };
  ok('an unmigrated device stays clean after applying an old version',
     !('schema' in after) && box4.API2._mapFingerprint(after) === box4.API2._mapFingerprint(preV2));
  const box3 = applyBox();
  box3.API._applyStatePayload({ stampPlacements: migrated, removedRequirements: removedReqs });
  ok('_applyStatePayload restores removedRequirements',
     JSON.stringify(box3.REMOVED_REQUIREMENTS) === JSON.stringify(removedReqs));
}
ok('REMOVED_REQUIREMENTS is declared in app.js and read from wf-removed-requirements',
   /let REMOVED_REQUIREMENTS\b/.test(appSrc) && /'wf-removed-requirements'/.test(appSrc));

// ── 4. markup ────────────────────────────────────────────────────────────────
console.log('\n--- index.html ---');
const html = read('wayfinding-app/index.html');
const BANNER = 'This map still uses the old office markers. Move them to office spots now? Nothing changes for citizens until you publish.';
ok('index.html has id="officesPanel"', html.includes('id="officesPanel"'));
ok('index.html has id="dockOffices" labelled Offices',
   /<button id="dockOffices"[^>]*>[\s\S]*?<span class="dock-lbl">Offices<\/span>/.test(html));
ok('index.html has the exact banner text', html.includes(BANNER));
ok('banner buttons "Move them" and "Not now"', />Move them</.test(html) && />Not now</.test(html));
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2300}-\u{23FF}]/u;
const block = (id) => {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return '';
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf(`<!-- /${id} -->`, i);
  return end < 0 ? '' : html.slice(start, end);
};
const panelMarkup = block('officesPanel');
const bannerMarkup = block('spotMigrationBanner');
ok('panel markup found (ends at <!-- /officesPanel -->)', panelMarkup.length > 0);
ok('banner markup found (ends at <!-- /spotMigrationBanner -->)', bannerMarkup.length > 0);
ok('panel and banner markup have no emoji', !EMOJI.test(panelMarkup + bannerMarkup));
const idx = (s) => html.indexOf(s);
ok('charter_pick.js loads before spot_editor.js, both after app.js',
   idx('js/charter_pick.js?v=') > idx('js/app.js?v=') && idx('js/spot_editor.js?v=') > idx('js/charter_pick.js?v='));
ok('app.js version bumped past 93', (() => { const m = /js\/app\.js\?v=(\d+)/.exec(html); return m && +m[1] > 93; })());
ok('app.css version bumped past 68', (() => { const m = /css\/app\.css\?v=(\d+)/.exec(html); return m && +m[1] > 68; })());

// ── 5. SPOT_EDITOR ───────────────────────────────────────────────────────────
console.log('\n--- spot_editor.js ---');
let edSrc = '';
try { edSrc = read('wayfinding-app/js/spot_editor.js'); } catch (_) {}
ok('spot_editor.js exists', !!edSrc);
ok('spot_editor.js has no emoji', !EMOJI.test(edSrc));
const services = [
  { department: OSCA, subservice: 'Senior Citizens ID', requirements: [{ requirement: 'Barangay certificate' }] },
  { department: OSCA, subservice: 'Senior Citizens ID', requirements: [{ requirement: 'Valid ID' }] },
  { department: OSCA, subservice: 'Discount complaints', requirements: [] },
  { department: CSSO, subservice: 'Burial Assistance', requirements: [] },
];
let fetches = [];
const edBox = {
  console, Promise, Date, JSON, Object, Array, Set, Map,
  fetch: async (url) => {
    fetches.push(url);
    const body = /services\.json/.test(url) ? services
      : /service_glossary/.test(url) ? {}
      : /departments\.json/.test(url) ? { [OSCA]: {}, [CSSO]: {}, 'CITY COLLEGE OF CALAMBA': {} } : null;
    return { ok: true, json: async () => body };
  },
  STAMP_PLACEMENTS: [
    { id: 'a', name: 'GF 14 OSCA', row: 1, col: 1, size: 2, floor: 1 },
    { id: 'b', name: 'GF 03', row: 5, col: 5, size: 2, floor: 1 },
    { id: 'c', name: 'Session Hall', row: 9, col: 9, size: 2, floor: 3 },
  ],
  DEPT_STAMP_NAMES: { [OSCA]: ['GF 14 OSCA'], [CSSO]: ['LG 10a CSSD'] },
  SEPARATE_CAMPUS: new Set(['CITY COLLEGE OF CALAMBA']),
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  saves: 0,
};
edBox.saveStampPlacements = () => { edBox.saves++; };
vm.createContext(edBox);
(async () => {
  if (edSrc) {
    try {
      vm.runInContext(spotsSrc + '\n' + charterSrc + '\n' + edSrc +
        '\n;this.SPOTS = SPOTS; this.SPOT_EDITOR = SPOT_EDITOR;', edBox);
    } catch (e) { ok('spot_editor.js loads without a document', false, e.message); }
  }
  const E = edBox.SPOT_EDITOR || {};
  ok('SPOT_EDITOR exposes openPanel, closePanel, refreshPanel, loadCharter, runMigration',
     ['openPanel', 'closePanel', 'refreshPanel', 'loadCharter', 'runMigration'].every((f) => typeof E[f] === 'function'));
  if (typeof E.loadCharter === 'function') {
    const idx1 = await E.loadCharter();
    const idx2 = await E.loadCharter();
    ok('loadCharter builds the Charter index', idx1 && idx1.servicesByDept && idx1.servicesByDept[OSCA].length === 2);
    ok('loadCharter fetches services.json and the glossary once',
       idx1 === idx2 && fetches.filter((u) => /services\.json/.test(u)).length === 1 &&
       fetches.filter((u) => /service_glossary\.json/.test(u)).length === 1, fetches.join(','));
  }
  if (typeof E.runMigration === 'function') {
    const arrRef = edBox.STAMP_PLACEMENTS;
    const res = await E.runMigration();
    const a = arrRef.find((p) => p.id === 'a');
    ok('runMigration replaces STAMP_PLACEMENTS in place', edBox.STAMP_PLACEMENTS === arrRef && arrRef.length === 3);
    ok('runMigration assigns the OSCA stamp with its unique Charter services',
       a.kind === 'office' && a.dept === OSCA &&
       JSON.stringify(a.services) === JSON.stringify(['Senior Citizens ID', 'Discount complaints']), JSON.stringify(a));
    ok('runMigration returns checkThese (the unnamed GF 03)',
       res && res.checkThese.length === 1 && res.checkThese[0].id === 'b', JSON.stringify(res));
    ok('runMigration saves the placements (map left dirty, nothing published)', edBox.saves >= 1);
    ok('nothing was posted', !fetches.some((u) => /mapstate/.test(u)));
  }
  if (typeof E.officeList === 'function') {
    const list = await E.officeList();
    ok('office list = departments.json minus separate campuses',
       list.includes(OSCA) && list.includes(CSSO) && !list.includes('CITY COLLEGE OF CALAMBA'), JSON.stringify(list));
  } else ok('SPOT_EDITOR.officeList exists', false);
  if (typeof E.confirmDesk === 'function' && typeof E.removeDesk === 'function') {
    edBox.STAMP_PLACEMENTS.push({ id: 'dk', name: 'OSCA desk', row: 3, col: 3, size: 2, floor: 1, kind: 'desk', dept: OSCA, confirmedAt: '2026-01-01T00:00:00.000Z' });
    const before = Date.now();
    E.confirmDesk('dk');
    const t = Date.parse(edBox.STAMP_PLACEMENTS.find((p) => p.id === 'dk').confirmedAt);
    ok('Confirm sets confirmedAt to now', t >= before && t <= Date.now() + 5);
    E.removeDesk('dk');
    ok('Remove takes the desk off the map', !edBox.STAMP_PLACEMENTS.some((p) => p.id === 'dk'));
  } else ok('SPOT_EDITOR.confirmDesk / removeDesk exist', false);

  // ── 6. server keeps schema 2 fields ────────────────────────────────────────
  console.log('\n--- api/mapstate.js (fake Redis) ---');
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.local';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'faketoken';
  process.env.MAP_ADMIN_TOKEN = 'secret-token';
  delete process.env.WF_KEY_PREFIX;
  delete process.env.VERCEL_ENV;
  const store = { kv: {}, lists: {} };
  global.fetch = async (_url, opts) => {
    const [op, key, ...rest] = JSON.parse(opts.body);
    let result = null;
    if (op === 'GET') result = store.kv[key] ?? null;
    else if (op === 'SET') { store.kv[key] = rest[0]; result = 'OK'; }
    else if (op === 'LPUSH') { (store.lists[key] = store.lists[key] || []).unshift(rest[0]); result = store.lists[key].length; }
    else if (op === 'LTRIM') { store.lists[key] = (store.lists[key] || []).slice(rest[0], rest[1] + 1); result = 'OK'; }
    else if (op === 'LRANGE') { const l = store.lists[key] || []; result = l.slice(rest[0], rest[1] === -1 ? undefined : rest[1] + 1); }
    return { ok: true, json: async () => ({ result }) };
  };
  const handler = require(path.resolve(ROOT, 'api/mapstate.js'));
  const mockRes = () => {
    const r = { code: 200, body: null, headers: {} };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.end = () => r;
    return r;
  };
  const call = async (req) => { const res = mockRes(); await handler(req, res); return res; };
  const AUTH = { authorization: 'Bearer secret-token' };
  const v2 = { grid: { floorWalls: {} }, stampPlacements: migrated, stampPresets: [], floorNames: {},
               schema: 2, removedRequirements: removedReqs };
  let r = await call({ method: 'POST', headers: AUTH, body: { state: v2, updatedBy: 'Jester' } });
  ok('schema 2 state publishes', r.code === 200 && r.body.version === 1, JSON.stringify(r.body));
  r = await call({ method: 'GET', query: {}, headers: {} });
  ok('GET returns schema and removedRequirements unchanged',
     r.body.state && r.body.state.schema === 2 &&
     JSON.stringify(r.body.state.removedRequirements) === JSON.stringify(removedReqs) &&
     r.body.state.stampPlacements[0].kind === 'office', JSON.stringify(r.body.state));
  await call({ method: 'POST', headers: AUTH, body: { state: { stampPlacements: [] }, updatedBy: 'Bea' } });
  r = await call({ method: 'POST', headers: AUTH, body: { rollbackTo: 1, updatedBy: 'Jester' } });
  r = await call({ method: 'GET', query: {}, headers: {} });
  ok('rollback keeps schema and removedRequirements',
     r.body.state && r.body.state.schema === 2 &&
     JSON.stringify(r.body.state.removedRequirements) === JSON.stringify(removedReqs));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL  crashed: ' + e.stack); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
