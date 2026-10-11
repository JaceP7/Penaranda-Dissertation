/**
 * api/adminauth.js — server-side check for the staff PIN that opens the editor UI.
 *
 * Why this exists: the PIN used to be a literal in js/app.js, so anyone could read
 * it with View Source. Moving the comparison server-side means the PIN is no longer
 * shipped to the browser.
 *
 * What this is NOT: a security boundary. The admin/citizen split is a client-side
 * class on <body>, so someone determined can still flip it in devtools and see the
 * editor. That buys them nothing on its own — every write to the shared map goes
 * through api/mapstate.js, which verifies MAP_ADMIN_TOKEN server-side and never
 * sends it to the client. This endpoint raises the bar from "read the source" to
 * "open devtools"; the publish token is what actually protects the data.
 *
 * Fail-open, deliberately: if ADMIN_PIN is unset the legacy PIN still works and the
 * response carries configured:false so the UI can show a setup notice. Failing
 * closed would lock the operator out of their own deployment the moment this ships,
 * to protect a gate that is already not a real control. Set ADMIN_PIN in Vercel to
 * turn the notice off.
 *
 * Env:
 *   ADMIN_PIN   staff PIN for opening the editor (optional but recommended)
 */

const ADMIN_PIN  = String(process.env.ADMIN_PIN || '').trim();
const LEGACY_PIN = '2024';   // pre-existing value, kept only as the unconfigured fallback

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON body.' }); }
  }
  const pin = String((body && body.pin) || '').trim();
  if (!pin) return res.status(400).json({ error: 'Missing pin.' });

  const configured = ADMIN_PIN.length > 0;
  const expected   = configured ? ADMIN_PIN : LEGACY_PIN;

  if (!sameSecret(pin, expected)) {
    return res.status(401).json({ ok: false, configured, error: 'Incorrect PIN.' });
  }
  return res.status(200).json({ ok: true, configured });
};
