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

  /**
   * Where a citizen can go for `subservice` of `dept`. The office's own places
   * come first: its desks behind the office ticked for the service (they stand
   * in for the office), else its office spots that list the service, then its
   * other desks. After them, office spots of other offices that list the
   * service (the spot sheet lets an admin add another office's service). Only
   * when no such desk or spot lists it is every office spot of `dept` a place.
   * resolveServiceLocation still picks the nearest of the places returned.
   */
  function placesFor(placements, dept, subservice) {
    const list = placements || [];
    const mine = list.filter((p) => p.dept === dept);
    const has = (p) => (p.services || []).includes(subservice);
    const behind = mine.filter((p) => p.kind === 'desk' && p.deskBehind && has(p));
    const offices = mine.filter((p) => p.kind === 'office');
    const own = behind.length ? behind : offices.filter(has);
    const elsewhere = list.filter((p) => p.kind === 'office' && p.dept !== dept && has(p));
    const main = (own.length || elsewhere.length) ? own : offices;
    const others = mine.filter((p) => p.kind === 'desk' && !p.deskBehind &&
      ((p.services || []).length === 0 || has(p)));
    return [...main, ...others, ...elsewhere];
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

  /**
   * The office spots on `floor` that `desk` would cut off from `entrance`
   * (a list of {row, col}): reachable with the floor's other desks in place,
   * out of reach once this desk is added. Walking follows buildAdjacency in
   * data.js: up, down, left, right over cells that are not walls or desks.
   * An office drawn over wall cells counts as reached when a walkable cell of
   * it, or beside it, is reached. `desk` replaces any placement with its id,
   * so an edited desk is checked where it is now. Returns spot names.
   */
  function blocksWay(nodes, placements, floor, desk, entrance) {
    const cells = new Map();
    for (const n of nodes || []) cells.set(n.row + ',' + n.col, n);
    const others = (placements || []).filter((p) => !desk || p.id !== desk.id);
    const offices = others.filter((p) => p.kind === 'office' && p.floor === floor);
    if (!desk || desk.floor !== floor || !offices.length) return [];
    const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    function reach(blocked) {
      const walk = (r, c) => {
        const n = cells.get(r + ',' + c);
        return !!n && !n.wall && !blocked.has(r + ',' + c);
      };
      const seen = new Set();
      const queue = [];
      const visit = (r, c) => {
        const k = r + ',' + c;
        if (!seen.has(k) && walk(r, c)) { seen.add(k); queue.push([r, c]); }
      };
      for (const e of entrance || []) {
        const n = cells.get(e.row + ',' + e.col);
        if (n && n.wall) for (const [dr, dc] of DIRS) visit(e.row + dr, e.col + dc);   // a door drawn as wall
        else visit(e.row, e.col);
      }
      for (let i = 0; i < queue.length; i++) {
        const [r, c] = queue[i];
        for (const [dr, dc] of DIRS) visit(r + dr, c + dc);
      }
      return seen;
    }

    function reached(seen, p) {
      const s = p.size || 1;
      for (let r = p.row - 1; r <= p.row + s; r++) {
        for (let c = p.col - 1; c <= p.col + s; c++) {
          const inside = r >= p.row && r < p.row + s && c >= p.col && c < p.col + s;
          const edge = (r >= p.row && r < p.row + s) || (c >= p.col && c < p.col + s);   // no corners
          if ((inside || edge) && seen.has(r + ',' + c)) return true;
        }
      }
      return false;
    }

    const before = reach(new Set(deskCells(others, floor)));
    const after = reach(new Set(deskCells([...others, { ...desk, kind: 'desk' }], floor)));
    const names = [];
    for (const p of offices) {
      const name = p.name || p.dept;
      if (reached(before, p) && !reached(after, p) && !names.includes(name)) names.push(name);
    }
    return names;
  }

  function labelStyle(spot) {
    if (spot.kind === 'office') return { text: spot.dept, look: 'office' };
    if (spot.kind === 'desk') return { text: spot.dept, look: 'desk' };
    if (spot.kind === 'other') return { text: spot.name, look: 'other' };
    return { text: 'No office yet', look: 'empty' };
  }

  return {
    FIXED_KEYS, isMigrated, migrateStamps, spotAt, placesFor, deskCells,
    frontOf, unplacedOffices, staleDesks, requirementsFor, labelStyle, blocksWay,
  };
})();

if (typeof module !== 'undefined') module.exports = SPOTS;
