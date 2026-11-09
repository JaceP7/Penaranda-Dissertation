/**
 * test_admin_shell.js - wayfinding-app/js/admin.js (revamp Task 12): the URL
 * state, the date ranges, and what happens when the staff session ends while
 * the dashboard is open (the 30-second refresh then gets 401: polling must
 * stop, the PIN screen return, and the last data not stay on screen).
 *
 * Run: node tools/test_admin_shell.js <repo-root>
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
const file = path.resolve(ROOT, 'wayfinding-app/js/admin.js');
if (!fs.existsSync(file)) { ok('admin.js exists', false); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
const S = ctx.ADMIN_SHELL;
ok('ADMIN_SHELL is defined (no DOM needed to load)', !!S);

(async () => {
  let s = S.parseViewState('');
  ok('defaults: overview, all time', s.page === 'overview' && s.range === 'all');
  ok('an unknown page falls back to overview', S.parseViewState('?page=people').page === 'overview');
  ok('the data page is a page', S.parseViewState('?page=data').page === 'data');
  ok('custom without dates falls back to all', S.parseViewState('?range=custom').range === 'all');
  s = { page: 'questions', range: 'custom', from: '2026-10-01', to: '2026-10-31' };
  ok('state round-trips through the URL', JSON.stringify(S.parseViewState(S.viewStateToSearch(s))) === JSON.stringify(s), S.viewStateToSearch(s));
  ok('7 days on 2026-11-09 is 2026-11-03 to 2026-11-09', JSON.stringify(S.rangeToQuery({ range: '7d' }, '2026-11-09')) === JSON.stringify({ from: '2026-11-03', to: '2026-11-09' }));
  ok('30 days on 2026-11-09 starts 2026-10-11', S.rangeToQuery({ range: '30d' }, '2026-11-09').from === '2026-10-11');
  ok('all time sends no dates', JSON.stringify(S.rangeToQuery({ range: 'all' }, '2026-11-09')) === '{}');
  ok('range labels', S.rangeName({ range: '7d' }) === 'Last 7 days' && S.rangeName({ range: 'all' }) === 'All time');

  const calls = { stop: 0, signIn: [], banner: [] };
  const page = { innerHTML: 'old data' };
  const deps = (status) => ({
    fetch: async () => ({ ok: status < 400, status, json: async () => ({ x: 1 }) }),
    stopRefresh: () => { calls.stop++; },
    showSignIn: (why) => { calls.signIn.push(why); },
    showBanner: (t) => { calls.banner.push(t); },
    pageEl: () => page,
  });
  for (const code of [401, 403]) {
    Object.assign(S._deps, deps(code));
    page.innerHTML = 'old data'; calls.stop = 0; calls.signIn = [];
    let threw = false;
    try { await S.api('/api/analytics'); } catch (_) { threw = true; }
    ok(`${code}: refresh stopped, PIN screen back with "ended", old data cleared`,
       threw && calls.stop === 1 && calls.signIn[0] === 'ended' && page.innerHTML === '', JSON.stringify([threw, calls.stop, calls.signIn, page.innerHTML]));
  }
  Object.assign(S._deps, deps(503));
  calls.signIn = [];
  try { await S.api('/api/analytics'); } catch (_) { /* expected */ }
  ok('503 (ADMIN_PIN unset): the locked screen', calls.signIn[0] === 'locked');
  Object.assign(S._deps, deps(500));
  page.innerHTML = 'last good data'; calls.banner = []; calls.signIn = [];
  let threw = false;
  try { await S.api('/api/analytics'); } catch (_) { threw = true; }
  ok('500: keeps the last data, shows the banner, stays signed in', threw && page.innerHTML === 'last good data' && calls.banner.length === 1 && calls.signIn.length === 0);
  Object.assign(S._deps, deps(200));
  ok('200 returns the JSON', (await S.api('/api/analytics')).x === 1);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
