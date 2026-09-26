'use strict';

const { test, expect } = require('@playwright/test');
const JSZip = require('../vendor/jszip.min.js');
const PDFLib = require('../vendor/pdf-lib.min.js');
const { makePng, pngToJpeg, jpegWithExifOrientation, makePdf, makeNoisyPdf, pdfPageCount, downloadBuffer, samplePdfPages, sampleJpegPixel } = require('./helpers');

async function uploadPdf(page, selector, buffer, name) {
  await page.setInputFiles(selector, { name, mimeType: 'application/pdf', buffer });
}

// Colours used by makePdf with default options (base 40, step 40).
const PAGE_COLORS = n => Array.from({ length: n }, (_, i) => [(40 + i * 40) % 255, 140, 220]);

test.describe('PDF editor', () => {
  test('home card and tools menu open the PDF workspace', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('.tool-card', { hasText: 'PDF Edit' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Merge, split, compress and convert PDF files.');
    await card.click();
    await expect(page).toHaveURL(/\/pdf-editor$/);
    await expect(page.locator('#view-pdf-editor')).toBeVisible();
    await expect(page.locator('#pdfHeroTitle')).toHaveText('PDF Tools');
    await expect(page.locator('#panel-merge h2')).toHaveText('Merge PDFs');
    await expect(page.locator('#panel-merge')).toBeVisible();

    await page.goto('/');
    await page.locator('#toolsMenu').click();
    await page.locator('.tools-menu-panel a[href="/pdf-editor"]').click();
    await expect(page.locator('#panel-merge')).toBeVisible();
  });

  test('merge combines PDFs in the reordered list order', async ({ page }) => {
    await page.goto('/pdf-editor');
    const a = await makePdf(3);
    const b = await makePdf(2, { base: 200 });
    await uploadPdf(page, '#mergeFileInput', a, 'document-1.pdf');
    await uploadPdf(page, '#mergeFileInput', b, 'document-2.pdf');
    await expect(page.locator('#mergeList .pdf-file-item')).toHaveCount(2);
    await expect(page.locator('#mergeList .pdf-file-item').first()).toContainText('3 pages', { timeout: 30000 });
    await expect(page.locator('#mergeList .pdf-file-item').nth(1)).toContainText('2 pages', { timeout: 30000 });

    await page.locator('#mergeList .pdf-file-item').nth(1).locator('[data-move="up"]').click();
    await expect(page.locator('#mergeList .pdf-file-title').first()).toHaveText('document-2.pdf');

    await page.locator('#mergeBtn').click();
    await expect(page.locator('#mergeResultCard')).toBeVisible();
    await expect(page.locator('#mergeResultMeta')).toContainText('5 pages');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#mergeDownloadBtn').click()
    ]);
    expect(download.suggestedFilename()).toBe('merged.pdf');
    const buffer = await downloadBuffer(download);
    expect(await pdfPageCount(buffer)).toBe(5);
    const colors = await samplePdfPages(page, buffer);
    expect(colors).toEqual([
      [200, 140, 220], [240, 140, 220],
      [40, 140, 220], [80, 140, 220], [120, 140, 220]
    ]);
  });

  test('merge list supports drag-and-drop reordering', async ({ page }) => {
    await page.goto('/pdf-editor');
    await uploadPdf(page, '#mergeFileInput', await makePdf(1, { base: 40 }), 'a.pdf');
    await uploadPdf(page, '#mergeFileInput', await makePdf(1, { base: 200 }), 'b.pdf');
    await uploadPdf(page, '#mergeFileInput', await makePdf(1, { base: 90 }), 'c.pdf');
    await expect(page.locator('#mergeList .pdf-file-item')).toHaveCount(3);

    const dt = await page.evaluateHandle(() => new DataTransfer());
    await page.dispatchEvent('#mergeList .pdf-file-item:first-child', 'dragstart', { dataTransfer: dt });
    await page.dispatchEvent('#mergeList .pdf-file-item:nth-child(3)', 'dragover', { dataTransfer: dt });
    await page.dispatchEvent('#mergeList .pdf-file-item:nth-child(3)', 'drop', { dataTransfer: dt });
    await page.dispatchEvent('#mergeList .pdf-file-item:first-child', 'dragend', { dataTransfer: dt });

    await expect(page.locator('#mergeList .pdf-file-title').first()).toHaveText('b.pdf');
    await expect(page.locator('#mergeList .pdf-file-title').nth(1)).toHaveText('c.pdf');
    await expect(page.locator('#mergeList .pdf-file-title').nth(2)).toHaveText('a.pdf');

    await page.locator('#mergeBtn').click();
    await expect(page.locator('#mergeResultCard')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#mergeDownloadBtn').click()
    ]);
    const buffer = await downloadBuffer(download);
    const colors = await samplePdfPages(page, buffer);
    expect(colors).toEqual([[200, 140, 220], [90, 140, 220], [40, 140, 220]]);
  });

  test('merge blocks invalid PDFs with a friendly message', async ({ page }) => {
    await page.goto('/pdf-editor');
    await uploadPdf(page, '#mergeFileInput', Buffer.from('not a pdf at all'), 'fake.pdf');
    await expect(page.locator('#mergeList .pdf-file-item.has-error')).toHaveCount(1);
    await expect(page.locator('#mergeBtn')).toBeDisabled();
    await page.locator('#mergeList [data-remove]').click();
    await expect(page.locator('#mergeFilesCard')).toBeHidden();
  });

  test('split by ranges validates input and creates correct files', async ({ page }) => {
    await page.goto('/pdf-editor/split');
    await uploadPdf(page, '#splitFileInput', await makePdf(4), 'doc.pdf');
    await expect(page.locator('#splitFileMeta')).toContainText('4 pages');

    const errorCases = [
      ['0-3', 'start at 1'],
      ['8-4', 'not be greater'],
      ['abc', 'not a valid range'],
      ['1-9', 'only has 4 pages']
    ];
    for (const [value, message] of errorCases) {
      await page.locator('#splitRangesInput').fill(value);
      await expect(page.locator('#splitRangesError')).toBeVisible();
      await expect(page.locator('#splitRangesError')).toContainText(message);
      await expect(page.locator('#splitBtn')).toBeDisabled();
    }

    await page.locator('#splitRangesInput').fill('1-2, 4');
    await expect(page.locator('#splitRangesError')).toBeHidden();
    await expect(page.locator('#splitBtn')).toBeEnabled();
    await page.locator('#splitBtn').click();

    await expect(page.locator('#splitResultList .pdf-result-item')).toHaveCount(2);
    await expect(page.locator('#splitResultList .pdf-result-item').nth(1)).toContainText('1 page');
    await expect(page.locator('#splitResultMeta')).toContainText('3 pages');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#splitResultList [data-download="0"]').click()
    ]);
    expect(download.suggestedFilename()).toBe('split-1.pdf');
    const buffer = await downloadBuffer(download);
    expect(await pdfPageCount(buffer)).toBe(2);
    const colors = await samplePdfPages(page, buffer);
    expect(colors).toEqual(PAGE_COLORS(4).slice(0, 2));

    const [zipDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#splitDownloadAllBtn').click()
    ]);
    const zipBuf = await downloadBuffer(zipDownload);
    const zip = await JSZip.loadAsync(zipBuf);
    expect(Object.keys(zip.files).filter(n => !zip.files[n].dir).sort()).toEqual(['split-1.pdf', 'split-2.pdf']);
    const second = await zip.file('split-2.pdf').async('nodebuffer');
    expect(await pdfPageCount(second)).toBe(1);
  });

  test('split selected pages and every page modes', async ({ page }) => {
    await page.goto('/pdf-editor/split');
    await uploadPdf(page, '#splitFileInput', await makePdf(3), 'doc.pdf');

    await page.locator('input[name=splitMode][value=every]').check();
    await expect(page.locator('#splitBtn')).toBeEnabled();
    await page.locator('#splitBtn').click();
    await expect(page.locator('#splitResultList .pdf-result-item')).toHaveCount(3);

    await page.locator('#splitClearBtn').click();
    await uploadPdf(page, '#splitFileInput', await makePdf(3), 'doc.pdf');
    await page.locator('input[name=splitMode][value=selected]').check();
    await expect(page.locator('#splitPagesWrap')).toBeVisible();
    await expect(page.locator('#splitPageGrid .page-check')).toHaveCount(3);
    await expect(page.locator('#splitBtn')).toBeDisabled();

    await page.locator('#splitPageGrid input[value="3"]').check();
    await expect(page.locator('#splitBtn')).toBeEnabled();
    await page.locator('#splitBtn').click();
    await expect(page.locator('#splitResultList .pdf-result-item')).toHaveCount(1);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#splitResultList [data-download="0"]').click()
    ]);
    const buffer = await downloadBuffer(download);
    expect(await pdfPageCount(buffer)).toBe(1);
    const colors = await samplePdfPages(page, buffer);
    expect(colors).toEqual([PAGE_COLORS(3)[2]]);
  });

  test('compress reduces a noisy PDF and reports accurate sizes', async ({ page }) => {
    await page.goto('/pdf-editor/compress');
    const noisy = await makeNoisyPdf(2, 500);
    await uploadPdf(page, '#compressFileInput', noisy, 'scan.pdf');
    await expect(page.locator('#compressList .pdf-file-item')).toContainText('2 pages');

    await page.locator('#compressBtn').click();
    await expect(page.locator('#compressResultList .pdf-result-item')).toHaveCount(1);
    await expect(page.locator('#compressResultList .pdf-result-item')).toContainText('Reduction:');

    const meta = await page.locator('#compressResultList .pdf-result-meta').innerText();
    expect(meta).toContain('Original:');
    expect(meta).toContain('Compressed:');
    expect(meta).toMatch(/Reduction: [1-9]\d*%/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#compressResultList [data-download="0"]').click()
    ]);
    expect(download.suggestedFilename()).toBe('scan-compressed.pdf');
    const buffer = await downloadBuffer(download);
    expect(await pdfPageCount(buffer)).toBe(2);
    expect(buffer.length).toBeLessThan(noisy.length);
  });

  test('compress keeps the original when no meaningful reduction is possible', async ({ page }) => {
    await page.goto('/pdf-editor/compress');
    await uploadPdf(page, '#compressFileInput', await makePdf(1, { size: 150 }), 'small.pdf');
    await page.locator('#compressBtn').click();
    await expect(page.locator('#compressResultList .pdf-result-item')).toContainText('already compact');
    await expect(page.locator('#compressResultList .pdf-result-item')).toContainText('Reduction: 0%');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#compressResultList [data-download="0"]').click()
    ]);
    expect(download.suggestedFilename()).toBe('small.pdf');
    const buffer = await downloadBuffer(download);
    expect(await pdfPageCount(buffer)).toBe(1);
  });

  test('JPG to PDF converts images in order with page size options', async ({ page }) => {
    await page.goto('/pdf-editor/jpg-to-pdf');
    const jpg1 = await pngToJpeg(page, makePng(300, 400, () => [220, 60, 60]));
    const jpg2 = await pngToJpeg(page, makePng(300, 400, () => [60, 60, 220]));
    await page.setInputFiles('#jpgFileInput', [
      { name: 'photo1.jpg', mimeType: 'image/jpeg', buffer: jpg1 },
      { name: 'photo2.jpg', mimeType: 'image/jpeg', buffer: jpg2 }
    ]);
    await expect(page.locator('#jpgList .pdf-file-item')).toHaveCount(2);

    await page.locator('#jpgList .pdf-file-item').nth(1).locator('[data-move="up"]').click();
    await expect(page.locator('#jpgList .pdf-file-title').first()).toHaveText('photo2.jpg');

    await page.locator('input[name=jpgPageSize][value=letter]').check();
    await page.locator('#jpgToPdfBtn').click();
    await expect(page.locator('#jpgResultCard')).toBeVisible();
    await expect(page.locator('#jpgResultMeta')).toContainText('2 pages');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#jpgResultDownloadBtn').click()
    ]);
    expect(download.suggestedFilename()).toBe('images.pdf');
    const buffer = await downloadBuffer(download);
    expect(await pdfPageCount(buffer)).toBe(2);

    const doc = await PDFLib.PDFDocument.load(new Uint8Array(buffer));
    const size = doc.getPage(0).getSize();
    expect(Math.round(size.width)).toBe(612);
    expect(Math.round(size.height)).toBe(792);

    const colors = await samplePdfPages(page, buffer);
    expect(colors[0][2]).toBeGreaterThan(colors[0][0]);
    expect(colors[0][0]).toBeLessThan(100);
    expect(colors[1][0]).toBeGreaterThan(colors[1][2]);
    expect(colors[1][2]).toBeLessThan(100);
  });

  test('PDF to JPG converts selected pages with correct naming and quality', async ({ page }) => {
    await page.goto('/pdf-editor/pdf-to-jpg');
    await uploadPdf(page, '#jpgOutFileInput', await makePdf(3, { size: 200 }), 'document.pdf');
    await expect(page.locator('#jpgOutPageGrid .jpgout-page')).toHaveCount(3);

    await page.locator('.jpgout-page', { has: page.locator('input[value="2"]') }).click();
    await expect(page.locator('#jpgOutSelectedCount')).toHaveText('1');

    await page.locator('#jpgOutBtn').click();
    await expect(page.locator('#jpgOutResultList .pdf-result-item')).toHaveCount(1);
    await expect(page.locator('#jpgOutResultList .pdf-result-name')).toHaveText('document-page-2.jpg');
    await expect(page.locator('#jpgOutResultMeta')).toContainText('1 image');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#jpgOutResultList [data-download="0"]').click()
    ]);
    const buffer = await downloadBuffer(download);
    const { pixel, width, height } = await sampleJpegPixel(page, buffer);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(100);
    expect(pixel[2]).toBeGreaterThan(pixel[0]);
    expect(pixel[1]).toBeGreaterThan(100);
  });

  test('PDF to JPG Download All produces a ZIP with every page', async ({ page }) => {
    await page.goto('/pdf-editor/pdf-to-jpg');
    await uploadPdf(page, '#jpgOutFileInput', await makePdf(3, { size: 150 }), 'document.pdf');

    await page.locator('#jpgOutSelectAllBtn').click();
    await expect(page.locator('#jpgOutSelectedCount')).toHaveText('3');
    await page.locator('input[name=jpgOutQuality][value=custom]').check();
    await expect(page.locator('#jpgOutCustomWrap')).toBeVisible();
    await page.locator('#jpgOutDpi').fill('72');
    await expect(page.locator('#jpgOutDpiValue')).toHaveText('72');

    await page.locator('#jpgOutBtn').click();
    await expect(page.locator('#jpgOutResultList .pdf-result-item')).toHaveCount(3);

    const [zipDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#jpgOutDownloadAllBtn').click()
    ]);
    expect(zipDownload.suggestedFilename()).toBe('document-pages.zip');
    const zipBuf = await downloadBuffer(zipDownload);
    const zip = await JSZip.loadAsync(zipBuf);
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
    expect(names).toEqual(['document-page-1.jpg', 'document-page-2.jpg', 'document-page-3.jpg']);
    for (const name of names) {
      const buf = await zip.file(name).async('nodebuffer');
      expect(buf.length).toBeGreaterThan(100);
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
    }
  });

  test('merge rejects invalid PDFs and identifies them by name', async ({ page }) => {
    await page.goto('/pdf-editor');
    const damaged = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(128, 0x41)]);
    await page.setInputFiles('#mergeFileInput', { name: 'broken.pdf', mimeType: 'application/pdf', buffer: damaged });
    await expect(page.locator('#mergeList .pdf-file-item')).toHaveCount(1);
    await expect(page.locator('#mergeList .pdf-file-item')).toContainText('"broken.pdf"');
    await expect(page.locator('#mergeList .pdf-file-item')).toContainText('damaged or invalid');
    await expect(page.locator('#mergeBtn')).toBeDisabled();

    await uploadPdf(page, '#mergeFileInput', await makePdf(2), 'good.pdf');
    await expect(page.locator('#mergeList .pdf-file-item')).toHaveCount(2);
    await expect(page.locator('#mergeSummary')).toContainText('1 invalid file');
    await expect(page.locator('#mergeBtn')).toBeDisabled();
  });

  test('merge ignores non-PDF files in a mixed selection with a warning', async ({ page }) => {
    await page.goto('/pdf-editor');
    await page.setInputFiles('#mergeFileInput', [
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      { name: 'doc.pdf', mimeType: 'application/pdf', buffer: await makePdf(1) }
    ]);
    await expect(page.locator('#mergeList .pdf-file-item')).toHaveCount(1);
    await expect(page.locator('#pdfAlert')).toBeVisible();
    await expect(page.locator('#pdfAlert')).toContainText('Ignored 1 non-PDF file');
    await expect(page.locator('#pdfAlert')).toContainText('notes.txt');
  });

  test('split rejects duplicate ranges', async ({ page }) => {
    await page.goto('/pdf-editor/split');
    await uploadPdf(page, '#splitFileInput', await makePdf(4), 'doc.pdf');
    await page.locator('#splitRangesInput').fill('1-2, 1-2');
    await expect(page.locator('#splitRangesError')).toBeVisible();
    await expect(page.locator('#splitRangesError')).toContainText('listed more than once');
    await expect(page.locator('#splitBtn')).toBeDisabled();
  });

  test('compress and JPG to PDF actions are disabled until files are added', async ({ page }) => {
    await page.goto('/pdf-editor/compress');
    await expect(page.locator('#compressBtn')).toBeDisabled();
    await uploadPdf(page, '#compressFileInput', await makePdf(1), 'doc.pdf');
    await expect(page.locator('#compressBtn')).toBeEnabled();

    await page.goto('/pdf-editor/jpg-to-pdf');
    await expect(page.locator('#jpgToPdfBtn')).toBeDisabled();
    const jpg = await pngToJpeg(page, makePng(120, 120));
    await page.setInputFiles('#jpgFileInput', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await expect(page.locator('#jpgToPdfBtn')).toBeEnabled();
  });

  test('JPG to PDF applies EXIF orientation so rotated photos stay upright', async ({ page }) => {
    await page.goto('/pdf-editor/jpg-to-pdf');

    // Portrait 100x200 JPEG carrying EXIF orientation 6 (rotate 90° CW).
    const base = await pngToJpeg(page, makePng(100, 200, () => [200, 60, 60]));
    const rotated = jpegWithExifOrientation(base, 6);
    await page.setInputFiles('#jpgFileInput', { name: 'phone.jpg', mimeType: 'image/jpeg', buffer: rotated });
    await page.locator('input[name=jpgPageSize][value=original]').check();
    await page.locator('#jpgToPdfBtn').click();
    await expect(page.locator('#jpgResultCard')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#jpgResultDownloadBtn').click()
    ]);
    const buffer = await downloadBuffer(download);
    const doc = await PDFLib.PDFDocument.load(new Uint8Array(buffer));
    const rotatedSize = doc.getPage(0).getSize();
    expect(Math.round(rotatedSize.width)).toBe(200);
    expect(Math.round(rotatedSize.height)).toBe(100);
    await expect(page.locator('#jpgResultCard .pdf-result-eyebrow')).toHaveText('Images converted to PDF successfully.');

    // Plain JPEG (no EXIF) must keep its natural portrait dimensions.
    await page.locator('#jpgNewBtn').click();
    await page.setInputFiles('#jpgFileInput', { name: 'plain.jpg', mimeType: 'image/jpeg', buffer: base });
    await page.locator('#jpgToPdfBtn').click();
    const [download2] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#jpgResultDownloadBtn').click()
    ]);
    const buffer2 = await downloadBuffer(download2);
    const doc2 = await PDFLib.PDFDocument.load(new Uint8Array(buffer2));
    const plainSize = doc2.getPage(0).getSize();
    expect(Math.round(plainSize.width)).toBe(100);
    expect(Math.round(plainSize.height)).toBe(200);
  });

  test('all five PDF tools run without page or console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

    await page.goto('/pdf-editor');
    await uploadPdf(page, '#mergeFileInput', await makePdf(2), 'a.pdf');
    await uploadPdf(page, '#mergeFileInput', await makePdf(2, { base: 200 }), 'b.pdf');
    await page.locator('#mergeBtn').click();
    await expect(page.locator('#mergeResultCard')).toBeVisible();

    await page.goto('/pdf-editor/split');
    await uploadPdf(page, '#splitFileInput', await makePdf(3), 'doc.pdf');
    await page.locator('#splitRangesInput').fill('1-2, 3');
    await page.locator('#splitBtn').click();
    await expect(page.locator('#splitResultList .pdf-result-item')).toHaveCount(2);

    await page.goto('/pdf-editor/compress');
    await uploadPdf(page, '#compressFileInput', await makePdf(1), 'doc.pdf');
    await page.locator('#compressBtn').click();
    await expect(page.locator('#compressResultList .pdf-result-item')).toHaveCount(1);

    await page.goto('/pdf-editor/jpg-to-pdf');
    const jpg = await pngToJpeg(page, makePng(100, 100));
    await page.setInputFiles('#jpgFileInput', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await page.locator('#jpgToPdfBtn').click();
    await expect(page.locator('#jpgResultCard')).toBeVisible();

    await page.goto('/pdf-editor/pdf-to-jpg');
    await uploadPdf(page, '#jpgOutFileInput', await makePdf(2), 'doc.pdf');
    await page.locator('#jpgOutSelectAllBtn').click();
    await page.locator('#jpgOutBtn').click();
    await expect(page.locator('#jpgOutResultList .pdf-result-item')).toHaveCount(2);

    expect(errors).toEqual([]);
  });

  test('tool tabs switch panels and update the URL', async ({ page }) => {
    await page.goto('/pdf-editor');
    const tabs = { merge: 'panel-merge', split: 'panel-split', compress: 'panel-compress', 'jpg-to-pdf': 'panel-jpg-to-pdf', 'pdf-to-jpg': 'panel-pdf-to-jpg' };
    for (const [tool, panel] of Object.entries(tabs)) {
      await page.locator(`.pdf-tab[data-tool="${tool}"]`).click();
      await expect(page.locator(`#${panel}`)).toBeVisible();
      await expect(page).toHaveURL(tool === 'merge' ? /\/pdf-editor$/ : new RegExp(`/pdf-editor/${tool}$`));
      await expect(page.locator(`.pdf-tab[data-tool="${tool}"]`)).toHaveAttribute('aria-selected', 'true');
      for (const [other, otherPanel] of Object.entries(tabs)) {
        if (other !== tool) await expect(page.locator(`#${otherPanel}`)).toBeHidden();
      }
    }
  });

  test('subroutes restore the selected tool after a refresh', async ({ page }) => {
    await page.goto('/pdf-editor/compress');
    await expect(page.locator('#panel-compress')).toBeVisible();
    await page.reload();
    await expect(page.locator('#panel-compress')).toBeVisible();
    await expect(page.locator('.pdf-tab[data-tool="compress"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('theme toggle and mobile layout work on the PDF editor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pdf-editor');
    await expect(page.locator('#panel-merge')).toBeVisible();
    await expect(page.locator('.pdf-toolbar')).toBeVisible();
    await expect(page.locator('#mergeDropZone')).toBeVisible();
    await page.locator('#themeBtn').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#themeBtn').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  });
});