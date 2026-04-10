const { readdirSync } = require('fs');
const { execFileSync } = require('child_process');
const { join } = require('path');

const dir = __dirname;
const specs = readdirSync(dir).filter(f => f.endsWith('.spec.js')).sort();

console.log(`Found ${specs.length} spec(s): ${specs.join(', ')}\n`);

specs.forEach(spec => {
  execFileSync('node', [join(dir, spec)], { stdio: 'inherit', env: process.env });
});
