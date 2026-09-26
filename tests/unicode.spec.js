'use strict';

const { test, expect } = require('@playwright/test');

// Devanagari corpus that exercises vowels, matras, conjuncts, reph, anusvara,
// visarga and full sentences. Latin letters and ASCII punctuation are NOT
// included on purpose: every ASCII char is a legacy keystroke, so mixed text
// converts layout-faithfully and cannot round-trip (asserted separately
// below).
const CORPUS = [
  'क', 'का', 'कि', 'की', 'कु', 'कू', 'के', 'कै', 'को', 'कौ', 'कृ',
  'कं', 'काँ', 'कः',
  'क्र', 'क्य', 'क्क', 'क्त', 'क्ष', 'त्र', 'ज्ञ', 'श्र', 'द्व', 'द्ध', 'ट्ट', 'ण्ड', 'ष्ट',
  'कर्म', 'धर्म', 'अर्क', 'सत्य', 'पत्र', 'ग्रन्थ', 'प्रेम', 'ब्रह्म', 'विद्यालय',
  'नेपाल', 'नमस्ते', 'हाम्रो', 'मेरो', 'पानी', 'खाना', 'गाउँ', 'औषधि',
  'काठमाडौँ', 'स्वागतम्', 'भिक्षा', 'रक्षा', 'श्रीमती', 'श्री', 'कृष्ण', 'रुख', 'पूर्ण', 'द्रुत', 'प्रातः',
  '१२३४५६७८९०',
  'मेरो नाम राम हो।',
  'के तपाईं ठीक हुनुहुन्छ?',
  'कि कु के कै को',
  'ट्', 'ड्', 'त्त', 'त्र्', 'ज्ञ्', 'क्य', 'श्च', 'स्त्र', 'क्र्', 'गर्नु',
  // conjunct-र् vs reph: र् preceded by a halant is a conjunct element and
  // must not be read as a reph (क्र्म, क्रर्क), while true rephs (कर्म,
  // वर्ष, र्क) still round-trip.
  'क्र्म', 'क्रर्क', 'र्र', 'कर्', 'गर्', 'र्क', 'स्वर्ग', 'शिरोमणि', 'प्रेमा',
  'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ', 'अं', 'अः',
];

const FORWARDS = {
  preeti: {
    'sf': 'का',
    'ls': 'कि',
    'sL': 'की',
    "s'": 'कु',
    's"': 'कू',
    's[': 'कृ',
    's]': 'के',
    's}': 'कै',
    'sf]': 'को',
    'sf}': 'कौ',
    's+': 'कं',
    'sM': 'कः',
    's\\/': 'क्र',
    's\\o': 'क्य',
    's\\s': 'क्क',
    's\\t': 'क्त',
    'I': 'क्ष्',
    'q': 'त्र',
    '1': 'ज्ञ',
    '>': 'श्र',
    'å': 'द्व',
    '4': 'द्ध',
    '§': 'ट्ट',
    '08': 'ण्ड',
    'i6': 'ष्ट',
    'kT/': 'पत्र',
    'u\\/Gy': 'ग्रन्थ',
    'k\\/]d': 'प्रेम',
    'a\\/Xd': 'ब्रह्म',
    'g]kfn': 'नेपाल',
    'sd{': 'कर्म',
    'wd{': 'धर्म',
    'cs{': 'अर्क',
    ';To': 'सत्य',
    'ljBfno': 'विद्यालय',
    'sf7df8f}F': 'काठमाडौँ',
    'T/\\': 'त्र्',
    's\\/\\': 'क्र्',
    '!@#$%^&*()': '१२३४५६७८९०',
    'sfd g]kfn h:tf]': 'काम नेपाल जस्तो'
  }
};

