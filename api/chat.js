/**
 * api/chat.js — Vercel serverless function
 * Receives { query, history? } → keyword-retrieves top-5 services → calls Groq
 * Returns { answer, department, subservice, needsContext, options }
 *
 * Model: llama-3.1-8b-instant
 *   • 14,400 req/day  (vs 1,000 for qwen3-32b)
 *   • 131,072 tok/min (vs ~6,000 for qwen3-32b)
 *   • More than sufficient quality for short city-hall service lookups
 *
 * Rate-limit handling: up to 2 automatic retries with short back-off.
 * If still limited, returns a friendly { rate_limited: true } payload so the
 * client can show a human-readable "busy" message instead of a raw error.
 */

const services = require('../wayfinding-app/data/services.json');

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL      = 'llama-3.1-8b-instant';
const MAX_TOKENS = 500;
const MAX_RETRIES = 2;   // up to 3 total attempts

// ── Keyword retrieval ─────────────────────────────────────────────────────────

function search(query, topN = 5) {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (!tokens.length) return { results: services.slice(0, topN), ambiguous: false, options: [] };

  const scored = services.map(entry => {
    const blob = [entry.service, entry.subservice, entry.department, ...entry.steps]
      .join(' ').toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (blob.includes(t) ? 1 : 0), 0);
    return { entry, score };
  });

  const top      = scored.sort((a, b) => b.score - a.score).slice(0, topN);
  const topScore = top[0]?.score ?? 0;
  const tied     = topScore > 0 ? top.filter(x => x.score >= topScore - 1 && x.score > 0) : [];
  const uniqueSubs = new Set(tied.map(x => x.entry.subservice));
  const ambiguous  = uniqueSubs.size > 2;

  return {
    results:   top.map(x => x.entry),
    ambiguous,
    options:   ambiguous ? [...uniqueSubs].slice(0, 6) : [],
  };
}

function buildContext(results) {
  return results.map(r =>
    `Service: ${r.service}\nSub-service: ${r.subservice}\nDepartment: ${r.department}\nSteps:\n${r.steps.join('\n')}`
  ).join('\n\n---\n\n');
}

// ── Groq call with retry on 429 ───────────────────────────────────────────────

async function callGroq(messages, attempt = 0) {
  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: MAX_TOKENS }),
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    // Respect Retry-After if present and short (< 5 s); otherwise use back-off
    const retryAfter = parseFloat(res.headers.get('retry-after') || '0');
    const waitMs     = (retryAfter > 0 && retryAfter < 5)
      ? retryAfter * 1000
      : (attempt + 1) * 1200;   // 1.2 s, then 2.4 s
    await new Promise(r => setTimeout(r, waitMs));
    return callGroq(messages, attempt + 1);
  }

  return res;
}

// ── Handler ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful assistant for Calamba City Hall.
Answer questions about city government services using ONLY the provided context.

Rules:
1. If the query matches MULTIPLE different sub-services, list the options clearly and ask which one they need.
2. Only provide detailed steps once the specific sub-service is clear.
3. When giving steps, always end with "Go to: [EXACT DEPARTMENT NAME]".
4. If the query is unrelated to city services, say you can only help with Calamba City Hall services.
5. Keep answers concise.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { query, history = [] } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  const { results, ambiguous, options } = search(query);
  const context  = buildContext(results);
  const messages = [
    { role: 'system',    content: SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: 'user', content: `Context:\n${context}\n\nUser question: ${query}` },
  ];

  let groqRes;
  try {
    groqRes = await callGroq(messages);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach Groq API', detail: err.message });
  }

  // Still rate-limited after retries → return a friendly payload (not a 5xx)
  if (groqRes.status === 429) {
    return res.status(200).json({
      answer:       'The assistant is momentarily busy. Please wait a few seconds and try again.',
      department:   null,
      subservice:   null,
      needsContext: false,
      options:      [],
      rate_limited: true,
    });
  }

  if (!groqRes.ok) {
    const errBody = await groqRes.text();
    return res.status(502).json({ error: 'Groq API error', detail: errBody });
  }

  const data   = await groqRes.json();
  const raw    = data.choices?.[0]?.message?.content ?? 'No answer returned.';
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const isAskingForContext = ambiguous ||
    /which.*service|which.*permit|could you specify|please clarify|which one/i.test(answer);

  const topMatch = isAskingForContext ? null : (results[0] ?? null);

  return res.status(200).json({
    answer,
    department:   topMatch?.department   ?? null,
    subservice:   topMatch?.subservice   ?? null,
    needsContext: isAskingForContext,
    options:      isAskingForContext ? options : [],
    rate_limited: false,
  });
};
