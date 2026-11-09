/**
 * test_admin_pages.js - wayfinding-app/js/admin_pages.js (revamp Tasks 14 and
 * 15b): the Overview, Questions, Hot times, Speed, Routes and Data pages.
 *
 *  - A static check that every piece of data reaching innerHTML goes through
 *    esc() or an ADMIN_CHARTS builder (stored XSS; see test_admin_charts.js).
 *  - The page HTML built from invented fixture data.
 *  - The Data page's reset: the backup downloads first, then RESET must be
 *    typed before the button works.
 *
 * Run: node tools/test_admin_pages.js <repo-root>
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
const F = (p) => path.resolve(ROOT, 'wayfinding-app/js', p);
if (!fs.existsSync(F('admin_pages.js'))) { ok('admin_pages.js exists', false); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
const src = fs.readFileSync(F('admin_pages.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(F('admin_charts.js'), 'utf8'), ctx);
vm.runInContext(src, ctx);
const P = ctx.ADMIN_PAGES;
const XSS = '<img src=x onerror=alert(1)>';

console.log('\n--- nothing reaches the page unescaped ---');
const risky = [...src.matchAll(/\$\{([^}]*\b(query|department|subservice|name|by|detail|note|lang)\b[^}]*)\}/g)]
  .map((m) => m[1]).filter((e) => !/\b(esc|C\.esc|officeName|C\.officeName|encodeURIComponent|fmt|C\.fmt|Number|String\(Number)/.test(e));
ok('every interpolated text field goes through esc()', risky.length === 0, risky.slice(0, 5).join(' | '));

const SUMMARY = {
  total: 198, latency: { n: 40, median: 900, p95: 2800, histogram: [{ lo: 0, hi: 500, count: 10 }, { lo: 500, hi: 1000, count: 30 }, { lo: 10000, hi: null, count: 0 }] },
  busiest: { weekday: 2, hour: 10, count: 14 }, hourWeekday: Array.from({ length: 7 }, () => new Array(24).fill(0)),
  topDepartments: [{ name: XSS, count: 9 }], topSubservices: [{ name: 'Cedula Service', count: 5 }],
  recentQueries: [{ query: XSS, department: 'CITY TREASURY MANAGEMENT OFFICE', latency_ms: 800, ts: Date.parse('2026-11-09T02:30:00Z'), lang: 'en' }],
  languages: [{ lang: 'en', count: 163 }, { lang: 'fil', count: 35 }], clarification: { count: 15, of: 198 },
  kinds: { service: 170, location: 12, scope: 10, unclear: 6 }, sources: { typed: 77, chip: 121 },
  scopeTopics: [{ name: 'amenity', count: 7 }], queriesPerDay: [{ date: '2026-11-09', count: 198 }], rangeLabel: 'All time (Manila time)',
};
const NAV = { started: 30, arrived: 5, abandoned: 17, noEnding: 8, rescans: 2, alreadyHere: 4, medianTimeToArrive: 33000,
              meanTimeToArrive: 41000, arrivalTimesN: 5, resolved: 22, topDestinations: [{ name: XSS, count: 6 }] };

console.log('\n--- overview ---');
const ov = P.renderOverview(SUMMARY, NAV);
ok('routes tile reads "5 of 22"', ov.includes('5 of 22'));
ok('small samples are tagged', ov.includes('Small sample'));
ok('answer time tile says "95% within"', ov.includes('95% within 2.8 s'));
ok('questions tile says how many were chip taps', /121 chip taps/.test(ov));
ok('no raw HTML from the data', !ov.includes('<img'));
ok('the newest question is in the recent list, escaped', ov.includes('&lt;img src=x'));
ok('times shown in Manila time', ov.includes('Nov 9, 10:30 AM'), (ov.match(/Nov 9[^<]*/) || [''])[0]);

