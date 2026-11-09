/**
 * lib/office_finder.js - recognise "where is [office]" questions.
 *
 * The assistant answers from the 305 service records, which hold no floors or
 * positions, so "where is BPLO?" used to come back as "I couldn't find that"
 * with a "Take me there" button to whatever the vector search guessed (BPLO
 * went to Housing; PESO and POSO went to the Treasury). These questions are
 * answered here instead, before any search or model call, and the client
 * describes the office from its live map.
 *
 * A question counts when it names an office and either asks where it is
 * (and is not asking for a service there), or is nothing but the office name.
 *
 * `dept` strings are copied exactly from the `department` values in
 * wayfinding-app/data/services.json (the live index), plus one entry for the
 * Public Assistance Center, so the client's resolveServiceLocation() routes
 * them without fuzzy matching.
 */
'use strict';

// abbr: shown to the citizen as "ABBR (Name)" when that is what they typed.
// aliases: everything else people call the office. The display name is always
// matched too.
const OFFICES = [
  { dept: 'BUILDINGS REGULATORY SERVICES DEPARTMENT', name: 'Buildings Regulatory Services Department',
    abbr: ['OBO', 'OOTBO', 'BRSD'],
    aliases: ['building official', 'building officials office', 'office of the building official',
              'buildings regulatory services', 'building regulatory services', 'building permit office',
              'building permits office'] },
  { dept: 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE', name: 'Business Permits and Tricycle Franchising Office',
    abbr: ['BPLO', 'BPATFO', 'BPLD'],
    aliases: ['business permit and licensing office', 'business permits and licensing office',
              'business permits office', 'business permit office', 'licensing office',
              'tricycle franchising office', 'franchising office'] },
  { dept: 'CITY ACCOUNTING AND INTERNAL CONTROL OFFICE', name: 'City Accounting and Internal Control Office',
    abbr: ['CAICO'],
    aliases: ['accounting office', 'city accounting', 'city accountant'] },
  { dept: 'CITY ADMINISTRATION OFFICE', name: 'City Administration Office',
    abbr: [],
    aliases: ['city administrator', 'city administrators office', 'administrators office',
              'administration office', 'city administration', 'admin office'] },
  { dept: 'CITY AGRICULTURAL SERVICES DEPARTMENT', name: 'City Agricultural Services Department',
    abbr: ['CASD'],
    aliases: ['city agriculture office', 'city agriculture', 'agriculture office', 'agricultural services',
              'city agriculturist', 'agriculturist'] },
  { dept: 'CITY ASSESSMENT OFFICE', name: 'City Assessment Office',
    abbr: [],
    aliases: ['assessor', 'assessors office', 'city assessor', 'city assessors office',
              'assessment office', 'city assessment'] },
  { dept: 'CITY BUDGET MANAGEMENT OFFICE', name: 'City Budget Management Office',
    abbr: ['CBMO'],
    aliases: ['budget office', 'city budget office', 'budget officer'] },
  { dept: 'CITY CIVIL REGISTRY OFFICE', name: 'City Civil Registry Office',
    abbr: ['CCRO', 'LCR', 'LCRO'],
    aliases: ['civil registry', 'civil registry office', 'civil registrar', 'local civil registrar',
              'city civil registry', 'city civil registrar'] },
  { dept: 'CITY COLLEGE OF CALAMBA', name: 'City College of Calamba',
    abbr: ['CCC'],
    aliases: ['city college'] },
  { dept: 'CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO',
    name: 'City Disaster Risk Reduction and Management Division',
    abbr: ['CDRRMO', 'CDRRMD', 'DRRMO'],
    aliases: ['disaster risk reduction', 'disaster office', 'drrm office'] },
  { dept: 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT',
    name: 'City Engineering and Infrastructure Development Department',
    abbr: ['CEIDD'],
    aliases: ['city engineer', 'city engineers office', 'engineers office', 'engineering office',
              'city engineering', 'engineering department'] },
  { dept: 'CITY ENVIRONMENT AND NATURAL RESOURCES DEPARTMENT',
    name: 'City Environment and Natural Resources Department',
    abbr: ['CENRO', 'CENRD'],
    aliases: ['environment office', 'city environment office'] },
  { dept: 'CITY GENERAL SERVICES OFFICE', name: 'City General Services Office',
    abbr: ['GSO', 'CGSO'],
    aliases: ['general services office'] },
  { dept: 'CITY HEALTH SERVICES DEPARTMENT', name: 'City Health Services Department',
    abbr: ['CHO'],
    aliases: ['city health', 'city health office', 'health office', 'health center',
              'city health services', 'city health department'] },
  { dept: 'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE', name: 'City Human Resource and Management Office',
    abbr: ['HR', 'HRMO', 'CHRMO'],
    aliases: ['hr office', 'human resource', 'human resources', 'human resource office', 'personnel office'] },
  { dept: 'CITY LEGAL SERVICES OFFICE', name: 'City Legal Services Office',
    abbr: ['CLSO'],
    aliases: ['legal office', 'city legal office', 'legal department'] },
  { dept: 'CITY PLANNING AND DEVELOPMENT OFFICE', name: 'City Planning and Development Office',
    abbr: ['CPDO'],
    aliases: ['planning office', 'city planning', 'planning and development', 'zoning office'] },
  { dept: 'CITY POPULATION MANAGEMENT OFFICE', name: 'City Population Management Office',
    abbr: ['CPMO'],
    aliases: ['population office', 'city population'] },
  { dept: 'CITY SOCIAL SERVICES OFFICE', name: 'City Social Services Office',
    abbr: ['CSSD', 'CSSO', 'CSWDO', 'CSWD', 'DSWD'],
    aliases: ['social services office', 'city social services', 'social welfare office',
              // 2026-11-09: "4P's" found nothing; the city's link to the national 4Ps is here
              '4ps', '4ps office', '4 ps', 'pantawid', 'pantawid pamilya', 'pantawid pamilyang pilipino program'] },
  { dept: 'CITY TREASURY MANAGEMENT OFFICE', name: 'City Treasury Management Office',
    abbr: ['CTMO', 'CTO'],
    aliases: ['treasury', 'city treasury', 'treasury office', 'treasurer', 'treasurers office',
              'city treasurer', 'city treasurers office'] },
  { dept: 'CITY VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE',
    name: 'City Veterinary Services and Slaughterhouse Management Office',
    abbr: ['CVO', 'CVASMD'],
    aliases: ['city vet', 'city veterinary', 'city veterinarian', 'veterinary office', 'vet office',
              'veterinarian'] },
  { dept: 'COOPERATIVES AND LIVELIHOOD DEVELOPMENT DEPARTMENT',
    name: 'Cooperatives and Livelihood Development Department',
    abbr: ['CALDD'],
    aliases: ['cooperatives office', 'cooperative office', 'livelihood office', 'cooperatives and livelihood',
              ] },
  { dept: 'CULTURAL AFFAIRS, TOURISM AND SPORTS DEVELOPMENT DEPARTMENT',
    name: 'Cultural Affairs, Tourism and Sports Development Department',
    abbr: ['CATSDD'],
    aliases: ['tourism office', 'city tourism office', 'sports office', 'cultural affairs office'] },
  { dept: 'HOUSING AND SETTLEMENTS DEPARTMENT', name: 'Housing and Settlements Department',
    abbr: ['HASD', 'HSD'],
    aliases: ['housing office', 'city housing', 'housing and settlements', 'housing department'] },
  { dept: 'INFORMATION, INVESTMENT PROMOTIONS AND EMPLOYMENT SERVICES OFFICE',
    name: 'Information, Investment Promotions and Employment Services Office',
    abbr: ['PESO', 'IIPESO'],
    aliases: ['public employment service office', 'public employment services office', 'employment office',
              'employment services office', 'local recruitment', 'jobs office',
              // 2026-11-09: a question about TUPAD found nothing; TUPAD sign-ups run through PESO
              'tupad'] },
  { dept: 'LEGISLATIVE SERVICES OFFICE', name: 'Legislative Services Office',
    abbr: ['SP'],
    aliases: ['sangguniang panlungsod', 'sp secretariat', 'sp office', 'city council', 'legislative services',
              'legislative office'] },
  { dept: 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS', name: 'Office for the Senior Citizens Affairs',
    abbr: ['OSCA'],
    aliases: ['senior citizens office', 'senior citizen office', 'senior citizens affairs office'] },
  { dept: 'OFFICE OF THE MAYOR', name: 'Office of the Mayor',
    abbr: [],
    aliases: ['mayors office', 'office of the city mayor', 'city mayor', 'mayor'] },
  { dept: 'OFFICE OF THE VICE MAYOR', name: 'Office of the Vice Mayor',
    abbr: [],
    aliases: ['vice mayor', 'vice mayors office', 'city vice mayor', 'office of the city vice mayor'] },
  { dept: 'PERSONS WITH DISABILITY AFFAIRS OFFICE', name: 'Persons with Disability Affairs Office',
    abbr: ['PDAO'],
    aliases: ['pwd office', 'pwd affairs', 'pwd affairs office', 'persons with disability office'] },
  { dept: 'PUBLIC ORDER AND SAFETY OFFICE', name: 'Public Order and Safety Office',
    abbr: ['POSO'],
    aliases: ['public order and safety', 'public safety office', 'public order office'] },
  { dept: "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER", name: 'Public Assistance Center',
    abbr: ['MOPAC'],
    aliases: ['public assistance', 'public assistance desk', 'information desk', 'info desk',
              'information counter', 'help desk', 'helpdesk', 'mayors office public assistance center'] },
  // Not a Charter department either: COMELEC's office in the building (LG 19,
  // stamped "LG 19 COA"; the door reads "Commission on Elections",
  // SERVICE_AREA_MAPPING_REVIEW.md). On 2026-11-09 a question for COMELEC found
  // nothing, and one about a voter's ID went to the Senior Citizens office.
  { dept: 'COMMISSION ON ELECTIONS', name: 'Commission on Elections',
    abbr: ['COMELEC'],
    aliases: ['comelec office', 'election office', 'elections office', 'voters id', 'voter id',
              'voters registration', 'voter registration', 'voters certification', 'voter certification'] },
];

