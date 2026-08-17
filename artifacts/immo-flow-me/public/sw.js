const CACHE_VERSION = 'immoflow-v9';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/favicon.png',
  '/manifest.json',
  '/icons/icon-192.png'
];

const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ImmoFlowMe - Offline</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #1a1a2e; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
    .container { text-align: center; max-width: 400px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.6; }
    h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }
    p { color: #6b7280; line-height: 1.6; margin-bottom: 1.5rem; }
    button { background: #1a1a2e; color: white; border: none; padding: 0.75rem 2rem; border-radius: 0.375rem; font-size: 1rem; cursor: pointer; }
    button:active { opacity: 0.8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#x1F4F6;</div>
    <h1>Keine Verbindung</h1>
    <p>ImmoFlowMe ist derzeit nicht erreichbar. Bitte pr&uuml;fen Sie Ihre Internetverbindung und versuchen Sie es erneut.</p>
    <button onclick="location.reload()">Erneut versuchen</button>
  </div>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          })
        )
    );
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.mjs')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && url.pathname.match(/\.(js|css|mjs)$/)) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match(event.request).then((cached) => {
              if (cached) return cached;
              return new Response(OFFLINE_PAGE, {
                status: 503,
                headers: { 'Content-Type': 'text/html' }
              });
            });
          }
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503 }));
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'ImmoFlowMe', body: 'Neue Benachrichtigung', icon: '/icons/icon-192.png' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192.png',
    badge: '/favicon.png',
    tag: data.tag || 'immoflow-notification',
    data: data.url ? { url: data.url } : {},
    actions: data.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: data.urgent || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearApiCache') {
    caches.delete(API_CACHE);
  }
  if (event.data === 'clearAllCaches') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
  if (event.data === 'getVersion') {
    event.source.postMessage({ type: 'version', version: CACHE_VERSION });
  }
});
