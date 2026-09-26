'use strict';

const { test, expect } = require('@playwright/test');

const TOOLS = [
  ['/compressor', 'Image Compressor', 'Compress and optimize images with quality, format and size controls.'],
  ['/unicode', 'Unicode Converter', 'Convert Nepali text between Unicode and Preeti.'],
  ['/pdf-editor', 'PDF Edit', 'Merge, split, compress and convert PDF files.']
];

test.describe('tools dashboard home', () => {
  test('home shows exactly 3 tool cards and no compressor dropzone', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.hero h1')).toHaveText('MeroPrayas Tools');
    await expect(page.locator('.hero-sub')).toHaveText('Simple, fast and useful tools for everyday work.');
    await expect(page.locator('.tools-heading')).toHaveText('Tools');
    await expect(page.locator('.tool-card')).toHaveCount(3);

    for (const [, title, desc] of TOOLS) {
      await expect(page.locator('.tool-card', { hasText: title }).locator('.tool-desc')).toHaveText(desc);
    }

    await expect(page.locator('.tool-card[href="/compressor"]').locator('.tool-name')).toHaveText('Image Compressor');
    await expect(page.locator('#dropZone')).toBeHidden();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#view-workspace')).toBeHidden();
  });

  test('tool grid is responsive: 3 columns desktop, 2 tablet, 1 mobile', async ({ page }) => {
    await page.goto('/');
    const columns = () => page.evaluate(() => {
      const grid = document.querySelector('.tools-grid');
      return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(columns).toBe(3);

    await page.setViewportSize({ width: 800, height: 900 });
    await expect.poll(columns).toBe(2);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(columns).toBe(1);
  });

  test('light and dark mode both render the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');

    const cardBg = await page.locator('.tool-card').first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(cardBg).not.toBe('rgba(0, 0, 0, 0)');

    await page.locator('#themeBtn').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.tool-card')).toHaveCount(3);
    await expect(page.locator('.hero h1')).toHaveText('MeroPrayas Tools');
  });
});

test.describe('routing', () => {
  test('clicking each card opens its route', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/');
    for (const [href, title] of TOOLS) {
      await page.goto('/');
      await page.locator(`.tool-card[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      const heading = href === '/pdf-editor' ? 'PDF Tools' : title;
      await expect(page.locator('h1', { hasText: heading })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('each route works via direct URL and shows the right heading', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    for (const [href, title] of TOOLS) {
      await page.goto(href);
      const heading = href === '/pdf-editor' ? 'PDF Tools' : title;
      await expect(page.locator('h1', { hasText: heading })).toBeVisible();
      const view = href === '/pdf-editor' ? 'pdf-editor' : href === '/compressor' ? 'workspace' : 'unicode';
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      await expect(page.locator(`a[data-route][href="${href}"]`).first()).toHaveClass(/active/);
    }

    // The unicode converter is a live tool with a real input, not a placeholder.
    await page.goto('/unicode');
    await expect(page.locator('#ucInput')).toBeVisible();
    await expect(page.locator('#dropZone')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('compressor uses the shared workspace and its dropzone', async ({ page }) => {
    await page.goto('/compressor');
    await expect(page.locator('#workspaceTitle')).toHaveText('Image Compressor');
    await expect(page.locator('#dropZone')).toBeVisible();
    await expect(page.locator('#chooseBtn')).toBeVisible();
  });

  test('refresh keeps the current route', async ({ page }) => {
    await page.goto('/compressor');
    await page.reload();
    await expect(page).toHaveURL(/\/compressor$/);
    await expect(page.locator('#dropZone')).toBeVisible();

    await page.goto('/unicode');
    await page.reload();
    await expect(page).toHaveURL(/\/unicode$/);
    await expect(page.locator('#ucInput')).toBeVisible();
  });

  test('browser back and forward navigate between routes', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tool-card[href="/compressor"]').click();
    await expect(page).toHaveURL(/\/compressor$/);
    await expect(page.locator('#dropZone')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.tool-card')).toHaveCount(3);

    await page.goForward();
    await expect(page).toHaveURL(/\/compressor$/);
    await expect(page.locator('#dropZone')).toBeVisible();

    // Back to home, then forward to the unicode converter.
    await page.goBack();
    await page.locator('.tool-card[href="/unicode"]').click();
    await expect(page).toHaveURL(/\/unicode$/);
    await expect(page.locator('#ucInput')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);

    await page.goForward();
    await expect(page).toHaveURL(/\/unicode$/);
  });

  test('unknown routes fall back to the home dashboard', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.tool-card')).toHaveCount(3);
  });

  test('header navigation: Home link and Tools menu navigate and highlight the active tool', async ({ page }) => {
    await page.goto('/compressor');

    await page.locator('#toolsMenu summary').click();
    await expect(page.locator('.tools-menu-panel')).toBeVisible();
    await expect(page.locator('.tools-menu-panel a[href="/compressor"]')).toHaveClass(/active/);

    await page.locator('.tools-menu-panel a[href="/unicode"]').click();
    await expect(page).toHaveURL(/\/unicode$/);
    await expect(page.locator('#ucInput')).toBeVisible();
    await expect(page.locator('.tools-menu-panel')).toBeHidden();

    await page.locator('.nav-link[href="/"]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.tool-card')).toHaveCount(3);
  });
});
