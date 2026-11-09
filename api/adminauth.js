/**
 * api/adminauth.js — the staff PIN, server-side.
 *
 * Two jobs:
 *
 * 1. The map editor's PIN prompt (unchanged behaviour). The PIN used to be a
 *    literal in js/app.js; comparing it here keeps it out of the page source.
 *    For the editor this is not a security boundary (the admin/citizen split
 *    is a class on <body>); every write to the shared map goes through
 *    api/mapstate.js, which checks MAP_ADMIN_TOKEN. So for the editor it stays
 *    fail-open: with ADMIN_PIN unset, the old default PIN still works and the
 *    response says configured:false.
 *
 * 2. The analytics dashboard's sign-in (2026-11-09). A correct PIN also sets
 *    the `wf_admin` session cookie (lib/session.js), which the dashboard's data
 *    endpoints require. This part FAILS CLOSED: no cookie is issued while
 *    ADMIN_PIN is unset, because the old default was once in the public source
 *    and the dashboard holds citizens' questions.
 *
 *   GET  /api/adminauth                       → { configured, signedIn }
 *   POST /api/adminauth  { pin }              → { ok, configured } (+ cookie)
 *   POST /api/adminauth  { action:'signout' } → { ok:true }, cookie cleared
 *
 * Brute force: 10 wrong PINs from one address within 15 minutes answer 429
 * until the window ends (Redis key wf:pinfail:<ip>). A 4-digit PIN has only
 * 10,000 values; use a longer one.
 *
 * Env: ADMIN_PIN (set it), SESSION_SECRET (optional; see lib/session.js).
 */
'use strict';
const { redis, redisConfigured } = require('../lib/redis');
const { sessionConfig, signSession, verifySession, readSessionToken,
        setSessionCookie, clearSessionCookie } = require('../lib/session');

const LEGACY_PIN   = '2024';     // pre-existing value, the editor's unconfigured fallback only
const MAX_FAILS    = 10;
const WINDOW_S     = 15 * 60;

/** Comparison that does not short-circuit on the first differing character. */
function sameSecret(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;          // unequal lengths can never reach 0
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    // charCodeAt past the end is NaN; || 0 keeps the XOR well defined
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function clientIp(req) {
  const h = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  const ip = String(h).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  return ip.replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64) || 'unknown';
}

// The limiter never blocks on its own failure: if Redis is down, the PIN
// check still applies, only the counting is skipped.
async function failures(ip) {
  if (!redisConfigured()) return 0;
  try { return Number(await redis(['GET', 'wf:pinfail:' + ip])) || 0; } catch (_) { return 0; }
}
async function recordFailure(ip) {
  if (!redisConfigured()) return;
  try {
    const n = await redis(['INCR', 'wf:pinfail:' + ip]);
    if (Number(n) === 1) await redis(['EXPIRE', 'wf:pinfail:' + ip, String(WINDOW_S)]);
  } catch (_) { /* best effort */ }
}
async function clearFailures(ip) {
  if (!redisConfigured()) return;
  try { await redis(['DEL', 'wf:pinfail:' + ip]); } catch (_) { /* best effort */ }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const cfg = sessionConfig();
  const adminPin = String(process.env.ADMIN_PIN || '').trim();
  const configured = adminPin.length > 0;

  if (req.method === 'GET') {
    return res.status(200).json({
      configured: cfg.configured,
      signedIn: cfg.configured && Boolean(verifySession(readSessionToken(req))),
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON body.' }); }
  }

  if (body && body.action === 'signout') {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  const pin = String((body && body.pin) || '').trim();
  if (!pin) return res.status(400).json({ error: 'Missing pin.' });

  const ip = clientIp(req);
  if ((await failures(ip)) >= MAX_FAILS) {
    return res.status(429).json({ ok: false, configured, error: 'Too many tries. Wait 15 minutes.' });
  }

  const expected = configured ? adminPin : LEGACY_PIN;
  if (!sameSecret(pin, expected)) {
    await recordFailure(ip);
    return res.status(401).json({ ok: false, configured, error: 'Incorrect PIN.' });
  }
  await clearFailures(ip);
  // The dashboard session only for the real, configured PIN.
  if (cfg.configured) setSessionCookie(res, signSession());
  return res.status(200).json({ ok: true, configured, session: cfg.configured });
};
