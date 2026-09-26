/* global all_rules */
/* exported UnicodeConverter */
'use strict';

// Reusable Nepali text conversion engine built on the existing key-map data
// in js/preeti-map.js (all_rules). The map encodes legacy-font keystrokes in
// "char-map" (key -> Unicode sequence) plus "post-rules" (regex fixes that
// reorder vowel signs, reph markers etc. on the Unicode side).
//
// Legacy -> Unicode applies char-map + post-rules in order.
// Unicode -> Legacy is the exact inverse: inverse post-rules in reverse
// order, then a longest-match-first reverse char-map.

const UnicodeConverter = (() => {
  // Format keys used across the app map to the object keys inside all_rules.
  const FONT_KEYS = {
    preeti: 'preeti',
    hisab: 'hisab'
  };

  const FORMATS = ['unicode', 'preeti', 'hisab'];

  const NAMES = {
    unicode: 'Unicode',
    preeti: 'Preeti',
    hisab: 'Hisab'
  };

  // Devanagari block used for the unsupported-character warning.
  const DEVANAGARI = /[\u0900-\u097F]/;

  // --- Forward rules (legacy -> Unicode), applied in this order after the
  // char-map substitution. These are taken verbatim from js/preeti-map.js; the
  // engine never re-invents them.
  const POST_RULES = [
    ['्ा', ''],
    ['(त्र|त्त)([^उभप]+?)m', '$1m$2'],
    ['त्रm', 'क्र'],
    ['त्तm', 'क्त'],
    ['([^उभप]+?)m', 'm$1'],
    ['उm', 'ऊ'],
    ['भm', 'झ'],
    ['पm', 'फ'],
    ['इ{', 'ई'],
    ['ि((.्)*[^्])', '$1ि'],
    ['(.[ािीुूृेैोौंःँ]*?){', '{$1'],
    ['((.्)*){', '{$1'],
    ['{', 'र्'],
    ['([ाीुूृेैोौंःँ]+?)(्(.्)*[^्])', '$2$1'],
    ['्([ाीुूृेैोौंःँ]+?)((.्)*[^्])', '्$2$1'],
    ['([ंँ])([ािीुूृेैोौः]*)', '$2$1'],
    ['ँँ', 'ँ'],
    ['ंं', 'ं'],
    ['ेे', 'े'],
    ['ैै', 'ै'],
    ['ुु', 'ु'],
    ['ूू', 'ू'],
    ['^ः', ':'],
    ['टृ', 'ट्ट'],
    ['ेा', 'ाे'],
    ['ैा', 'ाै'],
    ['अाे', 'ओ'],
    ['अाै', 'औ'],
    ['अा', 'आ'],
    ['एे', 'ऐ'],
    ['ाे', 'ो'],
    ['ाै', 'ौ']
  ];

  // Inverse rules (Unicode -> legacy), applied in reverse order of the
  // forward post-rules. Rules whose forward effect cannot be reversed (pure
  // deduplication, marker rules driven by input characters the char-map does
  // not produce) are intentionally omitted; the reverse char-map covers the
  // canonical keystrokes and every path round-trips through the forward pass.
  const INVERSE_RULES = [
    [/ौ/g, 'ाै'],
    [/ो/g, 'ाे'],
    [/ऐ/g, 'एे'],
    [/आ(?!े|ै)/g, 'अा'],
    [/औ/g, 'अाै'],
    [/ओ/g, 'अाे'],
    [/^:/g, 'ः'],
    [/([ािीुूृेैोौः]*)([ंँ])/g, '$2$1'],
    // Reph र् is not preceded by a halant (कर्म -> कम{); a conjunct र् is
    // (क्र्म -> क्र्म as क्र + म), so exclude the latter.
    [/(?<!्)र्(?=[\u0915-\u0939])/g, '{'],
    [/\{(.्)+/g, m => m.slice(1) + '{'],
    // The inverse of the reph post-rule moves { after the whole syllable it
    // precedes, including halant chains and matras (र्त्ता -> त ् त ा {,
    // कीर्ति -> त ि { before the ि rule runs).
    [/\{((.्)*[^्][ािीुूृेैोौंःँ]*)/g, '$1{'],
    // The inverse of the ि post-rule moves the i-matra before its consonant
    // (र्ति -> त { ि -> ि त {). The reph marker { may sit between them, so
    // the matra also jumps over it: कीर्ति keys as s L l t {.
    [/((.्)*[^्]\{?)ि/g, 'ि$1'],
    [/ई/g, 'इ{']
  ];

  // Characters the char-map never emits directly — they are products of the
  // shared post-rules (पm->फ, उm->ऊ) or of the ् + dummy-ा trick (्ा -> '')
  // — get their canonical legacy keystrokes here, after the reverse
  // char-map has consumed every pair it can (so a bare ष/ण/फ here is never
  // part of a ष्/ण्/फ् sequence). Preeti has no bare-ष, bare-ण or bare-क्ष
  // key; ष and ण encode as their ्-key + the dummy ा (i + f, 0 + f) exactly
  // like a Preeti typist would type them. The values below are taken
  // verbatim from the char-map and post-rule keys.
  const EXTRA_REVERSE = {
    preeti: { 'फ': 'km', 'ऊ': 'pm', 'ष': 'if', 'ण': '0f' },
    hisab: { 'फ': 'km', 'ऊ': 'pm', 'ष': 'if', 'ण': ')f' }
  };

  function rulesFor(format) {
    const key = FONT_KEYS[format];
    if (!key) {
      throw new Error(`Unknown format "${format}".`);
    }
    if (typeof all_rules !== 'object' || !all_rules || !all_rules[key]) {
      const name = NAMES[format] || format;
      throw new Error(
        `Unable to load the ${name} conversion map. Please refresh the page and try again.`
      );
    }
    const rules = all_rules[key];
    if (!rules['char-map'] || typeof rules['char-map'] !== 'object') {
      const name = NAMES[format] || format;
      throw new Error(
        `The ${name} conversion map is invalid. Please refresh the page and try again.`
      );
    }
    return rules;
  }

  // char-map keys are single characters (some are regex-special), so the
  // forward substitution is a plain per-codepoint lookup, not a regex pass.
  function applyCharMap(text, rules) {
    const cm = rules['char-map'];
    let out = '';
    for (const ch of text) {
      out += Object.prototype.hasOwnProperty.call(cm, ch) ? cm[ch] : ch;
    }
    return out;
  }

  function applyPostRules(text, rules) {
    const post = Array.isArray(rules['post-rules']) && rules['post-rules'].length
      ? rules['post-rules']
      : POST_RULES;
    let out = text;
    for (const [re, rep] of post) {
      out = out.replace(new RegExp(re, 'g'), rep);
    }
    return out;
  }

  function applyInverseRules(text) {
    let out = text;
    for (const [re, rep] of INVERSE_RULES) {
      out = out.replace(re, rep);
    }
    return out;
  }

  // Reverse char-map with longest values tried first so multi-character
  // sequences (ज्ञ्, र्‍, क्ष्, ...) win over their prefixes.
  function buildReverseMap(rules) {
    const cm = rules['char-map'];
    const entries = [];
    for (const key of Object.keys(cm)) {
      const value = cm[key];
      if (typeof value === 'string' && value.length > 0) {
        entries.push([key, value]);
      }
    }
    entries.sort((a, b) => b[1].length - a[1].length);
    // Multiple keys can share a value (Preeti maps both « and | to ्र); the
    // first key wins, except the pipe is the canonical Preeti ्र key.
    const preferred = new Map();
    for (const [key, value] of entries) {
      const prev = preferred.get(value);
      if (!prev || (value === '्र' && key === '|')) preferred.set(value, key);
    }
    return [...preferred].map(([value, key]) => [key, value]);
  }

  function applyReverseCharMap(text, rules, extra) {
    const entries = buildReverseMap(rules);
    const valueToKey = new Map(entries.map(([key, value]) => [value, key]));
    let out = '';
    let i = 0;
    while (i < text.length) {
      // Canonical ्र handling: consonant + ् + र pairs as consonant + the
      // ्र key (प्र -> k|, क्र -> s|). Skipped when the pair has a dedicated
      // key of its own (त्र -> q, द्र -> ›, श्र -> >, ...) or when the
      // consonant itself has no direct key (फ्र stays फ् + र = ˆ/).
      const ch = text[i];
      // Bare consonant + halant (न् -> g\): a ् that is not part of a conjunct
      // (next char is not a consonant) and not part of a reph syllable (the
      // { marker) keys as the consonant plus the halant key. The map's
      // dedicated ्-consonant keys (G -> न्, S -> क्, ...) stay available
      // for legacy round-trips.
      const nextChar = text[i + 2];
      if (text[i + 1] === '्' && /[\u0915-\u0939]/.test(ch) &&
          (!nextChar || (!/[\u0915-\u0939]/.test(nextChar) && nextChar !== '{')) &&
          valueToKey.has(ch)) {
        out += valueToKey.get(ch) + '\\';
        i += 2;
        continue;
      }
      if (i + 2 < text.length && text[i + 1] === '्' && text[i + 2] === 'र' &&
          /[\u0915-\u0939]/.test(ch)) {
        // ट्र renders with the « ्र glyph in the Preeti font; every other
        // consonant + ्र pair uses the pipe key.
        const cm = rules['char-map'];
        const raKey = ch === 'ट' && Object.prototype.hasOwnProperty.call(cm, '«')
          ? '«' : valueToKey.get('्र');
        // Consonant + ्र with a direct key (प्र -> k|, भ्र -> e|), unless the
        // pair has a dedicated key of its own (त्र -> q, द्र -> ›, श्र -> >).
        if (valueToKey.has(ch) && !valueToKey.has(ch + '्' + 'र')) {
          out += valueToKey.get(ch) + raKey;
          i += 3;
          continue;
        }
        // Post-rule product consonants with no direct key (फ = प्m -> पm):
        // the ्र key slots between the product keys (फ्र -> k|m) so the m
        // marker keeps the position the forward पm->फ rule expects. Products
        // whose second key is the dummy ा (ष् + ा, ण् + ा) are left alone —
        // a ् between them would double the halant on the way back.
        const product = extra && Object.prototype.hasOwnProperty.call(extra, ch)
          ? extra[ch] : '';
        if (product.length >= 2 && product.endsWith('m')) {
          out += product.slice(0, -1) + raKey + product.slice(-1);
          i += 3;
          continue;
        }
      }
      // Conjunct with no bare key (क्ष -> If): the map stores the ्-form
      // (I -> क्ष्) but not C्X itself, so the dummy-ा trick produces
      // key + ा (क्ष् + ा -> क्ष once the ्ा post-rule strips the dummy).
      // Skipped when a trailing ् makes the ्-form match directly
      // (क्ष् -> I, क्ष्म -> I + म) or when C्X has a key of its own
      // (ज्ञ -> 1).
      const second = text[i + 1];
      const third = text[i + 2];
      if (i + 2 < text.length && second === '्' && third !== 'र' &&
          third !== '्' && text[i + 3] !== '्' &&
          /[\u0915-\u0939]/.test(ch) &&
          valueToKey.has(ch + second + third + '्') &&
          !valueToKey.has(ch + second + third)) {
        out += valueToKey.get(ch + second + third + '्') + valueToKey.get('ा');
        i += 3;
        continue;
      }
      let matched = false;
      for (const [key, value] of entries) {
        if (text.startsWith(value, i)) {
          out += key;
          i += value.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        out += text[i];
        i += 1;
      }
    }
    return out;
  }

  // Post-rule products with no reverse char-map entry (फ, ऊ, and bare ष in
  // Preeti) map to the exact keystrokes their forward post-rule consumes.
  function applyExtraReverse(text, format) {
    const extra = EXTRA_REVERSE[FONT_KEYS[format]];
    if (!extra) return text;
    let out = text;
    for (const ch of Object.keys(extra)) {
      out = out.split(ch).join(extra[ch]);
    }
    return out;
  }

  // Character set the format can actually represent (used to warn about
  // unsupported input without ever destroying it).
  function representableChars(format) {
    const rules = rulesFor(format);
    const chars = new Set();
    const cm = rules['char-map'];
    for (const key of Object.keys(cm)) {
      for (const ch of cm[key]) chars.add(ch);
    }
    for (const [, rep] of INVERSE_RULES) {
      const text = typeof rep === 'string' ? rep : '';
      for (const ch of text) chars.add(ch);
    }
    // Post-rule replacements introduce characters the char-map never emits
    // directly (ो, ौ, ऊ, झ, फ, र्, ...); those must count as representable.
    for (const [, rep] of POST_RULES) {
      for (const ch of rep) chars.add(ch);
    }
    // Same for the extra-reverse post-rule products (फ, ऊ, Preeti ष).
    const fontKey = FONT_KEYS[format];
    const extra = EXTRA_REVERSE[fontKey];
    if (extra) {
      for (const ch of Object.keys(extra)) chars.add(ch);
    }
    for (const ch of '।१२३४५६७८९०') chars.add(ch);
    return chars;
  }

  // Unicode punctuation that keys differently in the Preeti layout: the
  // HYPHEN-MINUS is typed as the EN DASH (U+2013) — the Preeti font's dash
  // glyph — and the colon is the ः visarga key M. Nothing else is touched.
  const PUNCT_TO_PREETI = { '-': '–', ':': 'M' };

  function legacyToUnicode(text, format) {
    const rules = rulesFor(format);
    return applyPostRules(applyCharMap(text, rules), rules);
  }

  function unicodeToLegacy(text, format) {
    const rules = rulesFor(format);
    let out = text;
    for (const ch of Object.keys(PUNCT_TO_PREETI)) {
      out = out.split(ch).join(PUNCT_TO_PREETI[ch]);
    }
    const extra = EXTRA_REVERSE[FONT_KEYS[format]];
    return applyExtraReverse(applyReverseCharMap(applyInverseRules(out), rules, extra), format);
  }

  function convert(text, from, to) {
    if (typeof text !== 'string') return '';
    if (!text || from === to) return text;
    if (from === 'unicode') return unicodeToLegacy(text, to);
    if (to === 'unicode') return legacyToUnicode(text, from);
    // Legacy -> legacy always routes through Unicode; the maps never pair
    // directly.
    return unicodeToLegacy(legacyToUnicode(text, from), to);
  }

  // Count characters that cannot be represented in the target format. Used
  // only for a non-blocking notice; unsupported characters are kept as-is.
  function countUnsupported(text, from, to) {
    if (!text || from === to) return 0;
    let count = 0;
    if (from === 'unicode') {
      const supported = representableChars(to);
      for (const ch of text) {
        if (DEVANAGARI.test(ch) && !supported.has(ch)) count += 1;
      }
    } else {
      const rules = rulesFor(from);
      const cm = rules['char-map'];
      for (const ch of text) {
        if (Object.prototype.hasOwnProperty.call(cm, ch)) continue;
        // Post-rule markers and ASCII pass through layout-faithfully and are
        // never a conversion problem; only non-ASCII leftovers are reported.
        if (ch === '{' || ch === 'm' || /[\s\x21-\x7E]/.test(ch)) continue;
        count += 1;
      }
    }
    return count;
  }

  return {
    FORMATS,
    NAMES,
    convert,
    legacyToUnicode,
    unicodeToLegacy,
    countUnsupported
  };
})();