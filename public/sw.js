const CACHE = "better-steam-v3";
const SHELL = [
  "/", "/styles.css", "/app.js", "/manifest.webmanifest", "/icon.svg",
  "/fonts/chakra-petch-400.woff2", "/fonts/chakra-petch-500.woff2", "/fonts/chakra-petch-600.woff2",
  "/fonts/chakra-petch-700.woff2", "/fonts/russo-one-400.woff2",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Network first so new deploys and prices show straight away; the cache is only an offline fallback.
// Only the page, its files and the game list are kept, so the cache stays small.
const OFFLINE_API = /^\/api\/(meta|games)$/;

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  const navigation = event.request.mode === "navigate";
  if (!navigation && !SHELL.includes(url.pathname) && !OFFLINE_API.test(url.pathname)) return;
  const key = navigation ? "/" : event.request;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(key, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(key)) ?? Response.error()),
  );
});
