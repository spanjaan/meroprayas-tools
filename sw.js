'use strict';

const CACHE = 'pixelpress-v40';
const MAX_RUNTIME_ENTRIES = 120;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './robots.txt',
  './sitemap.xml',
  './css/style.css',
  './css/pdf-editor.css',
  './assets/fonts/poppins.css',
  './assets/fonts/poppins-1.woff2',
  './assets/fonts/poppins-2.woff2',
  './assets/fonts/poppins-3.woff2',
  './assets/fonts/poppins-4.woff2',
  './assets/fonts/poppins-5.woff2',
  './assets/fonts/poppins-6.woff2',
  './assets/fonts/poppins-7.woff2',
  './assets/fonts/poppins-8.woff2',
  './assets/fonts/poppins-9.woff2',
  './assets/fonts/poppins-10.woff2',
  './assets/fonts/poppins-11.woff2',
  './assets/fonts/poppins-12.woff2',
  './assets/fonts/poppins-13.woff2',
  './assets/fonts/poppins-14.woff2',
  './assets/fonts/poppins-15.woff2',
  './assets/fonts/Preeti.woff2',
  './assets/fonts/Preeti.ttf',
  './assets/fonts/Hisab.woff2',
  './assets/fonts/Hisab.ttf',
  './js/util.js',
  './js/compressor.js',
  './js/ui.js',
  './js/preeti-map.js',
  './js/hisab-map.js',
  './js/unicode-converter.js',
  './js/unicode-ui.js',
  './js/router.js',
  './js/app.js',
  './js/pdf-editor.js',
  './vendor/pdf-lib.min.js',
  './vendor/jszip.min.js',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
  './assets/developer-avatar.svg',
  './assets/og-card.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ASSETS.map(asset => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_ENTRIES) return;
  const toDelete = keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES);
  await Promise.all(toDelete.map(req => cache.delete(req)));
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  let url;
  try { url = new URL(event.request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => { });
          return response;
        }
        return caches.match('./index.html');
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(async cache => {
          await cache.put(event.request, copy);
          await trimRuntimeCache(cache);
        }).catch(() => { });
      }
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
