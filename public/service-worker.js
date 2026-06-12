// PLUSONE Service Worker — placeholder voor PWA-functionaliteit
// next-pwa genereert en beheert de actieve SW; dit is een fallback

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Default: network-first
  event.respondWith(
    fetch(event.request).catch(() => {
      // Offline fallback — wordt later uitgebreid met IndexedDB cache
      return new Response('Offline', { status: 503 });
    })
  );
});
