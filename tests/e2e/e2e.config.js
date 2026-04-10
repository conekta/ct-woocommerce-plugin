module.exports = {
  headless: true,
  video: {
    dir: '/tmp/e2e-videos/',
    size: { width: 1280, height: 720 },
  },
  screenshot: {
    dir: '/tmp/',
    prefix: 'e2e-',
  },
  timeouts: {
    selector: 10000,
    threeDs: 30000,
    navigation: 60000,
  },
};
