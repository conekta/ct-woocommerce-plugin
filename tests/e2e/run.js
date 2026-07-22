const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');

const dir = __dirname;
let specs = readdirSync(dir).filter(f => f.endsWith('.spec.js')).sort();

// Optional shard filter: E2E_SHARD=blocks|classic (or first CLI arg) runs only
// the specs whose filename ends with that checkout flavor. Lets CI report and
// retry each checkout type independently. NOTE: both shards target the SAME
// staging store and setup() rewrites the checkout page content
// (setCheckoutType), so shards must never run concurrently — ci.yml keeps the
// matrix at max-parallel: 1.
const SHARD = (process.env.E2E_SHARD || process.argv[2] || '').toLowerCase();
if (SHARD) {
  if (!['blocks', 'classic'].includes(SHARD)) {
    console.error(`[run] unknown shard "${SHARD}" — expected "blocks" or "classic"`);
    process.exit(1);
  }
  // A spec whose filename matches NEITHER flavor would silently run in no
  // shard at all — fail loudly instead so the naming convention stays honest.
  const orphans = specs.filter(f => !f.endsWith('-blocks.spec.js') && !f.endsWith('-classic.spec.js'));
  if (orphans.length) {
    console.error(`[run] spec(s) not named *-blocks.spec.js / *-classic.spec.js would be skipped by sharding: ${orphans.join(', ')}`);
    process.exit(1);
  }
  specs = specs.filter(f => f.endsWith(`-${SHARD}.spec.js`));
  if (!specs.length) {
    console.error(`[run] shard "${SHARD}" matched no specs`);
    process.exit(1);
  }
  console.log(`[run] shard "${SHARD}": ${specs.length} spec(s) → ${specs.join(', ')}\n`);
}

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
