/**
 * api/data.js — the dashboard's Data page: save, remove one question, reset,
 * restore (Jace, 2026-11-09). Staff session only (lib/gate.js); no CORS.
 *
 *   GET  ?view=backup     → both logs in full, health checks included, as a
 *                           download named calamba-analytics-backup-<Manila>.json
 *   GET  ?view=archives   → { current:{questions,navigation}, archives:[...], log:[...] }
 *   POST {action:'remove', id}                  → LREM that one question
 *   POST {action:'reset',  confirm:'RESET'}     → MOVE both logs into an archive
 *   POST {action:'restore', id, confirm:'RESTORE'} → current logs to a new
 *                           archive first, then the chosen archive back to live
 *
 * Nothing is deleted by a reset: RENAME moves the lists (instant, nothing
 * copied). The last 5 archives are kept; a sixth reset deletes the oldest.
 * Keys: wf:archive:<id>:querylog / :navlog, metadata list wf:archives, and the
 * change log wf:data:log (newest 100). The two resets done by hand on
 * 2026-11-09 used the same keys, so they are listed here too.
 */
'use strict';
const crypto = require('crypto');
const { redis, redisConfigured } = require('../lib/redis');
const { requireAdmin, requireJson } = require('../lib/gate');
const { manilaStamp } = require('../lib/manila');

const LIVE = { querylog: 'wf:querylog', navlog: 'wf:navlog' };
const ARCHIVES = 'wf:archives';
const DATA_LOG = 'wf:data:log';
const KEEP = 5;
const BY = 'staff PIN';
const CHUNK = 2500, MAX = 50000;

const rowId = (raw) => crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
const archiveKey = (id, tag) => `wf:archive:${id}:${tag}`;

async function readList(key) {
  const out = [];
  for (let s = 0; s < MAX; s += CHUNK) {
    const part = (await redis(['LRANGE', key, String(s), String(s + CHUNK - 1)])) || [];
    out.push(...part);
    if (part.length < CHUNK) break;
  }
  return out;
}
const parse = (raws) => raws.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);

async function note(action, detail) {
  await redis(['LPUSH', DATA_LOG, JSON.stringify({ action, by: BY, at: Date.now(), detail })]);
  await redis(['LTRIM', DATA_LOG, '0', '99']);
}

/** Move the live logs into a new archive. Returns its metadata (not yet listed). */
async function archiveLive(now) {
  const id = String(now);
  const counts = {};
  for (const [tag, live] of Object.entries(LIVE)) {
    counts[tag] = Number(await redis(['LLEN', live])) || 0;
    if (counts[tag] > 0 && Number(await redis(['EXISTS', live]))) await redis(['RENAME', live, archiveKey(id, tag)]);
  }
  return { id, at: now, by: BY, questions: counts.querylog, navigation: counts.navlog };
}

/** List an archive, keep the newest KEEP, delete the logs of any that fall off. */
async function listArchive(meta) {
  await redis(['LPUSH', ARCHIVES, JSON.stringify(meta)]);
  const dropped = parse((await redis(['LRANGE', ARCHIVES, String(KEEP), '-1'])) || []);
  await redis(['LTRIM', ARCHIVES, '0', String(KEEP - 1)]);
  for (const m of dropped) for (const tag of Object.keys(LIVE)) await redis(['DEL', archiveKey(m.id, tag)]);
}

module.exports = async function handler(req, res) {
  if (!(await requireAdmin(req, res))) return;
  if (!redisConfigured()) return res.status(503).json({ error: 'Analytics storage is not configured.' });
  const q = req.query || {};

  try {
    if (req.method === 'GET' && q.view === 'backup') {
      const now = Date.now();
      const doc = {
        exportedAt: new Date(now).toISOString(), exportedBy: BY,
        note: 'Both logs in full, newest first, health checks included.',
        questions: parse(await readList(LIVE.querylog)),
        navigation: parse(await readList(LIVE.navlog)),
      };
      const stamp = manilaStamp(now).replace(' ', '-').replace(':', '');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="calamba-analytics-backup-${stamp}.json"`);
      return res.status(200).send(JSON.stringify(doc, null, 1));
    }

    if (req.method === 'GET' && q.view === 'archives') {
      return res.status(200).json({
        current: { questions: Number(await redis(['LLEN', LIVE.querylog])) || 0,
                   navigation: Number(await redis(['LLEN', LIVE.navlog])) || 0 },
        archives: parse((await redis(['LRANGE', ARCHIVES, '0', String(KEEP - 1)])) || []),
        log: parse((await redis(['LRANGE', DATA_LOG, '0', '49'])) || []),
      });
    }

    if (req.method === 'GET' && q.view === 'archive' && q.id) {
      const id = String(q.id).replace(/[^0-9]/g, '');
      const doc = { archive: id, questions: parse(await readList(archiveKey(id, 'querylog'))),
                    navigation: parse(await readList(archiveKey(id, 'navlog'))) };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="calamba-analytics-archive-${id}.json"`);
      return res.status(200).send(JSON.stringify(doc, null, 1));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    if (!requireJson(req, res)) return;
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { return res.status(400).json({ error: 'Bad JSON.' }); } }
    b = b || {};

    if (b.action === 'remove') {
      const want = String(b.id || '');
      const raws = await readList(LIVE.querylog);
      const raw = raws.find((s) => rowId(s) === want);
      if (!raw) return res.status(404).json({ error: 'That question is no longer in the log.' });
      await redis(['LREM', LIVE.querylog, '1', raw]);
      let ts = '';
      try { ts = String(JSON.parse(raw).ts || ''); } catch (_) { /* keep blank */ }
      await note('remove', ts);       // the time of the question, never its text
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'reset') {
      if (b.confirm !== 'RESET') return res.status(400).json({ error: 'Type RESET to confirm.' });
      const meta = await archiveLive(Date.now());
      await listArchive(meta);
      await note('reset', `archive ${meta.id}`);
      return res.status(200).json({ ok: true, archive: meta });
    }

    if (b.action === 'restore') {
      if (b.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm.' });
      const id = String(b.id || '');
      const listRaw = (await redis(['LRANGE', ARCHIVES, '0', '-1'])) || [];
      const raw = listRaw.find((s) => { try { return String(JSON.parse(s).id) === id; } catch (_) { return false; } });
      if (!raw) return res.status(404).json({ error: 'No archive with that id.' });
      // 1. save what is live now; 2. bring the archive back; 3. list the save.
      // The chosen archive leaves the list before the new one is added, so the
      // trim can never drop the archive being restored.
      const saved = await archiveLive(Date.now());
      for (const tag of Object.keys(LIVE)) {
        if (Number(await redis(['EXISTS', archiveKey(id, tag)]))) await redis(['RENAME', archiveKey(id, tag), LIVE[tag]]);
      }
      await redis(['LREM', ARCHIVES, '1', raw]);
      await listArchive(saved);
      await note('restore', `archive ${id} (current saved as ${saved.id})`);
      return res.status(200).json({ ok: true, saved });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(502).json({ error: `Storage error: ${e.message}` });
  }
};
