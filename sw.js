// Significant Reads Doc Converter - service worker
// Bump CACHE_VERSION whenever you add or rename files in PRECACHE.
const CACHE_VERSION = "v1";
const CACHE_NAME = "sr-doc-converter-" + CACHE_VERSION;

const PRECACHE = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "manifest.webmanifest",
  "terms.html",
  "privacy.html",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("sr-doc-converter-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests for files on this site.
  // The conversion API, Google Analytics, fonts and the JSZip CDN are on other
  // domains, so they pass straight through and are never cached.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network first (so updates show up right away), cached copy when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("index.html");
          return Response.error();
        })
      )
  );
});
