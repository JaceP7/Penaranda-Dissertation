/**
 * api/mapstate.js — cloud-published floor map for ALL devices.
 *
 * Lets non-technical admins update / make / edit rooms in the in-app editor
 * and PUBLISH them to every visitor's device without the git bake-and-push
 * flow. Backed by Upstash Redis (same instance as analytics).
 *
 *   GET  /api/mapstate              → public. Current { version, updatedAt, updatedBy, state }
 *                                     (version 0 / state null if nothing published yet).
 *   GET  /api/mapstate?history=1    → public. { currentVersion, history: [{version, updatedAt,
 *                                     updatedBy, bytes}] } — metadata only, so the admin can
 *                                     see who changed what without downloading every snapshot.
 *   GET  /api/mapstate?version=N    → public. The full archived doc for version N.
 *   POST /api/mapstate              → admin-only. Authorization: Bearer <MAP_ADMIN_TOKEN>.
 *                                     { state, updatedBy, baseVersion }  → publish
 *                                     { rollbackTo: N, updatedBy }       → restore a version
 *
 * Lost-update protection: a publish carries the `baseVersion` the admin loaded.
 * If someone else published in the meantime the write is refused with 409 and the
 * client is told who got there first, rather than silently discarding their work.
 * `force: true` overrides, for the case where the admin has seen the conflict and
 * means to overwrite.
 *
 * Rollback is forward-only: restoring version 3 writes a NEW version carrying v3's
 * state. Nothing is ever destroyed, so a mistaken rollback is itself reversible.
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (storage)
 *   MAP_ADMIN_TOKEN                                    (publish password)
 *
 * Fail-closed: if MAP_ADMIN_TOKEN is unset, POST is refused (503) so the shared
 * map can never be overwritten by an unauthenticated request.
 */

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const ADMIN_TOKEN = process.env.MAP_ADMIN_TOKEN || '';
const KEY         = 'wf:mapstate';
const HIST_KEY    = 'wf:mapstate:hist';
const HIST_KEEP   = 10;          // snapshots retained for rollback
const MAX_BYTES   = 4_000_000;   // ~4 MB guard (4 floors of 75x75 + stamps is far smaller)

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`Redis ${cmd[0]} ${r.status}`);
  const d = await r.json();
  return d.result;
}

async function readCurrent() {
  const raw = await redis(['GET', KEY]);
  return raw ? JSON.parse(raw) : { version: 0, state: null };
}

/** Archived snapshots, newest first. Entries that fail to parse are skipped. */
async function readHistory() {
  const rows = (await redis(['LRANGE', HIST_KEY, 0, HIST_KEEP - 1])) || [];
  return rows.map((r) => { try { return JSON.parse(r); } catch { return null; } })
             .filter(Boolean);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(200).json({
      version: 0, state: null,
      _note: 'Cloud map state not configured — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.',
    });
  }

  // ── Read (public) ──────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const q = req.query || {};

    // Version list for the admin history panel — metadata only, no state blobs.
    if (q.history) {
      try {
        const [cur, hist] = await Promise.all([readCurrent(), readHistory()]);
        const rows = hist.map((d) => ({
          version:   d.version,
          updatedAt: d.updatedAt,
          updatedBy: d.updatedBy,
          bytes:     d.state ? JSON.stringify(d.state).length : 0,
        }));
        return res.status(200).json({ currentVersion: cur.version || 0, history: rows });
      } catch (e) {
        return res.status(200).json({ currentVersion: 0, history: [], _note: `history failed: ${e.message}` });
      }
    }

    // A specific archived version, for preview or restore.
    if (q.version) {
      const want = parseInt(q.version, 10);
      if (!Number.isFinite(want)) return res.status(400).json({ error: 'Bad version.' });
      try {
        const cur = await readCurrent();
        if (cur.version === want) return res.status(200).json(cur);
        const hit = (await readHistory()).find((d) => d.version === want);
        if (!hit) return res.status(404).json({ error: `Version ${want} is no longer retained.` });
        return res.status(200).json(hit);
      } catch (e) {
        return res.status(500).json({ error: `read failed: ${e.message}` });
      }
    }

    try {
      return res.status(200).json(await readCurrent());
    } catch (e) {
      return res.status(200).json({ version: 0, state: null, _note: `read failed: ${e.message}` });
    }
  }

  // ── Publish / rollback (admin-only) ────────────────────────────────────────
  if (req.method === 'POST') {
    if (!ADMIN_TOKEN) {
      return res.status(503).json({ error: 'Publishing disabled — set MAP_ADMIN_TOKEN in Vercel.' });
    }
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ error: 'Invalid admin token.' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON body.' }); }
    }
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Missing body.' });

    const who = String(body.updatedBy || 'admin').slice(0, 60);

    let cur;
    try { cur = await readCurrent(); } catch { cur = { version: 0, state: null }; }

    // -- rollback: republish an archived state as a new version ---------------
    let nextState;
    let note = '';
    if (body.rollbackTo !== undefined) {
      const want = parseInt(body.rollbackTo, 10);
      if (!Number.isFinite(want)) return res.status(400).json({ error: 'Bad rollbackTo.' });
      let src = null;
      if (cur.version === want) src = cur;
      else {
        try { src = (await readHistory()).find((d) => d.version === want) || null; }
        catch (e) { return res.status(500).json({ error: `history read failed: ${e.message}` }); }
      }
      if (!src || !src.state) {
        return res.status(404).json({ error: `Version ${want} is no longer retained.` });
      }
      nextState = src.state;
      note = `rolled back to v${want}`;
    } else {
      // -- normal publish ----------------------------------------------------
      if (typeof body.state !== 'object' || body.state === null) {
        return res.status(400).json({ error: 'Missing state object.' });
      }
      if (JSON.stringify(body.state).length > MAX_BYTES) {
        return res.status(413).json({ error: 'State too large.' });
      }
      // Lost-update guard. Only enforced when the client tells us what it based
      // its edits on, so an older client that omits baseVersion still works.
      if (!body.force && body.baseVersion !== undefined && body.baseVersion !== null) {
        const base = parseInt(body.baseVersion, 10);
        if (Number.isFinite(base) && base !== (cur.version || 0)) {
          return res.status(409).json({
            error: 'Someone else published while you were editing.',
            conflict:       true,
            currentVersion: cur.version || 0,
            yourBase:       base,
            updatedBy:      cur.updatedBy || 'someone',
            updatedAt:      cur.updatedAt || null,
          });
        }
      }
      nextState = body.state;
    }

    const doc = {
      version:   (cur.version || 0) + 1,
      updatedAt: Date.now(),
      updatedBy: who,
      state:     nextState,
    };
    if (note) doc.note = note;

    try {
      // Archive the outgoing version first, so a failed SET cannot lose history.
      if (cur && cur.state) {
        await redis(['LPUSH', HIST_KEY, JSON.stringify(cur)]);
        await redis(['LTRIM', HIST_KEY, 0, HIST_KEEP - 1]);
      }
      await redis(['SET', KEY, JSON.stringify(doc)]);
    } catch (e) {
      return res.status(500).json({ error: `write failed: ${e.message}` });
    }
    return res.status(200).json({
      ok: true, version: doc.version, updatedAt: doc.updatedAt,
      updatedBy: doc.updatedBy, note: doc.note || undefined,
    });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};
