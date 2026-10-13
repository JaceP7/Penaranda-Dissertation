/**
 * test_navlog.js - api/navlog.js and the synthetic-traffic exclusion in
 * api/analytics.js, against a FAKE Redis so no live data is touched.
 *
 * Run: node tools/test_navlog.js <repo-root>
 */
'use strict';
const path = require('path');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

process.env.UPSTASH_REDIS_REST_URL   = 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'faketoken';

const store = {};
global.fetch = async (_url, opts) => {
  const [op, key, ...rest] = JSON.parse(opts.body);
  let result = null;
  if (op === 'LPUSH')       { (store[key] = store[key] || []).unshift(rest[0]); result = store[key].length; }
  else if (op === 'LTRIM')  { store[key] = (store[key] || []).slice(Number(rest[0]), Number(rest[1]) + 1); result = 'OK'; }
  else if (op === 'LRANGE') { const l = store[key] || []; const a = Number(rest[0]), b = Number(rest[1]);
                              result = l.slice(a, b === -1 ? undefined : b + 1); }
  else if (op === 'GET')    { result = store[key] ?? null; }
  return { ok: true, json: async () => ({ result }) };
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

const NAV = path.resolve(ROOT, 'api/navlog.js');
const ANA = path.resolve(ROOT, 'api/analytics.js');
const load = (p) => { delete require.cache[p]; return require(p); };
const post = async (body) => { const r = mockRes(); await load(NAV)({ method: 'POST', body, headers: {}, query: {} }, r); return r; };
const get  = async (query) => { const r = mockRes(); await load(NAV)({ method: 'GET', query: query || {}, headers: {} }, r); return r; };

const DAY = 86400000;
const T = (iso) => new Date(iso + 'T09:00:00Z').getTime();

(async () => {
  console.log('\n--- api/navlog.js (fake Redis) ---');

  let r = await post({ event: 'nonsense' });
  ok('an unknown event name is refused 400', r.code === 400);
  r = await post({});
  ok('an empty body is refused 400', r.code === 400);

  // one completed trip
  await post({ event: 'nav_start',  sid: 'a', department: 'TREASURY', toFloor: 1, toRow: 14, toCol: 37, pathLen: 70 });
  await post({ event: 'nav_arrive', sid: 'a', department: 'TREASURY', elapsed_ms: 60000, pathLen: 70 });
  // one abandoned
  await post({ event: 'nav_start',   sid: 'b', department: 'CIVIL REGISTRY', toFloor: 1, toRow: 37, toCol: 14 });
  await post({ event: 'qr_rescan',   sid: 'b', department: 'CIVIL REGISTRY', rescans: 1 });
  await post({ event: 'nav_abandon', sid: 'b', department: 'CIVIL REGISTRY', elapsed_ms: 20000 });
  // a second completed trip to the same office, slower
  await post({ event: 'nav_start',  sid: 'c', department: 'TREASURY' });
  await post({ event: 'nav_arrive', sid: 'c', department: 'TREASURY', elapsed_ms: 120000 });

  r = await get({});
  ok('counts starts',    r.body.started === 3,   r.body.started);
  ok('counts arrivals',  r.body.arrived === 2,   r.body.arrived);
  ok('counts abandons',  r.body.abandoned === 1, r.body.abandoned);
  ok('counts re-scans',  r.body.rescans === 1,   r.body.rescans);
  ok('arrival rate is over resolved routes only', r.body.arrivalRate === 66.7, r.body.arrivalRate);
  ok('resolved excludes still-open routes', r.body.resolved === 3, r.body.resolved);
  ok('median time to arrive', r.body.medianTimeToArrive === 90000, r.body.medianTimeToArrive);
  ok('mean time to arrive',   r.body.meanTimeToArrive === 90000,   r.body.meanTimeToArrive);
  ok('top destination is the most-routed office',
     r.body.topDestinations[0].name === 'TREASURY' && r.body.topDestinations[0].count === 2,
     JSON.stringify(r.body.topDestinations));

  // an arrival with no start must not make the rate exceed 100%
  await post({ event: 'nav_arrive', sid: 'z', department: 'X', elapsed_ms: 1000 });
  r = await get({});
  ok('a stray arrival cannot push the rate above 100', r.body.arrivalRate <= 100, r.body.arrivalRate);

  // ── validation / clamping ────────────────────────────────────────────────
  await post({ event: 'nav_start', sid: 'x'.repeat(200), department: 'y'.repeat(500),
               toFloor: 99, toRow: -5, elapsed_ms: 999999999999, pathLen: 'abc' });
  r = await get({});
  const junk = (await get({})).body;
  const rowsCsv = (await get({ format: 'csv' })).body;
  ok('an oversized sid is clamped to 40 chars', /x{40},/.test(rowsCsv) && !/x{41}/.test(rowsCsv));
  ok('an out-of-range floor is dropped', !/,99:/.test(rowsCsv));
  ok('an absurd elapsed_ms is dropped', !/999999999999/.test(rowsCsv));
  ok('a non-numeric pathLen is dropped', !/abc/.test(rowsCsv));

  // ── CSV ──────────────────────────────────────────────────────────────────
  r = await get({ format: 'csv' });
  ok('CSV content type', /text\/csv/.test(r.headers['content-type'] || ''));
  ok('CSV filename', /calamba-navigation-all-time\.csv/.test(r.headers['content-disposition'] || ''));
  ok('CSV has a BOM', r.body.charCodeAt(0) === 0xFEFF);
  const lines = r.body.replace(/^﻿/, '').trim().split('\r\n');
  ok('CSV header', lines[0].startsWith('timestamp_utc,date,event,sid,department'));
  ok('CSV has a row per event', lines.length === 10, lines.length);

  // ── date filter ──────────────────────────────────────────────────────────
  store['wf:navlog'] = [
    { ts: T('2026-10-10'), event: 'nav_start',  sid: 'p', department: 'A' },
    { ts: T('2026-10-10'), event: 'nav_arrive', sid: 'p', department: 'A', elapsed_ms: 5000 },
    { ts: T('2026-09-01'), event: 'nav_start',  sid: 'q', department: 'B' },
  ].map((o) => JSON.stringify(o));
  r = await get({ from: '2026-10-01', to: '2026-10-31' });
  ok('date range filters the old event out', r.body.started === 1 && r.body.total === 2,
     `${r.body.started}/${r.body.total}`);
  r = await get({ from: '2026-10-31', to: '2026-10-01' });
  ok('a reversed range is swapped, not emptied', r.body.total === 2, r.body.total);

  // ── synthetic exclusion ──────────────────────────────────────────────────
  console.log('\n--- synthetic exclusion ---');
  store['wf:navlog'] = [
    { ts: Date.now(), event: 'nav_start', sid: 'r', department: 'REAL' },
    { ts: Date.now(), event: 'nav_start', sid: 's', department: 'PROBE', synthetic: true },
  ].map((o) => JSON.stringify(o));
  r = await get({});
  ok('navlog hides synthetic events by default', r.body.started === 1, r.body.started);
  r = await get({ synthetic: '1' });
  ok('navlog can include them on request', r.body.started === 2, r.body.started);

  store['wf:querylog'] = [
    { ts: Date.now(), query: 'real citizen question', department: 'A', latency_ms: 900 },
    { ts: Date.now(), query: 'How do I get a business permit?', department: 'B', latency_ms: 800, synthetic: true },
    { ts: Date.now(), query: 'How do I get a business permit?', department: 'B', latency_ms: 850, synthetic: true },
  ].map((o) => JSON.stringify(o));
  const ares = mockRes();
  await load(ANA)({ method: 'GET', query: {}, headers: {} }, ares);
  ok('analytics hides health-check queries by default', ares.body.total === 1, ares.body.total);
  ok('analytics reports how many it withheld', ares.body.syntheticExcluded === 2, ares.body.syntheticExcluded);
  ok('the probe string is not the top department',
     !(ares.body.topDepartments || []).some((d) => d.name === 'B'),
     JSON.stringify(ares.body.topDepartments));

  const ares2 = mockRes();
  await load(ANA)({ method: 'GET', query: { synthetic: '1' }, headers: {} }, ares2);
  ok('analytics can include them on request', ares2.body.total === 3, ares2.body.total);

  const acsv = mockRes();
  await load(ANA)({ method: 'GET', query: { format: 'csv' }, headers: {} }, acsv);
  ok('the CSV export excludes them too, matching the dashboard',
     acsv.body.replace(/^﻿/, '').trim().split('\r\n').length === 2,
     acsv.body.replace(/^﻿/, '').trim().split('\r\n').length);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
