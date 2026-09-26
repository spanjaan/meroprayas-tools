/* global UI, Router, UnicodeUI */
'use strict';

UI.init();
UnicodeUI.init();
Router.init();

let deferredInstallPrompt = null;
const isInstalled =
  navigator.standalone ||
  window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen), (display-mode: window-controls-overlay), (display-mode: tabbed)').matches;

if (isInstalled) UI.markInstalled();

window.addEventListener('beforeinstallprompt', event => {
  if (isInstalled) return;
  deferredInstallPrompt = event;
  UI.setInstallHandler(deferredInstallPrompt);
});
window.addEventListener('appinstalled', () => {
  UI.markInstalled();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.warn('Service worker registration failed:', err)
    );
  });
}

(function () {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;

  function update() {
    if (navigator.onLine) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
    }
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}());
