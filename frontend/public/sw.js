// Minimal service worker: makes the app installable and keeps the UI shell cached.
// It never touches /api or /media — words, pictures and sound always come from the server.
const CACHE = 'greek-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return

  if (req.mode === 'navigate') {
    // Fresh page when online; the cached shell when the network is down.
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy))
          return resp
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    // Vite asset names contain a content hash, so cache-first is safe.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((resp) => {
            const copy = resp.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
            return resp
          }),
      ),
    )
  }
})
