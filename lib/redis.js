/**
 * lib/redis.js - one Upstash Redis REST call. Reads the environment on every
 * call so tests (and a redeploy with new variables) see the current values.
 */
'use strict';

function redisConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** POST one command, e.g. ['LRANGE', key, '0', '9']; returns `.result`. */
async function redis(cmd) {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`Redis ${cmd[0]} ${r.status}`);
  return (await r.json()).result;
}

module.exports = { redisConfigured, redis };
