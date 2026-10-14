/**
 * api/navlog.js — navigation telemetry for the LIVE website.
 *
 * The chat log answers "what did people ask". This answers "where did they
 * actually need to go, and did they get there" — which is what SOP 4.2.2
 * (route-completion rate, task-completion time, assisted completions) needs,
 * and what a real service-demand ranking needs. Neither was measurable before:
 * api/chat.js records only the RAG pipeline latency.
 *
 *   POST /api/navlog   { event, sid, department, ... }  → append one event
 *   GET  /api/navlog   ?from=&to=&format=csv            → read them back
 *
 * Events:
 *   nav_start    a route was drawn to a department
 *   nav_arrive   the arrival prompt fired        (carries elapsed_ms)
 *   nav_abandon  the route was closed first      (carries elapsed_ms)
 *   qr_rescan    the user re-anchored mid-route  (a disorientation proxy)
 *   nav_already_here  the user says they found it before the route ended;
 *                     pathLen carries how many cells off the mapped anchor was
 *
 * Privacy (RA 10173): `sid` is a random token held in sessionStorage for the
 * tab's lifetime, used only to pair a start with its arrival. It is not tied
 * to a person, it does not persist across visits, and no IP, user agent or
 * free text is stored. Everything written here is anonymous by construction.
 *
 * This endpoint is writable by any visitor, because the events originate on
 * the citizen's device. It therefore validates hard: unknown event names are
 * refused, strings are clamped, and numbers must be finite and in range. That
 * bounds the damage to junk rows, which the dashboard can still be skewed by
 * — so treat a public deployment's figures as indicative, and prefer the
 * facilitated on-site runs for anything reported in the paper.
 */

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY         = 'wf:navlog';
const CAP         = 50000;
const CHUNK       = 2500;

const EVENTS = new Set(['nav_start', 'nav_arrive', 'nav_abandon', 'qr_rescan',
                        'nav_already_here']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`Redis ${cmd[0]} ${r.status}`);
  return (await r.json()).result;
}

const str = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n));
const int = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function readAll() {
  const rows = [];
  let start = 0;
  for (;;) {
    const raw = (await redis(['LRANGE', KEY, String(start), String(start + CHUNK - 1)])) || [];
    for (const s of raw) { try { rows.push(JSON.parse(s)); } catch { /* skip */ } }
    if (raw.length < CHUNK) break;
    start += CHUNK;
    if (start >= CAP) break;
  }
  return rows;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(200).json({ ok: false, _note: 'Navigation logging not configured.' });
  }

  // ── write ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return res.status(400).json({ error: 'Bad JSON.' }); } }
    if (!b || !EVENTS.has(b.event)) return res.status(400).json({ error: 'Unknown event.' });

    const entry = {
      ts:         Date.now(),
      event:      b.event,
      sid:        str(b.sid, 40),
      department: str(b.department, 120),
      subservice: str(b.subservice, 160),
      fromFloor:  int(b.fromFloor, 0, 9),
      fromRow:    int(b.fromRow, 0, 200),
      fromCol:    int(b.fromCol, 0, 200),
      toFloor:    int(b.toFloor, 0, 9),
      toRow:      int(b.toRow, 0, 200),
      toCol:      int(b.toCol, 0, 200),
      pathLen:    int(b.pathLen, 0, 100000),
      elapsed_ms: int(b.elapsed_ms, 0, 86400000),   // ignore anything over a day
      rescans:    int(b.rescans, 0, 1000),
      synthetic:  b.synthetic === true || undefined, // set by automated checks
    };

    try {
      await redis(['LPUSH', KEY, JSON.stringify(entry)]);
      await redis(['LTRIM', KEY, '0', String(CAP - 1)]);
    } catch (e) {
      return res.status(200).json({ ok: false, _note: `write failed: ${e.message}` });
    }
    return res.status(200).json({ ok: true });
  }

  // ── read ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const q     = req.query || {};
    const isCsv = String(q.format || '').toLowerCase() === 'csv';
    let from = DATE_RE.test(String(q.from || '')) ? String(q.from) : '';
    let to   = DATE_RE.test(String(q.to   || '')) ? String(q.to)   : '';
    if (from && to && from > to) [from, to] = [to, from];
    const keepSynthetic = String(q.synthetic || '') === '1';

    let rows;
    try { rows = await readAll(); }
    catch (e) { return res.status(200).json({ ok: false, _note: `read failed: ${e.message}` }); }

    const day = (e) => (Number.isFinite(Number(e.ts)) ? new Date(e.ts).toISOString().slice(0, 10) : '');
    rows = rows.filter((e) => {
      if (!keepSynthetic && e.synthetic) return false;
      if (!from && !to) return true;
      const d = day(e);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    if (isCsv) {
      const head = ['timestamp_utc', 'date', 'event', 'sid', 'department', 'subservice',
                    'from', 'to', 'path_cells', 'elapsed_ms', 'rescans'];
      const body = rows.slice().reverse().map((e) => [
        e.ts ? new Date(e.ts).toISOString() : '', day(e), e.event, e.sid || '',
        e.department || '', e.subservice || '',
        e.fromFloor != null ? `${e.fromFloor}:${e.fromRow},${e.fromCol}` : '',
        e.toFloor != null ? `${e.toFloor}:${e.toRow},${e.toCol}` : '',
        e.pathLen ?? '', e.elapsed_ms ?? '', e.rescans ?? '',
      ].map(csvCell).join(','));
      const stamp = (from || to) ? `${from || 'start'}_to_${to || 'now'}` : 'all-time';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="calamba-navigation-${stamp}.csv"`);
      return res.status(200).send('﻿' + [head.join(','), ...body].join('\r\n') + '\r\n');
    }

    // ── summary ──────────────────────────────────────────────────────────────
    const starts   = rows.filter((e) => e.event === 'nav_start');
    const arrives  = rows.filter((e) => e.event === 'nav_arrive');
    const abandons = rows.filter((e) => e.event === 'nav_abandon');
    const rescans  = rows.filter((e) => e.event === 'qr_rescan');

    const times = arrives.map((e) => e.elapsed_ms).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const median = times.length
      ? (times.length % 2 ? times[(times.length - 1) / 2]
                          : Math.round((times[times.length / 2 - 1] + times[times.length / 2]) / 2))
      : 0;
    const mean = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;

    // Demand by where people actually went, which does not depend on how they
    // phrased the question the way the chat log's department counts do.
    const dest = {};
    for (const e of starts) if (e.department) dest[e.department] = (dest[e.department] || 0) + 1;
    const topDestinations = Object.entries(dest)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const resolved = arrives.length + abandons.length;
    return res.status(200).json({
      started:   starts.length,
      arrived:   arrives.length,
      abandoned: abandons.length,
      rescans:   rescans.length,
      // Of the routes whose outcome is known. Routes still open, or ended by a
      // closed tab, are in neither bucket and are excluded from the rate.
      arrivalRate: resolved ? Math.round((arrives.length / resolved) * 1000) / 10 : 0,
      resolved,
      medianTimeToArrive: median,
      meanTimeToArrive:   mean,
      topDestinations,
      range: { from, to, applied: Boolean(from || to) },
      total: rows.length,
    });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};
