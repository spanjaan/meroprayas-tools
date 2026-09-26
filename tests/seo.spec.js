'use strict';

const { test, expect } = require('@playwright/test');

const HOME = 'https://meroprayas.com';

function ldJson(page, id) {
  return page.evaluate(id => {
    const node = document.getElementById(id);
    if (!node) return null;
    return JSON.parse(node.textContent);
  }, id);
}

function metaContent(page, attr, key) {
  return page.getAttribute(`meta[${attr}="${key}"]`, 'content');
}

test.describe('SEO', () => {
  test('home page ships core meta, canonical and sitewide JSON-LD', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Online Image, PDF & Unicode Converter Tools/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', HOME + '/');

    const description = await metaContent(page, 'name', 'description');
    expect(description.length).toBeGreaterThanOrEqual(100);
    expect(description.length).toBeLessThanOrEqual(200);
    await expect(metaContent(page, 'name', 'description')).resolves.toContain('S.p. Anjaan');
    expect(await metaContent(page, 'name', 'robots')).toBe('index, follow');

    await expect(metaContent(page, 'property', 'og:type')).resolves.toBe('website');
    await expect(metaContent(page, 'property', 'og:locale')).resolves.toBe('en_US');
    await expect(metaContent(page, 'property', 'og:url')).resolves.toBe(HOME + '/');
    await expect(metaContent(page, 'property', 'og:site_name')).resolves.toBe('MeroPrayas');
    await expect(metaContent(page, 'property', 'og:image')).resolves.toBe(HOME + '/assets/og-card.png');
    await expect(metaContent(page, 'name', 'twitter:card')).resolves.toBe('summary_large_image');
    await expect(metaContent(page, 'name', 'twitter:image')).resolves.toBe(HOME + '/assets/og-card.png');

    const sitewide = await ldJson(page, undefined);
    const staticGraph = await page.evaluate(() => {
      const node = document.querySelector('script[type="application/ld+json"]:not([data-route])');
      return node ? JSON.parse(node.textContent) : null;
    });
    const types = staticGraph['@graph'].map(node => node['@type']);
    expect(types).toEqual(expect.arrayContaining(['WebSite', 'Organization', 'SoftwareApplication']));
    expect(staticGraph['@graph'].find(n => n['@type'] === 'Organization').sameAs).toEqual([
      'https://www.facebook.com/spanjaan',
      'https://www.youtube.com/@spanjaan'
    ]);

    const routeGraph = await ldJson(page, 'route-ld');
    expect(routeGraph['@graph'].map(n => n['@type'])).toContain('WebPage');
    expect(routeGraph['@graph'][0].url).toBe(HOME + '/');
    expect(sitewide).toBeNull();
  });

  const ROUTE_CASES = [
    ['/', 'MeroPrayas — Online Image, PDF & Unicode Converter', 'compress images', HOME + '/', 'WebPage'],
    ['/compressor', 'MeroPrayas-Image Compressor', 'Compress JPG, PNG, WebP', HOME + '/compressor', 'SoftwareApplication'],
    ['/unicode', 'MeroPrayas-Unicode Converter', 'Preeti and Hisab', HOME + '/unicode', 'SoftwareApplication'],
    ['/pdf-editor', 'MeroPrayas-PDF Tools', 'convert PDF files online', HOME + '/pdf-editor', 'SoftwareApplication'],
    ['/about', 'MeroPrayas — About', 'S.p. Anjaan', HOME + '/about', 'WebPage'],
    ['/how-it-works', 'MeroPrayas — How It Works', 'How MeroPrayas works', HOME + '/how-it-works', 'WebPage'],
    ['/privacy', 'MeroPrayas — Privacy Policy', 'processed locally in your browser', HOME + '/privacy', 'WebPage'],
    ['/terms', 'MeroPrayas — Terms & Conditions', 'terms and conditions', HOME + '/terms', 'WebPage']
  ];

  for (const [path, titlePart, descPart, url, entityType] of ROUTE_CASES) {
    test(`direct URL /${path === '/' ? '' : path} carries route metadata`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(new RegExp(titlePart));
      await expect(metaContent(page, 'name', 'description')).resolves.toContain(descPart);
      await expect(metaContent(page, 'property', 'og:title')).resolves.toContain(titlePart);
      await expect(metaContent(page, 'property', 'og:description')).resolves.toContain(descPart);
      await expect(metaContent(page, 'property', 'og:url')).resolves.toBe(url);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', url);

      const graph = await ldJson(page, 'route-ld');
      const webPage = graph['@graph'].find(n => n['@type'] === 'WebPage');
      expect(webPage.url).toBe(url);
      if (entityType === 'SoftwareApplication') {
        expect(graph['@graph'].find(n => n['@type'] === 'WebPage').mainEntity['@type']).toBe('SoftwareApplication');
      }
    });
  }

  test('PDF subroutes get per-tool titles, descriptions and canonical', async ({ page }) => {
    await page.goto('/pdf-editor/split');
    await expect(page).toHaveTitle(/PDF Split — MeroPrayas/);
    await expect(metaContent(page, 'name', 'description')).resolves.toContain('Split a PDF');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', HOME + '/pdf-editor');
    const graph = await ldJson(page, 'route-ld');
    expect(graph['@graph'][0].mainEntity.name).toBe('PDF Split');
  });

  test('SPA navigation updates meta, canonical and JSON-LD per route', async ({ page }) => {
    await page.goto('/');
    await page.click('.tool-card[href="/unicode"]');
    await expect(page).toHaveURL(/\/unicode$/);
    await expect(page).toHaveTitle(/Unicode Converter/);
    await expect(metaContent(page, 'property', 'og:url')).resolves.toBe(HOME + '/unicode');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', HOME + '/unicode');

    await page.click('.nav-link[href="/contact"]');
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page).toHaveTitle('MeroPrayas — Contact');
    await expect(metaContent(page, 'property', 'og:url')).resolves.toBe(HOME + '/contact');
    await expect(metaContent(page, 'property', 'og:image')).resolves.toBe(HOME + '/assets/og-card.png');

    const graph = await ldJson(page, 'route-ld');
    const contact = graph['@graph'].find(n => n['@type'] === 'ContactPage');
    expect(contact.url).toBe(HOME + '/contact');
    const faq = graph['@graph'].find(n => n['@type'] === 'FAQPage');
    expect(faq.mainEntity).toHaveLength(5);
    expect(faq.mainEntity[0]).toHaveProperty('@type', 'Question');
  });

  test('robots.txt and sitemap.xml are served with real metadata', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.ok()).toBe(true);
    expect(robots.headers()['content-type']).toContain('text/plain');
    expect(await robots.text()).toContain('Sitemap: ' + HOME + '/sitemap.xml');

    const sitemapRes = await request.get('/sitemap.xml');
    expect(sitemapRes.ok()).toBe(true);
    expect(sitemapRes.headers()['content-type']).toContain('application/xml');
    const sitemapText = await sitemapRes.text();
    expect(sitemapText).toContain('<loc>' + HOME + '/</loc>');
    expect(sitemapText).toContain('<loc>' + HOME + '/unicode</loc>');
    expect(sitemapText).toContain('<loc>' + HOME + '/pdf-editor/pdf-to-jpg</loc>');

    for (const loc of Array.from(sitemapText.matchAll(/<loc>(https:\/\/meroprayas\.com\/[^<]*)<\/loc>/g), m => m[1])) {
      const res = await request.get(loc.replace(HOME, ''));
      expect(res.ok(), `${loc} should resolve`).toBe(true);
    }
  });

  test('social share image is a 1200x630 PNG and listed in the sitemap assets path', async ({ request }) => {
    const res = await request.get('/assets/og-card.png');
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toBe('image/png');
    const body = Buffer.from(await res.body());
    expect(body.readUInt32BE(16)).toBe(1200);
    expect(body.readUInt32BE(20)).toBe(630);
  });
});