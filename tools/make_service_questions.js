/**
 * make_service_questions.js - one English and one Filipino/Taglish question
 * for every service in the Citizen's Charter, written the way a citizen would
 * type it (not the official title). Output: eval/service_questions.json.
 *
 * Jace, 2026-11-11: "the app should be able to answer all questions regarding
 * with services and will not lead it elsewhere if the service is present".
 * This set measures that for every service, not just the 37 hand-written
 * questions in eval/rag_test_set.json.
 *
 * Uses Groq (GROQ_API_KEY from .env). Resumable: services already in the
 * output file are skipped.
 *
 * Run: node tools/make_service_questions.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '.';
const OUT = path.resolve(ROOT, 'eval/service_questions.json');
const env = Object.fromEntries(fs.readFileSync(path.resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const SERVICES = require(path.resolve(ROOT, 'wayfinding-app/data/services.json'));

// One entry per (service name, office): the same name filed twice at one office is one service.
const seen = new Set(), list = [];
for (const s of SERVICES) {
  const k = `${s.subservice}|${s.department}`;
  if (!s.subservice || seen.has(k)) continue;
  seen.add(k);
  list.push({ subservice: s.subservice, department: s.department, who: s.who_may_avail || '' });
}

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { items: [] };
const done = new Set(prev.items.map((x) => `${x.subservice}|${x.department}`));
const todo = list.filter((x) => !done.has(`${x.subservice}|${x.department}`));

const PROMPT = `You write test questions for a city hall help chatbot in Calamba City, Philippines.
For EACH numbered service below, write two short questions a citizen would actually type into the chat:
- "en": casual English
- "fil": casual Filipino or Taglish (how Filipinos text, e.g. "pano kumuha ng...", "saan po mag-apply ng...")
Rules: do NOT copy the official title word for word; use the everyday words people use for that service. Keep each under 15 words. The question must still clearly point to that one service.
Reply with JSON only: {"items":[{"n":1,"en":"...","fil":"..."}, ...]}`;

async function groq(body) {
  for (let attempt = 0; attempt < 6; attempt++) {
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
  console.log(`${list.length} services, ${todo.length} to write`);
  const BATCH = 10;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const text = chunk.map((s, j) => `${j + 1}. ${s.subservice} (office: ${s.department})`).join('\n');
    const d = await groq({
      model: 'openai/gpt-oss-120b', temperature: 0.7, max_tokens: 3000, reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text }],
    });
    let items = [];
    try { items = JSON.parse(d.choices[0].message.content).items || []; } catch (_) { console.log('  bad JSON, will retry next run'); continue; }
    for (const it of items) {
      const s = chunk[(it.n | 0) - 1];
      if (!s || !it.en || !it.fil) continue;
      prev.items.push({ subservice: s.subservice, department: s.department, en: String(it.en).trim(), fil: String(it.fil).trim() });
    }
    fs.writeFileSync(OUT, JSON.stringify(prev, null, 1));
    console.log(`  ${prev.items.length}/${list.length}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
