/**
 * test_manila.js - lib/manila.js: every date, hour and weekday on the
 * dashboard is Asia/Manila time (UTC+8, no daylight saving). The old code used
 * UTC, so a question asked at 7 AM Manila was counted on the day before.
 *
 * Run: node tools/test_manila.js <repo-root>
 */
'use strict';
const path = require('path');
const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
let M;
try { M = require(path.resolve(ROOT, 'lib/manila.js')); } catch (e) { ok('lib/manila.js loads', false, e.message); }
if (M) {
  const t = (iso) => Date.parse(iso);
  let p = M.manilaParts(t('2026-10-05T15:59:59.999Z'));
  ok('15:59:59.999Z on 2026-10-05 is Manila 2026-10-05, 11 PM, Monday',
     p && p.date === '2026-10-05' && p.hour === 23 && p.weekday === 0, JSON.stringify(p));
  p = M.manilaParts(t('2026-10-05T16:00:00Z'));
  ok('16:00:00Z is Manila 2026-10-06, midnight, Tuesday', p && p.date === '2026-10-06' && p.hour === 0 && p.weekday === 1, JSON.stringify(p));
  ok('23:30Z on 2026-10-05 is Manila 2026-10-06', M.manilaDay(t('2026-10-05T23:30:00Z')) === '2026-10-06');
  ok('manilaStamp formats 2026-10-06 07:30', M.manilaStamp(t('2026-10-05T23:30:00Z')) === '2026-10-06 07:30');
  ok('manilaToday uses Manila', M.manilaToday(t('2026-11-08T17:00:00Z')) === '2026-11-09');
  ok('an invalid time gives null / ""', M.manilaParts('x') === null && M.manilaDay(NaN) === '' && M.manilaStamp(undefined) === '');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
