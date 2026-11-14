/**
 * test_service_match.js - the chat never sends a citizen to the wrong office
 * when the service they asked for is in the Charter (Jace, 2026-11-11: "the
 * app should be able to answer all questions regarding with services and will
 * not lead it elsewhere if the service is present").
 *
 *   - A typed question that IS a service's name is answered from the Charter
 *     record, like a chip: no search, no model, no chance to drift.
 *   - A name filed at two offices (Competency Assessment) asks which office.
 *   - A service offered by more than one office (Educational Assistance at the
 *     Mayor's and the Vice Mayor's) says so and offers the other one.
 *
 * Run: node tools/test_service_match.js <repo-root>
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(process.argv[2] || '.');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const L = require(path.join(ROOT, 'lib/service_lookup.js'));

console.log('\n--- a typed service name ---');
{
  ok('servicesNamed is exported', typeof L.servicesNamed === 'function');
  if (typeof L.servicesNamed === 'function') {
    const a = L.servicesNamed('senior citizens id');
    ok('  "senior citizens id" finds the one OSCA record', a.length === 1 && a[0].department === 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS', JSON.stringify(a.map((x) => x.department)));
    ok('  ignores a trailing "?" and spacing', L.servicesNamed('  Senior   Citizens ID? ').length === 1);
    const c = L.servicesNamed('Competency Assessment');
    ok('  a name at two offices returns both', c.length === 2 && new Set(c.map((x) => x.department)).size === 2);
    const v = L.servicesNamed('Competency Assessment — CITY ASSESSMENT OFFICE');
    ok('  "name — OFFICE" (a choice chip) picks that office', v.length === 1 && v[0].department === 'CITY ASSESSMENT OFFICE', JSON.stringify(v.map((x) => x.department)));
    ok('  "name — an office that does not have it" finds nothing', L.servicesNamed('Senior Citizens ID — OFFICE OF THE MAYOR').length === 0);
    ok('  a question is not a name', L.servicesNamed('how do I get a senior citizens id').length === 0);
    ok('  the same name filed twice at one office counts once',
       L.servicesNamed('Request for Certificate (Cancellation / Verification / Late Birth Registration / No Record)').length === 1);
  }
}

console.log('\n--- the same help at another office ---');
{
  ok('alsoOfferedAt is exported', typeof L.alsoOfferedAt === 'function');
  if (typeof L.alsoOfferedAt === 'function') {
    const hits = [
      { subservice: 'Educational Assistance', department: 'OFFICE OF THE MAYOR' },
      { subservice: 'Educational Assistance (Pagbibigay Tulong Pang-Edukasyon)', department: 'OFFICE OF THE VICE MAYOR' },
      { subservice: 'Scholarship Program', department: 'CITY SOCIAL SERVICES OFFICE' },
    ];
    const t = L.alsoOfferedAt('Educational Assistance', 'OFFICE OF THE MAYOR', hits);
    ok('  finds the Vice Mayor\'s Educational Assistance', t.length === 1 && t[0].department === 'OFFICE OF THE VICE MAYOR', JSON.stringify(t));
    ok('  not an unrelated service at another office', !t.some((x) => /Scholarship/.test(x.subservice)));
    ok('  not a service at the same office', L.alsoOfferedAt('Educational Assistance', 'OFFICE OF THE MAYOR',
       [{ subservice: 'Educational Assistance (x)', department: 'OFFICE OF THE MAYOR' }]).length === 0);
    ok('  Burial Assistance and Medical / Hospitalization / Burial Assistance',
       L.alsoOfferedAt('Burial Assistance', 'OFFICE OF THE MAYOR',
         [{ subservice: 'Medical / Hospitalization / Burial Assistance', department: 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS' }]).length === 1);
    ok('  "Certificate of X" alone does not make two services the same',
       L.alsoOfferedAt('Certificate of Indigence', 'CITY SOCIAL SERVICES OFFICE',
         [{ subservice: 'Certificate of Good Moral Character', department: 'CITY COLLEGE OF CALAMBA' }]).length === 0);
  }
}

console.log('\n--- the chat handler ---');
{
  const src = require('fs').readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  ok('a typed name is answered from the Charter before the search', /servicesNamed\(query\)[\s\S]{0,5000}upstashQuery\(query\)/.test(src));
  ok('  two offices with that name: asks which, with both as choices', /named\.length > 1[\s\S]{0,600}needsContext: true/.test(src));
  ok('a resolved answer mentions the other office that offers it', /alsoOfferedAt\(/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
