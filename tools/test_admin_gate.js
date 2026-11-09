/**
 * test_admin_gate.js - the staff-PIN gate for the analytics dashboard
 * (plan 2026-11-09-admin-analytics-revamp.md, addendum Tasks P1 and P2).
 *
 * Found before building it: ADMIN_PIN was not set in Vercel, so the effective
 * PIN was the old default once shipped in the public source, and
 * GET /api/analytics returned the 20 newest citizen questions to anyone.
 *
 * Covered:
 *   - signed session cookie: round trip, tampering, expiry, a PIN change or a
 *     secret change ends sessions, cookie flags;
 *   - the gate fails closed (503) while ADMIN_PIN is unset, 401 without a
 *     session, never cached;
 *   - /api/adminauth issues the cookie only for the configured PIN, still
 *     answers the editor's legacy check, signs out, and stops a brute force;
 *   - analytics (JSON and CSV) and navigation reads need the session; the
 *     citizen chips come from an open read that carries service names only.
 *
 * Fake Redis; nothing real is touched.
 * Run: node tools/test_admin_gate.js <repo-root>
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

process.env.UPSTASH_REDIS_REST_URL   = 'https://redis.fake';
process.env.UPSTASH_REDIS_REST_TOKEN = 'a-long-random-redis-token-used-as-the-fallback-secret';
delete process.env.SESSION_SECRET;
process.env.ADMIN_PIN = '482913';

// ── fake Redis ───────────────────────────────────────────────────────────────
const LISTS = {}, KV = {};
LISTS['wf:querylog'] = [
  { ts: 5, query: 'how do i get a cedula', department: 'TREASURY', subservice: 'Cedula Service', lang: 'en' },
  { ts: 4, query: 'cedula po', department: 'TREASURY', subservice: 'Cedula Service', lang: 'fil' },
  { ts: 3, query: 'business permit please', department: 'BPLO', subservice: 'Permit Service', lang: 'en' },
  { ts: 2, query: 'Tapped Name', department: 'X', subservice: 'Tapped Name', source: 'chip' },
  { ts: 1, query: 'probe', department: 'Y', subservice: 'Probe Service', synthetic: true },
].map((e) => JSON.stringify(e));
LISTS['wf:navlog'] = [JSON.stringify({ ts: 1, event: 'nav_start', department: 'BPLO' })];
const reply = (result) => ({ ok: true, status: 200, json: async () => ({ result }), text: async () => JSON.stringify({ result }) });
global.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://redis.fake')) throw new Error('unexpected fetch ' + url);
  const [op, key, a, b] = JSON.parse(opts.body);
  switch (op) {
    case 'LRANGE': return reply((LISTS[key] || []).slice(Number(a), Number(b) + 1));
    case 'LPUSH': (LISTS[key] = LISTS[key] || []).unshift(a); return reply(LISTS[key].length);
    case 'LTRIM': return reply('OK');
    case 'INCR': KV[key] = (KV[key] || 0) + 1; return reply(KV[key]);
    case 'EXPIRE': return reply(1);
    case 'GET': return reply(KV[key] == null ? null : String(KV[key]));
    case 'DEL': delete KV[key]; return reply(1);
    default: return reply(null);
  }
};

function mockRes() {
  const r = { code: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.getHeader = (k) => r.headers[k.toLowerCase()];
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const fresh = (rel) => { const p = path.resolve(ROOT, rel); delete require.cache[p]; return require(p); };
const call = async (rel, req) => {
  const res = mockRes();
  await fresh(rel)(Object.assign({ method: 'GET', query: {}, headers: {} }, req), res);
  return res;
};
const cookieOf = (res) => String(res.headers['set-cookie'] || '').split(';')[0];

(async () => {
  console.log('\n--- P1 session ---');
  let S;
  try { S = fresh('lib/session.js'); } catch (e) { ok('lib/session.js loads', false, e.message); }
  if (S) {
    ok('cookie is wf_admin, 8 hours', S.SESSION_COOKIE === 'wf_admin' && S.SESSION_TTL_MS === 28800000);
    const t = S.signSession(1000);
    ok('a signed session verifies', !!S.verifySession(t, 2000));
    const [a, b] = t.split('.');
    const bad = (a[0] === 'A' ? 'B' : 'A') + a.slice(1) + '.' + b;
    ok('a tampered session does not', S.verifySession(bad, 2000) === null);
    ok('an expired session does not', S.verifySession(t, 1000 + 28800001) === null);
    process.env.ADMIN_PIN = '000111';
    ok('changing the PIN ends every session', S.verifySession(t, 2000) === null);
    process.env.ADMIN_PIN = '482913';
    process.env.SESSION_SECRET = 'x'.repeat(40);
    ok('changing the secret ends every session', S.verifySession(t, 2000) === null);
    delete process.env.SESSION_SECRET;
    ok('garbage is rejected', S.verifySession('nope', 2000) === null && S.verifySession('', 2000) === null);
    const res = mockRes(); S.setSessionCookie(res, t);
    const c = String(res.headers['set-cookie']);
    ok('cookie flags: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=28800',
       /^wf_admin=/.test(c) && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c) && /Path=\//.test(c) && /Max-Age=28800/.test(c), c);
    ok('the token is read back from a cookie header with others in it',
       S.readSessionToken({ headers: { cookie: 'a=1; wf_admin=' + t + '; b=2' } }) === t);
    delete process.env.ADMIN_PIN;
    const cfg = S.sessionConfig();
    ok('without ADMIN_PIN: not configured, and says so', cfg.configured === false && cfg.missing.includes('ADMIN_PIN'), JSON.stringify(cfg));
    ok('  and no session can be made', (() => { try { return S.verifySession(S.signSession(1), 2) === null; } catch (_) { return true; } })());
    process.env.ADMIN_PIN = '482913';
  }

  console.log('\n--- P1 gate ---');
  let G;
  try { G = fresh('lib/gate.js'); } catch (e) { ok('lib/gate.js loads', false, e.message); }
  if (G && S) {
    let res = mockRes();
    ok('no cookie: 401', (await G.requireAdmin({ headers: {} }, res)) === false && res.code === 401);
    ok('  never cached', res.headers['cache-control'] === 'no-store');
    res = mockRes();
    ok('a valid cookie passes', (await G.requireAdmin({ headers: { cookie: 'wf_admin=' + fresh('lib/session.js').signSession() } }, res)) === true);
    delete process.env.ADMIN_PIN;
    res = mockRes();
    ok('ADMIN_PIN unset: 503, fails closed', (await G.requireAdmin({ headers: {} }, res)) === false && res.code === 503 &&
       /ADMIN_PIN/.test(JSON.stringify(res.body)), JSON.stringify(res.body));
    process.env.ADMIN_PIN = '482913';
    res = mockRes();
    ok('requireJson: 415 for text/plain', G.requireJson({ headers: { 'content-type': 'text/plain' } }, res) === false && res.code === 415);
    ok('requireJson: fine for application/json; charset=utf-8', G.requireJson({ headers: { 'content-type': 'application/json; charset=utf-8' } }, mockRes()) === true);
  }

  console.log('\n--- P1 /api/adminauth ---');
  const ip = (n) => ({ 'x-forwarded-for': '203.0.113.' + n, 'content-type': 'application/json' });
  let r = await call('api/adminauth.js', { method: 'POST', body: { pin: '482913' }, headers: ip(1) });
  ok('the right PIN: ok, and a session cookie', r.code === 200 && r.body.ok === true && /^wf_admin=./.test(cookieOf(r)), JSON.stringify([r.code, r.body, cookieOf(r)]));
  const session = cookieOf(r);
  r = await call('api/adminauth.js', { method: 'GET', headers: { cookie: session } });
  ok('GET with it: signed in', r.body && r.body.signedIn === true && r.body.configured === true, JSON.stringify(r.body));
  r = await call('api/adminauth.js', { method: 'GET', headers: {} });
  ok('GET without it: not signed in', r.body && r.body.signedIn === false);
  r = await call('api/adminauth.js', { method: 'POST', body: { pin: '111111' }, headers: ip(2) });
  ok('a wrong PIN: 401 and no cookie', r.code === 401 && !r.headers['set-cookie']);
  r = await call('api/adminauth.js', { method: 'POST', body: { action: 'signout' }, headers: { cookie: session, 'content-type': 'application/json' } });
  ok('sign out clears the cookie', r.code === 200 && /Max-Age=0/.test(String(r.headers['set-cookie'])));
  for (let i = 0; i < 9; i++) await call('api/adminauth.js', { method: 'POST', body: { pin: '0000' + i }, headers: ip(3) });
  r = await call('api/adminauth.js', { method: 'POST', body: { pin: '00009' }, headers: ip(3) });
  ok('10 wrong PINs from one address are still answered', r.code === 401, r.code);
  r = await call('api/adminauth.js', { method: 'POST', body: { pin: '482913' }, headers: ip(3) });
  ok('  the 11th try, even the right PIN, waits: 429', r.code === 429 && !r.headers['set-cookie'], r.code);
  r = await call('api/adminauth.js', { method: 'POST', body: { pin: '482913' }, headers: ip(4) });
  ok('  another address is not blocked', r.code === 200);
  delete process.env.ADMIN_PIN;
  r = await call('api/adminauth.js', { method: 'POST', body: { pin: '2024' }, headers: ip(5) });
  ok('ADMIN_PIN unset: the editor keeps its old check (unchanged)', r.code === 200 && r.body.ok === true && r.body.configured === false);
  ok('  but no dashboard session is issued', !r.headers['set-cookie']);
  process.env.ADMIN_PIN = '482913';

  console.log('\n--- P2 gated reads ---');
  r = await call('api/analytics.js', {});
  ok('analytics without a session: 401', r.code === 401, r.code);
  ok('  and no question text', !/cedula|permit/i.test(JSON.stringify(r.body)));
  ok('  and no CORS header', !r.headers['access-control-allow-origin']);
  r = await call('api/analytics.js', { query: { format: 'csv' } });
  ok('analytics CSV without a session: 401, no question text', r.code === 401 && !/cedula/i.test(String(r.body)));
  r = await call('api/navlog.js', { method: 'GET' });
  ok('navigation read without a session: 401', r.code === 401 && !r.headers['access-control-allow-origin']);
  r = await call('api/navlog.js', { method: 'POST', body: { event: 'nav_start', department: 'BPLO' } });
  ok('navigation write stays open', r.code === 200 && r.body.ok === true && r.headers['access-control-allow-origin'] === '*');
  r = await call('api/analytics.js', { headers: { cookie: session } });
  ok('analytics with a session: 200', r.code === 200 && r.body.total === 4, JSON.stringify([r.code, r.body && r.body.total]));
  delete process.env.ADMIN_PIN;
  r = await call('api/analytics.js', { headers: { cookie: session } });
  ok('ADMIN_PIN unset: analytics 503 even with an old cookie', r.code === 503);
  process.env.ADMIN_PIN = '482913';

  console.log('\n--- P2 the public chips read ---');
  r = await call('api/analytics.js', { query: { view: 'chips' } });
  ok('open without a session', r.code === 200, r.code);
  ok('  only { chips }', r.body && JSON.stringify(Object.keys(r.body)) === '["chips"]', JSON.stringify(r.body));
  ok('  ranked from typed questions, no chip taps or health checks',
     r.body.chips[0].name === 'Cedula Service' && r.body.chips[0].count === 2 &&
     !r.body.chips.some((c) => /Tapped|Probe/.test(c.name)), JSON.stringify(r.body.chips));
  ok('  no question text', !/how do i|cedula po|please/i.test(JSON.stringify(r.body)));
  ok('  at most 5', r.body.chips.length <= 5);
  const chat = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/chat.js'), 'utf8');
  ok('the citizen chat reads the chips view', /\/api\/analytics\?view=chips/.test(chat));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
