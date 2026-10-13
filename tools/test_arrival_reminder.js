/**
 * test_arrival_reminder.js - the arrival-reminder parser, run against both
 * synthetic shapes and REAL answers from the live /api/chat.
 *
 * The parser pulls requirement lines out of a RAG answer and drops the
 * "Go to:" routing directive, which is for the app rather than the citizen.
 *
 * Run: node tools/test_arrival_reminder.js <repo-root>
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

// Lift the function straight out of the shipped source, so this tests what runs.
const src = fs.readFileSync(path.resolve(ROOT, 'wayfinding-app/js/app.js'), 'utf8');
function lift(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`cannot find ${name}`);
  let j = src.indexOf('{', i), depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}
const sb = {};
vm.createContext(sb);
vm.runInContext(lift('_buildArrivalReminder') + '\n;this.f = _buildArrivalReminder;', sb);
const build = sb.f;

(async () => {
  console.log('\n--- synthetic shapes ---');

  let r = build('1. Income Tax Return (secure at: BIR)\nGo to: CITY TREASURY MANAGEMENT OFFICE',
                'CITY TREASURY MANAGEMENT OFFICE', 'Cedula');
  ok('extracts a numbered requirement', r.items.length === 1, JSON.stringify(r.items));
  ok('drops the Go to: routing line', !r.items.some((i) => /go to/i.test(i)));
  ok('keeps the parenthetical intact', r.items[0] === 'Income Tax Return (secure at: BIR)', r.items[0]);
  ok('carries dept and service', r.dept && r.service === 'Cedula');

  r = build('1. A\n2) B\n- C\n• D\nGo to: X');
  ok('accepts 1. 1) - and bullet markers', r.items.length === 4, JSON.stringify(r.items));

  r = build('Go to: SOMEWHERE');
  ok('an answer with only a routing line yields no items', r.items.length === 0);

  r = build('');
  ok('empty answer is safe', r.items.length === 0);
  r = build(null);
  ok('null answer is safe', r.items.length === 0);
  r = build(undefined);
  ok('undefined answer is safe', r.items.length === 0);

  r = build('Just a sentence with no list at all.\nGo to: X');
  ok('prose without a list yields no items', r.items.length === 0, JSON.stringify(r.items));

  r = build(Array.from({ length: 20 }, (_, i) => `${i + 1}. item ${i}`).join('\n'));
  ok('caps the list at 8 so the prompt cannot overflow', r.items.length === 8, r.items.length);

  r = build('1.   spaced   out   \nGo to: X');
  ok('trims whitespace', r.items[0] === 'spaced   out', JSON.stringify(r.items[0]));

  r = build('1. **Application for New Business Permit** (On-site or Online)\nGo to: X');
  ok('strips markdown bold so asterisks never reach the UI',
     r.items[0] === 'Application for New Business Permit (On-site or Online)',
     JSON.stringify(r.items[0]));

  r = build('1. __underscored__ thing\n2. an *italic* word\nGo to: X');
  ok('strips underscore-bold and single-asterisk italics',
     r.items[0] === 'underscored thing' && r.items[1] === 'an italic word',
     JSON.stringify(r.items));

  r = build('1. keep a*b and c_d intact\nGo to: X');
  ok('leaves mid-word asterisks and underscores alone',
     r.items[0] === 'keep a*b and c_d intact', JSON.stringify(r.items[0]));

  r = build('1. GO TO THE CASHIER FIRST\nGo to: X');
  ok('a requirement that merely starts with "go to" is kept',
     r.items.length === 1 && /CASHIER/.test(r.items[0]), JSON.stringify(r.items));

  // ── real answers ─────────────────────────────────────────────────────────
  console.log('\n--- real answers from the live /api/chat ---');
  const QUERIES = [
    'How do I get a cedula?',
    'How do I apply for a business permit?',
    'Paano kumuha ng birth certificate?',
  ];
  for (const q of QUERIES) {
    let d;
    try {
      const res = await fetch('https://penaranda-dissertation.vercel.app/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Health-Check': '1' },
        body: JSON.stringify({ query: q, history: [] }),
      });
      d = await res.json();
    } catch (err) {
      console.log(`  SKIP  "${q}" - ${err.message}`);
      continue;
    }
    const rr = build(d.answer, d.department, d.subservice);
    const clean = !rr.items.some((i) => /^go to\s*:/i.test(i));
    ok(`"${q}" -> ${rr.items.length} item(s), no routing line`, clean,
       JSON.stringify(rr.items).slice(0, 150));
    if (rr.items.length) console.log('          e.g. ' + rr.items[0].slice(0, 90));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
