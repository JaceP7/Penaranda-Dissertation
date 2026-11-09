/**
 * lib/manila.js - Asia/Manila time (UTC+8, no daylight saving) for the
 * dashboard. The old code bucketed by UTC, so a question asked before 8 AM in
 * Calamba was counted on the previous day.
 */
'use strict';

const OFFSET_MS = 8 * 60 * 60 * 1000;

/** { date: 'YYYY-MM-DD', hour: 0-23, weekday: 0-6 (0 = Monday) } or null. */
function manilaParts(ts) {
  const t = Number(ts);
  if (ts === null || ts === undefined || ts === '' || !Number.isFinite(t)) return null;
  const d = new Date(t + OFFSET_MS);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    weekday: (d.getUTCDay() + 6) % 7,
  };
}

function manilaDay(ts) {
  const p = manilaParts(ts);
  return p ? p.date : '';
}

function manilaToday(now = Date.now()) {
  return manilaDay(now);
}

/** 'YYYY-MM-DD HH:MM', or '' when the time is unusable. */
function manilaStamp(ts) {
  const t = Number(ts);
  if (ts === null || ts === undefined || !Number.isFinite(t)) return '';
  return new Date(t + OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

module.exports = { OFFSET_MS, manilaParts, manilaDay, manilaToday, manilaStamp };
