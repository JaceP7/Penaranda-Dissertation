/**
 * api/mapstate.js — cloud-published floor map for ALL devices.
 *
 * Lets non-technical admins update / make / edit rooms in the in-app editor
 * and PUBLISH them to every visitor's device without the git bake-and-push
 * flow. Backed by Upstash Redis (same instance as analytics), key `wf:mapstate`.
 *
 *   GET   → public. Returns { version, updatedAt, updatedBy, state } (or
 *           version 0 / state null if nothing has been published yet). Every
 *           device pulls this on load and applies it if newer than what it has.
 *   POST  → admin-only. Requires  Authorization: Bearer <MAP_ADMIN_TOKEN>.
 *           Body { state, updatedBy } → stores a version-bumped document.
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (storage)
 *   MAP_ADMIN_TOKEN                                    (publish password)
 *
 * Fail-closed: if MAP_ADMIN_TOKEN is unset, POST is refused (503) so the
 * shared map can never be overwritten by an unauthenticated request.
 */

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const ADMIN_TOKEN = process.env.MAP_ADMIN_TOKEN || '';
const KEY         = 'wf:mapstate';
const MAX_BYTES   = 4_000_000;   // ~4 MB guard (4 floors of 75×75 + stamps is far smaller)

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
    try {
      const raw = await redis(['GET', KEY]);
      const doc = raw ? JSON.parse(raw) : { version: 0, state: null };
      return res.status(200).json(doc);
    } catch (e) {
      return res.status(200).json({ version: 0, state: null, _note: `read failed: ${e.message}` });
    }
  }

  // ── Publish (admin-only) ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!ADMIN_TOKEN) {
      return res.status(503).json({ error: 'Publishing disabled — set MAP_ADMIN_TOKEN in Vercel.' });
    }
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ error: 'Invalid admin token.' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON body.' }); } }
    if (!body || typeof body.state !== 'object' || body.state === null) {
      return res.status(400).json({ error: 'Missing state object.' });
    }
    if (JSON.stringify(body.state).length > MAX_BYTES) {
      return res.status(413).json({ error: 'State too large.' });
    }

    let cur = { version: 0 };
    try { const raw = await redis(['GET', KEY]); if (raw) cur = JSON.parse(raw); } catch { /* first publish */ }

    const doc = {
      version:   (cur.version || 0) + 1,
      updatedAt: Date.now(),
      updatedBy: String(body.updatedBy || 'admin').slice(0, 60),
      state:     body.state,
    };
    try {
      await redis(['SET', KEY, JSON.stringify(doc)]);
    } catch (e) {
      return res.status(500).json({ error: `write failed: ${e.message}` });
    }
    return res.status(200).json({ ok: true, version: doc.version, updatedAt: doc.updatedAt });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};
