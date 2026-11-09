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
const { requireAdmin } = require('../lib/gate');
const { manilaParts, manilaDay, manilaToday, manilaStamp } = require('../lib/manila');

// The log holds up to LOG_CAP entries (see api/chat.js). Reading them in one
// LRANGE would be a single multi-megabyte response, so page through instead.
const CHUNK    = 2500;
const MAX_SCAN = 50000;     // must be >= LOG_CAP in api/chat.js
const MAX_DAYS = 400;       // guard on the per-day series for a silly date range

const EMPTY = {
  total: 0, today: 0, ambiguityRate: 0, avgLatency: 0,
  topDepartments: [], topSubservices: [], typedSubservices: [], queriesPerDay: [], recentQueries: [],
  hourWeekday: Array.from({ length: 7 }, () => new Array(24).fill(0)), busiest: null,
  latency: { n: 0, median: 0, p95: 0, histogram: [] }, languages: [], clarification: { count: 0, of: 0 },
  kinds: { service: 0, location: 0, scope: 0, unclear: 0 }, sources: { typed: 0, chip: 0 }, scopeTopics: [],
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
      try {
        const o = JSON.parse(s);
        // The stored line, kept out of JSON output, so a row can be named by
        // its hash (rowId) and removed exactly (api/data.js).
        Object.defineProperty(o, '_raw', { value: s, enumerable: false });
        rows.push(o);
      } catch { /* skip a corrupt entry */ }
    }
    if (raw.length < CHUNK) break;          // reached the end of the list
    start += CHUNK;
    if (start >= MAX_SCAN) { capped = true; break; }
  }
  return { rows, capped };
}

/**
 * A chip tap, not a typed question. New rows say so (source: 'chip'); older
 * ones are recognised by the question being exactly the service name, which is
 * what the most-asked chips send. On 2026-11-09, 121 of 198 questions were
 * chip taps, and ranking the chips from them made the chips feed themselves.
 */
function isChipRow(e) {
  if (e.source === 'chip') return true;
  const n = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return Boolean(e.subservice) && n(e.query) === n(e.subservice);
}

function topN(counter, n) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Manila calendar date of an entry, or '' when the timestamp is unusable.
 *  (UTC until 2026-11-09, which put anything before 8 AM on the day before.) */
function dayOf(e) {
  return manilaDay(e && e.ts);
}

/** Answer times: n, median, nearest-rank p95, and 500 ms bins up to 10 s+. */
function latencySummary(values) {
  const s = values.slice().sort((a, b) => a - b);
  const n = s.length;
  const median = !n ? 0 : (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2));
  const p95 = n ? s[Math.ceil(0.95 * n) - 1] : 0;
  const histogram = [];
  for (let lo = 0; lo < 10000; lo += 500) histogram.push({ lo, hi: lo + 500, count: 0 });
  histogram.push({ lo: 10000, hi: null, count: 0 });
  for (const v of s) histogram[Math.min(20, Math.max(0, Math.floor(v / 500)))].count++;
  return { n, median, p95, histogram };
}

/** First 16 hex characters of the SHA-256 of a row's stored line. */
function rowId(e) {
  return require('crypto').createHash('sha256').update(e._raw || JSON.stringify(e)).digest('hex').slice(0, 16);
}

/**
 * GET /api/analytics?view=questions&page=&size=&q=&office=&lang=&kind=&from=&to=
 * The whole log, newest first, searched and paged here so the dashboard never
 * downloads it all. size 1-200 (default 50); page clamped to the last page.
 */
