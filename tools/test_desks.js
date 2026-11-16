/**
 * test_desks.js - corridor desks (Task 7): SPOTS.blocksWay (does a desk cut
 * an office off from the entrance?), DESK_EDITOR.addDesk, the #deskSheet
 * markup and CSS, and a run through the desk sheet on a small fake DOM.
 *
 * Run: node tools/test_desks.js <repo-root>
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
const read = (p) => { try { return fs.readFileSync(path.resolve(ROOT, p), 'utf8'); } catch (_) { return ''; } };

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
const deskSrc = read('wayfinding-app/js/desk_editor.js');
const html = read('wayfinding-app/index.html');
const css = read('wayfinding-app/css/app.css');

const OSCA = 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS';
const CSSO = 'CITY SOCIAL SERVICES OFFICE';
const NO_MATCH = "Not in the Charter. Only items in the Citizen's Charter can be added. If the office now asks for this, the Charter has to be updated first.";
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2300}-\u{23FF}]/u;
const SERVICES = [
  { department: OSCA, subservice: 'Senior Citizens ID', requirements: [{ requirement: 'Accomplished Form' }] },
  { department: OSCA, subservice: 'Discount complaints', requirements: [{ requirement: 'Receipt' }] },
  { department: CSSO, subservice: 'Burial Assistance', requirements: [{ requirement: 'Death certificate' }] },
];

// ── 1. SPOTS.blocksWay ───────────────────────────────────────────────────────
console.log('\n--- SPOTS.blocksWay ---');
const SPOTS = require(path.resolve(ROOT, 'wayfinding-app/js/spots.js'));
ok('SPOTS.blocksWay exists', typeof SPOTS.blocksWay === 'function');

/** A rows x cols grid of walls, with the given "r,c" cells open. */
function grid(rows, cols, open) {
  const set = new Set(open);
  const nodes = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const id = r + ',' + c;
    nodes.push({ id, row: r, col: c, wall: !set.has(id), cellType: set.has(id) ? 'open' : 'wall' });
  }
  return nodes;
}
if (typeof SPOTS.blocksWay === 'function') {
  // 10x10, a one-cell-wide corridor down column 5 from the entrance (9,5) to an office at (0,5).
  const corridor = [];
  for (let r = 0; r < 10; r++) corridor.push(r + ',5');
  const nodes = grid(10, 10, corridor);
  const office = { id: 'o', name: 'OSCA GF 01', row: 0, col: 5, size: 1, floor: 1, kind: 'office', dept: OSCA };
  const entrance = [{ row: 9, col: 5 }];
  const desk = { id: 'd', name: 'OSCA desk', row: 5, col: 5, size: 1, floor: 1, kind: 'desk', dept: OSCA };
  const got = SPOTS.blocksWay(nodes, [office], 1, desk, entrance);
  ok('a desk on 5,5 blocks the corridor: [that office\'s name]',
     JSON.stringify(got) === JSON.stringify(['OSCA GF 01']), JSON.stringify(got));
  const beside = SPOTS.blocksWay(nodes, [office], 1, { ...desk, col: 4 }, entrance);
  ok('a desk beside the corridor returns []', Array.isArray(beside) && beside.length === 0, JSON.stringify(beside));

  // The same desk at size 2 still blocks; the desk already in the list is replaced, not doubled.
  ok('a size-2 desk on 5,5 blocks too',
     JSON.stringify(SPOTS.blocksWay(nodes, [office, { ...desk, col: 4 }], 1, { ...desk, size: 2 }, entrance)) === '["OSCA GF 01"]');
  ok('the desk being edited is checked where it is now, not where it was',
     SPOTS.blocksWay(nodes, [office, desk], 1, { ...desk, col: 4 }, entrance).length === 0);

  // An office on wall cells is reached through a walkable cell beside it.
  const wallOffice = { id: 'w', name: 'CSSO GF 02', row: 0, col: 3, size: 2, floor: 1, kind: 'office', dept: CSSO };
  ok('an office on wall cells beside the corridor is cut off too',
     JSON.stringify(SPOTS.blocksWay(nodes, [office, wallOffice], 1, desk, entrance)) === '["OSCA GF 01","CSSO GF 02"]');
  // Offices the desk does not cut off are left out.
  const sealed = { id: 's', name: 'Sealed', row: 0, col: 0, size: 1, floor: 1, kind: 'office', dept: CSSO };
  ok('an office already out of reach is not blamed on this desk',
     !SPOTS.blocksWay(nodes, [office, sealed], 1, desk, entrance).includes('Sealed'));
  const older = { id: 'old', name: 'Old desk', row: 7, col: 5, size: 1, floor: 1, kind: 'desk', dept: CSSO };
  ok('an office another desk already cuts off is not blamed on this desk',
     SPOTS.blocksWay(nodes, [office, older], 1, desk, entrance).length === 0);
  ok('spots and desks on another floor are ignored',
     SPOTS.blocksWay(nodes, [{ ...office, floor: 2 }], 1, desk, entrance).length === 0 &&
     SPOTS.blocksWay(nodes, [office, { ...older, floor: 2 }], 1, desk, entrance).length === 1);
  ok('Other places and empty spots are not checked',
     SPOTS.blocksWay(nodes, [{ ...office, kind: 'other' }, { ...office, id: 'e', kind: undefined }], 1, desk, entrance).length === 0);
  ok('no entrance on the floor: nothing to warn about', SPOTS.blocksWay(nodes, [office], 1, desk, []).length === 0);
  ok('blocksWay does not change its inputs',
     office.kind === 'office' && desk.size === 1 && nodes.filter((n) => !n.wall).length === 10);
}

