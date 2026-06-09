const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');

const dir = __dirname;
const specs = readdirSync(dir).filter(f => f.endsWith('.spec.js')).sort();

// Each spec drives a live Conekta sandbox payment including the 3DS challenge,
// whose challenge iframe intermittently fails to render in CI. Retry a failing
// spec a few times before giving up so one flaky 3DS run doesn't fail the whole
// suite. Also run EVERY spec (don't abort on the first failure) and report a
// summary at the end. Override the retry count with E2E_RETRIES
// (total attempts = retries + 1).
const RETRIES = Number.parseInt(process.env.E2E_RETRIES || '2', 10);
const failed = [];

specs.forEach(spec => {
  let passed = false;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    if (attempt > 1) console.log(`\n[run] retrying ${spec} (attempt ${attempt}/${RETRIES + 1})\n`);
    const result = spawnSync('node', [join(dir, spec)], { stdio: 'inherit', env: process.env });
    if (result.status === 0) { passed = true; break; }
    const more = attempt <= RETRIES ? ' — will retry' : '';
    console.log(`\n[run] ${spec} failed (exit ${result.status})${more}\n`);
  }
  if (!passed) failed.push(spec);
});

if (failed.length) {
  console.error(`\n[run] ${failed.length}/${specs.length} spec(s) failed after ${RETRIES} retr${RETRIES === 1 ? 'y' : 'ies'}: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\n[run] all ${specs.length} spec(s) passed`);
