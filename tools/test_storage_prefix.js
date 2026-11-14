/**
 * test_storage_prefix.js - preview deployments must not share Redis keys with
 * the live site (lib/keys.js, WF_KEY_PREFIX), and an unisolated preview must
 * neither publish the map nor write logs. Fake fetch only; nothing live.
 *
 * Run: node tools/test_storage_prefix.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

process.env.UPSTASH_REDIS_REST_URL   = 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'faketoken';
process.env.UPSTASH_VECTOR_REST_URL  = 'https://vector.fake';
process.env.UPSTASH_VECTOR_REST_TOKEN = 'vtoken';
process.env.GROQ_API_KEY             = 'gtoken';
process.env.MAP_ADMIN_TOKEN          = 'secret-token';
delete process.env.WF_KEY_PREFIX;
delete process.env.VERCEL_ENV;

let cmds = [];
global.fetch = async (_url, opts) => {
  const cmd = JSON.parse(opts.body);
  cmds.push(cmd);
  return { ok: true, status: 200, json: async () => ({ result: null }), text: async () => '{}', headers: { get: () => null } };
};
function mockRes() {
  const r = { code: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const load = (f) => { const p = path.resolve(ROOT, f); delete require.cache[p]; return require(p); };

(async () => {
  console.log('\n--- lib/keys.js ---');
  const { key, previewUnisolated } = load('lib/keys.js');
  ok('no prefix leaves the key alone', key('wf:mapstate') === 'wf:mapstate');
  process.env.WF_KEY_PREFIX = 'pv1:';
  ok('the prefix is applied, read on every call', key('wf:mapstate') === 'pv1:wf:mapstate');
  delete process.env.WF_KEY_PREFIX;
  ok('previewUnisolated is false outside preview', previewUnisolated() === false);
  process.env.VERCEL_ENV = 'preview';
  ok('previewUnisolated is true on a preview with no prefix', previewUnisolated() === true);
  process.env.WF_KEY_PREFIX = 'pv1:';
  ok('previewUnisolated is false once a prefix is set', previewUnisolated() === false);
  delete process.env.WF_KEY_PREFIX;
  delete process.env.VERCEL_ENV;

  console.log('\n--- no literal keys left in the api files ---');
  for (const f of ['adminauth', 'analytics', 'chat', 'data', 'mapstate', 'navlog']) {
    const src = fs.readFileSync(path.resolve(ROOT, `api/${f}.js`), 'utf8');
    const bad = [];
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\*|\/\/)/.test(line)) return;               // comments
      const re = /(['`])wf:/g; let m;
      while ((m = re.exec(line))) {
        if (!/key\(\s*$/.test(line.slice(0, m.index))) bad.push(`${i + 1}: ${line.trim()}`);
      }
    });
    ok(`api/${f}.js wraps every wf: key in key()`, bad.length === 0, bad.join(' | '));
  }

  console.log('\n--- an unisolated preview ---');
  process.env.VERCEL_ENV = 'preview';
  const mapstate = load('api/mapstate.js');
  let res = mockRes(); cmds = [];
  await mapstate({ method: 'POST', headers: { authorization: 'Bearer secret-token' }, body: { state: { a: 1 } } }, res);
  ok('mapstate POST is refused 503', res.code === 503, res.code);
  ok('  and says to set WF_KEY_PREFIX', /WF_KEY_PREFIX/.test(JSON.stringify(res.body)), JSON.stringify(res.body));
  ok('  and writes nothing', !cmds.some((c) => c[0] === 'SET' || c[0] === 'LPUSH'));

  const navlog = load('api/navlog.js');
  res = mockRes(); cmds = [];
  await navlog({ method: 'POST', body: { event: 'nav_start' }, headers: {}, query: {} }, res);
  ok('navlog does not LPUSH', !cmds.some((c) => c[0] === 'LPUSH'), JSON.stringify(cmds));

  const chat = load('api/chat.js');
  res = mockRes(); cmds = [];
  await chat({ method: 'POST', body: { query: 'where is BPLO?' }, headers: {} }, res);
  ok('chat still answers', res.code === 200, res.code);
  ok('chat does not LPUSH', !cmds.some((c) => c[0] === 'LPUSH'), JSON.stringify(cmds));

  console.log('\n--- a prefixed preview writes under the prefix ---');
  process.env.WF_KEY_PREFIX = 'pv1:';
  const navlog2 = load('api/navlog.js');
  res = mockRes(); cmds = [];
  await navlog2({ method: 'POST', body: { event: 'nav_start' }, headers: {}, query: {} }, res);
  ok('navlog LPUSHes to pv1:wf:navlog', cmds.some((c) => c[0] === 'LPUSH' && c[1] === 'pv1:wf:navlog'), JSON.stringify(cmds));
  const chat2 = load('api/chat.js');
  res = mockRes(); cmds = [];
  await chat2({ method: 'POST', body: { query: 'where is BPLO?' }, headers: {} }, res);
  ok('chat LPUSHes to pv1:wf:querylog', cmds.some((c) => c[0] === 'LPUSH' && c[1] === 'pv1:wf:querylog'), JSON.stringify(cmds));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
