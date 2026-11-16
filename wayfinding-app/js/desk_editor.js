/**
 * desk_editor.js - the desk sheet in the map editor's Offices mode (global DESK_EDITOR).
 *
 * Why: some services are handled at a desk out in the corridor, often in front
 * of the office that runs it (the OSCA desk in front of CSWD). A desk is a
 * spot with kind 'desk' (see spots.js): it says whose desk it is, which
 * services it handles, and it takes up floor space, so routes go around it.
 * The sheet answers "Whose desk is this?":
 *   - "The office behind it": the office in front of the desk (SPOTS.frontOf),
 *     with that office's services as tick boxes. None ticked is allowed: that
 *     is the "line up here first" desk for the whole office.
 *   - "Another office": the Charter office type-ahead, then services as in the
 *     spot sheet.
 * Smaller and Larger set the size (1 to 4 cells a side, top-left kept). Save
 * first checks the walkway (SPOTS.blocksWay) and asks before cutting an
 * office off from the entrance. Remove desk takes one tap and a confirmation.
 *
 * While the sheet is open its changes live in a draft that is never put in
 * STAMP_PLACEMENTS, so a publish, a save or a map applied meanwhile never sees
 * it. The renderer draws the draft in place of the saved desk (previewList).
 * Only Save and Remove desk change the map.
 *
 * Loads after spot_editor.js and uses its shared pieces: loadCharter,
 * servicesByDept, makePicker (the Charter-only type-ahead), afterEdit and the
 * dom helpers. Safe to load without a document (the tests run it in a vm).
 */
