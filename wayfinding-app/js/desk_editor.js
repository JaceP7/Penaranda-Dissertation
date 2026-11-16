/**
 * desk_editor.js - the desk sheet in the map editor's Offices mode (global DESK_EDITOR).
 *
 * Why: some services are handled at a desk out in the corridor, often in front
 * of the office that runs it (the OSCA desk in front of CSWD). A desk is a
 * spot with kind 'desk' (see spots.js): it says whose desk it is, which
 * services it handles, and it takes up floor space, so routes go around it.
 * The sheet answers "Whose desk is this?":
 *   - "The office behind it": the office in front of the desk (SPOTS.frontOf),
 *     with that office's services as tick boxes;
 *   - "Another office": the Charter office type-ahead, then services as in the
 *     spot sheet.
 * Smaller and Larger set the size (1 to 4 cells a side, top-left kept). Save
 * first checks the walkway (SPOTS.blocksWay) and asks before cutting an
 * office off from the entrance. Remove desk takes one tap and a confirmation.
 *
 * While the sheet is open the desk on the map is a preview: size changes show
 * at once, and closing without Save puts the desk back as it was (or takes a
 * new desk away again). Only Save and Remove desk change the saved map.
 *
 * Loads after spot_editor.js (uses SPOT_EDITOR.loadCharter, checkPick and
 * servicesByDept). Safe to load without a document (the tests run it in a vm).
 */
