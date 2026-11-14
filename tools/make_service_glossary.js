/**
 * make_service_glossary.js - a plain bilingual description of every Charter
 * service, added to what the search index embeds (tools/upstash_seed.py).
 *
 * Why (measured 2026-11-11, eval/service_questions.json): the index embedded
 * only the official title. About 30 services have a Filipino-only title
 * ("Pagpaparehistro bilang magsasaka / mangingisda"), so "How do I register
 * as a farmer?" did not reach the top 6 at all; English-only titles had the
 * mirror problem with Filipino questions.
 *
 * Each entry: en (plain English name), fil (plain Filipino name), for (who it
 * is for, a few words), terms (everyday words people use, both languages).
 * It describes the service; it does not write questions, so it is not the
 * same text the evaluation questions were written from.
 *
 * Output: wayfinding-app/data/service_glossary.json, keyed by
 * "<subservice>|<department>". Resumable.
 *
 * Run: node tools/make_service_glossary.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '.';
const OUT = path.resolve(ROOT, 'wayfinding-app/data/service_glossary.json');
const env = Object.fromEntries(fs.readFileSync(path.resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const SERVICES = require(path.resolve(ROOT, 'wayfinding-app/data/services.json'));

const key = (s) => `${s.subservice}|${s.department}`;
const seen = new Set(), list = [];
for (const s of SERVICES) {
  if (!s.subservice || seen.has(key(s))) continue;
  seen.add(key(s));
  const reqs = (s.requirements || []).slice(0, 4).map((r) => String(r.requirement || '').replace(/^\s*\d+[.)]\s*/, '')).join('; ');
  list.push({ k: key(s), subservice: s.subservice, department: s.department, who: String(s.who_may_avail || '').slice(0, 160), reqs: reqs.slice(0, 240) });
}
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const todo = list.filter((s) => !out[s.k]);

const PROMPT = `You describe city hall services from the Citizen's Charter of Calamba City, Philippines, so a search engine can match what citizens type.
For EACH numbered service, give:
- "en": a plain English name, at most 10 words
- "fil": a plain Filipino name, at most 10 words
- "for": who it is for, at most 8 words (e.g. "senior citizens", "business owners", "anyone")
- "terms": 4 to 8 everyday words or short phrases people use for it, mixing English and Filipino
Be specific: say what makes THIS service different from similar ones (who it is for, what document it is). Do not invent services. Do not write questions.
Reply with JSON only: {"items":[{"n":1,"en":"...","fil":"...","for":"...","terms":["..."]}]}`;

async function groq(body) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 8000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('Groq kept rate-limiting');
}

(async () => {
  console.log(`${list.length} services, ${todo.length} to describe`);
  const BATCH = 8;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const text = chunk.map((s, j) => `${j + 1}. ${s.subservice}\n   office: ${s.department}\n   who may avail: ${s.who || '-'}\n   requirements: ${s.reqs || '-'}`).join('\n');
    const d = await groq({
      model: 'openai/gpt-oss-120b', temperature: 0.2, max_tokens: 3500, reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text }],
    });
    let items = [];
    try { items = JSON.parse(d.choices[0].message.content).items || []; } catch (_) { console.log('  bad JSON, rerun to fill'); continue; }
    for (const it of items) {
      const s = chunk[(it.n | 0) - 1];
      if (!s || !it.en || !it.fil) continue;
      out[s.k] = { en: String(it.en).trim(), fil: String(it.fil).trim(), for: String(it.for || '').trim(),
                   terms: (Array.isArray(it.terms) ? it.terms : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8) };
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    console.log(`  ${Object.keys(out).length}/${list.length}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
