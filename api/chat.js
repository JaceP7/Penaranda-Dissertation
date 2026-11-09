/**
 * api/chat.js — Vercel serverless function (Serverless RAG)
 *
 * Pipeline:
 *   query → Upstash Vector (text-embedding-3-small, server-side embed + similarity search over
 *           the 235 Calamba services) → top-K with metadata → Groq generation
 *           grounded on that context → { answer, department, subservice, ... }
 *
 * No heavy local models: Upstash embeds both the stored services and the query,
 * so this function stays within Vercel's serverless limits. Seed the index once
 * with tools/upstash_seed.py. The live index uses Upstash's built-in
 * text-embedding-3-small (1536-d, COSINE) — verified against /info on
 * 2026-10-13. An earlier comment here said bge-m3, which is 1024-d and was
 * never what this index ran.
 *
 * Required env vars (set in the Vercel project):
 *   UPSTASH_VECTOR_REST_URL
 *   UPSTASH_VECTOR_REST_TOKEN
 *   GROQ_API_KEY
 *
 * Response shape is unchanged from the previous version, so the chat UI,
 * "Take me there" button, and service_locations.js routing keep working.
 */

const { findOfficeQuestion } = require('../lib/office_finder');
const { classifyScope, scopeReply, unclearReply } = require('../lib/scope_guard');
const { findService, relatedServices, serviceAnswer } = require('../lib/service_lookup');

// Below this top search score the match is treated as not understood rather
// than answered. Calibrated on 2026-11-09: every genuine typed question that
// day scored 0.630 or more; nonsense words and an off-topic request
// scored 0.581-0.622 (a nonsense word had been sent to Veterinary).
const MIN_SCORE = 0.625;

const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL       = 'openai/gpt-oss-120b';       // llama-3.3-70b went Groq-enterprise-only
                                                  // on 2026-08-16; this is the self-serve
                                                  // replacement (131K ctx, $0.15/$0.60 per M)
const MAX_TOKENS  = 1600;                         // itemised requirements + the "Go to:" line
                                                  // (raised from 900: reasoning models need headroom)
const MAX_RETRIES = 2;
const TOP_K       = 6;

const UPSTASH_URL   = (process.env.UPSTASH_VECTOR_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN || '';

// Optional Upstash Redis for live-site analytics logging. If these env vars
// aren't set, logging is silently skipped (the chat still works).
const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const LOG_KEY     = 'wf:querylog';
// Keep the most recent N entries. Raised from 5,000 so an evaluation period
// cannot silently lose its earliest queries — at ~200 bytes an entry this is
// roughly 10 MB, well inside the Upstash free tier. api/analytics.js pages
// through the list, so a large cap costs nothing on read.
// Must stay <= MAX_SCAN in api/analytics.js.
const LOG_CAP     = 50000;

async function logQuery(entry) {
  if (!REDIS_URL || !REDIS_TOKEN) return;   // logging not configured → skip
  try {
    const post = (cmd) => fetch(REDIS_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(cmd),
    });
    await post(['LPUSH', LOG_KEY, JSON.stringify(entry)]);
    await post(['LTRIM', LOG_KEY, '0', String(LOG_CAP - 1)]);
  } catch (_) { /* best-effort; never break the chat on a logging failure */ }
}

// Crude language tag for analytics (matches the local server's fil/en split).
const _FIL = /\b(saan|paano|pano|kumuha|magkano|ano|po|ng|sa|mag|ako|kailangan|pwede|para)\b/i;
function langTag(q) { return _FIL.test(q || '') ? 'fil' : 'en'; }

