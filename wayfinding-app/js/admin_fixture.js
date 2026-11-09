/**
 * admin_fixture.js - INVENTED data for checking the dashboard layout on
 * localhost (admin.html?fixture=1). Nothing here is a real citizen question.
 * It includes the cases that break layouts: a 120-character question, a
 * 70-character office name, and an HTML injection string that must show as
 * text. admin.js loads this file only on localhost or 127.0.0.1.
 */
(function (root) {
  'use strict';
  const LONG_Q = 'Paano po ba kumuha ng certificate of indigency para sa scholarship ng anak ko at ano ang mga kailangang dalhin sa opisina?';
  const LONG_OFFICE = 'OFFICE OF THE CITY ADMINISTRATOR FOR SPECIAL PROJECTS AND COORDINATION';
  const XSS = '<img src=x onerror=alert(1)>';
  const OFFICES = ['CITY TREASURY MANAGEMENT OFFICE', 'BUSINESS PERMITS AND TRICYCLE FRANCHISING OFFICE',
                   'CITY SOCIAL SERVICES OFFICE', 'CITY CIVIL REGISTRY OFFICE', LONG_OFFICE];
  const QS = ['How do I get a cedula?', 'business permit renewal requirements', 'saan po ang treasury', LONG_Q, XSS,
              'requirements for solo parent ID', 'magkano ang cedula', 'where do I pay real property tax', 'canteen', 'zzqx'];
  const base = Date.parse('2026-11-09T01:00:00Z');
  const rows = [];
  for (let i = 0; i < 64; i++) {
    const kind = i % 13 === 8 ? 'scope' : i % 17 === 9 ? 'unclear' : i % 7 === 2 ? 'location' : 'service';
    rows.push({
      id: 'f' + String(i).padStart(15, '0'), ts: base - i * 37 * 60000, query: QS[i % QS.length],
      department: kind === 'scope' || kind === 'unclear' ? null : OFFICES[i % OFFICES.length],
      subservice: kind === 'service' ? ['Cedula Service', 'Business Permit Renewal', 'Solo Parent ID', 'Real Property Tax'][i % 4] : null,
      needsContext: i % 11 === 0, latency_ms: kind === 'location' ? 2 : 400 + (i * 97) % 2600, lang: i % 3 ? 'en' : 'fil',
      kind, source: i % 2 ? 'chip' : 'typed',
    });
  }
  const hw = Array.from({ length: 7 }, () => new Array(24).fill(0));
  [[0, 9, 6], [0, 10, 9], [0, 14, 4], [1, 8, 3], [1, 11, 12], [2, 10, 14], [2, 13, 7], [3, 9, 5], [3, 15, 8],
   [4, 10, 11], [4, 16, 2], [5, 9, 1], [6, 20, 1]].forEach(([w, h, n]) => { hw[w][h] = n; });
  const hist = [];
  for (let lo = 0; lo < 10000; lo += 500) hist.push({ lo, hi: lo + 500, count: [3, 18, 14, 9, 6, 3, 2, 1][lo / 500] || 0 });
  hist.push({ lo: 10000, hi: null, count: 1 });
  const SUMMARY = {
    total: 198, today: 64, hourWeekday: hw, busiest: { weekday: 2, hour: 10, count: 14 },
    latency: { n: 57, median: 840, p95: 2600, histogram: hist },
    topDepartments: OFFICES.map((name, i) => ({ name, count: 40 - i * 7 })),
    topSubservices: [{ name: 'Cedula Service', count: 22 }, { name: 'Business Permit Renewal', count: 15 }, { name: 'Solo Parent ID', count: 9 }],
    typedSubservices: [{ name: 'Cedula Service', count: 8 }],
    languages: [{ lang: 'en', count: 163 }, { lang: 'fil', count: 35 }], clarification: { count: 15, of: 198 },
    kinds: { service: 170, location: 12, scope: 10, unclear: 6 }, sources: { typed: 77, chip: 121 },
    scopeTopics: [{ name: 'amenity', count: 6 }, { name: 'exit', count: 2 }, { name: 'person', count: 2 }],
    queriesPerDay: [{ date: '2026-11-07', count: 12 }, { date: '2026-11-08', count: 31 }, { date: '2026-11-09', count: 155 }],
    recentQueries: rows.slice(0, 20), rangeLabel: 'All time (Manila time)',
  };
  const NAV = { started: 30, arrived: 5, abandoned: 17, noEnding: 8, rescans: 2, alreadyHere: 4, resolved: 22,
                medianTimeToArrive: 33000, meanTimeToArrive: 41000, arrivalTimesN: 5,
                topDestinations: OFFICES.map((name, i) => ({ name, count: 9 - i })) };
  const ARCH = { current: { questions: 37, navigation: 41 },
    archives: [{ id: '1794197532000', at: Date.parse('2026-11-09T02:28:00Z'), by: 'staff PIN', questions: 95, navigation: 175 },
               { id: '1794185520000', at: Date.parse('2026-11-08T23:12:00Z'), by: 'staff PIN', questions: 120, navigation: 60 }],
    log: [{ action: 'reset', by: 'staff PIN', at: Date.parse('2026-11-09T02:28:00Z'), detail: 'archive 1794197532000' },
          { action: 'remove', by: 'staff PIN', at: Date.parse('2026-11-09T01:10:00Z'), detail: '1794185000000' }] };

  function questions(params) {
    const q = (params.get('q') || '').toLowerCase(), office = params.get('office') || '', lang = params.get('lang') || '', kind = params.get('kind') || '';
    const hits = rows.filter((r) => (!q || r.query.toLowerCase().includes(q)) && (!office || r.department === office) &&
                                   (!lang || r.lang === lang) && (!kind || r.kind === kind));
    const size = Math.min(200, Math.max(1, Number(params.get('size')) || 50));
    const pages = Math.max(1, Math.ceil(hits.length / size));
    const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1));
    return { rows: hits.slice((page - 1) * size, page * size), total: hits.length, page, pages, size,
             offices: OFFICES.slice().sort() };
  }
  const reply = (body, status) => ({
    ok: (status || 200) < 400, status: status || 200,
    json: async () => body, blob: async () => new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' }),
    headers: { get: (h) => (/disposition/i.test(h) ? 'attachment; filename="calamba-analytics-backup-fixture.json"' : null) },
  });

  root.ADMIN_FIXTURE = {
    async fetch(url, opts) {
      await new Promise((r) => setTimeout(r, 60));
      const u = new URL(url, 'http://fixture.local');
      const post = opts && opts.method === 'POST';
      if (u.pathname === '/api/adminauth') return reply(post ? { ok: true, session: true } : { configured: true, signedIn: true });
      if (u.pathname === '/api/data') {
        if (post) return reply({ ok: true });
        if (u.searchParams.get('view') === 'archives') return reply(ARCH);
        return reply({ exportedAt: new Date().toISOString(), note: 'fixture', questions: rows, navigation: [] });
      }
      if (u.pathname === '/api/navlog') return reply(NAV);
      if (u.pathname === '/api/analytics') {
        return reply(u.searchParams.get('view') === 'questions' ? questions(u.searchParams) : SUMMARY);
      }
      return reply({ error: 'not in the fixture' }, 404);
    },
  };
})(window);
