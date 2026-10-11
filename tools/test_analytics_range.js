/**
 * test_analytics_range.js - date filtering, CSV export and paged reads in
 * api/analytics.js, against a FAKE Redis so no live data is touched.
 *
 * Run: node tools/test_analytics_range.js <repo-root>
 */
'use strict';
const path = require('path');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

process.env.UPSTASH_REDIS_REST_URL   = 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'faketoken';

// Newest first, as LPUSH leaves the list.
const DAY = 86400000;
const at = (iso) => new Date(iso + 'T09:00:00Z').getTime();
let LOG = [
  { ts: at('2026-10-10'), query: 'business permit',        department: 'BPLO',     subservice: 'New permit', needsContext: false, latency_ms: 900,  lang: 'en' },
  { ts: at('2026-10-05'), query: 'cedula, magkano po?',    department: 'TREASURY', subservice: 'Cedula',     needsContext: false, latency_ms: 1100, lang: 'fil' },
  { ts: at('2026-10-05'), query: 'birth certificate',      department: 'CIVIL REGISTRY', subservice: 'Birth cert', needsContext: false, latency_ms: 800, lang: 'en' },
  { ts: at('2026-10-01'), query: 'saan po ang "office"?',  department: null,       subservice: null,         needsContext: true,  latency_ms: 700,  lang: 'fil' },
  { ts: at('2026-09-20'), query: 'old one, out of range',  department: 'BPLO',     subservice: 'Renewal',    needsContext: false, latency_ms: 1000, lang: 'en' },
];

global.fetch = async (_url, opts) => {
  const [op, , start, stop] = JSON.parse(opts.body);
  let result = [];
  if (op === 'LRANGE') {
    const a = Number(start), b = Number(stop);
    result = LOG.slice(a, b + 1).map((e) => JSON.stringify(e));
  }
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

const P = path.resolve(ROOT, 'api/analytics.js');
const load = () => { delete require.cache[P]; return require(P); };
const call = async (query) => {
  const res = mockRes();
  await load()({ method: 'GET', query, headers: {} }, res);
  return res;
};

(async () => {
  console.log('\n--- api/analytics.js: date range + CSV (fake Redis) ---');

  let r = await call({});
  ok('no range returns every entry', r.body.total === 5, JSON.stringify(r.body.total));
  ok('no range reports applied:false', r.body.range.applied === false);
  ok('all-time per-day series is 7 days', r.body.queriesPerDay.length === 7);

  r = await call({ from: '2026-10-01', to: '2026-10-10' });
  ok('range filters out the September entry', r.body.total === 4, String(r.body.total));
  ok('range is echoed back', r.body.range.from === '2026-10-01' && r.body.range.to === '2026-10-10');
  ok('scanned still reports the full log', r.body.scanned === 5);
  ok('per-day series spans the window', r.body.queriesPerDay.length === 10,
     String(r.body.queriesPerDay.length));
  ok('per-day counts land on the right dates',
     r.body.queriesPerDay.find((d) => d.date === '2026-10-05').count === 2);

  r = await call({ from: '2026-10-05', to: '2026-10-05' });
  ok('single-day range works', r.body.total === 2, String(r.body.total));

  r = await call({ from: '2026-10-10', to: '2026-10-01' });
  ok('a reversed range is swapped, not emptied', r.body.total === 4, String(r.body.total));

  r = await call({ from: '2026-01-01', to: '2026-01-02' });
  ok('an empty window returns a note, not an error',
     r.body.total === 0 && /No queries in the selected date range/.test(r.body._note || ''));

  r = await call({ from: 'garbage' });
  ok('a malformed date is ignored rather than fatal', r.body.total === 5 && r.body.range.applied === false);

  // ambiguity + latency over the window
  r = await call({ from: '2026-10-01', to: '2026-10-10' });
  ok('ambiguity rate counts the clarification row', r.body.ambiguityRate === 25,
     String(r.body.ambiguityRate));
  ok('avg latency is over the filtered rows only', r.body.avgLatency === 875,
     String(r.body.avgLatency));

  // recentQueries must carry the fields the dashboard table reads
  const row = r.body.recentQueries[0];
  ['timestamp', 'needsContext', 'latency_ms', 'lang', 'ts'].forEach((f) => {
    ok(`recentQueries carries ${f}`, Object.prototype.hasOwnProperty.call(row, f));
  });

  // ── CSV ───────────────────────────────────────────────────────────────────
  r = await call({ format: 'csv' });
  ok('CSV sets a csv content type', /text\/csv/.test(r.headers['content-type'] || ''));
  ok('CSV sets a download filename',
     /attachment; filename="calamba-queries-all-time\.csv"/.test(r.headers['content-disposition'] || ''));
  ok('CSV starts with a UTF-8 BOM for Excel', r.body.charCodeAt(0) === 0xFEFF);

  let lines = r.body.replace(/^﻿/, '').trim().split('\r\n');
  ok('CSV has a header plus one row per entry', lines.length === 6, String(lines.length));
  ok('CSV header names the columns',
     lines[0] === 'timestamp_utc,date,query,department,subservice,needs_context,latency_ms,lang');
  ok('CSV is oldest-first', /2026-09-20/.test(lines[1]), lines[1]);
  ok('CSV quotes a field containing a comma', /"cedula, magkano po\?"/.test(r.body));
  ok('CSV doubles embedded quotes', /saan po ang ""office""\?/.test(r.body));
  ok('CSV renders booleans as yes/no', /,yes,/.test(r.body) && /,no,/.test(r.body));

  r = await call({ format: 'csv', from: '2026-10-05', to: '2026-10-05' });
  lines = r.body.replace(/^﻿/, '').trim().split('\r\n');
  ok('CSV honours the date range', lines.length === 3, String(lines.length));
  ok('ranged CSV names the window in the filename',
     /calamba-queries-2026-10-05_to_2026-10-05\.csv/.test(r.headers['content-disposition'] || ''));

  // ── paging: more entries than one chunk ───────────────────────────────────
  const big = [];
  for (let i = 0; i < 6000; i++) {
    big.push({ ts: Date.now() - i * 1000, query: 'q' + i, department: 'BPLO',
               subservice: null, needsContext: false, latency_ms: 500, lang: 'en' });
  }
  LOG = big;
  r = await call({});
  ok('a log larger than one chunk is read in full', r.body.total === 6000, String(r.body.total));
  ok('a full read is not flagged as capped', r.body.capped === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
