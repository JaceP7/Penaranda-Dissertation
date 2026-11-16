/**
 * test_chat_published_requirements.js - the chat leaves out requirements an
 * admin removed from the published map, on both the chip / named-service path
 * and the model-context path. A missing, broken or unreachable map never
 * changes the answer. Fake fetch only; no real service is called.
 *
 * Run: node tools/test_chat_published_requirements.js <repo-root>
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
delete process.env.WF_KEY_PREFIX;

const REMOVED = '5. Voter’s ID / Voter’s Certificate (Photocopy)';
const DEPT = 'OFFICE FOR THE SENIOR CITIZENS AFFAIRS';
const KEY = 'Senior Citizens ID|' + DEPT;

let mapDoc = null;          // string stored at wf:mapstate, or null
let redisThrows = false;
let calls = [], mapGets = 0, groqBody = null;
const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
global.fetch = async (url, opts) => {
  url = String(url); calls.push(url);
  if (url.startsWith('https://vector.fake')) {
    return reply({ result: [{ metadata: {
      service: 'Certificates, Permits, and IDs', subservice: 'Senior Citizens ID', department: DEPT,
      requirements: [
        { requirement: '1. Accomplished Form', where_to_secure: 'OSCA' },
        { requirement: REMOVED, where_to_secure: 'Kliyente' },
      ], steps: [] } }] });
  }
  if (url.includes('api.groq.com')) {
    groqBody = JSON.parse(opts.body);
    return reply({ choices: [{ message: { content: 'ok\nGo to: ' + DEPT } }] });
  }
  if (url.startsWith('https://redis.fake')) {
    const cmd = JSON.parse(opts.body);
    if (cmd[0] === 'GET' && cmd[1] === 'wf:mapstate') {
      mapGets++;
      if (redisThrows) throw new Error('network down');
      return reply({ result: mapDoc });
    }
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
const PM = require(path.resolve(ROOT, 'lib/published_map.js'));
async function ask(query) {
  calls = []; groqBody = null;
  const res = mockRes();
  await handler({ method: 'POST', body: { query, source: 'chip' }, headers: {} }, res);
  return res;
}
const published = (removed) => JSON.stringify({ version: 3, updatedAt: 1, updatedBy: 'admin',
  state: removed === undefined ? {} : { removedRequirements: removed } });
const fresh = (doc, throws) => { PM._resetPublishedMapCache(); mapDoc = doc; redisThrows = !!throws; mapGets = 0; };

(async () => {
  console.log('\n--- a removed requirement is left out of the chip answer ---');
  fresh(published({ [KEY]: [REMOVED] }));
  let r = await ask('Senior Citizens ID');
  ok('answers 200', r.code === 200, r.code);
  ok('no Voter line', !/Voter/.test(r.body.answer), r.body.answer);
  ok('still lists Accomplished Form', /Accomplished Form/.test(r.body.answer));
  ok('Go to: stays the department', new RegExp('Go to: ' + DEPT + '$').test(r.body.answer));
  ok('other requirements keep their order', /1\. Accomplished Form[\s\S]*2\. 1x1 picture/.test(r.body.answer));

  console.log('\n--- the model context is filtered too ---');
  r = await ask('how do I get a senior id for my lola, what do I bring');
  const ctx = groqBody ? groqBody.messages.map((m) => m.content).join('\n') : '';
  ok('model was called', !!groqBody);
  ok('context has no Voter line', !/Voter/.test(ctx), ctx.slice(0,400));
  ok('context keeps Accomplished Form', /Accomplished Form/.test(ctx));

  console.log('\n--- nothing removed / no removedRequirements ---');
  fresh(published());
  r = await ask('Senior Citizens ID');
  ok('older state without the field: full list', /Voter/.test(r.body.answer));

  console.log('\n--- a broken or unreachable map never changes the answer ---');
  fresh(null, true);
  r = await ask('Senior Citizens ID');
  ok('Redis throws: 200', r.code === 200, r.code);
  ok('Redis throws: full list', /Voter/.test(r.body.answer) && /Accomplished Form/.test(r.body.answer));
  fresh('not json');
  r = await ask('Senior Citizens ID');
  ok('bad JSON: 200', r.code === 200, r.code);
  ok('bad JSON: full list', /Voter/.test(r.body.answer));
  fresh(null);
  r = await ask('Senior Citizens ID');
  ok('missing key: full list', r.code === 200 && /Voter/.test(r.body.answer));

  console.log('\n--- cached for 30 seconds ---');
  fresh(published({ [KEY]: [REMOVED] }));
  await ask('Senior Citizens ID');
  r = await ask('Senior Citizens ID');
  ok('one GET wf:mapstate for two requests', mapGets === 1, mapGets);
  ok('second answer still filtered', !/Voter/.test(r.body.answer));

  console.log('\n--- a preview prefix is read and cached separately ---');
  fresh(published({ [KEY]: [REMOVED] }));
  await PM.getPublishedMap();
  process.env.WF_KEY_PREFIX = 'pv1:';
  const seen = [];
  const inner = global.fetch;
  global.fetch = async (u, o) => { if (String(u).startsWith('https://redis.fake')) seen.push(JSON.parse(o.body)[1]); return inner(u, o); };
  await PM.getPublishedMap();
  global.fetch = inner;
  delete process.env.WF_KEY_PREFIX;
  ok('prefixed key was fetched, not the cached live one', seen.includes('pv1:wf:mapstate'), seen.join(','));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