function questionsView(rows, q, res) {
  const size = Math.min(200, Math.max(1, parseInt(q.size, 10) || 50));
  const needle = String(q.q || '').trim().toLowerCase();
  const office = String(q.office || '');
  const lang = String(q.lang || '');
  const kind = String(q.kind || '');
  const offices = [...new Set(rows.map((e) => e.department).filter(Boolean))].sort();
  const hits = rows.filter((e) =>
    (!needle || String(e.query || '').toLowerCase().includes(needle)) &&
    (!office || e.department === office) &&
    (!lang || e.lang === lang) &&
    (!kind || (e.kind || 'service') === kind));
  const pages = Math.max(1, Math.ceil(hits.length / size));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  const out = hits.slice((page - 1) * size, page * size).map((e) => ({
    id: rowId(e), ts: e.ts || null, query: e.query || '', department: e.department || null,
    subservice: e.subservice || null, needsContext: !!e.needsContext,
    latency_ms: typeof e.latency_ms === 'number' ? e.latency_ms : null,
    lang: e.lang || null, kind: e.kind || 'service', source: isChipRow(e) ? 'chip' : 'typed',
  }));
  return res.status(200).json({ rows: out, total: hits.length, page, pages, size, offices });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 4 – Oct 6, 2026 (Manila time)", or "All time (Manila time)". */
function rangeLabel(lo, hi) {
  const md = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
  const y = (d) => d.slice(0, 4);
  if (!lo && !hi) return 'All time (Manila time)';
  if (lo && !hi) return `From ${md(lo)}, ${y(lo)} (Manila time)`;
  if (!lo && hi) return `Until ${md(hi)}, ${y(hi)} (Manila time)`;
  if (y(lo) === y(hi)) return `${md(lo)} – ${md(hi)}, ${y(hi)} (Manila time)`;
  return `${md(lo)}, ${y(lo)} – ${md(hi)}, ${y(hi)} (Manila time)`;
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

/**
 * GET /api/analytics?view=chips — open. The citizen chat's suggested chips:
 * the five services most asked by TYPED questions (chip taps and health
 * checks left out), names and counts only. Nothing a citizen typed is in it.
 */
async function chipsView(res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(200).json({ chips: [] });
  let rows = [];
  try { ({ rows } = await readLog()); } catch (_) { return res.status(200).json({ chips: [] }); }
  const counter = {};
  for (const e of rows) {
    if (e.synthetic || !e.subservice || isChipRow(e)) continue;
    counter[e.subservice] = (counter[e.subservice] || 0) + 1;
  }
  return res.status(200).json({ chips: topN(counter, 5) });
}

module.exports = async function handler(req, res) {
  const q      = req.query || {};
  if (String(q.view || '') === 'chips') return chipsView(res);
  // Everything else holds citizens' questions: staff session only
  // (lib/gate.js). Until 2026-11-09 this was open to anyone.
  if (!(await requireAdmin(req, res))) return;

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

  // Apply the date window, and drop automated health-check traffic unless it is
  // explicitly asked for. Without this the verify_stack.py probe string becomes
  // the top "citizen" query and any demand ranking measures our own testing.
  const keepSynthetic = String(q.synthetic || '') === '1';
  const applied = Boolean(lo || hi);
  const rows = all.filter((e) => {
    if (!keepSynthetic && e.synthetic) return false;
    if (!applied) return true;
    const d = dayOf(e);
    if (!d) return false;
    if (lo && d < lo) return false;
    if (hi && d > hi) return false;
    return true;
  });
  const syntheticExcluded = keepSynthetic ? 0 : all.filter((e) => e.synthetic).length;

  if (String(q.view || '') === 'questions') return questionsView(rows, q, res);

  // ── CSV export ─────────────────────────────────────────────────────────────
  if (isCsv) {
    const header = ['timestamp_utc', 'timestamp_manila', 'date', 'query', 'department', 'subservice',
                    'needs_context', 'latency_ms', 'lang', 'kind', 'source'];
    // rows is already filtered, so the export matches what the dashboard shows
    // Oldest first reads naturally in a spreadsheet; the list is LPUSH'd newest-first.
    const body = rows.slice().reverse().map((e) => [
      e.ts ? new Date(e.ts).toISOString() : '',
      manilaStamp(e.ts),
      dayOf(e),
      e.query || '',
      e.department || '',
      e.subservice || '',
      e.needsContext ? 'yes' : 'no',
      typeof e.latency_ms === 'number' ? e.latency_ms : '',
      e.lang || '',
      e.kind || 'service',
      isChipRow(e) ? 'chip' : 'typed',
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
      syntheticExcluded,
      capped,
      rangeLabel: rangeLabel(lo, hi),
      _note: applied ? 'No queries in the selected date range.' : 'No website queries logged yet.',
    });
  }

  const now = new Date();
  const todayStr = manilaToday(now.getTime());       // Manila date
  let ambiguous = 0, latencySum = 0, latencyN = 0, todayCount = 0, clarify = 0;
  const deptCounter = {}, subCounter = {}, typedCounter = {}, dayCounter = {};
  const langCounter = {}, topicCounter = {};
  const kinds = { service: 0, location: 0, scope: 0, unclear: 0 };
  const sources = { typed: 0, chip: 0 };
  const hourWeekday = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const latencies = [];

  for (const e of rows) {
    const p = manilaParts(e.ts);
    if (p) {
      dayCounter[p.date] = (dayCounter[p.date] || 0) + 1;
      if (p.date === todayStr) todayCount++;
      hourWeekday[p.weekday][p.hour]++;
    }
    if (!e.department || e.needsContext) ambiguous++;
    if (e.needsContext) clarify++;
    if (typeof e.latency_ms === 'number' && Number.isFinite(e.latency_ms)) {
      latencySum += e.latency_ms; latencyN++; latencies.push(e.latency_ms);
    }
    if (e.department) deptCounter[e.department] = (deptCounter[e.department] || 0) + 1;
    if (e.subservice) subCounter[e.subservice] = (subCounter[e.subservice] || 0) + 1;
    if (e.subservice && !isChipRow(e)) typedCounter[e.subservice] = (typedCounter[e.subservice] || 0) + 1;
    if (e.lang) langCounter[e.lang] = (langCounter[e.lang] || 0) + 1;
    const kind = Object.prototype.hasOwnProperty.call(kinds, e.kind) ? e.kind : 'service';
    kinds[kind]++;
    sources[isChipRow(e) ? 'chip' : 'typed']++;
    if (kind === 'scope' && e.topic) topicCounter[e.topic] = (topicCounter[e.topic] || 0) + 1;
  }

  // The busiest weekday-hour cell, or null when every cell is empty.
  let busiest = null;
  hourWeekday.forEach((row, w) => row.forEach((n, h) => {
    if (n > 0 && (!busiest || n > busiest.count)) busiest = { weekday: w, hour: h, count: n };
  }));

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
      const d = manilaDay(now.getTime() - i * 86400000);
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
    typedSubservices: topN(typedCounter, 10),   // demand from typed questions; the citizen chips use this
    queriesPerDay:  days,
    recentQueries,
    // Revamp figures (2026-11-09), all in Manila time.
    hourWeekday,                                   // [weekday Mon..Sun][hour 0..23]
    busiest,
    latency:      latencySummary(latencies),
    languages:    Object.entries(langCounter).sort((a, b) => b[1] - a[1]).map(([lang, count]) => ({ lang, count })),
    clarification: { count: clarify, of: rows.length },
    kinds,
    sources,
    scopeTopics:  topN(topicCounter, 10),
    rangeLabel:   rangeLabel(lo, hi),
    range:   { from: lo, to: hi, applied },
    scanned: all.length,
    syntheticExcluded,
    capped,
  });
};