test.describe('conversion engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/unicode');
  });

  test('legacy -> Unicode -> legacy round-trips every corpus item', async ({ page }) => {
    const results = await page.evaluate(corpus => {
      const failures = [];
      for (const text of corpus) {
        const leg = UnicodeConverter.convert(text, 'unicode', 'preeti');
        const back = UnicodeConverter.convert(leg, 'preeti', 'unicode');
        if (back !== text) failures.push({ text, leg, back });
      }
      return failures;
    }, CORPUS);

    expect(results, `preeti failures: ${JSON.stringify(results)}`).toEqual([]);
  });

  test('preeti keystrokes convert to the expected Unicode', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [leg, expected] of Object.entries(cases)) {
        out[leg] = UnicodeConverter.convert(leg, 'preeti', 'unicode');
      }
      return out;
    }, FORWARDS.preeti);

    for (const [leg, expected] of Object.entries(FORWARDS.preeti)) {
      expect(results[leg], `keystroke ${JSON.stringify(leg)}`).toBe(expected);
    }
  });

  test('ASCII text is layout-faithful: letters are legacy keystrokes', async ({ page }) => {
    // "Nepal" typed with a Preeti font renders as ल्भउबि; the converter does
    // the same thing. Latin input therefore converts, not preserves.
    const got = await page.evaluate(() => UnicodeConverter.convert('Nepal', 'preeti', 'unicode'));
    expect(got).toBe('ल्भउबि');

    // Legacy "m" is the "make dependent" marker, not an unsupported char.
    const count = await page.evaluate(() => UnicodeConverter.countUnsupported('sfd m g]kfn', 'preeti', 'unicode'));
    expect(count).toBe(0);
  });

  test('countUnsupported reports only genuinely unconvertible characters', async ({ page }) => {
    const checks = await page.evaluate(() => ({
      devanagariInPreeti: UnicodeConverter.countUnsupported('क', 'preeti', 'unicode'),
      emoji: UnicodeConverter.countUnsupported('क🙂', 'preeti', 'unicode'),
      matraO: UnicodeConverter.countUnsupported('को', 'unicode', 'preeti'),
      latinBang: UnicodeConverter.countUnsupported('हो!', 'unicode', 'preeti'),
      rareChar: UnicodeConverter.countUnsupported('कऱ', 'unicode', 'preeti'),
      identity: UnicodeConverter.countUnsupported('क', 'unicode', 'unicode')
    }));
    expect(checks.devanagariInPreeti).toBe(1);
    expect(checks.emoji).toBe(2);
    expect(checks.matraO).toBe(0);
    expect(checks.latinBang).toBe(0);
    expect(checks.rareChar).toBe(1);
    expect(checks.identity).toBe(0);
  });

  test('preeti bare ष now encodes as its canonical keystrokes', async ({ page }) => {
    const results = await page.evaluate(() => ({
      varsha: UnicodeConverter.convert('वर्ष', 'unicode', 'preeti'),
      aksha: UnicodeConverter.convert('अक्ष', 'unicode', 'preeti'),
      kasha: UnicodeConverter.convert('काश', 'unicode', 'preeti'),
      back: UnicodeConverter.convert(
        UnicodeConverter.convert('वर्ष', 'unicode', 'preeti'),
        'preeti',
        'unicode'
      )
    }));
    // Preeti has no bare-ष keystroke, so bare ष uses the "if" trick
    // (ष् + dummy ा, removed by the ्ा post-rule) exactly like a Preeti
    // typist would type it. क्ष encodes as its own key + dummy ा ("If"),
    // so अक्ष is c + If, and the round trip restores the original.
    expect(results.varsha).toBe('jif{');
    expect(results.aksha).toBe('cIf');
    expect(results.kasha).toBe('sfz');
    expect(results.back).toBe('वर्ष');
  });
});

