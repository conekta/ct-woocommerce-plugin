const { join } = require('path');

const artifactsDir = join(__dirname, '../../test-results/');

module.exports = {
  // Conekta's 3DS challenge modal (Cardinal/ACS) does not render reliably in
  // headless Chromium — the Integration component starts "Autenticando 3D
  // Secure 2" and then resets to the card form, so the payment never finalizes
  // and we never reach order-received. Run headed (under xvfb in CI) so the
  // challenge renders like a real browser and the OTP=1234 auto-fill completes
  // it. Set E2E_HEADLESS=1 to force headless locally.
  headless: process.env.E2E_HEADLESS === '1',
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
