/**
 * admin.js - the analytics dashboard shell: staff-PIN sign-in, the page and
 * date range in the URL, the side menu (a drawer below 900 px), the range bar
 * (a sheet below 900 px), refresh every 30 s, and the light/dark switch.
 *
 * Loads without a DOM so tools/test_admin_shell.js can test the pure parts
 * and api() with stubbed dependencies (ADMIN_SHELL._deps).
 *
 * Sign-in is the staff PIN (POST /api/adminauth), which sets an 8-hour
 * session cookie. It fails closed: while ADMIN_PIN is unset in Vercel the
 * data endpoints answer 503 and this shows how to unlock it.
 *
 * Fixture mode, for checking the layout without real data: on localhost or
 * 127.0.0.1 with ?fixture=1, js/admin_fixture.js (invented data) answers
 * every request. It never runs on the hosted site.
 */
(function (root) {
  'use strict';

  const PAGES = {
    overview: 'Overview', questions: 'Questions', hottimes: 'Hot times',
    speed: 'Speed', routes: 'Routes', data: 'Data',
  };
  const RANGES = ['7d', '30d', 'all', 'custom'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseViewState(search) {
    const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const page = Object.prototype.hasOwnProperty.call(PAGES, p.get('page')) ? p.get('page') : 'overview';
    let range = RANGES.includes(p.get('range')) ? p.get('range') : 'all';
    let from = p.get('from') || '', to = p.get('to') || '';
    if (range === 'custom' && !(DATE_RE.test(from) && DATE_RE.test(to))) range = 'all';
    if (range !== 'custom') { from = ''; to = ''; }
    return { page, range, from, to };
  }

  function viewStateToSearch(s) {
    let q = `?page=${encodeURIComponent(s.page)}&range=${encodeURIComponent(s.range)}`;
    if (s.range === 'custom') q += `&from=${encodeURIComponent(s.from)}&to=${encodeURIComponent(s.to)}`;
    return q;
  }

  const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

  function rangeToQuery(s, today) {
    if (s.range === '7d') return { from: addDays(today, -6), to: today };
    if (s.range === '30d') return { from: addDays(today, -29), to: today };
    if (s.range === 'custom') return { from: s.from, to: s.to };
    return {};
  }

  function rangeName(s) {
    if (s.range === '7d') return 'Last 7 days';
    if (s.range === '30d') return 'Last 30 days';
    if (s.range === 'custom') {
      const md = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
      return `${md(s.from)} – ${md(s.to)}`;
    }
    return 'All time';
  }

  // ── requests ──────────────────────────────────────────────────────────────
  const _deps = {
    fetch: (url, opts) => root.fetch(url, opts),
    stopRefresh: () => {},
    showSignIn: () => {},
    showBanner: () => {},
    pageEl: () => ({ innerHTML: '' }),
  };

  async function _check(r) {
    if (r.status === 401 || r.status === 403 || r.status === 503) {
      _deps.stopRefresh();
      _deps.pageEl().innerHTML = '';            // don't leave data on screen after sign-in ends
      _deps.showSignIn(r.status === 503 ? 'locked' : 'ended');
      throw new Error('Signed out');
    }
    if (!r.ok) {
      let msg = `Could not load the data (error ${r.status}). Showing the last data loaded.`;
      try { const b = await r.json(); if (b && b.error) msg = b.error; } catch (_) { /* keep */ }
      _deps.showBanner(msg);
      throw new Error(msg);
    }
    return r;
  }

  async function api(path) {
    const r = await _deps.fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    await _check(r);
    return r.json();
  }

  async function postJson(path, body) {
    const r = await _deps.fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 401 || r.status === 503) await _check(r);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `That did not work (error ${r.status}).`);
    return data;
  }

  /** Download a gated file (the backup) through fetch, so a failure is known. */
  async function download(url) {
    const r = await _deps.fetch(url, { credentials: 'same-origin' });
    await _check(r);
    const blob = await r.blob();
    const cd = (r.headers && r.headers.get && r.headers.get('Content-Disposition')) || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const a = root.document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : 'calamba-analytics-backup.json';
    root.document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const SHELL = { PAGES, parseViewState, viewStateToSearch, rangeToQuery, rangeName, api, postJson, download, _deps };
  root.ADMIN_SHELL = SHELL;
  if (typeof root.document === 'undefined') return;     // Node tests stop here

  // ── browser ───────────────────────────────────────────────────────────────
  const doc = root.document;
  const $ = (id) => doc.getElementById(id);
  let state = parseViewState(root.location.search);
  let timer = null;

  // Theme: dark by default, remembered per browser.
  function setTheme(t) {
    doc.documentElement.setAttribute('data-theme', t);
    try { root.localStorage.setItem('wf-admin-theme', t); } catch (_) { /* private mode */ }
    const b = $('themeBtn');
    if (b) b.textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
  }
  let saved = null;
  try { saved = root.localStorage.getItem('wf-admin-theme'); } catch (_) { /* private mode */ }
  setTheme(saved === 'light' ? 'light' : 'dark');

  _deps.pageEl = () => $('page');
  _deps.stopRefresh = () => { if (timer) clearInterval(timer); timer = null; };
  _deps.showBanner = (t) => { const b = $('banner'); b.textContent = t; b.hidden = false; };
  _deps.showSignIn = (why) => showSignIn(why);

  function showSignIn(why) {
    _deps.stopRefresh();
    $('shell').hidden = true;
    $('signin').hidden = false;
    const msg = $('signinMsg'), form = $('pinForm');
    form.hidden = false;
    if (why === 'ended') msg.textContent = 'Your session ended. Enter the staff PIN again.';
    else if (why === 'locked') {
      msg.textContent = 'The dashboard is locked until ADMIN_PIN is set in Vercel (Project, Settings, Environment Variables), then redeploy.';
      form.hidden = true;
    } else if (why === 'laptop') {
      msg.textContent = 'Not available on the laptop server. Open https://penaranda-dissertation.vercel.app/admin.html for the live dashboard.';
      form.hidden = true;
    } else msg.textContent = 'Enter the staff PIN to see the analytics.';
    if (!form.hidden) $('pinInput').focus();
  }

  $('pinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('pinError');
    err.textContent = '';
    const pin = $('pinInput').value.trim();
    if (!pin) { err.textContent = 'Enter the PIN.'; return; }
    const btn = $('pinBtn'); btn.disabled = true;
    try {
      const r = await _deps.fetch('/api/adminauth', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const b = await r.json().catch(() => ({}));
      if (r.status === 429) err.textContent = 'Too many tries. Wait 15 minutes.';
      else if (!r.ok) err.textContent = 'Incorrect PIN.';
      else if (!b.session) showSignIn('locked');
      else { $('pinInput').value = ''; startShell(); }
    } catch (_) {
      err.textContent = 'Could not reach the server. Check the connection and try again.';
    } finally { btn.disabled = false; }
  });

  $('signoutBtn').addEventListener('click', async () => {
    try { await _deps.fetch('/api/adminauth', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signout' }) }); } catch (_) { /* still leave */ }
    $('page').innerHTML = '';
    showSignIn();
  });
  $('themeBtn').addEventListener('click', () =>
    setTheme(doc.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  // Menu and drawer
  function closeDrawer() {
    if (!doc.body.classList.contains('drawer-open')) return;
    doc.body.classList.remove('drawer-open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
    $('menuBtn').focus();
  }
  $('menuBtn').addEventListener('click', () => {
    const open = !doc.body.classList.contains('drawer-open');
    doc.body.classList.toggle('drawer-open', open);
    $('menuBtn').setAttribute('aria-expanded', String(open));
    if (open) { const first = doc.querySelector('#nav a'); if (first) first.focus(); }
  });
  $('backdrop').addEventListener('click', () => { closeDrawer(); closeSheet(); });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeSheet(); } });
  doc.querySelectorAll('#nav a[data-page]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    state.page = a.getAttribute('data-page');
    closeDrawer();
    go();
  }));

  // Range bar and sheet
  function closeSheet() {
    if (!doc.body.classList.contains('sheet-open')) return;
    doc.body.classList.remove('sheet-open');
    $('rangeBtn').setAttribute('aria-expanded', 'false');
  }
  $('rangeBtn').addEventListener('click', () => {
    const open = !doc.body.classList.contains('sheet-open');
    doc.body.classList.toggle('sheet-open', open);
    $('rangeBtn').setAttribute('aria-expanded', String(open));
  });
  doc.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    const r = b.getAttribute('data-range');
    if (r === 'custom') { $('customDates').hidden = false; $('fromDate').focus(); return; }
    state.range = r; state.from = ''; state.to = '';
    $('customDates').hidden = true;
    closeSheet();
    go();
  }));
  $('customDates').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = $('fromDate').value, t = $('toDate').value;
    if (!DATE_RE.test(f) || !DATE_RE.test(t)) return;
    Object.assign(state, { range: 'custom', from: f <= t ? f : t, to: f <= t ? t : f });
    closeSheet();
    go();
  });

  function rangeQS() {
    const q = rangeToQuery(state, manilaToday());
    return Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  }

  function paintChrome() {
    doc.querySelectorAll('#nav a[data-page]').forEach((a) => {
      const on = a.getAttribute('data-page') === state.page;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('pageTitle').textContent = PAGES[state.page];
    doc.title = `${PAGES[state.page]} · City Hall analytics`;
    doc.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-range') === state.range));
    $('rangeLabel').textContent = rangeName(state) + ' (Manila time)';
    $('rangeBtn').textContent = rangeName(state);
    const qs = rangeQS();
    $('csvQuestions').href = '/api/analytics?format=csv' + (qs ? '&' + qs : '');
    $('csvRoutes').href = '/api/navlog?format=csv' + (qs ? '&' + qs : '');
    if (state.range === 'custom') { $('fromDate').value = state.from; $('toDate').value = state.to; }
    $('rangebar').hidden = state.page === 'data';
    $('rangeBtn').hidden = state.page === 'data';
  }

  let loading = 0;
  async function load(quiet) {
    const my = ++loading;
    const page = $('page');
    if (!quiet) page.setAttribute('aria-busy', 'true');
    const ctx = {
      range: rangeToQuery(state, manilaToday()), rangeQS: rangeQS(), state,
      fetchJson: api, postJson, download, onError: (e) => _deps.showBanner(e.message),
    };
    try {
      await root.ADMIN_PAGES[state.page](page, ctx);
      if (my !== loading) return;
      $('banner').hidden = true;
      const now = new Date(Date.now() + 8 * 3600e3);
      const h = now.getUTCHours();
      $('updated').textContent = `Updated ${h % 12 || 12}:${String(now.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    } catch (e) { /* api() already showed the banner or the sign-in screen */ }
    finally { page.removeAttribute('aria-busy'); }
  }

  function go() {
    root.history.replaceState(null, '', viewStateToSearch(state));
    paintChrome();
    load();
  }

  function startShell() {
    $('signin').hidden = true;
    $('shell').hidden = false;
    go();
    _deps.stopRefresh();
    // Live pages refresh; Questions and Data don't, so a refresh never pulls
    // the page out from under someone reading or about to press a button.
    timer = setInterval(() => { if (!['questions', 'data'].includes(state.page)) load(true); }, 30000);
  }

  async function boot() {
    const local = /^(localhost|127\.0\.0\.1)$/.test(root.location.hostname);
    if (local && /[?&]fixture=1\b/.test(root.location.search)) {
      await new Promise((ok, no) => { const s = doc.createElement('script'); s.src = 'js/admin_fixture.js'; s.onload = ok; s.onerror = no; doc.head.appendChild(s); });
      _deps.fetch = root.ADMIN_FIXTURE.fetch;
    }
    let st;
    try {
      const r = await _deps.fetch('/api/adminauth', { credentials: 'same-origin' });
      if (r.status === 404 || r.status === 405 || r.status === 501) { showSignIn('laptop'); return; }
      st = await r.json();
    } catch (_) { showSignIn('laptop'); return; }
    if (!st.configured) showSignIn('locked');
    else if (st.signedIn) startShell();
    else showSignIn();
  }
  boot();
})(typeof window !== 'undefined' ? window : globalThis);
