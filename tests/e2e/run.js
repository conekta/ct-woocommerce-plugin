const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');

const dir = __dirname;
const specs = readdirSync(dir).filter(f => f.endsWith('.spec.js')).sort();

// One store health check for the whole run: when the shared staging store is
// down (WooCommerce fataled, wc/v3 unregistered) every spec fails identically,
// so abort once with a single message instead of 8 copies of it. setup() in
// checkout-helpers.js keeps its own per-spec gate for direct `node x.spec.js`
// runs.
const STORE_URL = process.env.STORE_URL || 'http://localhost';

async function main() {
  const health = await fetch(`${STORE_URL}/wp-json/`).then(r => r.json()).catch(() => null);
  if (!health?.namespaces?.includes('wc/v3')) {
    console.error(
      `[run] staging store unhealthy: wc/v3 REST namespace not registered ` +
      `(namespaces: ${JSON.stringify(health?.namespaces ?? 'wp-json unreachable')}). ` +
      `WooCommerce is not loading on ${STORE_URL} — fix the store, then re-run. Skipping all ${specs.length} specs.`
    );
    process.exit(1);
  }

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
}

main();
