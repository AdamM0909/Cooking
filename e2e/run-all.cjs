// Runs every browser check in this folder against a running copy of the site and reports pass or fail.
//   KITCHEN_URL  where the site is served (default http://localhost:8000/)
//   CHROMIUM     path to a Chromium or Chrome executable (default: Playwright's own)
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const only = process.argv[2];
const files = readdirSync(__dirname).filter(f => f.endsWith('.cjs') && f !== 'run-all.cjs' && (!only || f.includes(only))).sort();
let failed = 0;
for (const f of files) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 240000, env: process.env, maxBuffer: 20e6 });
  const out = (r.stdout || '') + (r.stderr || '');
  const problems = out.split('\n').filter(l => /^FAIL |SCRIPT FAIL|^VIOLATION |errors: \[\s*['"]/.test(l.trim() === l ? l : l.trim()));
  const summary = (out.match(/(\d+)\/(\d+) passed/) || [])[0] || (/NO VIOLATIONS/.test(out) ? 'no accessibility violations' : 'ran');
  const bad = r.status !== 0 || problems.length > 0;
  if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${f.padEnd(28)} ${summary}  (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  if (bad) { console.log(problems.slice(0, 6).map(l => '        ' + l).join('\n')); if (!problems.length) console.log(out.split('\n').slice(-6).join('\n')); }
}
console.log(failed ? `\n${failed} of ${files.length} checks failed` : `\nAll ${files.length} browser checks passed`);
process.exit(failed ? 1 : 0);
