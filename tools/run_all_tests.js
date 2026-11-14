/**
 * run_all_tests.js - runs every tools/test_*.js with `node <file> <root>`,
 * prints each file's last output line, and exits non-zero if any file exits
 * non-zero or its last line does not report "0 failed".
 *
 * Run: node tools/run_all_tests.js <repo-root>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.argv[2] || '.');
const dir = path.join(ROOT, 'tools');
const files = fs.readdirSync(dir).filter((f) => /^test_.*\.js$/.test(f)).sort();

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f), ROOT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout || ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '(no output)';
  const good = r.status === 0 && /\b0 failed\b/.test(last);
  if (!good) bad++;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${f.padEnd(34)} ${last}${r.status === 0 ? '' : `  [exit ${r.status}]`}`);
}
console.log(`\n${files.length} test files, ${bad} not clean`);
process.exit(bad ? 1 : 0);
