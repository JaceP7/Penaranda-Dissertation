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
      btn.addEventListener('click', () => showOnMap(c.id));
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
      dock.classList.toggle('active', isOpen);
      dock.setAttribute('aria-pressed', String(isOpen));
    }
    if (panel.hidden) return;
    renderCheckThese();
    renderUnplaced();
    renderStale();
  }

  function openPanel() {
    // One sheet at a time on a phone: the stamp tools close.
    if (typeof STATE !== 'undefined' && STATE.panelOpen && typeof setToolsPanel === 'function') setToolsPanel(false);
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

  function init() {
    const on = (id, fn) => { const b = el(id); if (b) b.addEventListener('click', fn); };
    on('spotMigrateBtn', onMoveThem);
    on('spotMigrateLater', onNotNow);
    on('officesPanelClose', closePanel);
    refreshPanel();
  }

  if (hasDoc()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    openPanel, closePanel, togglePanel, refreshPanel, loadCharter, runMigration,
    officeList, confirmDesk, removeDesk, servicesByDept, checkTheseNow, showOnMap,
  };
})();
