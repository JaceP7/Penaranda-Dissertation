/**
 * admin_pages.js - the dashboard pages: Overview, Questions, Hot times, Speed,
 * Routes and Data. Each page has a pure render function (data -> HTML string,
 * tested in Node by tools/test_admin_pages.js) and a mount function that
 * fetches its data and wires its buttons.
 *
 * Text from the data always goes through C.esc() (or C.officeName then esc).
 * The test rejects any template that interpolates a text field without it.
 */
(function (root) {
  'use strict';
  const C = root.ADMIN_CHARTS;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "Nov 9, 10:30 AM", Manila time. */
  function when(ts) {
    const t = Number(ts);
    if (!Number.isFinite(t) || !t) return '—';
    const d = new Date(t + 8 * 3600e3);
    const h = d.getUTCHours(), mm = String(d.getUTCMinutes()).padStart(2, '0');
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hh}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const KIND = { service: 'Service answer', location: 'Where-is answer', scope: 'Out of scope', unclear: "Didn't understand" };
  const TOPIC = { amenity: 'Facilities (CR, canteen, bank)', agency: 'Other agencies', person: 'Officials',
                  exit: 'The way out', meta: 'About the assistant', smalltalk: 'Greetings and thanks' };
  const LANG = { en: 'English', fil: 'Filipino' };
  const panel = (title, body, wide) =>
    `<section class="panel${wide ? ' panel-wide' : ''}"><h2>${C.esc(title)}</h2>${body}</section>`;
  const takeaway = (text) => `<p class="takeaway">${text}</p>`;   // callers pass escaped text

  // ── Overview ──────────────────────────────────────────────────────────────
  function renderOverview(s, nav, sideways) {
    s = s || {}; nav = nav || {};
    const lat = s.latency || { n: 0 };
    const resolved = (nav.arrived || 0) + (nav.abandoned || 0);
    const src = s.sources || { typed: 0, chip: 0 };
    const b = s.busiest;
    const tiles = [
      C.tile({ label: 'Questions asked', value: String(s.total || 0), sub: `${src.typed} typed, ${src.chip} chip taps` }),
      C.tile({ label: 'Median answer time', value: lat.n ? C.fmtSec(lat.median) : '—', sub: lat.n ? `95% within ${C.fmtSec(lat.p95)}` : 'no answers yet', n: lat.n }),
      C.tile({ label: 'Routes that arrived', value: resolved ? C.ofText(nav.arrived || 0, resolved) : '—', sub: 'with an ending', n: resolved }),
      C.tile({ label: 'Median time to arrive', value: C.fmtDur(nav.medianTimeToArrive), sub: `from ${nav.arrivalTimesN || 0} arrivals`, n: nav.arrivalTimesN || 0 }),
      C.tile({ label: 'Busiest time', value: b ? `${C.WEEKDAYS[b.weekday]} ${C.hourLabel(b.hour)}` : '—', sub: b ? `${b.count} questions` : 'no questions yet' }),
    ].join('');
    const recent = (s.recentQueries || []).slice(0, 8);
    const recentHtml = recent.length ? '<table class="qtable"><thead><tr><th>Time</th><th>Question</th><th>Office</th><th>Answer time</th></tr></thead><tbody>' +
      recent.map((r) => `<tr><td class="q-time">${when(r.ts || r.timestamp)}</td><td class="q-text">${C.esc(r.query)}</td>` +
        `<td class="q-office">${C.esc(C.officeName(r.department || '—'))}</td><td class="q-ms">${C.fmtSec(r.latency_ms)}</td></tr>`).join('') +
      '</tbody></table>' : C.emptyState('No questions in this range.');
    return `<div class="tiles">${tiles}</div><div class="panels">` +
      panel('Hot times', takeaway(C.takeaway.busiest(s)) + C.heatmap(s.hourWeekday, { sideways: !!sideways }), true) +
      panel('Top offices', takeaway(C.takeaway.offices(s.topDepartments)) + C.bars(s.topDepartments, { label: (x) => C.officeName(x.name) })) +
      panel('Recent questions', recentHtml, true) +
      panel('Answer times', takeaway(C.takeaway.speed(lat)) + C.histogram(lat.histogram)) +
      '</div>';
  }

  // ── Questions ─────────────────────────────────────────────────────────────
  function questionsQuery(range, f) {
    const parts = ['view=questions'];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`); };
    add('from', range && range.from); add('to', range && range.to);
    add('q', f.q); add('office', f.office); add('lang', f.lang); add('kind', f.kind);
    add('page', f.page || 1); add('size', f.size || 50);
    return parts.join('&');
  }

  function renderQuestionsSummary(s) {
    s = s || {};
    const cl = s.clarification || { count: 0, of: 0 };
    const kinds = s.kinds || {};
    const kindItems = Object.keys(KIND).map((k) => ({ label: KIND[k], count: kinds[k] || 0 }));
    const langItems = (s.languages || []).map((x) => ({ label: LANG[x.lang] || x.lang, count: x.count }));
    const topicItems = (s.scopeTopics || []).map((x) => ({ label: TOPIC[x.name] || x.name, count: x.count }));
    const lab = (x) => x.label;
    return '<div class="panels">' +
      panel('Typed or chip', takeaway(C.esc(C.takeaway.demand(s.sources))) +
        `<p class="figure">Asked to clarify: <strong>${C.ofText(cl.count, cl.of)}</strong> ${C.sampleTag(cl.of)}</p>`) +
      panel('How questions were answered', C.bars(kindItems, { label: lab })) +
      panel('Top services', C.bars(s.topSubservices, { max: 8 })) +
      panel('Top offices', C.bars(s.topDepartments, { max: 8, label: (x) => C.officeName(x.name) })) +
      panel('Languages', C.bars(langItems, { label: lab })) +
      panel('Out of scope', topicItems.length ? C.bars(topicItems, { label: lab }) : C.emptyState('No out-of-scope questions.')) +
      '</div>';
  }

  function renderQuestionRows(rows) {
    if (!rows || !rows.length) return C.emptyState('No questions match.');
    return '<table class="qtable qtable-full"><thead><tr><th>Time</th><th>Question</th><th>Office</th><th>Service</th>' +
      '<th>Answer time</th><th>Language</th><th>Notes</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>' +
      rows.map((r) => {
        const tags = [];
        if (r.needsContext) tags.push('<span class="tag">Asked to clarify</span>');
        if (r.kind && r.kind !== 'service') tags.push(`<span class="tag">${C.esc(KIND[r.kind] || r.kind)}</span>`);
        if (r.source === 'chip') tags.push('<span class="tag">Chip</span>');
        const langLabel = LANG[r.lang] || r.lang || '—';
        return `<tr><td class="q-time">${when(r.ts)}</td><td class="q-text">${C.esc(r.query)}</td>` +
          `<td class="q-office">${C.esc(C.officeName(r.department || '—'))}</td><td class="q-service">${C.esc(r.subservice || '—')}</td>` +
          `<td class="q-ms">${C.fmtSec(r.latency_ms)}</td><td class="q-lang">${C.esc(langLabel)}</td><td class="q-tags">${tags.join(' ')}</td>` +
          `<td class="q-act"><button class="btn-quiet" data-remove="${C.esc(r.id)}" aria-label="Remove this question">Remove</button></td></tr>`;
      }).join('') + '</tbody></table>';
  }

  function renderRemoveDialog(row) {
    return `<p>Remove this question from the log?</p><blockquote class="quote">${C.esc(row.query)}</blockquote>` +
      `<p class="muted">Asked ${when(row.ts)} (Manila time). Only this row is removed. The change log keeps its time, not its text.</p>`;
  }

  // ── Hot times, Speed, Routes ──────────────────────────────────────────────
  function renderHotTimes(s, sideways) {
    s = s || {};
    const slots = [];
    (s.hourWeekday || []).forEach((row, w) => (row || []).forEach((n, h) => { if (n > 0) slots.push({ w, h, n }); }));
    slots.sort((a, b) => b.n - a.n);
    const ranked = slots.slice(0, 10).map((x) => ({ name: `${C.WEEKDAYS[x.w]} ${C.hourLabel(x.h)}`, count: x.n }));
    const days = (s.queriesPerDay || []).map((d) => ({ name: d.date, count: d.count }));
    return '<div class="panels">' +
      panel('Questions by weekday and hour', takeaway(C.takeaway.busiest(s)) + C.heatmap(s.hourWeekday, { sideways: !!sideways }), true) +
      panel('Busiest slots', ranked.length ? C.bars(ranked) : C.emptyState('No questions in this range.')) +
      panel('Questions per day', days.some((d) => d.count) ? C.bars(days, { max: 31 }) : C.emptyState('No questions in this range.')) +
      '</div>';
  }

  function renderSpeed(s, nav) {
    const lat = (s && s.latency) || { n: 0 };
    nav = nav || {};
    const n = nav.arrivalTimesN || 0;
    return '<div class="tiles tiles-3">' +
      C.tile({ label: 'Median answer time', value: lat.n ? C.fmtSec(lat.median) : '—', sub: `from ${lat.n || 0} answers`, n: lat.n || 0 }) +
      C.tile({ label: '95% of answers within', value: lat.n ? C.fmtSec(lat.p95) : '—', sub: `from ${lat.n || 0} answers`, n: lat.n || 0 }) +
      C.tile({ label: 'Time to arrive', value: n ? `${C.fmtDur(nav.medianTimeToArrive)} median` : '—', sub: n ? `${C.fmtDur(nav.meanTimeToArrive)} mean, from ${n} arrivals` : 'no arrivals yet', n }) +
      '</div><div class="panels">' + panel('Answer times', takeaway(C.takeaway.speed(lat)) + C.histogram(lat.histogram), true) + '</div>';
  }

  function renderRoutes(nav) {
    nav = nav || {};
    return '<div class="tiles tiles-3">' +
      C.tile({ label: 'Routes started', value: String(nav.started || 0) }) +
      C.tile({ label: 'Re-scans', value: String(nav.rescans || 0), sub: 'QR scanned again mid-route' }) +
      C.tile({ label: 'Said "I\'m already here"', value: String(nav.alreadyHere || 0) }) +
      '</div><div class="panels">' +
      panel('How routes ended', takeaway(C.takeaway.routes(nav)) + C.outcomeBar(nav), true) +
      panel('Top destinations', C.bars(nav.topDestinations, { label: (x) => C.officeName(x.name) }), true) +
      '</div>';
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  function renderData(doc) {
    doc = doc || {};
    const cur = doc.current || { questions: 0, navigation: 0 };
    const arch = doc.archives || [];
    const log = doc.log || [];
    const ACTION = { reset: 'Reset', remove: 'Removed one question', restore: 'Restored' };
    return '<div class="panels">' +
      panel('Save a copy', `<p>Both logs in full (${cur.questions} questions, ${cur.navigation} route events), health checks included, as one JSON file.</p>` +
        '<a class="btn" href="/api/data?view=backup" download>Download backup</a>') +
      panel('Reset analytics', `<p>Now: <strong>${cur.questions} questions, ${cur.navigation} route events</strong>.</p>` +
        '<p>Reset moves both logs into an archive; nothing is deleted. The last 5 resets are kept, and a sixth removes the oldest. A backup downloads first.</p>' +
        '<button class="btn btn-danger" id="dataResetBtn">Reset analytics</button>') +
      panel('Earlier resets', arch.length ? '<ul class="archives">' + arch.map((a) =>
        `<li><div><strong>${when(a.at)}</strong> <span class="muted">by ${C.esc(a.by || '—')}</span><br>` +
        `${Number(a.questions) || 0} questions, ${Number(a.navigation) || 0} route events</div><div class="row-actions">` +
        `<a class="btn btn-quiet" href="/api/data?view=archive&amp;id=${encodeURIComponent(a.id)}" download>Download</a>` +
        `<button class="btn btn-quiet" data-restore="${C.esc(a.id)}">Restore</button></div></li>`).join('') + '</ul>'
        : '<p class="muted">No resets yet.</p>', true) +
      panel('Changes', log.length ? '<ul class="changes">' + log.slice(0, 20).map((e) =>
        `<li>${when(e.at)}: ${C.esc(ACTION[e.action] || e.action)} <span class="muted">(${C.esc(e.by || '—')})</span></li>`).join('') + '</ul>'
        : '<p class="muted">No changes yet.</p>', true) +
      '</div>';
  }

  const resetAllowed = (typed, backedUp) => typed === 'RESET' && backedUp === true;

  /** Reset dialog: the backup downloads before the RESET box can be used. */
  async function startReset(ctx, ui) {
    await ctx.download('/api/data?view=backup');
    ui.enableInput();
  }

  // ── Mounting (browser only) ───────────────────────────────────────────────
  const narrow = () => root.matchMedia && root.matchMedia('(max-width: 639px)').matches;

  async function overview(el, ctx) {
    const [s, nav] = await Promise.all([ctx.fetchJson('/api/analytics?' + ctx.rangeQS), ctx.fetchJson('/api/navlog?' + ctx.rangeQS)]);
    el.innerHTML = renderOverview(s, nav, narrow());
  }
  async function hottimes(el, ctx) {
    el.innerHTML = renderHotTimes(await ctx.fetchJson('/api/analytics?' + ctx.rangeQS), narrow());
  }
  async function speed(el, ctx) {
    const [s, nav] = await Promise.all([ctx.fetchJson('/api/analytics?' + ctx.rangeQS), ctx.fetchJson('/api/navlog?' + ctx.rangeQS)]);
    el.innerHTML = renderSpeed(s, nav);
  }
  async function routes(el, ctx) {
    el.innerHTML = renderRoutes(await ctx.fetchJson('/api/navlog?' + ctx.rangeQS));
  }

  const qFilters = { q: '', office: '', lang: '', kind: '', page: 1 };
  async function questions(el, ctx, keepFilters) {
    if (!keepFilters) { /* the filters survive refreshes and range changes */ }
    const s = await ctx.fetchJson('/api/analytics?' + ctx.rangeQS);
    const list = await ctx.fetchJson('/api/analytics?' + questionsQuery(ctx.range, qFilters));
    const opt = (v, label, cur) => `<option value="${C.esc(v)}"${v === cur ? ' selected' : ''}>${C.esc(label)}</option>`;
    el.innerHTML = renderQuestionsSummary(s) +
      '<section class="panel panel-wide"><h2>All questions</h2><form class="qfilters" id="qFilters" role="search">' +
      `<label>Search<input type="search" name="q" value="${C.esc(qFilters.q)}" placeholder="Words in the question"></label>` +
      '<label>Office<select name="office">' + opt('', 'All offices', qFilters.office) +
        (list.offices || []).map((o) => opt(o, C.officeName(o), qFilters.office)).join('') + '</select></label>' +
      '<label>Language<select name="lang">' + opt('', 'All', qFilters.lang) + opt('en', 'English', qFilters.lang) + opt('fil', 'Filipino', qFilters.lang) + '</select></label>' +
      '<label>Answer<select name="kind">' + opt('', 'All', qFilters.kind) +
        Object.keys(KIND).map((k) => opt(k, KIND[k], qFilters.kind)).join('') + '</select></label>' +
      '<button class="btn" type="submit">Apply</button></form>' +
      `<p class="muted">${list.total || 0} questions${list.pages > 1 ? `, page ${list.page} of ${list.pages}` : ''}</p>` +
      renderQuestionRows(list.rows) +
      (list.pages > 1 ? `<div class="pager"><button class="btn btn-quiet" id="qPrev"${list.page <= 1 ? ' disabled' : ''}>Previous</button>` +
        `<button class="btn btn-quiet" id="qNext"${list.page >= list.pages ? ' disabled' : ''}>Next</button></div>` : '') +
      '</section>';
    const form = el.querySelector('#qFilters');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      Object.assign(qFilters, { q: fd.get('q') || '', office: fd.get('office') || '', lang: fd.get('lang') || '', kind: fd.get('kind') || '', page: 1 });
      questions(el, ctx, true).catch(ctx.onError);
    });
    const prev = el.querySelector('#qPrev'), next = el.querySelector('#qNext');
    if (prev) prev.addEventListener('click', () => { qFilters.page = Math.max(1, list.page - 1); questions(el, ctx, true).catch(ctx.onError); });
    if (next) next.addEventListener('click', () => { qFilters.page = list.page + 1; questions(el, ctx, true).catch(ctx.onError); });
    el.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
      const row = (list.rows || []).find((r) => r.id === btn.getAttribute('data-remove'));
      if (!row) return;
      openDialog({
        title: 'Remove one question', html: renderRemoveDialog(row), confirmLabel: 'Remove', danger: true,
        onConfirm: async () => {
          await ctx.postJson('/api/data', { action: 'remove', id: row.id });
          await questions(el, ctx, true);
        },
      });
    }));
  }

  async function data(el, ctx) {
    const doc = await ctx.fetchJson('/api/data?view=archives');
    el.innerHTML = renderData(doc);
    el.querySelector('#dataResetBtn').addEventListener('click', () => {
      let backedUp = false;
      openDialog({
        title: 'Reset analytics',
        html: `<p>This moves <strong>${doc.current.questions} questions and ${doc.current.navigation} route events</strong> into an archive and starts the logs empty. The last 5 resets are kept; a sixth removes the oldest.</p>` +
          '<p class="muted" id="dlgStatus">Downloading the backup first...</p>' +
          '<label class="dlg-field">Type RESET to confirm<input id="dlgWord" autocomplete="off" disabled></label>',
        confirmLabel: 'Reset', danger: true, confirmDisabled: true,
        onOpen: (ui) => {
          const word = ui.el.querySelector('#dlgWord');
          word.addEventListener('input', () => ui.setConfirm(resetAllowed(word.value, backedUp)));
          startReset(ctx, { enableInput: () => {
            backedUp = true; word.disabled = false; word.focus();
            ui.el.querySelector('#dlgStatus').textContent = 'Backup downloaded.';
          } }).catch((e) => { ui.el.querySelector('#dlgStatus').textContent = 'The backup failed, so reset is not allowed: ' + e.message; });
        },
        onConfirm: async () => { await ctx.postJson('/api/data', { action: 'reset', confirm: 'RESET' }); await data(el, ctx); },
      });
    });
    el.querySelectorAll('[data-restore]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-restore');
      openDialog({
        title: 'Restore an earlier reset',
        html: '<p>The current logs are saved as a new archive first, then this archive becomes the live log again.</p>' +
          '<label class="dlg-field">Type RESTORE to confirm<input id="dlgWord" autocomplete="off"></label>',
        confirmLabel: 'Restore', confirmDisabled: true,
        onOpen: (ui) => { const w = ui.el.querySelector('#dlgWord'); w.addEventListener('input', () => ui.setConfirm(w.value === 'RESTORE')); w.focus(); },
        onConfirm: async () => { await ctx.postJson('/api/data', { action: 'restore', id, confirm: 'RESTORE' }); await data(el, ctx); },
      });
    }));
  }

  /** In-page dialog (no browser confirm()). Escape or Cancel closes it. */
  function openDialog(o) {
    const doc = root.document;
    const back = doc.createElement('div');
    back.className = 'dlg-backdrop';
    back.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgTitle"><h2 id="dlgTitle">${C.esc(o.title)}</h2>` +
      `<div class="dlg-body">${o.html}</div><p class="dlg-error" role="alert"></p><div class="dlg-actions">` +
      '<button class="btn btn-quiet" data-dlg="cancel">Cancel</button>' +
      `<button class="btn${o.danger ? ' btn-danger' : ''}" data-dlg="ok"${o.confirmDisabled ? ' disabled' : ''}>${C.esc(o.confirmLabel || 'OK')}</button></div></div>`;
    const prevFocus = doc.activeElement;
    const close = () => { back.remove(); doc.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    doc.addEventListener('keydown', onKey);
    doc.body.appendChild(back);
    const okBtn = back.querySelector('[data-dlg="ok"]');
    const ui = { el: back, setConfirm: (on) => { okBtn.disabled = !on; }, close };
    back.querySelector('[data-dlg="cancel"]').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true;
      try { await o.onConfirm(); close(); }
      catch (e) { back.querySelector('.dlg-error').textContent = e.message || 'That did not work.'; okBtn.disabled = false; }
    });
    if (o.onOpen) o.onOpen(ui); else okBtn.focus();
    return ui;
  }

  root.ADMIN_PAGES = {
    when, renderOverview, questionsQuery, renderQuestionsSummary, renderQuestionRows, renderRemoveDialog,
    renderHotTimes, renderSpeed, renderRoutes, renderData, resetAllowed, startReset, openDialog,
    overview, questions, hottimes, speed, routes, data,
  };
})(typeof window !== 'undefined' ? window : globalThis);