console.log('\n--- questions ---');
ok('the list query carries q, office, lang, kind and page',
   P.questionsQuery({ from: '2026-11-01', to: '2026-11-09' }, { q: 'cédula po', office: 'A & B', lang: 'fil', kind: 'scope', page: 3 }) ===
   'view=questions&from=2026-11-01&to=2026-11-09&q=c%C3%A9dula%20po&office=A%20%26%20B&lang=fil&kind=scope&page=3&size=50',
   P.questionsQuery({ from: '2026-11-01', to: '2026-11-09' }, { q: 'cédula po', office: 'A & B', lang: 'fil', kind: 'scope', page: 3 }));
const rows = P.renderQuestionRows([{ id: 'abc123', ts: Date.parse('2026-11-09T02:30:00Z'), query: XSS, department: XSS, subservice: XSS,
                                     needsContext: true, latency_ms: 900, lang: 'fil', kind: 'scope', source: 'chip' }]);
ok('question rows are escaped', !rows.includes('<img') && rows.includes('&lt;img'));
ok('  carry a Remove button with the row id', /data-remove="abc123"/.test(rows));
ok('  and tags for clarify, out of scope and chip', /Asked to clarify/.test(rows) && /Out of scope/.test(rows) && /Chip/.test(rows));
const qp = P.renderQuestionsSummary(SUMMARY);
ok('the summary shows the clarification count of the total', qp.includes('15 of 198'));
ok('  typed vs chip and the out-of-scope topics', qp.includes('121 of 198 questions were chip taps') && /Facilities/.test(qp));

console.log('\n--- hot times, speed, routes ---');
ok('hot times lists the busiest slots', /Wed 10 AM/.test(P.renderHotTimes(Object.assign({}, SUMMARY, { hourWeekday: (() => { const m = Array.from({ length: 7 }, () => new Array(24).fill(0)); m[2][10] = 14; return m; })() }), false)));
ok('speed shows median and p95 with the sample size', /0\.9 s/.test(P.renderSpeed(SUMMARY, NAV)) && /from 40 answers/.test(P.renderSpeed(SUMMARY, NAV)));
const rt = P.renderRoutes(NAV);
ok('routes: the outcome bar and destinations, escaped', rt.includes('Arrived 5') && rt.includes('No ending recorded 8') && !rt.includes('<img'));
ok('routes: re-scans and "already here"', /Re-scans/.test(rt) && /already here/i.test(rt));
ok('an empty range says so', /Try a wider range/.test(P.renderOverview(Object.assign({}, SUMMARY, { total: 0, recentQueries: [], topDepartments: [], busiest: null, latency: { n: 0, histogram: [] } }), { started: 0, arrived: 0, abandoned: 0 })));

console.log('\n--- data page ---');
const ARCH = { current: { questions: 37, navigation: 41 },
  archives: [{ id: '1794197532000', at: Date.parse('2026-11-09T02:28:00Z'), by: 'staff PIN', questions: 95, navigation: 175 }],
  log: [{ action: 'reset', by: 'staff PIN', at: Date.parse('2026-11-09T02:28:00Z'), detail: 'archive 1794197532000' }] };
const dp = P.renderData(ARCH);
ok('shows the current counts', dp.includes('37 questions') && dp.includes('41 route events'));
ok('lists each archive with Download and Restore', /data-restore="1794197532000"/.test(dp) && /view=archive&amp;id=1794197532000|view=archive&id=1794197532000/.test(dp));
ok('says it keeps the last 5', /last 5/.test(dp));
ok('reset is allowed only with RESET typed after the backup', P.resetAllowed('RESET', true) && !P.resetAllowed('RESET', false) &&
   !P.resetAllowed('reset', true) && !P.resetAllowed('RESE', true));
(async () => {
  const order = [];
  await P.startReset({ download: async (url) => { order.push('download ' + url); } }, { enableInput: () => order.push('enable') });
  ok('starting a reset downloads the backup before enabling the input', order.join(' | ') === 'download /api/data?view=backup | enable', order.join(' | '));
  const rd = P.renderRemoveDialog({ query: XSS, ts: Date.parse('2026-11-09T02:30:00Z') });
  ok('the Remove dialog quotes the question, escaped, with its Manila time', rd.includes('&lt;img') && !rd.includes('<img') && rd.includes('Nov 9, 10:30 AM'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
