/**
 * spot_editor.js - the map editor's Offices panel (global SPOT_EDITOR).
 *
 * Why: office stamps are becoming spots that say which Charter office stands
 * there (see spots.js). An old map has to be moved over once, and after that an
 * admin needs one place that lists what still needs a person's eye:
 *   - the migration banner, while the loaded map still uses the old markers;
 *   - "Check these": markers the move could not match to exactly one office;
 *   - "Not on the map yet": Charter offices with no spot or desk of their own;
 *   - "Still here?": desks not confirmed for 30 days, with Confirm and Remove.
 * In Offices mode (STATE.spotMode) a map tap opens the spot sheet: what stands
 * on that spot (a Charter office, an Other place, or no office yet), the
 * services it handles and their requirements, plus Move and Remove.
 * Every change here is a map edit like any other: it stays on this device until
 * the admin publishes. Nothing in this file publishes.
 *
 * Loads after app.js, spots.js and charter_pick.js. Reads STAMP_PLACEMENTS,
 * DEPT_STAMP_NAMES and SEPARATE_CAMPUS as globals. Safe to load without a
 * document (the tests run it in a vm).
 */
const SPOT_EDITOR = (() => {
  'use strict';

  const CHECK_LS_KEY = 'wf-check-these';           // what the last migration could not place
  const LATER_SS_KEY = 'wf-spot-migration-later';  // "Not now" for this session
  const STALE_DAYS = 30;
  const REASONS = {
    'two offices': 'Two offices use this marker. Choose the right one.',
    'unnamed': 'This marker has no office name.',
  };

  let charter = null;
  let charterLoading = null;
  const sources = {};            // "<subservice>|<dept>" -> its Charter page
  let offices = null;            // office names for "Not on the map yet", once loaded
  let officesLoading = null;
  let isOpen = false;

  const placements = () => (typeof STAMP_PLACEMENTS !== 'undefined' ? STAMP_PLACEMENTS : []);
  const hasDoc = () => typeof document !== 'undefined';
  const el = (id) => (hasDoc() ? document.getElementById(id) : null);
  const title = (name) => (typeof _officeTitle === 'function' ? _officeTitle(name) : String(name || ''));

  // ── Charter ────────────────────────────────────────────────────────────────

  /** Fetch services.json and the glossary once; cache the Charter index. */
  function loadCharter() {
    if (charter) return Promise.resolve(charter);
    if (!charterLoading) {
      const get = (url) => fetch(url).then((r) => {
        if (r && r.ok === false) throw new Error(`${url}: ${r.status}`);
        return r.json();
      });
      charterLoading = Promise.all([
        get('data/services.json'),
        get('data/service_glossary.json').catch(() => ({})),   // only adds search words
      ]).then(([services, glossary]) => {
        charter = CHARTER_PICK.buildIndex(services, glossary);
        for (const r of services || []) {   // the sheet's "From the Citizen's Charter:" link
          const k = r.subservice + '|' + r.department;
          if (r.source_url && !sources[k]) sources[k] = r.source_url;
        }
        return charter;
      }).catch((e) => { charterLoading = null; throw e; });
    }
    return charterLoading;
  }

  /** department -> its unique subservice names, from the Charter index. */
  function servicesByDept(index) {
    const out = {};
    for (const dept of Object.keys((index && index.servicesByDept) || {})) {
      out[dept] = [...new Set(index.servicesByDept[dept].map((s) => s.value))];
    }
    return out;
  }

  /** Charter offices that belong inside City Hall (departments.json minus separate campuses). */
  async function officeList() {
    let depts = {};
    try {
      if (typeof _loadDepartments === 'function') depts = await _loadDepartments();
      else depts = await (await fetch('data/departments.json')).json();
    } catch (_) { depts = {}; }
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const away = new Set([...(typeof SEPARATE_CAMPUS !== 'undefined' ? SEPARATE_CAMPUS : [])].map(norm));
    return Object.keys(depts || {}).filter((d) => !away.has(norm(d)));
  }

  // ── Map edits ──────────────────────────────────────────────────────────────

  /** After any change to STAMP_PLACEMENTS: save, reroute, redraw, mark the draft. */
  function afterEdit() {
    if (typeof saveStampPlacements === 'function') saveStampPlacements();
    const r = (typeof renderer !== 'undefined') ? renderer : null;
    if (r && typeof recompute === 'function') recompute();
    if (r) r._draw();
    // renderCatalogue also refreshes the draft badge and this panel.
    if (r && typeof renderCatalogue === 'function') renderCatalogue();
    else refreshPanel();
  }

  function readCheckThese() {
    try {
      const v = JSON.parse(localStorage.getItem(CHECK_LS_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }
  function storeCheckThese(list) {
    try { localStorage.setItem(CHECK_LS_KEY, JSON.stringify(list || [])); } catch (_) {}
  }

  /** "Check these" entries still unresolved: the spot exists and has no office yet. */
  function checkTheseNow() {
    const byId = new Map(placements().map((p) => [p.id, p]));
    return readCheckThese().filter((c) => byId.has(c.id) && !byId.get(c.id).kind);
  }

  /**
   * Move the old stamps over to spots. Replaces STAMP_PLACEMENTS in place and
   * leaves the map dirty: the admin reviews, then publishes.
   */
  async function runMigration() {
    const index = await loadCharter();
    const stampMap = (typeof DEPT_STAMP_NAMES !== 'undefined') ? DEPT_STAMP_NAMES : {};
    const res = SPOTS.migrateStamps(placements(), stampMap, servicesByDept(index));
    const list = placements();
    list.length = 0;
    list.push(...res.placements);
    storeCheckThese(res.checkThese);
    afterEdit();
    return { checkThese: res.checkThese };
  }

  /** "Still here?" Confirm: the desk is still there as of now. */
  function confirmDesk(id) {
    const p = placements().find((x) => x.id === id && x.kind === 'desk');
    if (!p) return;
    p.confirmedAt = new Date().toISOString();
    afterEdit();
  }

  /** "Still here?" Remove: take the desk off the map, freeing its cells. */
  function removeDesk(id) {
    const list = placements();
    const i = list.findIndex((x) => x.id === id && x.kind === 'desk');
    if (i < 0) return;
    list.splice(i, 1);
    afterEdit();
  }

  /** Show a spot: switch to its floor and centre it in the part of the map not under the panel. */
  function showOnMap(id) {
    const p = placements().find((x) => x.id === id);
    const r = (typeof renderer !== 'undefined') ? renderer : null;
    if (!p || !r) return;
    if (typeof STATE !== 'undefined' && typeof p.floor === 'number' &&
        p.floor !== STATE.currentFloor && typeof switchFloor === 'function') switchFloor(p.floor);
    const cv = r.canvas;
    let box = { left: 0, top: 0, right: cv.clientWidth, bottom: cv.clientHeight };
    const panel = el('officesPanel');
    if (panel && !panel.hidden && typeof _mapBoxAround === 'function') {
      const pr = panel.getBoundingClientRect(), cr = cv.getBoundingClientRect();
      box = _mapBoxAround(box, { left: pr.left - cr.left, top: pr.top - cr.top,
                                 right: pr.right - cr.left, bottom: pr.bottom - cr.top });
    }
    const half = ((p.size || 1) - 1) / 2;
    r.centerOnCell(p.row + half, p.col + half, box);
    r._draw();
  }

  // ── Banner ─────────────────────────────────────────────────────────────────

  const isAdmin = () => typeof STATE !== 'undefined' && STATE.viewMode === 'admin';
  const migrated = () => placements().some((p) => p.kind);
  function laterThisSession() {
    try { return sessionStorage.getItem(LATER_SS_KEY) === '1'; } catch (_) { return false; }
  }

  function refreshBanner() {
    const b = el('spotMigrationBanner');
    if (!b) return;
    b.hidden = !(isAdmin() && placements().length && !migrated() && !laterThisSession());
  }

  async function onMoveThem() {
    const btn = el('spotMigrateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Moving...'; }
    try {
      await runMigration();
      openPanel();
      const sec = el('checkTheseSection');
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'start' });
    } catch (e) {
      alert('Could not load the Citizen\'s Charter, so nothing was moved. Check the connection and try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Move them'; }
      refreshBanner();
    }
  }

  function onNotNow() {
    try { sessionStorage.setItem(LATER_SS_KEY, '1'); } catch (_) {}
    refreshBanner();
  }

  // ── Panel ──────────────────────────────────────────────────────────────────

  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function empty(list, text) {
    list.appendChild(make('li', 'offices-empty', text));
  }
  function setCount(id, n) {
    const c = el(id);
    if (c) c.textContent = String(n);
  }

  function floorLabel(f) {
    if (typeof _floorLabel === 'function') return _floorLabel(f);
    return 'Floor ' + f;
  }

  function renderCheckThese() {
    const list = el('checkTheseList');
    if (!list) return;
    const items = checkTheseNow();
    setCount('checkTheseCount', items.length);
    list.innerHTML = '';
    if (!items.length) { empty(list, 'Nothing to check.'); return; }
    const byId = new Map(placements().map((p) => [p.id, p]));
    for (const c of items) {
      const p = byId.get(c.id);
      const li = make('li', 'offices-item');
      const btn = make('button', 'offices-go');
      btn.type = 'button';
      btn.appendChild(make('strong', null, c.name || p.name));
      btn.appendChild(make('span', null, `${REASONS[c.reason] || c.reason} ${floorLabel(p.floor)}.`));
      btn.addEventListener('click', () => { showOnMap(c.id); openSheet(c.id); });
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function renderUnplaced() {
    const list = el('unplacedList');
    if (!list) return;
    list.innerHTML = '';
    if (!migrated()) {
      setCount('unplacedCount', 0);
      empty(list, 'Move the old office markers first.');
      return;
    }
    if (!offices) {
      setCount('unplacedCount', 0);
      empty(list, 'Loading...');
      if (!officesLoading) {
        officesLoading = officeList().then((l) => { offices = l; officesLoading = null; refreshPanel(); });
      }
      return;
    }
    const missing = SPOTS.unplacedOffices(placements(), offices);
    setCount('unplacedCount', missing.length);
    if (!missing.length) { empty(list, 'Every office is on the map.'); return; }
    for (const d of missing) list.appendChild(make('li', 'offices-item offices-text', title(d)));
  }

  function renderStale() {
    const list = el('staleList');
    if (!list) return;
    const desks = SPOTS.staleDesks(placements(), Date.now(), STALE_DAYS);
    setCount('staleCount', desks.length);
    list.innerHTML = '';
    if (!desks.length) { empty(list, 'No desks need checking.'); return; }
    for (const p of desks) {
      const li = make('li', 'offices-item offices-desk');
      const info = make('button', 'offices-go offices-desk-info');
      info.type = 'button';
      info.appendChild(make('strong', null, p.dept ? title(p.dept) + ' desk' : (p.name || 'Desk')));
      const t = p.confirmedAt ? Date.parse(p.confirmedAt) : NaN;
      const when = isNaN(t) ? 'Never confirmed' : 'Last confirmed ' + new Date(t).toLocaleDateString();
      info.appendChild(make('span', null, `${when}. ${floorLabel(p.floor)}.`));
      info.addEventListener('click', () => showOnMap(p.id));
      const btns = make('div', 'offices-desk-btns');
      const yes = make('button', 'offices-btn offices-confirm', 'Confirm');
      yes.type = 'button';
      yes.addEventListener('click', () => confirmDesk(p.id));
      const no = make('button', 'offices-btn offices-remove', 'Remove');
      no.type = 'button';
      no.addEventListener('click', () => removeDesk(p.id));
      btns.appendChild(yes);
      btns.appendChild(no);
      li.appendChild(info);
      li.appendChild(btns);
      list.appendChild(li);
    }
  }

  /** Redraw the banner and, when open, the panel's three lists. */
  function refreshPanel() {
    if (!hasDoc()) return;
    refreshBanner();
    const panel = el('officesPanel');
    if (!panel) return;
    panel.hidden = !(isOpen && isAdmin());
    const dock = el('dockOffices');
    if (dock) {
      const on = isOpen || (typeof STATE !== 'undefined' && !!STATE.spotMode);
      dock.classList.toggle('active', on);
      dock.setAttribute('aria-pressed', String(on));
    }
    if (panel.hidden) return;
    renderCheckThese();
    renderUnplaced();
    renderStale();
  }

  function openPanel() {
    // The panel belongs to Offices mode; entering it closes the stamp tools.
    if (typeof STATE !== 'undefined' && !STATE.spotMode) setMode(true);
    isOpen = true;
    refreshPanel();
  }

  function closePanel() {
    isOpen = false;
    refreshPanel();
  }

  function togglePanel() {
    if (isOpen) closePanel(); else openPanel();
  }

  // ── Offices mode ───────────────────────────────────────────────────────────
  // While STATE.spotMode is on, a map tap goes to onTap (app.js handleCellTap).

  function setMode(on) {
    if (typeof STATE === 'undefined') return;
    on = !!on;
    if (on) {   // one tool at a time, like the other dock tools
      if (STATE.wallMode && typeof setWallMode === 'function') setWallMode(false);
      if (STATE.selectMode && typeof setSelectMode === 'function') setSelectMode(false);
      if (STATE.panelOpen && typeof setToolsPanel === 'function') setToolsPanel(false);
      if (STATE.captureMode && typeof setCaptureMode === 'function') setCaptureMode(false);
    }
    STATE.spotMode = on;
    if (!on) { closeSheet(); closePanel(); }
    if (typeof updateCursorAndHint === 'function') updateCursorAndHint();
    if (typeof _syncDock === 'function') _syncDock();
    refreshPanel();
  }

  /** The Offices dock button: on opens the panel too; off closes everything. */
  function toggleMode() {
    if (typeof STATE !== 'undefined' && STATE.spotMode) setMode(false);
    else openPanel();
  }

  // ── Spot sheet: pure helpers ───────────────────────────────────────────────

  const CODE_ONLY = /^(GF|LG|2F|3F)\s*\d+[a-z]?$/i;   // "GF 06": a number code, not a name (as in spots.js)
  const NEW_SPOT_SIZE = 3;

  /** The comparison SPOTS.requirementsFor uses: case, numbering and apostrophes aside. */
  const foldReq = (t) => String(t || '').toLowerCase().replace(/[‘’ʼ`´]/g, "'")
    .replace(/^\s*\d+\s*[.)]+\s*/, '').replace(/\s+/g, ' ').trim();
  const deptCode = (d) => (typeof DEPT_CODE === 'function' ? DEPT_CODE(d) : String(d || '').slice(0, 6).toUpperCase());

  /** The name a spot shows once `dept` is assigned: a code-only or empty name gets the office code in front. */
  function spotName(spot, dept) {
    const n = String(spot.name || '').trim();
    if (n && !CODE_ONLY.test(n)) return spot.name;
    return (deptCode(dept) + ' ' + n).trim();
  }

  /**
   * A copy of `list` with spot `spotId` assigned: a.kind 'office' (dept, services),
   * 'other' (name; otherKey kept unless given), anything else clears it to
   * "No office yet". Other spots, this office's other spots too, are untouched.
   */
  function applyAssignment(list, spotId, a) {
    a = a || {};
    return (list || []).map((p) => {
      if (p.id !== spotId) return p;
      const q = { ...p };
      delete q.kind; delete q.dept; delete q.services; delete q.otherKey;
      if (a.kind === 'office') {
        Object.assign(q, { kind: 'office', dept: a.dept, services: [...(a.services || [])], name: spotName(p, a.dept) });
      } else if (a.kind === 'other') {
        const name = String(a.name || '').trim();
        q.kind = 'other';
        if (name) q.name = name;
        q.otherKey = ('otherKey' in a) ? (a.otherKey == null ? null : a.otherKey)
          : (p.kind === 'other' && p.otherKey ? p.otherKey : null);
      }
      return q;
    });
  }

  /** A copy of `removed` with `text` removed under `key` (keep false) or put back (keep true). */
  function toggleRequirement(removed, key, text, keep) {
    const out = {};
    for (const k of Object.keys(removed || {})) out[k] = [...removed[k]];
    const f = foldReq(text);
    const list = (out[key] || []).filter((t) => foldReq(t) !== f);
    if (!keep) list.push(text);
    if (list.length) out[key] = list; else delete out[key];
    return out;
  }

  /** A copy of `list` with spot `id` moved so its top-left is (row, col), kept on the grid. */
  function moveSpot(list, id, row, col) {
    const rows = typeof GRID_ROWS !== 'undefined' ? GRID_ROWS : 75;
    const cols = typeof GRID_COLS !== 'undefined' ? GRID_COLS : 75;
    return (list || []).map((p) => {
      if (p.id !== id) return p;
      const s = p.size || 1;
      return { ...p, row: Math.max(0, Math.min(rows - s, row)), col: Math.max(0, Math.min(cols - s, col)) };
    });
  }

  /**
   * Charter-only check. { ok, value } with the exact Charter value, or
   * { ok: false, message: NO_MATCH, closest }. A service may come from any
   * office (the office's own come first); a requirement only from its service.
   */
  function checkPick(index, kind, text, opts) {
    opts = opts || {};
    const f = CHARTER_PICK.fold(text);
    const same = (v) => CHARTER_PICK.fold(v) === f;
    if (f && CHARTER_PICK.isCharterItem(index, kind, text, kind === 'service' ? {} : opts)) {
      let value;
      if (kind === 'office') value = (index.offices.find((o) => same(o.value)) || {}).value;
      else if (kind === 'service') {
        const depts = [opts.dept, ...Object.keys(index.servicesByDept)].filter(Boolean);
        for (const d of depts) {
          const s = (index.servicesByDept[d] || []).find((x) => same(x.value));
          if (s) { value = s.value; break; }
        }
      } else value = (index.requirementsByKey[opts.serviceKey] || []).find(same);
      if (value) return { ok: true, value };
    }
    let closest = CHARTER_PICK.closest(index, kind, text, opts, kind === 'requirement' ? 50 : 3);
    if (kind === 'requirement') closest = closest.filter((c) => CHARTER_PICK.isCharterItem(index, kind, c.value, opts)).slice(0, 3);
    return { ok: false, message: CHARTER_PICK.NO_MATCH, closest };
  }

  /** "<subservice>|<dept>", or the office that lists this service when `dept` does not. */
  function serviceKeyFor(index, sub, dept) {
    const k = sub + '|' + dept;
    if (!index || index.requirementsByKey[k]) return k;
    for (const d of Object.keys(index.servicesByDept)) {
      if (index.servicesByDept[d].some((s) => s.value === sub)) return sub + '|' + d;
    }
    return k;
  }

  /** A service's Charter requirements, split into shown and removed (one of each wording). */
  function requirementLists(index, removed, key) {
    const goneF = new Set(((removed || {})[key] || []).map(foldReq));
    const shown = [], gone = [], seen = new Set();
    for (const t of (index && index.requirementsByKey[key]) || []) {
      const f = foldReq(t);
      if (seen.has(f)) continue;
      seen.add(f);
      (goneF.has(f) ? gone : shown).push(t);
    }
    return { shown, gone };
  }

  // ── Spot sheet ─────────────────────────────────────────────────────────────
  // Office, services and requirements are a draft until Save. Move and Remove
  // change the map at once. Only an Other place's name is typed freely.

  let sheet = null;     // { id, mode, dept, services, svc, removed } while a spot is open
  let addAt = null;     // { row, col, floor } while the "add" choice is open
  let moving = null;    // the spot id waiting for the Move tap

  const PICKS = {
    office:      { input: 'ssOfficeInput',  list: 'ssOfficeSuggest',  msg: 'ssOfficeMsg' },
    service:     { input: 'ssServiceInput', list: 'ssServiceSuggest', msg: 'ssServiceMsg' },
    requirement: { input: 'ssReqInput',     list: 'ssReqSuggest',     msg: 'ssReqMsg' },
  };
  const findSpot = (id) => placements().find((p) => p.id === id);
  const show = (id, on) => { const n = el(id); if (n) n.hidden = !on; };
  const setText = (id, t) => { const n = el(id); if (n) n.textContent = t; };
  const valueOf = (id) => { const n = el(id); return n ? String(n.value || '') : ''; };
  const setValue = (id, v) => { const n = el(id); if (n) n.value = v; };
  const floorNow = () => (typeof STATE !== 'undefined' ? STATE.currentFloor : 0);
  function isWall(row, col) {
    try { return !!(NODE_MAP[nodeId(row, col)] || {}).wall; } catch (_) { return false; }
  }
  function replacePlacements(next) {
    const list = placements();
    list.length = 0;
    list.push(...next);
  }
  function button(cls, text, fn, label) {
    const b = make('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  /** A map tap in Offices mode. */
  function onTap(row, col) {
    if (!hasDoc()) return;
    if (moving) { finishMove(row, col); return; }
    // A tap on the desk being edited keeps its sheet (and its unsaved changes).
    if (typeof DESK_EDITOR !== 'undefined' && DESK_EDITOR.owns(floorNow(), row, col)) return;
    const p = SPOTS.spotAt(placements(), floorNow(), row, col);
    if (p) openSheet(p.id); else openAdd(row, col);
  }

  function showSheet(which) {   // 'add' | 'spot' | null
    if (typeof DESK_EDITOR !== 'undefined') DESK_EDITOR.close();   // one sheet at a time
    show('spotSheet', !!which);
    show('ssAdd', which === 'add');
    show('ssSpot', which === 'spot');
    if (!which) { sheet = null; addAt = null; }
  }

  function openAdd(row, col) {
    cancelMove();
    sheet = null;
    addAt = { row, col, floor: floorNow() };
    const wall = isWall(row, col);
    setText('spotSheetTitle', 'Empty place');
    setText('spotSheetSub', floorLabel(addAt.floor));
    setText('ssAddText', wall ? 'This is a wall. Add a spot here for a room.' : 'Nothing is here yet.');
    show('ssAddDesk', !wall);
    show('ssAddMsg', false);
    showSheet('add');
  }

  function addSpotHere() {
    if (!addAt) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const p = { id, name: '', row: addAt.row, col: addAt.col, size: NEW_SPOT_SIZE, floor: addAt.floor, source: 'local' };
    replacePlacements([...placements(), ...moveSpot([p], id, p.row, p.col)]);
    afterEdit();
    openSheet(id);
  }

  /** "Add desk here": the desk sheet (desk_editor.js) takes over. */
  function addDeskHere() {
    if (!addAt || typeof DESK_EDITOR === 'undefined') return;
    const at = addAt;
    closeSheet();
    DESK_EDITOR.openNew(at.row, at.col, at.floor);
  }

  function openSheet(id) {
    const p = findSpot(id);
    if (!p || !hasDoc()) return;
    if (p.kind === 'desk' && typeof DESK_EDITOR !== 'undefined') { DESK_EDITOR.open(id); return; }
    cancelMove();
    addAt = null;
    const removed = (typeof REMOVED_REQUIREMENTS !== 'undefined') ? REMOVED_REQUIREMENTS : {};
    sheet = {
      id,
      mode: p.kind === 'other' ? 'other' : p.kind === 'desk' ? 'desk' : 'office',
      dept: p.kind === 'office' ? p.dept : '',
      services: [...(p.services || [])],
      svc: null,
      removed: JSON.parse(JSON.stringify(removed || {})),
    };
    setValue('ssOfficeInput', sheet.dept ? title(sheet.dept) : '');
    setValue('ssOtherName', p.kind === 'other' ? (p.name || '') : '');
    setValue('ssServiceInput', '');
    setValue('ssReqInput', '');
    for (const k of Object.keys(PICKS)) clearPick(k);
    say('');
    showSheet('spot');
    render();
    if (!charter) {
      loadCharter().then(() => { if (sheet && sheet.id === id) render(); })
        .catch(() => say("Could not load the Citizen's Charter. Check the connection and try again."));
    }
  }

  function closeSheet() {
    cancelMove();
    showSheet(null);
  }

  function say(text) {
    setText('ssMsg', text);
    show('ssMsg', !!text);
  }

  function setSheetMode(mode) {
    if (!sheet || sheet.mode === 'desk') return;
    sheet.mode = mode;
    say('');
    render();
  }

  function render() {
    if (!sheet) return;
    const p = findSpot(sheet.id);
    if (!p) { closeSheet(); return; }
    const look = SPOTS.labelStyle(p);
    setText('spotSheetTitle', look.look === 'empty' ? 'No office yet'
      : look.look === 'other' ? (p.name || 'Other place')
      : title(look.text) + (look.look === 'desk' ? ' desk' : ''));
    setText('spotSheetSub', [p.kind === 'other' ? '' : p.name, floorLabel(p.floor)].filter(Boolean).join(', '));
    const m = sheet.mode;
    for (const [id, mode] of [['ssAssignBtn', 'office'], ['ssOtherBtn', 'other'], ['ssNoneBtn', 'none']]) {
      const b = el(id);
      if (!b) continue;
      b.setAttribute('aria-pressed', String(m === mode));
      b.classList.toggle('active', m === mode);
    }
    show('ssChoice', m !== 'desk');
    show('ssOfficeStep', m === 'office');
    show('ssOtherStep', m === 'other');
    show('ssNoneNote', m === 'none');
    show('ssDeskNote', m === 'desk');
    show('ssLoading', m === 'office' && !charter);
    for (const k of Object.keys(PICKS)) { const n = el(PICKS[k].input); if (n) n.disabled = !charter; }
    renderServices();
    renderRequirements();
  }

  function renderServices() {
    const list = el('ssServiceChips');
    if (!list) return;
    list.textContent = '';
    if (!sheet.services.length) list.appendChild(make('li', 'ss-empty', 'No services yet. Add one below.'));
    for (const s of sheet.services) {
      const li = make('li', 'ss-chip');
      const name = button('ss-chip-name', s, () => {
        sheet.svc = sheet.svc === s ? null : s;
        clearPick('requirement');
        setValue('ssReqInput', '');
        render();
      });
      name.setAttribute('aria-pressed', String(sheet.svc === s));
      name.classList.toggle('active', sheet.svc === s);
      li.appendChild(name);
      li.appendChild(button('ss-chip-x', 'x', () => {
        sheet.services = sheet.services.filter((v) => v !== s);
        if (sheet.svc === s) sheet.svc = null;
        render();
      }, 'Remove ' + s));
      list.appendChild(li);
    }
  }

  function renderRequirements() {
    const on = sheet.mode === 'office' && !!sheet.svc && !!charter;
    show('ssReqStep', on);
    if (!on) return;
    const key = serviceKeyFor(charter, sheet.svc, sheet.dept);
    const { shown, gone } = requirementLists(charter, sheet.removed, key);
    const toggle = (t, keep) => () => { sheet.removed = toggleRequirement(sheet.removed, key, t, keep); render(); };
    setText('ssReqTitle', 'Requirements for ' + sheet.svc);
    const list = el('ssReqChips');
    if (list) {
      list.textContent = '';
      if (!shown.length) list.appendChild(make('li', 'ss-empty', 'No requirements listed.'));
      for (const t of shown) {
        const li = make('li', 'ss-chip ss-req');
        li.appendChild(make('span', 'ss-chip-text', t));
        li.appendChild(button('ss-chip-x', 'x', toggle(t, false), 'Remove this requirement'));
        list.appendChild(li);
      }
    }
    const back = el('ssReqGone');
    if (back) {
      back.textContent = '';
      for (const t of gone) {
        const li = make('li', 'ss-chip ss-req ss-gone');
        li.appendChild(make('span', 'ss-chip-text', t));
        li.appendChild(button('ss-chip-back', 'Put back', toggle(t, true)));
        back.appendChild(li);
      }
    }
    show('ssReqGoneWrap', gone.length > 0);
    const url = sources[key] || '';
    const a = el('ssSourceLink');
    if (a) { a.textContent = sheet.svc; if (url) a.href = url; }
    show('ssSource', !!url);
  }

  // ── Type-aheads: one picker per input, Charter values only ─────────────────
  // makePicker is shared with the desk sheet (desk_editor.js), so the
  // Charter-only gate (suggest, Enter check, the check at Save) lives here alone.

  /**
   * Wire a type-ahead and return { clear, suggest, typed, settle }.
   * cfg: { kind: 'office'|'service'|'requirement', input, list, msg (element ids),
   *        index() -> the Charter index, or null while nothing is open,
   *        opts() -> CHARTER_PICK opts, onPick(value), limit, filter(hits) }.
   * Typing suggests; Enter takes the typed text only if the Charter has it,
   * otherwise it shows NO_MATCH and the closest Charter items.
   */
  function makePicker(cfg) {
    const opts = () => (cfg.opts ? cfg.opts() : {});
    function clear() {
      const l = el(cfg.list);
      if (l) l.textContent = '';
      setText(cfg.msg, '');
      show(cfg.msg, false);
    }
    function item(value) {
      const li = make('li', 'ss-suggest-item');
      li.appendChild(button('ss-suggest-btn', cfg.kind === 'office' ? title(value) : value, () => cfg.onPick(value)));
      return li;
    }
    function suggest() {
      const index = cfg.index();
      if (!index) return;
      clear();
      let hits = CHARTER_PICK.suggest(index, cfg.kind, valueOf(cfg.input), opts(), cfg.limit || 6);
      if (cfg.filter) hits = cfg.filter(hits);
      const list = el(cfg.list);
      if (list) for (const h of hits) list.appendChild(item(h.value));
    }
    /** Enter: take the typed text only if the Charter has it. */
    function typed() {
      const index = cfg.index();
      if (!index) return;
      const text = valueOf(cfg.input);
      if (!text.trim()) return;
      const r = checkPick(index, cfg.kind, text, opts());
      if (r.ok) { cfg.onPick(r.value); return; }
      clear();
      const m = el(cfg.msg);
      if (!m) return;
      m.appendChild(make('span', 'ss-nomatch-text', r.message));
      if (r.closest.length) {
        m.appendChild(make('span', 'ss-closest-lbl', 'Closest in the Charter:'));
        const ul = make('ul', 'ss-suggest');
        for (const x of r.closest) ul.appendChild(item(x.value));
        m.appendChild(ul);
      }
      m.hidden = false;
    }
    /**
     * At Save: text typed over the picked value `current` must be a Charter
     * item, which is then picked. False (and NO_MATCH shown) when it is not.
     */
    function settle(current) {
      const index = cfg.index();
      const text = valueOf(cfg.input).trim();
      if (!text || !index || CHARTER_PICK.fold(text) === CHARTER_PICK.fold(current)) return true;
      const r = checkPick(index, cfg.kind, text, opts());   // typed, not picked from the list
      if (!r.ok) { typed(); return false; }
      cfg.onPick(r.value);
      return true;
    }
    const n = el(cfg.input);
    if (n) {
      n.addEventListener('input', suggest);
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); typed(); } });
    }
    return { clear, suggest, typed, settle };
  }

  const pickers = {};   // kind -> picker, made in init()

  function pickOpts(kind) {
    if (kind === 'service') return { dept: sheet.dept };
    if (kind === 'requirement') return { serviceKey: serviceKeyFor(charter, sheet.svc, sheet.dept) };
    return {};
  }

  function clearPick(kind) {
    if (pickers[kind]) pickers[kind].clear();
  }

  function choose(kind, value) {
    if (!sheet) return;
    clearPick(kind);
    if (kind === 'office') {
      sheet.dept = value;
      sheet.services = [...(servicesByDept(charter)[value] || [])];   // its Charter services
      sheet.svc = null;
      setValue('ssOfficeInput', title(value));
    } else if (kind === 'service') {
      if (!sheet.services.includes(value)) sheet.services.push(value);
      setValue('ssServiceInput', '');
    } else {
      const key = serviceKeyFor(charter, sheet.svc, sheet.dept);
      const { gone } = requirementLists(charter, sheet.removed, key);
      if (gone.some((t) => foldReq(t) === foldReq(value))) sheet.removed = toggleRequirement(sheet.removed, key, value, true);
      setValue('ssReqInput', '');
    }
    render();
  }

  function wirePick(kind) {
    pickers[kind] = makePicker({
      kind, ...PICKS[kind],
      index: () => (sheet && charter ? charter : null),
      opts: () => pickOpts(kind),
      onPick: (v) => choose(kind, v),
      limit: kind === 'requirement' ? 40 : 6,
      filter: kind === 'requirement' ? (hits) => hits.filter((h) => h.own).slice(0, 6) : null,
    });
  }

  // ── Save, Move, Remove ─────────────────────────────────────────────────────

  function save() {
    if (!sheet) return;
    const p = findSpot(sheet.id);
    if (!p) { closeSheet(); return; }
    let a = {};
    if (sheet.mode === 'desk') { closeSheet(); return; }   // desks: Task 7
    if (sheet.mode === 'office') {
      const text = valueOf('ssOfficeInput').trim();
      if (pickers.office && !pickers.office.settle(sheet.dept)) return;
      if (!text || !sheet.dept) { say("Pick an office from the Citizen's Charter, or choose No office yet."); return; }
      a = { kind: 'office', dept: sheet.dept, services: sheet.services };
    } else if (sheet.mode === 'other') {
      const name = valueOf('ssOtherName').trim();
      if (!name) { say('Type the name of this place first.'); return; }
      a = { kind: 'other', name };
    }
    replacePlacements(applyAssignment(placements(), p.id, a));
    if (typeof REMOVED_REQUIREMENTS !== 'undefined') {   // same object: app.js publishes it
      for (const k of Object.keys(REMOVED_REQUIREMENTS)) delete REMOVED_REQUIREMENTS[k];
      Object.assign(REMOVED_REQUIREMENTS, sheet.removed);
      if (typeof saveRemovedRequirements === 'function') saveRemovedRequirements();
    }
    closeSheet();
    afterEdit();
    refreshPanel();
    if (typeof _scheduleDraftBadge === 'function') _scheduleDraftBadge();
  }

  function moveUi(on) {
    show('ssBody', !on);
    show('ssMoveNote', on);
    show('ssRemoveBtn', !on);
    show('ssSaveBtn', !on);
    setText('ssMoveNote', 'Tap the new place for this spot.');
    const b = el('ssMoveBtn');
    if (b) { b.setAttribute('aria-pressed', String(on)); b.classList.toggle('active', on); }
    const hint = el('hintBar');
    if (on && hint) hint.textContent = 'Tap the new place for this spot.';
    else if (!on && typeof updateCursorAndHint === 'function') updateCursorAndHint();
  }

  function toggleMove() {
    if (!sheet) return;
    if (moving) { cancelMove(); return; }
    moving = sheet.id;
    moveUi(true);
  }

  function cancelMove() {
    if (!moving) return;
    moving = null;
    moveUi(false);
  }

  function finishMove(row, col) {
    const id = moving;
    if (!findSpot(id)) { cancelMove(); return; }
    const next = moveSpot(placements(), id, row, col).map((q) => (q.id === id ? { ...q, floor: floorNow() } : q));
    const q = next.find((x) => x.id === id);
    const s = (x) => x.size || 1;
    const hit = next.some((o) => o.id !== id && o.floor === q.floor &&
      o.row < q.row + s(q) && q.row < o.row + s(o) && o.col < q.col + s(q) && q.col < o.col + s(o));
    if (hit) { setText('ssMoveNote', 'Another spot is there. Tap an empty place.'); return; }
    moving = null;
    replacePlacements(next);
    moveUi(false);
    afterEdit();
    render();
  }

  function removeSpot() {
    if (!sheet || !confirm('Remove this spot?')) return;
    const id = sheet.id;
    closeSheet();
    replacePlacements(placements().filter((p) => p.id !== id));
    afterEdit();
  }

  function init() {
    const on = (id, fn) => { const b = el(id); if (b) b.addEventListener('click', fn); };
    on('spotMigrateBtn', onMoveThem);
    on('spotMigrateLater', onNotNow);
    on('officesPanelClose', closePanel);
    on('spotSheetClose', closeSheet);
    on('ssAssignBtn', () => setSheetMode('office'));
    on('ssOtherBtn', () => setSheetMode('other'));
    on('ssNoneBtn', () => setSheetMode('none'));
    on('ssMoveBtn', toggleMove);
    on('ssRemoveBtn', removeSpot);
    on('ssSaveBtn', save);
    on('ssAddSpot', addSpotHere);
    on('ssAddDesk', addDeskHere);
    for (const k of Object.keys(PICKS)) wirePick(k);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && moving) cancelMove(); });
    refreshPanel();
  }

  if (hasDoc()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    openPanel, closePanel, togglePanel, refreshPanel, loadCharter, runMigration,
    officeList, confirmDesk, removeDesk, servicesByDept, checkTheseNow, showOnMap,
    setMode, toggleMode, onTap, openSheet, closeSheet,
    applyAssignment, toggleRequirement, moveSpot, checkPick, spotName, serviceKeyFor, requirementLists,
    addDesk: (row, col, opts) => DESK_EDITOR.addDesk(row, col, opts),
    // Shared with the desk sheet (desk_editor.js).
    makePicker, afterEdit,
    dom: { el, make, button, show, setText, valueOf, setValue, floorLabel, title },
  };
})();
