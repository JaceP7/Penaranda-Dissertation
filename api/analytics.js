/**
 * api/analytics.js — Vercel serverless analytics for the LIVE website.
 *
 * Reads the query log that api/chat.js writes to Upstash Redis (list
 * `wf:querylog`, each item a JSON entry) and computes the summary the
 * admin.html dashboard renders.
 *
 *   GET /api/analytics                          → all-time summary
 *   GET /api/analytics?from=2026-10-01&to=…     → summary for that date range
 *   GET /api/analytics?format=csv&from=…&to=…   → the raw rows as CSV
 *
 * `from`/`to` are inclusive UTC calendar dates (YYYY-MM-DD). They exist so a
 * study can report figures scoped to its evaluation period rather than to all
 * time, which is what SOP 4.2.4 asks for.
 *
 * Response shape:
 *   { total, today, ambiguityRate, avgLatency,
 *     topDepartments:[{name,count}], topSubservices:[{name,count}],
 *     queriesPerDay:[{date,count}], recentQueries:[{...}],
 *     range:{from,to,applied}, scanned, capped }
 *
 * If Upstash Redis isn't configured, returns zeros with a _note banner so the
 * dashboard renders cleanly instead of erroring.
 */

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const LOG_KEY     = 'wf:querylog';

// The log holds up to LOG_CAP entries (see api/chat.js). Reading them in one
// LRANGE would be a single multi-megabyte response, so page through instead.
const CHUNK    = 2500;
const MAX_SCAN = 50000;     // must be >= LOG_CAP in api/chat.js
const MAX_DAYS = 400;       // guard on the per-day series for a silly date range

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

/** Read the whole log a page at a time. Returns { rows, capped }. */
async function readLog() {
  const rows = [];
  let start = 0;
  let capped = false;
  for (;;) {
    const raw = await redisLRange(LOG_KEY, start, start + CHUNK - 1);
    for (const s of raw) {
      try { rows.push(JSON.parse(s)); } catch { /* skip a corrupt entry */ }
    }
    if (raw.length < CHUNK) break;          // reached the end of the list
    start += CHUNK;
    if (start >= MAX_SCAN) { capped = true; break; }
  }
  return { rows, capped };
}

function topN(counter, n) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** UTC calendar date of an entry, or '' when the timestamp is unusable. */
function dayOf(e) {
  const t = Number(e && e.ts);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD between two dates. */
function dateSpan(from, to) {
  const out = [];
  let cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end && out.length < MAX_DAYS) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

/** RFC-4180-ish escaping: quote when needed, double embedded quotes. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const q      = req.query || {};
  const isCsv  = String(q.format || '').toLowerCase() === 'csv';
  const from   = DATE_RE.test(String(q.from || '')) ? String(q.from) : '';
  const to     = DATE_RE.test(String(q.to   || '')) ? String(q.to)   : '';
  // A reversed range is a typo, not an empty result — swap rather than return 0.
  const lo = from && to && from > to ? to : from;
  const hi = from && to && from > to ? from : to;

  if (!REDIS_URL || !REDIS_TOKEN) {
    if (isCsv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send('error\nLive analytics not configured\n');
    }
    return res.status(200).json({
      ...EMPTY,
      range: { from: lo, to: hi, applied: false },
      _note: 'Live analytics not configured — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.',
    });
  }

  let all, capped;
  try {
    ({ rows: all, capped } = await readLog());
  } catch (err) {
    if (isCsv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send(`error\n${csvCell('Analytics read failed: ' + err.message)}\n`);
    }
    return res.status(200).json({ ...EMPTY, range: { from: lo, to: hi, applied: false },
                                  _note: `Analytics read failed: ${err.message}` });
  }

  // Apply the date window.
  const applied = Boolean(lo || hi);
  const rows = applied
    ? all.filter((e) => {
        const d = dayOf(e);
        if (!d) return false;
        if (lo && d < lo) return false;
        if (hi && d > hi) return false;
        return true;
      })
    : all;

  // ── CSV export ─────────────────────────────────────────────────────────────
  if (isCsv) {
    const header = ['timestamp_utc', 'date', 'query', 'department', 'subservice',
                    'needs_context', 'latency_ms', 'lang'];
    // Oldest first reads naturally in a spreadsheet; the list is LPUSH'd newest-first.
    const body = rows.slice().reverse().map((e) => [
      e.ts ? new Date(e.ts).toISOString() : '',
      dayOf(e),
      e.query || '',
      e.department || '',
      e.subservice || '',
      e.needsContext ? 'yes' : 'no',
      typeof e.latency_ms === 'number' ? e.latency_ms : '',
      e.lang || '',
    ].map(csvCell).join(','));

    const stamp = applied ? `${lo || 'start'}_to_${hi || 'now'}` : 'all-time';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="calamba-queries-${stamp}.csv"`);
    // BOM so Excel opens UTF-8 (Tagalog text) correctly instead of mangling it.
    return res.status(200).send('﻿' + [header.join(','), ...body].join('\r\n') + '\r\n');
  }

  // ── JSON summary ───────────────────────────────────────────────────────────
  if (!rows.length) {
    return res.status(200).json({
      ...EMPTY,
      range: { from: lo, to: hi, applied },
      scanned: all.length,
      capped,
      _note: applied ? 'No queries in the selected date range.' : 'No website queries logged yet.',
    });
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);   // UTC date
  let ambiguous = 0, latencySum = 0, latencyN = 0, todayCount = 0;
  const deptCounter = {}, subCounter = {}, dayCounter = {};

  for (const e of rows) {
    const date = dayOf(e);
    if (date) {
      dayCounter[date] = (dayCounter[date] || 0) + 1;
      if (date === todayStr) todayCount++;
    }
    if (!e.department || e.needsContext) ambiguous++;
    if (typeof e.latency_ms === 'number') { latencySum += e.latency_ms; latencyN++; }
    if (e.department) deptCounter[e.department] = (deptCounter[e.department] || 0) + 1;
    if (e.subservice) subCounter[e.subservice] = (subCounter[e.subservice] || 0) + 1;
  }

  // Per-day series: the chosen window when one is set, else the last 7 days.
  let days;
  if (applied) {
    const seen  = Object.keys(dayCounter).sort();
    const start = lo || seen[0] || todayStr;
    const end   = hi || seen[seen.length - 1] || todayStr;
    days = dateSpan(start, end).map((d) => ({ date: d, count: dayCounter[d] || 0 }));
  } else {
    days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
      days.push({ date: d, count: dayCounter[d] || 0 });
    }
  }

  // recentQueries: newest first (the list is LPUSH'd, so rows[0] is newest).
  // Field names match what admin.html's table reads; `ts` stays for compatibility.
  const recentQueries = rows.slice(0, 20).map((e) => ({
    query:        e.query,
    department:   e.department || null,
    subservice:   e.subservice || null,
    needsContext: !!e.needsContext,
    latency_ms:   typeof e.latency_ms === 'number' ? e.latency_ms : null,
    lang:         e.lang || null,
    timestamp:    e.ts || null,
    ts:           e.ts || null,
  }));

  return res.status(200).json({
    total:          rows.length,
    today:          todayCount,
    ambiguityRate:  Math.round((ambiguous / rows.length) * 1000) / 10,
    avgLatency:     latencyN ? Math.round(latencySum / latencyN) : 0,
    topDepartments: topN(deptCounter, 10),
    topSubservices: topN(subCounter, 10),
    queriesPerDay:  days,
    recentQueries,
    range:   { from: lo, to: hi, applied },
    scanned: all.length,
    capped,
  });
};