// ── Upstash Vector retrieval (server-side embedding) ──────────────────────────
async function upstashQuery(text, topK = TOP_K) {
  const r = await fetch(`${UPSTASH_URL}/query-data`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ data: text, topK, includeMetadata: true }),
  });
  if (!r.ok) throw new Error(`Upstash query ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  // _score rides along on the metadata so the handler can refuse a weak match.
  return (d.result || []).map(x => Object.assign({}, x.metadata || {}, { _score: x.score }))
    .filter(m => m.subservice);
}

function buildContext(results) {
  return results.map(m => {
    const reqs = (m.requirements || [])
      .map(rq => `  - ${rq.requirement} (secure at: ${rq.where_to_secure || 'N/A'})`)
      .join('\n');
    const steps = (m.steps || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    return [
      `Service: ${m.service}`,
      `Sub-service: ${m.subservice}`,
      `Department: ${m.department}`,
      m.who_may_avail ? `Who may avail: ${m.who_may_avail}` : '',
      reqs ? `Requirements:\n${reqs}` : '',
      steps ? `Steps:\n${steps}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');
}

// ── Groq call with retry on 429 ───────────────────────────────────────────────
async function callGroq(messages, attempt = 0) {
  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model: MODEL, messages, temperature: 0.3, max_tokens: MAX_TOKENS,
      // gpt-oss is a reasoning model: without this it spends the whole
      // token budget thinking and truncates before emitting the
      // trailing "Go to: <OFFICE>" line that drives navigation.
      reasoning_effort: 'low',
    }),
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfter = parseFloat(res.headers.get('retry-after') || '0');
    const waitMs = (retryAfter > 0 && retryAfter < 5) ? retryAfter * 1000 : (attempt + 1) * 1200;
    await new Promise(r => setTimeout(r, waitMs));
    return callGroq(messages, attempt + 1);
  }
  return res;
}

// ── Department resolution from the answer's "Go to:" line ─────────────────────

// An answer asking the citizen to choose between services (prompt rule 4).
// Only explicit choice wording counts: a bare closing "?" is often a courtesy
// ("May iba ka pa bang tanong?") on an answer that did resolve.
const CLARIFY = /\b(which one|which of (these|the following|them)|which (service|permit|certificate|document|type|kind)|alin|tukuyin|could you specify|can you specify|please specify|please clarify|anong (serbisyo|klase|uri))\b/i;
// An answer that found nothing (prompt rule 5).
const NOT_FOUND = /\b(could not|couldn['’]?t|cannot|can['’]?t|unable to) find\b|\bnot (in|found in) the (provided|given)\b|\bhindi (ko )?(mahanap|makita|nakita)\b|\bwala(ng)? (akong )?(nakitang|impormasyon)\b|\binformation desk\b/i;

