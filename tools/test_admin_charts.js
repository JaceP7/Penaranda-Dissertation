/**
 * test_admin_charts.js - wayfinding-app/js/admin_charts.js (revamp Task 13):
 * pure functions that return HTML strings for the dashboard. Run in a vm, no
 * DOM. The first check is the one that matters most: a citizen's question is
 * shown to a signed-in staff member who can publish the map, so unescaped
 * text would be stored XSS with real power.
 *
 * Run: node tools/test_admin_charts.js <repo-root>
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
const file = path.resolve(ROOT, 'wayfinding-app/js/admin_charts.js');
if (!fs.existsSync(file)) { ok('admin_charts.js exists', false); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
const C = ctx.ADMIN_CHARTS;
const XSS = '<img src=x onerror=alert(1)>';
const EMOJI = /\p{Extended_Pictographic}/u;
const outputs = [];
const keep = (s) => { outputs.push(String(s)); return String(s); };

ok('ADMIN_CHARTS is defined', !!C);
ok('esc neutralises an HTML payload', keep(C.esc(XSS)) === '&lt;img src=x onerror=alert(1)&gt;' && C.esc('"\'&') === '&quot;&#39;&amp;');
ok('bars() escapes names', !keep(C.bars([{ name: XSS, count: 3 }])).includes('<img'));
ok('  prints each count and scales to the top one', /3<\/span>/.test(keep(C.bars([{ name: 'A', count: 3 }, { name: 'B', count: 1 }]))) &&
   /width:\s*33\.3%/.test(keep(C.bars([{ name: 'A', count: 3 }, { name: 'B', count: 1 }]))));
const m = Array.from({ length: 7 }, () => new Array(24).fill(0)); m[2][0] = 14; m[0][9] = 3;
const hm = keep(C.heatmap(m, { sideways: false }));
ok('heatmap prints counts in non-empty cells', />14</.test(hm) && />3</.test(hm));
ok('  and leaves empty cells blank', (hm.match(/hm-l0"[^>]*><\/div>/g) || []).length === 7 * 24 - 2, (hm.match(/hm-l0"[^>]*><\/div>/g) || []).length);
ok('  aria-label wording', hm.includes('aria-label="Wed 12 AM: 14 questions"'));
const cells = (s) => (s.match(/class="hm-cell[^"]*"/g) || []).length;
ok('a normal heatmap is 7 rows x 24 columns of cells', cells(hm) === 168 && /hm-grid-wide/.test(hm));
const side = keep(C.heatmap(m, { sideways: true }));
ok('the sideways heatmap is 24 rows x 7 columns', cells(side) === 168 && /hm-grid-tall/.test(side));
ok('office hours (8 AM to 5 PM) mark hours 8-16 only', (hm.match(/hm-office/g) || []).length === 7 * 9 + 9, (hm.match(/hm-office/g) || []).length);
const bins = []; for (let lo = 0; lo < 10000; lo += 500) bins.push({ lo, hi: lo + 500, count: lo === 500 ? 2 : 0 }); bins.push({ lo: 10000, hi: null, count: 1 });
const hg = keep(C.histogram(bins));
ok('histogram labels the first and last bins', hg.includes('0–0.5 s') && hg.includes('10 s+'));
ok('sampleTag(29) tags, sampleTag(30) does not', /Small sample/.test(keep(C.sampleTag(29))) && C.sampleTag(30) === '');
const ob = keep(C.outcomeBar({ arrived: 5, abandoned: 3, noEnding: 14 }));
ok('outcomeBar labels all three with counts', ob.includes('Arrived 5') && ob.includes('Closed early 3') && ob.includes('No ending recorded 14'));
ok('tile shows the sample tag below 30', /Small sample/.test(keep(C.tile({ label: 'L', value: 'V', sub: 'S', n: 12 }))) &&
   !/Small sample/.test(keep(C.tile({ label: 'L', value: 'V', n: 40 }))));
ok('tile escapes its text', !keep(C.tile({ label: XSS, value: XSS, sub: XSS })).includes('<img'));
ok('takeaway.busiest with data', keep(C.takeaway.busiest({ busiest: { weekday: 2, hour: 0, count: 14 } })) === 'The busiest slot is Wed 12 AM, with 14 questions.');
ok('  and without', keep(C.takeaway.busiest({ busiest: null })) === 'No questions in this range yet.');
ok('takeaway.speed', keep(C.takeaway.speed({ n: 40, median: 900, p95: 2800 })) === 'Half of answers arrived within 0.9 s; 95% within 2.8 s.');
ok('  and without', /No answer times/.test(keep(C.takeaway.speed({ n: 0 }))));
ok('takeaway.routes adds "Small sample" under 30', keep(C.takeaway.routes({ started: 30, arrived: 5, abandoned: 17 })) === '5 of 22 routes with an ending reached the office. Small sample.');
ok('  and without routes', /No routes/.test(keep(C.takeaway.routes({ started: 0, arrived: 0, abandoned: 0 }))));
ok('takeaway.offices escapes and names the top office', keep(C.takeaway.offices([{ name: XSS, count: 4 }])).includes('&lt;img') &&
   /\(4\)\.$/.test(C.takeaway.offices([{ name: 'X', count: 4 }])));
ok('  and without', /No offices/.test(keep(C.takeaway.offices([]))));
ok('takeaway.demand says how much was chip taps', keep(C.takeaway.demand({ typed: 77, chip: 121 })) === '121 of 198 questions were chip taps; 77 were typed.');
ok('emptyState suggests a wider range', /Try a wider range\./.test(keep(C.emptyState('Nothing here.'))));
ok('hourLabel', C.hourLabel(0) === '12 AM' && C.hourLabel(13) === '1 PM' && C.hourLabel(12) === '12 PM');
ok('fmtSec / fmtDur / ofText', C.fmtSec(900) === '0.9 s' && C.fmtDur(72000) === '1m 12s' && C.fmtDur(45000) === '45s' && C.fmtDur(0) === '—' && C.ofText(5, 22) === '5 of 22');
ok('officeName title-cases a department', C.officeName('CITY SOCIAL SERVICES OFFICE') === 'City Social Services Office');
ok('no emoji in any output', outputs.every((s) => !EMOJI.test(s)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
