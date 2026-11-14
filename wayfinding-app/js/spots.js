/**
 * spots.js - the spot model for office assignment (pure, no DOM, no storage).
 *
 * Why: offices used to be bare stamp placements matched to departments by name
 * (DEPT_STAMP_NAMES). Admins now assign what stands on each spot, so the map
 * state carries `kind`, `dept`, `services`, `otherKey`, `deskBehind` and
 * `confirmedAt` on each placement. This file holds the rules for that model so
 * routing, publishing, the editor and the server chat (which require()s it)
 * all agree. It must stay free of window/document/localStorage.
 *
 * kind: 'office' | 'other' | 'desk' | undefined (undefined = "No office yet").
 */
const SPOTS = (() => {
  'use strict';

  const FIXED_KEYS = {
    "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER": 'public-assistance',
    'COMMISSION ON ELECTIONS': 'comelec',
  };

  const UNNAMED = /^(GF|LG|2F|3F)\s*\d+[a-z]?$/i;
  const DAY_MS = 86400000;

  function isMigrated(state) {
    return !!state && state.schema === 2;
  }

  // Which departments list this stamp name?
  function deptsOwning(name, deptStampNames) {
    return Object.keys(deptStampNames || {}).filter(
      (d) => (deptStampNames[d] || []).includes(name));
  }

  function migrateStamps(placements, deptStampNames, servicesByDept) {
    const checkThese = [];
    const out = (placements || []).map((p) => {
      if (p.kind) return { ...p };
      const owners = deptsOwning(p.name, deptStampNames);
      if (owners.length === 1) {
        const dept = owners[0];
        if (FIXED_KEYS[dept]) {
          return { ...p, kind: 'other', otherKey: FIXED_KEYS[dept] };
        }
        return { ...p, kind: 'office', dept, services: [...((servicesByDept || {})[dept] || [])] };
      }
      if (owners.length > 1) {
        checkThese.push({ id: p.id, name: p.name, reason: 'two offices' });
        return { ...p };
      }
      if (UNNAMED.test(String(p.name || '').trim())) {
        checkThese.push({ id: p.id, name: p.name, reason: 'unnamed' });
        return { ...p };
      }
      return { ...p, kind: 'other', otherKey: null };
    });
    return { placements: out, checkThese };
  }

  function spotAt(placements, floor, row, col) {
    for (const p of placements || []) {
      if (p.floor !== floor) continue;
      const s = p.size || 1;
      if (row >= p.row && row <= p.row + s - 1 && col >= p.col && col <= p.col + s - 1) return p;
    }
    return null;
  }

  function placesFor(placements, dept, subservice) {
    const mine = (placements || []).filter((p) => p.dept === dept);
    const has = (p) => (p.services || []).includes(subservice);
    const behind = mine.filter((p) => p.kind === 'desk' && p.deskBehind && has(p));
    const offices = mine.filter((p) => p.kind === 'office');
    let main;
    if (behind.length) main = behind;
    else {
      const named = offices.filter(has);
      main = named.length ? named : offices;
    }
    const others = mine.filter((p) => p.kind === 'desk' && !p.deskBehind &&
      ((p.services || []).length === 0 || has(p)));
    return [...main, ...others];
  }

  function deskCells(placements, floor) {
    const cells = [];
    for (const p of placements || []) {
      if (p.kind !== 'desk' || p.floor !== floor) continue;
      const s = p.size || 1;
      for (let r = p.row; r < p.row + s; r++)
        for (let c = p.col; c < p.col + s; c++) cells.push(r + ',' + c);
    }
    return cells;
  }

  const centre = (p) => ({ r: p.row + ((p.size || 1) - 1) / 2, c: p.col + ((p.size || 1) - 1) / 2 });

  function frontOf(placements, desk) {
    const d = centre(desk);
    let best = null, bestD = Infinity;
    for (const p of placements || []) {
      if (p.kind !== 'office' || p.floor !== desk.floor) continue;
      const q = centre(p);
      const dist = Math.abs(q.r - d.r) + Math.abs(q.c - d.c);
      if (dist < bestD) { best = p; bestD = dist; }
    }
    return best;
  }

  function unplacedOffices(placements, depts) {
    const placed = new Set();
    for (const p of placements || []) {
      if (p.kind === 'office' || (p.kind === 'desk' && !p.deskBehind)) placed.add(p.dept);
    }
    return (depts || []).filter((d) => !placed.has(d));
  }

  function staleDesks(placements, nowMs, days = 30) {
    return (placements || []).filter((p) => {
      if (p.kind !== 'desk') return false;
      const t = p.confirmedAt ? Date.parse(p.confirmedAt) : NaN;
      if (isNaN(t)) return true;
      return nowMs - t > days * DAY_MS;
    });
  }

  // Equal after: lower case, no leading "2." / "2)" / "2.)", straight and curly
  // apostrophes alike, whitespace collapsed. Reworded text stays different.
  function fold(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
      .replace(/^\s*\d+\s*[.)]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function requirementsFor(removed, subservice, dept, reqs) {
    const gone = ((removed || {})[subservice + '|' + dept] || []).map(fold);
    if (!gone.length) return reqs;
    return (reqs || []).filter((r) => !gone.includes(fold(r)));
  }

  function labelStyle(spot) {
    if (spot.kind === 'office') return { text: spot.dept, look: 'office' };
    if (spot.kind === 'desk') return { text: spot.dept, look: 'desk' };
    if (spot.kind === 'other') return { text: spot.name, look: 'other' };
    return { text: 'No office yet', look: 'empty' };
  }

  return {
    FIXED_KEYS, isMigrated, migrateStamps, spotAt, placesFor, deskCells,
    frontOf, unplacedOffices, staleDesks, requirementsFor, labelStyle,
  };
})();

if (typeof module !== 'undefined') module.exports = SPOTS;