test.describe('preeti post-rule products and r-conjuncts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/unicode');
  });

  // Characters produced only by forward post-rules (पm -> फ, उm -> ऊ, and
  // bare ष via the ष् + dummy ा trick) previously leaked through as literal
  // Devanagari that no Preeti font can render. They now map to the exact
  // keystrokes their post-rule consumes.
  const POST_RULE_PRODUCTS = {
    'फ': 'km',
    'ष': 'if',
    'ऊ': 'pm'
  };

  // consonant + ् + र: the pair is the consonant's key followed by the
  // Preeti ्र key "|" (प्र -> k|, क्र -> s|). त्र/द्र/श्र/ध्र keep their
  // dedicated keys, and फ्र keys as क् + ्र + m (k|m) — the पm->फ product
  // form with the ्र slotted between the two product keys.
  const R_CONJUNCTS = {
    'प्र': 'k|',
    'क्र': 's|',
    'म्र': 'd|',
    'ब्र': 'a|',
    'ग्र': 'u|',
    'त्र': 'q',
    'द्र': '›',
    'फ्र': 'k|m',
    'भ्र': 'e|',
    'श्र': '>',
    'स्र': ';|',
    'ह्र': 'x|',
    'ट्र': '6«'
  };

  const STANDALONES = {
    'क': 's', 'ख': 'v', 'ग': 'u', 'च': 'r', 'ज': 'h', 'ट': '6',
    'त': 't', 'द': 'b', 'प': 'k', 'ब': 'a', 'म': 'd', 'य': 'o',
    'र': '/', 'ल': 'n', 'व': 'j', 'श': 'z', 'स': ';', 'ह': 'x'
  };

  test('post-rule products map to their canonical keystrokes', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        out[uni] = UnicodeConverter.convert(uni, 'unicode', 'preeti');
      }
      return out;
    }, POST_RULE_PRODUCTS);

    for (const [uni, leg] of Object.entries(POST_RULE_PRODUCTS)) {
      expect(results[uni], uni).toBe(leg);
    }
  });

  test('r-conjuncts encode as consonant + the ्र pipe, dedicated keys preserved', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        out[uni] = UnicodeConverter.convert(uni, 'unicode', 'preeti');
      }
      return out;
    }, R_CONJUNCTS);

    for (const [uni, leg] of Object.entries(R_CONJUNCTS)) {
      expect(results[uni], uni).toBe(leg);
    }
    for (const uni of ['प्र', 'क्र', 'म्र', 'ब्र', 'ग्र', 'भ्र', 'स्र', 'ह्र']) {
      expect(results[uni], uni).toContain('|');
    }
    expect(results['ट्र']).toBe('6«');
    expect(results['फ्र']).toContain('|');
    expect(results['त्र']).toBe('q');
    expect(results['द्र']).toBe('›');
    expect(results['श्र']).toBe('>');
  });

  // फ्र + every matra: the र् pipe slots between the two keys of the फ
  // product (प्m -> पm) so the m marker stays where the forward rule expects
  // it. The ि matra jumps before क via the ि inverse rule (फ्रि -> lk|m).
  const FRA_MATRAS = {
    'फ्र': 'k|m', 'फ्रा': 'k|mf', 'फ्रि': 'lk|m', 'फ्री': 'k|mL',
    'फ्रु': "k|m'", 'फ्रू': 'k|m"', 'फ्रे': 'k|m]', 'फ्रै': 'k|m}',
    'फ्रो': 'k|mf]', 'फ्रौ': 'k|mf}'
  };

  test('every फ्र matra combination keys as k|m + matra and round-trips', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const converted = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { json: JSON.stringify(converted), leg: converted, back: UnicodeConverter.convert(converted, 'preeti', 'unicode') };
      }
      return out;
    }, FRA_MATRAS);

    for (const [uni, leg] of Object.entries(FRA_MATRAS)) {
      expect(results[uni].json, uni).toBe(JSON.stringify(leg));
      expect(results[uni].leg, uni).toBe(leg);
      expect(results[uni].back, uni).toBe(uni);
      expect(results[uni].leg, uni).not.toMatch(/[\u0900-\u097F]/);
    }
  });

  // HYPHEN-MINUS (U+002D) is typed as the EN DASH (U+2013) in the Preeti
  // layout — the Preeti font's dash glyph — and the colon (U+003A) is typed
  // as the ः visarga key M. The EN DASH and EM DASH inputs pass through, and
  // the visarga keeps its existing M key. Preeti -> Unicode (M -> ः, : -> स्)
  // is untouched.
  const PUNCT_CASES = { '-': '–', '–': '–', '—': '—', ':': 'M', 'ः': 'M' };

  test('HYPHEN-MINUS and colon normalize to their Preeti keystrokes', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const converted = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { json: JSON.stringify(converted), leg: converted, cp: converted.codePointAt(0) };
      }
      return out;
    }, PUNCT_CASES);

    for (const [uni, leg] of Object.entries(PUNCT_CASES)) {
      expect(results[uni].json, uni).toBe(JSON.stringify(leg));
      expect(results[uni].leg, uni).toBe(leg);
    }
    expect(results['-'].cp).toBe(0x2013);
    expect(results[':'].cp).toBe(0x004D);
  });

  test('standalone consonants keep their direct keys', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        out[uni] = UnicodeConverter.convert(uni, 'unicode', 'preeti');
      }
      return out;
    }, STANDALONES);

    for (const [uni, leg] of Object.entries(STANDALONES)) {
      expect(results[uni], uni).toBe(leg);
    }
  });

  test('post-rule products and r-conjuncts round-trip in real text', async ({ page }) => {
    const text = 'फूल षड्यन्त्र प्रकाश कृष्ण ब्रह्म ग्रन्थ त्रिकोण श्रद्धा';
    const result = await page.evaluate(text => {
      const leg = UnicodeConverter.convert(text, 'unicode', 'preeti');
      return { leg, back: UnicodeConverter.convert(leg, 'preeti', 'unicode') };
    }, text);
    expect(result.back).toBe(text);
    expect(result.leg).not.toContain('फ');
    expect(result.leg).not.toContain('ष');
  });

  test('ट्र keeps the « ्र glyph through every matra and round-trips', async ({ page }) => {
    const TRA_MATRAS = {
      'ट्रा': '6«f', 'ट्रि': 'l6«', 'ट्री': '6«L', 'ट्रु': "6«'", 'ट्रू': '6«"',
      'ट्रे': '6«]', 'ट्रै': '6«}', 'ट्रो': '6«f]', 'ट्रौ': '6«f}'
    };
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const converted = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { leg: converted, back: UnicodeConverter.convert(converted, 'preeti', 'unicode') };
      }
      return out;
    }, TRA_MATRAS);

    for (const [uni, leg] of Object.entries(TRA_MATRAS)) {
      expect(results[uni].leg, uni).toBe(leg);
      expect(results[uni].back, uni).toBe(uni);
      expect(results[uni].leg, uni).toContain('«');
    }
  });

  test('real words with ट्र keep the « glyph and round-trip', async ({ page }) => {
    const TRA_WORDS = {
      'ट्रक': '6«s', 'ट्रेन': '6«]g', 'ट्राफिक': '6«flkms',
      'ट्रस्ट': '6«:6', 'ट्रिप': 'l6«k', 'ट्रेड': '6«]8'
    };
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const converted = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { leg: converted, back: UnicodeConverter.convert(converted, 'preeti', 'unicode') };
      }
      return out;
    }, TRA_WORDS);

    for (const [uni, leg] of Object.entries(TRA_WORDS)) {
      expect(results[uni].leg, uni).toBe(leg);
      expect(results[uni].back, uni).toBe(uni);
      expect(results[uni].leg, uni).toContain('«');
    }
  });

  // Reph र् + consonant: rule-driven, no word-specific handling. The reph
  // keys as { at the end of the syllable it precedes (कर्म -> sd{), and
  // right-side matras stay after it (र्ती -> tL{), while ि jumps before
  // its consonant (कीर्तिपुर -> sLlt{k'/).
  const REPH_WORDS = {
    'कीर्तिपुर': 'sLlt{k\'/',
    'कीर्ति': 'sLlt{',
    'कीर्तिमान': 'sLlt{dfg',
    'कीर्तिशाली': 'sLlt{zfnL',
    'कीर्तिले': 'sLlt{n]',
    'कीर्तिको': 'sLlt{sf]',
    'कीर्तिमा': 'sLlt{df',
    'मूर्ति': 'd"lt{',
    'पूर्ति': 'k"lt{',
    'पूर्तिको': 'k"lt{sf]',
    'स्मृति': ':d[lt',
    'वृत्ति': 'j[lQ',
    'प्रवृत्ति': 'k|j[lQ',
    'संस्कृति': ';+:s[lt',
    'प्रकृति': 'k|s[lt',
    'स्थिति': 'l:ylt',
    'दुर्ग': 'b\'u{',
    'वर्तमान': 'jt{dfg',
    'कर्तव्य': 'st{Jo',
    'कर्त्ता': 'sQf{',
    'निर्माण': 'lgdf{0f',
    'निर्देशन': 'lgb]{zg',
    'निर्णय': 'lg0f{o',
    'कर्म': 'sd{',
    'स्वर्ग': ':ju{',
    'र्क': 's{',
    'गर्नु': 'ug\'{'
  };

  const REPH_MATRAS = {
    'र्ति': 'lt{', 'र्ती': 'tL{', 'र्तु': "t'{", 'र्तू': 't"{',
    'र्ते': 't]{', 'र्तै': 't}{', 'र्तो': 'tf]{', 'र्तौ': 'tf}{',
    'र्कि': 'ls{', 'र्की': 'sL{', 'र्गि': 'lu{', 'र्गी': 'uL{',
    'र्नि': 'lg{', 'र्नी': 'gL{', 'र्मि': 'ld{', 'र्मी': 'dL{',
    'र्पि': 'lk{', 'र्पी': 'kL{', 'र्बि': 'la{', 'र्बी': 'aL{'
  };

  test('reph words encode canonically with { at the syllable end and round-trip', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const converted = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { leg: converted, back: UnicodeConverter.convert(converted, 'preeti', 'unicode') };
      }
      return out;
    }, REPH_WORDS);

    for (const [uni, leg] of Object.entries(REPH_WORDS)) {
      expect(results[uni].leg, uni).toBe(leg);
      expect(results[uni].back, uni).toBe(uni);
      expect(results[uni].leg, uni).not.toMatch(/[\u0900-\u097F]/);
    }
  });

  test('every र्त/र्क family matra combination keeps the { reph and round-trips', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const converted = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { leg: converted, back: UnicodeConverter.convert(converted, 'preeti', 'unicode') };
      }
      return out;
    }, REPH_MATRAS);

    for (const [uni, leg] of Object.entries(REPH_MATRAS)) {
      expect(results[uni].leg, uni).toBe(leg);
      expect(results[uni].back, uni).toBe(uni);
      expect(results[uni].leg, uni).toContain('{');
    }
  });

  test('bare consonant + halant keys as the consonant plus \\ (न् -> g\)', async ({ page }) => {
    const BARE_HALANTS = { 'न्': 'g\\', 'क्': 's\\', 'त्': 't\\', 'स्': ';\\', 'म्': 'd\\' };
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const converted = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { leg: converted, back: UnicodeConverter.convert(converted, 'preeti', 'unicode') };
      }
      return out;
    }, BARE_HALANTS);

    for (const [uni, leg] of Object.entries(BARE_HALANTS)) {
      expect(results[uni].leg, uni).toBe(leg);
      expect(results[uni].back, uni).toBe(uni);
    }
    // Halants inside conjuncts keep their dedicated keys.
    expect(results['न्'].leg).toBe('g\\');
  });

  test('no false unsupported-char warning for फ, ष or ऊ', async ({ page }) => {
    const counts = await page.evaluate(() => ({
      fa: UnicodeConverter.countUnsupported('फ', 'unicode', 'preeti'),
      sha: UnicodeConverter.countUnsupported('ष', 'unicode', 'preeti'),
      oo: UnicodeConverter.countUnsupported('ऊ', 'unicode', 'preeti')
    }));
    expect(counts).toEqual({ fa: 0, sha: 0, oo: 0 });
  });

  test('output textarea applies the Preeti font for Preeti output', async ({ page }) => {
    await page.selectOption('#ucTo', 'preeti');
    await page.locator('#ucInput').fill('प्रकाश');
    await expect(page.locator('#ucOutput')).toHaveValue('k|sfz');
    const fontFamily = await page.locator('#ucOutput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain('Preeti');
  });

  // The user-facing fix: प्र must encode as exactly k| (lowercase k plus the
  // Preeti ्र pipe), while फ/ष/क्र/म्र keep their keys. ण and क्ष have no
  // bare key in the map, so they use the dummy-ा trick: their ्-form key
  // plus the ा key (0 + f, i + f, I + f), stripped by the ्ा post-rule.
  const PRA_CASES = {
    'प्र': 'k|',
    'क्र': 's|',
    'म्र': 'd|',
    'फ': 'km',
    'ष': 'if',
    'ण': '0f',
    'क्ष': 'If'
  };

  const PRA_VOWELS = {
    'प्रा': 'k|f',
    'प्रि': 'lk|',
    'प्री': 'k|L',
    'प्रु': "k|'",
    'प्रू': 'k|"',
    'प्रे': 'k|]',
    'प्रै': 'k|}',
    'प्रो': 'k|f]',
    'प्रौ': 'k|f}',
    'प्रः': 'k|M',
    'प्रं': 'k|+'
  };

  const PRA_WORDS = {
    'प्रेम': 'k|]d',
    'प्रकाश': 'k|sfz',
    'प्रयोग': 'k|of]u',
    'प्रश्न': 'k|Zg',
    'प्रगति': 'k|ult',
    'प्रहरी': 'k|x/L'
  };

  test('प्र converts to exactly k| and the rest of the regression set holds', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        out[uni] = UnicodeConverter.convert(uni, 'unicode', 'preeti');
      }
      return out;
    }, PRA_CASES);

    for (const [uni, leg] of Object.entries(PRA_CASES)) {
      expect(results[uni], uni).toBe(leg);
    }
    expect(results['प्र']).toBe('k|');
    expect(results['प्र']).not.toBe('K|');
    expect(results['प्र']).not.toBe('K/');
  });

  test('every प्र vowel combination keeps the pipe and round-trips', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const encoded = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = {
          encoded,
          back: UnicodeConverter.convert(encoded, 'preeti', 'unicode')
        };
      }
      return out;
    }, PRA_VOWELS);

    for (const [uni, leg] of Object.entries(PRA_VOWELS)) {
      expect(results[uni].encoded, uni).toBe(leg);
      expect(results[uni].back, `${uni} round trip`).toBe(uni);
    }
  });

  test('common प्र words start with k| and round-trip', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const encoded = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { encoded, back: UnicodeConverter.convert(encoded, 'preeti', 'unicode') };
      }
      return out;
    }, PRA_WORDS);

    for (const [uni, leg] of Object.entries(PRA_WORDS)) {
      expect(results[uni].encoded, uni).toBe(leg);
      expect(results[uni].back, `${uni} round trip`).toBe(uni);
    }
    expect(results['प्रेम'].encoded.startsWith('k|')).toBe(true);
  });

  // ण/ष/क्ष share the dummy-ा trick: the bare letter is their ्-form key
  // plus the ा key (0f, if, If), and every matra builds on that. The exact
  // keystrokes are taken from the char-map keys (0/ि, i/ष्, I/क्ष्, f/ा).
  const DUMMY_MATRAS = {
    'णा': '0ff', 'णि': 'l0f', 'णी': '0fL', 'णु': "0f'", 'णू': '0f"',
    'णे': '0f]', 'णै': '0f}', 'णो': '0ff]', 'णौ': '0ff}',
    'षा': 'iff', 'षि': 'lif', 'षी': 'ifL', 'षु': "if'", 'षू': 'if"',
    'षे': 'if]', 'षै': 'if}', 'षो': 'iff]', 'षौ': 'iff}',
    'क्षा': 'Iff', 'क्षि': 'lIf', 'क्षी': 'IfL', 'क्षु': "If'", 'क्षू': 'If"',
    'क्षे': 'If]', 'क्षै': 'If}', 'क्षो': 'Iff]', 'क्षौ': 'Iff}'
  };

  test('ण/ष/क्ष matras keep the dummy ा and round-trip', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const encoded = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { encoded, back: UnicodeConverter.convert(encoded, 'preeti', 'unicode') };
      }
      return out;
    }, DUMMY_MATRAS);

    for (const [uni, leg] of Object.entries(DUMMY_MATRAS)) {
      expect(results[uni].encoded, uni).toBe(leg);
      expect(results[uni].back, `${uni} round trip`).toBe(uni);
    }
  });

  // Real words exercising bare ण, bare क्ष, ष्/ण् conjuncts and the dummy ा.
  const DUMMY_WORDS = {
    'गणेश': 'u0f]z',
    'विष्णु': "lji0f'",
    'कृष्ण': 's[i0f',
    'क्षमा': 'Ifdf',
    'क्षेत्र': 'If]q',
    'फूल': 'km"n',
    'प्रेम': 'k|]d',
    'प्रकाश': 'k|sfz',
    'प्रश्न': 'k|Zg',
    'प्रयोग': 'k|of]u'
  };

  test('real words with ण/ष/क्ष/फ/प्र encode canonically and round-trip', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [uni, leg] of Object.entries(cases)) {
        const encoded = UnicodeConverter.convert(uni, 'unicode', 'preeti');
        out[uni] = { encoded, back: UnicodeConverter.convert(encoded, 'preeti', 'unicode') };
      }
      return out;
    }, DUMMY_WORDS);

    for (const [uni, leg] of Object.entries(DUMMY_WORDS)) {
      expect(results[uni].encoded, uni).toBe(leg);
      expect(results[uni].back, `${uni} round trip`).toBe(uni);
      // No Devanagari may leak into the Preeti output.
      expect(results[uni].encoded, `${uni} has no Devanagari`).not.toMatch(/[\u0900-\u097f]/);
    }
  });
});

