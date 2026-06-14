/**
 * service_locations.js — bridges RAG department/service names to physical
 * stamp placements (floor, row, col) so "Take me there" can route the user.
 *
 * Built from the 4 floor photo directories (note_*.pdf) + the 99 stamp
 * placements. The dept → stamp-NAME map is baked here; the actual cell
 * coordinates are resolved at runtime from STAMP_PLACEMENTS (so if a stamp is
 * moved/re-deployed, routing stays in sync automatically).
 *
 * Deploy like the other presets: bump SERVICE_LOCATIONS_VERSION and push.
 */

"use strict";

const SERVICE_LOCATIONS_VERSION = 1;

// ── Canonical RAG department  →  stamp placement name(s) ──────────────────
// Keys are the canonical department strings the RAG answers resolve to.
// Values are the stamp names as placed on the grid. Multiple = office has
// several windows/sections; the resolver picks the one nearest the user.
const DEPT_STAMP_NAMES = {
  "BUILDINGS REGULATORY SERVICES DEPARTMENT":                       ["2F 13 OOTBO"],
  "BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE":               ["GF 12a BPATFO", "GF 12b BPATFO"],
  "CITY ACCOUNTING AND INTERNAL CONTROL OFFICE":                    ["2F 01a CAICO", "2F 01b CAICO"],
  "CITY ADMINISTRATION OFFICE":                                     ["3F 29 Administration Office", "Office of City Admin"],
  "CITY AGRICULTURAL SERVICES DEPARTMENT":                          ["LG 17 CASD"],
  "CITY ASSESSMENT OFFICE":                                         ["GF 09a CAO", "GF 09b CAO"],
  "CITY BUDGET MANAGEMENT OFFICE":                                  ["2F 20 CBMO"],
  "CITY CIVIL REGISTRY OFFICE":                                     ["GF 02a CCRO", "GF 02b CCRO"],
  "CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT":     ["2F 14 CEIDD"],
  "CITY ENVIRONMENT AND NATURAL RESOURCES DEPARTMENT":             ["2F 10a CENRD"],
  "CITY HEALTH SERVICES DEPARTMENT":                                ["LG 04 CHSD"],
  "CITY HUMAN RESOURCE AND MANAGEMENT OFFICE":                      ["2F 03 CHRMO"],
  "CITY LEGAL SERVICES OFFICE":                                     ["2F 02 CLSO"],
  "CITY PLANNING AND DEVELOPMENT OFFICE":                           ["2F 19a CPDO", "2F 19b CPDO"],
  "CITY POPULATION MANAGEMENT OFFICE":                              ["CPMO"],
  "CITY SOCIAL SERVICES OFFICE":                                    ["LG 10a CSSD", "LG 10b CSSD"],
  "CITY TREASURY MANAGEMENT OFFICE":                                ["GF 05a CTMO", "GF 05b CTMO", "LG 08 CTMO"],
  "CITY VETERINARY SERVICES AND SLAUGHTERHOUSE MANAGEMENT OFFICE":  ["LG 16 CVASMD"],
  "COOPERATIVES AND LIVELIHOOD DEVELOPMENT DEPARTMENT":             ["LG 24 CALDD"],
  "CULTURAL AFFAIRS, TOURISM AND SPORTS DEVELOPMENT DEPARTMENT":    ["GF 01 CATSDD"],
  "HOUSING AND SETTLEMENTS DEPARTMENT":                             ["LG 01 HASD", "HSD Services"],
  "INFORMATION, INVESTMENT PROMOTIONS AND EMPLOYMENT SERVICES OFFICE": ["LG 09", "Local Recruitment"],
  // 🕒 TEMPORARY — pending colleague confirmation that Legislative Services Office
  //    == Sangguniang Panlungsod Secretariat.
  "LEGISLATIVE SERVICES OFFICE":                                    ["SP Secretariat"],
  "OFFICE OF THE MAYOR":                                            ["Office of City Mayor"],
  "OFFICE OF THE VICE MAYOR":                                       ["Vice Mayor"],
  "PERSONS WITH DISABILITY AFFAIRS OFFICE":                         ["PWD Office"],
};

// ── Service-specific overrides (subservice → stamp) ───────────────────────
// Empty: "Issuance of Mayor's Clearance" routes to IIPESO per user decision.
const SERVICE_OVERRIDES = {};

// ── Departments NOT inside City Hall ──────────────────────────────────────
const SEPARATE_CAMPUS = new Set([
  "CITY COLLEGE OF CALAMBA",
]);

// ── Departments in City Hall but not yet stamped → fall back to Info desk ─
// (CDRRMD-MO, OSCA, City General Services, Public Order & Safety — pending
//  the colleague's floor confirmation.)
const SERVICE_FALLBACK_STAMP = "MOPAC";   // Mayor's Office Public Assistance Center