/** @returns {{ dept: string|null, needsContext: boolean }} */
function resolveDept(answer, results) {
  const m = answer.match(/Go to:\s*(.+?)\s*$/im);
  const depts = [...new Set(results.map(r => r.department).filter(Boolean))];
  if (m) {
    const name = m[1].trim().replace(/[.*_`]+$/g, '').trim();
    const up = name.toUpperCase();
    const exact = depts.find(d => d.toUpperCase() === up);
    if (exact) return { dept: exact, needsContext: false };
    const partial = depts.find(d => up.includes(d.toUpperCase()) || d.toUpperCase().includes(up));
    if (partial) return { dept: partial, needsContext: false };
    return { dept: name, needsContext: false };   // LLM named a dept not in results — pass through verbatim
  }
  // No "Go to:" line. A question back to the citizen, or an answer that found
  // nothing, must not carry a "Take me there" to a guessed office. Until
  // 2026-11-09 both did, and needsContext could never be true.
  if (CLARIFY.test(answer))   return { dept: null, needsContext: true };
  if (NOT_FOUND.test(answer)) return { dept: null, needsContext: false };
  // Otherwise the model resolved the service but dropped its "Go to:" line,
  // which it does fairly often (more so on reasoning models). Fall back to the
  // top-ranked retrieval result, which is a far more dependable signal than
  // the model's formatting (P@1 = 0.750).
  return { dept: depts[0] || null, needsContext: false };
}

// ── "Where is [office]?" ─────────────────────────────────────────────────────
// Answered from lib/office_finder.js before any search or model call. The
// client rewrites `answer` from its live map (describeOfficeLocation in
// service_locations.js); the sentence here is what an older cached client shows.

// Filipino location words that langTag() does not catch ("nasaan ang PESO?").
const _FIL_WHERE = /\b(nasaan|nasaang|nasan|asan|saang|san|nasa|papunta|pumunta|punta|dalhin|ang|yung|ung)\b/i;
function locationLang(q) { return langTag(q) === 'fil' || _FIL_WHERE.test(q || '') ? 'fil' : 'en'; }

function locationReply(found, lang) {
  if (found.clash) {
    const { alias, offices } = found.clash;
    return {
      answer: lang === 'fil'
        ? `Higit sa isang office ang tinatawag na ${alias}. Alin ang kailangan mo?`
        : `${alias} can mean more than one office. Which one do you need?`,
      department: null, needsContext: true,
      options: offices.map(o => (lang === 'fil' ? `Nasaan ang ${o.name}?` : `Where is the ${o.name}?`)),
      office: null,
    };
  }
  const o = found.office;
  const who = o.abbr ? `${o.abbr} (${o.name})` : o.name;
  return {
    answer: lang === 'fil'
      ? `${who}. I-tap ang Take me there at ituturo ko ang daan.`
      : `${who}. Tap Take me there and I'll show you the way.`,
    department: o.dept, needsContext: false, options: [], office: o,
  };
}

const SYSTEM_PROMPT = `You are the Calamba City Hall services assistant. Use ONLY the provided context.

Rules:
1. LANGUAGE: Reply in the SAME language as the user's question. If they wrote in Filipino or Taglish, reply in natural conversational Taglish. Keep office names, document names, and the "Go to:" line in their official English form.
2. If the question clearly maps to ONE service, give the requirements as a numbered list. For each requirement append "(secure at: <where>)" taken from the context.
3. End a resolved answer with a line exactly: "Go to: <EXACT DEPARTMENT NAME>" copied verbatim from the context.
4. If the question could mean SEVERAL different sub-services, briefly list them and ask which one the user needs. In this case DO NOT include a "Go to:" line.
5. If the context does not contain the answer, say you could not find it and suggest asking at the Information desk. No "Go to:" line.
6. Be concise.`;

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const t0 = Date.now();
  const { query, history = [] } = req.body || {};
  // A tapped chip, not typed text. Logged as such so the "most asked" chips
  // can be ranked from typed questions only (they were feeding themselves).
  const source = (req.body && req.body.source === 'chip') ? 'chip' : undefined;
  // Automated checks (tools/verify_stack.py) send this header so their traffic
  // can be excluded from analytics. Without it the health-check string becomes
  // the top "citizen" query and the demand ranking measures our own testing.
  const synthetic = String(req.headers['x-health-check'] || '') === '1' || undefined;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  // 0a. A chip that names a service: answer from the Charter record itself.
  if (source === 'chip') {
    const svc = findService(query);
    if (svc) {
      const lang = langTag(query);
      await logQuery({ ts: Date.now(), query, department: svc.department, subservice: svc.subservice,
                       needsContext: false, latency_ms: Date.now() - t0, lang,
                       kind: 'service', source, synthetic });
      return res.status(200).json({
        answer: serviceAnswer(svc, lang), department: svc.department, subservice: svc.subservice,
        needsContext: false, options: [], rate_limited: false, kind: 'service', lang,
        related: relatedServices(svc.department, svc.subservice),
      });
    }
  }

  // 0b. Out of scope: facilities, other agencies, officials, the exit, small
  //     talk. A short explanation and the help desk (Jace, 2026-11-09).
  const scope = classifyScope(query);
  if (scope) {
    const lang = locationLang(query);
    const r = scopeReply(scope, lang);
    await logQuery({ ts: Date.now(), query, department: null, subservice: null, needsContext: false,
                     latency_ms: Date.now() - t0, lang, kind: 'scope', topic: scope.topic, source, synthetic });
    return res.status(200).json({
      answer: r.answer, department: null, subservice: null, needsContext: false, options: [],
      rate_limited: false, kind: 'scope', topic: scope.topic, actions: r.actions, lang,
    });
  }

  // 0c. "Where is [office]?" — answered from the office list, no search needed.
  const found = findOfficeQuestion(query);
  if (found) {
    const lang = locationLang(query);
    const r = locationReply(found, lang);
    await logQuery({ ts: Date.now(), query, department: r.department, subservice: null,
                     needsContext: r.needsContext, latency_ms: Date.now() - t0, lang,
                     kind: 'location', source, synthetic });
    return res.status(200).json({
      answer: r.answer, department: r.department, subservice: null,
      needsContext: r.needsContext, options: r.options, rate_limited: false,
      kind: 'location', lang, office: r.office,
    });
  }

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({
      error: 'Vector store not configured',
      detail: 'Set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN in the Vercel project.',
    });
  }

  // 1. Retrieve from Upstash Vector
  let results;
  try {
    results = await upstashQuery(query);
  } catch (err) {
    return res.status(502).json({ error: 'Vector search failed', detail: err.message });
  }
  // A match this weak is a guess (a nonsense word went to Veterinary on
  // 2026-11-09). Ask the citizen to rephrase instead of answering it.
  if (results.length && typeof results[0]._score === 'number' && results[0]._score < MIN_SCORE) {
    const lang = locationLang(query);
    const r = unclearReply(lang);
    await logQuery({ ts: Date.now(), query, department: null, subservice: null, needsContext: false,
                     latency_ms: Date.now() - t0, lang, kind: 'unclear', score: results[0]._score,
                     source, synthetic });
    return res.status(200).json({
      answer: r.answer, department: null, subservice: null, needsContext: false, options: [],
      rate_limited: false, kind: 'unclear', actions: r.actions, lang,
    });
  }
  if (!results.length) {
    await logQuery({ ts: Date.now(), query, department: null, subservice: null,
                     needsContext: false, latency_ms: Date.now() - t0, lang: langTag(query),
                     source, synthetic });
    return res.status(200).json({
      answer: "I couldn't find that in the Calamba City Hall services. Please ask at the Information desk.",
      department: null, subservice: null, needsContext: false, options: [], rate_limited: false,
    });
  }

  // 2. Generate with Groq grounded on the retrieved context
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: 'user', content: `Context:\n${buildContext(results)}\n\nUser question: ${query}` },
  ];

  let groqRes;
  try {
    groqRes = await callGroq(messages);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach Groq API', detail: err.message });
  }
  if (groqRes.status === 429) {
    return res.status(200).json({
      answer: 'The assistant is momentarily busy. Please wait a few seconds and try again.',
      department: null, subservice: null, needsContext: false, options: [], rate_limited: true,
    });
  }
  if (!groqRes.ok) {
    return res.status(502).json({ error: 'Groq API error', detail: (await groqRes.text()).slice(0, 300) });
  }

  const data   = await groqRes.json();
  const raw    = data.choices?.[0]?.message?.content ?? 'No answer returned.';
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 3. Resolve department / clarification
  const { dept, needsContext } = resolveDept(answer, results);
  const options = needsContext
    ? [...new Set(results.map(r => r.subservice).filter(Boolean))].slice(0, 6)
    : [];
  // subservice = the retrieved item whose department matches the resolved dept
  let subservice = null;
  if (dept) {
    const hit = results.find(r => (r.department || '').toUpperCase() === dept.toUpperCase());
    subservice = (hit || results[0]).subservice || null;
  }

  await logQuery({ ts: Date.now(), query, department: dept || null, subservice,
                   needsContext, latency_ms: Date.now() - t0, lang: langTag(query),
                   source, synthetic });

  return res.status(200).json({
    answer,
    department:   dept || null,
    subservice,
    needsContext,
    options,
    rate_limited: false,
    // Other services at the same office, offered as chips after the answer.
    related: dept ? relatedServices(dept, subservice) : [],
  });
};
