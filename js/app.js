/* global UI, Router, UnicodeUI */
'use strict';

UI.init();
UnicodeUI.init();
Router.init();

/* ---------- Install / PWA prompt ----------
   Safari never fires `beforeinstallprompt`, and many Android browsers (in-app
   browsers, Firefox) don't either, so the button cannot depend on that event to
   exist. Instead the platform decides whether installing is possible, and the
   event only upgrades the button from "show instructions" to "real native
   prompt" once it arrives. */

const INSTALL_DISPLAY_MODES = [
  '(display-mode: standalone)',
  '(display-mode: minimal-ui)',
  '(display-mode: fullscreen)',
  '(display-mode: window-controls-overlay)',
  '(display-mode: tabbed)'
].join(', ');

const installMedia = window.matchMedia(INSTALL_DISPLAY_MODES);

function isStandalone() {
  return navigator.standalone === true || installMedia.matches;
}

/* iOS and iPadOS, where Add to Home Screen is driven by the share sheet.
   iPadOS 13+ reports a desktop Safari UA, so fall back to the touch-point
   heuristic to tell an iPad apart from a real Mac. */
function isIOS() {
  const ua = navigator.userAgent;
  const iOSPlatform = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOSPlatform;
}

/* Blink-based browsers ship the install prompt. Firefox and Safari do not, so the
   button stays hidden there rather than leading to a dead end.
   Note: no `\b` before `Chrome`, because the headless build reports
   "HeadlessChrome/..." and `\b` does not match mid-word. */
function isChromium() {
  return /Chrom(?:e|ium)\/|\bCriOS\/|\bEdg\/|\bOPR\//.test(navigator.userAgent);
}

let deferredInstallPrompt = null;

function installMode() {
  if (isStandalone()) return 'installed';
  if (isIOS()) return 'ios';
  if (isChromium()) return 'chromium';
  return 'unsupported';
}

UI.configureInstall(installMode());

/* Suppress Chrome's own mini-infobar: the page renders its own button instead,
   otherwise both prompts race each other. */
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  if (isStandalone()) return;
  deferredInstallPrompt = event;
  UI.setInstallHandler(event);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  UI.markInstalled();
});

/* Installed state used to be frozen at parse time, so entering or leaving
   standalone mode mid-session was never noticed. */
function onDisplayModeChange() {
  if (isStandalone()) {
    deferredInstallPrompt = null;
    UI.markInstalled();
  } else {
    UI.configureInstall(installMode());
  }
}

if (typeof installMedia.addEventListener === 'function') {
  installMedia.addEventListener('change', onDisplayModeChange);
} else if (typeof installMedia.addListener === 'function') {
  installMedia.addListener(onDisplayModeChange); // Safari < 14
}

/* A prompt event can arrive before the service worker takes control, which is
   exactly when the app becomes installable. The button is already visible by
   then, so nothing needs to be forced here. */
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