// ── Default building entrance (used when the user has no PDR fix yet) ──────
// Ground Floor is now internal index 1 (Lower Ground = 0). Entrance is on Ground.
const SERVICE_DEFAULT_ENTRANCE = { floor: 1, row: 38, col: 70 };  // GF east entrance

// ── Normalised lookup (build once) ────────────────────────────────────────
function _svcNorm(s) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
const _DEPT_NORM = {};
for (const k in DEPT_STAMP_NAMES) _DEPT_NORM[_svcNorm(k)] = DEPT_STAMP_NAMES[k];
const _CAMPUS_NORM = new Set([...SEPARATE_CAMPUS].map(_svcNorm));

function _svcStampCells(stampName) {
  if (typeof STAMP_PLACEMENTS === "undefined") return [];
  return STAMP_PLACEMENTS
    .filter(p => p.name === stampName)
    .map(p => ({ floor: p.floor, row: p.row, col: p.col, name: p.name }));
}

// Common words that carry no disambiguating signal — excluded from fuzzy
// scoring so e.g. "OFFICE FOR THE SENIOR CITIZENS AFFAIRS" doesn't collide
// with "OFFICE OF THE MAYOR" on the shared word "OFFICE".
const _SVC_STOPWORDS = new Set([
  "OFFICE", "THE", "OF", "CITY", "AND", "FOR", "DEPARTMENT", "DIVISION",
  "SERVICES", "SERVICE", "MANAGEMENT", "DEVELOPMENT", "MO",
]);
function _svcDistinctive(s) {
  return new Set(s.split(" ").filter(w => w.length > 2 && !_SVC_STOPWORDS.has(w)));
}
function _svcTokenMatch(nd) {
  // Fallback fuzzy match on DISTINCTIVE tokens only. Requires >= 2 shared
  // distinctive tokens, so an unmapped dept falls back to the info desk
  // rather than being mis-routed to a superficially-similar office.
  const want = _svcDistinctive(nd);
  if (want.size === 0) return null;
  let best = null, bestScore = 0;
  for (const key in _DEPT_NORM) {
    const have = _svcDistinctive(key);
    let score = 0;
    want.forEach(w => { if (have.has(w)) score++; });
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return bestScore >= 2 ? _DEPT_NORM[best] : null;
}

/**
 * Resolve a RAG department (and optional subservice) to a routable cell.
 *
 * @param {string} deptName   - canonical department from the RAG answer
 * @param {string} [subservice] - the specific service (for overrides)
 * @param {{floor:number,row:number,col:number}} [fromCell] - user's position
 * @returns {null | {
 *     floor:number, row:number, col:number, stampName:string,
 *     label:string, fallback?:boolean, separateCampus?:boolean
 *   }}
 */
function resolveServiceLocation(deptName, subservice, fromCell) {
  const nd = _svcNorm(deptName);

  // 1. Separate campus → no route
  if (_CAMPUS_NORM.has(nd)) {
    return { separateCampus: true, label: deptName,
             floor: null, row: null, col: null, stampName: null };
  }

  // 2. Service-specific override
  let stampNames = null;
  if (subservice && SERVICE_OVERRIDES[subservice]) {
    stampNames = [SERVICE_OVERRIDES[subservice]];
  }

  // 3. Department → stamp names (exact then fuzzy)
  if (!stampNames) stampNames = _DEPT_NORM[nd] || _svcTokenMatch(nd);

  // 4. Gather candidate cells; fall back to the info desk if none
  let cells = [];
  if (stampNames) stampNames.forEach(sn => { cells = cells.concat(_svcStampCells(sn)); });
  let isFallback = false;
  if (!cells.length) {
    cells = _svcStampCells(SERVICE_FALLBACK_STAMP);
    isFallback = true;
    if (!cells.length) return null;   // not even the info desk is placed
  }

  // 5. Pick nearest to the user (decision #2): prefer same-floor candidates,
  //    then smallest Manhattan distance; else nearest floor.
  const from = fromCell || SERVICE_DEFAULT_ENTRANCE;
  const sameFloor = cells.filter(c => c.floor === from.floor);
  const pool = sameFloor.length ? sameFloor : cells;
  pool.sort((a, b) => {
    const fa = Math.abs(a.floor - from.floor), fb = Math.abs(b.floor - from.floor);
    if (fa !== fb) return fa - fb;
    const da = Math.abs(a.row - from.row) + Math.abs(a.col - from.col);
    const db = Math.abs(b.row - from.row) + Math.abs(b.col - from.col);
    return da - db;
  });
  const pick = pool[0];
  return {
    floor: pick.floor, row: pick.row, col: pick.col,
    stampName: pick.name, label: deptName, fallback: isFallback,
  };
}
