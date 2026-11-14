/**
 * lib/keys.js - Redis key names, namespaced per deployment.
 *
 * A Vercel preview deployment shares the project's Upstash database with the
 * live site. Setting WF_KEY_PREFIX (e.g. "pv1:") on the Preview environment
 * makes every key it touches live under that prefix, so testing there never
 * reads or overwrites the live map or logs. The env is read on every call.
 */
'use strict';

function key(name) {
  return (process.env.WF_KEY_PREFIX || '') + name;
}

/** A preview with no prefix would write to the live keys: callers must refuse. */
function previewUnisolated() {
  return process.env.VERCEL_ENV === 'preview' && !process.env.WF_KEY_PREFIX;
}

module.exports = { key, previewUnisolated };
