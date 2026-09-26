'use strict';

// Renders assets/og-card.svg to assets/og-card.png (1200x630) via Playwright
// Chromium so the social share image ships as a real PNG.
//   node scripts/generate-og-card.js
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'assets', 'og-card.svg');
  const target = path.join(root, 'assets', 'og-card.png');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto('file://' + source.replace(/\\/g, '/'));
  await page.screenshot({ path: target });
  await browser.close();
  console.log('Wrote ' + target);
})();