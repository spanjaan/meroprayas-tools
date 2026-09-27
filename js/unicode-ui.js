/* global UnicodeConverter */
/* exported UnicodeUI */
'use strict';

// Controller for the /unicode view. All conversion logic lives in
// UnicodeConverter (js/unicode-converter.js); this file only wires the DOM.

const UnicodeUI = (() => {
  const $ = id => document.getElementById(id);

  const els = {};
  let debounceTimer = null;
  let copiedTimer = null;
  let lastFrom = 'preeti';
  let lastTo = 'unicode';

  const FONT_CLASSES = {
    unicode: 'font-unicode',
    preeti: 'font-preeti',
    hisab: 'font-hisab'
  };

  // Centralized language/font configuration. Each placeholder is written in
  // the encoding of its language so the user sees the text in the font they
  // selected. The Preeti/Hisab strings are legacy keystrokes and must stay
  // untouched — they only render correctly through the self-hosted web fonts
  // (PreetiWeb/HisabWeb), never through Devanagari system fonts. The Hisab
  // strings intentionally contain a line break (\n) that the browser keeps.
  const PLACEHOLDERS = {
    unicode: {
      input: 'युनीकोड टेक्स्ट यहाँ टाइप गर्नुहोस वा पेष्ट गर्नुहोस ।',
      output: 'कन्भर्टेड युनीकोड टेक्स्ट यहाँ देखीनेछ ।'
    },
    preeti: {
      input: "lk|tL 6]S:6 oxfF 6fOk ug{'xf]; jf k]:6 ug{'xf]; .",
      output: 'sGe6]{8 lk|tL 6]S:6 oxfF b]vLg]5 .'
    },
    hisab: {
      input: "lx;fa ^]S:^ oxfF ^fOk ug{'xf]; jf k]i^ ug'{xf]; .",
      output: "sGe^]{* lx;fa ^]S:^ oxfF b]vLg]% ."
    }
  };

  function charCount(text) {
    return [...text].length;
  }

  function formatCount(n) {
    return n.toLocaleString('en-US');
  }

  function setFont(element, format) {
    element.classList.remove('font-unicode', 'font-preeti', 'font-hisab');
    element.classList.add(FONT_CLASSES[format] || 'font-unicode');
  }

  function inputPlaceholder(format) {
    const entry = PLACEHOLDERS[format] || PLACEHOLDERS.unicode;
    return entry.input;
  }

  function outputPlaceholder(format) {
    const entry = PLACEHOLDERS[format] || PLACEHOLDERS.unicode;
    return entry.output;
  }

  function nextFormat(current) {
    const formats = UnicodeConverter.FORMATS;
    return formats[(formats.indexOf(current) + 1) % formats.length];
  }

  function setStatus(message) {
    els.status.textContent = message || '';
  }

  function syncControls() {
    const from = els.from.value;
    const to = els.to.value;
    const input = els.input.value;
    els.fromFormat.textContent = UnicodeConverter.NAMES[from];
    els.toFormat.textContent = UnicodeConverter.NAMES[to];
    els.input.placeholder = inputPlaceholder(from);
    els.output.placeholder = outputPlaceholder(to);
    setFont(els.input, from);
    setFont(els.output, to);
    els.inputCount.textContent = `${formatCount(charCount(input))} characters`;
    els.outputCount.textContent = `${formatCount(charCount(els.output.value))} characters`;
    const empty = input.length === 0;
    els.convertBtn.disabled = empty;
    els.copyBtn.disabled = empty;
    els.downloadBtn.disabled = empty;
  }

  function runConversion() {
    const input = els.input.value;
    if (!input) {
      els.output.value = '';
      syncControls();
      return;
    }
    try {
      const result = UnicodeConverter.convert(input, els.from.value, els.to.value);
      els.output.value = result;
      const unsupported = UnicodeConverter.countUnsupported(input, els.from.value, els.to.value);
      setStatus(unsupported > 0
        ? 'Some characters could not be converted.'
        : '');
    } catch (error) {
      els.output.value = '';
      setStatus(error && error.message
        ? error.message
        : 'Something went wrong during conversion. Please try again.');
    }
    syncControls();
  }

  function scheduleConversion() {
    if (!els.live.checked) {
      syncControls();
      return;
    }
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(runConversion, 250);
  }

  function handleSwap() {
    const from = els.from.value;
    els.from.value = els.to.value;
    els.to.value = from;
    lastFrom = els.from.value;
    lastTo = els.to.value;
    if (els.output.value) {
      els.input.value = els.output.value;
      els.output.value = '';
    }
    if (els.live.checked) runConversion();
    else syncControls();
    els.input.focus();
  }

  async function handleCopy() {
    const text = els.output.value;
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        copyWithFallback(text);
      }
      els.copyBtn.textContent = 'Copied!';
      window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        els.copyBtn.textContent = 'Copy';
      }, 1600);
    } catch (error) {
      try {
        copyWithFallback(text);
        els.copyBtn.textContent = 'Copied!';
        window.clearTimeout(copiedTimer);
        copiedTimer = window.setTimeout(() => {
          els.copyBtn.textContent = 'Copy';
        }, 1600);
      } catch (fallbackError) {
        setStatus('Unable to copy. Select the text manually and press Ctrl+C.');
      }
    }
  }

  function copyWithFallback(text) {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(helper);
    if (!ok) throw new Error('Copy failed');
  }

  function handleDownload() {
    const text = els.output.value;
    if (!text) return;
    const format = els.to.value;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `converted-${format}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handlePaste() {
    try {
      if (navigator.clipboard && window.isSecureContext && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          els.input.value = text;
          runConversion();
        }
      } else {
        els.input.focus();
        setStatus('Press Ctrl+V to paste your text.');
      }
    } catch (error) {
      els.input.focus();
      setStatus('Unable to read the clipboard. Press Ctrl+V to paste your text.');
    }
  }

  function handleClear() {
    const input = els.input.value;
    const output = els.output.value;
    if (input.length > 500 || output.length > 500) {
      if (!window.confirm('Clear both input and output text?')) return;
    }
    els.input.value = '';
    els.output.value = '';
    setStatus('');
    syncControls();
    els.input.focus();
  }

  function init() {
    els.from = $('ucFrom');
    els.to = $('ucTo');
    els.swap = $('ucSwap');
    els.convertBtn = $('ucConvert');
    els.live = $('ucLive');
    els.input = $('ucInput');
    els.output = $('ucOutput');
    els.inputCount = $('ucInputCount');
    els.outputCount = $('ucOutputCount');
    els.fromFormat = $('ucInputFormat');
    els.toFormat = $('ucOutputFormat');
    els.copyBtn = $('ucCopy');
    els.downloadBtn = $('ucDownload');
    els.clearBtn = $('ucClear');
    els.pasteBtn = $('ucPaste');
    els.status = $('ucStatus');

    if (!els.input || !els.output || !els.from || !els.to) return;

    els.from.addEventListener('change', () => {
      const changed = els.from.value !== lastFrom;
      lastFrom = els.from.value;
      if (changed && els.from.value === els.to.value) {
        els.to.value = nextFormat(els.from.value);
        lastTo = els.to.value;
      }
      syncControls();
      if (els.live.checked) runConversion();
    });
    els.to.addEventListener('change', () => {
      const changed = els.to.value !== lastTo;
      lastTo = els.to.value;
      if (changed && els.from.value === els.to.value) {
        els.from.value = nextFormat(els.to.value);
        lastFrom = els.from.value;
      }
      syncControls();
      if (els.live.checked) runConversion();
    });
    els.swap.addEventListener('click', handleSwap);
    els.convertBtn.addEventListener('click', runConversion);
    els.live.addEventListener('change', () => {
      if (els.live.checked) runConversion();
    });
    els.input.addEventListener('input', scheduleConversion);
    els.input.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        runConversion();
      }
    });
    els.copyBtn.addEventListener('click', handleCopy);
    els.downloadBtn.addEventListener('click', handleDownload);
    els.clearBtn.addEventListener('click', handleClear);
    els.pasteBtn.addEventListener('click', handlePaste);

    setFont(els.input, 'preeti');
    setFont(els.output, 'unicode');
    syncControls();
  }

  return { init };
})();