const cacheName = 'inventory-shell-v8';
const shell = ['./','./index.html','./css/app.css','./manifest.webmanifest','./js/core.js',
  './js/storage.js','./js/api.js','./js/scanner.js','./js/config.js','./js/app.js',
  './vendor/zxing-library.min.js','./vendor/xlsx.full.min.js'];
const paths = new Set(shell.map(path => new URL(path,self.registration.scope).pathname));
self.addEventListener('install',event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});
self.addEventListener('activate',event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    key.startsWith('inventory-shell-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch',event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || !paths.has(url.pathname)) return;
  async function respond() {
    const cache = await caches.open(cacheName);
    const cached = () => cache.match(request,{ignoreSearch:true});
    const network = async () => {
      const response = await fetch(request);
      if (!response.ok) return (await cached()) || response;
      try { await cache.put(url.origin+url.pathname,response.clone()); } catch (_) { /* 保留網路回應 */ }
      return response;
    };
    if (url.pathname.includes('/vendor/')) return (await cached()) || network();
    try { return await network(); } catch (error) {
      const fallback = await cached();
      if (fallback) return fallback;
      throw error;
    }
  }
  event.respondWith(respond());
});