// ── 2. addDesk without a document ────────────────────────────────────────────
console.log('\n--- addDesk (no document) ---');
const pureBox = {
  console, Promise, Date, JSON, Math,
  STATE: { currentFloor: 1 },
  STAMP_PLACEMENTS: [],
};
vm.createContext(pureBox);
try {
  vm.runInContext(lift('DEPT_CODE') + '\n' + lift('_officeTitle') + '\n' + spotsSrc + '\n' + charterSrc + '\n' + edSrc + '\n' + deskSrc +
    '\n;this.SPOT_EDITOR = SPOT_EDITOR; this.DESK_EDITOR = DESK_EDITOR;', pureBox);
} catch (e) { ok('desk_editor.js loads without a document', false, e.message); }
const DE = pureBox.DESK_EDITOR;
ok('DESK_EDITOR.addDesk exists', !!DE && typeof DE.addDesk === 'function');
ok('SPOT_EDITOR.addDesk exists too', !!pureBox.SPOT_EDITOR && typeof pureBox.SPOT_EDITOR.addDesk === 'function');
if (DE && typeof DE.addDesk === 'function') {
  const d = DE.addDesk(5, 6, { dept: OSCA, deskBehind: true, services: ['Senior Citizens ID'] });
  ok("addDesk returns kind 'desk'", d && d.kind === 'desk', JSON.stringify(d));
  ok('addDesk sets confirmedAt within one second of now',
     d && Math.abs(Date.parse(d.confirmedAt) - Date.now()) < 1000, d && d.confirmedAt);
  ok('addDesk: default size 2, name "OSCA desk", this floor, at the cell',
     d && d.size === 2 && d.name === 'OSCA desk' && d.floor === 1 && d.row === 5 && d.col === 6, JSON.stringify(d));
  ok('addDesk keeps dept, deskBehind and services',
     d && d.dept === OSCA && d.deskBehind === true && JSON.stringify(d.services) === '["Senior Citizens ID"]');
  ok('addDesk puts the desk on the map', pureBox.STAMP_PLACEMENTS.includes(d));
  const e = pureBox.SPOT_EDITOR.addDesk(1, 1, { dept: CSSO, deskBehind: false, services: [], size: 9 });
  ok('SPOT_EDITOR.addDesk makes a desk the same way (size kept between 1 and 4)',
     e && e.kind === 'desk' && e.size === 4 && e.deskBehind === false && pureBox.STAMP_PLACEMENTS.length === 2, JSON.stringify(e));
}

