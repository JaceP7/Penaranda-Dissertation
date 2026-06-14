/**
 * api/analytics.js — Vercel serverless analytics for the LIVE website.
 *
 * Reads the query log that api/chat.js writes to Upstash Redis (list
 * `wf:querylog`, each item a JSON entry) and computes the same summary shape
 * the admin.html dashboard expects:
 *   { total, today, ambiguityRate, avgLatency,
 *     topDepartments:[{name,count}], topSubservices:[{name,count}],
 *     queriesPerDay:[{date,count}], recentQueries:[{query,department,...}] }
 *
 * If Upstash Redis isn't configured, returns zeros with a _note banner so the
 * dashboard renders cleanly instead of erroring.
 */

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const LOG_KEY     = 'wf:querylog';

const EMPTY = {
  total: 0, today: 0, ambiguityRate: 0, avgLatency: 0,
  topDepartments: [], topSubservices: [], queriesPerDay: [], recentQueries: [],
};

async function redisLRange(key, start, stop) {
  const r = await fetch(REDIS_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['LRANGE', key, String(start), String(stop)]),
  });
  if (!r.ok) throw new Error(`Redis LRANGE ${r.status}`);
  const d = await r.json();
  return d.result || [];
}

function topN(counter, n) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(200).json({
      ...EMPTY,
      _note: 'Live analytics not configured — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.',
    });
  }

  let rows;
  try {
    const raw = await redisLRange(LOG_KEY, 0, 4999);
    rows = raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  } catch (err) {
    return res.status(200).json({ ...EMPTY, _note: `Analytics read failed: ${err.message}` });
  }

  if (!rows.length) {
    return res.status(200).json({ ...EMPTY, _note: 'No website queries logged yet.' });
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);   // UTC date
  let ambiguous = 0, latencySum = 0, latencyN = 0, todayCount = 0;
  const deptCounter = {}, subCounter = {}, dayCounter = {};

  for (const e of rows) {
    const date = new Date(e.ts || Date.now()).toISOString().slice(0, 10);
    dayCounter[date] = (dayCounter[date] || 0) + 1;
    if (date === todayStr) todayCount++;
    if (!e.department || e.needsContext) ambiguous++;
    if (typeof e.latency_ms === 'number') { latencySum += e.latency_ms; latencyN++; }
    if (e.department)  deptCounter[e.department] = (deptCounter[e.department] || 0) + 1;
    if (e.subservice)  subCounter[e.subservice] = (subCounter[e.subservice] || 0) + 1;
  }

  // queriesPerDay: last 7 calendar days, oldest→newest
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d, count: dayCounter[d] || 0 });
  }

  // recentQueries: newest first (list is LPUSH'd so rows[0] is newest already)
  const recentQueries = rows.slice(0, 20).map(e => ({
    query: e.query, department: e.department || null,
    subservice: e.subservice || null, ts: e.ts,
  }));

  return res.status(200).json({
    total:         rows.length,
    today:         todayCount,
    ambiguityRate: Math.round((ambiguous / rows.length) * 1000) / 10,
    avgLatency:    latencyN ? Math.round(latencySum / latencyN) : 0,
    topDepartments: topN(deptCounter, 10),
    topSubservices: topN(subCounter, 10),
    queriesPerDay:  days,
    recentQueries,
  });
};
