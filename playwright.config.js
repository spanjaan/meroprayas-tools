'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45000,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1280, height: 900 }
  },
  webServer: {
    command: 'node tests/server.js',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 15000
  }
});
