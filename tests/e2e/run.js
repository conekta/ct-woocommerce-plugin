const { readdirSync } = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

const dir = __dirname;
const specs = readdirSync(dir).filter(f => f.endsWith('.spec.js')).sort();

console.log(`Found ${specs.length} spec(s): ${specs.join(', ')}\n`);

specs.forEach(spec => {
  execSync(`node ${join(dir, spec)}`, { stdio: 'inherit', env: process.env });
});
