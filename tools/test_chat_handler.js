/**
 * test_chat_handler.js - api/chat.js: the office-finder short cut, and the
 * guard on the "no Go to: line" fallback, against a fake fetch (no Upstash,
 * Groq or Redis is touched).
 *
 * Before this, every answer without a "Go to:" line was given the top search
 * result as its office, including "I couldn't find that" answers and answers
 * that ask the citizen to choose. Those then showed a "Take me there" button
 * to a guessed office, offered no choice buttons, and logged needsContext
 * false, so the clarification rate read 0% from 2026-09-28.
 *
 * Run: node tools/test_chat_handler.js <repo-root>
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

const RESULTS = [
  { service: 'Permits', subservice: 'Permit for Posting Banners', department: 'CITY ADMINISTRATION OFFICE',
    requirements: [], steps: [] },
  { service: 'Civil Registry', subservice: 'Certified True Copy of Birth Certificate',
    department: 'CITY CIVIL REGISTRY OFFICE', requirements: [], steps: [] },
];

let calls = [];
let groqAnswer = '';
let logged = [];
const reply = (body) => ({
  ok: true, status: 200,
  json: async () => body, text: async () => JSON.stringify(body),
  headers: { get: () => null },
});
global.fetch = async (url, opts) => {
  calls.push(String(url));
  if (String(url).startsWith('https://vector.fake')) {
    return reply({ result: RESULTS.map((m) => ({ metadata: m })) });
  }
  if (String(url).includes('api.groq.com')) {
    return reply({ choices: [{ message: { content: groqAnswer } }] });
  }
  if (String(url).startsWith('https://redis.fake')) {
    const cmd = JSON.parse(opts.body);
    if (cmd[0] === 'LPUSH') logged.push(JSON.parse(cmd[2]));
    return reply({ result: 'OK' });
  }
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
async function ask(query, answer) {
  calls = []; logged = []; groqAnswer = answer || '';
  const res = mockRes();
  await handler({ method: 'POST', body: { query }, headers: {} }, res);
  return res;
}
const searched = () => calls.some((u) => u.startsWith('https://vector.fake') || u.includes('api.groq.com'));

(async () => {
  console.log('\n--- where-is questions skip the search and the model ---');
  let r = await ask('where is BPLO?');
  ok('answers 200', r.code === 200, r.code);
  ok('makes no vector or Groq call', !searched(), calls.join(', '));
  ok('is marked as a location reply', r.body.kind === 'location', r.body.kind);
  ok('routes to the right office',
     r.body.department === 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE', r.body.department);
  ok('carries the office for the client to describe',
     r.body.office && r.body.office.abbr === 'BPLO' &&
     r.body.office.name === 'Business Permits and Tricycle Franchising Office', JSON.stringify(r.body.office));
  ok('has a readable fallback sentence for older cached clients',
     /^BPLO \(Business Permits and Tricycle Franchising Office\)\. Tap Take me there/.test(r.body.answer),
     r.body.answer);
  ok('keeps every field the chat UI reads',
     ['answer', 'department', 'subservice', 'needsContext', 'options', 'rate_limited']
       .every((k) => k in r.body) && r.body.subservice === null && r.body.needsContext === false &&
     Array.isArray(r.body.options) && r.body.options.length === 0 && r.body.rate_limited === false);
  ok('English question, English reply', r.body.lang === 'en', r.body.lang);
  ok('the log entry is marked as a location question',
     logged.length === 1 && logged[0].kind === 'location' && logged[0].lang === 'en' &&
     logged[0].department === 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE' &&
     typeof logged[0].latency_ms === 'number', JSON.stringify(logged));

  r = await ask('nasaan ang PESO?');
  ok('"nasaan ang PESO?" is answered in Filipino', r.body.lang === 'fil', r.body.lang);
  ok('  with the Filipino fallback sentence', /I-tap ang Take me there/.test(r.body.answer), r.body.answer);
  ok('  and logged as fil', logged[0] && logged[0].lang === 'fil');

  console.log('\n--- an abbreviation several offices share ---');
  r = await ask('where is CAO');
  ok('asks which office', r.body.needsContext === true && r.body.department === null,
     JSON.stringify(r.body));
  ok('  with one choice per office', r.body.options.length === 3, r.body.options.length);
  ok('  worded so tapping one comes back here',
     r.body.options.every((o) => /^Where is the .+\?$/.test(o)), r.body.options.join(' | '));
  ok('  and says why', /^CAO can mean more than one office\. Which one do you need\?$/.test(r.body.answer),
     r.body.answer);
  ok('  still without a search', !searched());
  ok('  logged with needsContext and no office',
     logged[0] && logged[0].needsContext === true && logged[0].department === null &&
     logged[0].kind === 'location');
  r = await ask('nasaan ang cao');
  ok('Filipino clash choices', r.body.options.length === 3 &&
     r.body.options.every((o) => /^Nasaan ang .+\?$/.test(o)), r.body.options.join(' | '));
  ok('Filipino clash sentence', /^Higit sa isang office ang tinatawag na CAO\. Alin ang kailangan mo\?$/.test(r.body.answer),
     r.body.answer);

  console.log('\n--- answers without a "Go to:" line ---');
  r = await ask('banner posting at night',
                "I could not find that in the provided details. Please ask at the Information desk.");
  ok('a not-found answer gets no office', r.body.department === null, r.body.department);
  ok('  and is not a clarification', r.body.needsContext === false && r.body.options.length === 0);
  ok('  logged without an office', logged[0] && logged[0].department === null && logged[0].kind === undefined);

  r = await ask('permit', 'There are several permits:\n1. Posting banners\n2. Use of public facilities\n' +
                          'Which one do you need?');
  ok('a "which one" answer gets no office', r.body.department === null, r.body.department);
  ok('  and asks the citizen to choose', r.body.needsContext === true);
  ok('  with the retrieved services as choices', r.body.options.length === 2, r.body.options.join(' | '));
  ok('  logged as a clarification', logged[0] && logged[0].needsContext === true);

  r = await ask('certificate', 'May ilang uri ng certificate:\n1. CAV\n2. Good Moral\nAlin sa mga ito ang gusto mong malaman');
  ok('"Alin sa mga ito..." counts as a clarification, question mark or not',
     r.body.needsContext === true && r.body.department === null, JSON.stringify(r.body));

  r = await ask('banner permit', 'Bring a valid ID and the form, which you can get at the window.\n' +
                                 '1. Valid ID\n2. Request form');
  ok('"which you can get" mid-sentence keeps the top result',
     r.body.department === 'CITY ADMINISTRATION OFFICE' && r.body.needsContext === false, JSON.stringify(r.body));

  r = await ask('banner permit', 'Depending on what kind of event you are holding, bring:\n' +
                                 '1. Valid ID\n2. Request form');
  ok('"what kind of" mid-sentence keeps the top result',
     r.body.department === 'CITY ADMINISTRATION OFFICE' && r.body.needsContext === false, JSON.stringify(r.body));

  r = await ask('banner permit', 'Requirements:\n1. Valid ID\n2. Request form\nMay iba ka pa bang tanong?');
  ok('a closing courtesy question keeps the top result',
     r.body.department === 'CITY ADMINISTRATION OFFICE' && r.body.needsContext === false, JSON.stringify(r.body));

  r = await ask('birth certificate copy', '1. Valid ID\n2. Request form\nGo to: CITY CIVIL REGISTRY OFFICE');
  ok('a Go to: line still decides the office', r.body.department === 'CITY CIVIL REGISTRY OFFICE',
     r.body.department);
  ok('  and the search did run', searched());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
