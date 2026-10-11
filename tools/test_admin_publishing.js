/**
 * test_admin.js - exercises the new admin logic without touching live data.
 *
 *  1. Pure client helpers (fingerprint, diff, summary) lifted out of app.js.
 *  2. api/mapstate.js against a FAKE Redis, so conflict / rollback / auth paths
 *     are tested without writing to the real published map.
 *
 * Run: node test_admin.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

// ── 1. client helpers ────────────────────────────────────────────────────────
console.log('\n--- client helpers (lifted from js/app.js) ---');
const appSrc = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/app.js'), 'utf8');
function lift(name) {
  const i = appSrc.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`cannot find ${name} in app.js`);
  // walk braces from the first { after the signature
  let j = appSrc.indexOf('{', i), depth = 0, k = j;
  for (; k < appSrc.length; k++) {
    if (appSrc[k] === '{') depth++;
    else if (appSrc[k] === '}') { depth--; if (depth === 0) break; }
  }
  return appSrc.slice(i, k + 1);
}
const sandbox = { _floorName: (f) => `Floor ${f}`, console };
vm.createContext(sandbox);
vm.runInContext(
  [lift('_mapFingerprint'), lift('_diffMapStates'), lift('_describeDiff')].join('\n') +
  '\n;this.API = { _mapFingerprint, _diffMapStates, _describeDiff };', sandbox);
const { _mapFingerprint, _diffMapStates, _describeDiff } = sandbox.API;

const base = {
  grid: { floorWalls: { 0: ['open', 'wall', 'open'], 1: ['open', 'open', 'open'] } },
  stampPlacements: [{ id: 'a', name: 'Treasury', row: 1, col: 1, floor: 1 },
                    { id: 'b', name: 'Mayor', row: 2, col: 2, floor: 2 }],
  floorNames: { 0: 'Lower Ground', 1: 'Ground' },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

ok('fingerprint is stable for identical payloads',
   _mapFingerprint(base) === _mapFingerprint(clone(base)));

const changed = clone(base); changed.grid.floorWalls[0][2] = 'door';
ok('fingerprint changes when one cell changes',
   _mapFingerprint(base) !== _mapFingerprint(changed));

ok('key-order does not affect the fingerprint equality check',
   _mapFingerprint(base) === _mapFingerprint(clone(base)));

let d = _diffMapStates(changed, base);
ok('diff counts the single changed cell', d.cells === 1, JSON.stringify(d));
ok('diff attributes it to the right floor', d.floors.length === 1 && d.floors[0].floor === 0);

const moved = clone(base); moved.stampPlacements[0].row = 9;
ok('diff detects a moved room', _diffMapStates(moved, base).stampsMoved === 1);

const added = clone(base);
added.stampPlacements.push({ id: 'c', name: 'Health', row: 3, col: 3, floor: 1 });
ok('diff detects an added room', _diffMapStates(added, base).stampsAdded === 1);

const removed = clone(base); removed.stampPlacements.pop();
ok('diff detects a removed room', _diffMapStates(removed, base).stampsRemoved === 1);

const renamed = clone(base); renamed.floorNames[1] = 'Main Hall';
ok('diff detects a renamed floor', _diffMapStates(renamed, base).namesChanged === 1);

ok('identical states diff to nothing', (() => {
  const z = _diffMapStates(clone(base), base);
  return z.cells === 0 && !z.stampsAdded && !z.stampsRemoved && !z.stampsMoved && !z.namesChanged;
})());

ok('summary is human-readable', /1 wall\/door\/stair cell changed/.test(_describeDiff(d)),
   _describeDiff(d));
ok('empty summary says so', /no differences/.test(_describeDiff(_diffMapStates(clone(base), base))));
ok('diff against a null live state is safe', _diffMapStates(base, null).cells === 0);

(async () => {
  // ── 2. api/mapstate.js against a fake Redis ─────────────────────────────────
  console.log('\n--- api/mapstate.js (fake Redis, no live writes) ---');
  process.env.UPSTASH_REDIS_REST_URL   = 'https://fake.local';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'faketoken';
  process.env.MAP_ADMIN_TOKEN          = 'secret-token';

  const store = { kv: {}, lists: {} };
  global.fetch = async (_url, opts) => {
    const cmd = JSON.parse(opts.body);
    const [op, key, ...rest] = cmd;
    let result = null;
    if (op === 'GET')        result = store.kv[key] ?? null;
    else if (op === 'SET')   { store.kv[key] = rest[0]; result = 'OK'; }
    else if (op === 'LPUSH') { (store.lists[key] = store.lists[key] || []).unshift(rest[0]); result = store.lists[key].length; }
    else if (op === 'LTRIM') { store.lists[key] = (store.lists[key] || []).slice(rest[0], rest[1] + 1); result = 'OK'; }
    else if (op === 'LRANGE'){ const l = store.lists[key] || []; result = l.slice(rest[0], rest[1] === -1 ? undefined : rest[1] + 1); }
    return { ok: true, json: async () => ({ result }) };
  };
  delete require.cache[require.resolve(path.resolve(ROOT, 'api/mapstate.js'))];
  const handler = require(path.resolve(ROOT, 'api/mapstate.js'));

  function mockRes() {
    const r = { code: 200, body: null, headers: {} };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.end = () => r;
    return r;
  }
  const call = async (req) => { const res = mockRes(); await handler(req, res); return res; };
  const AUTH = { authorization: 'Bearer secret-token' };

  let r = await call({ method: 'GET', query: {}, headers: {} });
  ok('GET on an empty store returns version 0', r.body.version === 0 && r.body.state === null);

  r = await call({ method: 'POST', headers: {}, body: { state: base } });
  ok('POST without a token is rejected 401', r.code === 401);

  r = await call({ method: 'POST', headers: AUTH, body: { state: base, updatedBy: 'Jester' } });
  ok('first publish succeeds as v1', r.code === 200 && r.body.version === 1, JSON.stringify(r.body));

  r = await call({ method: 'GET', query: {}, headers: {} });
  ok('GET now returns v1 with the author', r.body.version === 1 && r.body.updatedBy === 'Jester');

  // stale publish -> 409
  r = await call({ method: 'POST', headers: AUTH, body: { state: changed, updatedBy: 'Bea', baseVersion: 0 } });
  ok('publish based on a stale version is refused 409', r.code === 409 && r.body.conflict === true,
     JSON.stringify(r.body));
  ok('409 names who got there first', r.body.updatedBy === 'Jester');

  // correct base -> accepted
  r = await call({ method: 'POST', headers: AUTH, body: { state: changed, updatedBy: 'Bea', baseVersion: 1 } });
  ok('publish based on the current version succeeds as v2', r.code === 200 && r.body.version === 2);

  // force overrides the guard
  r = await call({ method: 'POST', headers: AUTH, body: { state: base, updatedBy: 'Bea', baseVersion: 0, force: true } });
  ok('force overrides the stale-base guard', r.code === 200 && r.body.version === 3);

  r = await call({ method: 'GET', query: { history: '1' }, headers: {} });
  ok('history lists the archived versions', r.body.history.length === 2, JSON.stringify(r.body.history));
  ok('history reports the live version', r.body.currentVersion === 3);
  ok('history carries no state blobs', r.body.history.every((h) => h.state === undefined));

  r = await call({ method: 'GET', query: { version: '1' }, headers: {} });
  ok('an archived version can be fetched in full', r.body.version === 1 && !!r.body.state);

  r = await call({ method: 'POST', headers: AUTH, body: { rollbackTo: 1, updatedBy: 'Jester' } });
  ok('rollback publishes forward as a new version', r.code === 200 && r.body.version === 4);

  r = await call({ method: 'GET', query: {}, headers: {} });
  ok('rollback restored the v1 state',
     JSON.stringify(r.body.state) === JSON.stringify(base), 'state mismatch');
  ok('rollback is annotated', /rolled back to v1/.test(r.body.note || ''));

  r = await call({ method: 'POST', headers: AUTH, body: { rollbackTo: 999, updatedBy: 'x' } });
  ok('rollback to a missing version is 404', r.code === 404);

  r = await call({ method: 'POST', headers: AUTH, body: {} });
  ok('POST with no state and no rollback is 400', r.code === 400);

  // older client that omits baseVersion must still work
  r = await call({ method: 'POST', headers: AUTH, body: { state: base, updatedBy: 'legacy' } });
  ok('a client omitting baseVersion is still accepted', r.code === 200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);

  console.log(`
${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
