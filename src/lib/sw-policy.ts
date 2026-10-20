/** Service Worker 的注册条件与缓存策略；public/sw.js 里有同一份判断（浏览器端无法 import TS）。 */
export const CACHE_VERSION = "nio-dash-v1";

export function canRegisterServiceWorker(protocol: string, hostname: string): boolean {
  if (protocol === "https:") return true;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export type CacheStrategy = "cache-first" | "network-first" | "network-only";

export function cacheStrategy(pathname: string): CacheStrategy {
  if (pathname.startsWith("/api/") || pathname.startsWith("/data/")) return "network-only";
  if (pathname.startsWith("/assets/") || pathname.startsWith("/icons/")) return "cache-first";
  return "network-first";
}
