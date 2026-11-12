// Registers the offline/home-screen service worker. Skipped on localhost so it
// never gets in the way of local development (`npm run dev`).
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost') return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
