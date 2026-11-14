// Offline support for SeaTools.
// Strategy: try the network first (so updates show up straight away),
// fall back to the saved copy when there is no connection.
// When you add a new app, add its files to PRECACHE and bump VERSION.
const VERSION = "v7";
const CACHE = "marine-apps-" + VERSION;
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/favicon.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png",
  "assets/stats.js",
  "about/",
  "dp-footprint/",
  "dp-footprint/icon.png",
  "dp-footprint/manifest.webmanifest",
  "azimuth/",
  "azimuth/icon.png",
  "azimuth/manifest.webmanifest",
  "port-clearance/",
  "port-clearance/icon.png",
  "port-clearance/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("marine-apps-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match(new URL("index.html", self.registration.scope).href))
      )
  );
});
