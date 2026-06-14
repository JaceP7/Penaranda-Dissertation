/**
 * api/chat.js — Vercel serverless function (Serverless RAG)
 *
 * Pipeline:
 *   query → Upstash Vector (bge-m3, server-side embed + similarity search over
 *           the 235 Calamba services) → top-K with metadata → Groq generation
 *           grounded on that context → { answer, department, subservice, ... }
 *
 * No heavy local models: Upstash embeds both the stored services and the query,
 * so this function stays within Vercel's serverless limits. Seed the index once
 * with tools/upstash_seed.py (index must use the BAAI/bge-m3 embedding model).
 *
 * Required env vars (set in the Vercel project):
 *   UPSTASH_VECTOR_REST_URL
 *   UPSTASH_VECTOR_REST_TOKEN
 *   GROQ_API_KEY
 *
 * Response shape is unchanged from the previous version, so the chat UI,
 * "Take me there" button, and service_locations.js routing keep working.
 */

const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL       = 'llama-3.3-70b-versatile';   // parity with the local pipeline
const MAX_TOKENS  = 900;                          // room for itemised requirements
const MAX_RETRIES = 2;
const TOP_K       = 6;

const UPSTASH_URL   = (process.env.UPSTASH_VECTOR_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN || '';

// Optional Upstash Redis for live-site analytics logging. If these env vars
// aren't set, logging is silently skipped (the chat still works).
const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const LOG_KEY     = 'wf:querylog';
const LOG_CAP     = 5000;   // keep the most recent N entries

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
  return (d.result || []).map(x => x.metadata || {}).filter(m => m.subservice);
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
    body:    JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: MAX_TOKENS }),
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
function resolveDept(answer, results) {
  const m = answer.match(/Go to:\s*(.+?)\s*$/im);
  const depts = [...new Set(results.map(r => r.department).filter(Boolean))];
  if (m) {
    const name = m[1].trim().replace(/[.*_`]+$/g, '').trim();
    const up = name.toUpperCase();
    const exact = depts.find(d => d.toUpperCase() === up);
    if (exact) return exact;
    const partial = depts.find(d => up.includes(d.toUpperCase()) || d.toUpperCase().includes(up));
    if (partial) return partial;
    return name;   // LLM named a dept not in results — pass through verbatim
  }
  return null;
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

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({
      error: 'Vector store not configured',
      detail: 'Set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN in the Vercel project.',
    });
  }

  const t0 = Date.now();
  const { query, history = [] } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  // 1. Retrieve from Upstash Vector
  let results;
  try {
    results = await upstashQuery(query);
  } catch (err) {
    return res.status(502).json({ error: 'Vector search failed', detail: err.message });
  }
  if (!results.length) {
    await logQuery({ ts: Date.now(), query, department: null, subservice: null,
                     needsContext: false, latency_ms: Date.now() - t0, lang: langTag(query) });
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
  const dept = resolveDept(answer, results);
  const needsContext = !dept &&
    /which|alin|anong serbisyo|could you specify|please clarify|specify/i.test(answer);
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
                   needsContext, latency_ms: Date.now() - t0, lang: langTag(query) });

  return res.status(200).json({
    answer,
    department:   dept || null,
    subservice,
    needsContext,
    options,
    rate_limited: false,
  });
};
