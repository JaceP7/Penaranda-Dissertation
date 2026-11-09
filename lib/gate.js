/**
 * lib/gate.js - what every dashboard data request checks first.
 *
 * requireAdmin answers the request itself (503 / 401) and returns false when
 * it may not go on, so a handler starts with:
 *     if (!(await requireAdmin(req, res))) return;
 */
'use strict';
const { sessionConfig, verifySession, readSessionToken } = require('./session');

async function requireAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cfg = sessionConfig();
  if (!cfg.configured) {
    res.status(503).json({ error: 'The dashboard is locked until ADMIN_PIN is set in Vercel.', missing: cfg.missing });
    return false;
  }
  if (!verifySession(readSessionToken(req))) {
    res.status(401).json({ error: 'Enter the staff PIN.' });
    return false;
  }
  return true;
}

function requireJson(req, res) {
  const ct = String((req.headers && req.headers['content-type']) || '').toLowerCase();
  if (ct.startsWith('application/json')) return true;
  res.status(415).json({ error: 'Send JSON.' });
  return false;
}

module.exports = { requireAdmin, requireJson };