const DESK_EDITOR = (() => {
  'use strict';

  const DEFAULT_SIZE = 2;
  const MIN_SIZE = 1;
  const MAX_SIZE = 4;

  const U = SPOT_EDITOR.dom;
  const { el, make, button, show, setText, setValue, floorLabel, title } = U;
  const placements = () => (typeof STAMP_PLACEMENTS !== 'undefined' ? STAMP_PLACEMENTS : []);
  const hasDoc = () => typeof document !== 'undefined';
  const deptCode = (d) => (typeof DEPT_CODE === 'function' ? DEPT_CODE(d) : String(d || '').slice(0, 6).toUpperCase());
  const floorNow = () => (typeof STATE !== 'undefined' ? STATE.currentFloor : 0);
  const clampSize = (n) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(Number(n) || DEFAULT_SIZE)));
  const deskName = (dept) => (dept ? deptCode(dept) + ' desk' : 'Desk');
  const findDesk = (id) => placements().find((p) => p.id === id);

  /** Keep a desk of `size` on the grid without moving its top-left more than it must. */
  function fitOnGrid(row, col, size) {
    const rows = typeof GRID_ROWS !== 'undefined' ? GRID_ROWS : 75;
    const cols = typeof GRID_COLS !== 'undefined' ? GRID_COLS : 75;
    return { row: Math.max(0, Math.min(rows - size, row)), col: Math.max(0, Math.min(cols - size, col)) };
  }

  function redraw() {
    if (typeof renderer !== 'undefined' && renderer) renderer._draw();
  }

  /**
   * Put a desk on the map at (row, col) on the current floor and save it.
   * opts: { dept, deskBehind, services, size, floor } (size 1-4, default 2;
   * floor defaults to the floor on screen). Returns null, adding nothing,
   * on a map whose old markers have not been moved to spots yet.
   * confirmedAt is now: a new desk is known to be there.
   */
  function addDesk(row, col, opts) {
    opts = opts || {};
    if (!SPOT_EDITOR.migrated()) return null;   // before "Move them": see spot_editor.js migrated()
    const size = clampSize(opts.size == null ? DEFAULT_SIZE : opts.size);
    const at = fitOnGrid(row, col, size);
    const desk = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: deskName(opts.dept),
      row: at.row, col: at.col, size, floor: typeof opts.floor === 'number' ? opts.floor : floorNow(), source: 'local',
      kind: 'desk',
      dept: opts.dept || '',
      deskBehind: !!opts.deskBehind,
      services: [...(opts.services || [])],
      confirmedAt: new Date().toISOString(),
    };
    placements().push(desk);
    SPOT_EDITOR.afterEdit();
    return desk;
  }

  /** Where people come in on `floor`: the main entrance on its floor, elsewhere every stair cell. */
  function entranceFor(floor) {
    const main = typeof SERVICE_DEFAULT_ENTRANCE !== 'undefined' ? SERVICE_DEFAULT_ENTRANCE : null;
    if (main && main.floor === floor) return [{ row: main.row, col: main.col }];
    const nodes = typeof NODES !== 'undefined' ? NODES : [];
    return nodes.filter((n) => n.cellType === 'stair').map((n) => ({ row: n.row, col: n.col }));
  }

  /** Office names this desk would cut off. NODES is the floor on screen, so other floors are not checked. */
  function blockedBy(desk) {
    if (typeof NODES === 'undefined' || desk.floor !== floorNow()) return [];
    return SPOTS.blocksWay(NODES, placements(), desk.floor, desk, entranceFor(desk.floor));
  }

  /** "A", "A and B", "A, B and C". */
  function listNames(names) {
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // ── The sheet ──────────────────────────────────────────────────────────────

  // While open: { id, isNew, draft, mode: 'behind'|'other', dept, services, ticked }
  let sheet = null;
  let charter = null;
  const pickers = {};   // 'office' | 'service' -> SPOT_EDITOR.makePicker, made in init()

  /** What the map draws: `list` with the open sheet's draft in place of its desk (or added, when new). */
  function previewList(list) {
    if (!sheet) return list;
    const out = list.map((p) => (p.id === sheet.id ? sheet.draft : p));
    if (sheet.isNew) out.push(sheet.draft);
    return out;
  }

  /** Is (row, col) on `floor` part of the desk being edited? Such a tap keeps the sheet. */
  function owns(floor, row, col) {
    if (!sheet) return false;
    const d = sheet.draft, s = d.size || 1;
    return d.floor === floor && row >= d.row && row < d.row + s && col >= d.col && col < d.col + s;
  }

  /** The office spot in front of the draft desk, or null. */
  const front = () => (sheet ? SPOTS.frontOf(placements(), sheet.draft) : null);

  /** The services the front office handles: its spot's list, or its Charter list. */
  function frontServices(f) {
    if (!f) return [];
    if ((f.services || []).length) return [...f.services];
    return charter ? [...(SPOT_EDITOR.servicesByDept(charter)[f.dept] || [])] : [];
  }

  function loadCharter() {
    if (charter) return;
    SPOT_EDITOR.loadCharter().then((index) => { charter = index; if (sheet) render(); })
      .catch(() => { if (sheet) say("Could not load the Citizen's Charter. Check the connection and try again."); });
  }

  /** Open the sheet for a desk that is not on the map yet, at (row, col). */
  function openNew(row, col, floor) {
    if (!hasDoc() || !SPOT_EDITOR.migrated()) return;
    close();
    const at = fitOnGrid(row, col, DEFAULT_SIZE);
    start({
      id: 'new-' + Date.now().toString(36), name: 'Desk', row: at.row, col: at.col, size: DEFAULT_SIZE,
      floor: floor == null ? floorNow() : floor, source: 'local', kind: 'desk', dept: '',
      deskBehind: true, services: [],
    }, true);
  }

  /** Open the sheet for a desk already on the map. Opening the desk already open keeps its changes. */
  function open(id) {
    if (!hasDoc() || (sheet && sheet.id === id)) return;
    close();
    const d = findDesk(id);
    if (!d || d.kind !== 'desk') return;
    start(d, false);
  }

  function start(d, isNew) {
    SPOT_EDITOR.closeSheet();
    sheet = {
      id: d.id, isNew,
      draft: { ...d, services: [...(d.services || [])] },
      mode: isNew || d.deskBehind ? 'behind' : 'other',
      dept: !isNew && !d.deskBehind ? (d.dept || '') : '',
      services: !isNew && !d.deskBehind ? [...(d.services || [])] : [],
      ticked: !isNew && d.deskBehind ? [...(d.services || [])] : [],
    };
    if (!front()) sheet.mode = 'other';
    setValue('dsOfficeInput', sheet.dept ? title(sheet.dept) : '');
    setValue('dsServiceInput', '');
    for (const k of Object.keys(pickers)) pickers[k].clear();
    say('');
    hideWarn();
    show('deskSheet', true);
    render();
    redraw();
    loadCharter();
  }

  /** Close without saving. The map never held the draft, so nothing needs undoing. */
  function close() {
    const was = !!sheet;
    sheet = null;
    show('deskSheet', false);
    if (was) redraw();
  }

  const isOpen = () => !!sheet;

  function say(text) {
    setText('dsMsg', text);
    show('dsMsg', !!text);
  }
  function hideWarn() {
    setText('dsWarnNames', '');
    show('dsWarn', false);
  }

  function setMode(mode) {
    if (!sheet || (mode === 'behind' && !front())) return;
    sheet.mode = mode;
    say('');
    hideWarn();
    render();
  }

  function setSize(delta) {
    if (!sheet) return;
    const d = sheet.draft;
    const size = clampSize((d.size || 1) + delta);
    if (size === d.size) return;
    const at = fitOnGrid(d.row, d.col, size);
    sheet.draft = { ...d, size, row: at.row, col: at.col };
    hideWarn();
    render();
    redraw();
  }

  function render() {
    if (!sheet) return;
    if (!sheet.isNew && !findDesk(sheet.id)) { close(); return; }   // removed or replaced meanwhile
    const f = front();
    if (sheet.mode === 'behind' && !f) sheet.mode = 'other';
    const m = sheet.mode;
    // The preview shows whose desk it is now (the map draws a desk only once it has an office).
    const want = m === 'behind' ? f.dept : sheet.dept;
    if (want && want !== sheet.draft.dept) { sheet.draft = { ...sheet.draft, dept: want }; redraw(); }
    const d = sheet.draft;
    setText('deskSheetTitle', sheet.isNew ? 'New desk' : (d.dept ? title(d.dept) + ' desk' : 'Desk'));
    setText('deskSheetSub', floorLabel(d.floor));
    for (const [id, mode] of [['dsBehindBtn', 'behind'], ['dsOtherBtn', 'other']]) {
      const b = el(id);
      if (!b) continue;
      b.setAttribute('aria-pressed', String(m === mode));
      b.classList.toggle('active', m === mode);
    }
    const behindBtn = el('dsBehindBtn');
    if (behindBtn) behindBtn.disabled = !f;
    setText('dsNoFront', f ? '' : 'No office is in front of this desk yet.');
    show('dsNoFront', !f);
    show('dsBehindStep', m === 'behind');
    show('dsOtherStep', m === 'other');
    show('dsLoading', m === 'other' && !charter);
    for (const id of ['dsOfficeInput', 'dsServiceInput']) { const n = el(id); if (n) n.disabled = !charter; }
    if (m === 'behind') renderTicks(f); else renderChips();
    const size = d.size || 1;
    setText('dsSizeText', `${size} by ${size} squares`);
    const smaller = el('dsSmallerBtn'), larger = el('dsLargerBtn');
    if (smaller) smaller.disabled = size <= MIN_SIZE;
    if (larger) larger.disabled = size >= MAX_SIZE;
  }

  function renderTicks(f) {
    setText('dsBehindText', f ? `This desk serves ${title(f.dept)}, the office behind it. ` +
      'Tick the services handled here, or none if people line up here first for any of them.' : '');
    const list = el('dsTicks');
    if (!list) return;
    list.textContent = '';
    const names = frontServices(f);
    for (const s of sheet.ticked) if (!names.includes(s)) names.push(s);
    if (!names.length) {
      list.appendChild(make('li', 'ss-empty', charter ? 'This office has no services listed.' : "Loading the Citizen's Charter..."));
      return;
    }
    for (const s of names) {
      const li = make('li', 'ds-tick-item');
      const label = make('label', 'ds-tick');
      const box = make('input', 'ds-tick-box');
      box.type = 'checkbox';
      box.checked = sheet.ticked.includes(s);
      box.addEventListener('change', () => {
        sheet.ticked = sheet.ticked.filter((v) => v !== s);
        if (box.checked) sheet.ticked.push(s);
        say('');
        hideWarn();
      });
      label.appendChild(box);
      label.appendChild(make('span', 'ds-tick-text', s));
      li.appendChild(label);
      list.appendChild(li);
    }
  }

  function renderChips() {
    const list = el('dsServiceChips');
    if (!list) return;
    list.textContent = '';
    if (!sheet.services.length) list.appendChild(make('li', 'ss-empty', 'No services yet. Add one below.'));
    for (const s of sheet.services) {
      const li = make('li', 'ss-chip');
      li.appendChild(make('span', 'ss-chip-text', s));
      li.appendChild(button('ss-chip-x', 'x', () => {
        sheet.services = sheet.services.filter((v) => v !== s);
        hideWarn();
        render();
      }, 'Remove ' + s));
      list.appendChild(li);
    }
  }

  /** A pick from the office or service type-ahead (always a Charter value). */
  function choose(kind, value) {
    if (!sheet) return;
    pickers[kind].clear();
    hideWarn();
    if (kind === 'office') {
      sheet.dept = value;
      sheet.services = [...(SPOT_EDITOR.servicesByDept(charter)[value] || [])];   // its Charter services
      setValue('dsOfficeInput', title(value));
    } else {
      if (!sheet.services.includes(value)) sheet.services.push(value);
      setValue('dsServiceInput', '');
    }
    render();
  }

  // ── Save and Remove desk ───────────────────────────────────────────────────

  /** What Save would write, or { error } in plain words. */
  function chosen() {
    if (sheet.mode === 'behind') {
      const f = front();
      if (!f) return { error: 'No office is in front of this desk yet. Choose Another office.' };
      const offered = frontServices(f);
      const services = [...offered.filter((s) => sheet.ticked.includes(s)),
        ...sheet.ticked.filter((s) => !offered.includes(s))];
      return { dept: f.dept, deskBehind: true, services };   // none ticked: the line-up-here desk
    }
    if (pickers.office && !pickers.office.settle(sheet.dept)) return { error: "Pick an office from the Citizen's Charter." };
    if (!U.valueOf('dsOfficeInput').trim() || !sheet.dept) return { error: "Pick an office from the Citizen's Charter." };
    return { dept: sheet.dept, deskBehind: false, services: [...sheet.services] };
  }

  function save(anyway) {
    if (!sheet) return;
    const saved = sheet.isNew ? null : findDesk(sheet.id);
    if (!sheet.isNew && !saved) { close(); return; }   // removed or replaced meanwhile
    const a = chosen();
    if (a.error) { say(a.error); return; }
    say('');
    const d = sheet.draft;
    if (!anyway) {
      const names = blockedBy({ ...d, ...a });
      if (names.length) {
        setText('dsWarnNames', listNames(names));
        show('dsWarn', true);
        return;
      }
    }
    const s = sheet;
    close();
    if (s.isNew) { addDesk(d.row, d.col, { ...a, size: d.size, floor: d.floor }); return; }   // sets confirmedAt
    // An edit keeps the desk's current confirmedAt: only "Still here?" Confirm changes it.
    const next = { ...saved, row: d.row, col: d.col, size: d.size, ...a, name: deskName(a.dept) };
    const list = placements();
    list.splice(list.indexOf(saved), 1, next);
    SPOT_EDITOR.afterEdit();
  }

  function removeDesk() {
    if (!sheet || !confirm('Remove this desk?')) return;
    const s = sheet;
    close();
    if (s.isNew) return;   // never on the map
    const list = placements();
    const i = list.findIndex((p) => p.id === s.id);
    if (i < 0) return;
    list.splice(i, 1);
    SPOT_EDITOR.afterEdit();
  }

  function init() {
    const on = (id, fn) => { const b = el(id); if (b) b.addEventListener('click', fn); };
    on('deskSheetClose', close);
    on('dsBehindBtn', () => setMode('behind'));
    on('dsOtherBtn', () => setMode('other'));
    on('dsSmallerBtn', () => setSize(-1));
    on('dsLargerBtn', () => setSize(1));
    on('dsSaveBtn', () => save(false));
    on('dsWarnYes', () => save(true));
    on('dsWarnNo', hideWarn);
    on('dsRemoveBtn', removeDesk);
    const ids = {
      office:  { input: 'dsOfficeInput',  list: 'dsOfficeSuggest',  msg: 'dsOfficeMsg' },
      service: { input: 'dsServiceInput', list: 'dsServiceSuggest', msg: 'dsServiceMsg' },
    };
    for (const kind of Object.keys(ids)) {
      pickers[kind] = SPOT_EDITOR.makePicker({
        kind, ...ids[kind],
        index: () => (sheet && charter ? charter : null),
        opts: () => (kind === 'service' ? { dept: sheet.dept } : {}),
        onPick: (v) => choose(kind, v),
      });
    }
  }

  if (hasDoc()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { addDesk, openNew, open, close, isOpen, owns, previewList, entranceFor };
})();
