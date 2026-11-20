const { defineConfig } = require('@playwright/test');

if (process.platform === 'darwin' && !process.env.CI && process.env.RINKU_ALLOW_GUI_TESTS !== '1') {
  throw new Error('Electron tests take desktop focus. Use npm run test:remote for Omarchy, or explicitly set RINKU_ALLOW_GUI_TESTS=1 for an agreed local Mac run.');
}

module.exports = defineConfig({
  testDir: './tests/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  reporter: 'list',
  outputDir: 'test-results/playwright',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