// ── 3. markup, CSS, script tags ──────────────────────────────────────────────
console.log('\n--- index.html / app.css ---');
const block = (id) => {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return '';
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf(`<!-- /${id} -->`, i);
  return end < 0 ? '' : html.slice(start, end);
};
const sheetHtml = block('deskSheet');
ok('index.html has #deskSheet (ends at <!-- /deskSheet -->)', sheetHtml.length > 0);
for (const t of ['Whose desk is this?', 'The office behind it', 'Another office', 'Smaller', 'Larger', 'Remove desk']) {
  ok(`#deskSheet contains "${t}"`, sheetHtml.includes(t));
}
for (const label of ['The office behind it', 'Another office', 'Smaller', 'Larger', 'Remove desk', 'Save']) {
  ok(`#deskSheet has the button "${label}"`, new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`).test(sheetHtml));
}
ok('#deskSheet contains the warning template "This desk blocks the way to"', sheetHtml.includes('This desk blocks the way to'));
ok('  "This desk blocks the way to <names>. Save anyway?", the names filled in by desk_editor.js',
   /This desk blocks the way to <strong id="dsWarnNames"><\/strong>\. Save anyway\?/.test(sheetHtml));
ok('#deskSheet has no emoji', sheetHtml.length > 0 && !EMOJI.test(sheetHtml));
ok('#deskSheet uses the spot sheet look (class spot-sheet: 44 px buttons)', /<section[^>]*id="deskSheet"[^>]*class="[^"]*\bspot-sheet\b/.test(sheetHtml));
{
  let minH = 0;
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (!m[1].split(',').map((s) => s.trim()).includes('.ds-tick')) continue;
    const h = /min-height:\s*(\d+)px/.exec(m[2]);
    if (h) minH = Math.max(minH, +h[1]);
  }
  ok('CSS gives each service tick row (.ds-tick) a min-height of at least 44px', minH >= 44, String(minH));
}
const ver = (file) => { const m = new RegExp(file.replace('.', '\\.') + '\\?v=(\\d+)').exec(html); return m ? +m[1] : 0; };
ok('index.html loads desk_editor.js (bumped to v=2 by the review fixes)', /<script src="js\/desk_editor\.js\?v=2"><\/script>/.test(html));
ok('  after spot_editor.js', html.indexOf('js/desk_editor.js?v=') > html.indexOf('js/spot_editor.js?v='));
ok('spots.js version bumped past 1', ver('spots.js') > 1);
ok('spot_editor.js version bumped past 3', ver('spot_editor.js') > 3);
ok('renderer.js version bumped past 42', ver('renderer.js') > 42);
ok('renderer.js draws the desk sheet\'s draft through DESK_EDITOR.previewList',
   /DESK_EDITOR\.previewList\(STAMP_PLACEMENTS\)/.test(read('wayfinding-app/js/renderer.js')));
ok('desk_editor.js uses the shared picker, not its own copy',
   /SPOT_EDITOR\.makePicker\(/.test(deskSrc) && !/CHARTER_PICK\.suggest\(/.test(deskSrc) && !/checkPick\(/.test(deskSrc));
ok('app.css version bumped past 70', ver('app.css') > 70);
ok('desk_editor.js has no emoji', deskSrc.length > 0 && !EMOJI.test(deskSrc));

// ── 4. the desk sheet on a fake DOM ──────────────────────────────────────────
console.log('\n--- the desk sheet (fake DOM) ---');
class FakeEl {
  constructor(tag, id) {
    this.tagName = String(tag).toUpperCase(); this.id = id || ''; this.children = []; this.parentNode = null;
    this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; this._text = ''; this.className = '';
    this.attrs = {}; this.listeners = {}; this.style = {}; this.type = '';
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : !!on; if (v) this._s.add(c); else this._s.delete(c); return v; },
    };
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
const document = {
  readyState: 'complete',
  getElementById: (id) => (ids[id] = ids[id] || new FakeEl('div', id)),
  createElement: (tag) => new FakeEl(tag),
  addEventListener: () => {},
};
const $ = (id) => document.getElementById(id);
const buttonsIn = (id) => $(id).all().filter((n) => n.tagName === 'BUTTON');
const visible = (id) => { for (let n = $(id); n; n = n.parentNode) if (n.hidden) return false; return !$(id).hidden; };
const ticks = () => $('dsTicks').all().filter((n) => n.tagName === 'INPUT');

// Ground floor (1): walls everywhere except a two-cell-wide corridor (cols 37-38)
// from the main entrance (73,37) up to row 41, and the office spot at 38,36
// (3x3) whose bottom row touches the corridor at 40,37.
const open = [];
for (let r = 40; r <= 74; r++) { open.push(r + ',37'); if (r >= 41) open.push(r + ',38'); }
const NODES = grid(75, 75, open);
const NODE_MAP = Object.fromEntries(NODES.map((n) => [n.id, n]));
const placementsArr = [
  { id: 'osca', name: 'OSCA GF 01', row: 38, col: 36, size: 3, floor: 1, source: 'local',
    kind: 'office', dept: OSCA, services: ['Senior Citizens ID', 'Discount complaints'] },
];
let confirmAnswer = false, confirmAsked = '';
const calls = { saves: 0, recompute: 0, draw: 0, catalogue: 0, lastSaved: null };
const domBox = {
  console, document, Promise, setTimeout, clearTimeout, Date, JSON, Math,
  STATE: { currentFloor: 1, viewMode: 'admin', spotMode: true },
  STAMP_PLACEMENTS: placementsArr,
  REMOVED_REQUIREMENTS: {},
  NODES, NODE_MAP,
  nodeId: (r, c) => r + ',' + c,
  GRID_ROWS: 75, GRID_COLS: 75,
  SERVICE_DEFAULT_ENTRANCE: { floor: 1, row: 73, col: 37 },
  fetch: async (url) => ({ ok: true, json: async () => (/services\.json/.test(url) ? SERVICES : {}) }),
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  confirm: (msg) => { confirmAsked = msg; return confirmAnswer; },
  alert: () => {},
  saveStampPlacements: () => { calls.saves++; calls.lastSaved = JSON.stringify(domBox.STAMP_PLACEMENTS); },
  FLOOR_WALLS: {}, STAMP_PRESETS: [], _floorNames: {},
  saveRemovedRequirements: () => {},
  recompute: () => { calls.recompute++; },
  renderCatalogue: () => { calls.catalogue++; },
  renderer: { _draw: () => { calls.draw++; }, canvas: { clientWidth: 100, clientHeight: 100, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, centerOnCell() {} },
  updateCursorAndHint: () => {},
  _syncDock: () => {},
};
vm.createContext(domBox);
try {
  vm.runInContext(lift('DEPT_CODE') + '\n' + lift('_officeTitle') + '\n' + lift('_buildStatePayload') + '\n' + spotsSrc + '\n' + charterSrc + '\n' + edSrc + '\n' + deskSrc +
    '\n;this.SPOT_EDITOR = SPOT_EDITOR; this.DESK_EDITOR = DESK_EDITOR; this.SPOTS = SPOTS; this._buildStatePayload = _buildStatePayload;', domBox);
} catch (e) { ok('desk_editor.js loads with a document', false, e.message); }
const S = domBox.SPOT_EDITOR;
const desks = () => domBox.STAMP_PLACEMENTS.filter((p) => p.kind === 'desk');
const deskAt = (r, c) => domBox.STAMP_PLACEMENTS.find((p) => p.kind === 'desk' && p.row === r && p.col === c);
// What the map draws while a sheet is open (the draft in place of the saved desk).
const drawnAt = (r, c) => domBox.DESK_EDITOR.previewList(domBox.STAMP_PLACEMENTS).find((p) => p.kind === 'desk' && p.row === r && p.col === c);
const tickByName = (name) => ticks().find((n) => n.parentNode && n.parentNode.textContent.includes(name));

(async () => {
  if (!domBox.DESK_EDITOR) throw new Error('DESK_EDITOR missing');
  await S.loadCharter();

  // A new desk in front of OSCA: "The office behind it", tick boxes, Save.
  S.onTap(55, 38);
  ok('an empty corridor cell offers "Add desk here"', visible('ssAdd') && visible('ssAddDesk'));
  $('ssAddDesk').click();
  ok('"Add desk here" opens the desk sheet, not the spot sheet', visible('deskSheet') && !visible('spotSheet'));
  ok('the new desk sheet starts on "The office behind it"',
     $('dsBehindBtn').getAttribute('aria-pressed') === 'true' && visible('dsBehindStep') && !visible('dsOtherStep'));
  ok('the office in front is preset (OSCA)', /Senior Citizens Affairs/.test($('dsBehindText').textContent), $('dsBehindText').textContent);
  ok('its services are tick boxes', ticks().length === 2 && ticks().every((t) => t.type === 'checkbox'),
     $('dsTicks').textContent);
  const savesBefore = calls.saves;
  ok('the new desk is drawn as a preview but is not in STAMP_PLACEMENTS',
     !!drawnAt(55, 38) && !deskAt(55, 38) && !domBox.STAMP_PLACEMENTS.some((p) => /^new-/.test(p.id)));
  const t1 = tickByName('Senior Citizens ID');
  if (t1) { t1.checked = true; t1.dispatch('change'); }
  $('dsSaveBtn').click();
  const d1 = deskAt(55, 38);
  ok('Save adds the desk', !!d1 && desks().length === 1, JSON.stringify(desks()));
  ok("...kind 'desk', OSCA, behind it, the ticked service, size 2",
     d1 && d1.dept === OSCA && d1.deskBehind === true && JSON.stringify(d1.services) === '["Senior Citizens ID"]' && d1.size === 2,
     JSON.stringify(d1));
  ok('...named "OSCA desk", confirmed now', d1 && d1.name === 'OSCA desk' && Math.abs(Date.parse(d1.confirmedAt) - Date.now()) < 1000);
  ok('...saved, rerouted and redrawn', calls.saves > savesBefore && calls.recompute > 0 && calls.draw > 0);
  ok('...and the sheet closes', !visible('deskSheet'));

  // Tapping an existing desk opens the desk sheet; Smaller and Larger stay between 1 and 4.
  d1.confirmedAt = '2026-01-01T00:00:00.000Z';
  S.onTap(56, 39);
  ok('tapping a desk opens the desk sheet', visible('deskSheet') && !visible('spotSheet'));
  ok('the desk sheet is titled after its office', /Senior Citizens Affairs desk/.test($('deskSheetTitle').textContent), $('deskSheetTitle').textContent);
  ok('its ticked service is ticked', tickByName('Senior Citizens ID').checked && !tickByName('Discount complaints').checked);
  const draws = calls.draw;
  for (let i = 0; i < 4; i++) $('dsLargerBtn').click();
  ok('Larger grows the desk to 4 and stops', drawnAt(55, 38).size === 4 && $('dsLargerBtn').disabled, String(drawnAt(55, 38).size));
  ok('...and redraws the map', calls.draw > draws);
  ok('...but the saved desk is unchanged until Save', deskAt(55, 38).size === 2);
  for (let i = 0; i < 5; i++) $('dsSmallerBtn').click();
  ok('Smaller shrinks it to 1 and stops', drawnAt(55, 38).size === 1 && $('dsSmallerBtn').disabled);
  ok('the desk keeps its top-left cell', !!drawnAt(55, 38));
  // Review fix 1: tapping the open desk again keeps the sheet and its unsaved size.
  $('dsLargerBtn').click();
  S.onTap(55, 38);
  ok('tapping the open desk again keeps the sheet and its unsaved size', visible('deskSheet') && drawnAt(55, 38).size === 2 &&
     $('dsSizeText').textContent === '2 by 2 squares', $('dsSizeText').textContent);
  $('dsLargerBtn').click();
  domBox.DESK_EDITOR.open(d1.id);
  ok('opening the open desk again keeps the draft (size 3) as a draft', drawnAt(55, 38).size === 3 && deskAt(55, 38).size === 2);
  // Review fix 2: the draft never reaches STAMP_PLACEMENTS, a publish or a save.
  ok('with the sheet open, the publish payload has the saved desk, not the draft',
     domBox._buildStatePayload().stampPlacements.find((p) => p.id === d1.id).size === 2);
  $('deskSheetClose').click();
  ok('closing without Save leaves the saved size (the draft was never the original)',
     deskAt(55, 38).size === 2 && drawnAt(55, 38).size === 2 && !visible('deskSheet'));
  S.onTap(55, 38);
  $('dsLargerBtn').click();
  $('dsSaveBtn').click();
  ok('Save keeps the new size', deskAt(55, 38).size === 3);
  ok('editing a desk does not change confirmedAt', deskAt(55, 38).confirmedAt === '2026-01-01T00:00:00.000Z', deskAt(55, 38).confirmedAt);

  // Review fix 1, new desk: tapping its draft keeps the sheet and the work.
  S.onTap(60, 38);
  $('ssAddDesk').click();
  $('dsLargerBtn').click();
  S.onTap(61, 39);
  ok('tapping a new desk\'s draft keeps its sheet', visible('deskSheet') && !visible('spotSheet') && drawnAt(60, 38).size === 3);
  // Review fix 2: a publish or a "Still here?" Confirm while it is open does not take the draft along.
  ok('the publish payload has no draft desk',
     !domBox._buildStatePayload().stampPlacements.some((p) => /^new-/.test(p.id) || (p.row === 60 && p.col === 38)));
  S.confirmDesk(d1.id);
  ok('a "Still here?" Confirm while the sheet is open saves no draft',
     !!calls.lastSaved && !/"new-/.test(calls.lastSaved) && !JSON.parse(calls.lastSaved).some((p) => p.row === 60 && p.col === 38));
  ok('...and the sheet is still open with its work', visible('deskSheet') && drawnAt(60, 38).size === 3);
  $('dsSaveBtn').click();
  ok('Save then adds the new desk with its size', !!deskAt(60, 38) && deskAt(60, 38).size === 3 && !visible('deskSheet'));
  const d60 = deskAt(60, 38);
  // Review fix 2: a map applied while the sheet is open is not overwritten on close.
  S.onTap(60, 38);
  $('dsLargerBtn').click();
  const applied = domBox.STAMP_PLACEMENTS.map((p) => (p.id === d60.id ? { ...p, size: 1 } : { ...p }));
  domBox.STAMP_PLACEMENTS.length = 0;
  domBox.STAMP_PLACEMENTS.push(...applied);   // what _applyStatePayload does
  $('deskSheetClose').click();
  ok('closing after a map was applied keeps the applied map', deskAt(60, 38).size === 1);
  S.onTap(60, 38);
  domBox.STAMP_PLACEMENTS.splice(domBox.STAMP_PLACEMENTS.findIndex((p) => p.id === d60.id), 1);   // removed meanwhile
  $('dsSaveBtn').click();
  ok('saving a desk that was removed meanwhile does not bring it back', !deskAt(60, 38) && !visible('deskSheet'));

  // A desk that blocks the corridor: the walkway check.
  S.onTap(45, 37);
  $('ssAddDesk').click();
  tickByName('Discount complaints').checked = true;
  tickByName('Discount complaints').dispatch('change');
  const s2 = calls.saves;
  $('dsSaveBtn').click();
  ok('a desk across the corridor warns before saving', visible('dsWarn') && calls.saves === s2);
  ok('the warning names the office it cuts off (OSCA GF 01)', $('dsWarnNames').textContent === 'OSCA GF 01', $('dsWarnNames').textContent);
  $('dsSmallerBtn').click();
  ok('changing the size clears the warning', !visible('dsWarn'));
  $('dsSaveBtn').click();
  ok('the check reruns on Save: a size-1 desk leaves the way open and saves', !visible('deskSheet') && deskAt(45, 37) && deskAt(45, 37).size === 1);
  S.onTap(45, 37);
  $('dsLargerBtn').click();
  $('dsSaveBtn').click();
  ok('growing it back across the corridor warns again', visible('dsWarn'));
  $('dsWarnYes').click();
  ok('"Save anyway" saves it', !visible('deskSheet') && deskAt(45, 37).size === 2);

  // Remove desk: one tap plus a confirmation.
  S.onTap(45, 37);
  confirmAnswer = false;
  $('dsRemoveBtn').click();
  ok('Remove desk asks "Remove this desk?"', confirmAsked === 'Remove this desk?', confirmAsked);
  ok('saying no keeps it', !!deskAt(45, 37));
  confirmAnswer = true;
  const s3 = calls.saves;
  $('dsRemoveBtn').click();
  ok('saying yes removes it and saves', !deskAt(45, 37) && calls.saves > s3 && !visible('deskSheet'));

  // Another office: the type-ahead, then services as in the spot sheet.
  S.onTap(65, 38);
  $('ssAddDesk').click();
  await new Promise((r) => setTimeout(r, 0));   // the sheet's Charter load settles
  $('dsOtherBtn').click();
  ok('"Another office" shows the office type-ahead', visible('dsOtherStep') && !visible('dsBehindStep'));
  $('dsOfficeInput').value = 'Department of Magic';
  $('dsOfficeInput').dispatch('keydown', { key: 'Enter' });
  ok('an office not in the Charter shows NO_MATCH', $('dsOfficeMsg').textContent.includes(NO_MATCH));
  $('dsOfficeInput').value = 'social';
  $('dsOfficeInput').dispatch('input');
  const pick = buttonsIn('dsOfficeSuggest').find((b) => /Social Services/i.test(b.textContent));
  ok('office type-ahead suggests CSSO', !!pick, $('dsOfficeSuggest').textContent);
  if (pick) pick.click();
  ok('picking CSSO pre-fills its Charter services', /Burial Assistance/.test($('dsServiceChips').textContent), $('dsServiceChips').textContent);
  const x = buttonsIn('dsServiceChips').find((b) => b.textContent === 'x');
  if (x) x.click();
  ok('x removes a service', !/Burial Assistance/.test($('dsServiceChips').textContent));
  $('dsServiceInput').value = 'Free lunch';
  $('dsServiceInput').dispatch('keydown', { key: 'Enter' });
  ok('a service not in the Charter shows NO_MATCH', $('dsServiceMsg').textContent.includes(NO_MATCH));
  $('dsServiceInput').value = 'burial';
  $('dsServiceInput').dispatch('input');
  const sp = buttonsIn('dsServiceSuggest').find((b) => /Burial Assistance/.test(b.textContent));
  if (sp) sp.click();
  ok('the service type-ahead adds a Charter service', /Burial Assistance/.test($('dsServiceChips').textContent));
  $('dsSaveBtn').click();
  const d3 = deskAt(65, 38);
  ok('Save makes a CSSO desk that is not the office behind it',
     d3 && d3.dept === CSSO && d3.deskBehind === false && JSON.stringify(d3.services) === '["Burial Assistance"]' && d3.name === 'CSSO desk',
     JSON.stringify(d3));

  // Review fix 4: "The office behind it" with nothing ticked is the line-up-here desk.
  S.onTap(70, 38);
  $('ssAddDesk').click();
  ok('nothing is ticked on a new desk', ticks().length === 2 && ticks().every((t) => !t.checked));
  $('dsSaveBtn').click();
  const d70 = deskAt(70, 38);
  ok('Save with nothing ticked saves an OSCA desk behind it with no services',
     !!d70 && d70.dept === OSCA && d70.deskBehind === true && Array.isArray(d70.services) && d70.services.length === 0 && !visible('deskSheet'),
     JSON.stringify(d70));

  // No office in front (2nd floor has none): falls back to "Another office".
  domBox.STATE.currentFloor = 2;
  const n = domBox.STAMP_PLACEMENTS.length;
  S.onTap(60, 37);
  $('ssAddDesk').click();
  ok('no office in front: "Another office" is chosen', $('dsOtherBtn').getAttribute('aria-pressed') === 'true' && visible('dsOtherStep'));
  ok('...and the sheet says "No office is in front of this desk yet."',
     visible('dsNoFront') && $('dsNoFront').textContent === 'No office is in front of this desk yet.');
  ok('...and "The office behind it" cannot be chosen', $('dsBehindBtn').disabled);
  $('deskSheetClose').click();
  ok('closing a new desk without Save adds nothing', domBox.STAMP_PLACEMENTS.length === n && !deskAt(60, 37));
  domBox.STATE.currentFloor = 1;

  // Opening a spot closes the desk sheet; leaving Offices mode closes it too.
  S.onTap(55, 38);
  S.onTap(39, 37);
  ok('tapping an office spot swaps the desk sheet for the spot sheet', visible('spotSheet') && !visible('deskSheet'));
  S.onTap(55, 38);
  S.setMode(false);
  ok('leaving Offices mode closes the desk sheet', !visible('deskSheet'));

  ok('the sheet builds no emoji', !EMOJI.test($('deskSheet').textContent + $('dsTicks').textContent + $('dsServiceChips').textContent));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL  crashed: ' + e.stack); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
