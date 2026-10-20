import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheStrategy, canRegisterServiceWorker, CACHE_VERSION } from "./sw-policy";

test("Service Worker 只在 HTTPS 或本机注册", () => {
  assert.equal(canRegisterServiceWorker("https:", "<NAS-IP>"), true);
  assert.equal(canRegisterServiceWorker("http:", "localhost"), true);
  assert.equal(canRegisterServiceWorker("http:", "127.0.0.1"), true);
  assert.equal(canRegisterServiceWorker("http:", "<NAS-IP>"), false);
});

test("静态资源走缓存优先，页面网络优先，接口与数据不缓存", () => {
  assert.equal(cacheStrategy("/assets/dashboard-abc.js"), "cache-first");
  assert.equal(cacheStrategy("/icons/icon-192.png"), "cache-first");
  assert.equal(cacheStrategy("/"), "network-first");
  assert.equal(cacheStrategy("/index.html"), "network-first");
  assert.equal(cacheStrategy("/api/sync-health"), "network-only");
  assert.equal(cacheStrategy("/data/vehicle.json"), "network-only");
});

test("缓存名带版本，避免旧资源被复用", () => {
  assert.match(CACHE_VERSION, /^nio-dash-v\d+$/);
});