test.describe('hisab conversion engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/unicode');
  });

  // Hisab shares Preeti's letter rows and post-rules; only the number/top row
  // differs. Numbers type as Devanagari numerals (1 -> १) in Hisab, whereas
  // Preeti types them as conjuncts and symbols (1 -> ज्ञ, ! -> १).
  const FORWARDS = {
    'sf': 'का',
    's]': 'के',
    'sf]': 'को',
    'g]kfn': 'नेपाल',
    'sf&df*f}F': 'काठमाडौँ',
    'gd:t]': 'नमस्ते',
    '1': '१', '2': '२', '3': '३', '4': '४', '5': '५',
    '6': '६', '7': '७', '8': '८', '9': '९', '0': '०',
    '!': 'ज्ञ', '#': 'घ', '$': 'द्ध', '%': 'छ', '&': 'ठ',
    '(': 'ढ', ')': 'ण्', '*': 'ड'
  };

  test('hisab keystrokes convert to the expected Unicode', async ({ page }) => {
    const results = await page.evaluate(cases => {
      const out = {};
      for (const [leg] of Object.entries(cases)) {
        out[leg] = UnicodeConverter.convert(leg, 'hisab', 'unicode');
      }
      return out;
    }, FORWARDS);

    for (const [leg, expected] of Object.entries(FORWARDS)) {
      expect(results[leg], `keystroke ${JSON.stringify(leg)}`).toBe(expected);
    }
  });

  test('hisab -> Unicode -> hisab round-trips every corpus item', async ({ page }) => {
    const results = await page.evaluate(corpus => {
      const failures = [];
      for (const text of corpus) {
        const leg = UnicodeConverter.convert(text, 'unicode', 'hisab');
        const back = UnicodeConverter.convert(leg, 'hisab', 'unicode');
        if (back !== text) failures.push({ text, leg, back });
      }
      return failures;
    }, CORPUS);

    expect(results, `hisab failures: ${JSON.stringify(results)}`).toEqual([]);
  });

  test('hisab bare ष/ण encode with Hisab keys and the dummy-ा trick', async ({ page }) => {
    const results = await page.evaluate(() => ({
      varsh: UnicodeConverter.convert('वर्ष', 'unicode', 'hisab'),
      ganesh: UnicodeConverter.convert('गणेश', 'unicode', 'hisab')
    }));
    // ष and ण have no bare Hisab key; they encode as their ्-key plus the
    // dummy ा (ष = i + f, ण = ) + f) exactly like a Hisab typist types them.
    expect(results.varsh).toBe('jif{');
    expect(results.ganesh).toBe('u)f]z');
  });

  test('Hisab and Preeti diverge only on the number/top row', async ({ page }) => {
    const results = await page.evaluate(() => ({
      preetiDigit: UnicodeConverter.convert('१', 'unicode', 'preeti'),
      hisabDigit: UnicodeConverter.convert('१', 'unicode', 'hisab'),
      preetiJna: UnicodeConverter.convert('ज्ञ', 'unicode', 'preeti'),
      hisabJna: UnicodeConverter.convert('ज्ञ', 'unicode', 'hisab'),
      preetiWord: UnicodeConverter.convert('नेपाल', 'unicode', 'preeti'),
      hisabWord: UnicodeConverter.convert('नेपाल', 'unicode', 'hisab')
    }));
    // Identical letters, swapped top row: १ is "!" in Preeti but "1" in
    // Hisab, and ज्ञ is "1" in Preeti but "!" in Hisab.
    expect(results.preetiDigit).toBe('!');
    expect(results.hisabDigit).toBe('1');
    expect(results.preetiJna).toBe('1');
    expect(results.hisabJna).toBe('!');
    expect(results.preetiWord).toBe('g]kfn');
    expect(results.hisabWord).toBe('g]kfn');
  });

  test('hisab <-> preeti routes through Unicode', async ({ page }) => {
    const results = await page.evaluate(() => {
      const uni = UnicodeConverter.convert('g]kfn', 'hisab', 'unicode');
      return {
        uni,
        hisabToPreeti: UnicodeConverter.convert('g]kfn', 'hisab', 'preeti'),
        preetiToHisab: UnicodeConverter.convert(uni, 'preeti', 'hisab')
      };
    });
    expect(results.uni).toBe('नेपाल');
    // Shared letter rows mean the same keystroke round-trips in both fonts.
    expect(results.hisabToPreeti).toBe('g]kfn');
    expect(results.preetiToHisab).toBe('g]kfn');
  });
});

