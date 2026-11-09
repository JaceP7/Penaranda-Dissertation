/**
 * admin_charts.js - pure builders for the analytics dashboard: each returns an
 * HTML string, none touches the DOM, so all of them are tested in Node
 * (tools/test_admin_charts.js).
 *
 * Every piece of text from the data goes through esc(). Citizens' questions
 * are shown to staff who can publish the map; unescaped text here would be
 * stored XSS with real power.
 *
 * Chart rules (approved design + the dataviz checklist): one blue ramp for
 * magnitude, single-series bars in one colour, no dual axes, status colours
 * only for how routes ended and always with a text label, and every non-empty
 * heatmap cell prints its count so colour is never the only channel. Each bar
 * and cell carries a title (hover) and an aria-label.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtSec = (ms) => (ms == null || !Number.isFinite(Number(ms))) ? '—' : (Number(ms) / 1000).toFixed(1) + ' s';
  const fmtDur = (ms) => {
    if (!ms || !Number.isFinite(Number(ms))) return '—';
    const s = Math.round(Number(ms) / 1000), m = Math.floor(s / 60);
    return m ? `${m}m ${s % 60}s` : `${s}s`;
  };
  const ofText = (a, b) => `${a} of ${b}`;
  const sampleTag = (n) => (Number.isFinite(Number(n)) && Number(n) < 30) ? '<span class="tag-small">Small sample</span>' : '';
  const hourLabel = (h) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /** "CITY SOCIAL SERVICES OFFICE" -> "City Social Services Office". */
  function officeName(s) {
    const t = String(s == null ? '' : s);
    if (/[a-z]/.test(t)) return t;
    const SMALL = ['and', 'of', 'the', 'for', 'with', 'a', 'an', 'in', 'on', 'to', 'at'];
    const KEEP = ['MO', 'PWD', 'SP', 'BPLO', 'PESO', 'POSO', 'OSCA', 'CDRRMD', 'COMELEC'];
    return t.split(' ').map((w, i) => {
      if (KEEP.includes(w)) return w;
      const l = w.toLowerCase();
      if (i > 0 && SMALL.includes(l)) return l;
      return l.replace(/(^|[-'’(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
    }).join(' ');
  }

  function tile({ label, value, sub, n }) {
    return `<div class="tile"><div class="tile-label">${esc(label)}</div>` +
      `<div class="tile-value">${esc(value)}</div>` +
      (sub ? `<div class="tile-sub">${esc(sub)}</div>` : '') +
      (n != null ? sampleTag(n) : '') + '</div>';
  }

  /** Horizontal bars, one colour, name and count printed, scaled to the top. */
  function bars(items, opts) {
    const max = (opts && opts.max) || 10;
    const label = (opts && opts.label) || ((x) => x.name);
    const list = (items || []).filter((x) => x && x.count > 0).slice(0, max);
    if (!list.length) return emptyState('Nothing to show for this range.');
    const top = list[0].count || 1;
    return '<ol class="bars">' + list.map((x) => {
      const name = label(x);
      return `<li title="${esc(name)}: ${x.count}"><span class="bar-name">${esc(name)}</span>` +
        `<span class="bar-track"><span class="bar-fill" style="width:${(x.count / top * 100).toFixed(1)}%"></span></span>` +
        `<span class="bar-count">${x.count}</span></li>`;
    }).join('') + '</ol>';
  }

  /**
   * Hour-by-weekday heatmap. Wide: 7 weekday rows x 24 hour columns. Sideways
   * (phones): 24 hour rows x 7 weekday columns, so each cell can print its
   * count. Office hours, 8 AM to 5 PM (hours 8-16), carry hm-office.
   */
  function heatmap(matrix, opts) {
    const sideways = !!(opts && opts.sideways);
    const m = matrix || [];
    let max = 0;
    m.forEach((row) => (row || []).forEach((n) => { if (n > max) max = n; }));
    const level = (n) => (n > 0 ? Math.min(5, Math.max(1, Math.ceil((n / max) * 5))) : 0);
    const office = (h) => h >= 8 && h <= 16;
    const cell = (w, h) => {
      const n = (m[w] && m[w][h]) || 0;
      const what = `${WEEKDAYS[w]} ${hourLabel(h)}: ${n === 1 ? '1 question' : `${n} questions`}`;
      return `<div class="hm-cell${office(h) ? ' hm-office' : ''} hm-l${level(n)}" aria-label="${what}" title="${what}">${n > 0 ? n : ''}</div>`;
    };
    const hourHead = (h) => `<div class="hm-head${office(h) ? ' hm-office' : ''}">${h % 3 === 0 ? hourLabel(h) : ''}</div>`;
    let html = `<div class="hm ${sideways ? 'hm-grid-tall' : 'hm-grid-wide'}" role="group" aria-label="Questions by weekday and hour, Manila time">`;
    if (!sideways) {
      html += '<div class="hm-corner"></div>';
      for (let h = 0; h < 24; h++) html += hourHead(h);
      for (let w = 0; w < 7; w++) {
        html += `<div class="hm-rowhead">${WEEKDAYS[w]}</div>`;
        for (let h = 0; h < 24; h++) html += cell(w, h);
      }
    } else {
      html += '<div class="hm-corner"></div>';
      for (let w = 0; w < 7; w++) html += `<div class="hm-head">${WEEKDAYS[w]}</div>`;
      for (let h = 0; h < 24; h++) {
        html += `<div class="hm-rowhead${office(h) ? ' hm-office' : ''}">${hourLabel(h)}</div>`;
        for (let w = 0; w < 7; w++) html += cell(w, h);
      }
    }
    return html + '</div><p class="hm-key"><span class="hm-key-band"></span> Office hours, 8 AM to 5 PM (Manila time)</p>';
  }

  /** Answer-time columns in 500 ms bins, up to the last non-empty one. */
  function histogram(bins) {
    const b = (bins || []).filter(Boolean);
    let last = -1;
    b.forEach((x, i) => { if (x.count > 0) last = i; });
    if (last < 0) return emptyState('No answer times in this range yet.');
    const shown = b.slice(0, Math.max(last, 5) + 1);
    const top = Math.max(...shown.map((x) => x.count), 1);
    const num = (ms) => String(ms / 1000);
    const lab = (x) => (x.hi == null ? `${num(x.lo)} s+` : `${num(x.lo)}–${num(x.hi)} s`);
    return '<div class="histo" role="group" aria-label="Questions by answer time">' + shown.map((x, i) =>
      `<div class="histo-col" title="${lab(x)}: ${plural(x.count, 'answer', 'answers')}" aria-label="${lab(x)}: ${plural(x.count, 'answer', 'answers')}">` +
      `<span class="histo-count">${x.count || ''}</span>` +
      `<span class="histo-bar" style="height:${(x.count / top * 100).toFixed(1)}%"></span>` +
      // A label on every fourth bin and the last, so they never collide on a phone.
      `<span class="histo-label">${i % 4 === 0 || i === shown.length - 1 ? lab(x) : ''}</span></div>`).join('') + '</div>';
  }

  /** How routes ended: one stacked bar, status colours, labelled counts. */
  function outcomeBar(o) {
    const parts = [
      ['arrived', 'Arrived', o.arrived || 0],
      ['closed', 'Closed early', o.abandoned || 0],
      ['none', 'No ending recorded', o.noEnding || 0],
    ];
    const total = parts.reduce((s, p) => s + p[2], 0);
    if (!total) return emptyState('No routes in this range yet.');
    return '<div class="outcome" role="img" aria-label="' +
      parts.map((p) => `${p[1]} ${p[2]}`).join(', ') + '">' +
      parts.filter((p) => p[2] > 0).map((p) =>
        `<span class="seg seg-${p[0]}" style="flex-grow:${p[2]}" title="${p[1]} ${p[2]}"></span>`).join('') +
      '</div><ul class="outcome-key">' + parts.map((p) =>
        `<li><span class="key-dot seg-${p[0]}"></span>${p[1]} ${p[2]}</li>`).join('') + '</ul>';
  }

  const takeaway = {
    busiest(s) {
      const b = s && s.busiest;
      return b ? `The busiest slot is ${WEEKDAYS[b.weekday]} ${hourLabel(b.hour)}, with ${plural(b.count, 'question', 'questions')}.`
               : 'No questions in this range yet.';
    },
    speed(l) {
      return l && l.n ? `Half of answers arrived within ${fmtSec(l.median)}; 95% within ${fmtSec(l.p95)}.`
                      : 'No answer times in this range yet.';
    },
    routes(n) {
      if (!n || !n.started) return 'No routes in this range yet.';
      const resolved = (n.arrived || 0) + (n.abandoned || 0);
      if (!resolved) return `None of the ${n.started} routes has an ending yet.`;
      return `${n.arrived} of ${resolved} routes with an ending reached the office.` + (resolved < 30 ? ' Small sample.' : '');
    },
    offices(top) {
      const t = (top || [])[0];
      return t ? `Most questions were about ${esc(officeName(t.name))} (${t.count}).` : 'No offices in this range yet.';
    },
    demand(src) {
      const typed = (src && src.typed) || 0, chip = (src && src.chip) || 0;
      return `${chip} of ${typed + chip} questions were chip taps; ${typed} were typed.`;
    },
  };

  function emptyState(text) {
    return `<p class="empty">${esc(text)} Try a wider range.</p>`;
  }

  root.ADMIN_CHARTS = {
    esc, fmtSec, fmtDur, ofText, sampleTag, hourLabel, WEEKDAYS, officeName,
    tile, bars, heatmap, histogram, outcomeBar, takeaway, emptyState,
  };
})(typeof window !== 'undefined' ? window : globalThis);
