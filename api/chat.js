/**
 * api/chat.js — Vercel serverless function
 * Receives { query, history? } → keyword-retrieves top-5 services → calls Groq Qwen3-32B
 * Returns { answer, department, subservice, needsContext }
 */

const services = require('../wayfinding-app/data/services.json');

// Keyword scorer — returns entries with their scores
function search(query, topN = 5) {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (!tokens.length) return { results: services.slice(0, topN), ambiguous: false };

  const scored = services.map(entry => {
    const blob = [
      entry.service,
      entry.subservice,
      entry.department,
      ...entry.steps
    ].join(' ').toLowerCase();

    const score = tokens.reduce((acc, t) => acc + (blob.includes(t) ? 1 : 0), 0);
    return { entry, score };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  const top    = sorted.slice(0, topN);

  // Ambiguous: multiple results share the same top score AND belong to same service category
  const topScore = top[0]?.score ?? 0;
  const tiedEntries = topScore > 0
    ? top.filter(x => x.score >= topScore - 1 && x.score > 0)
    : [];

  const uniqueSubservices = new Set(tiedEntries.map(x => x.entry.subservice));
  const ambiguous = uniqueSubservices.size > 2;

  return {
    results: top.map(x => x.entry),
    ambiguous,
    options: ambiguous ? [...uniqueSubservices].slice(0, 6) : []
  };
}

function buildContext(results) {
  return results.map(r =>
    `Service: ${r.service}\nSub-service: ${r.subservice}\nDepartment: ${r.department}\nSteps:\n${r.steps.join('\n')}`
  ).join('\n\n---\n\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, history = [] } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  const { results, ambiguous, options } = search(query);
  const context = buildContext(results);

  const systemPrompt = `You are a helpful assistant for Calamba City Hall.
Answer questions about city government services using ONLY the provided context.

Rules:
1. If the user's query matches MULTIPLE different sub-services (e.g. "business permit" could mean new application, renewal, amendment, retirement, etc.), DO NOT guess. Instead, list the available options clearly and ask which one they need.
2. Only provide detailed step-by-step instructions once the specific sub-service is clear from the conversation.
3. When giving steps, always end with "Go to: [EXACT DEPARTMENT NAME]".
4. If the query is unrelated to city services, say you can only help with Calamba City Hall services.
5. Keep answers concise.`;

  // Build conversation messages including history
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),  // keep last 3 exchanges for context
    { role: 'user', content: `Context:\n${context}\n\nUser question: ${query}` }
  ];

  let groqRes;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen/qwen3-32b',
        messages,
        temperature: 0.3,
        max_tokens: 500
      })
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach Groq API', detail: err.message });
  }

  if (!groqRes.ok) {
    const errBody = await groqRes.text();
    return res.status(502).json({ error: 'Groq API error', detail: errBody });
  }

  const data = await groqRes.json();
  const raw    = data.choices?.[0]?.message?.content ?? 'No answer returned.';
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Only surface department/Take me there when answer is specific (not a clarification prompt)
  const isAskingForContext = ambiguous ||
    /which.*service|which.*permit|could you specify|please clarify|which one/i.test(answer);

  const topMatch = isAskingForContext ? null : (results[0] ?? null);

  return res.status(200).json({
    answer,
    department:   topMatch?.department ?? null,
    subservice:   topMatch?.subservice ?? null,
    needsContext: isAskingForContext,
    options:      isAskingForContext ? options : []
  });
};
