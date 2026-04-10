const { join } = require('path');

const artifactsDir = join(__dirname, '../../test-results/');

module.exports = {
  headless: true,
  artifactsDir,
  video: {
    dir: join(artifactsDir, 'videos/'),
    size: { width: 1280, height: 720 },
  },
  screenshot: {
    dir: join(artifactsDir, 'screenshots/'),
    prefix: 'e2e-',
  },
  timeouts: {
    selector: 10000,
    threeDs: 30000,
    navigation: 60000,
  },
};
