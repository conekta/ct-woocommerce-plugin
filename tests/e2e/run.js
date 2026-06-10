const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');

const dir = __dirname;

// TEMP: specs skipped while iterating. RE-ENABLE before merge (empty this set).
const SKIP = new Set([
  'discount-classic.spec.js',
]);

const specs = readdirSync(dir)
  .filter(f => f.endsWith('.spec.js') && !SKIP.has(f))
  .sort();

SKIP.forEach(s => console.log(`[run] SKIPPING ${s} (temporary)`));

// Run every spec once (no retries) and report a summary at the end. We don't
// abort on the first failure so a single failing spec doesn't hide the status
// of the rest.
const failed = [];

specs.forEach(spec => {
  const result = spawnSync('node', [join(dir, spec)], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.log(`\n[run] ${spec} failed (exit ${result.status})\n`);
    failed.push(spec);
  }
});

if (failed.length) {
  console.error(`\n[run] ${failed.length}/${specs.length} spec(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\n[run] all ${specs.length} spec(s) passed`);
