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

module.exports = { findService, relatedServices, serviceAnswer, SERVICES };
