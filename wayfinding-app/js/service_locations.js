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

const SERVICE_LOCATIONS_VERSION = 4;   // + COMELEC (LG 19); unmapped offices reported, not re-pointed; BUILDING_EXITS

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
  // Not a Charter department: the office finder answers "where is the
  // information desk?" with it, and sends offices not on the map here.
  "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER":                        ["MOPAC"],
  // Not a Charter department: COMELEC's office (door reads "Commission on
  // Elections"; stamped LG 19 COA). Answers where-is questions for COMELEC and voter's IDs.
  "COMMISSION ON ELECTIONS":                                        ["LG 19 COA"],
};

// ── Service-specific overrides (subservice → stamp) ───────────────────────
// Empty: "Issuance of Mayor's Clearance" routes to IIPESO per user decision.
const SERVICE_OVERRIDES = {};

// ── Departments NOT inside City Hall ──────────────────────────────────────
const SEPARATE_CAMPUS = new Set([
  "CITY COLLEGE OF CALAMBA",
]);

// ── Departments with no stamp (CDRRMD-MO, OSCA, City General Services, POSO) ─
// They may be outside the building; nobody has confirmed. Until 2026-11-09 they
// were silently routed to the Public Assistance Center (37 of 173 trips that
// day). Now they are reported as "not on this map", with the help desk and the
// nearest exit offered as choices (resolveServiceLocation → {unmapped: true}).

// ── The four Ground Floor doors (cell to stand on, just inside) ───────────
// From the plan's geometry, not yet confirmed on site as public doors.
const BUILDING_EXITS = [
  { floor: 1, row: 73, col: 37, name: "Main entrance" },
  { floor: 1, row: 36, col: 4,  name: "West side door" },
  { floor: 1, row: 4,  col: 38, name: "North side door" },
  { floor: 1, row: 38, col: 71, name: "East side door" },
];

/** The exit with the smallest dist(from, exit). dist defaults to grid steps. */
function nearestExit(from, exits, dist) {
  const d = dist || ((a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col));
  let best = null, bestD = Infinity;
  for (const e of exits || []) {
    const v = d(from, e);
    if (v < bestD) { best = e; bestD = v; }
  }
  return best;
}

// ── Default building entrance (used when the user has no PDR fix yet) ──────
// Ground Floor is now internal index 1 (Lower Ground = 0). Entrance is on Ground.
const SERVICE_DEFAULT_ENTRANCE = { floor: 1, row: 73, col: 37 };  // Ground floor, just inside the main public door (the four-cell-wide south opening at 74,36-39). Walkable; matches the posted entrance QR (?qr=1:73,37). 38,71 - the old value - is the east SIDE door.

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
    .map(p => ({ floor: p.floor, row: p.row, col: p.col, name: p.name, size: p.size || 1 }));
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

  // 4. Gather candidate cells. None: say so; the caller offers the help desk
  //    and the nearest exit instead of routing somewhere else silently.
  let cells = [];
  if (stampNames) stampNames.forEach(sn => { cells = cells.concat(_svcStampCells(sn)); });
  if (!cells.length) {
    return { unmapped: true, label: deptName, floor: null, row: null, col: null, stampName: null };
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
    stampName: pick.name, label: deptName,
  };
}

/** 'mapped' (routable), 'outside' (own campus) or 'unmapped' (no stamp yet). */
function serviceLocationStatus(deptName) {
  const nd = _svcNorm(deptName);
  if (_CAMPUS_NORM.has(nd)) return "outside";
  const names = _DEPT_NORM[nd] || _svcTokenMatch(nd);
  const has = names && names.some(sn => _svcStampCells(sn).length);
  return has ? "mapped" : "unmapped";
}

// ── "Where is [office]?" sentence ──────────────────────────────────────────
// The server's office finder (lib/office_finder.js) names the office; this
// says where it is, from the stamps this device holds now — the editor can
// republish the map, so the server cannot know.
//
// Directions are as seen facing in from the main entrance (73,37, on the
// Ground Floor's bottom edge): low columns are on the left, low rows are
// toward the back.

const OFFICE_HELP_DEPT  = "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER";
const OFFICE_HELP_LABEL = "Public Assistance Center";

function _officeFloorName(f) {
  const names = (typeof FLOOR_NAMES !== "undefined") ? FLOOR_NAMES : {};
  return names[f] || names[String(f)] || floorName(f);
}

/** "the Lower Ground Floor (one floor below the main entrance)" */
function _officeFloorPhrase(f, fil) {
  const name = _officeFloorName(f);
  const d = f - SERVICE_DEFAULT_ENTRANCE.floor;
  if (d === 0) return fil ? name : `the ${name}`;
  const n = Math.abs(d);
  const count = fil ? (n === 1 ? "isang" : n === 2 ? "dalawang" : `${n} na`)
                    : (n === 1 ? "one" : n === 2 ? "two" : String(n));
  const rel = fil
    ? `${count} palapag ${d < 0 ? "pababa" : "pataas"} mula sa main entrance`
    : `${count} floor${n === 1 ? "" : "s"} ${d < 0 ? "below" : "up from"} the main entrance`;
  return fil ? `${name} (${rel})` : `the ${name} (${rel})`;
}

