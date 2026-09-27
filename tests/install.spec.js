'use strict';

const { test, expect } = require('@playwright/test');

/* The install button used to appear only when `beforeinstallprompt` fired, which
   Safari never does and many Android browsers don't either. It is now driven by
   `UI.configureInstall(mode)` from `js/app.js`, so these specs drive that API
   directly and stub prompt events.

   Note Playwright's default context is incognito, where Chrome refuses to fire a
   real install prompt ("in-incognito" installability error). That is convenient
   here: it means a visible button proves visibility is platform-driven rather
   than event-driven, which is the regression under test. */

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

const button = page => page.locator('#installBtn');
const helpDialog = page => page.locator('#installHelpDialog');

async function load(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(button(page)).toHaveCount(1);
  return errors;
}

/* The fake event has to be built inside the page: Playwright cannot serialise a
   function across the evaluate boundary. */
async function feedPrompt(page, outcome, { shouldThrow = false } = {}) {
  await page.evaluate(({ oc, throwIt }) => {
    window.__promptCalls = 0;
    UI.setInstallHandler({
      prompt: () => {
        window.__promptCalls += 1;
        return throwIt ? Promise.reject(new Error('no prompt available')) : Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: oc, platform: 'web' }),
      platforms: ['web']
    });
  }, { oc: outcome, throwIt: shouldThrow });
}

const promptCalls = page => page.evaluate(() => window.__promptCalls);

