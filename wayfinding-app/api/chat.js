/**
 * api/chat.js — Vercel serverless function
 * Receives { query } → keyword-retrieves top-3 services → calls Groq Qwen3-32B → returns { answer, department, subservice }
 */

const services = require('../data/services.json');

// Simple keyword scorer: counts how many query tokens appear in the entry text
function search(query, topN = 3) {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (!tokens.length) return services.slice(0, topN);

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

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(x => x.entry);
}

function buildContext(results) {
  return results.map(r =>
    `Service: ${r.service}\nSub-service: ${r.subservice}\nDepartment: ${r.department}\nSteps:\n${r.steps.join('\n')}`
  ).join('\n\n---\n\n');
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  const results = search(query);
  const context = buildContext(results);

  const systemPrompt = `You are a helpful assistant for Calamba City Hall.
Answer the user's question about city government services using the provided context only.
Be concise and direct. Always state the exact department name where the service is processed.
Format your answer clearly: first explain the process briefly, then state "Go to: [DEPARTMENT NAME]".
If the query is not about city services, politely say you can only assist with Calamba City Hall services.`;

  let groqRes;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-qwen3-32b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Context:\n${context}\n\nUser question: ${query}` }
        ],
        temperature: 0.3,
        max_tokens: 400
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
  const answer = data.choices?.[0]?.message?.content ?? 'No answer returned.';

  // Surface top match metadata so the frontend can offer a "Take me there" button
  const topMatch = results[0] ?? null;

  return res.status(200).json({
    answer,
    department: topMatch?.department ?? null,
    subservice: topMatch?.subservice ?? null
  });
};
