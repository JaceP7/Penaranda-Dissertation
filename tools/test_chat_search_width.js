/**
 * test_chat_search_width.js - api/chat.js asks the vector index for a wide
 * candidate list and keeps only the best 6 for the model.
 *
 * The index search is approximate. Asked for only 6 results it skipped the
 * best match: on 2026-11-17 "Saan kukuha ng cedula?" missed the Community Tax
 * Certificate (score 0.792) and the chat said it could not find it, while the
 * same query asked for 20 results ranked it first.
 *
 * Run: node tools/test_chat_search_width.js <repo-root>
 */
'use strict';
const path = require('path');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

process.env.UPSTASH_VECTOR_REST_URL   = 'https://vector.fake';
process.env.UPSTASH_VECTOR_REST_TOKEN = 'vtoken';
process.env.UPSTASH_REDIS_REST_URL    = 'https://redis.fake';
process.env.UPSTASH_REDIS_REST_TOKEN  = 'rtoken';
process.env.GROQ_API_KEY              = 'gtoken';

// 20 candidates, best first, as the index returns them.
const CANDIDATES = Array.from({ length: 20 }, (_, i) => ({
  score: 0.8 - i * 0.005,
  metadata: { service: 'Svc', subservice: 'Service number ' + (i + 1),
              department: 'CITY TREASURY MANAGEMENT OFFICE', requirements: [], steps: [] },
}));

let vectorTopK = null, groqContext = '';
const reply = (body) => ({
  ok: true, status: 200,
  json: async () => body, text: async () => JSON.stringify(body),
  headers: { get: () => null },
});
global.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://vector.fake')) {
    vectorTopK = JSON.parse(opts.body).topK;
    return reply({ result: CANDIDATES.slice(0, vectorTopK) });
  }
  if (url.includes('api.groq.com')) {
    const msgs = JSON.parse(opts.body).messages;
    groqContext = msgs[msgs.length - 1].content;
    return reply({ choices: [{ message: { content: 'Go to: CITY TREASURY MANAGEMENT OFFICE' } }] });
  }
  if (url.startsWith('https://redis.fake')) return reply({ result: 'OK' });
  throw new Error('unexpected fetch ' + url);
};

function mockRes() {
  const r = { code: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

const handler = require(path.resolve(ROOT, 'api/chat.js'));

(async () => {
  console.log('\n--- the index is searched wide, the model sees the best 6 ---');
  const res = mockRes();
  await handler({ method: 'POST', body: { query: 'Saan kukuha ng cedula?' }, headers: {} }, res);
  ok('answers 200', res.code === 200, res.code);
  ok('asks the index for at least 20 candidates', vectorTopK >= 20, vectorTopK);
  const shown = (groqContext.match(/Sub-service: /g) || []).length;
  ok('passes exactly 6 services to the model', shown === 6, shown);
  ok('the 6 are the best-scored ones',
     /Service number 1\n/.test(groqContext) && /Service number 6\n/.test(groqContext) &&
     !/Service number 7\n/.test(groqContext), groqContext.slice(0, 200));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
