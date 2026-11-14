/**
 * charter_pick.js - Charter-only type-ahead (pure, no DOM, no storage).
 *
 * Why: admins may only pick offices, services and requirements that exist in
 * the Citizen's Charter. This builds an index from services.json and the
 * glossary, suggests matches as the admin types, checks a value is a Charter
 * item, and finds the closest items for the "Not in the Charter" line.
 */
const CHARTER_PICK = (() => {
  'use strict';

  const NO_MATCH = "Not in the Charter. Only items in the Citizen's Charter can be added. If the office now asks for this, the Charter has to be updated first.";

  const fold = (text) => String(text == null ? '' : text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const words = (text) => { const f = fold(text); return f ? f.split(' ') : []; };

  const keyOf = (sub, dept) => sub + '|' + dept;
  const deptOfKey = (key) => { const i = String(key || '').lastIndexOf('|'); return i < 0 ? '' : key.slice(i + 1); };

  function buildIndex(services, glossary) {
    const offices = [];
    const servicesByDept = {};
    const requirementsByKey = {};
    const seenOffice = new Set();
    for (const r of services || []) {
      const dept = r.department, sub = r.subservice;
      if (!dept || !sub) continue;
      if (!seenOffice.has(dept)) {
        seenOffice.add(dept);
        offices.push({ value: dept, label: dept, words: words(dept) });
        servicesByDept[dept] = [];
      }
      const key = keyOf(sub, dept);
      let svc = servicesByDept[dept].find((s) => s.key === key);
      if (!svc) {
        const g = (glossary && glossary[key]) || {};
        const extra = [g.en, g.fil].concat(Array.isArray(g.terms) ? g.terms : []).filter(Boolean).join(' ');
        svc = { value: sub, label: sub, key, dept, words: words(sub + ' ' + extra) };
        servicesByDept[dept].push(svc);
        requirementsByKey[key] = [];
      }
      const have = new Set(requirementsByKey[key]);
      for (const q of r.requirements || []) {
        const t = q && q.requirement;
        if (t && !have.has(t)) { have.add(t); requirementsByKey[key].push(t); }
      }
    }
    return { offices, servicesByDept, requirementsByKey };
  }

  // How many query words match; 0 unless every one does.
  function score(qWords, itemWords) {
    for (const q of qWords) if (!itemWords.some((w) => w.startsWith(q))) return 0;
    return qWords.length;
  }

  function candidates(index, kind, opts) {
    opts = opts || {};
    if (kind === 'office') return index.offices.map((o) => ({ value: o.value, label: o.label, words: o.words, tier: 2 }));
    if (kind === 'service') {
      const out = [];
      for (const dept of Object.keys(index.servicesByDept)) {
        const own = !!opts.dept && dept === opts.dept;
        for (const s of index.servicesByDept[dept]) out.push({ value: s.value, label: s.label, words: s.words, tier: own ? 0 : 2 });
      }
      return out;
    }
    if (kind === 'requirement') {
      const sk = opts.serviceKey, dept = deptOfKey(sk);
      const out = [], seen = new Map();
      const add = (t, tier) => {
        const prev = seen.get(t);
        if (prev !== undefined) { if (tier < out[prev].tier) out[prev].tier = tier; return; }
        seen.set(t, out.length);
        out.push({ value: t, label: t, words: words(t), tier });
      };
      for (const t of index.requirementsByKey[sk] || []) add(t, 0);
      if (dept) for (const s of index.servicesByDept[dept] || []) for (const t of index.requirementsByKey[s.key] || []) add(t, 1);
      for (const k of Object.keys(index.requirementsByKey)) for (const t of index.requirementsByKey[k]) add(t, 2);
      return out;
    }
    return [];
  }

  function suggest(index, kind, text, opts, limit) {
    const q = words(text);
    if (!q.length) return [];
    const hits = [];
    const seen = new Set();
    for (const c of candidates(index, kind, opts)) {
      const s = score(q, c.words);
      if (!s) continue;
      // The same name at several offices is one suggestion; keep the best tier.
      if (seen.has(c.value)) {
        const prev = hits.find((h) => h.value === c.value);
        if (c.tier < prev.tier) prev.tier = c.tier;
        continue;
      }
      seen.add(c.value);
      hits.push({ value: c.value, label: c.label, tier: c.tier, score: s, len: c.label.length });
    }
    hits.sort((a, b) => a.tier - b.tier || b.score - a.score || a.len - b.len || (a.label < b.label ? -1 : 1));
    return hits.slice(0, limit == null ? 6 : limit).map((h) => ({ value: h.value, label: h.label, own: h.tier === 0 }));
  }

  function isCharterItem(index, kind, value, opts) {
    const f = fold(value);
    if (!f) return false;
    opts = opts || {};
    if (kind === 'office') return index.offices.some((o) => fold(o.value) === f);
    if (kind === 'service') {
      const depts = opts.dept ? [opts.dept] : Object.keys(index.servicesByDept);
      return depts.some((d) => (index.servicesByDept[d] || []).some((s) => fold(s.value) === f));
    }
    if (kind === 'requirement') return (index.requirementsByKey[opts.serviceKey] || []).some((t) => fold(t) === f);
    return false;
  }

  const grams = (text) => {
    const s = ' ' + fold(text) + ' ';
    const set = new Set();
    if (s.length <= 4) { set.add(s); return set; }
    for (let i = 0; i + 4 <= s.length; i++) set.add(s.slice(i, i + 4));
    return set;
  };

  // Dice coefficient on 4-grams, so a near miss still finds its neighbours.
  function closest(index, kind, text, opts, n) {
    const q = grams(text);
    if (q.size === 0) return [];
    const ranked = [];
    for (const c of candidates(index, kind, opts)) {
      const g = grams(c.label);
      let shared = 0;
      for (const x of q) if (g.has(x)) shared++;
      if (!shared) continue;
      ranked.push({ value: c.value, label: c.label, sim: (2 * shared) / (q.size + g.size), tier: c.tier });
    }
    ranked.sort((a, b) => b.sim - a.sim || a.tier - b.tier || a.label.length - b.label.length);
    const seen = new Set();
    const out = [];
    for (const r of ranked) {
      if (seen.has(r.value)) continue;
      seen.add(r.value);
      out.push({ value: r.value, label: r.label });
      if (out.length >= (n == null ? 3 : n)) break;
    }
    return out;
  }

  return { NO_MATCH, fold, buildIndex, suggest, isCharterItem, closest };
})();

if (typeof module !== 'undefined') module.exports = CHARTER_PICK;
