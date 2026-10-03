const CACHE = 'jr-platform-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/logo-jr.jpg'];
const isPublicShell = (request) => {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin &&
    !url.search && (SHELL.includes(url.pathname) || /^\/assets\/[\w.-]+\.(js|css|woff2)$/.test(url.pathname));
};
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('jr-platform-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', (event) => {
  // No interception or offline fallback for private data or signed URLs.
  if (!isPublicShell(event.request)) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});
