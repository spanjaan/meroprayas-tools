/* global MP */
/* exported ImageCompressor */
'use strict';

const ImageCompressor = (() => {
  const EXT = {
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  };

  const formatBytes = MP.formatBytes;
  const percentSaved = MP.percentSaved;

  // MIME type used for canvas encoding. 'image/jpg' is an alias of image/jpeg.
  const encodeType = (original, requested) => {
    if (requested === 'image/jpg') return 'image/jpeg';
    if (requested !== 'auto') return requested;
    if (['image/gif', 'image/bmp', 'image/svg+xml'].includes(original)) return 'image/webp';
    return original || 'image/webp';
  };

  // Filename extension. An explicit JPG/JPEG choice keeps its own extension,
  // 'auto' keeps the classic .jpg, and format fallbacks (e.g. WebP -> PNG on
  // Safari) use the extension of the actually encoded type.
  const fileExtension = (outType, requested, encodeType) => {
    if (outType === encodeType) {
      if (requested !== 'auto' && EXT[requested]) return EXT[requested];
      return EXT[outType] === 'jpeg' ? 'jpg' : EXT[outType];
    }
    return EXT[outType] || 'webp';
  };

  async function decode(file) {
    if ('createImageBitmap' in window) {
      try {
        // imageOrientation: 'from-image' is intentionally non-standard but is
        // required (and widely supported in Chromium/Safari) to honour EXIF
        // rotation so phone photos decode already upright.
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (_) { }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Could not decode image.'));
        img.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function sourceDimensions(source) {
    return {
      width: source.width || source.naturalWidth,
      height: source.height || source.naturalHeight
    };
  }

  function fitSize(width, height, maxWidth, maxHeight) {
    let scale = 1;
    if (maxWidth > 0) scale = Math.min(scale, maxWidth / width);
    if (maxHeight > 0) scale = Math.min(scale, maxHeight / height);
    return scale >= 1
      ? { width, height }
      : { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  const MAX_OUTPUT_DIM = 16384;
  const MAX_OUTPUT_AREA = 268435456; // 16384 × 16384 — common browser canvas limit

  function normalizeDimension(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(MAX_OUTPUT_DIM, n);
  }

  function capCanvasSize(width, height) {
    let w = Math.max(1, Math.min(MAX_OUTPUT_DIM, Math.round(width)));
    let h = Math.max(1, Math.min(MAX_OUTPUT_DIM, Math.round(height)));
    const area = w * h;
    if (area > MAX_OUTPUT_AREA) {
      const scale = Math.sqrt(MAX_OUTPUT_AREA / area);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    return { width: w, height: h };
  }

  // Exact fractions for the editor presets so 16:9 + 1080 → exactly 1920 × 1080,
  // while other crop shapes are handled by their numeric ratio.
  const EXACT_RATIOS = {
    '1': 1,
    '1.333333': 4 / 3,
    '1.777778': 16 / 9,
    '1.5': 3 / 2,
    '0.5625': 9 / 16
  };

  function normalizeRatio(value) {
    if (value == null || value === 'free' || value === '') return null;
    const key = String(value);
    if (key in EXACT_RATIOS) return EXACT_RATIOS[key];
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Single source of truth for the requested output dimensions.
  // A preset represents the height (shorter side for landscape); the width is
  // derived from the crop ratio. 1:1 always yields width = height = size.
  function calculateOutputDimensions(cropRatio, selectedSize, customWidth = null, customHeight = null) {
    if (selectedSize === 'custom') {
      const w = normalizeDimension(customWidth);
      const h = normalizeDimension(customHeight);
      return w && h ? capCanvasSize(w, h) : null;
    }
    const size = normalizeDimension(selectedSize);
    const ratio = normalizeRatio(cropRatio);
    if (!size || !ratio) return null;
    return capCanvasSize(Math.max(1, Math.ceil(size * ratio)), size);
  }

  function encodeCanvas(canvas, type, quality) {
    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), type, quality);
    });
  }

  async function render(file, settings, onProgress) {
    onProgress?.(10);
    const internalSource = !settings.source;
    const source = settings.source || await decode(file);
    const sourceSize = sourceDimensions(source);
    onProgress?.(25);

    const crop = settings.crop || { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
    const cropW = Math.max(1, Math.min(sourceSize.width, crop.width));
    const cropH = Math.max(1, Math.min(sourceSize.height, crop.height));
    const type = encodeType(file.type, settings.format);
    const rotation = ((settings.rotation || 0) % 360 + 360) % 360;

    let targetW = cropW;
    let targetH = cropH;
    if (Number(settings.width) > 0 && Number(settings.height) > 0) {
      const capped = capCanvasSize(settings.width, settings.height);
      targetW = capped.width;
      targetH = capped.height;
    }
    const fitted = fitSize(targetW, targetH, settings.maxWidth, settings.maxHeight);
    targetW = fitted.width;
    targetH = fitted.height;

    const swap = rotation === 90 || rotation === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? targetH : targetW;
    canvas.height = swap ? targetW : targetH;

    const ctx = canvas.getContext('2d', { alpha: type !== 'image/jpeg' });
    if (!ctx) throw new Error('Canvas is not available in this browser.');

    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    if (settings.flipH) ctx.scale(-1, 1);
    if (settings.flipV) ctx.scale(1, -1);
    ctx.drawImage(
      source,
      crop.x, crop.y, cropW, cropH,
      -targetW / 2, -targetH / 2, targetW, targetH
    );
    onProgress?.(72);

    if (internalSource) source.close?.();

    const quality = Math.max(0.1, Math.min(1, Number(settings.quality) / 100));
    let outType = type;
    let blob = await encodeCanvas(canvas, type, quality);
    // Safari on iOS cannot encode WebP from canvas; fall back to PNG.
    if (!blob && type !== 'image/png') {
      blob = await encodeCanvas(canvas, 'image/png');
      if (blob) outType = 'image/png';
    }
    if (!blob) throw new Error('Browser could not encode this image.');
    onProgress?.(100);

    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    return {
      blob,
      name: `${base}-compressed.${fileExtension(outType, settings.format, type)}`,
      width: canvas.width,
      height: canvas.height,
      type: outType,
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height
    };
  }

  // Solves the 3×3 homography mapping four source points onto four
  // destination points (both in TL, TR, BR, BL order) via an 8×8 linear
  // system. Returns a projector (x, y) => { x, y } or null when the
  // quadrilateral is degenerate.
  function computeHomography(src, dst) {
    const M = [];
    for (let i = 0; i < 4; i++) {
      const sx = src[i][0], sy = src[i][1], dx = dst[i][0], dy = dst[i][1];
      M.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx, dx]);
      M.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy, dy]);
    }
    for (let col = 0; col < 8; col++) {
      let pivot = col;
      for (let row = col + 1; row < 8; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
      }
      if (Math.abs(M[pivot][col]) < 1e-12) return null;
      if (pivot !== col) { const t = M[pivot]; M[pivot] = M[col]; M[col] = t; }
      const pv = M[col][col];
      for (let k = col; k <= 8; k++) M[col][k] /= pv;
      for (let row = 0; row < 8; row++) {
        if (row === col) continue;
        const f = M[row][col];
        if (f === 0) continue;
        for (let k = col; k <= 8; k++) M[row][k] -= f * M[col][k];
      }
    }
    const h = M.map(row => row[8]);
    return (x, y) => {
      const w = h[6] * x + h[7] * y + 1;
      return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
    };
  }

  // Warps the region inside `quad` (TL, TR, BR, BL in the source's pixel
  // space) into a straight rectangle of outW × outH using a true 4-point
  // perspective transform with bilinear sampling. Returns a canvas.
  function warpPerspective(source, quad, outW, outH) {
    const sw = source.width || source.naturalWidth;
    const sh = source.height || source.naturalHeight;
    if (!sw || !sh) throw new Error('Could not read the image for perspective correction.');
    const srcPts = quad.map(p => [Number(p.x), Number(p.y)]);
    const dstPts = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
    if (srcPts.some(p => !p.every(Number.isFinite))) throw new Error('Invalid perspective corners.');
    const toSource = computeHomography(dstPts, srcPts);
    if (!toSource) throw new Error('The selected corners form an invalid quadrilateral.');

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = sw;
    srcCanvas.height = sh;
    const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(source, 0, 0);
    const srcData = sctx.getImageData(0, 0, sw, sh).data;

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const octx = out.getContext('2d');
    const outData = octx.createImageData(outW, outH);
    const od = outData.data;

    // A projective transform maps straight lines onto straight lines, so the
    // inverse mapping along an output row is linear between its endpoints.
    // This makes the per-pixel warp exact and fast.
    for (let y = 0; y < outH; y++) {
      const t0 = toSource(0, y);
      const t1 = toSource(outW, y);
      const sxStep = (t1.x - t0.x) / outW;
      const syStep = (t1.y - t0.y) / outW;
      let sx = t0.x;
      let sy = t0.y;
      let o = y * outW * 4;
      for (let x = 0; x < outW; x++) {
        const cx = sx < 0 ? 0 : sx > sw - 1 ? sw - 1 : sx;
        const cy = sy < 0 ? 0 : sy > sh - 1 ? sh - 1 : sy;
        const x0 = Math.floor(cx);
        const y0 = Math.floor(cy);
        const x1 = x0 + 1 < sw ? x0 + 1 : x0;
        const y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const fx = cx - x0;
        const fy = cy - y0;
        const wx0 = 1 - fx, wy0 = 1 - fy;
        const i00 = (y0 * sw + x0) * 4;
        const i10 = (y0 * sw + x1) * 4;
        const i01 = (y1 * sw + x0) * 4;
        const i11 = (y1 * sw + x1) * 4;
        od[o] = srcData[i00] * wx0 * wy0 + srcData[i10] * fx * wy0 + srcData[i01] * wx0 * fy + srcData[i11] * fx * fy;
        od[o + 1] = srcData[i00 + 1] * wx0 * wy0 + srcData[i10 + 1] * fx * wy0 + srcData[i01 + 1] * wx0 * fy + srcData[i11 + 1] * fx * fy;
        od[o + 2] = srcData[i00 + 2] * wx0 * wy0 + srcData[i10 + 2] * fx * wy0 + srcData[i01 + 2] * wx0 * fy + srcData[i11 + 2] * fx * fy;
        od[o + 3] = srcData[i00 + 3] * wx0 * wy0 + srcData[i10 + 3] * fx * wy0 + srcData[i01 + 3] * wx0 * fy + srcData[i11 + 3] * fx * fy;
        o += 4;
        sx += sxStep;
        sy += syStep;
      }
    }
    octx.putImageData(outData, 0, 0);
    return out;
  }

  // ---- Auto document detection -------------------------------------------
  // A small client-side computer-vision pipeline (grayscale -> blur -> Otsu
  // threshold -> largest component -> convex hull -> polygon simplification)
  // that finds the dominant document-like quadrilateral in an image. All
  // coordinates are in the pixel space of the provided RGBA data.

  function blurGrayscale(gray, w, h) {
    const tmp = new Uint8Array(gray.length);
    const src = new Uint8Array(gray.length);
    src.set(gray);
    const kernel = [1, 4, 6, 4, 1];
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = 0; k < 5; k++) {
            const xx = x + k - 2 < 0 ? 0 : x + k - 2 > w - 1 ? w - 1 : x + k - 2;
            sum += src[row + xx] * kernel[k];
          }
          tmp[row + x] = sum / 16;
        }
      }
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = 0; k < 5; k++) {
            const yy = y + k - 2 < 0 ? 0 : y + k - 2 > h - 1 ? h - 1 : y + k - 2;
            sum += tmp[yy * w + x] * kernel[k];
          }
          src[row + x] = sum / 16;
        }
      }
    }
    return src;
  }

  function otsuThreshold(gray) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = -1, best = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > maxVar) { maxVar = v; best = t; }
    }
    return best;
  }

  function labelComponents(binary, w, h) {
    const labels = new Int32Array(binary.length);
    const stack = new Int32Array(binary.length);
    const comps = [];
    for (let start = 0; start < binary.length; start++) {
      if (!binary[start] || labels[start]) continue;
      const id = comps.length + 1;
      let count = 0, sp = 0;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      stack[sp++] = start;
      labels[start] = id;
      while (sp > 0) {
        const i = stack[--sp];
        count++;
        const x = i % w;
        const y = (i / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && binary[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack[sp++] = i - 1; }
        if (x < w - 1 && binary[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && binary[i - w] && !labels[i - w]) { labels[i - w] = id; stack[sp++] = i - w; }
        if (y < h - 1 && binary[i + w] && !labels[i + w]) { labels[i + w] = id; stack[sp++] = i + w; }
      }
      comps.push({ id, count, minX, minY, maxX, maxY });
    }
    return { labels, comps };
  }

  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // Visvalingam–Whyatt polygon simplification: repeatedly removes the vertex
  // whose removal changes the shape least (smallest triangle area) until only
  // four corners remain. Robust against the jogs rasterization introduces on
  // long, slanted edges.
  function simplifyToQuad(loop) {
    if (loop.length <= 4) return loop.slice();
    const n = loop.length;
    const prev = new Int32Array(n);
    const next = new Int32Array(n);
    const removed = new Uint8Array(n);
    const area = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      prev[i] = (i - 1 + n) % n;
      next[i] = (i + 1) % n;
    }
    const tri = i => {
      const a = loop[prev[i]], b = loop[i], c = loop[next[i]];
      return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    };
    for (let i = 0; i < n; i++) area[i] = tri(i);
    let remaining = n;
    while (remaining > 4) {
      let minI = -1, minA = Infinity;
      for (let i = 0; i < n; i++) {
        if (removed[i] || area[i] >= minA) continue;
        minA = area[i];
        minI = i;
      }
      if (minI < 0) break;
      removed[minI] = 1;
      const p = prev[minI], q = next[minI];
      next[p] = q;
      prev[q] = p;
      area[p] = tri(p);
      area[q] = tri(q);
      remaining--;
    }
    const out = [];
    for (let i = 0; i < n; i++) if (!removed[i]) out.push(loop[i]);
    return out;
  }

  function validateQuad(q) {
    if (q.length !== 4) return false;
    let area = 0;
    for (let i = 0; i < 4; i++) area += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1];
    if (Math.abs(area) < 1) return false;
    for (let i = 0; i < 4; i++) {
      const ax = q[i][0], ay = q[i][1];
      const bx = q[(i + 1) % 4][0], by = q[(i + 1) % 4][1];
      const cx = q[(i + 2) % 4][0], cy = q[(i + 2) % 4][1];
      const v1x = bx - ax, v1y = by - ay;
      const v2x = cx - bx, v2y = cy - by;
      const len = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
      if (len < 1e-6) return false;
      const cos = (v1x * v2x + v1y * v2y) / len;
      if (cos < -0.42 || cos > 0.42) return false;
    }
    return true;
  }

  // Orders the four hull corners into TL, TR, BR, BL.
  function orderQuad(q) {
    let area = 0;
    for (let i = 0; i < 4; i++) area += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1];
    let tl = 0;
    for (let i = 1; i < 4; i++) {
      if (q[i][0] + q[i][1] < q[tl][0] + q[tl][1]) tl = i;
    }
    const dir = area < 0 ? 3 : 1;
    const out = [];
    for (let k = 0; k < 4; k++) out.push({ x: q[(tl + k * dir + 4) % 4][0], y: q[(tl + k * dir + 4) % 4][1] });
    return out;
  }

  function largestDocumentQuad(binary, w, h, labels, comps) {
    let best = null;
    for (const c of comps) {
      if (c.count < w * h * 0.002) continue;
      // Ignore regions that run into the frame: they are the image itself,
      // not a document photographed inside it.
      if (c.minX <= 2 || c.minY <= 2 || c.maxX >= w - 3 || c.maxY >= h - 3) continue;
      if (!best || c.count > best.count) best = c;
    }
    if (!best) return null;
    const pts = [];
    for (let i = 0; i < binary.length; i++) {
      if (labels[i] === best.id) pts.push([i % w, (i / w) | 0]);
    }
    if (pts.length < 32) return null;
    const hull = convexHull(pts);
    if (hull.length < 4) return null;
    const quad = simplifyToQuad(hull);
    return validateQuad(quad) ? orderQuad(quad) : null;
  }

  // Pure image analysis: finds the largest document-like quadrilateral in an
  // RGBA pixel buffer. Returns [TL, TR, BR, BL] of {x, y} or null when no
  // suitable quadrilateral is found.
  function detectDocumentQuads(data, width, height) {
    if (!data || width < 20 || height < 20) return null;
    const n = width * height;
    const gray = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      gray[i] = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
    }
    const blurred = blurGrayscale(gray, width, height);
    const t = otsuThreshold(blurred);
    const fg = new Uint8Array(n);
    const bg = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      fg[i] = blurred[i] >= t ? 1 : 0;
      bg[i] = blurred[i] < t ? 1 : 0;
    }
    const fgLabels = labelComponents(fg, width, height);
    const fgQuad = largestDocumentQuad(fg, width, height, fgLabels.labels, fgLabels.comps);
    if (fgQuad) return fgQuad;
    // The document may be darker than its surroundings; retry inverted.
    const bgLabels = labelComponents(bg, width, height);
    return largestDocumentQuad(bg, width, height, bgLabels.labels, bgLabels.comps);
  }

  return { render, decode, formatBytes, percentSaved, calculateOutputDimensions, normalizeDimension, normalizeRatio, capCanvasSize, warpPerspective, detectDocumentQuads, encodeType, fileExtension };
})();
