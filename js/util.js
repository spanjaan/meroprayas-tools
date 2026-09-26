'use strict';

// Shared helpers used across every tool module. Loaded first (see index.html)
// so the compressor, unicode and PDF editors can all rely on a single
// implementation of byte formatting, HTML escaping and size-saved maths.
const MP = (() => {
  const formatBytes = bytes => {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let n = bytes / 1024, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
  };

  const percentSaved = (before, after) =>
    before > 0 ? Math.round((1 - after / before) * 100) : 0;

  const escapeHtml = value =>
    String(value).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return { formatBytes, percentSaved, escapeHtml };
})();

if (typeof window !== 'undefined') window.MP = MP;
