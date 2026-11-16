/**
 * test_spot_editor.js - the spot sheet (Task 6): tap a spot, then pick its
 * office, services and requirements. Pure helpers (applyAssignment,
 * toggleRequirement, ...), the #spotSheet markup and CSS, the app.js wiring,
 * and a run through the sheet on a small fake DOM.
 *
 * Run: node tools/test_spot_editor.js <repo-root>
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
const edSrc = read('wayfinding-app/js/spot_editor.js');
const html = read('wayfinding-app/index.html');
const css = read('wayfinding-app/css/app.css');

const OSCA = 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS';
const CSSO = 'CITY SOCIAL SERVICES OFFICE';
const VOTER = "5. Voter's ID / Voter's Certificate (Photocopy)";
const KEY = `Senior Citizens ID|${OSCA}`;
const SRC_URL = 'https://calambacity.gov.ph/Users/Home/ViewServicesPage?createservicesId=187';
const NO_MATCH = "Not in the Charter. Only items in the Citizen's Charter can be added. If the office now asks for this, the Charter has to be updated first.";
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2300}-\u{23FF}]/u;

const SERVICES = [
  { department: OSCA, subservice: 'Senior Citizens ID', source_url: SRC_URL,
    requirements: [{ requirement: '1. Accomplished Form' }, { requirement: VOTER }, { requirement: '3. Certificate of Residency' }] },
  { department: OSCA, subservice: 'Discount complaints', source_url: 'https://example.test/osca-2', requirements: [{ requirement: 'Receipt' }] },
  { department: CSSO, subservice: 'Burial Assistance', source_url: 'https://example.test/csso', requirements: [{ requirement: 'Death certificate' }] },
];

// ── 1. pure helpers (no document) ────────────────────────────────────────────
console.log('\n--- pure helpers ---');
const pureBox = { console, DEPT_CODE: null };
vm.createContext(pureBox);
vm.runInContext(lift('DEPT_CODE') + '\n' + spotsSrc + '\n' + charterSrc + '\n' + edSrc +
  '\n;this.SPOTS = SPOTS; this.CHARTER_PICK = CHARTER_PICK; this.SPOT_EDITOR = SPOT_EDITOR;', pureBox);
const { SPOTS, CHARTER_PICK } = pureBox;
const E = pureBox.SPOT_EDITOR;

ok('SPOT_EDITOR exposes onTap, applyAssignment, toggleRequirement',
   ['onTap', 'applyAssignment', 'toggleRequirement'].every((f) => typeof E[f] === 'function'));

const migratedSet = SPOTS.migrateStamps([
  { id: 'a', name: 'GF 14 OSCA', row: 1, col: 1, size: 3, floor: 1 },
  { id: 'b', name: 'GF 06', row: 10, col: 10, size: 3, floor: 1 },
  { id: 'c', name: 'Session Hall', row: 20, col: 20, size: 3, floor: 3 },
], { [OSCA]: ['GF 14 OSCA'] }, { [OSCA]: ['Senior Citizens ID'] }).placements;

if (typeof E.applyAssignment === 'function') {
  const before = clone(migratedSet);
  const out = E.applyAssignment(migratedSet, 'b', { kind: 'office', dept: OSCA, services: ['Senior Citizens ID'] });
  const b = out.find((p) => p.id === 'b');
  ok('Assigning OSCA: kind office and dept OFFICE FOR THE SENIOR CITIZENS AFFAIRS',
     b && b.kind === 'office' && b.dept === OSCA, JSON.stringify(b));
  ok('Assigning OSCA: services set', b && JSON.stringify(b.services) === '["Senior Citizens ID"]');
  ok('applyAssignment does not change its input', JSON.stringify(migratedSet) === JSON.stringify(before) && out !== migratedSet);
  ok('a code-only name gets the office code in front ("OSCA GF 06")', b && b.name === 'OSCA GF 06', b && b.name);
  ok('the old OSCA spot is not touched (an office may have several spots)',
     JSON.stringify(out.find((p) => p.id === 'a')) === JSON.stringify(migratedSet.find((p) => p.id === 'a')));
  const named = E.applyAssignment(migratedSet, 'c', { kind: 'office', dept: CSSO, services: [] }).find((p) => p.id === 'c');
  ok('a real name is kept when an office is assigned', named.name === 'Session Hall', named.name);
  const blank = E.applyAssignment([{ id: 'n', name: '', row: 1, col: 1, size: 3, floor: 1 }], 'n',
    { kind: 'office', dept: OSCA, services: [] })[0];
  ok('a spot with no name is named by the office code', blank.name === 'OSCA', blank.name);

  const cleared = E.applyAssignment(migratedSet, 'a', {}).find((p) => p.id === 'a');
  ok('Clearing a spot: labelStyle look is "empty"', SPOTS.labelStyle(cleared).look === 'empty', JSON.stringify(cleared));
  ok('Clearing a spot: kind, dept and services undefined',
     cleared.kind === undefined && cleared.dept === undefined && cleared.services === undefined);

  const other = E.applyAssignment(migratedSet, 'a', { kind: 'other', name: '  Records Room ' }).find((p) => p.id === 'a');
  ok('Other place: typed name replaces the name, no services, no office',
     other.kind === 'other' && other.name === 'Records Room' && other.services === undefined && other.dept === undefined,
     JSON.stringify(other));
  ok('Other place: otherKey null for a new Other place', other.otherKey === null);
  const com = [{ id: 'k', name: 'COMELEC', row: 1, col: 1, size: 3, floor: 1, kind: 'other', otherKey: 'comelec' }];
  ok('Other place: renaming keeps its fixed key',
     E.applyAssignment(com, 'k', { kind: 'other', name: 'Comelec Office' })[0].otherKey === 'comelec');
  // M1 (final review): the help desk and COMELEC keep, or get back, their fixed key.
  const pac = [{ id: 'h', name: 'MOPAC', row: 1, col: 1, size: 3, floor: 1, kind: 'other', otherKey: 'public-assistance' }];
  ok('M1: re-saving the Public Assistance Center as an Other place keeps otherKey',
     E.applyAssignment(pac, 'h', { kind: 'other', name: 'Help Desk' })[0].otherKey === 'public-assistance');
  const fresh = (name) => E.applyAssignment(migratedSet, 'b', { kind: 'other', name })[0 + migratedSet.findIndex((p) => p.id === 'b')];
  ok('M1: a new Other place named "Public Assistance Center" gets otherKey public-assistance',
     fresh('Public Assistance Center').otherKey === 'public-assistance', JSON.stringify(fresh('Public Assistance Center')));
  ok('M1: ...case does not matter', fresh('public assistance center').otherKey === 'public-assistance');
  ok('M1: a new Other place named "Commission on Elections" gets otherKey comelec',
     fresh('COMMISSION ON ELECTIONS').otherKey === 'comelec', JSON.stringify(fresh('COMMISSION ON ELECTIONS')));
  ok('M1: the full Charter name of the help desk counts too',
     fresh("Mayor's Office Public Assistance Center").otherKey === 'public-assistance');
  ok('M1: any other name still gets otherKey null', fresh('Public Assistance Centre Annex').otherKey === null);
  ok('M1: an Other place that loses its office and comes back by name gets its key again',
     E.applyAssignment(E.applyAssignment(pac, 'h', {}), 'h', { kind: 'other', name: 'Public Assistance Center' })[0].otherKey === 'public-assistance');
}

if (typeof E.toggleRequirement === 'function') {
  const removed0 = { other: ['x'] };
  const r1 = E.toggleRequirement(removed0, KEY, VOTER, false);
  ok("toggleRequirement: removing Voter's ID adds it to removed[key]",
     Array.isArray(r1[KEY]) && r1[KEY].includes(VOTER), JSON.stringify(r1));
  ok('toggleRequirement does not change its input', JSON.stringify(removed0) === '{"other":["x"]}');
  ok('toggleRequirement: removing twice keeps one entry', E.toggleRequirement(r1, KEY, VOTER, false)[KEY].length === 1);
  const r2 = E.toggleRequirement(r1, KEY, VOTER, true);
  ok('toggleRequirement: keeping it again deletes it and drops the empty key',
     !(KEY in r2) && JSON.stringify(r2.other) === '["x"]', JSON.stringify(r2));
  ok('toggleRequirement: keeping matches a curly apostrophe too',
     !(KEY in E.toggleRequirement({ [KEY]: ['5. Voter’s ID / Voter’s Certificate (Photocopy)'] }, KEY, VOTER, true)));
}

const index = CHARTER_PICK.buildIndex(SERVICES, {});
if (typeof E.checkPick === 'function') {
  const good = E.checkPick(index, 'office', 'office for the senior citizens affairs');
  ok('checkPick accepts a Charter office and returns its exact name', good.ok && good.value === OSCA, JSON.stringify(good));
  const bad = E.checkPick(index, 'requirement', 'Birth certificate from the moon', { serviceKey: KEY });
  ok('checkPick refuses a non-Charter requirement with the exact NO_MATCH text', !bad.ok && bad.message === NO_MATCH);
  ok('checkPick offers only this service\'s own closest requirements',
     Array.isArray(bad.closest) && bad.closest.every((c) => index.requirementsByKey[KEY].includes(c.value)), JSON.stringify(bad.closest));
} else ok('SPOT_EDITOR.checkPick exists', false);

if (typeof E.moveSpot === 'function') {
  const moved = E.moveSpot(migratedSet, 'b', 40, 41);
  ok('moveSpot sets row and col on a copy', moved.find((p) => p.id === 'b').row === 40 &&
     moved.find((p) => p.id === 'b').col === 41 && migratedSet.find((p) => p.id === 'b').row === 10);
} else ok('SPOT_EDITOR.moveSpot exists', false);

// ── 2. markup and CSS ────────────────────────────────────────────────────────
console.log('\n--- index.html / app.css ---');
const block = (id) => {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return '';
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf(`<!-- /${id} -->`, i);
  return end < 0 ? '' : html.slice(start, end);
};
const sheetHtml = block('spotSheet');
ok('index.html has #spotSheet (ends at <!-- /spotSheet -->)', sheetHtml.length > 0);
for (const label of ['Assign an office', 'Other place', 'Move', 'Remove', 'Save']) {
  ok(`#spotSheet has the button "${label}"`, new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`).test(sheetHtml));
}
ok('#spotSheet has the shared-requirements note',
   sheetHtml.includes('These requirements apply to this service everywhere this office offers it.'));
ok("#spotSheet has \"From the Citizen's Charter:\"", sheetHtml.includes("From the Citizen's Charter:"));
ok('#spotSheet has no emoji', sheetHtml.length > 0 && !EMOJI.test(sheetHtml));
ok('#spotSheet offers "Add a spot here" and "Add desk here"',
   />\s*Add a spot here\s*</.test(sheetHtml) && />\s*Add desk here\s*</.test(sheetHtml));
ok('the source link opens in a new tab', /<a[^>]*id="ssSourceLink"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(sheetHtml));
{
  let minH = 0;
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (!sels.includes('.spot-sheet button')) continue;
    const h = /min-height:\s*(\d+)px/.exec(m[2]);
    if (h) minH = Math.max(minH, +h[1]);
  }
  ok('CSS gives .spot-sheet button a min-height of at least 44px', minH >= 44, String(minH));
}
const ver = (file) => { const m = new RegExp(file.replace('.', '\\.') + '\\?v=(\\d+)').exec(html); return m ? +m[1] : 0; };
ok('spot_editor.js version bumped past 1', ver('spot_editor.js') > 1);
ok('app.js version bumped past 95', ver('app.js') > 95);
ok('app.css version bumped past 69', ver('app.css') > 69);
ok('spot_editor.js has no emoji', !EMOJI.test(edSrc));
// M4 (final review): desks are edited in the desk sheet (desk_editor.js); the
// spot sheet's old desk note and desk branches are gone.
ok('M4: index.html has no ssDeskNote and no "Desks can be edited after the next update"',
   !/ssDeskNote/.test(html) && !/Desks can be edited after the next update/.test(html));
ok("M4: spot_editor.js has no desk mode in the spot sheet (no ssDeskNote, no mode 'desk')",
   !/ssDeskNote/.test(edSrc) && !/mode === 'desk'/.test(edSrc) && !/'desk' : 'office'/.test(edSrc) && !/desks: Task 7/.test(edSrc));

// ── 3. app.js wiring ─────────────────────────────────────────────────────────
console.log('\n--- app.js ---');
{
  const box = {};
  vm.createContext(box);
  vm.runInContext(lift('_dockTool') + ';this._dockTool = _dockTool;', box);
  ok("_dockTool returns 'offices' in Offices mode", box._dockTool({ spotMode: true }) === 'offices');
  ok("_dockTool still returns 'move' otherwise", box._dockTool({}) === 'move');
  const tap = lift('handleCellTap');
  ok('handleCellTap sends Offices-mode taps to SPOT_EDITOR.onTap',
     /STATE\.spotMode[\s\S]{0,120}SPOT_EDITOR\.onTap\(row, col\)/.test(tap));
  ok('_syncDock lights dockOffices', /\['dockOffices', 'offices'\]/.test(lift('_syncDock')));
  ok('the dock Offices button switches Offices mode', /_dock\('dockOffices',[^\n]*SPOT_EDITOR\.toggleMode/.test(appSrc));
  for (const fn of ['setWallMode', 'setSelectMode', 'setToolsPanel', 'setCaptureMode']) {
    ok(`${fn} leaves Offices mode`, /SPOT_EDITOR\.setMode\(false\)/.test(lift(fn)));
  }
}

// ── 4. the sheet on a fake DOM ───────────────────────────────────────────────
console.log('\n--- the sheet (fake DOM) ---');
class FakeEl {
  constructor(tag, id) {
    this.tagName = String(tag).toUpperCase(); this.id = id || ''; this.children = []; this.parentNode = null;
    this.hidden = false; this.disabled = false; this.value = ''; this._text = ''; this.className = '';
    this.attrs = {}; this.listeners = {}; this.style = {};
    const self = this;
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : !!on; if (v) this._s.add(c); else this._s.delete(c); return v; },
    };
    void self;
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t, ev) { const e = Object.assign({ type: t, target: this, preventDefault() {}, stopPropagation() {} }, ev || {}); (this.listeners[t] || []).forEach((fn) => fn(e)); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() {} blur() {} scrollIntoView() {} select() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0 }; }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const ids = {};
const docListeners = {};
const document = {
  readyState: 'complete',
  getElementById: (id) => (ids[id] = ids[id] || new FakeEl('div', id)),
  createElement: (tag) => new FakeEl(tag),
  addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
};
const $ = (id) => document.getElementById(id);
const buttonIn = (id, text) => $(id).all().find((n) => n.tagName === 'BUTTON' && n.textContent.trim() === text);
const buttonsIn = (id) => $(id).all().filter((n) => n.tagName === 'BUTTON');
const visible = (id) => { for (let n = $(id); n; n = n.parentNode) if (n.hidden) return false; return !$(id).hidden; };

const placementsArr = [
  { id: 'g6', name: 'GF 06', row: 10, col: 10, size: 3, floor: 1, source: 'local' },
  { id: 'up', name: '2F 01', row: 10, col: 10, size: 3, floor: 2, source: 'local' },
];
const removedReqs = {};
let confirmAnswer = false, confirmAsked = '';
let deptsFail = true;   // M3: departments.json cannot be loaded at first
const calls = { saves: 0, removedSaves: 0, recompute: 0, draw: 0, catalogue: 0 };
const domBox = {
  console, document, Promise, setTimeout, clearTimeout,
  STATE: { currentFloor: 1, viewMode: 'admin', spotMode: false },
  STAMP_PLACEMENTS: placementsArr,
  REMOVED_REQUIREMENTS: removedReqs,
  NODE_MAP: { '5,5': { wall: true }, '30,30': { wall: false } },
  nodeId: (r, c) => r + ',' + c,
  GRID_ROWS: 75, GRID_COLS: 75,
  fetch: async (url) => {
    if (/departments\.json/.test(url)) {
      if (deptsFail) throw new Error('offline');
      return { ok: true, json: async () => ({ [OSCA]: {}, [CSSO]: {} }) };
    }
    return { ok: true, json: async () => (/services\.json/.test(url) ? SERVICES : /glossary/.test(url) ? {} : {}) };
  },
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  confirm: (msg) => { confirmAsked = msg; return confirmAnswer; },
  alert: () => {},
  saveStampPlacements: () => { calls.saves++; },
  saveRemovedRequirements: () => { calls.removedSaves++; },
  recompute: () => { calls.recompute++; },
  renderCatalogue: () => { calls.catalogue++; },
  renderer: { _draw: () => { calls.draw++; }, canvas: { clientWidth: 100, clientHeight: 100, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, centerOnCell() {} },
  updateCursorAndHint: () => {},
  _syncDock: () => {},
  _officeTitle: null,
};
vm.createContext(domBox);
vm.runInContext(lift('DEPT_CODE') + '\n' + lift('_officeTitle') + '\n' + spotsSrc + '\n' + charterSrc + '\n' + edSrc +
  '\n;this.SPOT_EDITOR = SPOT_EDITOR; this.SPOTS = SPOTS;', domBox);
const D = domBox.SPOT_EDITOR;
const spot = (id) => domBox.STAMP_PLACEMENTS.find((p) => p.id === id);

(async () => {
  if (typeof D.onTap !== 'function') throw new Error('SPOT_EDITOR.onTap missing');
  await D.loadCharter();

  // C1 (final review): before "Move them", nothing in Offices mode may change
  // the map. One kind on an unmigrated map turns spot routing on and leaves
  // every other office "not on this map" for citizens.
  {
    const snap = JSON.stringify(domBox.STAMP_PLACEMENTS);
    domBox.sessionStorage.setItem('wf-spot-migration-later', '1');   // "Not now" was tapped earlier
    D.refreshPanel();
    ok('C1: after "Not now" the banner is hidden', !visible('spotMigrationBanner'));
    D.toggleMode();
    ok('C1: the Offices button on an unmigrated map does not enter Offices mode', domBox.STATE.spotMode === false);
    ok('C1: ...it shows the migration banner (Move them, Not now) instead of the editor',
       visible('spotMigrationBanner') && visible('spotMigrateBtn') && visible('spotMigrateLater') && !visible('officesPanel'));
    D.setMode(true);
    ok('C1: setMode(true) is refused before the move', domBox.STATE.spotMode === false);
    D.openPanel();
    ok('C1: openPanel is refused before the move', domBox.STATE.spotMode === false && !visible('officesPanel'));
    domBox.STATE.spotMode = true;   // even if something forced Offices mode on
    D.onTap(11, 12);
    ok('C1: a tap on a spot opens no sheet', !visible('spotSheet'));
    D.onTap(30, 30);
    ok('C1: a tap on an empty cell offers nothing', !visible('spotSheet'));
    $('ssAddSpot').click();
    $('ssAddDesk').click();
    D.openSheet('g6');
    $('ssOfficeInput').value = 'Office for the Senior Citizens Affairs';
    $('ssSaveBtn').click();
    ok('C1: Offices-mode taps, Add a spot, Add desk and Save change nothing in STAMP_PLACEMENTS',
       JSON.stringify(domBox.STAMP_PLACEMENTS) === snap, JSON.stringify(domBox.STAMP_PLACEMENTS));
    ok('C1: no placement got a kind', !domBox.STAMP_PLACEMENTS.some((p) => p.kind));
    domBox.STATE.spotMode = false;
    $('spotMigrateLater').click();
    ok('C1: "Not now" hides the banner again', !visible('spotMigrationBanner'));
    D.toggleMode();
    ok('C1: the banner stays reachable: the Offices button shows it again', visible('spotMigrationBanner') && domBox.STATE.spotMode === false);
    // As after "Move them": the map now has spots, so the editor opens.
    domBox.STAMP_PLACEMENTS.push({ id: 'hall', name: 'Session Hall', row: 20, col: 20, size: 3, floor: 3, source: 'local', kind: 'other', otherKey: null });
    D.toggleMode();
    ok('C1: once moved, the Offices button enters Offices mode and hides the banner',
       domBox.STATE.spotMode === true && visible('officesPanel') && !visible('spotMigrationBanner'));
    D.setMode(false);
  }

  // M3 (final review): a failed office list load is not "Every office is on the map."
  {
    const settle = () => new Promise((r) => setTimeout(r, 0));
    D.openPanel();
    await settle(); await settle();
    const txt = $('unplacedList').textContent;
    ok('M3: a failed load says "Couldn\'t load the office list. Try again."',
       txt.includes("Couldn't load the office list. Try again.") && !txt.includes('Every office is on the map.'), txt);
    const retry = buttonIn('unplacedList', 'Try again');
    ok('M3: ...with a "Try again" button (44 px offices-btn, styled offices-retry)',
       !!retry && /\boffices-btn\b/.test(retry.className) && /\.offices-retry\s*\{[^}]*border:/.test(css));
    deptsFail = false;
    if (retry) retry.click();
    await settle(); await settle();
    const txt2 = $('unplacedList').textContent;
    ok('M3: "Try again" loads the list (the failure was not kept)',
       /Senior Citizens Affairs/.test(txt2) && /Social Services/.test(txt2) && $('unplacedCount').textContent === '2', txt2);
    D.setMode(false);
  }

  // Tapping an existing spot opens it.
  D.onTap(11, 12);
  ok('tapping a spot opens the sheet', visible('spotSheet') && visible('ssSpot') && !visible('ssAdd'));
  ok('the sheet says "No office yet" for an empty spot', $('spotSheetTitle').textContent === 'No office yet', $('spotSheetTitle').textContent);

  // Office step: type-ahead, then pick.
  $('ssOfficeInput').value = 'senior';
  $('ssOfficeInput').dispatch('input');
  const pick = buttonsIn('ssOfficeSuggest').find((b) => /Senior Citizens Affairs/i.test(b.textContent));
  ok('office type-ahead suggests OSCA', !!pick, $('ssOfficeSuggest').textContent);
  if (pick) pick.click();
  const chipText = $('ssServiceChips').textContent;
  ok('picking OSCA pre-fills its Charter services',
     /Senior Citizens ID/.test(chipText) && /Discount complaints/.test(chipText) && !/Burial/.test(chipText), chipText);
  ok('each service chip has an "x" remove button',
     buttonsIn('ssServiceChips').filter((b) => b.textContent === 'x').length === 2);

  // Services step: x removes, the type-ahead adds (office's own first).
  buttonsIn('ssServiceChips').filter((b) => b.textContent === 'x')[1].click();
  ok('x removes a service chip', !/Discount complaints/.test($('ssServiceChips').textContent));
  $('ssServiceInput').value = 'discount';
  $('ssServiceInput').dispatch('input');
  const svcPick = buttonsIn('ssServiceSuggest').find((b) => /Discount complaints/.test(b.textContent));
  ok('service type-ahead suggests the office\'s service', !!svcPick);
  if (svcPick) svcPick.click();
  ok('picking a suggestion adds the service back', /Discount complaints/.test($('ssServiceChips').textContent));
  $('ssServiceInput').value = 'Free lunch';
  $('ssServiceInput').dispatch('keydown', { key: 'Enter' });
  ok('a service not in the Charter shows NO_MATCH', $('ssServiceMsg').textContent.includes(NO_MATCH) && visible('ssServiceMsg'));
  ok('...and is not added', !/Free lunch/.test($('ssServiceChips').textContent));

  // Requirements step.
  ok('requirements are hidden until a service is tapped', !visible('ssReqStep'));
  buttonIn('ssServiceChips', 'Senior Citizens ID').click();
  ok('tapping a service chip opens its requirements', visible('ssReqStep'));
  ok("requirements are pre-filled from the Charter", /Voter's ID/.test($('ssReqChips').textContent) &&
     /Accomplished Form/.test($('ssReqChips').textContent), $('ssReqChips').textContent);
  ok('the source line links the service page in a new tab',
     $('ssSourceLink').href === SRC_URL && $('ssSourceLink').textContent.length > 0, $('ssSourceLink').href);
  const voterChip = $('ssReqChips').children.find((li) => li.textContent.includes("Voter's ID"));
  const voterX = voterChip && voterChip.all().find((n) => n.tagName === 'BUTTON' && n.textContent === 'x');
  ok('each requirement chip has an "x" remove button', !!voterX);
  if (voterX) voterX.click();
  ok('removing a requirement takes it off the list', !/Voter's ID/.test($('ssReqChips').textContent));
  $('ssReqInput').value = 'Birth certificate from the moon';
  $('ssReqInput').dispatch('keydown', { key: 'Enter' });
  ok('a requirement not in the Charter shows NO_MATCH', $('ssReqMsg').textContent.includes(NO_MATCH));
  ok('...with the closest Charter items to choose from', buttonsIn('ssReqMsg').length > 0);
  ok('nothing is written before Save', !(KEY in domBox.REMOVED_REQUIREMENTS) && spot('g6').kind === undefined);

  // Save.
  const before = { ...calls };
  $('ssSaveBtn').click();
  const g6 = spot('g6');
  ok('Save assigns the office', g6.kind === 'office' && g6.dept === OSCA, JSON.stringify(g6));
  ok('Save keeps the services', JSON.stringify(g6.services) === '["Senior Citizens ID","Discount complaints"]', JSON.stringify(g6.services));
  ok('Save names a code-only spot "OSCA GF 06"', g6.name === 'OSCA GF 06', g6.name);
  ok('Save records the removed requirement in REMOVED_REQUIREMENTS',
     Array.isArray(domBox.REMOVED_REQUIREMENTS[KEY]) && domBox.REMOVED_REQUIREMENTS[KEY].some((t) => /Voter/.test(t)),
     JSON.stringify(domBox.REMOVED_REQUIREMENTS));
  ok('Save keeps STAMP_PLACEMENTS the same array', domBox.STAMP_PLACEMENTS === placementsArr);
  ok('Save calls saveStampPlacements, saveRemovedRequirements, recompute, _draw and renderCatalogue',
     calls.saves > before.saves && calls.removedSaves > before.removedSaves && calls.recompute > before.recompute &&
     calls.draw > before.draw && calls.catalogue > before.catalogue);
  ok('Save closes the sheet', !visible('spotSheet'));

  // Adding a requirement back only accepts this service's Charter items.
  D.onTap(10, 10);
  buttonIn('ssServiceChips', 'Senior Citizens ID').click();
  ok('a reopened sheet hides the removed requirement', !/Voter's ID/.test($('ssReqChips').textContent));
  ok('the removed requirement is listed with "Put back"', visible('ssReqGoneWrap') && !!buttonIn('ssReqGone', 'Put back'));
  $('ssReqInput').value = 'voter';
  $('ssReqInput').dispatch('input');
  const reqPick = buttonsIn('ssReqSuggest').find((b) => /Voter's ID/.test(b.textContent));
  ok('requirement type-ahead suggests the service\'s own Charter item', !!reqPick, $('ssReqSuggest').textContent);
  if (reqPick) reqPick.click();
  ok('picking a removed Charter requirement puts it back', /Voter's ID/.test($('ssReqChips').textContent), $('ssReqChips').textContent);
  $('ssSaveBtn').click();
  ok('saving the put-back drops it from REMOVED_REQUIREMENTS', !(KEY in domBox.REMOVED_REQUIREMENTS), JSON.stringify(domBox.REMOVED_REQUIREMENTS));

  // Office no-match.
  D.onTap(10, 10);
  $('ssOfficeInput').value = 'Department of Magic';
  $('ssOfficeInput').dispatch('keydown', { key: 'Enter' });
  ok('an office not in the Charter shows NO_MATCH', $('ssOfficeMsg').textContent.includes(NO_MATCH));
  D.closeSheet();

  // Other place.
  D.onTap(10, 10);
  $('ssOtherBtn').click();
  ok('Other place shows a name box and no services', visible('ssOtherStep') && !visible('ssOfficeStep'));
  $('ssOtherName').value = 'Records Room';
  $('ssSaveBtn').click();
  ok('Save makes an Other place with the typed name',
     spot('g6').kind === 'other' && spot('g6').name === 'Records Room' && spot('g6').services === undefined, JSON.stringify(spot('g6')));

  // No office yet.
  D.onTap(10, 10);
  $('ssNoneBtn').click();
  $('ssSaveBtn').click();
  ok('"No office yet" clears the spot', domBox.SPOTS.labelStyle(spot('g6')).look === 'empty', JSON.stringify(spot('g6')));

  // Empty cells.
  D.onTap(30, 30);
  ok('an empty walkable cell offers "Add desk here" and "Add a spot here"',
     visible('ssAdd') && visible('ssAddDesk') && visible('ssAddSpot') && !visible('ssSpot'));
  D.onTap(5, 5);
  ok('an empty wall cell offers only "Add a spot here"', visible('ssAddSpot') && !visible('ssAddDesk'));
  const n0 = domBox.STAMP_PLACEMENTS.length;
  $('ssAddSpot').click();
  const added = domBox.STAMP_PLACEMENTS[domBox.STAMP_PLACEMENTS.length - 1];
  ok('"Add a spot here" adds a size-3 spot at the tapped cell on this floor',
     domBox.STAMP_PLACEMENTS.length === n0 + 1 && added.row === 5 && added.col === 5 && added.size === 3 &&
     added.floor === 1 && added.kind === undefined, JSON.stringify(added));
  ok('...and opens its sheet', visible('ssSpot') && $('spotSheetTitle').textContent === 'No office yet');

  // Move.
  D.onTap(10, 10);
  $('ssMoveBtn').click();
  ok('Move says "Tap the new place for this spot."', $('ssMoveNote').textContent === 'Tap the new place for this spot.' &&
     visible('ssMoveNote') && !visible('ssBody') && visible('ssMoveBtn'));
  D.onTap(40, 41);
  ok('the next tap moves the spot there', spot('g6').row === 40 && spot('g6').col === 41, JSON.stringify(spot('g6')));
  ok('the sheet comes back after the move', visible('ssBody') && !visible('ssMoveNote'));
  $('ssMoveBtn').click();
  $('ssMoveBtn').click();
  D.onTap(60, 60);
  ok('tapping Move again cancels it', spot('g6').row === 40 && visible('ssAdd'));
  D.onTap(40, 41);
  $('ssMoveBtn').click();
  (docListeners.keydown || []).forEach((fn) => fn({ key: 'Escape', target: {} }));
  D.onTap(60, 60);
  ok('Escape cancels a move', spot('g6').row === 40);

  // Remove.
  D.onTap(40, 41);
  confirmAnswer = false;
  $('ssRemoveBtn').click();
  ok('Remove asks "Remove this spot?" first', confirmAsked === 'Remove this spot?', confirmAsked);
  ok('saying no keeps the spot', !!spot('g6'));
  confirmAnswer = true;
  $('ssRemoveBtn').click();
  ok('saying yes removes it', !spot('g6') && !visible('spotSheet'));

  // I2 (final review): assigning an office that already has spots asks whether
  // to keep it there too. OK keeps them (several windows); Cancel clears them.
  {
    domBox.STAMP_PLACEMENTS.push(
      { id: 'w1', name: 'OSCA GF 50', row: 50, col: 50, size: 3, floor: 1, source: 'local', kind: 'office', dept: OSCA, services: ['Senior Citizens ID'] },
      { id: 'w2', name: 'GF 55', row: 55, col: 55, size: 3, floor: 1, source: 'local' },
      { id: 'w3', name: 'GF 60', row: 60, col: 60, size: 3, floor: 1, source: 'local' });
    const assignOsca = (r, c) => {
      D.onTap(r, c);
      $('ssAssignBtn').click();
      $('ssOfficeInput').value = 'Office for the Senior Citizens Affairs';
      confirmAsked = '';
      $('ssSaveBtn').click();
    };
    confirmAnswer = true;
    assignOsca(56, 56);
    ok('I2: Save asks "<office> is also at <spots>. Keep it there too?"',
       confirmAsked === 'Office for the Senior Citizens Affairs is also at OSCA GF 50. Keep it there too?', confirmAsked);
    ok('I2: OK keeps the other spot (several windows) and assigns this one',
       spot('w1').kind === 'office' && spot('w1').dept === OSCA && spot('w2').kind === 'office' && spot('w2').dept === OSCA,
       JSON.stringify([spot('w1'), spot('w2')]));
    confirmAnswer = false;
    assignOsca(61, 61);
    ok('I2: the question names every other spot',
       confirmAsked === 'Office for the Senior Citizens Affairs is also at OSCA GF 50 and OSCA GF 55. Keep it there too?', confirmAsked);
    ok('I2: Cancel returns the other spots to "No office yet" (kind, dept and services cleared)',
       ['w1', 'w2'].every((id) => spot(id).kind === undefined && spot(id).dept === undefined && spot(id).services === undefined),
       JSON.stringify([spot('w1'), spot('w2')]));
    ok('I2: ...and this spot has the office', spot('w3').kind === 'office' && spot('w3').dept === OSCA, JSON.stringify(spot('w3')));
    confirmAsked = '';
    D.onTap(61, 61);
    $('ssSaveBtn').click();
    ok('I2: re-saving a spot that already has the office asks nothing', confirmAsked === '' && spot('w3').dept === OSCA, confirmAsked);
    D.onTap(61, 61);
    $('ssNoneBtn').click();
    $('ssSaveBtn').click();
    assignOsca(51, 51);
    ok('I2: no question when the office has no other spot', confirmAsked === '' && spot('w1').dept === OSCA, confirmAsked);
  }

  // Offices mode.
  D.setMode(true);
  ok('setMode(true) turns Offices mode on', domBox.STATE.spotMode === true);
  D.onTap(11, 11);
  D.setMode(false);
  ok('setMode(false) turns it off and closes the sheet', domBox.STATE.spotMode === false && !visible('spotSheet'));

  ok('the sheet builds no emoji', !EMOJI.test($('spotSheet').textContent + $('ssServiceChips').textContent));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL  crashed: ' + e.stack); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