// Abbreviations that several offices answer to. These ask which one is meant
// rather than guess.
const CLASH = {
  cao:  ['CITY ASSESSMENT OFFICE', 'CITY ADMINISTRATION OFFICE', 'CITY AGRICULTURAL SERVICES DEPARTMENT'],
  chsd: ['CITY HEALTH SERVICES DEPARTMENT', 'HOUSING AND SETTLEMENTS DEPARTMENT'],
};

// Words that ask where something is.
const CUES = ['where', 'wheres', 'located', 'location', 'floor', 'saan', 'saang', 'nasaan', 'nasaang',
              'nasan', 'asan', 'san', 'papunta', 'pumunta', 'punta', 'direction', 'directions',
              'how do i get to', 'how to get to', 'how can i get to', 'go to', 'take me to',
              'dalhin mo ako'];

// Topic words (budget, tourism, senior citizens...) are deliberately NOT aliases:
// "where is the budget hearing" is not asking for the Budget Office.
//
// Words that ask for a service. A question naming an office AND asking for a
// service there is a service question: the assistant's answer carries the
// requirements, and its "Go to:" line still routes them.
const SERVICE_WORDS = ['requirement', 'requirements', 'require', 'required', 'kailangan', 'magkano',
                       'how much', 'fee', 'fees', 'bayad', 'magbayad', 'pay', 'payment', 'apply',
                       'application', 'renew', 'renewal', 'kumuha', 'kukuha', 'makakuha', 'kuha', 'kunin',
                       'get', 'avail', 'claim', 'submit', 'file', 'secure', 'request', 'process',
                       'processing', 'magpa', 'ipasa', 'magpasa', 'notaryo', 'notarize'];

