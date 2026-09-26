'use strict';

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Builds a valid RGB PNG in Node with no dependencies.
// pixelFn(x, y) -> [r, g, b]; defaults to solid red.
function makePng(width, height, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn ? pixelFn(x, y) : [200, 30, 30];
      const off = 1 + x * 3;
      row[off] = r;
      row[off + 1] = g;
      row[off + 2] = b;
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// 640x480 with a red left half and blue right half.
function makeSplitPng(width = 640, height = 480) {
  const half = Math.floor(width / 2);
  return makePng(width, height, (x) => (x < half ? [200, 30, 30] : [30, 80, 220]));
}

function pointInPoly(px, py, quad) {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const xi = quad[i][0], yi = quad[i][1], xj = quad[j][0], yj = quad[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Bright paper-like quadrilateral (perspective-distorted) on a dark desk.
function makeDocPng(width = 640, height = 480, quad = [[60, 70], [560, 40], [580, 440], [50, 430]]) {
  return makePng(width, height, (x, y) => (pointInPoly(x, y, quad) ? [250, 250, 248] : [42, 44, 52]));
}

function inputFiles(...args) {
  return args.map(({ name, width = 640, height = 480, split = false, doc = false, quad }) => ({
    name,
    mimeType: 'image/png',
    buffer: split ? makeSplitPng(width, height) : doc ? makeDocPng(width, height, quad) : makePng(width, height)
  }));
}

// Re-encodes a PNG buffer to JPEG inside the browser (canvas round-trip) so
// tests can upload real JPEG inputs without a Node-side JPEG encoder.
async function pngToJpeg(page, pngBuffer) {
  const bytes = await page.evaluate(async src => {
    const blob = new Blob([new Uint8Array(src)], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const jpeg = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    return Array.from(new Uint8Array(await jpeg.arrayBuffer()));
  }, [...pngBuffer]);
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------
// PDF fixtures (built with the vendored pdf-lib UMD build in Node)
// ---------------------------------------------------------------
const PDFLib = require('../vendor/pdf-lib.min.js');

function makeNoisePng(width, height, seed) {
  return makePng(width, height, (x, y) => [
    (x * 7 + y * 13 + seed * 29) % 256,
    (x * 11 + y * 5 + seed * 17) % 256,
    (x * 3 + y * 19 + seed * 23) % 256
  ]);
}

// Solid-colour pages: page i has colour [(base + i*step) % 255, 140, 220].
async function makePdf(pageCount, opts = {}) {
  const { size = 300, base = 40, step = 40 } = opts;
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const colour = [(base + i * step) % 255, 140, 220];
    const img = await doc.embedPng(makePng(size, size, () => colour));
    const page = doc.addPage([size, size]);
    page.drawImage(img, { x: 0, y: 0, width: size, height: size });
  }
  return Buffer.from(await doc.save());
}

// Noisy (hard-to-compress) pages, useful for testing real compression gains.
async function makeNoisyPdf(pageCount, size = 600) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const img = await doc.embedPng(makeNoisePng(size, size, i + 1));
    const page = doc.addPage([size, size]);
    page.drawImage(img, { x: 0, y: 0, width: size, height: size });
  }
  return Buffer.from(await doc.save());
}

async function pdfPageCount(buffer) {
  const doc = await PDFLib.PDFDocument.load(new Uint8Array(buffer));
  const count = doc.getPageCount();
  await doc.save();
  return count;
}

async function streamBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadBuffer(download) {
  const stream = await download.createReadStream();
  return streamBuffer(stream);
}

// Samples the centre pixel of every page of a PDF inside the browser (the
// app's own pdf.js + canvas), so tests can verify page order and content.
async function samplePdfPages(page, buffer) {
  const b64 = buffer.toString('base64');
  return page.evaluate(async b64 => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await window.pdfjsLib.getDocument({ data }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pdfPage = await doc.getPage(p);
      const viewport = pdfPage.getViewport({ scale: 0.25 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const ctx = canvas.getContext('2d');
      const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      out.push([d[0], d[1], d[2]]);
    }
    await doc.destroy();
    return out;
  }, b64);
}

async function sampleJpegPixel(page, buffer) {
  const b64 = buffer.toString('base64');
  return page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    bmp.close();
    return { pixel: [d[0], d[1], d[2]], width: canvas.width, height: canvas.height };
  }, b64);
}

// Inserts an EXIF APP1 segment (little-endian TIFF) carrying an orientation
// value into a JPEG buffer, right after the SOI marker. Orientation values:
// 1 = normal, 6 = rotate 90° clockwise, 8 = rotate 270° clockwise.
function jpegWithExifOrientation(jpegBytes, orientation) {
  const tiff = Buffer.alloc(26);
  tiff[0] = 0x49; tiff[1] = 0x49;         // 'II' little-endian
  tiff[2] = 0x2a; tiff[3] = 0x00;         // TIFF magic
  tiff.writeUInt32LE(8, 4);               // offset to IFD0
  tiff.writeUInt16LE(1, 8);               // one IFD entry
  tiff.writeUInt16LE(0x0112, 10);         // Orientation tag
  tiff.writeUInt16LE(3, 12);              // type: SHORT
  tiff.writeUInt32LE(1, 14);              // count: 1
  tiff.writeUInt16LE(orientation, 18);    // value
  tiff.writeUInt16LE(0, 20);              // padding
  tiff.writeUInt32LE(0, 22);              // next IFD offset
  const payload = Buffer.concat([Buffer.from('Exif\u0000\u0000', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4 + payload.length);
  app1[0] = 0xff; app1[1] = 0xe1;         // APP1 marker
  app1.writeUInt16BE(2 + payload.length, 2);
  payload.copy(app1, 4);
  return Buffer.concat([jpegBytes.subarray(0, 2), app1, jpegBytes.subarray(2)]);
}

module.exports = { makePng, makeSplitPng, makeDocPng, inputFiles, pngToJpeg, jpegWithExifOrientation, makePdf, makeNoisyPdf, pdfPageCount, downloadBuffer, samplePdfPages, sampleJpegPixel };
