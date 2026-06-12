// Service worker for PLUSONE PWA
// Register in layout with:
// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('/service-worker.js');
// }

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

// Placeholder: implement caching and offline strategies
