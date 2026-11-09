/**
 * test_chat_scope.js - feedback and query review of 2026-11-09.
 *
 *   #2 "users still wanted chips on the chat after the initial ones"
 *   #3 chips went through search and the LLM like typed questions; the
 *      hospitalization chip came back as a clarifying question 3 times
 *   #4 "limit the responses to only directing to services. comfort rooms,
 *      canteens, etc. are out of scope. have a short explanation then point
 *      to public help desks"
 *   #5 offices outside the building or not on the map: help desk + nearest exit
 *   #8 what the day's 198 questions taught:
 *      - 61% were chip taps, and the "most asked" chips were ranked from those
 *        taps, so they fed themselves;
 *      - "exit" went to the City College exit clearance, "voter's id" to the
 *        Senior Citizens office, a nonsense word to Veterinary;
 *      - "tupad" and "4P's" found nothing / the wrong office.
 *
 * Text fixtures are generic words or invented sentences, not the logged ones.
 * No Upstash, Groq or Redis is touched (fake fetch).
 *
 * Run: node tools/test_chat_scope.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
function lift(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}

process.env.UPSTASH_VECTOR_REST_URL   = 'https://vector.fake';
process.env.UPSTASH_VECTOR_REST_TOKEN = 'vtoken';
process.env.UPSTASH_REDIS_REST_URL    = 'https://redis.fake';
process.env.UPSTASH_REDIS_REST_TOKEN  = 'rtoken';
process.env.GROQ_API_KEY              = 'gtoken';

const SERVICES = JSON.parse(read('wayfinding-app/data/services.json'));
const MAYORS = SERVICES.find((s) => /Mayor.s Clearance/.test(s.subservice));
let score = 0.8;
const RESULT = () => [{ score, metadata: MAYORS }];
let calls = [], logged = [], groqAnswer = '', LOG = [];
const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
global.fetch = async (url, opts) => {
  calls.push(String(url));
  if (String(url).startsWith('https://vector.fake')) return reply({ result: RESULT() });
  if (String(url).includes('api.groq.com')) return reply({ choices: [{ message: { content: groqAnswer } }] });
  if (String(url).startsWith('https://redis.fake')) {
    const cmd = JSON.parse(opts.body);
    if (cmd[0] === 'LPUSH') logged.push(JSON.parse(cmd[2]));
    if (cmd[0] === 'LRANGE') return reply({ result: LOG.slice(Number(cmd[2]), Number(cmd[3]) + 1).map((e) => JSON.stringify(e)) });
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
async function ask(query, extra) {
  calls = []; logged = []; groqAnswer = extra && extra.answer || `Bring your ID.\nGo to: ${MAYORS.department}`;
  const res = mockRes();
  await handler({ method: 'POST', body: Object.assign({ query }, extra && extra.body), headers: {} }, res);
  return res;
}
const searched = () => calls.some((u) => u.startsWith('https://vector.fake') || u.includes('api.groq.com'));
const usedLLM = () => calls.some((u) => u.includes('api.groq.com'));

(async () => {
  console.log('\n--- #4 out of scope: short explanation, then the help desk ---');
  for (const [q, lang] of [['saan po ba ang CR', 'fil'], ['where is the comfort room', 'en'], ['canteen', 'en'],
                           ['cafeteria', 'en'], ['Landbank', 'en'], ['saan pwede magpa xerox', 'fil']]) {
    const r = await ask(q);
    ok(`"${q}" is a facility question`, r.body.kind === 'scope' && r.body.topic === 'amenity', JSON.stringify([r.body.kind, r.body.topic]));
    ok('  answered without search or the model', !searched(), calls.join(','));
    ok('  points to the Public Assistance Center, with its button', /Public Assistance Center/.test(r.body.answer) &&
       Array.isArray(r.body.actions) && r.body.actions.includes('help') && r.body.department === null, JSON.stringify(r.body));
    ok(`  in ${lang === 'fil' ? 'Filipino' : 'English'}`, r.body.lang === lang, r.body.lang);
    ok('  logged as out of scope', logged.length === 1 && logged[0].kind === 'scope', JSON.stringify(logged));
  }
  for (const q of ['DPWH', 'where is the LTO', 'SSS']) {
    const r = await ask(q);
    ok(`"${q}" is another agency, not City Hall`, r.body.kind === 'scope' && r.body.topic === 'agency' && r.body.actions.includes('help'), JSON.stringify(r.body));
  }
  // COMELEC has an office in the building (LG 19, door reads "Commission on
  // Elections"; SERVICE_AREA_MAPPING_REVIEW.md), so it gets directions.
  for (const q of ['where po ang comelec office', 'voters id po']) {
    const r = await ask(q);
    ok(`"${q}" is directed to the COMELEC office`, r.body.kind === 'location' && r.body.department === 'COMMISSION ON ELECTIONS', JSON.stringify([r.body.kind, r.body.department]));
  }
  let r = await ask('sino po ang mayor ngayon');
  ok('"sino po ang mayor ngayon" is about a person', r.body.kind === 'scope' && r.body.topic === 'person', JSON.stringify(r.body));
  r = await ask('What can this ai chat help me with?');
  ok('a question about the assistant gets a description', r.body.kind === 'scope' && r.body.topic === 'meta' && /requirements/i.test(r.body.answer), JSON.stringify(r.body));
  r = await ask('salamat po');
  ok('thanks get a short reply', r.body.kind === 'scope' && r.body.topic === 'smalltalk' && !searched(), JSON.stringify(r.body));
  for (const q of ['saan po ang exit', 'exit po ng munisipyo', 'where is the nearest exit']) {
    r = await ask(q);
    ok(`"${q}" offers the nearest exit`, r.body.kind === 'scope' && r.body.topic === 'exit' && r.body.actions.includes('exit'), JSON.stringify(r.body));
  }
  console.log('  (services that merely mention those words still reach the search)');
  for (const q of ['Exit clearance', 'do I need a photocopy of my ID for cedula', "How do I get a Mayor's Clearance?",
                   'Certificate of BIR tax exemption', 'philhealth']) {
    r = await ask(q);
    ok(`"${q}" is a service question`, r.body.kind !== 'scope' && searched(), JSON.stringify([r.body.kind, r.body.topic]));
  }

  console.log('\n--- learned: a weak match is not an answer ---');
  score = 0.6;
  r = await ask('zzqxv');
  ok('a top match under 0.625 asks the citizen to rephrase', r.body.kind === 'unclear' && r.body.department === null && !usedLLM(), JSON.stringify(r.body));
  ok('  with the help desk offered', r.body.actions && r.body.actions.includes('help'));
  ok('  logged as unclear', logged.length === 1 && logged[0].kind === 'unclear');
  score = 0.63;
  r = await ask('womens desk');
  ok('a short real question at 0.63 still goes through', r.body.kind !== 'unclear' && usedLLM());
  score = 0.8;

  console.log('\n--- learned: office names people used ---');
  r = await ask('saan po ang tupad office');
  ok('TUPAD is found at PESO', r.body.kind === 'location' && /EMPLOYMENT/.test(r.body.department), JSON.stringify([r.body.kind, r.body.department]));
  r = await ask("where can I find the 4P's office");
  ok("4P's is found at Social Services", r.body.kind === 'location' && r.body.department === 'CITY SOCIAL SERVICES OFFICE', JSON.stringify([r.body.kind, r.body.department]));

  console.log('\n--- #3 chips answer straight from the Charter ---');
  r = await ask(MAYORS.subservice, { body: { source: 'chip' } });
  ok('a chip with a service name makes no search or model call', !searched(), calls.join(','));
  ok('  answers with the requirements and "Go to:"', new RegExp('Go to: ' + MAYORS.department).test(r.body.answer) &&
     /Requirements/.test(r.body.answer), r.body.answer);
  ok('  routes to its office', r.body.department === MAYORS.department && r.body.subservice === MAYORS.subservice);
  ok('  logged as a chip', logged.length === 1 && logged[0].source === 'chip' && logged[0].kind === 'service', JSON.stringify(logged));
  ok('  never comes back as a clarifying question', r.body.needsContext === false);
  r = await ask('How do I get a certified copy of my birth certificate?', { body: { source: 'chip' } });
  ok('a chip worded as a question still goes through the search, logged as a chip',
     searched() && logged.length === 1 && logged[0].source === 'chip', JSON.stringify(logged));
  r = await ask(MAYORS.subservice);
  ok('the same words typed (no chip) go through the search as before', searched() && !logged[0].source);

  console.log('\n--- #2 chips after the first answer ---');
  r = await ask(MAYORS.subservice, { body: { source: 'chip' } });
  ok('a service answer carries related services from the same office',
     Array.isArray(r.body.related) && r.body.related.length > 0 && r.body.related.length <= 3 &&
     !r.body.related.includes(MAYORS.subservice), JSON.stringify(r.body.related));
  const chat = read('wayfinding-app/js/chat.js');
  const ctx = {}; vm.createContext(ctx);
  const fsrc = lift(chat, '_followupChips');
  ok('chat.js has _followupChips(lastBot, starters)', !!fsrc);
  if (fsrc) {
    vm.runInContext(fsrc, ctx);
    const starters = [{ label: 'A', query: 'qa' }, { label: 'B', query: 'qb' }, { label: 'C', query: 'qc' }, { label: 'D', query: 'qd' }];
    const out = ctx._followupChips({ subservice: 'X', related: ['R1', 'R2', 'qa'] }, starters);
    ok('  related services come first', out[0].query === 'R1' && out[1].query === 'R2', JSON.stringify(out));
    ok('  then the top chips, without repeats, at most 5', out.length === 5 && out.filter((c) => c.query === 'qa').length === 1, JSON.stringify(out));
    ok('  with no related services, the top chips', ctx._followupChips(null, starters).length === 4);
  }
  ok('chips stay on screen after the first message', /chat-followups/.test(chat) && /_followupChips\(/.test(chat));
  ok('a chip tap is sent with source: chip', /source:\s*'chip'/.test(chat));

  console.log('\n--- #5 outside or unmapped offices in the chat ---');
  const psrc = lift(chat, '_placeActions');
  ok('chat.js has _placeActions(dept)', !!psrc);
  if (psrc) {
    const c2 = { serviceLocationStatus: (d) => ({ A: 'mapped', B: 'outside', C: 'unmapped' })[d] };
    vm.createContext(c2); vm.runInContext(psrc, c2);
    ok('  a mapped office gets "Take me there"', c2._placeActions('A').go === true);
    ok('  an outside office gets the help desk and the nearest exit, no route',
       c2._placeActions('B').go === false && c2._placeActions('B').actions.join() === 'help,exit' && /isn't inside City Hall/.test(c2._placeActions('B').note));
    ok('  an unmapped office too, saying it may be outside',
       c2._placeActions('C').go === false && /may be outside City Hall/.test(c2._placeActions('C').note));
  }
  ok('the Nearest exit button calls navigateToNearestExit', /navigateToNearestExit\(\)/.test(chat));

  console.log('\n--- #8 the chips are ranked from typed questions ---');
  LOG = [
    { ts: 5, query: 'Tapped Service', department: 'D1', subservice: 'Tapped Service', source: 'chip' },
    { ts: 4, query: 'Tapped Service', department: 'D1', subservice: 'Tapped Service' },
    { ts: 3, query: 'Tapped Service', department: 'D1', subservice: 'Tapped Service' },
    { ts: 2, query: 'how do i get a cedula', department: 'D2', subservice: 'Cedula Service' },
    { ts: 1, query: 'cedula po', department: 'D2', subservice: 'Cedula Service' },
  ];
  const P = path.resolve(ROOT, 'api/analytics.js');
  delete require.cache[P];
  const res = mockRes();
  await require(P)({ method: 'GET', query: {}, headers: {} }, res);
  const typed = res.body.typedSubservices || [];
  ok('typedSubservices leaves out chip taps, old and new', typed.length === 1 && typed[0].name === 'Cedula Service' && typed[0].count === 2,
     JSON.stringify(typed));
  ok('topSubservices still counts everything for the dashboard', (res.body.topSubservices || [])[0].name === 'Tapped Service');
  ok('the citizen chips use typedSubservices', /typedSubservices/.test(chat));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
