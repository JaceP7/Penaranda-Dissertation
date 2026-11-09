/**
 * test_data_api.js - api/data.js, the dashboard's Data page (revamp Task 15b):
 * save a backup, remove one question, reset into an archive, restore.
 *
 * Jace asked (2026-11-09) for a way to save the analytics, remove one entry,
 * and reset everything for testing with a confirmation first. Reset MOVES the
 * logs into an archive (RENAME) instead of deleting them; the last 5 are kept.
 * The two resets done by hand that day used the same keys and metadata, so
 * they show up here too.
 *
 * Fake Redis; invented rows. Run: node tools/test_data_api.js <repo-root>
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

let DB = {};
const reset = () => {
  DB = {
    'wf:querylog': [
      JSON.stringify({ ts: 3, query: 'third question', department: 'A' }),
      JSON.stringify({ ts: 2, query: 'second question', department: 'B' }),
      JSON.stringify({ ts: 1, query: 'probe', synthetic: true }),
    ],
    'wf:navlog': [JSON.stringify({ ts: 2, event: 'nav_start' }), JSON.stringify({ ts: 1, event: 'nav_start' })],
  };
};
reset();
global.fetch = async (_u, o) => {
  const [op, key, a, b] = JSON.parse(o.body);
  let result = null;
  const L = () => (DB[key] = DB[key] || []);
  switch (op) {
    case 'LRANGE': { const l = DB[key] || []; result = l.slice(Number(a), Number(b) === -1 ? undefined : Number(b) + 1); break; }
    case 'LLEN': result = (DB[key] || []).length; break;
    case 'LPUSH': L().unshift(a); result = DB[key].length; break;
    case 'LTRIM': DB[key] = (DB[key] || []).slice(Number(a), Number(b) + 1); result = 'OK'; break;
    case 'LREM': { const l = DB[key] || []; const i = l.indexOf(b); if (i >= 0) { l.splice(i, 1); result = 1; } else result = 0; break; }
    case 'EXISTS': result = DB[key] && DB[key].length ? 1 : 0; break;
    case 'RENAME': if (!DB[key]) throw new Error('ERR no such key'); DB[a] = DB[key]; delete DB[key]; result = 'OK'; break;
    case 'DEL': result = DB[key] ? 1 : 0; delete DB[key]; break;
    default: result = null;
  }
  return { ok: true, json: async () => ({ result }) };
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
const P = path.resolve(ROOT, 'api/data.js');
const call = async (req, cookie = COOKIE) => {
  delete require.cache[P];
  const res = mockRes();
  const headers = Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {});
  await require(P)(Object.assign({ method: 'GET', query: {}, headers }, req), res);
  return res;
};
const id = (raw) => crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);

(async () => {
  console.log('\n--- needs the staff session ---');
  for (const [name, req] of [['backup', { query: { view: 'backup' } }], ['archives', { query: { view: 'archives' } }],
                             ['remove', { method: 'POST', body: { action: 'remove', id: 'x' } }],
                             ['reset', { method: 'POST', body: { action: 'reset', confirm: 'RESET' } }]]) {
    const r = await call(req, null);
    ok(`${name}: 401 without a session`, r.code === 401);
  }
  ok('  and nothing moved', DB['wf:querylog'].length === 3);

  console.log('\n--- backup ---');
  let r = await call({ query: { view: 'backup' } });
  const doc = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;   // sent as a download
  ok('both logs in full, health checks included', doc.questions.length === 3 && doc.navigation.length === 2 &&
     doc.questions.some((q) => q.synthetic), JSON.stringify(doc && [doc.questions && doc.questions.length]));
  ok('  as a download named in Manila time', /attachment; filename="calamba-analytics-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json"/.test(r.headers['content-disposition'] || ''),
     r.headers['content-disposition']);
  ok('  never cached, no CORS', r.headers['cache-control'] === 'no-store' && !r.headers['access-control-allow-origin']);

  console.log('\n--- remove one question ---');
  r = await call({ method: 'POST', body: { action: 'remove', id: 'ffffffffffffffff' } });
  ok('an unknown id: 404, nothing removed', r.code === 404 && DB['wf:querylog'].length === 3);
  const target = DB['wf:querylog'][1];
  r = await call({ method: 'POST', body: { action: 'remove', id: id(target) } });
  ok('removes exactly that row', r.code === 200 && DB['wf:querylog'].length === 2 && !DB['wf:querylog'].includes(target));
  const log0 = JSON.parse(DB['wf:data:log'][0]);
  ok('  and logs it with the row time, not its text', log0.action === 'remove' && log0.detail === '2' && log0.by === 'staff PIN' &&
     !/second question/.test(DB['wf:data:log'][0]), DB['wf:data:log'][0]);
  r = await call({ method: 'POST', body: { action: 'remove', id: id(target) } }, COOKIE);
  ok('POST must be JSON', (await call({ method: 'POST', body: {}, headers: { cookie: COOKIE, 'content-type': 'text/plain' } })).code === 415);

  console.log('\n--- reset into an archive ---');
  reset();
  r = await call({ method: 'POST', body: { action: 'reset' } });
  ok('without confirm: 400, nothing moved', r.code === 400 && DB['wf:querylog'].length === 3);
  r = await call({ method: 'POST', body: { action: 'reset', confirm: 'RESET' } });
  const meta = JSON.parse(DB['wf:archives'][0]);
  ok('moves both logs into an archive; the live logs are empty', r.code === 200 && !DB['wf:querylog'] && !DB['wf:navlog'] &&
     DB[`wf:archive:${meta.id}:querylog`].length === 3 && DB[`wf:archive:${meta.id}:navlog`].length === 2, JSON.stringify(Object.keys(DB)));
  ok('  with the right counts', meta.questions === 3 && meta.navigation === 2 && meta.by === 'staff PIN');
  DB['wf:querylog'] = [JSON.stringify({ ts: 9, query: 'new' })];
  r = await call({ method: 'POST', body: { action: 'reset', confirm: 'RESET' } });
  const m2 = JSON.parse(DB['wf:archives'][0]);
  ok('an empty navigation log still archives the questions', r.code === 200 && DB[`wf:archive:${m2.id}:querylog`].length === 1 && m2.navigation === 0);
  for (let i = 0; i < 4; i++) {
    DB['wf:querylog'] = [JSON.stringify({ ts: 100 + i, query: 'n' + i })];
    await new Promise((x) => setTimeout(x, 2));
    await call({ method: 'POST', body: { action: 'reset', confirm: 'RESET' } });
  }
  ok('only the last 5 resets are kept', DB['wf:archives'].length === 5, DB['wf:archives'].length);
  ok('  and the oldest one\'s logs are deleted, not left behind', !DB[`wf:archive:${meta.id}:querylog`] && !DB[`wf:archive:${meta.id}:navlog`]);

  console.log('\n--- the archive list ---');
  DB['wf:querylog'] = [JSON.stringify({ ts: 50, query: 'live' })];
  r = await call({ query: { view: 'archives' } });
  ok('current counts, the 5 archives, and the change log', r.body.current.questions === 1 && r.body.archives.length === 5 &&
     r.body.log.length >= 5 && r.body.log[0].action === 'reset', JSON.stringify(r.body.current));

  console.log('\n--- restore ---');
  const back = JSON.parse(DB['wf:archives'][2]);
  r = await call({ method: 'POST', body: { action: 'restore', id: back.id } });
  ok('without confirm: 400', r.code === 400);
  r = await call({ method: 'POST', body: { action: 'restore', id: 'nope', confirm: 'RESTORE' } });
  ok('an unknown archive: 404', r.code === 404);
  r = await call({ method: 'POST', body: { action: 'restore', id: back.id, confirm: 'RESTORE' } });
  ok('restore brings the archive back as the live log', r.code === 200 && DB['wf:querylog'].length === 1 &&
     JSON.parse(DB['wf:querylog'][0]).ts !== 50, JSON.stringify(DB['wf:querylog']));
  const saved = DB['wf:archives'].map((s) => JSON.parse(s));
  ok('  after saving the current log as a new archive first', saved.some((m) => m.id !== back.id && DB[`wf:archive:${m.id}:querylog`] &&
     JSON.parse(DB[`wf:archive:${m.id}:querylog`][0]).ts === 50));
  ok('  and the restored archive leaves the list', !saved.some((m) => m.id === back.id) && saved.length <= 5);
  ok('the change log records reset and restore', DB['wf:data:log'].map((s) => JSON.parse(s).action).includes('restore'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
