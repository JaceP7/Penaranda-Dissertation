/**
 * eval_service_coverage.js - does every Charter service get answered as
 * itself, and is the citizen ever sent to the wrong office?
 *
 * Input: eval/service_questions.json (tools/make_service_questions.js), one
 * English and one Filipino question per service.
 *
 *   node tools/eval_service_coverage.js <repo-root> retrieval
 *     Upstash search only: is the right service first / in the top 6?
 *   node tools/eval_service_coverage.js <repo-root> e2e [--limit N] [--lang en|fil]
 *     The real api/chat.js handler in-process (Upstash + Groq), with Redis
 *     logging switched off so nothing reaches the analytics.
 *
 * Grades for e2e:
 *   right    - answered as that service (or another service at the same office
 *              with the same name), so "Take me there" goes to the right office
 *   office   - right office, different service at it
 *   asked    - asked the citizen to choose, and the right service is offered
 *   wrong    - sent to a DIFFERENT office (the failure Jace named)
 *   none     - no office (not found / rephrase / out of scope)
 *
 * Writes eval/service_coverage_<mode>_<stamp>.json with every miss.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.');
const MODE = process.argv[3] || 'retrieval';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const LIMIT = Number(arg('--limit')) || Infinity;
const LANG = arg('--lang');

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
for (const k of ['UPSTASH_VECTOR_REST_URL', 'UPSTASH_VECTOR_REST_TOKEN', 'GROQ_API_KEY']) process.env[k] = env[k];
const NS = arg('--namespace') || '';
process.env.UPSTASH_VECTOR_NAMESPACE = NS;   // the handler reads it at require time
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;   // never log eval traffic

const items = require(path.join(ROOT, 'eval/service_questions.json')).items;
const cases = [];
for (const it of items) for (const lang of ['en', 'fil']) {
  if (LANG && lang !== LANG) continue;
  cases.push({ q: it[lang], lang, subservice: it.subservice, department: it.department });
}
const pick = Number.isFinite(LIMIT) ? cases.filter((_, i) => i % Math.ceil(cases.length / LIMIT) === 0).slice(0, LIMIT) : cases;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q) {
  const r = await fetch(`${env.UPSTASH_VECTOR_REST_URL.replace(/\/$/, '')}/query-data${NS ? '/' + NS : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_VECTOR_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: q, topK: 6, includeMetadata: true }),
  });
  const d = await r.json();
  return (d.result || []).map((x) => ({ subservice: x.metadata?.subservice, department: x.metadata?.department, score: x.score }));
}

async function callHandler(handler, q) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let out = null, status = 200;
    const res = { setHeader() {}, status(c) { status = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: {}, body: { query: q } }, res);
    if (out && out.rate_limited) { await sleep(15000 * (attempt + 1)); continue; }
    if (status >= 500 && /Groq|429/.test(JSON.stringify(out))) { await sleep(15000 * (attempt + 1)); continue; }
    return { status, out };
  }
  return { status: 429, out: { rate_limited: true } };
}

function grade(c, out) {
  if (!out || !out.department) {
    if (out && out.needsContext && (out.options || []).some((o) => norm(o) === norm(c.subservice))) return 'asked';
    return 'none';
  }
  if (norm(out.department) !== norm(c.department)) return 'wrong';
  return norm(out.subservice) === norm(c.subservice) ? 'right' : 'office';
}

(async () => {
  const misses = [], tally = {};
  const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
  const handler = MODE === 'e2e' ? require(path.join(ROOT, 'api/chat.js')) : null;
  let n = 0;
  for (const c of pick) {
    n++;
    if (MODE === 'retrieval') {
      const top = await search(c.q);
      const first = top[0] || {};
      const svc1 = norm(first.subservice) === norm(c.subservice) && norm(first.department) === norm(c.department);
      const dept1 = norm(first.department) === norm(c.department);
      const in6 = top.some((t) => norm(t.subservice) === norm(c.subservice) && norm(t.department) === norm(c.department));
      bump(svc1 ? 'service@1' : dept1 ? 'office@1 only' : 'other office@1');
      if (in6) bump('service in top 6');
      if (!svc1) misses.push({ ...c, top: top.slice(0, 3).map((t) => `${t.score.toFixed(3)} ${t.subservice} | ${t.department}`), in6 });
    } else {
      const { out } = await callHandler(handler, c.q);
      const g = grade(c, out);
      bump(g);
      if (g !== 'right') misses.push({ ...c, grade: g, got: out && { department: out.department, subservice: out.subservice, kind: out.kind, needsContext: out.needsContext, answer: String(out.answer || '').slice(0, 160) } });
      await sleep(400);
    }
    if (n % 50 === 0) console.log(`  ${n}/${pick.length}`, JSON.stringify(tally));
  }
  const total = pick.length;
  console.log(`\n${MODE}: ${total} questions`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${String(v).padStart(4)}  ${(100 * v / total).toFixed(1)}%`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const file = path.join(ROOT, `eval/service_coverage_${MODE}${NS ? '_' + NS : ''}_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ mode: MODE, total, tally, misses }, null, 1));
  console.log('misses →', path.relative(ROOT, file));
})().catch((e) => { console.error(e); process.exit(1); });
