/**
 * test_office_finder.js - lib/office_finder.js: spotting "where is [office]"
 * questions and resolving the names people actually use for each office.
 *
 * The six live questions at the top are the ones that went wrong on
 * 2026-11-09: three were routed to the wrong office and all six were told the
 * office could not be found.
 *
 * Run: node tools/test_office_finder.js <repo-root>
 */
'use strict';
const path = require('path');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const F = require(path.resolve(ROOT, 'lib/office_finder.js'));
const services = require(path.resolve(ROOT, 'wayfinding-app/data/services.json'));

const BPLO   = 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE';
const PESO   = 'INFORMATION, INVESTMENT PROMOTIONS AND EMPLOYMENT SERVICES OFFICE';
const POSO   = 'PUBLIC ORDER AND SAFETY OFFICE';
const CCRO   = 'CITY CIVIL REGISTRY OFFICE';
const CTMO   = 'CITY TREASURY MANAGEMENT OFFICE';
const HEALTH = 'CITY HEALTH SERVICES DEPARTMENT';
const PAC    = "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER";

const dept = (q) => { const r = F.findOfficeQuestion(q); return r && r.office ? r.office.dept : null; };
const abbr = (q) => { const r = F.findOfficeQuestion(q); return r && r.office ? r.office.abbr : undefined; };

console.log('\n--- the six questions that failed live ---');
ok('where is BPLO? -> BPATFO', dept('where is BPLO?') === BPLO, dept('where is BPLO?'));
ok('  and remembers the abbreviation typed', abbr('where is BPLO?') === 'BPLO', abbr('where is BPLO?'));
ok('nasaan ang PESO? -> IIPESO', dept('nasaan ang PESO?') === PESO, dept('nasaan ang PESO?'));
ok('where is POSO? -> POSO', dept('where is POSO?') === POSO, dept('where is POSO?'));
ok('where is the City Civil Registry Office? -> CCRO',
   dept('where is the City Civil Registry Office?') === CCRO);
ok('  a full name carries no abbreviation', abbr('where is the City Civil Registry Office?') === null);
ok('saan ang City Treasury? -> CTMO', dept('saan ang City Treasury?') === CTMO);
ok('where is the city health office -> CHSD', dept('where is the city health office') === HEALTH);
ok('the reply is marked as a location question',
   (F.findOfficeQuestion('where is BPLO?') || {}).kind === 'location');

console.log('\n--- Filipino and Taglish ---');
ok('nasan po yung assessor -> City Assessment Office',
   dept('nasan po yung assessor') === 'CITY ASSESSMENT OFFICE', dept('nasan po yung assessor'));
ok('asan ang building official -> Buildings Regulatory Services',
   dept('asan ang building official') === 'BUILDINGS REGULATORY SERVICES DEPARTMENT',
   dept('asan ang building official'));
ok('san ang cswdo -> City Social Services', dept('san ang cswdo') === 'CITY SOCIAL SERVICES OFFICE',
   dept('san ang cswdo'));
ok("anong floor ng mayor's office -> Office of the Mayor",
   dept("anong floor ng mayor's office") === 'OFFICE OF THE MAYOR', dept("anong floor ng mayor's office"));

console.log('\n--- a bare office name is a location question ---');
ok('BPLO', dept('BPLO') === BPLO);
ok('bplo po', dept('bplo po') === BPLO);
ok('Treasury office?', dept('Treasury office?') === CTMO);
ok('"how do I get to the BPLO" is still a location question (get to is a cue)',
   dept('how do I get to the BPLO') === BPLO, dept('how do I get to the BPLO'));
ok('"where is the budget office" still finds the office', dept('where is the budget office') ===
   'CITY BUDGET MANAGEMENT OFFICE', dept('where is the budget office'));

console.log('\n--- service questions stay with the assistant ---');
for (const q of ['where do I get a health certificate',
                 'saan kukuha ng cedula sa treasury',
                 'requirements for business permit BPLO',
                 'San Pedro',
                 'how much is the fee at the assessor',
                 'business permit renewal',
                 'where can I pay real property tax',
                 // topic words are not office names
                 'where is the budget hearing',
                 'where can senior citizens get their ID',
                 'saan ang tourism spots sa calamba',
                 'where can I avail of social services',
                 'saan magpa notaryo sa legal office',
                 'where do I submit documents to the treasury']) {
  ok(`not caught: "${q}"`, F.findOfficeQuestion(q) === null, JSON.stringify(F.findOfficeQuestion(q)));
}

console.log('\n--- abbreviations shared by several offices ---');
const cao = F.findOfficeQuestion('where is CAO');
ok('where is CAO -> a clash, not a guess', cao && cao.office === null && cao.clash, JSON.stringify(cao));
ok('  naming the abbreviation', cao && cao.clash && cao.clash.alias === 'CAO');
ok('  with Assessment, Administration and Agriculture',
   cao && cao.clash && cao.clash.offices.map((o) => o.dept).sort().join('|') ===
   ['CITY ADMINISTRATION OFFICE', 'CITY AGRICULTURAL SERVICES DEPARTMENT', 'CITY ASSESSMENT OFFICE'].join('|'));
const chsd = F.findOfficeQuestion('nasaan ang chsd');
ok('nasaan ang chsd -> Health or Housing',
   chsd && chsd.clash && chsd.clash.offices.map((o) => o.dept).sort().join('|') ===
   [HEALTH, 'HOUSING AND SETTLEMENTS DEPARTMENT'].join('|'), JSON.stringify(chsd));
ok('each clash choice has a display name',
   cao && cao.clash.offices.every((o) => typeof o.name === 'string' && o.name.length > 3));

console.log('\n--- overlapping names ---');
ok('where is the vice mayor -> Vice Mayor, not Mayor',
   dept('where is the vice mayor') === 'OFFICE OF THE VICE MAYOR', dept('where is the vice mayor'));
ok('where is the mayor -> Mayor', dept('where is the mayor') === 'OFFICE OF THE MAYOR');
ok('saan ang sp -> Legislative Services (whole word only)',
   dept('saan ang sp') === 'LEGISLATIVE SERVICES OFFICE', dept('saan ang sp'));
ok('"spa" does not match "sp"', F.findOfficeQuestion('where is the spa') === null);

console.log('\n--- the Public Assistance Center ---');
ok('where is the information desk -> Public Assistance Center',
   dept('where is the information desk') === PAC, dept('where is the information desk'));
ok('saan ang MOPAC -> Public Assistance Center', dept('saan ang MOPAC') === PAC);

console.log('\n--- the table itself ---');
ok('normalise drops apostrophes and punctuation',
   F.normalise("  Where's the Mayor's  Office?! ") === 'wheres the mayors office');
const canon = [...new Set(services.map((s) => s.department).filter(Boolean))];
const listed = new Set(F.OFFICES.map((o) => o.dept));
const missing = canon.filter((d) => !listed.has(d));
ok(`every one of the ${canon.length} departments in services.json has an entry`,
   missing.length === 0, missing.join('; '));
ok('plus the Public Assistance Center', listed.has(PAC));
ok('32 entries in all', F.OFFICES.length === 32, F.OFFICES.length);
const unfindable = F.OFFICES.filter((o) => dept('where is the ' + o.name) !== o.dept)
                            .map((o) => `${o.name} -> ${dept('where is the ' + o.name)}`);
ok('every display name finds its own office', unfindable.length === 0, unfindable.join('; '));
ok('every clash alias names real entries',
   Object.values(F.CLASH).every((ds) => ds.every((d) => listed.has(d))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