const DESK_EDITOR = (() => {
  'use strict';

  const DEFAULT_SIZE = 2;
  const MIN_SIZE = 1;
  const MAX_SIZE = 4;

  const placements = () => (typeof STAMP_PLACEMENTS !== 'undefined' ? STAMP_PLACEMENTS : []);
  const hasDoc = () => typeof document !== 'undefined';
  const el = (id) => (hasDoc() ? document.getElementById(id) : null);
  const title = (name) => (typeof _officeTitle === 'function' ? _officeTitle(name) : String(name || ''));
  const deptCode = (d) => (typeof DEPT_CODE === 'function' ? DEPT_CODE(d) : String(d || '').slice(0, 6).toUpperCase());
  const floorNow = () => (typeof STATE !== 'undefined' ? STATE.currentFloor : 0);
  const clampSize = (n) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(Number(n) || DEFAULT_SIZE)));
  const deskName = (dept) => (dept ? deptCode(dept) + ' desk' : 'Desk');

  /** Keep a desk of `size` on the grid without moving its top-left more than it must. */
  function fitOnGrid(row, col, size) {
    const rows = typeof GRID_ROWS !== 'undefined' ? GRID_ROWS : 75;
    const cols = typeof GRID_COLS !== 'undefined' ? GRID_COLS : 75;
    return { row: Math.max(0, Math.min(rows - size, row)), col: Math.max(0, Math.min(cols - size, col)) };
  }

  function replacePlacements(next) {
    const list = placements();
    list.length = 0;
    list.push(...next);
  }

  /** After a saved change: save, reroute, redraw, refresh the Offices panel and draft badge. */
  function afterEdit() {
    if (typeof saveStampPlacements === 'function') saveStampPlacements();
    const r = (typeof renderer !== 'undefined') ? renderer : null;
    if (r && typeof recompute === 'function') recompute();
    if (r) r._draw();
    if (r && typeof renderCatalogue === 'function') renderCatalogue();
    else if (typeof SPOT_EDITOR !== 'undefined') SPOT_EDITOR.refreshPanel();
    if (typeof _scheduleDraftBadge === 'function') _scheduleDraftBadge();
  }

  function redraw() {
    if (typeof renderer !== 'undefined' && renderer) renderer._draw();
  }

  /**
   * Put a desk on the map at (row, col) on the current floor and save it.
   * opts: { dept, deskBehind, services, size } (size 1-4, default 2).
   * confirmedAt is now: a new desk is known to be there.
   */
  function addDesk(row, col, opts) {
    opts = opts || {};
    const size = clampSize(opts.size == null ? DEFAULT_SIZE : opts.size);
    const at = fitOnGrid(row, col, size);
    const desk = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: deskName(opts.dept),
      row: at.row, col: at.col, size, floor: floorNow(), source: 'local',
      kind: 'desk',
      dept: opts.dept || '',
      deskBehind: !!opts.deskBehind,
      services: [...(opts.services || [])],
      confirmedAt: new Date().toISOString(),
    };
    placements().push(desk);
    afterEdit();
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

  // While open: { id, isNew, original, mode: 'behind'|'other', dept, services, ticked }
  let sheet = null;
  let charter = null;

  const PICKS = {
    office:  { input: 'dsOfficeInput',  list: 'dsOfficeSuggest',  msg: 'dsOfficeMsg' },
    service: { input: 'dsServiceInput', list: 'dsServiceSuggest', msg: 'dsServiceMsg' },
  };
  const findDesk = (id) => placements().find((p) => p.id === id);
  const show = (id, on) => { const n = el(id); if (n) n.hidden = !on; };
  const setText = (id, t) => { const n = el(id); if (n) n.textContent = t; };
  const valueOf = (id) => { const n = el(id); return n ? String(n.value || '') : ''; };
  const setValue = (id, v) => { const n = el(id); if (n) n.value = v; };
  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(cls, text, fn, label) {
    const b = make('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }
  function floorLabel(f) {
    if (typeof _floorLabel === 'function') return _floorLabel(f);
    return 'Floor ' + f;
  }

  /** The office spot in front of the desk as it is drawn now, or null. */
  const front = () => {
    const d = sheet && findDesk(sheet.id);
    return d ? SPOTS.frontOf(placements(), d) : null;
  };

  /** The services the front office handles: its spot's list, or its Charter list. */
  function frontServices(f) {
    if (!f) return [];
    if ((f.services || []).length) return [...f.services];
    return charter ? [...((SPOT_EDITOR.servicesByDept(charter)[f.dept]) || [])] : [];
  }

  function loadCharter() {
    if (charter || typeof SPOT_EDITOR === 'undefined') return;
    SPOT_EDITOR.loadCharter().then((index) => { charter = index; if (sheet) render(); })
      .catch(() => { if (sheet) say("Could not load the Citizen's Charter. Check the connection and try again."); });
  }

  /** Open the sheet for a desk that is not on the map yet, at (row, col). */
  function openNew(row, col, floor) {
    if (!hasDoc()) return;
    close();
    const at = fitOnGrid(row, col, DEFAULT_SIZE);
    const preview = {
      id: 'new-' + Date.now().toString(36), name: 'Desk', row: at.row, col: at.col, size: DEFAULT_SIZE,
      floor: floor == null ? floorNow() : floor, source: 'local', kind: 'desk', dept: '',
      deskBehind: true, services: [], confirmedAt: new Date().toISOString(),
    };
    placements().push(preview);
    start(preview, true);
  }

  /** Open the sheet for a desk already on the map. */
  function open(id) {
    if (!hasDoc()) return;
    const d = findDesk(id);
    if (!d || d.kind !== 'desk') return;
    close();
    start(d, false);
  }

  function start(d, isNew) {
    if (typeof SPOT_EDITOR !== 'undefined') SPOT_EDITOR.closeSheet();
    const draft = { ...d, services: [...(d.services || [])] };
    replacePlacements(placements().map((p) => (p.id === d.id ? draft : p)));
    sheet = {
      id: d.id, isNew, original: isNew ? null : d,
      mode: isNew || d.deskBehind ? 'behind' : 'other',
      dept: !isNew && !d.deskBehind ? (d.dept || '') : '',
      services: !isNew && !d.deskBehind ? [...(d.services || [])] : [],
      ticked: !isNew && d.deskBehind ? [...(d.services || [])] : [],
    };
    if (!front()) sheet.mode = 'other';
    setValue('dsOfficeInput', sheet.dept ? title(sheet.dept) : '');
    setValue('dsServiceInput', '');
    for (const k of Object.keys(PICKS)) clearPick(k);
    say('');
    hideWarn();
    show('deskSheet', true);
    render();
    redraw();
    loadCharter();
  }

  /** Close without saving: the desk goes back to how it was (a new one goes away). */
  function close() {
    if (!sheet) { show('deskSheet', false); return; }
    const s = sheet;
    sheet = null;
    if (s.isNew) replacePlacements(placements().filter((p) => p.id !== s.id));
    else replacePlacements(placements().map((p) => (p.id === s.id ? s.original : p)));
    show('deskSheet', false);
    redraw();
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
    const d = findDesk(sheet.id);
    if (!d) return;
    const size = clampSize((d.size || 1) + delta);
    if (size === d.size) return;
    const at = fitOnGrid(d.row, d.col, size);
    replacePlacements(placements().map((p) => (p.id === d.id ? { ...p, size, row: at.row, col: at.col } : p)));
    hideWarn();
    render();
    redraw();
  }

  function render() {
    if (!sheet) return;
    const d = findDesk(sheet.id);
    if (!d) { sheet = null; show('deskSheet', false); return; }
    const f = front();
    if (sheet.mode === 'behind' && !f) sheet.mode = 'other';
    const m = sheet.mode;
    // The preview shows whose desk it is now (the map draws a desk only once it has an office).
    const want = m === 'behind' ? f.dept : sheet.dept;
    if (want && want !== d.dept) {
      replacePlacements(placements().map((p) => (p.id === d.id ? { ...p, dept: want } : p)));
      redraw();
    }
    const dept = want || d.dept;
    setText('deskSheetTitle', sheet.isNew ? 'New desk' : (dept ? title(dept) + ' desk' : 'Desk'));
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
    for (const k of Object.keys(PICKS)) { const n = el(PICKS[k].input); if (n) n.disabled = !charter; }
    if (m === 'behind') renderTicks(f); else renderChips();
    const size = d.size || 1;
    setText('dsSizeText', `${size} by ${size} squares`);
    const smaller = el('dsSmallerBtn'), larger = el('dsLargerBtn');
    if (smaller) smaller.disabled = size <= MIN_SIZE;
    if (larger) larger.disabled = size >= MAX_SIZE;
  }

  function renderTicks(f) {
    setText('dsBehindText', f ? `This desk serves ${title(f.dept)}, the office behind it. Tick the services handled here.` : '');
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

  // ── Type-aheads (office, service): Charter values only ──────────────────────

  const pickOpts = (kind) => (kind === 'service' ? { dept: sheet.dept } : {});

  function clearPick(kind) {
    const c = PICKS[kind];
    const l = el(c.list);
    if (l) l.textContent = '';
    setText(c.msg, '');
    show(c.msg, false);
  }

  function choiceItem(kind, value) {
    const li = make('li', 'ss-suggest-item');
    li.appendChild(button('ss-suggest-btn', kind === 'office' ? title(value) : value, () => choose(kind, value)));
    return li;
  }

  function suggestFor(kind) {
    if (!sheet || !charter) return;
    clearPick(kind);
    const hits = CHARTER_PICK.suggest(charter, kind, valueOf(PICKS[kind].input), pickOpts(kind), 6);
    const list = el(PICKS[kind].list);
    if (list) for (const h of hits) list.appendChild(choiceItem(kind, h.value));
  }

  /** Enter in a type-ahead: take the typed text only if the Charter has it. */
  function typedPick(kind) {
    if (!sheet || !charter) return;
    const c = PICKS[kind];
    const text = valueOf(c.input);
    if (!text.trim()) return;
    const r = SPOT_EDITOR.checkPick(charter, kind, text, pickOpts(kind));
    if (r.ok) { choose(kind, r.value); return; }
    clearPick(kind);
    const m = el(c.msg);
    if (!m) return;
    m.appendChild(make('span', 'ss-nomatch-text', r.message));
    if (r.closest.length) {
      m.appendChild(make('span', 'ss-closest-lbl', 'Closest in the Charter:'));
      const ul = make('ul', 'ss-suggest');
      for (const x of r.closest) ul.appendChild(choiceItem(kind, x.value));
      m.appendChild(ul);
    }
    m.hidden = false;
  }

  function choose(kind, value) {
    if (!sheet) return;
    clearPick(kind);
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

  function wirePick(kind) {
    const n = el(PICKS[kind].input);
    if (!n) return;
    n.addEventListener('input', () => suggestFor(kind));
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); typedPick(kind); } });
  }

  // ── Save and Remove desk ───────────────────────────────────────────────────

  /** What Save would write, or { error } in plain words. */
  function chosen() {
    if (sheet.mode === 'behind') {
      const f = front();
      if (!f) return { error: 'No office is in front of this desk yet. Choose Another office.' };
      if (!sheet.ticked.length) return { error: 'Tick at least one service this desk handles.' };
      const offered = frontServices(f);
      const services = [...offered.filter((s) => sheet.ticked.includes(s)),
        ...sheet.ticked.filter((s) => !offered.includes(s))];
      return { dept: f.dept, deskBehind: true, services };
    }
    const text = valueOf('dsOfficeInput').trim();
    if (text && charter && CHARTER_PICK.fold(text) !== CHARTER_PICK.fold(title(sheet.dept)) &&
        CHARTER_PICK.fold(text) !== CHARTER_PICK.fold(sheet.dept)) {
      const r = SPOT_EDITOR.checkPick(charter, 'office', text);   // typed, not picked from the list
      if (!r.ok) { typedPick('office'); return { error: "Pick an office from the Citizen's Charter." }; }
      choose('office', r.value);
    }
    if (!text || !sheet.dept) return { error: "Pick an office from the Citizen's Charter." };
    return { dept: sheet.dept, deskBehind: false, services: [...sheet.services] };
  }

  function save(anyway) {
    if (!sheet) return;
    const d = findDesk(sheet.id);
    if (!d) { close(); return; }
    const a = chosen();
    if (a.error) { say(a.error); return; }
    say('');
    if (!anyway) {
      const names = blockedBy({ ...d, ...a });
      if (names.length) {
        setText('dsWarnNames', listNames(names));
        show('dsWarn', true);
        return;
      }
    }
    hideWarn();
    const s = sheet;
    sheet = null;
    show('deskSheet', false);
    if (s.isNew) {
      replacePlacements(placements().filter((p) => p.id !== s.id));
      addDesk(d.row, d.col, { ...a, size: d.size });   // sets confirmedAt
      return;
    }
    // An edit keeps confirmedAt: only "Still here?" Confirm changes it.
    const saved = { ...d, ...a, name: deskName(a.dept), confirmedAt: s.original.confirmedAt };
    if (!('confirmedAt' in s.original)) delete saved.confirmedAt;
    replacePlacements(placements().map((p) => (p.id === s.id ? saved : p)));
    afterEdit();
  }

  function removeDesk() {
    if (!sheet || !confirm('Remove this desk?')) return;
    const s = sheet;
    sheet = null;
    show('deskSheet', false);
    replacePlacements(placements().filter((p) => p.id !== s.id));
    if (s.isNew) { redraw(); return; }   // never saved: nothing to save
    afterEdit();
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
    for (const k of Object.keys(PICKS)) wirePick(k);
  }

  if (hasDoc()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { addDesk, openNew, open, close, isOpen, entranceFor };
})();
