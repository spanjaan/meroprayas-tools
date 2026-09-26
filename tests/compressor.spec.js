'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/compressor');
});

test.describe('helper functions', () => {
  test('formatBytes', async ({ page }) => {
    const result = await page.evaluate(() => ({
      zero: ImageCompressor.formatBytes(0),
      bytes: ImageCompressor.formatBytes(512),
      kb: ImageCompressor.formatBytes(1024),
      mb: ImageCompressor.formatBytes(1048576),
      nan: ImageCompressor.formatBytes(NaN)
    }));
    expect(result.zero).toBe('0 B');
    expect(result.bytes).toBe('512 B');
    expect(result.kb).toBe('1.00 KB');
    expect(result.mb).toBe('1.00 MB');
    expect(result.nan).toBe('—');
  });

  test('percentSaved', async ({ page }) => {
    const result = await page.evaluate(() => ({
      half: ImageCompressor.percentSaved(100, 50),
      zero: ImageCompressor.percentSaved(0, 0),
      grow: ImageCompressor.percentSaved(100, 200)
    }));
    expect(result.half).toBe(50);
    expect(result.zero).toBe(0);
    expect(result.grow).toBe(-100);
  });

  test('encodeType picks the selected format, else keeps the original', async ({ page }) => {
    const result = await page.evaluate(() => ({
      jpegAuto: ImageCompressor.encodeType('image/jpeg', 'auto'),
      pngAuto: ImageCompressor.encodeType('image/png', 'auto'),
      webpAuto: ImageCompressor.encodeType('image/webp', 'auto'),
      gifAuto: ImageCompressor.encodeType('image/gif', 'auto'),
      svgAuto: ImageCompressor.encodeType('image/svg+xml', 'auto'),
      unknownAuto: ImageCompressor.encodeType('image/tiff', 'auto'),
      jpgAlias: ImageCompressor.encodeType('image/png', 'image/jpg'),
      webpWins: ImageCompressor.encodeType('image/jpeg', 'image/webp'),
      pngWins: ImageCompressor.encodeType('image/jpeg', 'image/png')
    }));
    expect(result.jpegAuto).toBe('image/jpeg');
    expect(result.pngAuto).toBe('image/png');
    expect(result.webpAuto).toBe('image/webp');
    expect(result.gifAuto).toBe('image/webp');
    expect(result.svgAuto).toBe('image/webp');
    expect(result.unknownAuto).toBe('image/tiff');
    expect(result.jpgAlias).toBe('image/jpeg');
    expect(result.webpWins).toBe('image/webp');
    expect(result.pngWins).toBe('image/png');
  });

  test('calculateOutputDimensions uses exact ratios', async ({ page }) => {
    const result = await page.evaluate(() => ({
      hd1080: ImageCompressor.calculateOutputDimensions('1.777778', 1080),
      square: ImageCompressor.calculateOutputDimensions('1', 500),
      portrait: ImageCompressor.calculateOutputDimensions('0.5625', 1080),
      free: ImageCompressor.calculateOutputDimensions('free', 1080),
      custom: ImageCompressor.calculateOutputDimensions(null, 'custom', 300, 200),
      cap: ImageCompressor.normalizeDimension(20000)
    }));
    expect(result.hd1080).toEqual({ width: 1920, height: 1080 });
    expect(result.square).toEqual({ width: 500, height: 500 });
    expect(result.portrait).toEqual({ width: 608, height: 1080 });
    expect(result.free).toBeNull();
    expect(result.custom).toEqual({ width: 300, height: 200 });
    expect(result.cap).toBe(16384);
  });
});

