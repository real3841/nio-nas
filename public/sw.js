/* 离线壳缓存：策略与 src/lib/sw-policy.ts 保持一致（浏览器端无法直接 import TS）。
 * 只在 HTTPS / localhost 下注册；局域网 HTTP 访问时不会生效。 */
const CACHE = "nio-dash-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function strategy(pathname) {
  if (pathname.startsWith("/api/") || pathname.startsWith("/data/")) return "network-only";
  if (pathname.startsWith("/assets/") || pathname.startsWith("/icons/")) return "cache-first";
  return "network-first";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const mode = strategy(url.pathname);
  if (mode === "network-only") return;
  event.respondWith(mode === "cache-first" ? cacheFirst(request) : networkFirst(request));
});
