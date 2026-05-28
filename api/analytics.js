// api/analytics.js — Vercel stub
// Full analytics (query_log.jsonl) require the local serve_https.py server.
// Vercel serverless functions are stateless and cannot persist log files.
module.exports = (req, res) => {
  res.status(200).json({
    total: 0, today: 0, ambiguityRate: 0, avgLatency: 0,
    topDepartments: [], topSubservices: [], queriesPerDay: [], recentQueries: [],
    _note: 'Analytics are only available in local mode (serve_https.py). ' +
           'The deployed version cannot persist query logs.',
  });
};