test.describe('render pipeline', () => {
  test('PNG -> WebP encodes smaller with correct name and header', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(200, 30, 30)';
      ctx.fillRect(0, 0, 640, 480);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'photo.png', { type: 'image/png' });
      const out = await ImageCompressor.render(file, { format: 'image/webp', quality: 70 });
      const bytes = new Uint8Array(await out.blob.arrayBuffer()).slice(0, 4);
      return {
        original: file.size,
        outSize: out.blob.size,
        type: out.blob.type,
        name: out.name,
        width: out.width,
        height: out.height,
        header: Array.from(bytes)
      };
    });
    expect(result.type).toBe('image/webp');
    expect(result.outSize).toBeLessThan(result.original);
    expect(result.name).toBe('photo-compressed.webp');
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    expect(result.header).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  test('JPEG export fills transparency with white', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
      ctx.fillRect(20, 20, 30, 30);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'alpha.png', { type: 'image/png' });
      const out = await ImageCompressor.render(file, { format: 'image/jpeg', quality: 85 });
      const bmp = await createImageBitmap(out.blob);
      const probe = document.createElement('canvas');
      probe.width = bmp.width;
      probe.height = bmp.height;
      const pctx = probe.getContext('2d');
      pctx.drawImage(bmp, 0, 0);
      const px = pctx.getImageData(5, 5, 1, 1).data;
      bmp.close();
      return { type: out.blob.type, name: out.name, px: Array.from(px) };
    });
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('alpha-compressed.jpeg');
    expect(result.px[3]).toBe(255); // fully opaque
    expect(result.px[0]).toBeGreaterThan(240);
    expect(result.px[1]).toBeGreaterThan(240);
    expect(result.px[2]).toBeGreaterThan(240);
  });

  test('crop, rotation and flip are applied correctly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(200, 30, 30)';
      ctx.fillRect(0, 0, 320, 480);
      ctx.fillStyle = 'rgb(30, 80, 220)';
      ctx.fillRect(320, 0, 320, 480);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'split.png', { type: 'image/png' });
      const sample = async (settings) => {
        const out = await ImageCompressor.render(file, settings);
        const bmp = await createImageBitmap(out.blob);
        const probe = document.createElement('canvas');
        probe.width = bmp.width;
        probe.height = bmp.height;
        const pctx = probe.getContext('2d');
        pctx.drawImage(bmp, 0, 0);
        const px = Array.from(pctx.getImageData(Math.floor(probe.width * 0.1), Math.floor(probe.height / 2), 1, 1).data);
        bmp.close();
        return { width: out.width, height: out.height, px };
      };
      const leftCrop = await sample({ format: 'image/webp', crop: { x: 0, y: 0, width: 320, height: 480 } });
      const rightCrop = await sample({ format: 'image/webp', crop: { x: 320, y: 0, width: 320, height: 480 } });
      const rotated = await sample({ format: 'image/webp', crop: { x: 0, y: 0, width: 320, height: 240 }, rotation: 90 });
      const flipped = await sample({ format: 'image/webp', flipH: true, flipV: false });
      return { leftCrop, rightCrop, rotated, flipped };
    });
    expect(result.leftCrop.width).toBe(320);
    expect(result.leftCrop.px[0]).toBeGreaterThan(150); // red
    expect(result.rightCrop.width).toBe(320);
    expect(result.rightCrop.px[2]).toBeGreaterThan(150); // blue
    expect(result.rotated.width).toBe(240);
    expect(result.rotated.height).toBe(320);
    expect(result.flipped.px[2]).toBeGreaterThan(150); // flipH: left 10% now shows the blue half
    expect(result.flipped.px[0]).toBeLessThan(150);
  });

  test('auto format preserves PNG and caps oversized output', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'keep.png', { type: 'image/png' });
      const auto = await ImageCompressor.render(file, { format: 'auto', quality: 80 });
      const capped = await ImageCompressor.render(file, {
        format: 'auto', width: 99999, height: 99999, maxWidth: 200, maxHeight: 200
      });
      return { autoType: auto.blob.type, autoName: auto.name, cappedW: capped.width, cappedH: capped.height };
    });
    expect(result.autoType).toBe('image/png');
    expect(result.autoName).toBe('keep-compressed.png');
    expect(result.cappedW).toBeLessThanOrEqual(200);
    expect(result.cappedH).toBeLessThanOrEqual(200);
  });

  test.describe('perspective warp', () => {
    test('identity quad is a no-op that keeps corners and dims', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const quadrantCanvas = (w, h) => {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          const colors = [
            ['rgb(200, 30, 30)', 'rgb(30, 200, 40)'],
            ['rgb(240, 200, 30)', 'rgb(30, 80, 220)']
          ];
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const c = colors[y < h / 2 ? 0 : 1][x < w / 2 ? 0 : 1];
              ctx.fillStyle = c;
              ctx.fillRect(x, y, 1, 1);
            }
          }
          return canvas;
        };
        const sample = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
        const canvas = quadrantCanvas(100, 100);
        const out = ImageCompressor.warpPerspective(canvas,
          [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], 100, 100);
        return {
          w: out.width, h: out.height,
          tl: sample(out, 0, 0), tr: sample(out, 99, 0),
          br: sample(out, 99, 99), bl: sample(out, 0, 99)
        };
      });
      expect(result.w).toBe(100);
      expect(result.h).toBe(100);
      expect(result.tl[0]).toBeGreaterThan(150); // red
      expect(result.tl[2]).toBeLessThan(100);
      expect(result.tr[1]).toBeGreaterThan(150); // green
      expect(result.br[2]).toBeGreaterThan(150); // blue
      expect(result.bl[0]).toBeGreaterThan(150); // yellow
      expect(result.bl[2]).toBeLessThan(100);
    });

    test('trapezoid quad rectifies to a straight rectangle', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const quadrantCanvas = (w, h) => {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          const colors = [
            ['rgb(200, 30, 30)', 'rgb(30, 200, 40)'],
            ['rgb(240, 200, 30)', 'rgb(30, 80, 220)']
          ];
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const c = colors[y < h / 2 ? 0 : 1][x < w / 2 ? 0 : 1];
              ctx.fillStyle = c;
              ctx.fillRect(x, y, 1, 1);
            }
          }
          return canvas;
        };
        const sample = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
        const canvas = quadrantCanvas(100, 100);
        const out = ImageCompressor.warpPerspective(canvas,
          [{ x: 25, y: 0 }, { x: 75, y: 0 }, { x: 100, y: 99 }, { x: 0, y: 99 }], 100, 102);
