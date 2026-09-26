/* exported Router, PDFEditorBoot */
'use strict';

// Lightweight path router for the MeroPrayas tools SPA. No framework:
// history.pushState + popstate + per-route view toggling.
const Router = (() => {
  const $ = id => document.getElementById(id);

  const ICONS = {
    compressor: '<svg aria-hidden="true"><use href="#ic-image" /></svg>',
    unicode: '<svg aria-hidden="true"><use href="#ic-type" /></svg>',
    pdf: '<svg aria-hidden="true"><use href="#ic-file-text" /></svg>'
  };

  const ROUTES = {
    '/': {
      view: 'home',
      nav: '/',
      title: 'MeroPrayas — Online Image, PDF & Unicode Converter Tools',
      description: 'Free online tools by S.p. Anjaan — compress images, convert Nepali text (Preeti, Unicode & Hisab), and merge or edit PDF files. Private, offline-first, no uploads.'
    },
    '/compressor': {
      view: 'workspace',
      nav: '/compressor',
      title: 'MeroPrayas-Image Compressor',
      description: 'Compress JPG, PNG, WebP, GIF, BMP and SVG images online — adjust quality, size and format with live previews, entirely in your browser.',
      icon: ICONS.compressor,
      heading: 'Image Compressor',
      subtitle: 'Compress and optimize images with quality, format and size controls.'
    },
    '/unicode': {
      view: 'unicode',
      nav: '/unicode',
      title: 'MeroPrayas-Unicode Converter',
      description: 'Convert Nepali text between Unicode, Preeti and Hisab instantly in your browser. No uploads, works offline.',
      icon: ICONS.unicode,
      heading: 'Unicode Converter',
      subtitle: 'Convert Nepali text between Unicode and Preeti.'
    },
    '/pdf-editor': {
      view: 'pdf-editor',
      nav: '/pdf-editor',
      title: 'MeroPrayas-PDF Tools',
      description: 'Merge, split, compress and convert PDF files online — JPG to PDF, PDF to JPG and more, entirely on your device.',
      icon: ICONS.pdf,
      heading: 'PDF Tools',
      subtitle: 'Merge, split, compress and convert PDF files easily.'
    },
    '/about': {
      view: 'about',
      nav: '/about',
      title: 'MeroPrayas — About',
      description: 'About MeroPrayas and its developer S.p. Anjaan — private, offline-first browser tools for images, PDFs and Nepali text.'
    },
    '/how-it-works': {
      view: 'how-it-works',
      nav: '/how-it-works',
      title: 'MeroPrayas — How It Works',
      description: 'How MeroPrayas works: everything runs locally in your browser — compress images, convert Nepali text and edit PDFs with no uploads.'
    },
    '/privacy': {
      view: 'privacy',
      nav: '/privacy',
      title: 'MeroPrayas — Privacy Policy',
      description: 'MeroPrayas privacy policy — files are processed locally in your browser; no accounts, no ads, no analytics.'
    },
    '/terms': {
      view: 'terms',
      nav: '/terms',
      title: 'MeroPrayas — Terms & Conditions',
      description: 'MeroPrayas terms and conditions — free browser tools for images, PDFs and Nepali text, provided as available.'
    },
    '/contact': {
      view: 'contact',
      nav: '/contact',
      title: 'MeroPrayas — Contact',
      description: 'Contact S.p. Anjaan (spanjaan@gmail.com) — questions, bug reports and feature ideas for MeroPrayas. Connect on Facebook, WhatsApp and YouTube.'
    }
  };

  const VIEWS = ['home', 'workspace', 'unicode', 'pdf-editor', 'about', 'how-it-works', 'privacy', 'terms', 'contact'];

  // PDF tool subroutes (/pdf-editor/merge, ...) share the pdf-editor view.
  const PDF_TOOLS = ['merge', 'split', 'compress', 'jpg-to-pdf', 'pdf-to-jpg'];
  const normalize = path => {
    const clean = path.replace(/\/+$/, '') || '/';
    if (Object.prototype.hasOwnProperty.call(ROUTES, clean)) {
      return { path: clean, matched: true, tool: clean === '/pdf-editor' ? null : undefined };
    }
    if (clean.startsWith('/pdf-editor/')) {
      const tool = clean.slice('/pdf-editor/'.length);
      if (PDF_TOOLS.includes(tool)) {
        return { path: '/pdf-editor', matched: true, tool };
      }
    }
    return { path: '/', matched: false, tool: null };
  };

  function setActiveNav(href) {
    document.querySelectorAll('[data-route]').forEach(link => {
      const active = link.getAttribute('href') === href;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  // Per-route SEO: canonical, meta description and social tags are all derived
  // from the resolved route and kept in sync with the URL on every transition,
  // so deep links carry correct metadata to crawlers and social scrapers.
  const SEO_BASE = 'https://meroprayas.com';
  const SEO_ORG = `${SEO_BASE}/#organization`;
  const SEO_SITE = `${SEO_BASE}/#website`;
  const SEO_APP = `${SEO_BASE}/#app`;

  function setMetaMap(map) {
    Object.entries(map).forEach(([key, value]) => {
      const isProp = key.startsWith('og:');
      const attr = isProp ? 'property' : 'name';
      let el = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      if (el.content !== String(value)) el.content = String(value);
    });
  }

  function setCanonical(path) {
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', SEO_BASE + path);
  }

  function faqQuestions() {
    return Array.from(document.querySelectorAll('#view-contact .faq-item')).map(item => ({
      '@type': 'Question',
      name: item.querySelector('summary') ? item.querySelector('summary').textContent.trim() : '',
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.querySelector('p') ? item.querySelector('p').textContent.trim() : ''
      }
    }));
  }

  function buildJsonLd(route, title, appName) {
    const url = SEO_BASE + (route.nav === '/' ? '/' : route.nav);
    const name = title;
    const page = { '@id': `${url}#webpage` };
    if (route.view === 'home') {
      return { '@context': 'https://schema.org', '@graph': [{
        '@type': 'WebPage', ...page, url, name,
        isPartOf: { '@id': SEO_SITE }, about: { '@id': SEO_APP }
      }] };
    }
    if (route.view === 'workspace' || route.view === 'unicode' || route.view === 'pdf-editor') {
      return { '@context': 'https://schema.org', '@graph': [{
        '@type': 'WebPage', ...page, url, name,
        isPartOf: { '@id': SEO_SITE },
        mainEntity: {
          '@type': 'SoftwareApplication',
          name: appName || route.heading || name,
          applicationCategory: 'UtilitiesApplication',
          operatingSystem: 'Any',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          publisher: { '@id': SEO_ORG }
        }
      }] };
    }
    if (route.view === 'contact') {
      const graph = [{
        '@type': 'ContactPage', ...page, url, name,
        isPartOf: { '@id': SEO_SITE }, about: { '@id': SEO_ORG }
      }];
      const faqs = faqQuestions();
      if (faqs.length) graph.push({ '@type': 'FAQPage', ...page, url, name, mainEntity: faqs });
      return { '@context': 'https://schema.org', '@graph': graph };
    }
    return { '@context': 'https://schema.org', '@graph': [{
      '@type': 'WebPage', ...page, url, name,
      isPartOf: { '@id': SEO_SITE }, publisher: { '@id': SEO_ORG }
    }] };
  }

  function applySEO(route, title, description, appName) {
    document.title = title;
    setMetaMap({
      description,
      'og:title': title,
      'og:description': description,
      'og:url': SEO_BASE + route.nav,
      'twitter:title': title,
      'twitter:description': description
    });
    setCanonical(route.nav);
    let script = document.getElementById('route-ld');
    if (!script) {
      script = document.createElement('script');
      script.id = 'route-ld';
      script.type = 'application/ld+json';
      script.dataset.route = 'true';
      document.head.appendChild(script);
    }
    const json = JSON.stringify(buildJsonLd(route, title, appName));
    if (script.textContent !== json) script.textContent = json;
  }

  function apply(path, push) {
    const norm = normalize(path);
    if (!norm.matched) history.replaceState({}, '', norm.path);
    else if (push) history.pushState({}, '', path);
    const route = ROUTES[norm.path];
    VIEWS.forEach(view => {
      const node = $(`view-${view}`);
      if (node) node.hidden = view !== route.view;
    });
    if (route.view === 'workspace') {
      const icon = $('workspaceIcon');
      if (icon) icon.innerHTML = route.icon;
      const title = $('workspaceTitle');
      if (title) title.textContent = route.heading;
      const subtitle = $('workspaceSubtitle');
      if (subtitle) subtitle.textContent = route.subtitle;
    }
    if (route.view === 'pdf-editor') {
      // The PDF editor (and its libraries) load lazily on first visit so the
      // home page and image tools stay lightweight.
      PDFEditorBoot.route(norm.tool || 'merge');
      const info = norm.tool ? PDFEditorBoot.TOOL_INFO[norm.tool] : null;
      applySEO(route, info ? `${info[0]} — MeroPrayas` : route.title, info ? info[1] : route.description, info ? info[0] : route.heading);
    } else {
      applySEO(route, route.title, route.description, route.heading);
    }
    setActiveNav(route.nav);
    window.scrollTo(0, 0);
    spyActiveSection();
  }

  function navigate(path) {
    apply(path, true);
    const menu = $('toolsMenu');
    if (menu?.open) menu.open = false;
  }

  // Highlight the "On this page" sidebar link for the section currently in
  // view. Runs only on routes that render a .toc, keyed off the last section
  // whose top has crossed just below the sticky header.
  function spyActiveSection() {
    const toc = document.querySelector('.view:not([hidden]) .toc');
    if (!toc) return;
    const links = toc.querySelectorAll('a[href^="#"]');
    if (!links.length) return;
    const line = window.scrollY + 112;
    let activeId = null;
    links.forEach(link => {
      const el = document.getElementById(link.getAttribute('href').slice(1));
      if (el && el.getBoundingClientRect().top + window.scrollY <= line) activeId = link.getAttribute('href').slice(1);
    });
    if (!activeId) activeId = links[0].getAttribute('href').slice(1);
    const old = toc.querySelector('a.active');
    if (old) {
      old.classList.remove('active');
      old.removeAttribute('aria-current');
    }
    const next = toc.querySelector('a[href="#' + activeId + '"]');
    if (next) {
      next.classList.add('active');
      next.setAttribute('aria-current', 'location');
    }
  }

  function init() {
    document.addEventListener('click', event => {
      const menu = $('toolsMenu');
      if (menu?.open && !event.target.closest('.tools-menu')) menu.open = false;
      const link = event.target.closest('a[data-route]');
      if (link) {
        event.preventDefault();
        navigate(link.getAttribute('href'));
        return;
      }
      // In-page anchors (TOC links on the info pages). With <base href="/"> a
      // bare fragment would resolve against the site root and reload the app,
      // so scroll here and record the hash against the current path instead.
      const hashLink = event.target.closest('a[href^="#"]');
      if (hashLink) {
        event.preventDefault();
        const hash = hashLink.getAttribute('href');
        const target = document.getElementById(hash.slice(1));
        if (!target) return;
        history.replaceState(null, '', location.pathname + location.search + hash);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        spyActiveSection();
      }
    });
    window.addEventListener('scroll', () => requestAnimationFrame(spyActiveSection), { passive: true });
    window.addEventListener('popstate', () => apply(location.pathname, false));
    apply(location.pathname, false);
    spyActiveSection();
  }

  return { init, navigate };
})();

// Tiny bootstrapper for the PDF editor. The full editor script and its PDF
// libraries are fetched only when /pdf-editor is opened for the first time,
// keeping the home page and image tools bundle lean.
const PDFEditorBoot = (() => {
  const TOOL_INFO = {
    merge: ['PDF Merge', 'Combine multiple PDFs into one file, in any order.'],
    split: ['PDF Split', 'Split a PDF into page ranges, selected pages, or one file per page.'],
    compress: ['PDF Compress', 'Reduce PDF file size with clear quality trade-offs.'],
    'jpg-to-pdf': ['JPG to PDF', 'Turn JPG, JPEG and PNG images into a PDF document.'],
    'pdf-to-jpg': ['PDF to JPG', 'Convert PDF pages into JPG images at your chosen resolution.']
  };

  let loading = null;

  function route(tool) {
    if (window.PDFEditor) {
      window.PDFEditor.open(tool);
      return;
    }
    if (loading) return;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'js/pdf-editor.js';
      script.onload = () => { window.PDFEditor.open(tool); resolve(); };
      script.onerror = () => reject(new Error('Could not load the PDF editor.'));
      document.head.appendChild(script);
    }).finally(() => { loading = null; });
    loading.catch(err => console.warn('MeroPrayas PDF editor failed to load:', err));
  }

  return { route, TOOL_INFO };
})();
