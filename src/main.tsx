import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installNativeFetchBridge } from "./platform/transport";
import { canRegisterServiceWorker } from "./lib/sw-policy";
import "./styles.css";

installNativeFetchBridge();

// 局域网 HTTP 是「非安全上下文」，浏览器不允许注册 Service Worker；HTTPS 或本机才注册。
if ("serviceWorker" in navigator && canRegisterServiceWorker(location.protocol, location.hostname)) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[pwa] Service Worker 注册失败（离线缓存不可用）", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
