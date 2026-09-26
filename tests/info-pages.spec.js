'use strict';

const { test, expect } = require('@playwright/test');

const PAGES = [
  ['/about', 'about', 'About MeroPrayas', 'MeroPrayas — About', true],
  ['/how-it-works', 'how-it-works', 'How It Works', 'MeroPrayas — How It Works', false],
  ['/privacy', 'privacy', 'Privacy Policy', 'MeroPrayas — Privacy Policy', false],
  ['/terms', 'terms', 'Terms & Conditions', 'MeroPrayas — Terms & Conditions', false],
  ['/contact', 'contact', 'Get in touch', 'MeroPrayas — Contact', true]
];

test.describe('informational pages', () => {
  for (const [href, view, heading, title, inNav] of PAGES) {
    test(`/${view} renders via direct URL with heading, title and active nav link`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));

      await page.goto(href);
      await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}$`));
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      await expect(page.locator(`#view-${view} h1`)).toHaveText(heading);
      await expect(page).toHaveTitle(new RegExp(title));

      const activeLink = inNav
        ? page.locator(`.nav-link[href="${href}"]`)
        : page.locator(`.footer-col a[data-route][href="${href}"]`);
      await expect(activeLink).toHaveClass(/active/);

      for (const [, otherView] of PAGES) {
        if (otherView !== view) await expect(page.locator(`#view-${otherView}`)).toBeHidden();
      }
      expect(errors).toEqual([]);
    });

    if (inNav) {
      test(`header nav link opens /${view} and highlights it`, async ({ page }) => {
        await page.goto('/');
        await page.locator(`.nav-link[href="${href}"]`).click();
        await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}$`));
        await expect(page.locator(`#view-${view}`)).toBeVisible();
        await expect(page.locator(`.nav-link[href="${href}"]`)).toHaveClass(/active/);
        await expect(page.locator('.tools-menu-panel')).toBeHidden();
      });
    }

    test(`footer link opens /${view}`, async ({ page }) => {
      await page.goto('/');
      await page.locator(`.footer-col a[data-route][href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}$`));
      await expect(page.locator(`#view-${view}`)).toBeVisible();
    });
  }

  test('About page shows the tool catalogue and developer profile', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('#view-about .feature-card')).toHaveCount(3);
    await expect(page.locator('#view-about .feature-card').filter({ hasText: 'Image Compressor' })).toBeVisible();
    await expect(page.locator('#view-about .feature-card').filter({ hasText: 'Unicode Converter' })).toBeVisible();
    await expect(page.locator('#view-about .feature-card').filter({ hasText: 'PDF Tools' })).toBeVisible();
    await expect(page.locator('#view-about .page-dev-kicker')).toHaveText('Developer');
    await expect(page.locator('#view-about .page-dev-name')).toHaveText('S.p. Anjaan');
    const box = await page.locator('#view-about .page-avatar').boundingBox();
    expect(box.width).toBe(76);
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  });

  test('How It Works page lists the general workflow and per-tool steps', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.locator('#view-how-it-works .flow-step')).toHaveCount(6);
    await expect(page.locator('#view-how-it-works .tool-flow')).toHaveCount(3);
    const steps = page.locator('#view-how-it-works .tool-flow-list li');
    await expect(steps).toHaveCount(5 + 4 + 5);
  });

  test('Contact page shows email, social links, help cards and FAQ', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.locator('#view-contact .contact-cta')).toHaveAttribute('href', 'mailto:spanjaan@gmail.com');
    await expect(page.locator('#view-contact .contact-cta')).toContainText('Email Me');
    await expect(page.locator('#view-contact .social-card')).toHaveCount(3);
    await expect(page.locator('#view-contact .social-facebook')).toHaveAttribute('href', 'https://www.facebook.com/spanjaan');
    await expect(page.locator('#view-contact .social-whatsapp')).toHaveAttribute('href', 'https://wa.me/9770000000000');
    await expect(page.locator('#view-contact .social-youtube')).toHaveAttribute('href', 'https://www.youtube.com/@spanjaan');
    await expect(page.locator('#view-contact .help-card')).toHaveCount(3);
    await expect(page.locator('#view-contact .faq-item')).toHaveCount(5);
    await expect(page.locator('#view-contact .faq-item').first()).toBeVisible();
  });

  test('legal sidebar is collapsible on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto('/privacy');
    const toc = page.locator('#view-privacy .toc');
    const toggle = toc.locator('.toc-toggle');
    await expect(toggle).toBeVisible();
    await expect(toc.locator('ol')).toBeHidden();

    await toggle.click();
    await expect(toc.locator('ol')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(toc.locator('ol')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  for (const [href, view, id] of [
    ['/privacy', 'privacy', 'pr-storage'],
    ['/terms', 'terms', 'tc-third']
  ]) {
    test(`/${view} sidebar auto-collapses after tapping an on-this-page link on small screens`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 800 });
      await page.goto(href);
      const toc = page.locator(`#view-${view} .toc`);
      const toggle = toc.locator('.toc-toggle');
      await toggle.click();
      await expect(toc.locator('ol')).toBeVisible();

      await toc.locator(`a[href="#${id}"]`).click();
      await expect(toc.locator('ol')).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}#${id}$`));
      await expect.poll(
        () => page.evaluate(hash => document.getElementById(hash).getBoundingClientRect().top, id)
      ).toBeLessThanOrEqual(150);
    });
  }

  test('legal sidebar stays open on desktop', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('#view-privacy .toc ol')).toBeVisible();
    await expect(page.locator('#view-privacy .toc-toggle')).toBeHidden();
  });

  for (const [href, view] of [['/privacy', 'privacy'], ['/terms', 'terms']]) {
    test(`/${view} has no horizontal scroll on small screens`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      await page.goto(href);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test(`/${view} keeps the top navbar and sidebar sticky while scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      await page.goto(href);
      await expect(page.locator('header.topbar')).toHaveCSS('position', 'sticky');
      const midSection = page.locator(`#view-${view} .legal-section`).nth(5);
      await midSection.scrollIntoViewIfNeeded();
      const navbarTop = await page.locator('header.topbar').evaluate(el => el.getBoundingClientRect().top);
      expect(navbarTop).toBe(0);
      const tocTop = await page.locator(`#view-${view} .toc`).evaluate(el => el.getBoundingClientRect().top);
      expect(tocTop).toBeCloseTo(96, 0);
    });

    test(`/${view} limits the expanded sidebar height on short phones`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 480 });
      await page.goto(href);
      const toc = page.locator(`#view-${view} .toc`);
      await toc.getByRole('button').click();
      await expect(toc).toHaveCSS('overflow-y', 'auto');
      const fits = await toc.evaluate(el => el.scrollHeight <= el.clientHeight);
      expect(fits).toBe(false);
    });
  }

  test('offcanvas nav and chrome stack above the sticky legal sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/privacy');
    const topbarZ = await page.locator('header.topbar').evaluate(el => Number(getComputedStyle(el).zIndex));
    const tocZ = await page.locator('#view-privacy .toc').evaluate(el => Number(getComputedStyle(el).zIndex));
    const headerFilter = await page.locator('header.topbar').evaluate(el => getComputedStyle(el).backdropFilter);
    const headerBeforeFilter = await page.locator('header.topbar').evaluate(
      el => getComputedStyle(el, '::before').backdropFilter
    );
    await page.locator('#navToggle').click();
    await expect(page.locator('#navScrim')).toBeVisible();
    const scrimZ = await page.locator('#navScrim').evaluate(el => Number(getComputedStyle(el).zIndex));
    const navZ = await page.locator('#primaryNav').evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(tocZ).toBe(30);
    expect(scrimZ).toBeGreaterThan(topbarZ);
    expect(navZ).toBeGreaterThan(scrimZ);
    expect(scrimZ).toBeGreaterThan(tocZ);
    expect(navZ).toBeGreaterThan(tocZ);
    expect(headerFilter).toBe('none');
    expect(headerBeforeFilter).toContain('blur');
    const dims = await page.evaluate(() => {
      const scrim = document.querySelector('#navScrim').getBoundingClientRect();
      const nav = document.querySelector('#primaryNav').getBoundingClientRect();
      return { sTop: scrim.top, sH: scrim.height, nTop: nav.top, nH: nav.height, vh: window.innerHeight };
    });
    expect(dims.sTop).toBe(0);
    expect(dims.sH).toBe(dims.vh);
    expect(dims.nTop).toBe(0);
    expect(dims.nH).toBe(dims.vh);
    const lock = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflow,
      body: getComputedStyle(document.body).overflow,
      y: Math.round(window.scrollY)
    }));
    expect([lock.html, lock.body]).toEqual(['hidden', 'hidden']);
    const yAtOpen = lock.y;
    await page.mouse.move(200, 350);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(yAtOpen);
    await page.locator('#navScrim').click({ position: { x: 350, y: 650 } });
    const unlocked = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflow,
      body: getComputedStyle(document.body).overflow
    }));
    expect([unlocked.html, unlocked.body]).not.toEqual(['hidden', 'hidden']);
    await expect(page.locator('#primaryNav')).toBeHidden();
  });

  test('Privacy Policy covers local processing, storage and third parties accurately', async ({ page }) => {
    await page.goto('/privacy');
    const text = await page.locator('#view-privacy .legal-content').innerText();

    await expect(page.locator('#view-privacy .toc a')).toHaveCount(10);
    for (const needle of [
      'Overview',
      'Information we do not intentionally collect',
      'Local file processing',
      'Browser storage',
      'Cookies',
      'Analytics & tracking',
      'Third-party services',
      'Children\'s privacy',
      'Changes to this policy',
      'Contact'
    ]) {
      expect(text).toContain(needle);
    }
    expect(text).toContain('localStorage');
    expect(text).toContain('pixelpress-theme');
    expect(text).toContain('Cache Storage');
    expect(text).toContain('does not intentionally collect');
  });

  test('Terms & Conditions acknowledge third-party open-source software', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('#view-terms .toc a')).toHaveCount(11);
    const text = await page.locator('#view-terms .legal-content').innerText();
    for (const needle of ['pdf-lib', 'PDF.js', 'JSZip', 'SIL Open Font License', 'as available', 'Limitation of liability']) {
      expect(text).toContain(needle);
    }
  });

  for (const [href, view, label, id] of [
    ['/privacy', 'privacy', 'Browser storage', 'pr-storage'],
    ['/terms', 'terms', 'Third-party software', 'tc-third']
  ]) {
    test(`/${view} on-this-page links jump in place without navigating away`, async ({ page }) => {
      await page.goto(href);
      await page.locator(`#view-${view} .toc a[href="#${id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}#${id}$`));
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      await expect.poll(() => page.evaluate(id => document.getElementById(id).getBoundingClientRect().top, id)).toBeLessThanOrEqual(150);
      const y = await page.evaluate(() => window.scrollY);
      expect(y).toBeGreaterThan(0);
    });
  }

  for (const [href, view, id, label] of [
    ['/privacy', 'privacy', 'pr-storage', 'Browser storage'],
    ['/terms', 'terms', 'tc-third', 'Third-party software']
  ]) {
    test(`/${view} sidebar highlights the section in view and follows scrolling`, async ({ page }) => {
      await page.goto(href);
      await expect(page.locator(`#view-${view} .toc a[href="#pr-overview"], #view-${view} .toc a[href="#tc-accept"]`).first()).toHaveClass(/active/);

      await page.locator(`#view-${view} .toc a[href="#${id}"]`).click();
      await expect(page.locator(`#view-${view} .toc a[href="#${id}"]`)).toHaveClass(/active/);
      await expect(page.locator(`#view-${view} .toc a[href="#${id}"]`)).toHaveAttribute('aria-current', 'location');

      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator(`#view-${view} .toc a[href^="#"]`).first()).toHaveClass(/active/);
    });
  }

  test('tool routes have no sidebar active state', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/compressor');
    await expect(page.locator('#view-workspace')).toBeVisible();
    expect(await page.locator('.toc a.active').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('all informational pages open offline after the service worker activates', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.tool-card')).toHaveCount(3);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.context().setOffline(true);

    for (const [href, view] of PAGES) {
      await page.goto(href);
      await expect(page.locator(`#view-${view}`)).toBeVisible();
    }

    await page.context().setOffline(false);
  });
});