// Row well inside the bottom edge samples the blue bottom half.
      const mid = sample(out, 50, 80);
      return {
        w: out.width, h: out.height,
        tl: sample(out, 0, 0), tr: sample(out, 99, 0),
        br: sample(out, 99, 101), bl: sample(out, 0, 101),
        mid
      };
      });
      // Corner mapping: output corners sample the exact source corners of the quad.
      expect(result.tl[0]).toBeGreaterThan(150); // source (25, 0) -> red
      expect(result.tl[2]).toBeLessThan(100);
      expect(result.tr[1]).toBeGreaterThan(150); // source (75, 0) -> green
      expect(result.br[2]).toBeGreaterThan(150); // source (100, 99) -> blue
      expect(result.bl[0]).toBeGreaterThan(150); // source (0, 99) -> yellow
      expect(result.bl[2]).toBeLessThan(100);
      // Row through the middle of the bottom edge samples the blue bottom half.
      expect(result.mid[2]).toBeGreaterThan(150);
    });

    test('degenerate quad is rejected', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        try {
          ImageCompressor.warpPerspective(canvas,
            [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }], 100, 100);
          return 'accepted';
        } catch (e) {
          return 'rejected';
        }
      });
      expect(result).toBe('rejected');
    });
  });

  test.describe('auto document detection', () => {
    const checkQuad = (detected, expected, tolerance = 6) => {
      expect(detected).not.toBeNull();
      expect(detected.length).toBe(4);
      detected.forEach((p, i) => {
        expect(Math.abs(p.x - expected[i][0])).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(p.y - expected[i][1])).toBeLessThanOrEqual(tolerance);
      });
    };

    test('finds a perspective-distorted landscape document', async ({ page }) => {
      const result = await page.evaluate(() => {
        const w = 640, h = 480;
        const quad = [[60, 70], [560, 40], [580, 440], [50, 430]];
        const data = new Uint8ClampedArray(w * h * 4);
        const inPoly = (px, py) => {
          let inside = false;
          for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
            const xi = quad[i][0], yi = quad[i][1], xj = quad[j][0], yj = quad[j][1];
            if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        };
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (inPoly(x, y)) { data[o] = 250; data[o + 1] = 250; data[o + 2] = 248; }
            else { data[o] = 42; data[o + 1] = 44; data[o + 2] = 52; }
            data[o + 3] = 255;
          }
        }
        return ImageCompressor.detectDocumentQuads(data, w, h);
      });
      checkQuad(result, [[60, 70], [560, 40], [580, 440], [50, 430]]);
    });

    test('finds a portrait document', async ({ page }) => {
      const result = await page.evaluate(() => {
        const w = 480, h = 640;
        const quad = [[50, 50], [420, 60], [430, 590], [40, 580]];
        const data = new Uint8ClampedArray(w * h * 4);
        const inPoly = (px, py) => {
          let inside = false;
          for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
            const xi = quad[i][0], yi = quad[i][1], xj = quad[j][0], yj = quad[j][1];
            if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        };
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (inPoly(x, y)) { data[o] = 252; data[o + 1] = 250; data[o + 2] = 245; }
            else { data[o] = 60; data[o + 1] = 62; data[o + 2] = 68; }
            data[o + 3] = 255;
          }
        }
        return ImageCompressor.detectDocumentQuads(data, w, h);
      });
      checkQuad(result, [[50, 50], [420, 60], [430, 590], [40, 580]]);
    });

    test('detects a document that is darker than its background', async ({ page }) => {
      const result = await page.evaluate(() => {
        const w = 640, h = 480;
        const quad = [[80, 60], [520, 90], [540, 400], [70, 420]];
        const data = new Uint8ClampedArray(w * h * 4);
        const inPoly = (px, py) => {
          let inside = false;
          for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
            const xi = quad[i][0], yi = quad[i][1], xj = quad[j][0], yj = quad[j][1];
            if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        };
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (inPoly(x, y)) { data[o] = 60; data[o + 1] = 62; data[o + 2] = 68; }
            else { data[o] = 235; data[o + 1] = 236; data[o + 2] = 240; }
            data[o + 3] = 255;
          }
        }
        return ImageCompressor.detectDocumentQuads(data, w, h);
      });
      checkQuad(result, [[80, 60], [520, 90], [540, 400], [70, 420]]);
    });

    test('returns null when no document-like quadrilateral exists', async ({ page }) => {
      const result = await page.evaluate(() => {
        const w = 320, h = 240;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 200; data[i + 1] = 30; data[i + 2] = 30; data[i + 3] = 255;
        }
        const solid = ImageCompressor.detectDocumentQuads(data, w, h);
        const noise = (() => {
          // Per-pixel white noise (independent of neighbours) so no large
          // connected region can form after thresholding.
          const rand = (x, y) => {
            let s = (x * 374761393 + y * 668265263) | 0;
            s = (s ^ (s >>> 13)) * 1274126177 | 0;
            return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
          };
          const d = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const v = 40 + Math.round(rand(x, y) * 200);
              const o = (y * w + x) * 4;
              d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
            }
          }
          return d;
        })();
        return {
          solid: ImageCompressor.detectDocumentQuads(solid, w, h),
          noise: ImageCompressor.detectDocumentQuads(noise, w, h)
        };
      });
      expect(result.solid).toBeNull();
      expect(result.noise).toBeNull();
    });

    test('rejects regions that run into the image frame', async ({ page }) => {
      const result = await page.evaluate(() => {
        const w = 400, h = 300;
        const inner = [[60, 50], [340, 50], [340, 250], [60, 250]];
        const inInner = (px, py) => {
          let inside = false;
          for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
            const xi = inner[i][0], yi = inner[i][1], xj = inner[j][0], yj = inner[j][1];
            if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        };
        // The whole frame is bright (single region touching every edge) with a
        // darker document inside: only the inner quad should be detected.
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (inInner(x, y)) { data[o] = 110; data[o + 1] = 112; data[o + 2] = 118; }
            else { data[o] = 248; data[o + 1] = 248; data[o + 2] = 246; }
            data[o + 3] = 255;
          }
        }
        const noInner = data.slice();
        for (let i = 0; i < noInner.length; i += 4) { noInner[i] = 248; noInner[i + 1] = 248; noInner[i + 2] = 246; }
        return {
          withInner: ImageCompressor.detectDocumentQuads(data, w, h),
          frameOnly: ImageCompressor.detectDocumentQuads(noInner, w, h)
        };
      });
      expect(result.frameOnly).toBeNull();
      expect(result.withInner).not.toBeNull();
      expect(result.withInner.length).toBe(4);
      const expected = [[60, 50], [340, 50], [340, 250], [60, 250]];
      result.withInner.forEach((p, i) => {
        expect(Math.abs(p.x - expected[i][0])).toBeLessThanOrEqual(6);
        expect(Math.abs(p.y - expected[i][1])).toBeLessThanOrEqual(6);
      });
    });
  });
});
