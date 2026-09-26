/* global pdfjsLib, MP, Router */
/* exported PDFEditor */
'use strict';

const PDFEditor = (() => {
  const $ = id => document.getElementById(id);

  const STATE = {
    activeTool: null,
    busy: false,
    cancelRequested: false,
    libs: null,
    libsLoading: null,
    merge: { files: [], result: null },
    split: { file: null, pageCount: 0, mode: 'ranges', selected: new Set(), results: [] },
    compress: { files: [], results: [] },
    jpg: { files: [], result: null },
    jpgOut: { file: null, pageCount: 0, selected: new Set(), results: [] }
  };

  const A4 = [595.28, 841.89];
  const LETTER = [612, 792];
  const LEVELS = {
    high: { dpi: 100, quality: 0.55, label: 'High Compression' },
    balanced: { dpi: 130, quality: 0.75, label: 'Balanced' },
    low: { dpi: 170, quality: 0.92, label: 'Low Compression' }
  };
  const QUALITY_PRESETS = { low: 72, medium: 150, high: 300 };
  const SCRIPTS = ['vendor/pdf-lib.min.js', 'vendor/jszip.min.js', 'vendor/pdfjs/pdf.min.js'];

  class PdfError extends Error {
    constructor(message) { super(message); }
  }
  class PdfCancel extends Error { }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

  function escapeHtml(value) {
    return MP.escapeHtml(value);
  }

  function formatBytes(bytes) {
    return MP.formatBytes(bytes);
  }

  function percentReduction(before, after) {
    return MP.percentSaved(before, after);
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function friendlyError(err) {
    if (err instanceof PdfCancel) return null;
    if (err instanceof PdfError) return err.message;
    const name = (err && err.name || '').toLowerCase();
    const msg = (err && err.message || '').toLowerCase();
    if (name.includes('memory') || name.includes('quota') || err instanceof RangeError || msg.includes('allocate')) {
      return 'Not enough browser memory to process this file. Try a smaller file or fewer pages.';
    }
    if (name.includes('password') || msg.includes('password')) {
      return 'This PDF is password-protected and cannot be processed here. Please unlock the PDF and try again.';
    }
    if (msg.includes('invalid') || msg.includes('corrupt') || msg.includes('failed to parse') ||
      msg.includes('unexpected eof') || msg.includes('malformed')) {
      return 'This PDF appears to be damaged or invalid. Please choose another PDF.';
    }
    console.warn('MeroPrayas PDF error:', err);
    return 'Something went wrong while processing this file. Your files stayed on your device — try again or use a smaller file.';
  }

  function showAlert(message, type = 'error') {
    const el = $('pdfAlert');
    if (!el) return;
    el.textContent = message;
    el.dataset.type = type;
    el.hidden = false;
  }

  function hideAlert() {
    const el = $('pdfAlert');
    if (el) el.hidden = true;
  }

  // Proactive, advisory-only guard. When the device reports limited memory we
  // lower the size threshold and warn sooner, so users get a heads-up before a
  // large file can freeze the tab. Never blocks processing.
  function softMemoryGuard(bytes) {
    const mem = navigator.deviceMemory;
    const lowMem = typeof mem === 'number' && mem <= 4;
    if (bytes <= (lowMem ? 100 : 250) * 1024 * 1024) return null;
    return lowMem
      ? 'This device has limited memory and the file is large — processing may be slow or could run out of memory.'
      : 'One or more files are very large (over 250 MB). Processing may be slow or may run out of memory.';
  }

  function filesMemoryWarn(files) {
    let worst = 0;
    for (const f of files) if (f.size > worst) worst = f.size;
    return softMemoryGuard(worst);
  }

  function showJob(chip, text, pct, cancelable = true) {
    $('pdfJobCard').hidden = false;
    $('pdfJobChipText').textContent = chip;
    $('pdfJobText').textContent = text;
    const progress = $('pdfJobProgress');
    if (progress) progress.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, pct))));
    $('pdfJobBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    $('pdfJobCancelBtn').hidden = !cancelable;
    STATE.busy = true;
  }

  function setJob(pct, text) {
    const progress = $('pdfJobProgress');
    if (progress) progress.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, pct))));
    $('pdfJobBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (text) $('pdfJobText').textContent = text;
  }

  function hideJob() {
    $('pdfJobCard').hidden = true;
    STATE.busy = false;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (STATE.libs) return Promise.resolve(STATE.libs);
    if (STATE.libsLoading) return STATE.libsLoading;
    STATE.libsLoading = (async () => {
      for (const src of SCRIPTS) await loadScript(src);
      if (!window.PDFLib || !window.pdfjsLib || !window.JSZip) throw new Error('PDF libraries unavailable');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
      STATE.libs = { PDFLib: window.PDFLib, pdfjsLib: window.pdfjsLib, JSZip: window.JSZip };
      return STATE.libs;
    })();
    STATE.libsLoading.catch(() => { STATE.libsLoading = null; });
    return STATE.libsLoading;
  }

  async function withLibs(fn) {
    try {
      await ensureLibs();
    } catch (err) {
      console.warn('MeroPrayas PDF engine failed to load:', err);
      showAlert('Could not load the PDF engine. Check your connection and refresh the page.');
      return;
    }
    return fn();
  }

  async function readyEngine() {
    try {
      await ensureLibs();
      return true;
    } catch (err) {
      console.warn('MeroPrayas PDF engine failed to load:', err);
      showAlert('Could not load the PDF engine. Check your connection and refresh the page.');
      return false;
    }
  }

  function hasPdfMagic(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const max = Math.min(u8.length, 1024);
    for (let i = 0; i < max - 4; i++) {
      if (u8[i] === 0x25 && u8[i + 1] === 0x50 && u8[i + 2] === 0x44 && u8[i + 3] === 0x46) return true;
    }
    return false;
  }

  async function analyzePdf(file) {
    const data = await file.arrayBuffer();
    if (!hasPdfMagic(data)) throw new PdfError('This file does not look like a valid PDF. Only PDF files are supported here.');
    let doc;
    try {
      doc = await pdfjsLib.getDocument({ data }).promise;
    } catch (err) {
      if (err && err.name === 'PasswordException') throw new PdfError('This PDF is password-protected and cannot be processed here. Please unlock the PDF and try again.');
      throw new PdfError('This PDF appears to be damaged or invalid. Please choose another PDF.');
    }
    const pageCount = doc.numPages;
    await doc.destroy();
    return { pageCount, data };
  }

  async function renderPdfThumb(blobOrData, targetEl, max = 260) {
    const data = blobOrData instanceof Blob ? await blobOrData.arrayBuffer() : blobOrData;
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(max / base.width, max / base.height, 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.setAttribute('aria-hidden', 'true');
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    targetEl.appendChild(canvas);
    await doc.destroy();
  }

  // Renders a preview thumbnail, or shows a graceful fallback if the preview
  // cannot be generated (a failed preview must never break the result state).
  function renderPdfThumbSafe(targetEl, blobOrData) {
    renderPdfThumb(blobOrData, targetEl).catch(() => {
      if (targetEl && targetEl.isConnected) {
        targetEl.textContent = 'Preview unavailable. You can still download the processed file.';
      }
    });
  }

  async function decodeJpegWithOrientation(bytes) {
    // Re-encodes a JPEG so EXIF orientation metadata is applied to the pixels.
    // Phones and cameras often store rotation in EXIF; createImageBitmap
    // honours it, and re-encoding bakes the rotation into the image itself.
    try {
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
      canvas.width = 0;
      canvas.height = 0;
      if (!out) return null;
      return new Uint8Array(await out.arrayBuffer());
    } catch (_) {
      return null;
    }
  }

  function isJpegBytes(bytes) {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  function isPngBytes(bytes) {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }

  function wireDropZone(zoneId, inputId, btnId, onFiles) {
    const zone = $(zoneId);
    const input = $(inputId);
    const btn = $(btnId);
    if (!zone || !input || !btn) return;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { onFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault();
      zone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault();
      zone.classList.remove('dragover');
    }));
    zone.addEventListener('drop', e => {
      const items = e.dataTransfer.items;
      if (items && items.length) {
        const files = [...items].filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
        if (files.length) onFiles(files);
      } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
        onFiles(e.dataTransfer.files);
      }
    });
  }

  function wireReorderList(containerId, getItems, afterRender) {
    const container = $(containerId);
    if (!container) return;
    let dragIdx = -1;
    container.addEventListener('click', e => {
      const row = e.target.closest('.pdf-file-item');
      if (!row) return;
      const items = getItems();
      const idx = items.findIndex(it => it.id === row.dataset.id);
      if (idx === -1) return;
      const moveBtn = e.target.closest('[data-move]');
      if (moveBtn) {
        e.preventDefault();
        const swap = moveBtn.dataset.move === 'up' ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= items.length) return;
        [items[idx], items[swap]] = [items[swap], items[idx]];
        afterRender();
        return;
      }
      if (e.target.closest('[data-remove]')) {
        e.preventDefault();
        const [removed] = items.splice(idx, 1);
        if (removed.thumbUrl) URL.revokeObjectURL(removed.thumbUrl);
        afterRender();
      }
    });
    container.addEventListener('dragstart', e => {
      const row = e.target.closest('.pdf-file-item');
      if (!row) return;
      const items = getItems();
      dragIdx = items.findIndex(it => it.id === row.dataset.id);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', row.dataset.id); } catch (_) { }
    });
    container.addEventListener('dragover', e => {
      if (dragIdx === -1) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const row = e.target.closest('.pdf-file-item');
      container.querySelectorAll('.drop-target').forEach(r => r.classList.remove('drop-target'));
      if (row) row.classList.add('drop-target');
    });
    container.addEventListener('drop', e => {
      e.preventDefault();
      if (dragIdx === -1) return;
      const items = getItems();
      const row = e.target.closest('.pdf-file-item');
      let dropIdx = row ? items.findIndex(it => it.id === row.dataset.id) : items.length - 1;
      if (dropIdx === -1) dropIdx = items.length - 1;
      const [moved] = items.splice(dragIdx, 1);
      items.splice(dropIdx, 0, moved);
      afterRender();
    });
    container.addEventListener('dragend', () => {
      dragIdx = -1;
      container.querySelectorAll('.dragging,.drop-target').forEach(r => r.classList.remove('dragging', 'drop-target'));
    });
  }

  async function downloadZip(files, zipName) {
    try {
      const { JSZip } = STATE.libs;
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f.blob);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      downloadBlob(blob, zipName);
    } catch (err) {
      console.warn('MeroPrayas ZIP creation failed:', err);
      showAlert('Could not create the ZIP file. You can still download each file individually.');
    }
  }

  const mergeMeta = item => {
    if (item.error) return `<span class="pdf-inline-error">${escapeHtml(item.error)}</span>`;
    if (item.pageCount == null) return `${formatBytes(item.file.size)} · checking pages…`;
    return `${formatBytes(item.file.size)} · ${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`;
  };

  async function addMergeFiles(fileList) {
    if (STATE.busy) return;
    const dropped = [...fileList];
    const pdfs = dropped.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!(await readyEngine())) return;
    if (!pdfs.length) {
      showAlert('Only PDF files are supported here. Choose .pdf files or drag them onto the box.');
      return;
    }
    if (pdfs.length < dropped.length) {
      const rejected = dropped.filter(f => !pdfs.includes(f)).map(f => f.name);
      showAlert(`Ignored ${rejected.length} non-PDF ${rejected.length === 1 ? 'file' : 'files'}: ${rejected.slice(0, 2).join(', ')}${rejected.length > 2 ? '…' : ''}. Only PDF files were added.`, 'warn');
    } else if (filesMemoryWarn(pdfs)) {
      showAlert(filesMemoryWarn(pdfs), 'warn');
    } else {
      hideAlert();
    }
    const created = pdfs.map(f => ({ id: uid(), file: f, pageCount: null, error: null }));
    STATE.merge.files.push(...created);
    renderMergeList();
    await Promise.allSettled(created.map(async item => {
      try {
        const info = await analyzePdf(item.file);
        item.pageCount = info.pageCount;
      } catch (err) {
        item.error = `"${item.file.name}": ${friendlyError(err)}`;
      }
      renderMergeList();
    }));
  }

  function renderMergeList() {
    const list = $('mergeList');
    if (!list) return;
    list.innerHTML = STATE.merge.files.map((item, i) => `
      <article class="pdf-file-item ${item.error ? 'has-error' : ''}" draggable="true" data-id="${item.id}">
        <button class="pdf-grip" type="button" aria-label="Drag to reorder ${escapeHtml(item.file.name)}" title="Drag to reorder">
          <svg aria-hidden="true"><use href="#ic-grip" /></svg>
        </button>
        <span class="pdf-file-icon" aria-hidden="true">
          <svg><use href="#ic-file-text" /></svg>
        </span>
        <div class="pdf-file-main">
          <div class="pdf-file-title">${escapeHtml(item.file.name)}</div>
          <div class="pdf-file-meta">${mergeMeta(item)}</div>
        </div>
        <div class="pdf-file-actions">
          <button class="btn btn-ghost btn-small" type="button" data-move="up" aria-label="Move ${escapeHtml(item.file.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-ghost btn-small" type="button" data-move="down" aria-label="Move ${escapeHtml(item.file.name)} down" ${i === STATE.merge.files.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-ghost btn-small" type="button" data-remove aria-label="Remove ${escapeHtml(item.file.name)}">Remove</button>
        </div>
      </article>`).join('');
    const card = $('mergeFilesCard');
    if (card) card.hidden = !STATE.merge.files.length;
    const heading = $('mergeCountHeading');
    if (heading) heading.textContent = STATE.merge.files.length;
    const summary = $('mergeSummary');
    if (summary) {
      const invalid = STATE.merge.files.filter(f => f.error).length;
      summary.textContent = invalid
        ? `${invalid} invalid ${invalid === 1 ? 'file' : 'files'} — remove them to merge.`
        : 'Drag rows or use the arrow buttons to change the merge order.';
    }
    const btn = $('mergeBtn');
    if (btn) btn.disabled = !STATE.merge.files.length || !!STATE.merge.files.some(f => f.error);
  }

  async function runMerge() {
    if (STATE.busy) return;
    const files = [...STATE.merge.files];
    if (!files.length) {
      showAlert('Please add at least one PDF to continue.');
      return;
    }
    if (files.some(f => f.error)) {
      showAlert('One or more files could not be read as valid PDFs. Remove them before merging.');
      return;
    }
    const { PDFLib } = STATE.libs;
    const btn = $('mergeBtn');
    STATE.cancelRequested = false;
    showJob('Merging', 'Merging PDFs…', 2);
    btn.disabled = true;
    try {
      const out = await PDFLib.PDFDocument.create();
      let done = 0;
      for (const item of files) {
        if (STATE.cancelRequested) throw new PdfCancel();
        const data = await item.file.arrayBuffer();
        const src = await PDFLib.PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => out.addPage(p));
        done++;
        setJob(done / files.length * 100, `Merging ${item.file.name} (${done}/${files.length})…`);
      }
      const bytes = await out.save({ useObjectStreams: true });
      STATE.merge.result = {
        blob: new Blob([bytes], { type: 'application/pdf' }),
        pageCount: out.getPageCount(),
        size: bytes.length
      };
      renderMergeResult();
    } catch (err) {
      if (!(err instanceof PdfCancel)) showAlert(friendlyError(err));
    } finally {
      hideJob();
      btn.disabled = false;
    }
  }

  function renderMergeResult() {
    const result = STATE.merge.result;
    const card = $('mergeResultCard');
    if (!result || !card) return;
    card.hidden = false;
    $('mergeResultMeta').textContent = `${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'} · ${formatBytes(result.size)}`;
    const preview = $('mergePreview');
    preview.innerHTML = '';
    renderPdfThumbSafe(preview, result.blob);
    $('mergeDownloadBtn').onclick = () => downloadBlob(result.blob, 'merged.pdf');
  }

  function clearMerge() {
    if (STATE.busy) return;
    STATE.merge.files = [];
    STATE.merge.result = null;
    const input = $('mergeFileInput');
    if (input) input.value = '';
    renderMergeList();
    $('mergeResultCard').hidden = true;
    hideAlert();
  }

  function parseRanges(text, pageCount) {
    const tokens = text.split(/[\n,;]+/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return { ok: false, error: 'Enter at least one page range, for example 1-3, 5-8, 10.' };
    const ranges = [];
    for (const token of tokens) {
      const m = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return { ok: false, error: `"${token}" is not a valid range. Use formats like 1-3, 5-8 or 10.` };
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      if (a < 1 || b < 1) return { ok: false, error: `"${token}": page numbers start at 1.` };
      if (a > b) return { ok: false, error: `"${token}": the start page must not be greater than the end page.` };
      if (b > pageCount) return { ok: false, error: `"${token}": this PDF only has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.` };
      const dup = ranges.find(r => r[0] === a && r[1] === b);
      if (dup) return { ok: false, error: `Range "${token}" is listed more than once. Remove the duplicate to continue.` };
      ranges.push([a, b]);
    }
    return { ok: true, ranges };
  }

  function validateSplit() {
    const mode = STATE.split.mode;
    const btn = $('splitBtn');
    const hint = $('splitBtnHint');
    const errorEl = $('splitRangesError');
    if (!btn || !hint || !errorEl) return;
    if (mode === 'ranges') {
      const parsed = parseRanges($('splitRangesInput').value, STATE.split.pageCount);
      errorEl.textContent = parsed.ok ? '' : parsed.error;
      errorEl.hidden = parsed.ok;
      btn.disabled = !parsed.ok;
      hint.textContent = parsed.ok ? 'Split the PDF into one file per range.' : 'Fix the highlighted range to continue.';
    } else if (mode === 'selected') {
      btn.disabled = !STATE.split.selected.size;
      hint.textContent = STATE.split.selected.size
        ? `${STATE.split.selected.size} ${STATE.split.selected.size === 1 ? 'page' : 'pages'} selected — one file will be created.`
        : 'Select at least one page.';
      errorEl.hidden = true;
    } else {
      btn.disabled = false;
      hint.textContent = `One PDF per page — ${STATE.split.pageCount} ${STATE.split.pageCount === 1 ? 'file' : 'files'}.`;
      errorEl.hidden = true;
    }
  }

  function renderSplitPageGrid() {
    const grid = $('splitPageGrid');
    if (!grid) return;
    const count = STATE.split.pageCount;
    grid.innerHTML = Array.from({ length: count }, (_, i) => `
      <label class="page-check">
        <input type="checkbox" value="${i + 1}">
        <span>${i + 1}</span>
      </label>`).join('');
    grid.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = STATE.split.selected.has(Number(cb.value));
      cb.addEventListener('change', () => {
        const page = Number(cb.value);
        if (cb.checked) STATE.split.selected.add(page);
        else STATE.split.selected.delete(page);
        validateSplit();
      });
    });
  }

  function firstFile(file) {
    if (!file) return null;
    return typeof file.length === 'number' ? file[0] : file;
  }

  async function addSplitFile(file) {
    if (STATE.busy) return;
    const target = firstFile(file);
    if (!target) return;
    if (!(await readyEngine())) return;
    if (!(target.type === 'application/pdf' || /\.pdf$/i.test(target.name))) {
      showAlert('Only PDF files are supported here.');
      return;
    }
    if (softMemoryGuard(target.size)) {
      showAlert(softMemoryGuard(target.size), 'warn');
    } else {
      hideAlert();
    }
    try {
      const info = await analyzePdf(target);
      STATE.split.file = target;
      STATE.split.pageCount = info.pageCount;
      STATE.split.selected = new Set();
      STATE.split.results = [];
      STATE.split.mode = 'ranges';
      $('splitFileName').textContent = target.name;
      $('splitFileMeta').textContent = `${formatBytes(target.size)} · ${info.pageCount} ${info.pageCount === 1 ? 'page' : 'pages'}`;
      $('splitFilesCard').hidden = false;
      $('splitResultsCard').hidden = true;
      $('splitRangesInput').value = '';
      $('splitRangesWrap').hidden = false;
      $('splitPagesWrap').hidden = true;
      document.querySelectorAll('input[name=splitMode]').forEach(r => {
        r.checked = r.value === 'ranges';
      });
      renderSplitPageGrid();
      validateSplit();
    } catch (err) {
      showAlert(friendlyError(err));
    }
  }

  async function runSplit() {
    if (STATE.busy) return;
    const { PDFLib } = STATE.libs;
    const mode = STATE.split.mode;
    let ranges = [];
    if (mode === 'ranges') {
      const parsed = parseRanges($('splitRangesInput').value, STATE.split.pageCount);
      if (!parsed.ok) { showAlert(parsed.error); return; }
      ranges = parsed.ranges;
    } else if (mode === 'selected') {
      if (!STATE.split.selected.size) { showAlert('Select at least one page to extract.'); return; }
      ranges = [...STATE.split.selected].sort((a, b) => a - b).map(p => [p, p]);
    } else {
      ranges = Array.from({ length: STATE.split.pageCount }, (_, i) => [i + 1, i + 1]);
    }
    if (STATE.split.pageCount > 500) {
      showAlert('This PDF has more than 500 pages. Splitting it may take very long or run out of memory.', 'warn');
      return;
    }
    STATE.cancelRequested = false;
    showJob('Splitting', 'Splitting PDF…', 2);
    const btn = $('splitBtn');
    btn.disabled = true;
    try {
      const data = await STATE.split.file.arrayBuffer();
      const srcDoc = await PDFLib.PDFDocument.load(data, { ignoreEncryption: true });
      const outFiles = [];
      for (let i = 0; i < ranges.length; i++) {
        if (STATE.cancelRequested) throw new PdfCancel();
        const [a, b] = ranges[i];
        const out = await PDFLib.PDFDocument.create();
        const indices = Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k);
        const pages = await out.copyPages(srcDoc, indices);
        pages.forEach(p => out.addPage(p));
        const bytes = await out.save({ useObjectStreams: true });
        outFiles.push({
          name: `split-${i + 1}.pdf`,
          blob: new Blob([bytes], { type: 'application/pdf' }),
          pageCount: pages.length,
          size: bytes.length
        });
        setJob((i + 1) / ranges.length * 100, `Creating split-${i + 1}.pdf (${i + 1}/${ranges.length})…`);
      }
      STATE.split.results = outFiles;
      renderSplitResults();
    } catch (err) {
      if (!(err instanceof PdfCancel)) showAlert(friendlyError(err));
    } finally {
      hideJob();
      btn.disabled = false;
    }
  }

  function renderSplitResults() {
    const results = STATE.split.results;
    const card = $('splitResultsCard');
    if (!results.length || !card) return;
    card.hidden = false;
    $('splitResultCount').textContent = results.length;
    const totalPages = results.reduce((s, r) => s + r.pageCount, 0);
    const totalSize = results.reduce((s, r) => s + r.size, 0);
    $('splitResultMeta').textContent = `${totalPages} ${totalPages === 1 ? 'page' : 'pages'} in total · ${formatBytes(totalSize)}`;
    const list = $('splitResultList');
    list.innerHTML = results.map((r, i) => `
      <article class="pdf-result-item">
        <div class="pdf-result-thumb" data-thumb></div>
        <div class="pdf-result-name">${escapeHtml(r.name)}</div>
        <div class="pdf-result-meta">${r.pageCount} ${r.pageCount === 1 ? 'page' : 'pages'} · ${formatBytes(r.size)}</div>
        <button class="btn btn-ghost btn-small" type="button" data-download="${i}">Download</button>
      </article>`).join('');
    list.querySelectorAll('[data-thumb]').forEach((el, i) => {
      renderPdfThumbSafe(el, results[i].blob);
    });
    list.querySelectorAll('[data-download]').forEach(b => {
      b.addEventListener('click', () => downloadBlob(results[Number(b.dataset.download)].blob, results[Number(b.dataset.download)].name));
    });
    $('splitDownloadAllBtn').onclick = () => withLibs(() => downloadZip(STATE.split.results, 'split-files.zip'));
  }

  function clearSplit() {
    if (STATE.busy) return;
    STATE.split.file = null;
    STATE.split.pageCount = 0;
    STATE.split.selected = new Set();
    STATE.split.results = [];
    $('splitFilesCard').hidden = true;
    $('splitResultsCard').hidden = true;
    $('splitFileInput').value = '';
    hideAlert();
  }

  const compressMeta = item => {
    if (item.error) return `<span class="pdf-inline-error">${escapeHtml(item.error)}</span>`;
    if (item.pageCount == null) return `${formatBytes(item.file.size)} · checking pages…`;
    return `${formatBytes(item.file.size)} · ${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`;
  };

  async function addCompressFiles(fileList) {
    if (STATE.busy) return;
    const dropped = [...fileList];
    const pdfs = dropped.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!(await readyEngine())) return;
    if (!pdfs.length) {
      showAlert('Only PDF files are supported here. Choose .pdf files or drag them onto the box.');
      return;
    }
    if (pdfs.length < dropped.length) {
      const rejected = dropped.filter(f => !pdfs.includes(f)).map(f => f.name);
      showAlert(`Ignored ${rejected.length} non-PDF ${rejected.length === 1 ? 'file' : 'files'}: ${rejected.slice(0, 2).join(', ')}${rejected.length > 2 ? '…' : ''}. Only PDF files were added.`, 'warn');
    } else if (filesMemoryWarn(pdfs)) {
      showAlert(filesMemoryWarn(pdfs), 'warn');
    } else {
      hideAlert();
    }
    const created = pdfs.map(f => ({ id: uid(), file: f, pageCount: null, error: null }));
    STATE.compress.files.push(...created);
    renderCompressList();
    await Promise.allSettled(created.map(async item => {
      try {
        const info = await analyzePdf(item.file);
        item.pageCount = info.pageCount;
      } catch (err) {
        item.error = `"${item.file.name}": ${friendlyError(err)}`;
      }
      renderCompressList();
    }));
  }

  function renderCompressList() {
    const list = $('compressList');
    if (!list) return;
    list.innerHTML = STATE.compress.files.map(item => `
      <article class="pdf-file-item ${item.error ? 'has-error' : ''}" data-id="${item.id}">
        <span class="pdf-file-icon" aria-hidden="true">
          <svg><use href="#ic-file-text" /></svg>
        </span>
        <div class="pdf-file-main">
          <div class="pdf-file-title">${escapeHtml(item.file.name)}</div>
          <div class="pdf-file-meta">${compressMeta(item)}</div>
        </div>
        <div class="pdf-file-actions">
          <button class="btn btn-ghost btn-small" type="button" data-remove aria-label="Remove ${escapeHtml(item.file.name)}">Remove</button>
        </div>
      </article>`).join('');
    list.querySelectorAll('[data-remove]').forEach(b => {
      b.addEventListener('click', () => {
        STATE.compress.files = STATE.compress.files.filter(f => f.id !== b.closest('.pdf-file-item').dataset.id);
        renderCompressList();
      });
    });
    const card = $('compressFilesCard');
    if (card) card.hidden = !STATE.compress.files.length;
    const heading = $('compressCountHeading');
    if (heading) heading.textContent = STATE.compress.files.length;
    const invalid = STATE.compress.files.filter(f => f.error).length;
    const summary = $('compressSummary');
    if (summary) {
      summary.textContent = invalid
        ? `${invalid} invalid ${invalid === 1 ? 'file' : 'files'} — remove them to continue.`
        : 'Choose a compression level, then press Compress PDF.';
    }
    const btn = $('compressBtn');
    if (btn) btn.disabled = !STATE.compress.files.length;
  }

  async function compressPdf(file, level) {
    const { PDFLib, pdfjsLib } = STATE.libs;
    const data = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    const pageCount = pdfDoc.numPages;
    if (pageCount > 500) {
      await pdfDoc.destroy();
      throw new PdfError('This PDF has more than 500 pages. Compressing it may run out of memory — try a smaller document.');
    }
    const out = await PDFLib.PDFDocument.create();
    try {
      for (let i = 1; i <= pageCount; i++) {
        if (STATE.cancelRequested) throw new PdfCancel();
        const page = await pdfDoc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(level.dpi / 72, 3000 / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: ctx, viewport }).promise;
        const jpegBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', level.quality));
        canvas.width = 0;
        canvas.height = 0;
        if (!jpegBlob) throw new PdfError('Could not encode this page as JPEG.');
        const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
        const img = await out.embedJpg(jpegBytes);
        const p = out.addPage([base.width, base.height]);
        p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
        setJob(i / pageCount * 100, `Compressing page ${i}/${pageCount}…`);
      }
    } finally {
      await pdfDoc.destroy();
    }
    const bytes = await out.save({ useObjectStreams: true });
    return { blob: new Blob([bytes], { type: 'application/pdf' }), pageCount };
  }

  async function runCompress() {
    if (STATE.busy) return;
    const files = [...STATE.compress.files];
    if (!files.length) {
      showAlert('Please add at least one PDF to continue.');
      return;
    }
    if (files.some(f => f.error)) {
      showAlert('One or more files could not be read as valid PDFs. Remove them before compressing.');
      return;
    }
    const levelName = document.querySelector('input[name=compressLevel]:checked').value;
    const level = LEVELS[levelName];
    STATE.cancelRequested = false;
    showJob(level.label, 'Compressing PDF…', 2);
    const btn = $('compressBtn');
    btn.disabled = true;
    try {
      STATE.compress.results = [];
      for (let i = 0; i < files.length; i++) {
        if (STATE.cancelRequested) throw new PdfCancel();
        const item = files[i];
        setJob(i / files.length * 100, `Processing ${item.file.name}…`);
        const out = await compressPdf(item.file, level);
        const original = item.file.size;
        const compressed = out.blob.size;
        const gain = compressed < original * 0.97;
        const base = item.file.name.replace(/\.pdf$/i, '') || 'document';
        STATE.compress.results.push({
          name: gain ? `${base}-compressed.pdf` : item.file.name,
          blob: gain ? out.blob : item.file,
          pageCount: out.pageCount,
          size: gain ? compressed : original,
          original,
          compressed,
          gain
        });
      }
      renderCompressResults(level.label);
    } catch (err) {
      if (!(err instanceof PdfCancel)) showAlert(friendlyError(err));
    } finally {
      hideJob();
      btn.disabled = false;
    }
  }

  function renderCompressResults(levelLabel) {
    const results = STATE.compress.results;
    const card = $('compressResultsCard');
    if (!results.length || !card) return;
    card.hidden = false;
    const totalBefore = results.reduce((s, r) => s + r.original, 0);
    const totalAfter = results.reduce((s, r) => s + r.size, 0);
    $('compressResultsMeta').textContent =
      `Level: ${levelLabel} · Total: ${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} · reduced ${percentReduction(totalBefore, totalAfter)}%`;
    const list = $('compressResultList');
    list.innerHTML = results.map((r, i) => `
      <article class="pdf-result-item compress-result ${r.gain ? '' : 'no-gain'}">
        <div class="pdf-result-thumb" data-thumb></div>
        <div class="pdf-result-name">${escapeHtml(r.name)}</div>
        <div class="pdf-result-meta">
          Original: ${formatBytes(r.original)} · ${r.gain ? 'Compressed' : 'Size kept'}: ${formatBytes(r.size)}<br>
          Reduction: <strong>${r.gain ? percentReduction(r.original, r.size) + '%' : '0%'}</strong>
          ${r.gain ? '' : '<br><span class="pdf-note">This PDF is already compact and could not be reduced further without increasing its size. The original file is kept so your download stays valid.</span>'}
        </div>
        <button class="btn btn-ghost btn-small" type="button" data-download="${i}">Download</button>
      </article>`).join('');
    list.querySelectorAll('[data-thumb]').forEach((el, i) => {
      renderPdfThumbSafe(el, results[i].blob);
    });
    list.querySelectorAll('[data-download]').forEach(b => {
      b.addEventListener('click', () => downloadBlob(results[Number(b.dataset.download)].blob, results[Number(b.dataset.download)].name));
    });
  }

  function clearCompress() {
    if (STATE.busy) return;
    STATE.compress.files = [];
    STATE.compress.results = [];
    const input = $('compressFileInput');
    if (input) input.value = '';
    renderCompressList();
    $('compressResultsCard').hidden = true;
    hideAlert();
  }

  async function addJpgFiles(fileList) {
    if (STATE.busy) return;
    const dropped = [...fileList];
    const images = dropped.filter(f => /\.(jpe?g|png)$/i.test(f.name) || f.type === 'image/jpeg' || f.type === 'image/png');
    if (!images.length) {
      showAlert('Only JPG, JPEG and PNG images are supported here.');
      return;
    }
    if (images.length < dropped.length) {
      const rejected = dropped.filter(f => !images.includes(f)).map(f => f.name);
      showAlert(`Ignored ${rejected.length} non-image ${rejected.length === 1 ? 'file' : 'files'}: ${rejected.slice(0, 2).join(', ')}${rejected.length > 2 ? '…' : ''}. Only JPG, JPEG and PNG files were added.`, 'warn');
    } else if (images.some(f => f.size > 50 * 1024 * 1024)) {
      showAlert('One or more images are very large (over 50 MB) and may take longer to process.', 'warn');
    } else {
      hideAlert();
    }
    const created = images.map(f => ({ id: uid(), file: f, thumbUrl: URL.createObjectURL(f) }));
    STATE.jpg.files.push(...created);
    renderJpgList();
  }

  function renderJpgList() {
    const list = $('jpgList');
    if (!list) return;
    list.innerHTML = STATE.jpg.files.map((item, i) => `
      <article class="pdf-file-item" draggable="true" data-id="${item.id}">
        <button class="pdf-grip" type="button" aria-label="Drag to reorder ${escapeHtml(item.file.name)}" title="Drag to reorder">
          <svg aria-hidden="true"><use href="#ic-grip" /></svg>
        </button>
        <span class="pdf-file-thumb"><img src="${item.thumbUrl}" alt="" loading="lazy"></span>
        <div class="pdf-file-main">
          <div class="pdf-file-title">${escapeHtml(item.file.name)}</div>
          <div class="pdf-file-meta">${formatBytes(item.file.size)}</div>
        </div>
        <div class="pdf-file-actions">
          <button class="btn btn-ghost btn-small" type="button" data-move="up" aria-label="Move ${escapeHtml(item.file.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-ghost btn-small" type="button" data-move="down" aria-label="Move ${escapeHtml(item.file.name)} down" ${i === STATE.jpg.files.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-ghost btn-small" type="button" data-remove aria-label="Remove ${escapeHtml(item.file.name)}">Remove</button>
        </div>
      </article>`).join('');
    const card = $('jpgFilesCard');
    if (card) card.hidden = !STATE.jpg.files.length;
    const heading = $('jpgCountHeading');
    if (heading) heading.textContent = STATE.jpg.files.length;
    const summary = $('jpgSummary');
    if (summary) summary.textContent = 'Drag rows or use the arrow buttons to set the page order.';
    const btn = $('jpgToPdfBtn');
    if (btn) btn.disabled = !STATE.jpg.files.length;
  }

  async function runJpgToPdf() {
    if (STATE.busy) return;
    const files = [...STATE.jpg.files];
    if (!files.length) {
      showAlert('Please add at least one image to continue.');
      return;
    }
    const { PDFLib } = STATE.libs;
    const pageSize = document.querySelector('input[name=jpgPageSize]:checked').value;
    const fit = document.querySelector('input[name=jpgFit]:checked').value;
    STATE.cancelRequested = false;
    showJob('Converting', 'Converting images to PDF…', 2);
    const btn = $('jpgToPdfBtn');
    btn.disabled = true;
    try {
      const out = await PDFLib.PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        if (STATE.cancelRequested) throw new PdfCancel();
        const item = files[i];
        setJob(i / files.length * 100, `Adding ${item.file.name} (${i + 1}/${files.length})…`);
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const isPng = isPngBytes(bytes);
        const isJpg = isJpegBytes(bytes);
        if (!isPng && !isJpg) {
          throw new PdfError(`"${item.file.name}" is not a JPG, JPEG or PNG image.`);
        }
        let img;
        try {
          if (isJpg) {
            const oriented = await decodeJpegWithOrientation(bytes);
            img = await out.embedJpg(oriented || bytes);
          } else {
            img = await out.embedPng(bytes);
          }
        } catch (err) {
          throw new PdfError(`"${item.file.name}" could not be embedded. The image may be corrupted or unsupported.`);
        }
        const iw = img.width;
        const ih = img.height;
        const [pw, ph] = pageSize === 'a4' ? A4 : pageSize === 'letter' ? LETTER : [iw, ih];
        const page = out.addPage([pw, ph]);
        const scale = fit === 'fit' ? Math.min(pw / iw, ph / ih) : Math.max(pw / iw, ph / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      }
      const bytes = await out.save({ useObjectStreams: true });
      STATE.jpg.result = {
        blob: new Blob([bytes], { type: 'application/pdf' }),
        pageCount: out.getPageCount(),
        size: bytes.length
      };
      renderJpgResult();
    } catch (err) {
      if (!(err instanceof PdfCancel)) showAlert(friendlyError(err));
    } finally {
      hideJob();
      btn.disabled = false;
    }
  }

  function renderJpgResult() {
    const result = STATE.jpg.result;
    const card = $('jpgResultCard');
    if (!result || !card) return;
    card.hidden = false;
    $('jpgResultMeta').textContent = `${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'} · ${formatBytes(result.size)}`;
    const preview = $('jpgResultPreview');
    preview.innerHTML = '';
    renderPdfThumbSafe(preview, result.blob);
    $('jpgResultDownloadBtn').onclick = () => downloadBlob(result.blob, 'images.pdf');
  }

  function clearJpg() {
    if (STATE.busy) return;
    STATE.jpg.files.forEach(f => URL.revokeObjectURL(f.thumbUrl));
    STATE.jpg.files = [];
    STATE.jpg.result = null;
    const input = $('jpgFileInput');
    if (input) input.value = '';
    renderJpgList();
    $('jpgResultCard').hidden = true;
    hideAlert();
  }

  async function addJpgOutFile(file) {
    if (STATE.busy) return;
    const target = firstFile(file);
    if (!target) return;
    if (!(await readyEngine())) return;
    if (!(target.type === 'application/pdf' || /\.pdf$/i.test(target.name))) {
      showAlert('Only PDF files are supported here.');
      return;
    }
    if (softMemoryGuard(target.size)) {
      showAlert(softMemoryGuard(target.size), 'warn');
    } else {
      hideAlert();
    }
    try {
      const info = await analyzePdf(target);
      STATE.jpgOut.file = target;
      STATE.jpgOut.pageCount = info.pageCount;
      STATE.jpgOut.selected = new Set();
      STATE.jpgOut.results.forEach(r => { if (r.previewUrl) URL.revokeObjectURL(r.previewUrl); });
      STATE.jpgOut.results = [];
      $('jpgOutFileName').textContent = target.name;
      $('jpgOutFileMeta').textContent = `${formatBytes(target.size)} · ${info.pageCount} ${info.pageCount === 1 ? 'page' : 'pages'}`;
      $('jpgOutCard').hidden = false;
      $('jpgOutResultsCard').hidden = true;
      renderJpgOutPageGrid();
    } catch (err) {
      showAlert(friendlyError(err));
    }
  }

  async function renderJpgOutPageGrid() {
    const grid = $('jpgOutPageGrid');
    if (!grid) return;
    const count = STATE.jpgOut.pageCount;
    if (count > 300) {
      showAlert('This PDF has more than 300 pages. Converting it may take very long or run out of memory.', 'warn');
    }
    grid.innerHTML = Array.from({ length: count }, (_, i) => `
      <label class="jpgout-page">
        <input type="checkbox" value="${i + 1}" aria-label="Select page ${i + 1}">
        <span class="jpgout-page-thumb" data-thumb="${i + 1}"></span>
        <span class="jpgout-page-num">Page ${i + 1}</span>
      </label>`).join('');
    grid.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = STATE.jpgOut.selected.has(Number(cb.value));
      cb.addEventListener('change', () => {
        const page = Number(cb.value);
        if (cb.checked) STATE.jpgOut.selected.add(page);
        else STATE.jpgOut.selected.delete(page);
        updateJpgOutSelection();
      });
    });
    const data = await STATE.jpgOut.file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const thumbCells = [...grid.querySelectorAll('[data-thumb]')];
    for (const el of thumbCells) {
      const pageNumber = Number(el.dataset.thumb);
      try {
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(150 / base.width, 150 / base.height, 0.5);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
        el.appendChild(canvas);
      } catch (err) {
        el.classList.add('thumb-error');
        el.textContent = 'Preview unavailable';
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await doc.destroy();
    updateJpgOutSelection();
  }

  function updateJpgOutSelection() {
    const count = STATE.jpgOut.selected.size;
    const label = $('jpgOutSelectedCount');
    if (label) label.textContent = count;
    const btn = $('jpgOutBtn');
    if (btn) btn.disabled = !count;
  }

  function setAllJpgOutSelected(on) {
    const grid = $('jpgOutPageGrid');
    if (!grid) return;
    grid.querySelectorAll('input[type=checkbox]').forEach(cb => {
      const page = Number(cb.value);
      cb.checked = on;
      if (on) STATE.jpgOut.selected.add(page);
      else STATE.jpgOut.selected.delete(page);
    });
    updateJpgOutSelection();
  }

  function jpgOutQualityFor() {
    const value = document.querySelector('input[name=jpgOutQuality]:checked').value;
    if (value === 'custom') {
      return {
        dpi: Number($('jpgOutDpi').value),
        jpegQuality: Number($('jpgOutJpegQuality').value) / 100
      };
    }
    return { dpi: QUALITY_PRESETS[value], jpegQuality: 0.9 };
  }

  async function runJpgOut() {
    if (STATE.busy) return;
    if (!STATE.jpgOut.selected.size) {
      showAlert('Select at least one page to convert.');
      return;
    }
    const pages = [...STATE.jpgOut.selected].sort((a, b) => a - b);
    if (pages.length > 300) {
      showAlert('Too many pages selected (over 300). Converting them may run out of memory.', 'warn');
      return;
    }
    const { dpi, jpegQuality } = jpgOutQualityFor();
    STATE.cancelRequested = false;
    showJob('Converting', 'Converting PDF pages to JPG…', 2);
    const btn = $('jpgOutBtn');
    btn.disabled = true;
    let doc = null;
    try {
      const data = await STATE.jpgOut.file.arrayBuffer();
      doc = await pdfjsLib.getDocument({ data }).promise;
      STATE.jpgOut.results.forEach(r => { if (r.previewUrl) URL.revokeObjectURL(r.previewUrl); });
      STATE.jpgOut.results = [];
      const base = STATE.jpgOut.file.name.replace(/\.pdf$/i, '') || 'document';
      for (let i = 0; i < pages.length; i++) {
        if (STATE.cancelRequested) throw new PdfCancel();
        const pageNumber = pages[i];
        const page = await doc.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(dpi / 72, 4096 / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', jpegQuality));
        const outWidth = canvas.width;
        const outHeight = canvas.height;
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) throw new PdfError(`Could not encode page ${pageNumber} as a JPG.`);
        const item = {
          name: `${base}-page-${pageNumber}.jpg`,
          blob,
          width: outWidth,
          height: outHeight,
          size: blob.size,
          previewUrl: URL.createObjectURL(blob)
        };
        STATE.jpgOut.results.push(item);
        setJob((i + 1) / pages.length * 100, `Converting page ${pageNumber}/${STATE.jpgOut.pageCount}…`);
      }
      renderJpgOutResults(base);
    } catch (err) {
      if (!(err instanceof PdfCancel)) showAlert(friendlyError(err));
    } finally {
      if (doc) await doc.destroy().catch(() => { });
      hideJob();
      btn.disabled = false;
    }
  }

  function renderJpgOutResults(base) {
    const results = STATE.jpgOut.results;
    const card = $('jpgOutResultsCard');
    if (!results.length || !card) return;
    card.hidden = false;
    $('jpgOutResultCount').textContent = results.length;
    const totalSize = results.reduce((s, r) => s + r.size, 0);
    $('jpgOutResultMeta').textContent = `${results.length} ${results.length === 1 ? 'image' : 'images'} · ${formatBytes(totalSize)}`;
    const list = $('jpgOutResultList');
    list.innerHTML = results.map((r, i) => `
      <article class="pdf-result-item">
        <div class="pdf-result-thumb"><img src="${r.previewUrl}" alt=""></div>
        <div class="pdf-result-name">${escapeHtml(r.name)}</div>
        <div class="pdf-result-meta">${r.width} × ${r.height} px · ${formatBytes(r.size)}</div>
        <button class="btn btn-ghost btn-small" type="button" data-download="${i}">Download</button>
      </article>`).join('');
    list.querySelectorAll('[data-download]').forEach(b => {
      b.addEventListener('click', () => downloadBlob(results[Number(b.dataset.download)].blob, results[Number(b.dataset.download)].name));
    });
    $('jpgOutDownloadAllBtn').onclick = () => withLibs(() => downloadZip(results, `${base}-pages.zip`));
  }

  function clearJpgOut() {
    if (STATE.busy) return;
    STATE.jpgOut.results.forEach(r => { if (r.previewUrl) URL.revokeObjectURL(r.previewUrl); });
    STATE.jpgOut.results = [];
    STATE.jpgOut.file = null;
    STATE.jpgOut.pageCount = 0;
    STATE.jpgOut.selected = new Set();
    $('jpgOutCard').hidden = true;
    $('jpgOutResultsCard').hidden = true;
    $('jpgOutFileInput').value = '';
    hideAlert();
  }

  const TOOL_TITLES = {
    merge: ['PDF Merge', 'Combine multiple PDFs into one file, in any order.'],
    split: ['PDF Split', 'Split a PDF into page ranges, selected pages, or one file per page.'],
    compress: ['PDF Compress', 'Reduce PDF file size with clear quality trade-offs.'],
    'jpg-to-pdf': ['JPG to PDF', 'Turn JPG, JPEG and PNG images into a PDF document.'],
    'pdf-to-jpg': ['PDF to JPG', 'Convert PDF pages into JPG images at your chosen resolution.']
  };

  function activateTool(tool) {
    STATE.activeTool = tool;
    document.querySelectorAll('.pdf-tab').forEach(tab => {
      const on = tab.dataset.tool === tool;
      tab.classList.toggle('active', on);
      tab.tabIndex = on ? 0 : -1;
      tab.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.pdf-tool-panel').forEach(panel => {
      panel.hidden = panel.dataset.tool !== tool;
    });
    hideAlert();
  }

  function switchTool(tool) {
    if (tool === STATE.activeTool) return;
    const url = tool === 'merge' ? '/pdf-editor' : `/pdf-editor/${tool}`;
    Router.navigate(url);
  }

  let wired = false;

  function wire() {
    if (wired) return;
    wired = true;

    document.querySelectorAll('.pdf-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTool(tab.dataset.tool));
    });
    const toolbar = document.querySelector('.pdf-toolbar');
    if (toolbar) {
      toolbar.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const tabs = [...toolbar.querySelectorAll('.pdf-tab')];
        const idx = tabs.indexOf(document.activeElement);
        if (idx === -1) return;
        const next = (idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tabs[next].focus();
      });
    }

    $('pdfJobCancelBtn').addEventListener('click', () => { STATE.cancelRequested = true; });

    wireDropZone('mergeDropZone', 'mergeFileInput', 'mergeChooseBtn', addMergeFiles);
    $('mergeBtn').addEventListener('click', () => withLibs(runMerge));
    $('mergeClearBtn').addEventListener('click', clearMerge);
    $('mergeNewBtn')?.addEventListener('click', clearMerge);
    wireReorderList('mergeList', () => STATE.merge.files, renderMergeList);

    wireDropZone('splitDropZone', 'splitFileInput', 'splitChooseBtn', addSplitFile);
    $('splitClearBtn').addEventListener('click', clearSplit);
    $('splitNewBtn')?.addEventListener('click', clearSplit);
    $('splitBtn').addEventListener('click', () => withLibs(runSplit));
    $('splitRangesInput').addEventListener('input', validateSplit);
    $('splitSelectAllBtn').addEventListener('click', () => {
      for (let p = 1; p <= STATE.split.pageCount; p++) STATE.split.selected.add(p);
      renderSplitPageGrid();
      validateSplit();
    });
    $('splitSelectNoneBtn').addEventListener('click', () => {
      STATE.split.selected.clear();
      renderSplitPageGrid();
      validateSplit();
    });
    document.querySelectorAll('input[name=splitMode]').forEach(radio => {
      radio.addEventListener('change', () => {
        STATE.split.mode = radio.value;
        $('splitRangesWrap').hidden = radio.value !== 'ranges';
        $('splitPagesWrap').hidden = radio.value !== 'selected';
        validateSplit();
      });
    });

    wireDropZone('compressDropZone', 'compressFileInput', 'compressChooseBtn', addCompressFiles);
    $('compressBtn').addEventListener('click', () => withLibs(runCompress));
    $('compressClearBtn').addEventListener('click', clearCompress);
    $('compressNewBtn')?.addEventListener('click', clearCompress);

    wireDropZone('jpgDropZone', 'jpgFileInput', 'jpgChooseBtn', addJpgFiles);
    $('jpgToPdfBtn').addEventListener('click', () => withLibs(runJpgToPdf));
    $('jpgClearBtn').addEventListener('click', clearJpg);
    $('jpgNewBtn')?.addEventListener('click', clearJpg);
    wireReorderList('jpgList', () => STATE.jpg.files, renderJpgList);

    wireDropZone('jpgOutDropZone', 'jpgOutFileInput', 'jpgOutChooseBtn', addJpgOutFile);
    $('jpgOutBtn').addEventListener('click', () => withLibs(runJpgOut));
    $('jpgOutClearBtn').addEventListener('click', clearJpgOut);
    $('jpgOutNewBtn')?.addEventListener('click', clearJpgOut);
    $('jpgOutSelectAllBtn').addEventListener('click', () => setAllJpgOutSelected(true));
    $('jpgOutSelectNoneBtn').addEventListener('click', () => setAllJpgOutSelected(false));
    document.querySelectorAll('input[name=jpgOutQuality]').forEach(radio => {
      radio.addEventListener('change', () => {
        $('jpgOutCustomWrap').hidden = radio.value !== 'custom';
      });
    });
    $('jpgOutDpi').addEventListener('input', () => {
      $('jpgOutDpiValue').textContent = $('jpgOutDpi').value;
    });
    $('jpgOutJpegQuality').addEventListener('input', () => {
      $('jpgOutJpegValue').textContent = `${$('jpgOutJpegQuality').value}%`;
    });

    renderMergeList();
    renderCompressList();
    renderJpgList();
  }

  function open(tool) {
    const target = tool && TOOL_TITLES[tool] ? tool : 'merge';
    wire();
    activateTool(target);
    ensureLibs().catch(() => { });
  }

  return { open };
})();

window.PDFEditor = PDFEditor;