// Words that can sit around a bare office name without changing what it asks.
const FILLER = new Set(['po', 'the', 'ang', 'sa', 'office', 'opisina', 'ba', 'please', 'pls', 'yung',
                        'ung', 'si', 'ng']);

/** Lowercase, drop apostrophes, turn other punctuation into spaces. */
function normalise(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

const _has = (q, phrase) => (' ' + q + ' ').includes(' ' + phrase + ' ');

// alias -> { depts: [..], abbr: bool }, built once.
const BY_DEPT = new Map(OFFICES.map((o) => [o.dept, o]));
const INDEX = (() => {
  const idx = new Map();
  const add = (alias, dept, isAbbr) => {
    const key = normalise(alias);
    if (!key) return;
    const cur = idx.get(key) || { depts: new Set(), abbr: false };
    cur.depts.add(dept);
    cur.abbr = cur.abbr || isAbbr;
    idx.set(key, cur);
  };
  for (const o of OFFICES) {
    add(o.name, o.dept, false);
    o.abbr.forEach((a) => add(a, o.dept, true));
    o.aliases.forEach((a) => add(a, o.dept, false));
  }
  for (const [alias, depts] of Object.entries(CLASH)) depts.forEach((d) => add(alias, d, true));
  // Longest first, so a longer name claims its words before a shorter one can.
  return [...idx.entries()].sort((a, b) => b[0].length - a[0].length);
})();

/**
 * The office named in a normalised question: the earliest match that is not
 * part of a longer one. Returns { alias, start, end, depts, abbr } or null.
 */
function _bestMatch(q) {
  const hay = ' ' + q + ' ';
  const hits = [];
  for (const [alias, info] of INDEX) {
    const needle = ' ' + alias + ' ';
    let from = 0, at;
    while ((at = hay.indexOf(needle, from)) !== -1) {
      const start = at, end = at + needle.length - 1;
      const inside = hits.some((h) => h.start <= start && end <= h.end);
      if (!inside) hits.push({ alias, start, end, depts: [...info.depts], abbr: info.abbr });
      from = at + 1;
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.start - b.start || b.alias.length - a.alias.length);
  return hits[0];
}

/**
 * Is this a "where is [office]" question?
 *
 * @returns {null
 *   | { kind: 'location', office: { dept, name, abbr: string|null }, clash: null }
 *   | { kind: 'location', office: null, clash: { alias: string, offices: { dept, name }[] } }}
 */
function findOfficeQuestion(query) {
  const q = normalise(query);
  if (!q) return null;
  const m = _bestMatch(q);
  if (!m) return null;

  const hay = ' ' + q + ' ';
  const rest = (hay.slice(0, m.start) + ' ' + hay.slice(m.end)).split(' ').filter(Boolean);
  const bare = rest.every((w) => FILLER.has(w));
  if (!bare) {
    if (!CUES.some((c) => _has(q, c))) return null;
    const asked = q.replace(/\bget to\b/g, ' ');   // "how do I get to" is a cue, not a request
    if (SERVICE_WORDS.some((w) => _has(asked, w))) return null;
  }

  if (m.depts.length > 1) {
    return {
      kind: 'location', office: null,
      clash: { alias: m.alias.toUpperCase(),
               offices: m.depts.map((d) => ({ dept: d, name: BY_DEPT.get(d).name })) },
    };
  }
  const o = BY_DEPT.get(m.depts[0]);
  return {
    kind: 'location',
    office: { dept: o.dept, name: o.name, abbr: m.abbr ? m.alias.toUpperCase() : null },
    clash: null,
  };
}

module.exports = { OFFICES, CLASH, normalise, findOfficeQuestion };
