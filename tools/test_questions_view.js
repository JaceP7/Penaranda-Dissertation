/**
 * test_questions_view.js - GET /api/analytics?view=questions (revamp Task 10):
 * the dashboard's full question list, searched and paged on the server. The
 * old dashboard could only show the newest 20.
 *
 * Invented rows only. Run: node tools/test_questions_view.js <repo-root>
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
process.env.UPSTASH_REDIS_REST_URL = 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'faketoken-long-enough';
process.env.ADMIN_PIN = 'test-pin-4821';
const COOKIE = 'wf_admin=' + require(path.resolve(ROOT, 'lib/session.js')).signSession();

// 120 rows, newest first (LPUSH order); row i has ts 1000 - i.
const RAW = [];
for (let i = 0; i < 120; i++) {
  RAW.push(JSON.stringify({
    ts: Date.parse('2026-10-10T02:00:00Z') - i * 60000,
    query: i === 7 ? 'Paano kumuha ng CEDULA po' : 'question ' + i,
    department: i % 3 === 0 ? 'TREASURY' : 'BPLO', subservice: 'S' + (i % 4),
    needsContext: i % 10 === 0, latency_ms: 500 + i, lang: i % 2 ? 'fil' : 'en',
    kind: i === 9 ? 'location' : undefined,
  }));
}
RAW.push(JSON.stringify({ ts: Date.parse('2026-10-10T02:00:00Z'), query: 'probe', department: 'X', synthetic: true }));
global.fetch = async (_u, o) => {
  const [op, , a, b] = JSON.parse(o.body);
  return { ok: true, json: async () => ({ result: op === 'LRANGE' ? RAW.slice(Number(a), Number(b) + 1) : 'OK' }) };
};
function mockRes() {
  const r = { code: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (x) => { r.body = x; return r; };
  r.send = (x) => { r.body = x; return r; };
  r.end = () => r;
  return r;
}
const P = path.resolve(ROOT, 'api/analytics.js');
const call = async (query, cookie = COOKIE) => {
  delete require.cache[P];
  const res = mockRes();
  await require(P)({ method: 'GET', query: Object.assign({ view: 'questions' }, query), headers: cookie ? { cookie } : {} }, res);
  return res;
};

(async () => {
  let r = await call({ page: '2', size: '50' });
  ok('page 2 of size 50 returns rows 51-100, newest first',
     r.body.rows.length === 50 && r.body.rows[0].query === 'question 50' && r.body.rows[49].query === 'question 99',
     JSON.stringify([r.body.rows && r.body.rows[0] && r.body.rows[0].query, r.body.total]));
  ok('  with the totals', r.body.total === 120 && r.body.pages === 3 && r.body.page === 2 && r.body.size === 50);
  ok('  health checks left out', !r.body.rows.some((x) => x.query === 'probe'));
  r = await call({ size: '999' });
  ok('size 999 clamps to 200', r.body.size === 200 && r.body.rows.length === 120);
  r = await call({ page: '99' });
  ok('a page past the end clamps to the last page', r.body.page === 3 && r.body.rows.length === 20, JSON.stringify([r.body.page, r.body.rows.length]));
  r = await call({ q: 'cedula' });
  ok('search matches whatever the case, in Filipino text', r.body.total === 1 && r.body.rows[0].query === 'Paano kumuha ng CEDULA po');
  r = await call({ office: 'TREASURY' });
  ok('office filter is exact', r.body.total === 40 && r.body.rows.every((x) => x.department === 'TREASURY'));
  ok('  and the office list covers the range', JSON.stringify(r.body.offices) === JSON.stringify(['BPLO', 'TREASURY']), JSON.stringify(r.body.offices));
  r = await call({ lang: 'fil' });
  ok('language filter', r.body.total === 60 && r.body.rows.every((x) => x.lang === 'fil'));
  r = await call({ kind: 'location' });
  ok('kind filter, rows carry kind', r.body.total === 1 && r.body.rows[0].kind === 'location');
  r = await call({});
  ok('rows carry kind "service" when the log has none', r.body.rows[0].kind === 'service');
  const want = crypto.createHash('sha256').update(RAW[0]).digest('hex').slice(0, 16);
  ok('each row has the id the Remove button uses (sha256 of the stored line, 16 hex)', r.body.rows[0].id === want, r.body.rows[0].id);
  r = await call({}, null);
  ok('401 without a session', r.code === 401 && !r.body.rows);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
