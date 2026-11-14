/**
 * charter_rescan_merge.js - fold a fresh read of the 28 per-office Citizen's
 * Charter PDFs (tools/parse_charter_pdfs.py --json) into services.json.
 *
 * Rules (agreed with Jace, 2026-11-14):
 *   - Keep every existing service and its title. Titles key the glossary, the
 *     search index and the analytics, so they never change here.
 *   - Requirements: if the PDF lists everything the app has PLUS more numbered
 *     items, take the PDF's numbered list (the website scrape dropped items).
 *     If the app has something the PDF lacks, keep the app's list and report it.
 *   - Add the services that exist only in the PDFs (ADDITIONS below), with
 *     clean titles written by hand. Duplicates of existing services are not added.
 *   - Announcement 1044 (20 May 2026): from 1 June 2026 the Housing and
 *     Settlements Department accepts only the revised BP 220 Building Permit
 *     Application Form.
 *
 * Usage: node tools/charter_rescan_merge.js <repo-root> <parsed.json> [--write]
 * Without --write it only prints the report.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [root, parsedPath] = process.argv.slice(2);
const WRITE = process.argv.includes('--write');
const SVC = path.join(root, 'wayfinding-app/data/services.json');
const live = JSON.parse(fs.readFileSync(SVC, 'utf8'));
const pdf = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));
const BASE = 'https://www.calambacity.gov.ph/maincss/assets/citizencharter/';

// The Mayor's PDF covers three offices that the app keeps separate.
const DIV = [
  [/OSCA/i, 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS'],
  [/PDAO|Disability/i, 'PERSONS WITH DISABILITY AFFAIRS OFFICE'],
  [/Reduction|Disaster/i, 'CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO'],
];
const STEM = {}; // department -> pdf file stem, for source_url
for (const s of pdf) {
  s._stem = s._stem || null;
  if (s.department === 'OFFICE OF THE MAYOR') for (const [re, d] of DIV) if (re.test(s.office_or_division)) s.department = d;
}

// ---- text helpers -------------------------------------------------------
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/-\s+/g, '').replace(/^\s*\d{1,2}\s*[.)]+\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const grams = (t) => { const g = new Set(); const x = t.replace(/ /g, ''); for (let i = 0; i < x.length - 3; i++) g.add(x.slice(i, i + 4)); return g; };
const sim = (a, b) => { const A = grams(a), B = grams(b); let i = 0; for (const x of A) if (B.has(x)) i++; return A.size + B.size ? (2 * i) / (A.size + B.size) : 1; };
const flat = (reqs) => reqs.map((r) => norm(r.requirement)).join(' ');
const numbered = (r) => /^\s*\d{1,2}\s*[.)]/.test(r.requirement);

// ---- 1. requirement updates on existing services -------------------------
const report = { filled: [], keptAppHasMore: [], added: [], notes: [] };
for (const office of new Set(live.map((s) => s.department))) {
  const L = live.map((s, i) => [s, i]).filter(([s]) => s.department === office);
  const P = pdf.filter((s) => s.department === office);
  const cands = [];
  for (const [l, i] of L) P.forEach((p, j) => cands.push([sim(flat(l.requirements), flat(p.requirements)), i, j]));
  cands.sort((x, y) => y[0] - x[0]);
  const ui = new Set(), uj = new Set();
  for (const [score, i, j] of cands) {
    if (score < 0.6 || ui.has(i) || uj.has(j)) continue;
    ui.add(i); uj.add(j);
    const app = live[i], p = P[j];
    const pNum = p.requirements.filter(numbered);
    if (!pNum.length) continue;
    const appN = app.requirements.map((r) => norm(r.requirement)).filter(Boolean);
    const pN = pNum.map((r) => norm(r.requirement));
    const appInPdf = appN.every((a) => pN.some((b) => sim(a, b) >= 0.8));
    const extra = pN.filter((b) => !appN.some((a) => sim(a, b) >= 0.8));
    // Only when the PDF really lists more items; an equal count is rewording,
    // and the website's wording is the cleaner of the two.
    if (appInPdf && extra.length && pNum.length > appN.length) {
      report.filled.push({ office, service: app.subservice, before: app.requirements.length, after: pNum.length, added: pNum.filter((r) => extra.includes(norm(r.requirement))).map((r) => r.requirement) });
      app.requirements = pNum.map((r) => ({ requirement: r.requirement, where_to_secure: r.where_to_secure || '' }));
    } else if (!appInPdf) {
      const missing = app.requirements.filter((r) => !pN.some((b) => sim(norm(r.requirement), b) >= 0.8)).map((r) => r.requirement);
      if (missing.length && extra.length) report.keptAppHasMore.push({ office, service: app.subservice, appOnly: missing, pdfOnly: pNum.filter((r) => extra.includes(norm(r.requirement))).map((r) => r.requirement) });
    }
  }
}

// ---- 2. services only in the PDFs ------------------------------------------
// [file stem, page, department, clean title, category]
const ADDITIONS = [
  ['business_permits_and_tricycle_franchising_office', 32, 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE', "Special Permit (Special Mayor's Permit for Events and Activities)", 'Business and Trade'],
  ['city_assessment_office', 11, 'CITY ASSESSMENT OFFICE', 'Issuance of New Tax Declaration for General Purposes (Reassessment, Revision or New Discovery of Real Property)', 'Tax'],
  ['city_college_of_calamba', 23, 'CITY COLLEGE OF CALAMBA', 'Application for Clearance for Graduating Students', 'Education, Training, Seminars, and Competencies'],
  ['city_college_of_calamba', 27, 'CITY COLLEGE OF CALAMBA', 'Hardware / Software / Network Maintenance and Troubleshooting', 'Registrations, Applications, Ordinances, and Others'],
  ['city_college_of_calamba', 28, 'CITY COLLEGE OF CALAMBA', 'Request for Retrieval of Document', 'Education, Training, Seminars, and Competencies'],
  ['office_of_the_city_mayor', 36, 'CITY DISASTER RISK REDUCTION AND MANAGEMENT DIVISION - MO', 'Standby Ambulance (Pagtatalaga ng Nakahandang Ambulansya sa Pagtitipon)', 'Disaster and Weather'],
  ['office_of_the_city_mayor', 38, 'OFFICE OF THE MAYOR', 'Request for Investigation, Review or Audit of Transactions (Internal Audit Services)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_engineering_services_office', 9, 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT', 'Paghahanda ng Programa sa Paggawa ng mga Proyektong Imprastraktura (Infrastructure Project Programming)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_engineering_services_office', 16, 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT', 'Pagsasaayos at Pagpapanatili ng Imprastraktura / Gusali (Infrastructure and Building Repair and Maintenance)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_engineering_services_office', 18, 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT', 'Pagpapahiram ng Pansamantalang Entablado, Sasakyan at Heavy Equipment (Loan of Stage, Vehicles and Heavy Equipment)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_engineering_services_office', 20, 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT', 'Pagkukumpuni ng Pagpapailaw sa Kalsada (Streetlight Repair)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_engineering_services_office', 21, 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT', 'Pagkukumpuni at Pagsasaayos ng Daluyan ng Tubig (Repair, Clearing and Desilting of Drainage Canals)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_engineering_services_office', 22, 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT', 'Pagpapanatili ng Kaayusan ng Sewerage Treatment Plant (STP Maintenance)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_engineering_services_office', 23, 'CITY ENGINEERING AND INFRASTRUCTURE DEVELOPMENT DEPARTMENT', 'Demolisyon ng mga Iligal na Istraktura sa Road Right-of-Way at Lumang Gusali ng Paaralan (Demolition of Illegal Structures)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_general_services_office', 12, 'CITY GENERAL SERVICES OFFICE', 'Pagkukumpuni at Pangangalaga ng mga Kagamitan ng Ibang Ahensya (Equipment Repair for Other Agencies)', 'Registrations, Applications, Ordinances, and Others'],
  ['city_human_resources_management_office', 18, 'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE', 'Application for Leave (Without Commutation of Leave Credits)', 'Employment'],
  ['city_human_resources_management_office', 21, 'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE', 'Application for Leave (With Commutation of Leave Credits)', 'Employment'],
  ['city_human_resources_management_office', 24, 'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE', 'Pagpapalit ng Identification Card (Employee ID Replacement)', 'Employment'],
  ['city_human_resources_management_office', 29, 'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE', 'Pagpapalit ng Nawala o Nasirang ATM / Cash Card (ATM / Cash Card Replacement)', 'Employment'],
  ['city_human_resources_management_office', 31, 'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE', 'Pagbabago ng Impormasyon (Update of Employee Information)', 'Employment'],
  ['city_human_resources_management_office', 32, 'CITY HUMAN RESOURCE AND MANAGEMENT OFFICE', 'Paghiling ng Human Resource Clearance (HR Clearance)', 'Employment'],
  ['city_legal_services_office', 11, 'CITY LEGAL SERVICES OFFICE', 'Request for Preparation of Legal Documents including Notarization', 'Registrations, Applications, Ordinances, and Others'],
  ['city_planning_and_development_office', 23, 'CITY PLANNING AND DEVELOPMENT OFFICE', 'Computer Repair (Pagkukumpuni ng mga Computer)', 'Registrations, Applications, Ordinances, and Others'],
  ['cooperatives_and_livelihood_development_department', 17, 'COOPERATIVES AND LIVELIHOOD DEVELOPMENT DEPARTMENT', 'Pagproseso at Pagbigay ng CLDF Loan (CLDF Livelihood Loan)', 'Business and Trade'],
  ['office_of_the_city_mayor', 26, 'PERSONS WITH DISABILITY AFFAIRS OFFICE', 'Certificate of Disability and Certificate of Cancellation of PWD ID', 'Social Services'],
  ['office_of_the_city_mayor', 27, 'PERSONS WITH DISABILITY AFFAIRS OFFICE', 'Tulong Pinansiyal para sa Medical at Therapy ng PWD (Medical and Therapy Assistance for PWDs)', 'Social Services'],
  ['office_of_the_city_mayor', 28, 'PERSONS WITH DISABILITY AFFAIRS OFFICE', 'Pag-verify ng PhilHealth Benefit ng PWD (PWD PhilHealth Verification)', 'Social Services'],
  ['public_order_and_safety_office', 11, 'PUBLIC ORDER AND SAFETY OFFICE', 'Request to View or Get a Copy of CCTV Footage', 'Registrations, Applications, Ordinances, and Others'],
  ['public_order_and_safety_office', 12, 'PUBLIC ORDER AND SAFETY OFFICE', "Pagtubos ng Lisensya (Redemption of Confiscated Driver's License)", 'Certificates, Permits, and IDs'],
  ['public_order_and_safety_office', 18, 'PUBLIC ORDER AND SAFETY OFFICE', 'Request for Public Order Assistance at Events in Public Places', 'Registrations, Applications, Ordinances, and Others'],
  ['public_order_and_safety_office', 19, 'PUBLIC ORDER AND SAFETY OFFICE', 'Request for Assistance in Clearing Road Obstructions', 'Registrations, Applications, Ordinances, and Others'],
  ['public_order_and_safety_office', 20, 'PUBLIC ORDER AND SAFETY OFFICE', 'CCTV Compliance Certification for Business Establishments', 'Certificates, Permits, and IDs'],
];

// parse_charter_pdfs.py does not record the file, so find each PDF service by
// department + page (unique within the parsed set).
const deptOf = (stem, page, dept) => pdf.filter((s) => s._page === page && s.department === dept);
let nextId = Math.max(...live.map((s) => +s.source_id || 0)) + 1;
for (const [stem, page, dept, title, category] of ADDITIONS) {
  const hits = deptOf(stem, page, dept);
  if (hits.length !== 1) { console.error(`ADDITION not found uniquely: ${dept} p${page} (${hits.length})`); process.exit(1); }
  const p = hits[0];
  if (live.some((s) => s.department === dept && s.subservice === title)) continue; // already merged
  live.push({
    service: category,
    subservice: title,
    department: dept,
    source_id: String(nextId++),
    source_url: `${BASE}${stem}.pdf#page=${page}`,
    classification: p.classification,
    type_of_transaction: p.type_of_transaction,
    who_may_avail: p.who_may_avail,
    requirements: p.requirements.map((r) => ({ requirement: r.requirement, where_to_secure: r.where_to_secure || '' })),
    steps: p.steps,
  });
  report.added.push(`${dept} | ${title}`);
}

// ---- 3. announcement 1044: revised BP 220 form -----------------------------
const bp = live.find((s) => s.department === 'HOUSING AND SETTLEMENTS DEPARTMENT' && /Building Permit \(BP220\)/.test(s.subservice));
const NOTE = 'Revised BP 220 Building Permit Application Form (required from June 1, 2026; the old form is returned without processing)';
if (bp && !bp.requirements.some((r) => /Revised BP 220/.test(r.requirement))) {
  bp.requirements[0] = { requirement: `1. ${NOTE}`, where_to_secure: 'Housing and Settlements Department office, or download from the City of Calamba website' };
  bp.announcement = { url: 'https://calambacity.gov.ph/Users/Home/ViewDetailsAnnouncements?announcementsId=1044', date: '2026-05-20', effective: '2026-06-01' };
  report.notes.push(`BP 220: first requirement now names the revised form (${bp.subservice.slice(0, 50)})`);
}

// ---- report / write --------------------------------------------------------
console.log(`requirements filled in from the PDF: ${report.filled.length}`);
for (const f of report.filled) console.log(`  ${f.office.slice(0, 30)} | ${f.service.slice(0, 60)} | ${f.before} -> ${f.after}`);
console.log(`kept the app's list (app has items the PDF lacks): ${report.keptAppHasMore.length}`);
for (const k of report.keptAppHasMore) console.log(`  ${k.office.slice(0, 30)} | ${k.service.slice(0, 60)}`);
console.log(`new services: ${report.added.length}`);
for (const a of report.added) console.log(`  ${a}`);
for (const n of report.notes) console.log(`note: ${n}`);
console.log(`total services: ${live.length}`);
fs.writeFileSync(parsedPath.replace(/parsed\.json$/, 'merge_report.json'), JSON.stringify(report, null, 1));
if (WRITE) {
  const bak = SVC + '.bak_pre_rescan_20261114';
  if (!fs.existsSync(bak)) fs.copyFileSync(SVC, bak);
  fs.writeFileSync(SVC, JSON.stringify(live, null, 2) + '\n');
  console.log(`wrote ${SVC} (backup ${path.basename(bak)})`);
}
