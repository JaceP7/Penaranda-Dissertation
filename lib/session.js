/**
 * lib/session.js - the signed cookie the analytics dashboard runs on, issued
 * for the staff PIN (plan 2026-11-09-admin-analytics-revamp.md, addendum).
 *
 * Token: base64url(JSON {x: expiry ms}) + '.' + base64url(HMAC-SHA256(key, part 1)).
 * The key is derived from SESSION_SECRET (or, until that is set, the long
 * random UPSTASH_REDIS_REST_TOKEN, which is server-only) together with the
 * current ADMIN_PIN, so changing the PIN ends every session.
 *
 * Fails closed: with no ADMIN_PIN there is no key, nothing verifies, and the
 * gate answers 503. (The old default PIN was once in the public source.)
 */
'use strict';
const crypto = require('crypto');

const SESSION_COOKIE = 'wf_admin';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function _base() {
  const s = String(process.env.SESSION_SECRET || '');
  if (s.length >= 32) return s;
  return String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
}

function sessionConfig() {
  const missing = [];
  if (!String(process.env.ADMIN_PIN || '').trim()) missing.push('ADMIN_PIN');
  if (!_base()) missing.push('SESSION_SECRET');
  return { configured: missing.length === 0, missing };
}

function _key() {
  const pin = String(process.env.ADMIN_PIN || '').trim();
  const base = _base();
  if (!pin || !base) return null;
  return crypto.createHmac('sha256', base).update('wf-admin-session:' + pin).digest();
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function signSession(now = Date.now()) {
  const key = _key();
  if (!key) throw new Error('Sign-in is not configured.');
  const body = b64(JSON.stringify({ x: now + SESSION_TTL_MS }));
  return body + '.' + b64(crypto.createHmac('sha256', key).update(body).digest());
}

/** { exp } for a good, unexpired token; otherwise null. */
function verifySession(token, now = Date.now()) {
  const key = _key();
  if (!key || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = crypto.createHmac('sha256', key).update(parts[0]).digest();
  let got;
  try { got = Buffer.from(parts[1], 'base64url'); } catch (_) { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!data || !Number.isFinite(data.x) || data.x < now) return null;
  return { exp: data.x };
}

function readSessionToken(req) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}

const FLAGS = 'HttpOnly; Secure; SameSite=Lax; Path=/';
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${FLAGS}; Max-Age=${SESSION_TTL_MS / 1000}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${FLAGS}; Max-Age=0`);
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_MS, sessionConfig, signSession, verifySession,
  readSessionToken, setSessionCookie, clearSessionCookie,
};