test.describe('install button visibility', () => {
  test('is visible in Chromium without any install event firing', async ({ page }) => {
    const errors = await load(page);

    // The reported bug: this was `hidden` until beforeinstallprompt arrived.
    // Playwright's context is incognito, where Chrome never fires that event, so a
    // visible button here proves visibility is platform-driven, not event-driven.
    await expect(button(page)).toBeVisible();
    await expect(button(page)).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('is hidden for browsers with no install support', async ({ page }) => {
    await load(page);
    await page.evaluate(() => UI.configureInstall('unsupported'));
    await expect(button(page)).toBeHidden();
  });

  test('is hidden once the app is installed', async ({ page }) => {
    const errors = await load(page);
    await page.evaluate(() => UI.markInstalled());
    await expect(button(page)).toBeHidden();
    await expect(button(page)).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('returns when the app leaves standalone mode', async ({ page }) => {
    await load(page);
    // Mirrors app.js: entering standalone hides the button, leaving restores it.
    await page.evaluate(() => UI.markInstalled());
    await expect(button(page)).toBeHidden();

    await page.evaluate(() => UI.configureInstall('chromium'));
    await expect(button(page)).toBeVisible();
    await expect(button(page)).toBeEnabled();
  });

  test('a real prompt event is not downgraded by a later configure call', async ({ page }) => {
    await load(page);
    await feedPrompt(page, 'accepted');
    // beforeinstallprompt proves the browser can install, so an 'unsupported'
    // platform guess must not override it.
    await page.evaluate(() => UI.configureInstall('unsupported'));
    await expect(button(page)).toBeVisible();
  });
});

test.describe('iOS / Safari', () => {
  test.use({ userAgent: IPHONE_UA });

  test('shows the install button even though Safari never fires beforeinstallprompt', async ({ page }) => {
    const errors = await load(page);

    await expect(button(page)).toBeVisible();
    await expect(button(page)).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('clicking opens Add to Home Screen instructions, not a dead end', async ({ page }) => {
    const errors = await load(page);
    await expect(button(page)).toHaveAttribute('aria-label', /home screen/i);

    await button(page).click();
    await expect(helpDialog(page)).toBeVisible();
    await expect(helpDialog(page)).toHaveAttribute('data-variant', 'ios');

    const steps = page.locator('#installHelpSteps');
    await expect(steps).toContainText(/share/i);
    await expect(steps).toContainText(/add to home screen/i);
    await expect(page.locator('#installHelpStepIcon')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('instructions are dismissible', async ({ page }) => {
    await load(page);
    await button(page).click();
    await expect(helpDialog(page)).toBeVisible();

    await page.locator('#installHelpClose').click();
    await expect(helpDialog(page)).toBeHidden();

    await button(page).click();
    await expect(helpDialog(page)).toBeVisible();
    await page.locator('#installHelpDialog').click({ position: { x: 4, y: 4 } });
    await expect(helpDialog(page)).toBeHidden();
  });
});

test.describe('non-installable browser', () => {
  test.use({ userAgent: FIREFOX_UA });

  test('hides the button rather than offering a dead end', async ({ page }) => {
    const errors = await load(page);
    await expect(button(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('install prompt lifecycle', () => {
  test('chromium without an event falls back to browser-menu instructions', async ({ page }) => {
    const errors = await load(page);
    await page.evaluate(() => UI.configureInstall('chromium'));
    await expect(button(page)).toBeVisible();

    await button(page).click();
    await expect(helpDialog(page)).toBeVisible();
    await expect(helpDialog(page)).toHaveAttribute('data-variant', 'chromium');
    await expect(page.locator('#installHelpSteps')).toContainText(/install app/i);
    await expect(page.locator('#installHelpStepIcon')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('an accepted prompt hides the button', async ({ page }) => {
    const errors = await load(page);
    await feedPrompt(page, 'accepted');
    await expect(button(page)).toBeVisible();

    await button(page).click();
    expect(await promptCalls(page)).toBe(1);
    await expect(button(page)).toBeHidden();
    await expect(button(page)).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('a dismissed prompt keeps the button available to retry', async ({ page }) => {
    const errors = await load(page);
    await feedPrompt(page, 'dismissed');

    await button(page).click();
    // Regression: the old handler hid the button on any click, dismissal included.
    await expect(button(page)).toBeVisible();
    await expect(button(page)).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('a retry after a consumed prompt opens the help sheet instead of throwing', async ({ page }) => {
    const errors = await load(page);
    await feedPrompt(page, 'dismissed');

    await button(page).click();
    await expect(button(page)).toBeVisible();

    // beforeinstallprompt events are single-use, so the retry has none left.
    await button(page).click();
    await expect(helpDialog(page)).toBeVisible();
    expect(await promptCalls(page)).toBe(1);
    expect(errors).toEqual([]);
  });

  test('a rejected prompt is caught and the button stays usable', async ({ page }) => {
    const errors = await load(page);
    await feedPrompt(page, 'dismissed', { shouldThrow: true });

    await button(page).click();
    await expect(button(page)).toBeVisible();
    await expect(button(page)).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('a late event upgrades an already-visible button without hiding it', async ({ page }) => {
    const errors = await load(page);
    await page.evaluate(() => UI.configureInstall('chromium'));
    await expect(button(page)).toBeVisible();

    await feedPrompt(page, 'accepted');
    await expect(button(page)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('layout', () => {
  test('the button fits the topbar at 320px without overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await load(page);
    await page.evaluate(() => UI.configureInstall('ios'));
    await expect(button(page)).toBeVisible();

    const metrics = await page.evaluate(() => {
      const rect = document.getElementById('installBtn').getBoundingClientRect();
      const topbar = document.querySelector('.topbar').getBoundingClientRect();
      return {
        right: rect.right,
        topbarRight: topbar.right,
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth
      };
    });

    expect(metrics.right).toBeLessThanOrEqual(metrics.topbarRight + 1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport);
  });
});

test.describe('PWA installability', () => {
  test('exposes the meta tags iOS needs for a standalone launch', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'MeroPrayas');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  });

  test('registers a service worker that controls the page', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { active: !!(reg && reg.active), scope: reg && reg.scope };
    });
    expect(state.active).toBe(true);
    expect(state.scope).toContain('/');
  });

  test('every precached asset exists, so the offline cache is complete', async ({ baseURL }) => {
    // Read the list out of sw.js with Node rather than the page, so the service
    // worker cannot intercept and rewrite the response being inspected.
    const source = await (await fetch(`${baseURL}/sw.js`)).text();
    const assets = [...source.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]);
    expect(assets.length).toBeGreaterThan(20);

    const missing = [];
    await Promise.all(assets.map(async asset => {
      const url = new URL(asset, `${baseURL}/`).href;
      const res = await fetch(url);
      if (!res.ok) missing.push(`${asset} -> ${res.status}`);
    }));

    expect(missing).toEqual([]);
  });
});