/** Where on its floor a stamp sits, by thirds of the 75 x 75 grid. */
function _officePosition(cell, fil) {
  const half = Math.floor(((cell.size || 1) - 1) / 2);
  const r = cell.row + half, c = cell.col + half;
  const side  = c < 25 ? 0 : c < 50 ? 1 : 2;    // left / middle / right
  const depth = r < 25 ? 0 : r < 50 ? 1 : 2;    // back / middle / front
  if (fil) {
    const S = ["kaliwa", "gitna", "kanan"][side], D = ["likod", "gitna", "harap"][depth];
    const where = (side === 1 && depth === 1) ? "sa gitna"
                : side === 1 ? `sa gitna, bandang ${D}`
                : depth === 1 ? `sa ${S}, bandang gitna`
                : `sa ${S}, bandang ${D}`;
    return `${where}, pagpasok mo sa main entrance`;
  }
  const S = ["left", "middle", "right"][side], D = ["back", "middle", "front"][depth];
  const where = (side === 1 && depth === 1) ? "in the middle of the floor"
              : side === 1 ? `in the middle, toward the ${D}`
              : depth === 1 ? `on the ${S} side, about halfway in`
              : `on the ${S} side, toward the ${D}`;
  return `${where}, as you face in from the main entrance`;
}

/** Every placed cell for an office, nearest the main entrance first. */
function _officeCells(dept) {
  const nd = _svcNorm(dept);
  const names = _DEPT_NORM[nd] || _svcTokenMatch(nd) || [];
  let cells = [];
  names.forEach(sn => { cells = cells.concat(_svcStampCells(sn)); });
  const e = SERVICE_DEFAULT_ENTRANCE;
  return cells.sort((a, b) =>
    (Math.abs(a.floor - e.floor) - Math.abs(b.floor - e.floor)) ||
    (Math.abs(a.row - e.row) + Math.abs(a.col - e.col)) - (Math.abs(b.row - e.row) + Math.abs(b.col - e.col)));
}

/**
 * Describe where an office is, for the chat.
 *
 * @param {{dept:string, name:string, abbr:(string|null)}} office  from the server's office finder
 * @param {'en'|'fil'} lang
 * @returns {{ text:string, navDept:(string|null), navLabel:(string|null) }}
 *   navDept is what "Take me there" routes to; null means no button.
 */
function describeOfficeLocation(office, lang) {
  const fil = lang === "fil";
  const who = office.abbr ? `${office.abbr} (${office.name})` : office.name;

  // Not in the building, or not on the map: say so, and let the chat offer the
  // help desk and the nearest exit (`place`), never a route to the office.
  if (_CAMPUS_NORM.has(_svcNorm(office.dept))) {
    return {
      text: fil ? `May sariling campus ang ${who}. Wala ito sa loob ng City Hall.`
                : `${office.abbr ? who : "The " + who} has its own campus. It isn't inside City Hall.`,
      navDept: null, navLabel: null, place: "outside",
    };
  }

  const cells = _officeCells(office.dept);
  if (!cells.length) {
    return {
      text: fil
        ? `Wala sa mapang ito ang ${who}; maaaring nasa labas ito ng City Hall. Makakatulong ang ${OFFICE_HELP_LABEL}, o dumaan sa pinakamalapit na exit.`
        : `${who} isn't on this map; it may be outside City Hall. The ${OFFICE_HELP_LABEL} can direct you, or take the nearest exit.`,
      navDept: null, navLabel: null, place: "unmapped",
    };
  }

  const near = cells[0];
  const floors = [...new Set(cells.map(c => c.floor))];
  const n = cells.length;
  let text;
  if (fil) {
    const subj = `Ang ${who}`;
    if (floors.length === 1) {
      text = `${subj} ay nasa ${_officeFloorPhrase(near.floor, true)}, ${_officePosition(near, true)}.`;
      if (n > 1) text += ` May ${n} window ito; dadalhin kita sa pinakamalapit.`;
    } else {
      text = `${subj} ay may ${n} window, sa ${floors.map(f => _officeFloorName(f)).join(" at sa ")}. ` +
             `Ang pinakamalapit sa main entrance ay nasa ${_officeFloorPhrase(near.floor, true)}, ` +
             `${_officePosition(near, true)}. Dadalhin kita sa pinakamalapit.`;
    }
  } else {
    const subj = office.abbr ? who : `The ${who}`;
    if (floors.length === 1) {
      text = `${subj} is on ${_officeFloorPhrase(near.floor, false)}, ${_officePosition(near, false)}.`;
      if (n > 1) text += ` It has ${n} windows; I'll take you to the nearest one.`;
    } else {
      text = `${subj} has ${n} windows, on ${floors.map(f => "the " + _officeFloorName(f)).join(" and ")}. ` +
             `The one nearest the main entrance is on ${_officeFloorPhrase(near.floor, false)}, ` +
             `${_officePosition(near, false)}. I'll take you to the nearest one.`;
    }
  }
  return { text, navDept: office.dept, navLabel: office.name };
}
