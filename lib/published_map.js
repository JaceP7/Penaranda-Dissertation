/**
 * lib/published_map.js - what the chat needs from the published map.
 *
 * The map an admin published lives in Redis at wf:mapstate. The chat reads
 * only state.removedRequirements (Charter requirements an admin took out of
 * use) so it stops listing them. Read failures never reach the citizen: the
 * answer simply falls back to the full Charter list.
 */
'use strict';

const { key } = require('./keys');
const { redis, redisConfigured } = require('./redis');
const SPOTS = require('../wayfinding-app/js/spots.js');

const TTL_MS = 30000;
const cache = new Map();   // full Redis key -> { at, value }

/** { removedRequirements } from the published map, or null when it cannot be read. */
async function getPublishedMap() {
  let k;
  try {
    k = key('wf:mapstate');
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    let value = null;
    if (redisConfigured()) {
      try {
        const raw = await redis(['GET', k]);
        const doc = raw ? JSON.parse(raw) : null;
        const rr = doc && doc.state && doc.state.removedRequirements;
        if (doc && doc.state && typeof doc.state === 'object') {
          value = { removedRequirements: rr && typeof rr === 'object' && !Array.isArray(rr) ? rr : {} };
        }
      } catch (_) { value = null; }
    }
    cache.set(k, { at: Date.now(), value });
    return value;
  } catch (_) { return null; }
}

function _resetPublishedMapCache() { cache.clear(); }

/** `reqs` (Charter {requirement, where_to_secure} objects) without the removed ones; order untouched. */
function visibleRequirements(removed, subservice, dept, reqs) {
  if (!Array.isArray(reqs) || !removed) return reqs;
  const keep = new Set(SPOTS.requirementsFor(removed, subservice, dept, reqs.map((r) => (r && r.requirement) || '')));
  return reqs.filter((r) => keep.has((r && r.requirement) || ''));
}

module.exports = { getPublishedMap, _resetPublishedMapCache, visibleRequirements };
