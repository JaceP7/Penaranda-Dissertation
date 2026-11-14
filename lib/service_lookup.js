/**
 * lib/service_lookup.js - answer a chip straight from the Citizen's Charter.
 *
 * A chip's text is a service name taken from this same file (the most-asked
 * chips are ranked service names). Sending it through the search and the model
 * added a second's wait and a Groq call, and on 2026-11-09 the hospitalization
 * chip came back three times as "which one do you mean?". The record is right
 * here, so the answer is built from it.
 *
 * Vercel bundles the JSON with the function because it is require()d.
 */
'use strict';

const SERVICES = require('../wayfinding-app/data/services.json');

const norm = (s) => String(s || '').toLowerCase().replace(/[’'`]/g, "'").replace(/\s+/g, ' ').trim();
const BY_NAME = new Map();
for (const s of SERVICES) if (s && s.subservice && !BY_NAME.has(norm(s.subservice))) BY_NAME.set(norm(s.subservice), s);

/** The service whose name is exactly `name` (case and spacing ignored), or null. */
function findService(name) {
  return BY_NAME.get(norm(name)) || null;
}

// ── A typed question that is a service's name ────────────────────────────────
// "Senior Citizens ID" typed in the box went through the search and the model
// like any question; on 2026-11-09 "Voter's id" came back as Senior Citizens
// ID. A name is answered from its record, the same way a chip is.
const nameKey = (s) => norm(s).replace(/^[\s"'“”.,!?¿:;-]+|[\s"'“”.,!?:;-]+$/g, '');
const ALL_BY_NAME = new Map();   // name -> one record per office
for (const s of SERVICES) {
  if (!s || !s.subservice) continue;
  const k = nameKey(s.subservice);
  const list = ALL_BY_NAME.get(k) || [];
  if (!list.some((x) => norm(x.department) === norm(s.department))) list.push(s);
  ALL_BY_NAME.set(k, list);
}

/**
 * Every office's record for a service named exactly `text` (case, spacing and
 * end punctuation ignored). "Name — OFFICE" (the choice chips) narrows it to
 * that office.
 */
function servicesNamed(text) {
  const whole = ALL_BY_NAME.get(nameKey(text));
  if (whole) return whole;
  const m = String(text || '').match(/^(.*\S)\s+[—–-]\s+([^—–]+)$/);
  if (!m) return [];
  const office = norm(m[2]);
  return (ALL_BY_NAME.get(nameKey(m[1])) || []).filter((s) => norm(s.department) === office);
}

/** The text of a choice chip for one office's record. */
function choiceLabel(svc) {
  return `${svc.subservice} — ${svc.department}`;
}

// ── The same help at another office ──────────────────────────────────────────
// Several offices run the same kind of help (Educational Assistance at the
// Mayor's and the Vice Mayor's, Burial Assistance at the Mayor's and OSCA).
// Picking one silently sent half the askers to the "wrong" office in the
// 2026-11-11 coverage test; the answer now names the other one too.
const GENERIC = new Set(('of the for and a an to in on ng sa mga at para ang na or by city office request requests ' +
  'issuance issue application apply pag pagbibigay pagkuha certificate certification copy copies').split(' '));
function contentWords(name) {
  return new Set(String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9ñ ]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w)));
}
function sameKindOfService(a, b) {
  const A = contentWords(a), B = contentWords(b);
  if (!A.size || !B.size) return false;
  let both = 0; A.forEach((w) => { if (B.has(w)) both++; });
  const overlap = both / (A.size + B.size - both);
  return overlap === 1 || (overlap >= 0.5 && both >= 2);
}

/** Services among `candidates` at OTHER offices that are the same kind of help as `subservice`. */
function alsoOfferedAt(subservice, department, candidates) {
  const out = [], d = norm(department);
  for (const c of candidates || []) {
    if (!c || !c.subservice || !c.department || norm(c.department) === d) continue;
    if (out.some((x) => norm(x.department) === norm(c.department))) continue;
    if (sameKindOfService(subservice, c.subservice)) out.push({ subservice: c.subservice, department: c.department });
  }
  return out;
}

/** Up to `n` other services from the same office, in Charter order. */
function relatedServices(department, exclude, n = 3) {
  const d = norm(department), x = norm(exclude);
  const out = [];
  for (const s of SERVICES) {
    if (out.length >= n) break;
    if (norm(s.department) !== d || norm(s.subservice) === x) continue;
    if (!out.includes(s.subservice)) out.push(s.subservice);
  }
  return out;
}

/** The answer text, in the shape the chat already renders (list + "Go to:"). */
function serviceAnswer(svc, lang) {
  const fil = lang === 'fil';
  const lines = [`**${svc.subservice}**`];
  if (svc.who_may_avail) lines.push(`${fil ? 'Para kanino' : 'Who may apply'}: ${svc.who_may_avail}`);
  const reqs = (svc.requirements || []).filter((r) => r && r.requirement);
  if (reqs.length) {
    lines.push('', fil ? 'Mga requirements:' : 'Requirements:');
    reqs.forEach((r, i) => {
      const what = String(r.requirement).replace(/^\s*\d+[.)]\s*/, '').trim();
      const where = String(r.where_to_secure || '').trim();
      lines.push(`${i + 1}. ${what}${where ? ` (secure at: ${where})` : ''}`);
    });
  } else {
    lines.push('', fil ? 'Walang nakalistang requirements sa Citizen\'s Charter.' : "The Citizen's Charter lists no requirements.");
  }
  lines.push('', `Go to: ${svc.department}`);
  return lines.join('\n');
}

module.exports = { findService, servicesNamed, choiceLabel, alsoOfferedAt, relatedServices, serviceAnswer, SERVICES };