test.describe('unicode converter UI', () => {
  test('live conversion: typing converts immediately and counts characters', async ({ page }) => {
    await page.goto('/unicode');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await expect(page.locator('#view-unicode h1')).toHaveText('Unicode Converter');
    await expect(page.locator('#view-unicode .workspace-heading p')).toHaveText(
      'Convert Nepali text between Unicode and Preeti.'
    );
    await expect(page.locator('#ucInput')).toHaveAttribute('placeholder', "lk|tL 6]S:6 oxfF 6fOk ug{'xf]; jf k]:6 ug{'xf]; .");
    await expect(page.locator('#ucConvert')).toBeDisabled();

    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
    await expect(page.locator('#ucInputCount')).toHaveText('5 characters');
    await expect(page.locator('#ucOutputCount')).toHaveText('5 characters');
    await expect(page.locator('#ucConvert')).toBeEnabled();
    await expect(page.locator('#ucInputFormat')).toHaveText('Preeti');
    await expect(page.locator('#ucOutputFormat')).toHaveText('Unicode');
    await expect(page.locator('#ucStatus')).toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('live conversion can be disabled and the Convert button takes over', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucLive').uncheck();
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('');
    await page.locator('#ucConvert').click();
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
  });

  test('Ctrl+Enter converts even with live conversion off', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucLive').uncheck();
    await page.locator('#ucInput').fill('g]kfn');
    await page.locator('#ucInput').press('Control+Enter');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
  });

  test('swap exchanges formats and moves the converted text to the input', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');

    await page.locator('#ucSwap').click();
    await expect(page.locator('#ucFrom')).toHaveValue('unicode');
    await expect(page.locator('#ucTo')).toHaveValue('preeti');
    await expect(page.locator('#ucInput')).toHaveValue('नेपाल');
    await expect(page.locator('#ucOutput')).toHaveValue('g]kfn');
  });

  test('swapping into an empty input clears the output', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
    await page.locator('#ucInput').fill('');
    await expect(page.locator('#ucOutput')).toHaveValue('');
    await page.locator('#ucSwap').click();
    await expect(page.locator('#ucInput')).toHaveValue('');
    await expect(page.locator('#ucOutput')).toHaveValue('');
  });

  test('unsupported characters are kept and reported non-blockingly', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('क g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('क नेपाल');
    await expect(page.locator('#ucStatus')).toHaveText('Some characters could not be converted.');
  });

  test('copy copies the converted text and shows Copied!', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');

    await page.locator('#ucCopy').click();
    await expect(page.locator('#ucCopy')).toHaveText('Copied!');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('नेपाल');
    await expect(page.locator('#ucCopy')).toHaveText('Copy');
  });

  test('download saves the converted text as a UTF-8 txt file', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#ucDownload').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('converted-unicode.txt');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('नेपाल');
  });

  test('pasting from the clipboard fills the input and converts', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/unicode');
    await page.evaluate(() => navigator.clipboard.writeText('g]kfn'));
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucPaste').click();
    await expect(page.locator('#ucInput')).toHaveValue('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
  });

  test('clear empties both panels without a dialog for small text', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#ucClear').click();
    await expect(page.locator('#ucInput')).toHaveValue('');
    await expect(page.locator('#ucOutput')).toHaveValue('');
  });

  test('clear confirms before wiping large text', async ({ page }) => {
    await page.goto('/unicode');
    const big = 'सत्य '.repeat(150);
    await expect(page.locator('#ucFrom')).toHaveValue('preeti');
    await expect(page.locator('#ucTo')).toHaveValue('unicode');
    // Default direction is Preeti → Unicode, so feed the Preeti keystrokes and
    // confirm the output reproduces the full Unicode source text.
    const preetiBig = await page.evaluate(t => UnicodeConverter.convert(t, 'unicode', 'preeti'), big);
    await page.locator('#ucInput').fill(preetiBig);
    await expect(page.locator('#ucOutput')).toHaveValue(big);

    // The confirm() dialog blocks the click until accepted, so accept it
    // immediately and record the message for the assertion.
    let dialogMessage = '';
    page.once('dialog', dialog => {
      dialogMessage = dialog.message();
      dialog.accept();
    });
    await page.locator('#ucClear').click();
    expect(dialogMessage).toContain('Clear');
    await expect(page.locator('#ucInput')).toHaveValue('');
    await expect(page.locator('#ucOutput')).toHaveValue('');
  });

  test('char counts use Unicode code points, not UTF-16 units', async ({ page }) => {
    await page.goto('/unicode');
    await page.locator('#ucInput').fill('नेपाल');
    await expect(page.locator('#ucInputCount')).toHaveText('5 characters');
    await page.locator('#ucInput').fill('🙂नेपाल');
    await expect(page.locator('#ucInputCount')).toHaveText('6 characters');
  });

  test('formats can never be set to the same value', async ({ page }) => {
    await page.goto('/unicode');
    // The last-changed select keeps its value; the other one moves.
    await page.selectOption('#ucFrom', 'preeti');
    await expect(page.locator('#ucFrom')).toHaveValue('preeti');
    await expect(page.locator('#ucTo')).toHaveValue('unicode');
    await page.selectOption('#ucTo', 'preeti');
    await expect(page.locator('#ucTo')).toHaveValue('preeti');
    await expect(page.locator('#ucFrom')).not.toHaveValue('preeti');
    // Re-selecting the same value is a no-op and disturbs nothing.
    await page.selectOption('#ucFrom', 'unicode');
    await expect(page.locator('#ucTo')).toHaveValue('preeti');
  });

  test('fonts only affect preview, never conversion', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    const fontFamily = await page.locator('#ucInput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain('Preeti');
    const outputFont = await page.locator('#ucOutput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(outputFont).toContain('Noto Sans Devanagari');
  });

  test('Hisab input and output render in the Hisab font, Preeti in the Preeti font', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'hisab');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
    let inputFont = await page.locator('#ucInput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(inputFont).toContain('Hisab');
    let outputFont = await page.locator('#ucOutput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(outputFont).toContain('Noto Sans Devanagari');

    // Switching Preeti -> Hisab updates both textarea fonts immediately.
    await page.selectOption('#ucTo', 'hisab');
    await page.selectOption('#ucFrom', 'preeti');
    inputFont = await page.locator('#ucInput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(inputFont).toContain('Preeti');
    outputFont = await page.locator('#ucOutput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(outputFont).toContain('Hisab');

    // Unicode target falls back to the Devanagari Unicode font stack.
    await page.selectOption('#ucTo', 'preeti');
    outputFont = await page.locator('#ucOutput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(outputFont).toContain('Preeti');
    await page.selectOption('#ucTo', 'unicode');
    outputFont = await page.locator('#ucOutput').evaluate(el => getComputedStyle(el).fontFamily);
    expect(outputFont).toContain('Noto Sans Devanagari');
  });

  test('input/output badges always match the selected From/To encodings', async ({ page }) => {
    await page.goto('/unicode');
    // A) From: Preeti, To: Hisab
    await page.selectOption('#ucFrom', 'preeti');
    await page.selectOption('#ucTo', 'hisab');
    await expect(page.locator('#ucInputFormat')).toHaveText('Preeti');
    await expect(page.locator('#ucOutputFormat')).toHaveText('Hisab');
    // B) From: Hisab, To: Preeti
    await page.selectOption('#ucTo', 'preeti');
    await expect(page.locator('#ucInputFormat')).toHaveText('Hisab');
    await expect(page.locator('#ucOutputFormat')).toHaveText('Preeti');
    // E) Swap: From: Preeti, To: Hisab again
    await page.locator('#ucSwap').click();
    await expect(page.locator('#ucFrom')).toHaveValue('preeti');
    await expect(page.locator('#ucTo')).toHaveValue('hisab');
    await expect(page.locator('#ucInputFormat')).toHaveText('Preeti');
    await expect(page.locator('#ucOutputFormat')).toHaveText('Hisab');
  });

  test('placeholders reflect the selected encoding without a reload', async ({ page }) => {
    await page.goto('/unicode');
    await expect(page.locator('#ucInput')).toHaveAttribute('placeholder', "lk|tL 6]S:6 oxfF 6fOk ug{'xf]; jf k]:6 ug{'xf]; .");
    await expect(page.locator('#ucOutput')).toHaveAttribute('placeholder', 'कन्भर्टेड युनीकोड टेक्स्ट यहाँ देखीनेछ ।');

    await page.selectOption('#ucFrom', 'preeti');
    await expect(page.locator('#ucInput')).toHaveClass(/font-preeti/);
    await expect(page.locator('#ucInput')).toHaveAttribute('placeholder', "lk|tL 6]S:6 oxfF 6fOk ug{'xf]; jf k]:6 ug{'xf]; .");
    await expect(page.locator('#ucOutput')).toHaveAttribute('placeholder', 'कन्भर्टेड युनीकोड टेक्स्ट यहाँ देखीनेछ ।');

    await page.selectOption('#ucTo', 'preeti');
    // Selecting To = Preeti auto-swaps the From side (From becomes Hisab) so
    // the input placeholder now renders in the Hisab font.
    await expect(page.locator('#ucInput')).toHaveClass(/font-hisab/);
    await expect(page.locator('#ucInput')).toHaveAttribute('placeholder', "lx;fa ^]S:^ oxfF ^fOk\nug{'xf]; jf k]i^ ug'{xf]; .");
    await expect(page.locator('#ucOutput')).toHaveClass(/font-preeti/);
    await expect(page.locator('#ucOutput')).toHaveAttribute('placeholder', 'sGe6]{8 lk|tL 6]S:6 oxfF b]vLg]5 .');

    await page.selectOption('#ucTo', 'hisab');
    await expect(page.locator('#ucOutput')).toHaveAttribute('placeholder', "sGe^]{\\* lx;fa ^]S:^\noxfF b]vLg]% .");
  });

  test('live conversion re-runs with the new From/To selections immediately', async ({ page }) => {
    await page.goto('/unicode');
    await page.selectOption('#ucFrom', 'preeti');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');

    await page.selectOption('#ucTo', 'hisab');
    await expect(page.locator('#ucOutput')).toHaveValue('g]kfn');

    await page.selectOption('#ucTo', 'unicode');
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
  });

  test('with live conversion off, dropdown changes update only the UI until Convert', async ({ page }) => {
    await page.goto('/unicode');
    await page.locator('#ucLive').uncheck();
    await page.selectOption('#ucFrom', 'preeti');
    await page.selectOption('#ucTo', 'unicode');
    await page.locator('#ucInput').fill('g]kfn');
    await expect(page.locator('#ucOutput')).toHaveValue('');
    await expect(page.locator('#ucInputFormat')).toHaveText('Preeti');
    await expect(page.locator('#ucOutputFormat')).toHaveText('Unicode');

    // Changing To updates the badge/placeholder but not the output.
    await page.selectOption('#ucTo', 'hisab');
    await expect(page.locator('#ucInputFormat')).toHaveText('Preeti');
    await expect(page.locator('#ucOutputFormat')).toHaveText('Hisab');
    await expect(page.locator('#ucOutput')).toHaveValue('');
    await page.locator('#ucConvert').click();
    await expect(page.locator('#ucOutput')).toHaveValue('g]kfn');

    // Changing From to the same value as To pushes To forward; both badges follow.
    await page.selectOption('#ucFrom', 'hisab');
    await expect(page.locator('#ucFrom')).toHaveValue('hisab');
    await expect(page.locator('#ucTo')).toHaveValue('unicode');
    await expect(page.locator('#ucInputFormat')).toHaveText('Hisab');
    await expect(page.locator('#ucOutputFormat')).toHaveText('Unicode');
    await page.locator('#ucConvert').click();
    await expect(page.locator('#ucOutput')).toHaveValue('नेपाल');
  });

  test('layout is responsive: panels stack on mobile and sit side by side on desktop', async ({ page }) => {
    await page.goto('/unicode');
    const panelCols = () => page.evaluate(() => {
      const grid = document.querySelector('.uc-panels');
      return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(panelCols).toBe(1);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(panelCols).toBe(2);
  });

  test('loads without console errors or failed requests', async ({ page }) => {
    const errors = [];
    const failed = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => failed.push(r.url()));
    await page.goto('/unicode');
    await expect(page.locator('#ucInput')).toBeVisible();
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });
});