'use strict';

const { test, expect } = require('@playwright/test');
const { inputFiles, makePng, makeDocPng, pngToJpeg } = require('./helpers');

async function addImage(page, options = {}) {
  await page.setInputFiles('#fileInput', inputFiles({ name: options.name || 'image.png', ...options }));
}

// Uploading opens the editor immediately for each image; Accept/Reject the
// queue so the images land in the list.
async function acceptEditors(page, count) {
  for (let i = 0; i < count; i++) {
    await expect(page.locator('#cropDialog')).toBeVisible();
    await page.locator('#applyCrop').click();
  }
  await expect(page.locator('#cropDialog')).not.toBeVisible();
}

test.describe('app flows', () => {
  test('upload opens the editor first, then the image joins the list', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'one.png', width: 640, height: 480 });
    await addImage(page, { name: 'two.png', width: 320, height: 240 });

    // The editor opens immediately for the first image, before it is listed.
    await expect(page.locator('#cropDialog')).toBeVisible();
    await expect(page.locator('.image-list-item')).toHaveCount(1);
    await expect(page.locator('.image-list-title').first()).toHaveText('one.png');

    await acceptEditors(page, 2);
    await expect(page.locator('.image-list-item')).toHaveCount(2);
    await expect(page.locator('#imageCountHeading')).toHaveText('2');

    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);
    await expect(page.locator('#downloadAllBtn')).toBeEnabled();
    await expect(page.locator('.image-list-item').first().locator('[data-download]')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.image-list-item').first().locator('[data-download]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('one-compressed.png');
  });

  test('changing quality invalidates the previous result', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page);

    await page.locator('#cancelCrop').click();
    await expect(page.locator('#cropDialog')).not.toBeVisible();

    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);

    await page.locator('[data-edit]').first().click();
    await page.locator('#quality').fill('60');
    await page.locator('#cancelCrop').click();

    await expect(page.locator('.image-list-item').first().locator('[data-download]')).toHaveCount(0);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pixelpress-settings')));
    expect(saved.quality).toBe(60);
  });

  test('batch compression processes every image', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'a.png' });
    await addImage(page, { name: 'b.png' });
    await acceptEditors(page, 2);

    await page.locator('#processAllBtn').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(2);
    await expect(page.locator('#summary')).toContainText('2 processed');
    await expect(page.locator('#summary')).toContainText('% smaller');
  });

  test('crop with a ratio preset applies and reopens with the lock restored', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'crop.png', width: 640, height: 480 });

    // Editor is already open for the fresh upload; the crop starts full-frame.
    await expect(page.locator('#cropDialog')).toBeVisible();
    await expect(page.locator('#cropCoordinates')).toContainText('W: 640 · H: 480');
    await page.locator('.aspect-btn[data-ratio="1.777778"]').click();
    await expect(page.locator('.aspect-btn[data-ratio="1.777778"]')).toHaveClass(/active/);
    await page.locator('#applyCrop').click();
    await expect(page.locator('#cropDialog')).not.toBeVisible();
    await expect(page.locator('.image-list-item').first().locator('.status-chip.edited')).toBeVisible();

    // Reopen: the 16:9 lock must come back, not be reset.
    await page.locator('[data-edit]').first().click();
    await expect(page.locator('.aspect-btn[data-ratio="1.777778"]')).toHaveClass(/active/);
    await page.locator('#cancelCrop').click();

    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);
    await expect(page.locator('.image-list-meta').first()).toContainText('640 × 360px');
  });

  test('rotation edits survive reopen and affect the output', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'rotate.png', width: 640, height: 480 });

    await page.locator('#cropRotateRight').click();
    await page.locator('#applyCrop').click();

    await page.locator('[data-edit]').first().click();
    await expect(page.locator('#cropCoordinates')).toContainText('X: 0 · Y: 0 · W: 480 · H: 640');
    await page.locator('#cancelCrop').click();

    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);
    await expect(page.locator('.image-list-meta').first()).toContainText('480 × 640px');
  });

  test('perspective correction warps, replaces the working image and is undoable', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'persp.png', width: 640, height: 480 });

    // Enter perspective mode: overlay appears, crop box hides.
    await page.locator('#perspModeBtn').click();
    await expect(page.locator('#perspOverlay')).toBeVisible();
    await expect(page.locator('#cropBox')).toBeHidden();
    await expect(page.locator('#perspApplyBtn')).toBeEnabled();

    // Drag the top-left corner inward and the top-right corner inward.
    const moveHandle = async (index, dx, dy) => {
      const handle = page.locator(`.persp-handle[data-index="${index}"]`);
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
      await page.mouse.up();
    };
    await moveHandle(0, -120, 60);
    await moveHandle(1, 120, 60);

    // Apply: the image is really transformed (output dims differ) and the
    // editor switches back to the crop box.
    await page.locator('#perspApplyBtn').click();
    await expect(page.locator('#perspOverlay')).toBeHidden();
    await expect(page.locator('#cropBox')).toBeVisible();
    await expect(page.locator('#cropSourceDims')).not.toContainText('640 × 480');

    // Undo restores the pre-warp working image; redo reapplies the warp.
    await page.locator('#cropUndo').click();
    await expect(page.locator('#cropSourceDims')).toContainText('640 × 480');
    await page.locator('#cropRedo').click();
    await expect(page.locator('#cropSourceDims')).not.toContainText('640 × 480');

    // The corrected image flows into the normal pipeline.
    await page.locator('#applyCrop').click();
    await expect(page.locator('.status-chip.edited').first()).toBeVisible();
    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);
  });

  test('perspective mode bakes pending crop edits into the working image', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'bake.png', width: 640, height: 480 });

    await page.locator('.aspect-btn[data-ratio="1.777778"]').click();
    await page.locator('#perspModeBtn').click();

    // The 16:9 crop is applied to the image data before the warp runs.
    await expect(page.locator('#cropSourceDims')).toContainText('640 × 360');

    // Cancel leaves the image untouched.
    await page.locator('#perspCancelBtn').click();
    await expect(page.locator('#cropBox')).toBeVisible();
    await expect(page.locator('#perspOverlay')).toBeHidden();
    await expect(page.locator('#cropSourceDims')).toContainText('640 × 360');
  });

  test('magnifier shows a zoomed view of the corner while dragging a handle', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'mag.png', width: 640, height: 480, split: true });

    await page.locator('#perspModeBtn').click();
    await expect(page.locator('#perspOverlay')).toBeVisible();

    // No magnifier before dragging.
    await expect(page.locator('#perspMagnifier')).toBeHidden();

    const handle = page.locator('.persp-handle[data-index="0"]');
    const box = await handle.boundingBox();
    const imgBox = await page.locator('#cropImage').boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('#perspMagnifier')).toBeVisible();

    // Drag the top-left corner into the blue half of the split image.
    await page.mouse.move(imgBox.x + imgBox.width * 0.75, imgBox.y + imgBox.height * 0.5, { steps: 5 });
    await page.waitForTimeout(150);
    const centerPixel = await page.evaluate(() => {
      const c = document.querySelector('#perspMagnifierCanvas');
      return Array.from(c.getContext('2d').getImageData(66, 66, 1, 1).data);
    });

    // The magnifier centre samples exactly the dragged corner: blue half.
    expect(centerPixel[2]).toBeGreaterThan(150);
    expect(centerPixel[0]).toBeLessThan(120);

    // Magnifier follows the drag, stays inside the stage.
    const pos = await page.evaluate(() => {
      const s = document.querySelector('#cropStage').getBoundingClientRect();
      const m = document.querySelector('#perspMagnifier').getBoundingClientRect();
      return { inside: m.left >= s.left && m.top >= s.top && m.right <= s.right && m.bottom <= s.bottom };
    });
    expect(pos.inside).toBe(true);

    await page.mouse.up();
    await expect(page.locator('#perspMagnifier')).toBeHidden();

    // Dragging another handle still works; ending hides it again.
    await page.locator('.persp-handle[data-index="1"]').hover();
    await page.mouse.down();
    await expect(page.locator('#perspMagnifier')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('#perspMagnifier')).toBeHidden();
  });

  test('arrow keys nudge the crop selection', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'nudge.png', width: 640, height: 480 });

    // Shrink the full-frame box with the 1:1 preset so it can be nudged.
    await page.locator('.aspect-btn[data-ratio="1"]').click();
    await expect(page.locator('#cropCoordinates')).toContainText('W: 480 · H: 480');

    await page.locator('#cropStage').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#cropCoordinates')).toContainText('X: 1');

    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('#cropCoordinates')).toContainText('X: 11');
  });

  test('removes images individually', async ({ page }) => {
    await page.goto('/compressor');
    page.on('dialog', d => d.accept());
    await addImage(page, { name: 'one.png' });
    await addImage(page, { name: 'two.png' });
    await acceptEditors(page, 2);

    await expect(page.locator('.image-list-item')).toHaveCount(2);
    await page.locator('.image-list-item').first().locator('[data-remove]').click();
    await expect(page.locator('.image-list-item')).toHaveCount(1);
    await expect(page.locator('.image-list-title').first()).toHaveText('two.png');

    await page.locator('.image-list-item').first().locator('[data-remove]').click();
    await expect(page.locator('#editorCard')).toBeHidden();
  });

  test('dismissing the removal confirmation keeps the image', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'keep.png' });
    await page.locator('#cancelCrop').click();
    await expect(page.locator('.image-list-item')).toHaveCount(1);

    page.on('dialog', d => d.dismiss());
    await page.locator('.image-list-item').first().locator('[data-remove]').click();
    await expect(page.locator('.image-list-item')).toHaveCount(1);
    await expect(page.locator('.image-list-title').first()).toHaveText('keep.png');
  });

  test('apply settings to all mirrors the selected quality and format', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'a.png', width: 640, height: 480 });
    await addImage(page, { name: 'b.png', width: 320, height: 240 });
    await acceptEditors(page, 2);

    await page.locator('[data-edit]').first().click();
    await page.locator('#quality').fill('60');
    await page.locator('#format').selectOption('image/webp');
    await page.locator('#applyAllBtn').click();

    await expect(page.locator('#editorSettingsSaved')).toContainText('Applied to 2 images');
    await expect(page.locator('.image-list-settings').nth(0)).toContainText('WEBP · 60% quality');
    await expect(page.locator('.image-list-settings').nth(1)).toContainText('WEBP · 60% quality');

    // Both records are invalidated and re-encode with the new settings.
    await page.locator('#cancelCrop').click();
    await page.locator('#processAllBtn').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(2);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.image-list-item').nth(1).locator('[data-download]').click();
    expect((await downloadPromise).suggestedFilename()).toBe('b-compressed.webp');
  });

  test('escape closes the preview but keeps the editor open', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'prev.png', width: 640, height: 480 });

    await page.locator('#cropPreviewBtn').click();
    await expect(page.locator('#cropPreviewOverlay')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#cropPreviewOverlay')).toBeHidden();
    await expect(page.locator('#cropDialog')).toBeVisible();

    // The next Escape closes the editor itself.
    await page.keyboard.press('Escape');
    await expect(page.locator('#cropDialog')).toBeHidden();
  });

  test('skip advances to the next queued image', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'one.png' });
    await addImage(page, { name: 'two.png' });

    await expect(page.locator('#cropDialog')).toBeVisible();
    await page.locator('#skipCrop').click();

    // First image lands in the list, the second editor opens.
    await expect(page.locator('.image-list-title').first()).toHaveText('one.png');
    await expect(page.locator('#cropDialog')).toBeVisible();

    await page.locator('#skipCrop').click();
    await expect(page.locator('#cropDialog')).not.toBeVisible();
    await expect(page.locator('.image-list-item')).toHaveCount(2);
  });

  test('arrow keys nudge a focused perspective handle', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'nudgep.png', width: 640, height: 480 });

    await page.locator('#perspModeBtn').click();
    await expect(page.locator('#perspOverlay')).toBeVisible();

    const leftOf = () => page.evaluate(() => parseFloat(document.querySelector('.persp-handle[data-index="0"]').style.left) || 0);
    const topOf = () => page.evaluate(() => parseFloat(document.querySelector('.persp-handle[data-index="0"]').style.top) || 0);

    await page.locator('.persp-handle[data-index="0"]').focus();
    await page.keyboard.press('ArrowRight');
    // 1px of 640 → +0.15625% of the displayed width.
    expect(await leftOf()).toBeGreaterThan(0.15);

    await page.keyboard.press('Shift+ArrowDown');
    expect(await topOf()).toBeGreaterThan(2);

    // Perspective mode stays active and the crop box never appears.
    await expect(page.locator('#cropBox')).toBeHidden();
    await expect(page.locator('#perspOverlay')).toBeVisible();
  });

  test('auto detect positions the perspective handles on the document corners', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'doc.png', width: 640, height: 480, doc: true });

    await page.locator('#perspModeBtn').click();
    await expect(page.locator('#perspOverlay')).toBeVisible();

    // Handles start at the image corners.
    const before = await page.evaluate(() =>
      [...document.querySelectorAll('.persp-handle')].map(h => `${h.style.left} ${h.style.top}`));

    await page.locator('#perspAutoBtn').click();

    // The top-left handle must travel from the corner toward the document.
    // Style positions are percentages of the displayed image.
    await expect.poll(async () => {
      const p = await page.evaluate(() => {
        const h = document.querySelector('.persp-handle[data-index="0"]');
        return parseFloat(h.style.left) || 0;
      });
      return p;
    }, { timeout: 10000 }).toBeGreaterThan(5);

    const handleBox = await page.locator('.persp-handle[data-index="0"]').boundingBox();
    const imgBox = await page.locator('#cropImage').boundingBox();
    // Document TL corner sits at (60, 70) of 640×480 → 9.375% / 14.58%.
    const xPct = ((handleBox.x + handleBox.width / 2 - imgBox.x) / imgBox.width) * 100;
    const yPct = ((handleBox.y + handleBox.height / 2 - imgBox.y) / imgBox.height) * 100;
    expect(Math.abs(xPct - 9.375)).toBeLessThanOrEqual(2.5);
    expect(Math.abs(yPct - 14.5833)).toBeLessThanOrEqual(2.5);

    // Not applied automatically: the Apply button is still the trigger.
    await expect(page.locator('#perspApplyBtn')).toBeEnabled();
    expect(before).not.toEqual(await page.evaluate(() =>
      [...document.querySelectorAll('.persp-handle')].map(h => `${h.style.left} ${h.style.top}`)));

    // The user can fine-tune (drag) and then apply as usual.
    await page.locator('.persp-handle[data-index="0"]').hover();
    await page.mouse.down();
    await page.mouse.move(imgBox.x + imgBox.width * 0.2, imgBox.y + imgBox.height * 0.15, { steps: 3 });
    await page.mouse.up();
    await page.locator('#perspApplyBtn').click();
    await expect(page.locator('#cropSourceDims')).not.toContainText('640 × 480');
  });

  test('auto detect failure keeps corners unchanged and shows a message', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'flat.png' }); // solid red: nothing to detect

    await page.locator('#perspModeBtn').click();
    await expect(page.locator('#perspOverlay')).toBeVisible();

    const before = await page.evaluate(() =>
      [...document.querySelectorAll('.persp-handle')].map(h => `${h.style.left} ${h.style.top}`));

    await page.locator('#perspAutoBtn').click();
    await expect(page.locator('#editorSettingsSaved')).toContainText('Could not detect document');

    const after = await page.evaluate(() =>
      [...document.querySelectorAll('.persp-handle')].map(h => `${h.style.left} ${h.style.top}`));
    expect(after).toEqual(before);

    // Handles remain fully draggable for manual adjustment (positions are %).
    const beforeLeft = parseFloat(before[0].split(' ')[0]) || 0;
    const imgBox = await page.locator('#cropImage').boundingBox();
    await page.locator('.persp-handle[data-index="0"]').hover();
    await page.mouse.down();
    await page.mouse.move(imgBox.x + imgBox.width * 0.3, imgBox.y + imgBox.height * 0.3, { steps: 3 });
    await page.mouse.up();
    const moved = await page.evaluate(() => {
      const h = document.querySelector('.persp-handle[data-index="0"]');
      return { left: parseFloat(h.style.left) || 0, top: parseFloat(h.style.top) || 0 };
    });
    expect(moved.left).toBeGreaterThan(beforeLeft + 20);
  });

  test('perspective correction preserves the JPEG working format', async ({ page }) => {
    await page.goto('/compressor');
    const jpeg = await pngToJpeg(page, makePng(640, 480));
    await page.setInputFiles('#fileInput', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.locator('#cropDialog')).toBeVisible();

    await page.locator('#perspModeBtn').click();
    await expect(page.locator('#perspOverlay')).toBeVisible();
    await page.locator('#perspApplyBtn').click();
    await expect(page.locator('#perspOverlay')).toBeHidden();

    // The working image stays JPEG: compress with auto format exports .jpg.
    await page.locator('#applyCrop').click();
    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.image-list-item').first().locator('[data-download]').click();
    expect((await downloadPromise).suggestedFilename()).toBe('photo-compressed.jpg');
  });

  test('selected output format wins over the original format in perspective', async ({ page }) => {
    await page.goto('/compressor');
    const jpeg = await pngToJpeg(page, makePng(640, 480));
    await page.setInputFiles('#fileInput', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.locator('#cropDialog')).toBeVisible();

    await page.locator('#format').selectOption('image/webp');
    await page.locator('#perspModeBtn').click();
    await page.locator('#perspApplyBtn').click();
    await expect(page.locator('#perspOverlay')).toBeHidden();

    await page.locator('#applyCrop').click();
    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.image-list-item').first().locator('[data-download]').click();
    expect((await downloadPromise).suggestedFilename()).toBe('photo-compressed.webp');
  });

  test('auto detect + apply perspective preserves the JPEG working format', async ({ page }) => {
    await page.goto('/compressor');
    const jpeg = await pngToJpeg(page, makeDocPng(640, 480));
    await page.setInputFiles('#fileInput', { name: 'doc.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.locator('#cropDialog')).toBeVisible();

    await page.locator('#perspModeBtn').click();
    await page.locator('#perspAutoBtn').click();
    await expect(page.locator('#editorSettingsSaved')).toContainText('Corners detected');
    await page.locator('#perspApplyBtn').click();
    await expect(page.locator('#perspOverlay')).toBeHidden();

    await page.locator('#applyCrop').click();
    await page.locator('.image-list-item').first().locator('[data-compress]').click();
    await expect(page.locator('.status-chip.done')).toHaveCount(1);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.image-list-item').first().locator('[data-download]').click();
    expect((await downloadPromise).suggestedFilename()).toBe('doc-compressed.jpg');
  });

  test('persists settings and theme across reloads', async ({ page }) => {
    await page.goto('/compressor');
    await addImage(page, { name: 'persist.png' });

    await page.locator('#quality').fill('45');
    await page.locator('#format').selectOption('image/webp');
    await page.locator('.size-btn[data-size="720"]').click();
    await page.locator('#applyCrop').click();

    await page.reload();
    await addImage(page, { name: 'persist2.png' });
    await expect(page.locator('#quality')).toHaveValue('45');
    await expect(page.locator('#format')).toHaveValue('image/webp');
    await expect(page.locator('.size-btn[data-size="720"]')).toHaveClass(/active/);
    await page.locator('#cancelCrop').click();

    // Theme persists too.
    await page.locator('#themeBtn').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('offline app shell works after service worker activation', async ({ page }) => {
    await page.goto('/compressor');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.locator('#dropZone')).toBeVisible();
    await page.context().setOffline(false);
  });
});
