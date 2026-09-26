/* global ImageCompressor, MP */
/* exported UI */
'use strict';

const UI = (() => {
  const $ = id => document.getElementById(id);
  const els = {
    fileInput: $('fileInput'), chooseBtn: $('chooseBtn'), dropZone: $('dropZone'),
    editorCard: $('editorCard'), imageList: $('imageList'),
    imageCountHeading: $('imageCountHeading'), editorSettingsSaved: $('editorSettingsSaved'),
    installBtn: $('installBtn'),
    themeBtn: $('themeBtn'),
    navToggle: $('navToggle'), primaryNav: $('primaryNav'), navScrim: $('navScrim'), navClose: $('navClose'),
    processAllBtn: $('processAllBtn'), downloadAllBtn: $('downloadAllBtn'), clearBtn: $('clearBtn'),
    summary: $('summary'),
    quality: $('quality'), qualityValue: $('qualityValue'), format: $('format'), formatNote: $('formatNote'),
    cropDialog: $('cropDialog'), cropImage: $('cropImage'), cropStage: $('cropStage'), cropBox: $('cropBox'),
    cancelCrop: $('cancelCrop'), skipCrop: $('skipCrop'), applyCrop: $('applyCrop'), cropPresetRow: $('cropPresetRow'),
    cropCoordinates: $('cropCoordinates'), cropSizeBadge: $('cropSizeBadge'), cropDimLabel: $('cropDimLabel'),
    cropSourceDims: $('cropSourceDims'),
    applyAllBtn: $('applyAllBtn'),
    perspOverlay: $('perspOverlay'), perspShade: $('perspShade'), perspBorder: $('perspBorder'),
    perspModeBtn: $('perspModeBtn'), perspResetBtn: $('perspResetBtn'), perspApplyBtn: $('perspApplyBtn'), perspCancelBtn: $('perspCancelBtn'),
    perspAutoBtn: $('perspAutoBtn'),
    perspMagnifier: $('perspMagnifier'), perspMagnifierCanvas: $('perspMagnifierCanvas'),
    cropZoomOut: $('cropZoomOut'), cropZoomIn: $('cropZoomIn'), cropZoomRange: $('cropZoomRange'),
    cropZoomValue: $('cropZoomValue'), cropFitBtn: $('cropFitBtn'),
    cropUndo: $('cropUndo'), cropRedo: $('cropRedo'), cropReset: $('cropReset'),
    cropPreviewOverlay: $('cropPreviewOverlay'), cropPreviewImage: $('cropPreviewImage'),
    cropPreviewMeta: $('cropPreviewMeta'), cropPreviewClose: $('cropPreviewClose'), cropPreviewClose2: $('cropPreviewClose2'),
    cropPreviewFrame: $('cropPreviewFrame'), cropPreviewZoom: $('cropPreviewZoom'),
    cropRotateLeft: $('cropRotateLeft'), cropRotateRight: $('cropRotateRight'), cropRotateReset: $('cropRotateReset'),
    cropFlipH: $('cropFlipH'), cropFlipV: $('cropFlipV'), cropPreviewBtn: $('cropPreviewBtn'),
    sizePresetRow: $('sizePresetRow'), customSizeFields: $('customSizeFields'),
    customWidth: $('customWidth'), customHeight: $('customHeight'), sizeLockBtn: $('sizeLockBtn'),
    sizeOutputValue: $('sizeOutputValue'), cropOutputDims: $('cropOutputDims')
  };

  let records = [];
  let selectedId = null;
  let cropState = null;
  let deferredInstall = null;
  let cropPreviewUrl = null;
  let cropZoom = 1;
  let cropHistory = [];
  let cropHistoryIndex = -1;
  let sizePreset = null;
  let previewZoom = 1;
  let previewPan = { x: 0, y: 0 };
  let previewPanDrag = null;
  let lastPreviewFocus = null;
  let lastFocus = null;
  let pendingQueue = [];
  let queueActive = false;
  let perspectiveMode = false;
  let perspectivePoints = null;
  let perspDrag = null;
  let perspSource = null;
  let perspDetecting = false;
  const PERSP_MAG = { size: 132, window: 33, zoom: 4 };

  const loadPersistedSettings = () => {
    try {
      const raw = localStorage.getItem('pixelpress-settings');
      if (!raw) return {};
      const saved = JSON.parse(raw);
      const out = {};
      const q = Number(saved.quality);
      if (Number.isFinite(q)) out.quality = Math.min(100, Math.max(10, Math.round(q)));
      if (['auto', 'image/webp', 'image/jpeg', 'image/jpg', 'image/png'].includes(saved.format)) out.format = saved.format;
      if (['480', '720', '1080', '1440', '1920', 'custom'].includes(String(saved.size))) out.size = String(saved.size);
      const cw = ImageCompressor.normalizeDimension(saved.customW);
      const ch = ImageCompressor.normalizeDimension(saved.customH);
      if (cw) out.customW = cw;
      if (ch) out.customH = ch;
      if (typeof saved.sizeLock === 'boolean') out.sizeLock = saved.sizeLock;
      return out;
    } catch (_) { return {}; }
  };

  const persistedSettings = loadPersistedSettings();

  const savePersistedSettings = patch => {
    Object.assign(persistedSettings, patch);
    try { localStorage.setItem('pixelpress-settings', JSON.stringify(persistedSettings)); } catch (_) { }
  };

  const defaultSettings = () => ({
    quality: persistedSettings.quality ?? 80,
    format: persistedSettings.format ?? 'auto',
    rotation: 0, crop: null,
    size: persistedSettings.size ?? null,
    customW: persistedSettings.customW ?? null,
    customH: persistedSettings.customH ?? null,
    sizeLock: persistedSettings.sizeLock ?? true,
    cropRatio: null
  });

  const selectedRecord = () => records.find(r => r.id === selectedId) || null;

  // Thumbnail object URLs are cached per record and revoked when superseded,
  // so re-rendering the lists never leaks or reuses stale URLs.
  const fileThumb = r => r.fileThumbUrl || (r.fileThumbUrl = URL.createObjectURL(r.file));

  const blobThumb = r => {
    if (r.blob && !r.blobThumbUrl) r.blobThumbUrl = URL.createObjectURL(r.blob);
    return r.blobThumbUrl;
  };

  const revokeBlobThumb = r => {
    if (r.blobThumbUrl) { URL.revokeObjectURL(r.blobThumbUrl); r.blobThumbUrl = null; }
  };

  const revokeFileThumb = r => {
    if (r.fileThumbUrl) { URL.revokeObjectURL(r.fileThumbUrl); r.fileThumbUrl = null; }
  };

  const revokeAllThumbs = r => {
    revokeBlobThumb(r);
    revokeFileThumb(r);
  };

  const thumbFor = r => (r.blob ? blobThumb(r) : fileThumb(r));

  function escapeHtml(value) {
    return MP.escapeHtml(value);
  }

  function addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    const created = files.map(file => ({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      file, rotation: 0, crop: null, flipH: false, flipV: false,
      status: 'ready', blob: null, name: null, ...defaultSettings()
    }));
    pendingQueue.push(...created);
    if (!queueActive) processNextPending();
  }

  // Uploaded images are edited one at a time: each record enters the list
  // only after its editor session closes (Apply or Cancel), then the next
  // queued image opens.
  function processNextPending() {
    if (!pendingQueue.length) {
      queueActive = false;
      renderImageList();
      els.editorCard.hidden = !records.length;
      return;
    }
    queueActive = true;
    const record = pendingQueue.shift();
    records.push(record);
    selectedId = record.id;
    els.editorCard.hidden = false;
    renderImageList();
    openEditor(record.id);
  }

  function invalidateOutput() {
    const r = selectedRecord();
    if (!r) return;
    r.blob = null;
    r.status = 'ready';
    r.dirty = true;
    r.progress = 0;
    revokeBlobThumb(r);
  }

  function getRecordSettings(r) {
    const settings = {
      quality: Number(r.quality ?? 80),
      format: r.format ?? 'auto',
      rotation: r.rotation || 0,
      flipH: !!r.flipH,
      flipV: !!r.flipV,
      crop: r.crop || null
    };
    const dims = outputDimsForRecord(r);
    if (dims) { settings.width = dims.width; settings.height = dims.height; }
    return settings;
  }

  const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };

  function normalizeCropRatio() {
    if (cropState) return cropState.ratio || (cropState.w / cropState.h);
    const r = selectedRecord();
    if (r?.cropRatio) return r.cropRatio;
    if (r?.crop) return r.crop.width / r.crop.height;
    if (r?.sourceWidth && r?.sourceHeight) return r.sourceWidth / r.sourceHeight;
    return null;
  }

  function currentRotation() {
    if (cropState) return cropState.rotation || 0;
    return selectedRecord()?.rotation || 0;
  }

  function fallbackCropDims(oddRot) {
    if (cropState) return { width: Math.max(1, Math.round(cropState.w)), height: Math.max(1, Math.round(cropState.h)) };
    const r = selectedRecord();
    if (r?.crop) {
      const w = Math.max(1, Math.round(r.crop.width));
      const h = Math.max(1, Math.round(r.crop.height));
      return oddRot ? { width: h, height: w } : { width: w, height: h };
    }
    if (r?.sourceWidth && r?.sourceHeight) return { width: Math.max(1, Math.round(r.sourceWidth)), height: Math.max(1, Math.round(r.sourceHeight)) };
    return null;
  }

  // Requested output dimensions for a record (null = keep crop size).
  function outputDimsForRecord(r) {
    if (r.size == null) return null;
    const ratio = r.cropRatio ?? (r.crop ? r.crop.width / r.crop.height : null);
    return ImageCompressor.calculateOutputDimensions(ratio, r.size, r.customW, r.customH);
  }

  function updateSizeOutput() {
    const r = selectedRecord();
    if (!r) {
      setText(els.sizeOutputValue, '—');
      setText(els.cropOutputDims, '—');
      return;
    }
    const ratio = normalizeCropRatio();
    const rot = currentRotation();
    const oddRot = rot === 90 || rot === 270;
    let dims = null;
    let invalid = false;
    if (r.size == null) {
      dims = fallbackCropDims(oddRot);
    } else if (r.size === 'custom') {
      dims = ImageCompressor.calculateOutputDimensions(ratio, 'custom', r.customW, r.customH);
      invalid = !dims;
    } else {
      dims = ImageCompressor.calculateOutputDimensions(ratio, r.size);
    }
    if (dims && r.size != null && oddRot) dims = { width: dims.height, height: dims.width };
    const text = dims ? `${dims.width} × ${dims.height} px` : '—';
    setText(els.sizeOutputValue, text);
    if (els.sizeOutputValue) els.sizeOutputValue.classList.toggle('invalid', invalid);
    setText(els.cropOutputDims, text);
  }

  function setActiveSizePreset(value) {
    sizePreset = value;
    els.sizePresetRow?.querySelectorAll('.size-btn').forEach(b => {
      const on = b.dataset.size === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function saveSizeSettings(r) {
    r.size = sizePreset;
    r.customW = ImageCompressor.normalizeDimension(els.customWidth?.value);
    r.customH = ImageCompressor.normalizeDimension(els.customHeight?.value);
    r.sizeLock = !els.sizeLockBtn?.classList.contains('unlocked');
  }

  function loadRecordIntoEditor(r) {
    if (!r) return;
    els.quality.value = r.quality ?? 80;
    els.qualityValue.textContent = `${els.quality.value}%`;
    els.format.value = r.format ?? 'auto';
    updateFormatNote();
    setActiveSizePreset(r.size ?? null);
    if (els.customSizeFields) els.customSizeFields.hidden = sizePreset !== 'custom';
    if (els.customWidth) els.customWidth.value = r.customW || '';
    if (els.customHeight) els.customHeight.value = r.customH || '';
    if (els.sizeLockBtn) {
      els.sizeLockBtn.classList.toggle('unlocked', r.sizeLock === false);
      els.sizeLockBtn.setAttribute('aria-pressed', String(r.sizeLock !== false));
    }
    updateSizeOutput();
    if (els.editorSettingsSaved) els.editorSettingsSaved.textContent = r.dirty ? 'Changes not applied' : 'Applied settings';
  }

  function setEditorStatus(msg) {
    if (els.editorSettingsSaved) els.editorSettingsSaved.textContent = msg;
    if (perspectiveMode && els.cropDimLabel) els.cropDimLabel.textContent = msg;
  }

  function saveEditorSettings(r) {
    if (!r) return;
    r.quality = Number(els.quality.value);
    r.format = els.format.value;
  }

  function renderImageList() {
    if (!els.imageList) return;
    if (els.imageCountHeading) els.imageCountHeading.textContent = records.length;
    els.imageList.innerHTML = records.map((r, i) => {
      const thumb = thumbFor(r);
      const edited = r.crop || r.rotation || r.flipH || r.flipV || r.perspective || r.format !== 'auto' || r.quality !== 80 || r.size != null;
      const status = r.status === 'processing'
        ? '<span class="status-chip processing"><span class="status-dot processing"></span>Compressing</span>'
        : r.status === 'done'
          ? '<span class="status-chip done"><span class="status-dot done"></span>Compressed</span>'
          : r.status === 'error'
            ? '<span class="status-chip error"><span class="status-dot error"></span>Error</span>'
            : edited
              ? '<span class="status-chip edited"><span class="status-dot edited"></span>Edited</span>'
              : '<span class="status-chip ready"><span class="status-dot ready"></span>Ready</span>';
      const meta = r.status === 'done' && r.blob ? `${ImageCompressor.formatBytes(r.file.size)} → ${ImageCompressor.formatBytes(r.blob.size)} · ${r.width} × ${r.height}px · ${ImageCompressor.percentSaved(r.file.size, r.blob.size)}% smaller` : `${ImageCompressor.formatBytes(r.file.size)} · ${r.sourceWidth || '—'} × ${r.sourceHeight || '—'}px`;
      const sizeLabel = r.size == null ? '' : r.size === 'custom' ? 'Custom size' : `${r.size}px`;
      const settingsMeta = `${r.format === 'auto' ? 'Original' : r.format.split('/')[1].toUpperCase()} · ${r.quality}% quality${sizeLabel ? ' · ' + sizeLabel : ''}`;
      return `<article class="image-list-item ${selectedId === r.id ? 'selected' : ''}" data-id="${r.id}">
        <div class="image-list-thumb-wrap"><img class="image-list-thumb" src="${thumb}" alt=""><span class="image-index">${i + 1}</span></div>
        <div class="image-list-main"><div class="image-list-title">${escapeHtml(r.file.name)}</div><div class="image-list-meta">${meta}</div><div class="image-list-settings">${settingsMeta}</div><div class="image-list-status">${status}</div>${r.status === 'processing' ? `<div class="result-progress list-progress"><span style="width:${r.progress || 0}%"></span></div>` : ''}</div>
        <div class="image-list-actions"><button class="btn btn-soft btn-small" data-edit="${r.id}">✦ Edit</button><button class="btn btn-primary btn-small" data-compress="${r.id}" ${r.status === 'processing' ? 'disabled' : ''}>${r.status === 'done' ? 'Recompress' : 'Compress'}</button>${r.blob ? `<button class="btn btn-ghost btn-small" data-download="${r.id}">Download</button>` : ''}<button class="btn btn-ghost btn-small" data-remove="${r.id}" ${r.status === 'processing' ? 'disabled' : ''}>Remove</button></div>
      </article>`;
    }).join('');

    els.imageList.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
    els.imageList.querySelectorAll('[data-compress]').forEach(b => b.onclick = async () => { selectedId = b.dataset.compress; await compressSingle(selectedId); });
    els.imageList.querySelectorAll('[data-download]').forEach(b => b.onclick = () => download(records.find(r => r.id === b.dataset.download)));
    els.imageList.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => removeRecord(b.dataset.remove));
    updateSummary();
  }

  function updateSummary() {
    const done = records.filter(r => r.status === 'done' && r.blob);
    const before = done.reduce((s, r) => s + r.file.size, 0);
    const after = done.reduce((s, r) => s + r.blob.size, 0);
    setText(els.summary, done.length
      ? `${done.length} of ${records.length} processed · ${ImageCompressor.formatBytes(before)} → ${ImageCompressor.formatBytes(after)} · ${ImageCompressor.percentSaved(before, after)}% smaller`
      : records.length ? 'Choose settings and compress your images.' : 'Upload images to begin.');
    els.downloadAllBtn.disabled = !done.length;
  }

  function openEditor(id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    selectedId = id;
    lastFocus = document.activeElement;
    loadRecordIntoEditor(r);
    startCrop();
    renderImageList();
  }

  async function compressSingle(id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    selectedId = id;
    saveEditorSettings(r);
    await processRecord(r, getRecordSettings(r));
    renderImageList();
  }

  // Progress ticks update only the affected row instead of rebuilding the whole list.
  function updateResultRow(r) {
    const row = els.imageList?.querySelector(`[data-id="${r.id}"]`);
    if (!row) return;
    const bar = row.querySelector('.result-progress span');
    if (bar) bar.style.width = `${r.progress}%`;
  }

  async function processRecord(r, recordSettings = getRecordSettings(r)) {
    r.status = 'processing'; r.progress = 5;
    renderImageList();
    try {
      const result = await ImageCompressor.render(r.file, {
        ...recordSettings
      }, p => {
        if (Math.round(p) !== Math.round(r.progress)) { r.progress = p; updateResultRow(r); }
      });
      revokeBlobThumb(r);
      r.blob = result.blob;
      r.name = result.name; r.width = result.width; r.height = result.height;
      r.dirty = false;
      r.status = 'done'; r.progress = 100;
    } catch (e) {
      console.error('Compression failed:', e);
      r.status = 'error'; r.progress = 0;
    }
    renderImageList();
  }

  async function processAll() {
    els.processAllBtn.disabled = true;
    els.processAllBtn.textContent = 'Compressing…';
    try {
      for (const r of [...records]) {
        await processRecord(r, getRecordSettings(r));
      }
    } finally {
      els.processAllBtn.disabled = false;
      els.processAllBtn.textContent = 'Compress all';
      renderImageList();
    }
  }

  function download(r) {
    if (!r?.blob) return;
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.name || `${r.file.name}-compressed`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function removeRecord(id) {
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return;
    if (!confirm('Remove this image? This cannot be undone.')) return;
    const [removed] = records.splice(idx, 1);
    revokeAllThumbs(removed);
    if (selectedId === id) {
      selectedId = records.length ? records[0].id : null;
      loadRecordIntoEditor(selectedRecord());
    }
    if (!records.length) {
      selectedId = null;
      els.editorCard.hidden = true;
    }
    renderImageList();
  }

  function clear() {
    if (records.length && !confirm('Remove all images and reset the app? This cannot be undone.')) return;
    records.forEach(revokeAllThumbs);
    if (cropPreviewUrl) { URL.revokeObjectURL(cropPreviewUrl); cropPreviewUrl = null; }
    pendingQueue = []; queueActive = false;
    records = []; selectedId = null;
    els.fileInput.value = '';
    els.editorCard.hidden = true;
    if (els.imageList) els.imageList.innerHTML = '';
    updateSummary();
  }

  function updateFormatNote() {
    const value = els.format.value;
    els.formatNote.textContent =
      value === 'image/png' ? 'PNG is lossless. Quality has little effect; use WebP/JPEG for stronger reduction.'
        : value === 'image/jpeg' || value === 'image/jpg' ? 'JPEG is compact and widely supported. Transparent areas become white.'
          : value === 'image/webp' ? 'WebP usually gives an excellent quality/size balance.'
            : 'The original format is preserved when possible; animated/unsupported formats may be exported as WebP.';
  }

  function applySettingsToAll() {
    const r0 = selectedRecord();
    if (!r0) return;
    const q = Number(els.quality.value);
    const f = els.format.value;
    const size = sizePreset;
    const customW = ImageCompressor.normalizeDimension(els.customWidth?.value);
    const customH = ImageCompressor.normalizeDimension(els.customHeight?.value);
    const sizeLock = !els.sizeLockBtn?.classList.contains('unlocked');
    records.forEach(r => {
      r.quality = q;
      r.format = f;
      r.size = size;
      r.customW = customW;
      r.customH = customH;
      r.sizeLock = sizeLock;
      r.blob = null;
      r.status = 'ready';
      r.dirty = true;
      r.progress = 0;
      revokeBlobThumb(r);
    });
    if (els.editorSettingsSaved) els.editorSettingsSaved.textContent = `Applied to ${records.length} ${records.length === 1 ? 'image' : 'images'}`;
    updateSummary();
    renderImageList();
  }

  function getCropImageMetrics() {
    const imageRect = els.cropImage.getBoundingClientRect();
    const stageRect = els.cropStage.getBoundingClientRect();
    return {
      imageRect, stageRect,
      left: imageRect.left - stageRect.left,
      top: imageRect.top - stageRect.top,
      width: imageRect.width,
      height: imageRect.height,
      scaleX: imageRect.width / cropState.sourceW,
      scaleY: imageRect.height / cropState.sourceH
    };
  }

  async function buildCropVisual() {
    const r = selectedRecord();
    if (!r || !cropState) return;
    if (cropPreviewUrl) { URL.revokeObjectURL(cropPreviewUrl); cropPreviewUrl = null; }
    const source = await ImageCompressor.decode(r.file);
    const ow = source.width || source.naturalWidth, oh = source.height || source.naturalHeight;
    const rot = ((cropState.rotation || 0) + 360) % 360;
    const dw = (rot === 90 || rot === 270) ? oh : ow;
    const dh = (rot === 90 || rot === 270) ? ow : oh;
    const scale = Math.min(1, 1800 / Math.max(dw, dh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(dw * scale));
    canvas.height = Math.max(1, Math.round(dh * scale));
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(cropState.flipH ? -1 : 1, cropState.flipV ? -1 : 1);
    ctx.drawImage(source, -ow * scale / 2, -oh * scale / 2, ow * scale, oh * scale);
    ctx.restore();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', .92));
    if (!blob) return;
    cropPreviewUrl = URL.createObjectURL(blob);
    els.cropImage.src = cropPreviewUrl;
    cropState.sourceW = dw;
    cropState.sourceH = dh;
    if (els.cropSourceDims) els.cropSourceDims.textContent = `Original: ${ow} × ${oh} px`;
    // Position once the preview image has actually decoded and laid out,
    // otherwise metrics are 0 and the box stays on its placeholder.
    if (els.cropImage.complete) {
      requestAnimationFrame(positionCropBox);
    } else {
      els.cropImage.addEventListener('load', () => requestAnimationFrame(positionCropBox), { once: true });
    }
    source.close?.();
  }

  function updateHistoryButtons() {
    if (els.cropUndo) els.cropUndo.disabled = cropHistoryIndex <= 0;
    if (els.cropRedo) els.cropRedo.disabled = cropHistoryIndex >= cropHistory.length - 1;
    els.cropUndo?.classList.toggle('muted', cropHistoryIndex <= 0);
    els.cropRedo?.classList.toggle('muted', cropHistoryIndex >= cropHistory.length - 1);
  }

  function snapshotCrop(force = false) {
    if (!cropState) return;
    const r = selectedRecord();
    const snap = JSON.stringify(cropState);
    const entry = {
      s: JSON.parse(snap),
      file: r?.file ?? null,
      rotation: r?.rotation ?? 0,
      flipH: !!r?.flipH,
      flipV: !!r?.flipV,
      crop: r?.crop ?? null,
      cropRatio: r?.cropRatio ?? null,
      perspective: !!r?.perspective,
      srcW: r?.sourceWidth ?? null,
      srcH: r?.sourceHeight ?? null
    };
    const last = cropHistory[cropHistory.length - 1];
    if (!force && last && last.file === entry.file && JSON.stringify(last.s) === snap) { updateHistoryButtons(); return; }
    cropHistory = cropHistory.slice(0, cropHistoryIndex + 1);
    cropHistory.push(entry);
    // Bound history so long edit sessions cannot pin every superseded
    // working-file blob in memory.
    if (cropHistory.length > 60) { cropHistory.shift(); cropHistoryIndex--; }
    cropHistoryIndex = cropHistory.length - 1;
    updateHistoryButtons();
  }

  async function restoreCropSnapshot(index) {
    if (index < 0 || index >= cropHistory.length) return;
    const entry = cropHistory[index];
    cropHistoryIndex = index;
    cropState = JSON.parse(JSON.stringify(entry.s));
    const r = selectedRecord();
    if (r && entry.file !== r.file) {
      revokeFileThumb(r);
      revokeBlobThumb(r);
      r.file = entry.file;
      r.rotation = entry.rotation || 0;
      r.flipH = !!entry.flipH;
      r.flipV = !!entry.flipV;
      r.crop = entry.crop || null;
      r.cropRatio = entry.cropRatio ?? null;
      r.perspective = !!entry.perspective;
      if (entry.srcW) { r.sourceWidth = entry.srcW; r.sourceHeight = entry.srcH; }
      r.blob = null;
      r.status = 'ready';
      r.dirty = true;
      r.progress = 0;
    }
    updateHistoryButtons();
    await buildCropVisual();
    renderImageList();
    updateSizeOutput();
  }

  async function startCrop() {
    const r = selectedRecord(); if (!r) return;
    perspectiveMode = false;
    perspectivePoints = null;
    perspDrag = null;
    hidePerspMagnifier();
    releasePerspSource();
    if (els.perspOverlay) els.perspOverlay.hidden = true;
    if (els.cropBox) els.cropBox.hidden = false;
    if (els.cropCoordinates) els.cropCoordinates.hidden = false;
    if (els.cropSizeBadge) els.cropSizeBadge.hidden = false;
    loadRecordIntoEditor(r);
    els.cropDialog.showModal();
    els.cropStage?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    els.cropStage?.classList.add('loading');
    if (els.cropDimLabel) els.cropDimLabel.textContent = 'Loading image…';
    const source = await ImageCompressor.decode(r.file).catch(() => null);
    if (!source || !(source.width || source.naturalWidth)) {
      r.status = 'error'; r.progress = 0;
      els.cropStage?.classList.remove('loading');
      if (els.cropDialog?.open) els.cropDialog.close();
      renderImageList();
      return;
    }
    const w = source.width || source.naturalWidth, h = source.height || source.naturalHeight;
    r.sourceWidth = w; r.sourceHeight = h;
    const existing = r.crop;
    const rot = ((r.rotation || 0) % 360 + 360) % 360;
    const odd = rot === 90 || rot === 270;
    const displayW = odd ? h : w;
    const displayH = odd ? w : h;
    const defaultBox = { x: 0, y: 0, w: displayW, h: displayH };
    let box = defaultBox;
    if (existing && (rot || r.flipH || r.flipV)) {
      const mapped = storedCropToDisplay(existing, rot, !!r.flipH, !!r.flipV, w, h);
      if (mapped) box = { x: mapped.x, y: mapped.y, w: mapped.width, h: mapped.height };
    } else if (existing) {
      box = { x: existing.x, y: existing.y, w: existing.width, h: existing.height };
    }
    box.x = Math.max(0, Math.min(box.x, displayW - box.w));
    box.y = Math.max(0, Math.min(box.y, displayH - box.h));
    cropZoom = 1;
    cropHistory = []; cropHistoryIndex = -1;
    cropState = {
      x: box.x, y: box.y, w: box.w, h: box.h,
      ratio: r.cropRatio ?? null,
      sourceW: displayW, sourceH: displayH, mode: null, rotation: rot,
      flipH: !!r.flipH, flipV: !!r.flipV, originalW: w, originalH: h
    };
    setActivePreset(matchAspectPreset(cropState.ratio));
    snapshotCrop();
    await buildCropVisual();
    els.cropStage?.classList.remove('loading');
    source.close?.();
  }

  function positionCropBox() {
    if (!cropState) return;
    const m = getCropImageMetrics();
    if (!m.width || !m.height) {
      if (els.cropDialog?.open && !els.cropImage.complete) requestAnimationFrame(positionCropBox);
      return;
    }
    els.cropBox.style.left = `${m.left + cropState.x * m.scaleX}px`;
    els.cropBox.style.top = `${m.top + cropState.y * m.scaleY}px`;
    els.cropBox.style.width = `${cropState.w * m.scaleX}px`;
    els.cropBox.style.height = `${cropState.h * m.scaleY}px`;
    if (els.cropSizeBadge) els.cropSizeBadge.textContent = `${Math.round(cropState.w)} × ${Math.round(cropState.h)} (${(cropState.w / cropState.h).toFixed(2)}:1)`;
    if (els.cropDimLabel) els.cropDimLabel.textContent = `${Math.round(cropState.w)} × ${Math.round(cropState.h)}px`;
    if (els.cropCoordinates) els.cropCoordinates.textContent = `X: ${Math.round(cropState.x)} · Y: ${Math.round(cropState.y)} · W: ${Math.round(cropState.w)} · H: ${Math.round(cropState.h)}`;
    if (els.cropZoomValue) els.cropZoomValue.textContent = `${Math.round(cropZoom * 100)}%`;
    if (els.cropZoomRange) els.cropZoomRange.value = Math.round(cropZoom * 100);
    positionPerspOverlay();
    updateSizeOutput();
  }

  function setCropRatio(ratio) {
    if (!cropState) return;
    cropState.ratio = ratio === 'free' ? null : ImageCompressor.normalizeRatio(ratio);
    if (!cropState.ratio) {
      positionCropBox();
      snapshotCrop();
      return;
    }
    let w = Math.min(cropState.w, cropState.sourceW);
    let h = w / cropState.ratio;
    if (h > cropState.sourceH) { h = cropState.sourceH; w = h * cropState.ratio; }
    cropState.w = w;
    cropState.h = h;
    cropState.x = Math.max(0, Math.min(cropState.x, cropState.sourceW - cropState.w));
    cropState.y = Math.max(0, Math.min(cropState.y, cropState.sourceH - cropState.h));
    positionCropBox();
    snapshotCrop();
  }

  function setActivePreset(label) {
    els.cropPresetRow?.querySelectorAll('.aspect-btn').forEach(b => {
      const on = b.dataset.ratio === label;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // Inverse of getAppliedCropSettings: maps a stored crop (original image space)
  // back into display space so the editor reopens with the exact edit state.
  // Returns null when the values are inconsistent; callers fall back.
  function storedCropToDisplay(crop, rot, flipH, flipV, ow, oh) {
    const odd = rot === 90 || rot === 270;
    const displayW = odd ? oh : ow;
    const displayH = odd ? ow : oh;
    let { x, y, width, height } = crop;
    if (rot === 90) { [x, y, width, height] = [displayW - (y + height), x, height, width]; }
    else if (rot === 180) { [x, y] = [ow - (x + width), oh - (y + height)]; }
    else if (rot === 270) { [x, y, width, height] = [y, displayH - (x + width), height, width]; }
    if (flipH) x = displayW - (x + width);
    if (flipV) y = displayH - (y + height);
    if (![x, y, width, height].every(Number.isFinite)) return null;
    if (width < 1 || height < 1) return null;
    if (x < -0.5 || y < -0.5 || x + width > displayW + 0.5 || y + height > displayH + 0.5) return null;
    return {
      x: Math.max(0, Math.min(displayW, Math.round(x))),
      y: Math.max(0, Math.min(displayH, Math.round(y))),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    };
  }

  const ASPECT_PRESETS = [['free', null], ['1', 1], ['1.333333', 4 / 3], ['1.777778', 16 / 9], ['1.5', 3 / 2], ['0.5625', 9 / 16]];

  function matchAspectPreset(ratio) {
    if (!ratio) return 'free';
    let best = null, bestDiff = Infinity;
    for (const [label, value] of ASPECT_PRESETS) {
      if (value == null) continue;
      const diff = Math.abs(value - ratio);
      if (diff < bestDiff) { bestDiff = diff; best = label; }
    }
    return bestDiff < 0.02 ? best : null;
  }

  function getAppliedCropSettings() {
    if (!cropState) return null;
    const ow = cropState.originalW, oh = cropState.originalH;
    const rot = ((cropState.rotation || 0) + 360) % 360;
    let x = cropState.x, y = cropState.y, w = cropState.w, h = cropState.h;
    const displayW = (rot === 90 || rot === 270) ? oh : ow;
    const displayH = (rot === 90 || rot === 270) ? ow : oh;
    if (cropState.flipH) x = displayW - (x + w);
    if (cropState.flipV) y = displayH - (y + h);
    if (rot === 90) { [x, y, w, h] = [y, oh - (x + w), h, w]; }
    else if (rot === 180) { [x, y] = [ow - (x + w), oh - (y + h)]; }
    else if (rot === 270) { [x, y, w, h] = [ow - (y + h), x, h, w]; }
    return { crop: { x, y, width: w, height: h }, rotation: rot, flipH: !!cropState.flipH, flipV: !!cropState.flipV };
  }

  async function showCropPreview() {
    const r = selectedRecord();
    if (!r || !cropState) return;
    const settings = getAppliedCropSettings();
    if (!settings) return;
    saveEditorSettings(r);
    const baseSettings = { ...getRecordSettings(r), ...settings };
    const odd = settings.rotation === 90 || settings.rotation === 270;
    let expected = null;
    const cropDims = settings.crop ? { width: settings.crop.width, height: settings.crop.height } : null;
    if (baseSettings.width && baseSettings.height) expected = { width: baseSettings.width, height: baseSettings.height };
    else if (cropDims) expected = { width: cropDims.width, height: cropDims.height };
    if (expected && odd) expected = { width: expected.height, height: expected.width };
    let result;
    let limited = false;
    try {
      // Fit-to-screen preview: cap the largest side so the whole image is
      // always rendered and decodes instantly, even for very large photos.
      result = await ImageCompressor.render(r.file, {
        ...baseSettings,
        maxWidth: 4096, maxHeight: 4096
      });
      if (expected && (result.width < expected.width || result.height < expected.height)) limited = true;
    } catch (e) {
      // Very large photos can exceed canvas memory; fall back to a smaller cap.
      result = await ImageCompressor.render(r.file, {
        ...baseSettings,
        maxWidth: 2400, maxHeight: 2400
      });
      limited = true;
    }
    if (els.cropPreviewImage) {
      if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl);
      cropPreviewUrl = URL.createObjectURL(result.blob);
      els.cropPreviewImage.src = cropPreviewUrl;
      els.cropPreviewMeta.textContent =
        `${result.width} × ${result.height}px · ${ImageCompressor.formatBytes(result.blob.size)} · full image preview` +
        (limited ? ' · scaled to fit' : '');
      resetPreviewZoom();
      els.cropPreviewOverlay.hidden = false;
      lastPreviewFocus = document.activeElement;
      els.cropPreviewClose?.focus?.();
    }
  }

  function resetPreviewZoom() {
    previewZoom = 1;
    previewPan = { x: 0, y: 0 };
    previewPanDrag = null;
    if (els.cropPreviewImage) els.cropPreviewImage.style.transform = '';
    els.cropPreviewFrame?.classList.remove('panning');
    setText(els.cropPreviewZoom, '100%');
  }

  function applyPreviewZoom() {
    if (!els.cropPreviewImage) return;
    els.cropPreviewImage.style.transform = `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`;
    setText(els.cropPreviewZoom, `${Math.round(previewZoom * 100)}%`);
  }

  function clampPreviewPan() {
    const fw = els.cropPreviewFrame.clientWidth;
    const fh = els.cropPreviewFrame.clientHeight;
    const maxX = fw * (previewZoom - 1) / 2;
    const minX = fw * (1 - previewZoom) / 2;
    const maxY = fh * (previewZoom - 1) / 2;
    const minY = fh * (1 - previewZoom) / 2;
    previewPan.x = Math.min(maxX, Math.max(minX, previewPan.x));
    previewPan.y = Math.min(maxY, Math.max(minY, previewPan.y));
  }

  function bindPreviewZoom() {
    els.cropPreviewFrame?.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.min(4, Math.max(1, previewZoom * factor));
      if (next === previewZoom) return;
      previewZoom = next;
      clampPreviewPan();
      applyPreviewZoom();
    }, { passive: false });

    els.cropPreviewFrame?.addEventListener('pointerdown', e => {
      if (previewZoom <= 1 || e.button !== 0) return;
      previewPanDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      els.cropPreviewFrame.classList.add('panning');
      try { els.cropPreviewFrame.setPointerCapture(e.pointerId); } catch (_) { }
    });
    els.cropPreviewFrame?.addEventListener('pointermove', e => {
      if (!previewPanDrag || e.pointerId !== previewPanDrag.id) return;
      previewPan.x += e.clientX - previewPanDrag.x;
      previewPan.y += e.clientY - previewPanDrag.y;
      previewPanDrag.x = e.clientX;
      previewPanDrag.y = e.clientY;
      clampPreviewPan();
      applyPreviewZoom();
    });
    const endPreviewPan = e => {
      if (previewPanDrag && (e.pointerId === previewPanDrag.id || e.pointerId === undefined)) previewPanDrag = null;
      els.cropPreviewFrame?.classList.remove('panning');
    };
    els.cropPreviewFrame?.addEventListener('pointerup', endPreviewPan);
    els.cropPreviewFrame?.addEventListener('pointercancel', endPreviewPan);
    els.cropPreviewFrame?.addEventListener('lostpointercapture', endPreviewPan);
  }

  function closeCropPreview() {
    if (cropPreviewUrl) { URL.revokeObjectURL(cropPreviewUrl); cropPreviewUrl = null; }
    if (els.cropPreviewOverlay) els.cropPreviewOverlay.hidden = true;
    if (lastPreviewFocus?.focus) lastPreviewFocus.focus();
    lastPreviewFocus = null;
  }

  function applyCrop() {
    const r = selectedRecord();
    if (!r || !cropState) return false;
    try {
      const applied = getAppliedCropSettings();
      if (!applied?.crop) throw new Error('No valid edit selection.');

      // Commit the complete editor draft in one atomic step.
      r.crop = {
        x: Math.max(0, Number(applied.crop.x) || 0),
        y: Math.max(0, Number(applied.crop.y) || 0),
        width: Math.max(1, Number(applied.crop.width) || 1),
        height: Math.max(1, Number(applied.crop.height) || 1)
      };
      r.rotation = applied.rotation || 0;
      r.flipH = !!applied.flipH;
      r.flipV = !!applied.flipV;
      r.cropRatio = cropState.ratio || (cropState.w / cropState.h);
      saveEditorSettings(r);
      saveSizeSettings(r);
      r.dirty = true;
      r.status = 'ready';
      r.blob = null;
      r.progress = 0;
      revokeBlobThumb(r);

      if (els.editorSettingsSaved) els.editorSettingsSaved.textContent = 'Saved · ready to compress';
      closeCropPreview();
      if (els.cropDialog?.open) els.cropDialog.close();

      renderImageList();
      return true;
    } catch (error) {
      if (els.editorSettingsSaved) els.editorSettingsSaved.textContent = 'Could not apply';
      console.error('MeroPrayas editor apply failed:', error);
      return false;
    }
  }

  /* ---------- Perspective correction ---------- */

  const perspHandles = () => els.perspOverlay?.querySelectorAll('.persp-handle') || [];

  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function updatePerspectiveButtons() {
    const on = !!perspectiveMode;
    if (els.perspModeBtn) {
      els.perspModeBtn.classList.toggle('btn-secondary', !on);
      els.perspModeBtn.classList.toggle('btn-primary', on);
      els.perspModeBtn.classList.toggle('active', on);
      els.perspModeBtn.setAttribute('aria-pressed', String(on));
      els.perspModeBtn.textContent = on ? '✥ Editing corners' : '✥ Perspective mode';
    }
    [els.perspResetBtn, els.perspApplyBtn, els.perspCancelBtn].forEach(b => { if (b) b.disabled = !on; });
    [els.cropUndo, els.cropRedo, els.cropPreviewBtn, els.cropRotateLeft, els.cropRotateRight, els.cropRotateReset,
      els.cropFlipH, els.cropFlipV, els.cropReset, els.cropZoomOut, els.cropZoomIn, els.cropZoomRange, els.cropFitBtn]
      .forEach(b => { if (b) b.disabled = on; });
    if (els.cropPreviewBtn) els.cropPreviewBtn.classList.toggle('muted', on);
  }

  function positionPerspOverlay() {
    if (!perspectiveMode || !perspectivePoints || !els.perspOverlay) return;
    const m = getCropImageMetrics();
    if (!m.width || !m.height) return;
    const ov = els.perspOverlay;
    ov.style.left = `${m.left}px`;
    ov.style.top = `${m.top}px`;
    ov.style.width = `${m.width}px`;
    ov.style.height = `${m.height}px`;
    const pts = perspectivePoints.map(p => ({
      x: Math.max(0, Math.min(cropState.sourceW, p.x)) / cropState.sourceW * 100,
      y: Math.max(0, Math.min(cropState.sourceH, p.y)) / cropState.sourceH * 100
    }));
    const d = `M ${pts.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} Z`;
    if (els.perspBorder) els.perspBorder.setAttribute('d', d);
    if (els.perspShade) els.perspShade.setAttribute('d', `M 0 0 L 100 0 L 100 100 L 0 100 Z ${d}`);
    perspHandles().forEach((h, i) => {
      h.style.left = `${pts[i].x}%`;
      h.style.top = `${pts[i].y}%`;
    });
  }

  // Applies pending crop / rotate / flip edits to the image data itself so the
  // perspective warp input exactly matches what is displayed on the canvas.
  async function bakePendingEdits(r) {
    const applied = getAppliedCropSettings();
    const needsBake = applied && (applied.rotation || applied.flipH || applied.flipV ||
      Math.round(applied.crop.width) !== cropState.sourceW || Math.round(applied.crop.height) !== cropState.sourceH);
    if (!needsBake) return false;
    // Preserve the working image format (selected output format wins over the
    // original); quality stays at 100 so the intermediate bake is lossless.
    const bakeType = ImageCompressor.encodeType(r.file.type, r.format);
    const result = await ImageCompressor.render(r.file, {
      ...getRecordSettings(r), ...applied,
      width: 0, height: 0, maxWidth: 0, maxHeight: 0, quality: 100, format: bakeType
    });
    const base = r.file.name.replace(/\.[^.]+$/, '') || 'image';
    const ext = ImageCompressor.fileExtension(result.type, r.format, bakeType);
    r.file = new File([result.blob], `${base}.${ext}`, { type: result.type });
    r.sourceWidth = result.width;
    r.sourceHeight = result.height;
    r.rotation = 0; r.flipH = false; r.flipV = false; r.crop = null; r.cropRatio = null;
    r.perspective = true;
    invalidateOutput();
    return true;
  }

  async function enterPerspectiveMode() {
    const r = selectedRecord();
    if (!r || !cropState) return;
    if (perspectiveMode) { exitPerspectiveMode(); return; }
    if (perspDrag) return;
    try {
      snapshotCrop(true);
      const baked = await bakePendingEdits(r);
      if (baked) {
        revokeFileThumb(r);
        cropState = {
          x: 0, y: 0, w: r.sourceWidth, h: r.sourceHeight,
          ratio: cropState.ratio, sourceW: r.sourceWidth, sourceH: r.sourceHeight,
          mode: null, rotation: 0, flipH: false, flipV: false,
          originalW: r.sourceWidth, originalH: r.sourceHeight
        };
        await buildCropVisual();
        snapshotCrop(true);
      }
    } catch (e) {
      setEditorStatus('Could not start perspective');
      console.error('MeroPrayas perspective setup failed:', e);
      return;
    }
    perspectiveMode = true;
    perspectivePoints = [
      { x: 0, y: 0 },
      { x: cropState.sourceW, y: 0 },
      { x: cropState.sourceW, y: cropState.sourceH },
      { x: 0, y: cropState.sourceH }
    ];
    if (els.cropCoordinates) els.cropCoordinates.hidden = true;
    if (els.cropSizeBadge) els.cropSizeBadge.hidden = true;
    if (els.cropBox) els.cropBox.hidden = true;
    if (els.perspOverlay) els.perspOverlay.hidden = false;
    updatePerspectiveButtons();
    // Fit the image so every corner handle stays inside the visible stage;
    // zoom is locked while perspective mode is active.
    setCropZoom(1);
    positionPerspOverlay();
    setEditorStatus('Drag the corners, then apply');
  }

  function exitPerspectiveMode() {
    if (!perspectiveMode) return;
    perspectiveMode = false;
    perspectivePoints = null;
    perspDrag = null;
    hidePerspMagnifier();
    releasePerspSource();
    if (els.perspOverlay) els.perspOverlay.hidden = true;
    if (els.cropCoordinates) els.cropCoordinates.hidden = false;
    if (els.cropSizeBadge) els.cropSizeBadge.hidden = false;
    if (els.cropBox) els.cropBox.hidden = false;
    updatePerspectiveButtons();
    updateHistoryButtons();
    positionCropBox();
  }

  function resetPerspectivePoints() {
    if (!perspectiveMode || !perspectivePoints) return;
    perspectivePoints = [
      { x: 0, y: 0 },
      { x: cropState.sourceW, y: 0 },
      { x: cropState.sourceW, y: cropState.sourceH },
      { x: 0, y: cropState.sourceH }
    ];
    positionPerspOverlay();
  }

  async function applyPerspective() {
    const r = selectedRecord();
    if (!r || !perspectiveMode || !perspectivePoints || perspDrag) return;
    const pts = perspectivePoints;
    if (!pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return;
    const area = Math.abs(cross(pts[0], pts[1], pts[2]) + cross(pts[0], pts[2], pts[3])) / 2;
    if (area < 1) {
      setEditorStatus('Corners must form an area');
      return;
    }
    const signs = [];
    for (let i = 0; i < 4; i++) signs.push(cross(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]));
    if (!(signs.every(s => s > 1) || signs.every(s => s < -1))) {
      setEditorStatus('Corners must not cross');
      return;
    }
    try {
      snapshotCrop(true);
      const source = await ImageCompressor.decode(r.file);
      let outW = Math.max(1, Math.round(Math.max(dist(pts[0], pts[1]), dist(pts[2], pts[3]))));
      let outH = Math.max(1, Math.round(Math.max(dist(pts[1], pts[2]), dist(pts[3], pts[0]))));
      const scale = Math.min(1, 8192 / Math.max(outW, outH));
      outW = Math.max(1, Math.round(outW * scale));
      outH = Math.max(1, Math.round(outH * scale));
      const capped = ImageCompressor.capCanvasSize(outW, outH);
      const canvas = ImageCompressor.warpPerspective(source, pts, capped.width, capped.height);
      source.close?.();
      // Selected output format wins; otherwise keep the working image format
      // (never silently fall back to PNG). Lossy formats use the quality slider.
      const mime = ImageCompressor.encodeType(r.file.type, r.format);
      const quality = Math.max(0.1, Math.min(1, Number(r.quality ?? 80) / 100));
      let outType = mime;
      let blob = await new Promise(res => canvas.toBlob(res, mime, quality));
      if (!blob && mime !== 'image/png') {
        // WebP may be unsupported (e.g. Safari); fall back to PNG like render().
        outType = 'image/png';
        blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      }
      if (!blob) throw new Error('Could not encode the corrected image.');
      revokeFileThumb(r);
      revokeBlobThumb(r);
      const base = r.file.name.replace(/\.[^.]+$/, '') || 'image';
      const ext = ImageCompressor.fileExtension(outType, r.format, mime);
      r.file = new File([blob], `${base}.${ext}`, { type: outType });
      r.sourceWidth = canvas.width;
      r.sourceHeight = canvas.height;
      r.rotation = 0; r.flipH = false; r.flipV = false; r.crop = null; r.cropRatio = null;
      r.perspective = true;
      invalidateOutput();
      cropState = {
        x: 0, y: 0, w: canvas.width, h: canvas.height,
        ratio: cropState.ratio, sourceW: canvas.width, sourceH: canvas.height,
        mode: null, rotation: 0, flipH: false, flipV: false,
        originalW: canvas.width, originalH: canvas.height
      };
      exitPerspectiveMode();
      await buildCropVisual();
      snapshotCrop(true);
      renderImageList();
      updateSizeOutput();
      setEditorStatus('Perspective applied · ready to compress');
    } catch (e) {
      setEditorStatus('Could not apply perspective');
      console.error('MeroPrayas perspective failed:', e);
    }
  }

  function hidePerspMagnifier() {
    if (els.perspMagnifier) els.perspMagnifier.hidden = true;
  }

  async function ensurePerspSource() {
    if (perspSource) return perspSource;
    const r = selectedRecord();
    if (!r) return null;
    try {
      perspSource = await ImageCompressor.decode(r.file);
    } catch (e) {
      console.error('MeroPrayas magnifier decode failed:', e);
      perspSource = null;
    }
    return perspSource;
  }

  function releasePerspSource() {
    if (perspSource && typeof perspSource.close === 'function') perspSource.close();
    perspSource = null;
  }

  function showPerspMagnifier() {
    if (!perspectiveMode || !perspDrag) return;
    els.perspMagnifier.hidden = false;
    updatePerspMagnifier();
    ensurePerspSource().then(() => {
      if (perspectiveMode && perspDrag && !els.perspMagnifier.hidden) updatePerspMagnifier();
    });
  }

  function updatePerspMagnifier() {
    const src = perspSource;
    const mag = els.perspMagnifier;
    if (!src || !mag || mag.hidden || !perspectiveMode || !perspDrag) return;
    const m = getCropImageMetrics();
    if (!m.width || !m.height) return;
    // Corner in displayed-image coordinates (same mapping as the drag handles),
    // so the magnifier stays correct at any editor zoom level.
    const cx = Math.max(0, Math.min(cropState.sourceW, (perspDrag.x - m.imageRect.left) / m.scaleX));
    const cy = Math.max(0, Math.min(cropState.sourceH, (perspDrag.y - m.imageRect.top) / m.scaleY));
    const canvas = els.perspMagnifierCanvas;
    const ctx = canvas.getContext('2d');
    const half = PERSP_MAG.window / 2;
    let sx = cx - half, sy = cy - half;
    let dx = 0, dy = 0;
    if (sx < 0) { dx = -sx * PERSP_MAG.zoom; sx = 0; }
    if (sy < 0) { dy = -sy * PERSP_MAG.zoom; sy = 0; }
    const sw = Math.min(PERSP_MAG.window, cropState.sourceW - sx);
    const sh = Math.min(PERSP_MAG.window, cropState.sourceH - sy);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (sw > 0 && sh > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, sx, sy, sw, sh, dx, dy, sw * PERSP_MAG.zoom, sh * PERSP_MAG.zoom);
    }
    // Float near the corner, pushed to the free side, kept inside the stage.
    const stage = els.cropStage.getBoundingClientRect();
    const size = PERSP_MAG.size;
    const offset = 36;
    let left = perspDrag.x + (cx < cropState.sourceW / 2 ? offset : -(size + offset));
    let top = perspDrag.y + (cy < cropState.sourceH / 2 ? offset : -(size + offset));
    left = Math.min(Math.max(left, stage.left + 8), stage.right - size - 8);
    top = Math.min(Math.max(top, stage.top + 8), stage.bottom - size - 8);
    mag.style.left = `${left}px`;
    mag.style.top = `${top}px`;
  }

  async function runAutoDetect() {
    const r = selectedRecord();
    if (!r || perspDrag || perspDetecting) return;
    if (!perspectiveMode) {
      await enterPerspectiveMode();
      if (!perspectiveMode) return;
    }
    perspDetecting = true;
    const btn = els.perspAutoBtn;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Detecting…';
    try {
      // Let the busy label paint before the (fast) analysis runs.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const source = await ImageCompressor.decode(r.file);
      if (!source) return;
      try {
        const MAX_EDGE = 600;
        const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
        const w = Math.max(1, Math.round(source.width * scale));
        const h = Math.max(1, Math.round(source.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, 0, 0, w, h);
        const quad = ImageCompressor.detectDocumentQuads(ctx.getImageData(0, 0, w, h).data, w, h);
        if (!perspectiveMode) return;
        if (!quad) {
          setEditorStatus('Could not detect document — fine-tune the corners manually');
          return;
        }
        perspectivePoints = quad.map(p => ({
          x: Math.max(0, Math.min(cropState.sourceW, Math.round(p.x / scale))),
          y: Math.max(0, Math.min(cropState.sourceH, Math.round(p.y / scale)))
        }));
        positionPerspOverlay();
        setEditorStatus('Corners detected — fine-tune and apply');
      } finally {
        if (typeof source.close === 'function') source.close();
      }
    } catch (e) {
      console.error('MeroPrayas auto detect failed:', e);
      if (perspectiveMode) setEditorStatus('Could not detect document — fine-tune the corners manually');
    } finally {
      perspDetecting = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function bindPerspDrag() {
    const overlay = els.perspOverlay;
    if (!overlay) return;
    const toImagePoint = (clientX, clientY) => {
      const m = getCropImageMetrics();
      return {
        x: Math.max(0, Math.min(cropState.sourceW, (clientX - m.imageRect.left) / m.scaleX)),
        y: Math.max(0, Math.min(cropState.sourceH, (clientY - m.imageRect.top) / m.scaleY))
      };
    };
    perspHandles().forEach(handle => {
      handle.addEventListener('pointerdown', e => {
        if (!perspectiveMode) return;
        e.preventDefault();
        perspDrag = { index: Number(handle.dataset.index), pointerId: e.pointerId, x: e.clientX, y: e.clientY };
        try { handle.setPointerCapture(e.pointerId); } catch (_) { }
        showPerspMagnifier();
      });
      handle.addEventListener('pointermove', e => {
        if (!perspDrag || e.pointerId !== perspDrag.pointerId) return;
        e.preventDefault();
        perspDrag.x = e.clientX;
        perspDrag.y = e.clientY;
        perspectivePoints[perspDrag.index] = toImagePoint(e.clientX, e.clientY);
        positionPerspOverlay();
        updatePerspMagnifier();
      });
      const end = e => {
        if (perspDrag && (e.pointerId === perspDrag.pointerId || e.pointerId === undefined)) {
          perspDrag = null;
          hidePerspMagnifier();
        }
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      handle.addEventListener('lostpointercapture', end);
      handle.addEventListener('keydown', e => {
        if (!perspectiveMode) return;
        const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        const n = e.shiftKey ? 10 : 1;
        const p = perspectivePoints[Number(handle.dataset.index)];
        if (!p) return;
        p.x = Math.max(0, Math.min(cropState.sourceW, p.x + step[0] * n));
        p.y = Math.max(0, Math.min(cropState.sourceH, p.y + step[1] * n));
        positionPerspOverlay();
      });
    });
  }

  function bindCropDrag() {
    let action = null;
    const getPoint = e => ({ x: e.clientX, y: e.clientY });

    const start = (e, mode) => {
      if (!cropState) return;
      e.preventDefault();
      const p = getPoint(e);
      action = { mode, sx: p.x, sy: p.y, original: { ...cropState }, pointerId: e.pointerId, target: e.currentTarget };
      try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch (_) { }
    };

    const move = e => {
      if (!action || !cropState) return;
      e.preventDefault();
      const p = getPoint(e);
      const m = getCropImageMetrics();
      const sx = cropState.sourceW / m.width;
      const sy = cropState.sourceH / m.height;
      const dx = (p.x - action.sx) * sx;
      const dy = (p.y - action.sy) * sy;
      let { x, y, w, h } = action.original;
      const min = Math.max(32, Math.min(cropState.sourceW, cropState.sourceH) * 0.02);

      if (action.mode === 'move') {
        x = Math.max(0, Math.min(cropState.sourceW - w, x + dx));
        y = Math.max(0, Math.min(cropState.sourceH - h, y + dy));
      } else {
        if (action.mode.includes('e')) w = Math.max(min, Math.min(cropState.sourceW - x, w + dx));
        if (action.mode.includes('s')) h = Math.max(min, Math.min(cropState.sourceH - y, h + dy));
        if (action.mode.includes('w')) { const nx = Math.max(0, Math.min(x + w - min, x + dx)); w += x - nx; x = nx; }
        if (action.mode.includes('n')) { const ny = Math.max(0, Math.min(y + h - min, y + dy)); h += y - ny; y = ny; }

        if (cropState.ratio) {
          if (action.mode.includes('e') || action.mode.includes('w')) {
            h = w / cropState.ratio;
          } else {
            w = h * cropState.ratio;
          }
          if (x + w > cropState.sourceW) { w = cropState.sourceW - x; h = w / cropState.ratio; }
          if (y + h > cropState.sourceH) { h = cropState.sourceH - y; w = h * cropState.ratio; }
          if (action.mode.includes('n')) y = action.original.y + action.original.h - h;
          if (action.mode.includes('w')) x = action.original.x + action.original.w - w;
          x = Math.max(0, Math.min(x, cropState.sourceW - w));
          y = Math.max(0, Math.min(y, cropState.sourceH - h));
        }
      }

      cropState.x = x; cropState.y = y; cropState.w = w; cropState.h = h;
      positionCropBox();
    };

    const end = () => {
      if (action) snapshotCrop();
      action = null;
    };

    els.cropBox.querySelectorAll('.crop-handle').forEach(handle => {
      handle.addEventListener('pointerdown', e => start(e, handle.dataset.mode || handle.classList[1]));
    });
    els.cropBox.addEventListener('pointerdown', e => {
      if (e.target.closest('.crop-handle')) return;
      start(e, 'move');
    });
    els.cropBox.addEventListener('pointermove', move);
    els.cropBox.addEventListener('pointerup', end);
    els.cropBox.addEventListener('pointercancel', end);
    els.cropBox.addEventListener('lostpointercapture', end);
    els.cropBox.querySelectorAll('.crop-handle').forEach(handle => {
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      handle.addEventListener('lostpointercapture', end);
    });
    window.addEventListener('resize', positionCropBox);
    els.cropStage.addEventListener('wheel', e => {
      if (!els.cropDialog?.open || perspectiveMode) return;
      e.preventDefault();
      setCropZoom(cropZoom + (e.deltaY < 0 ? 0.08 : -0.08));
    }, { passive: false });
  }

  function setCropZoom(v) {
    cropZoom = Math.max(.25, Math.min(2, Number(v) || 1));
    els.cropImage.style.transform = `translate(-50%,-50%) scale(${cropZoom})`;
    requestAnimationFrame(positionCropBox);
    if (els.cropZoomValue) els.cropZoomValue.textContent = `${Math.round(cropZoom * 100)}%`;
  }

  async function cropRotate(deg) {
    if (!cropState) return;
    cropState.rotation = ((cropState.rotation || 0) + deg + 360) % 360;
    const nw = (cropState.rotation === 90 || cropState.rotation === 270) ? cropState.originalH : cropState.originalW;
    const nh = (cropState.rotation === 90 || cropState.rotation === 270) ? cropState.originalW : cropState.originalH;
    cropState.sourceW = nw; cropState.sourceH = nh; cropState.x = 0; cropState.y = 0; cropState.w = nw; cropState.h = nh;
    await buildCropVisual();
    snapshotCrop();
  }

  async function cropFlip(axis) {
    if (!cropState) return;
    if (axis === 'h') cropState.flipH = !cropState.flipH;
    if (axis === 'v') cropState.flipV = !cropState.flipV;
    await buildCropVisual();
    snapshotCrop();
  }

  function bindProCropControls() {
    const zoom = d => setCropZoom(cropZoom + d);
    els.cropZoomOut?.addEventListener('click', () => zoom(-.1));
    els.cropZoomIn?.addEventListener('click', () => zoom(.1));
    els.cropZoomRange?.addEventListener('input', e => setCropZoom(Number(e.target.value) / 100));
    els.cropFitBtn?.addEventListener('click', () => setCropZoom(1));
    els.cropRotateLeft?.addEventListener('click', () => cropRotate(-90));
    els.cropRotateRight?.addEventListener('click', () => cropRotate(90));
    els.cropRotateReset?.addEventListener('click', async () => {
      if (!cropState) return;
      cropState.rotation = 0; cropState.sourceW = cropState.originalW; cropState.sourceH = cropState.originalH;
      cropState.x = 0; cropState.y = 0; cropState.w = cropState.sourceW; cropState.h = cropState.sourceH;
      await buildCropVisual(); snapshotCrop();
    });
    els.cropFlipH?.addEventListener('click', () => cropFlip('h'));
    els.cropFlipV?.addEventListener('click', () => cropFlip('v'));
    els.cropReset?.addEventListener('click', async () => {
      if (!cropState) return;
      cropState = { ...cropState, x: 0, y: 0, w: cropState.originalW, h: cropState.originalH, sourceW: cropState.originalW, sourceH: cropState.originalH, rotation: 0, flipH: false, flipV: false, ratio: null };
      cropZoom = 1; await buildCropVisual(); snapshotCrop();
    });
    els.cropUndo?.addEventListener('click', () => restoreCropSnapshot(cropHistoryIndex - 1));
    els.cropRedo?.addEventListener('click', () => restoreCropSnapshot(cropHistoryIndex + 1));
    els.cropPreviewBtn?.addEventListener('click', showCropPreview);
    els.cropPreviewClose?.addEventListener('click', closeCropPreview);
    els.cropPreviewClose2?.addEventListener('click', closeCropPreview);
    els.cropPreviewOverlay?.addEventListener('click', e => { if (e.target === els.cropPreviewOverlay) closeCropPreview(); });
    bindPreviewZoom();
    els.perspModeBtn?.addEventListener('click', enterPerspectiveMode);
    els.perspResetBtn?.addEventListener('click', resetPerspectivePoints);
    els.perspApplyBtn?.addEventListener('click', applyPerspective);
    els.perspCancelBtn?.addEventListener('click', exitPerspectiveMode);
    els.perspAutoBtn?.addEventListener('click', runAutoDetect);
    bindPerspDrag();
    els.cropDialog?.addEventListener('keydown', e => {
      if (e.key === 'Escape' && els.cropPreviewOverlay && !els.cropPreviewOverlay.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeCropPreview();
        return;
      }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const step = arrows[e.key];
      if (step) {
        if (!cropState || perspectiveMode) return;
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        cropState.x = Math.max(0, Math.min(cropState.sourceW - cropState.w, cropState.x + step[0] * n));
        cropState.y = Math.max(0, Math.min(cropState.sourceH - cropState.h, cropState.y + step[1] * n));
        positionCropBox();
        return;
      }
      if (e.key === 'Enter' && !e.target.matches('button,input')) {
        e.preventDefault();
        if (perspectiveMode) applyPerspective();
        else els.applyCrop.click();
      }
    });
    els.cropDialog?.addEventListener('keyup', e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !perspectiveMode) snapshotCrop();
    });
    els.cropDialog?.addEventListener('close', () => {
      if (perspectiveMode) {
        perspectiveMode = false;
        perspectivePoints = null;
        perspDrag = null;
        hidePerspMagnifier();
        releasePerspSource();
        if (els.perspOverlay) els.perspOverlay.hidden = true;
        if (els.cropBox) els.cropBox.hidden = false;
        if (els.cropCoordinates) els.cropCoordinates.hidden = false;
        if (els.cropSizeBadge) els.cropSizeBadge.hidden = false;
        updatePerspectiveButtons();
      }
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      if (lastFocus?.focus) lastFocus.focus();
      lastFocus = null;
      if (queueActive) processNextPending();
    });
  }

  function bind() {
    els.chooseBtn.onclick = () => els.fileInput.click();
    els.fileInput.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.remove('dragover'); }));
    els.dropZone.addEventListener('drop', e => addFiles(e.dataTransfer.files));

    els.quality?.addEventListener('input', () => {
      els.qualityValue.textContent = `${els.quality.value}%`;
      savePersistedSettings({ quality: Number(els.quality.value) });
      const r = selectedRecord(); if (r) { saveEditorSettings(r); invalidateOutput(); renderImageList(); }
    });
    els.format?.addEventListener('change', () => {
      updateFormatNote();
      savePersistedSettings({ format: els.format.value });
      const r = selectedRecord(); if (r) { saveEditorSettings(r); invalidateOutput(); renderImageList(); }
    });

    els.processAllBtn.onclick = processAll;
    els.clearBtn.onclick = clear;
    els.downloadAllBtn.onclick = () => records.filter(r => r.blob).forEach((r, i) => setTimeout(() => download(r), i * 180));

    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    els.cropPresetRow?.addEventListener('click', e => { const b = e.target.closest('.aspect-btn'); if (!b) return; setActivePreset(b.dataset.ratio); setCropRatio(b.dataset.ratio); });

    els.sizePresetRow?.addEventListener('click', e => {
      const b = e.target.closest('.size-btn');
      if (!b) return;
      setActiveSizePreset(b.dataset.size);
      savePersistedSettings({ size: sizePreset });
      if (els.customSizeFields) els.customSizeFields.hidden = sizePreset !== 'custom';
      const r = selectedRecord();
      if (r) {
        saveSizeSettings(r);
        invalidateOutput();
        renderImageList();
      }
      updateSizeOutput();
    });

    const onCustomSizeInput = changed => {
      const r = selectedRecord();
      if (!r) return;
      if (r.sizeLock) {
        const ratio = normalizeCropRatio();
        if (changed === 'w') {
          const w = ImageCompressor.normalizeDimension(els.customWidth.value);
          if (ratio && w) els.customHeight.value = Math.max(1, Math.round(w / ratio));
        } else {
          const h = ImageCompressor.normalizeDimension(els.customHeight.value);
          if (ratio && h) els.customWidth.value = Math.max(1, Math.round(h * ratio));
        }
      }
      saveSizeSettings(r);
      savePersistedSettings({ size: 'custom', customW: r.customW, customH: r.customH, sizeLock: !els.sizeLockBtn?.classList.contains('unlocked') });
      invalidateOutput();
      renderImageList();
      updateSizeOutput();
    };
    els.customWidth?.addEventListener('input', () => onCustomSizeInput('w'));
    els.customHeight?.addEventListener('input', () => onCustomSizeInput('h'));

    els.sizeLockBtn?.addEventListener('click', () => {
      els.sizeLockBtn.classList.toggle('unlocked');
      const locked = !els.sizeLockBtn.classList.contains('unlocked');
      els.sizeLockBtn.setAttribute('aria-pressed', String(locked));
      const r = selectedRecord();
      if (r) {
        if (locked) {
          const ratio = normalizeCropRatio();
          const w = ImageCompressor.normalizeDimension(els.customWidth?.value);
          const h = ImageCompressor.normalizeDimension(els.customHeight?.value);
          if (ratio) {
            if (w) els.customHeight.value = Math.max(1, Math.round(w / ratio));
            else if (h) els.customWidth.value = Math.max(1, Math.round(h * ratio));
          }
        }
        saveSizeSettings(r);
        invalidateOutput();
        renderImageList();
        updateSizeOutput();
      }
    });

    els.cancelCrop.onclick = () => {
      closeCropPreview();
      els.cropDialog.close();
    };
    els.skipCrop.onclick = () => {
      closeCropPreview();
      els.cropDialog.close();
    };
    els.applyAllBtn?.addEventListener('click', applySettingsToAll);
    els.applyCrop.onclick = applyCrop;
    bindCropDrag();
    bindProCropControls();

    updateFormatNote();
    const savedTheme = localStorage.getItem('pixelpress-theme');
    if (savedTheme) document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : '';
    else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
    const setThemeIcon = dark => {
      els.themeBtn?.querySelector('.theme-moon')?.toggleAttribute('hidden', dark);
      els.themeBtn?.querySelector('.theme-sun')?.toggleAttribute('hidden', !dark);
    };
    els.themeBtn.onclick = () => {
      const dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : '';
      localStorage.setItem('pixelpress-theme', dark ? 'dark' : 'light');
      setThemeIcon(dark);
      els.themeBtn.setAttribute('aria-pressed', String(dark));
    };
    setThemeIcon(document.documentElement.dataset.theme === 'dark');
    els.themeBtn.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));

    /* Mobile-first navbar drawer */
    const closeNav = () => {
      els.primaryNav.classList.remove('open');
      document.body.classList.remove('nav-open');
      document.documentElement.classList.remove('nav-open');
      els.navToggle.setAttribute('aria-expanded', 'false');
      els.navToggle.setAttribute('aria-label', 'Open menu');
      els.navScrim.hidden = true;
    };
    const openNav = () => {
      els.primaryNav.classList.add('open');
      document.body.classList.add('nav-open');
      document.documentElement.classList.add('nav-open');
      els.navToggle.setAttribute('aria-expanded', 'true');
      els.navToggle.setAttribute('aria-label', 'Close menu');
      els.navScrim.hidden = false;
    };
    els.navToggle.addEventListener('click', () => {
      if (els.primaryNav.classList.contains('open')) closeNav();
      else openNav();
    });
    els.navClose?.addEventListener('click', closeNav);
    els.navScrim.addEventListener('click', closeNav);
    els.toolsMenu?.querySelector('summary')?.addEventListener('click', e => {
      e.preventDefault();
      els.toolsMenu.open = !els.toolsMenu.open;
      els.toolsMenu.open ? els.toolsMenu.setAttribute('open', '') : els.toolsMenu.removeAttribute('open');
    });
    els.primaryNav.addEventListener('click', e => {
      if (e.target.closest('a')) closeNav();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && els.primaryNav.classList.contains('open')) {
        closeNav();
        els.navToggle.focus();
      }
    });
    addEventListener('resize', () => {
      if (innerWidth >= 768 && els.primaryNav.classList.contains('open')) closeNav();
    });

    /* Collapsible "On this page" sidebar on privacy/terms pages */
    document.querySelectorAll('.toc-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const toc = toggle.closest('.toc');
        const open = toc.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        const list = toc.querySelector('ol');
        toggle.querySelector('.sr-only').textContent = open ? 'Hide table of contents' : 'Show table of contents';
        if (open && list) requestAnimationFrame(() => {
          list.querySelector('a')?.focus();
        });
      });
    });
    // On small screens a link tap should dismiss the sidebar so the section is
    // readable; desktop keeps the list pinned open (its toggle is hidden).
    document.addEventListener('click', e => {
      const link = e.target.closest('.toc a[href^="#"]');
      if (!link) return;
      const toc = link.closest('.toc');
      const toggle = toc && toc.querySelector('.toc-toggle');
      if (!toc || !toggle || !toggle.offsetParent) return;
      toc.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      const label = toggle.querySelector('.sr-only');
      if (label) label.textContent = 'Show table of contents';
    });
  }

  function setInstallHandler(promptEvent) {
    deferredInstall = promptEvent;
    els.installBtn.hidden = false;
    els.installBtn.onclick = async () => {
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      els.installBtn.hidden = true;
      deferredInstall = null;
    };
  }

  function markInstalled() {
    deferredInstall = null;
    els.installBtn.hidden = true;
  }

  function init() {
    bind();
    if (persistedSettings.quality) {
      els.quality.value = persistedSettings.quality;
      els.qualityValue.textContent = `${persistedSettings.quality}%`;
    }
    if (persistedSettings.format) {
      els.format.value = persistedSettings.format;
      updateFormatNote();
    }
    setActiveSizePreset(persistedSettings.size ?? null);
    if (els.customSizeFields) els.customSizeFields.hidden = sizePreset !== 'custom';
  }

  return { init, setInstallHandler, markInstalled };
})();
