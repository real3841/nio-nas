import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { mapCoordsForProvider } from "../lib/gcj02";
import type { MapTileConfig } from "../lib/map-tiles";

/** 轨迹点：[经度, 纬度, 时间戳]，原始值为 GCJ-02 */
type Pt = [number, number, number];

interface TrackTrip {
  p: Pt[];
}

const MAX_DOTS = 2400;
const RING_MS = 2400;
/** 每批一起扩散的点数：按生成顺序分批，形成 a→b→c 的波 */
const RING_BATCH = 14;
const RING_STEP = 0.16;

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 点：白色亮核 + 彩色光晕，预渲染一次 */
function dotSprite(color: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.22, hexToRgba(color, 0.95));
    g.addColorStop(0.55, hexToRgba(color, 0.35));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

/**
 * 点云视图：发光点 + 按生成顺序分批扩散的环。
 * 静态点云一张 canvas，环单独一张，只有环每帧重画。
 */
export function DotCloud({
  trips,
  tileConfig,
  light,
  color,
  boundsKey,
}: {
  trips: TrackTrip[];
  tileConfig: MapTileConfig;
  light: boolean;
  color: string;
  boundsKey: string;
}) {
  const map = useMap();
  const fitted = useRef("");

  useEffect(() => {
    const pane = map.getPanes().overlayPane;
    const dotCanvas = L.DomUtil.create("canvas", "dot-cloud") as HTMLCanvasElement;
    const ringCanvas = L.DomUtil.create("canvas", "dot-cloud-rings") as HTMLCanvasElement;
    for (const canvas of [dotCanvas, ringCanvas]) {
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";
      pane.appendChild(canvas);
    }

    const sprite = dotSprite(color, 48);
    let cssWidth = -1;
    let cssHeight = -1;
    let zooming = false;

    const fitCanvas = () => {
      const size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (size.x !== cssWidth || size.y !== cssHeight) {
        cssWidth = size.x;
        cssHeight = size.y;
        for (const canvas of [dotCanvas, ringCanvas]) {
          canvas.width = Math.round(size.x * dpr);
          canvas.height = Math.round(size.y * dpr);
          canvas.style.width = `${size.x}px`;
          canvas.style.height = `${size.y}px`;
        }
      }
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      const transform = `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`;
      dotCanvas.style.transform = transform;
      ringCanvas.style.transform = transform;
      return { dpr, size };
    };

    // 采样点：按趟顺序收集，总量封顶；同一小格（约 7 米）合并成一个点，
    // 否则每天停在家里的坐标会叠成一坨死红饼，环也被自己盖住。
    const perTrip = Math.max(1, Math.floor(MAX_DOTS / Math.max(1, trips.length)));
    const cells = new Map<string, { lat: number; lng: number; count: number }>();
    const CELL = 0.00006;
    for (const trip of trips) {
      if (trip.p.length < 2) continue;
      const step = Math.max(1, Math.ceil(trip.p.length / perTrip));
      for (let i = 0; i < trip.p.length; i += step) {
        const mapped = mapCoordsForProvider(trip.p[i][1], trip.p[i][0], tileConfig.provider);
        const key = `${Math.round(mapped.lat / CELL)}:${Math.round(mapped.lng / CELL)}`;
        const cell = cells.get(key);
        if (cell) cell.count += 1;
        else cells.set(key, { lat: mapped.lat, lng: mapped.lng, count: 1 });
      }
    }
    const latlngs = [...cells.values()];

    let points: L.Point[] = [];
    let counts: number[] = [];

    /** 到访次数越多，点越大越亮（家/公司这种热点自然显出来）；
     *  放大时必须跟着放大，否则低倍下点在视觉上叠成带、高倍下散成稀点，会觉得「越放大越淡」。 */
    const zoomScale = () => {
      const z = map.getZoom();
      return Math.min(2.1, Math.max(1, 1 + (z - 11) * 0.14));
    };
    const dotSize = (count: number, scale: number) => (8 + Math.min(8, Math.log2(count + 1) * 2.2)) * scale;
    const dotAlpha = (count: number) => Math.min(0.95, 0.6 + Math.log2(count + 1) * 0.1);

    const drawCloud = () => {
      const { dpr, size } = fitCanvas();
      const ctx = dotCanvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      const base = light ? 0.78 : 0.6;
      const scale = zoomScale();
      for (const cell of latlngs) {
        const pt = map.latLngToContainerPoint([cell.lat, cell.lng]);
        const d = dotSize(cell.count, scale);
        ctx.globalAlpha = base * dotAlpha(cell.count);
        ctx.drawImage(sprite, pt.x - d / 2, pt.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
      points = latlngs.map((cell) => map.latLngToContainerPoint([cell.lat, cell.lng]));
      counts = latlngs.map((cell) => cell.count);
      ctx.globalAlpha = 1;
    };

    const drawRings = () => {
      const { dpr, size } = fitCanvas();
      const ctx = ringCanvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      if (points.length === 0) return;

      // 视口外的点不画环；太密时按步长抽稀
      const margin = 24;
      const visible: { x: number; y: number; index: number }[] = [];
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        if (p.x < -margin || p.y < -margin || p.x > size.x + margin || p.y > size.y + margin) continue;
        visible.push({ x: p.x, y: p.y, index: i });
      }
      const stride = Math.max(1, Math.ceil(visible.length / 900));

      const now = performance.now();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = hexToRgba(color, light ? 0.55 : 0.65);
      for (let k = 0; k < visible.length; k += stride) {
        const { x, y, index } = visible[k];
        const hot = counts[index] ?? 1;
        // 热点呼吸更慢（周期 2.4s → 3.8s），冷点快一点
        const period = RING_MS + Math.min(1400, Math.log2(hot + 1) * 320);
        // 按生成顺序分批，形成 a→b→c 依次扩散
        const batch = Math.floor(index / RING_BATCH);
        const phase = ((now + batch * RING_STEP * period + index * 97) % period) / period;
        const rings = hot >= 80 ? 3 : hot >= 30 ? 2 : 1;
        const boost = Math.min(5, Math.log2(hot + 1) * 1.2);
        const alphaBase = Math.min(0.9, (light ? 0.5 : 0.6) * (1 + Math.log2(hot + 1) * 0.25));
        for (let r = 0; r < rings; r += 1) {
          let t = (phase + r * 0.24) % 1;
          if (t > 0.72) continue;
          t /= 0.72;
          const radius = 2.5 + boost + (9.5 + boost) * (1 - (1 - t) * (1 - t));
          ctx.globalAlpha = alphaBase * Math.pow(1 - t, 1.7) * (r === 0 ? 1 : 0.65);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const redraw = () => {
      if (zooming) return;
      drawCloud();
      drawRings();
    };

    let raf = 0;
    let lastRing = 0;
    const loop = (now: number) => {
      if (!zooming && points.length && now - lastRing >= 66) {
        lastRing = now;
        drawRings();
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    const onMove = () => redraw();
    const onZoomStart = () => {
      zooming = true;
      dotCanvas.style.opacity = "0";
      ringCanvas.style.opacity = "0";
    };
    const onZoomEnd = () => {
      zooming = false;
      dotCanvas.style.opacity = "";
      ringCanvas.style.opacity = "";
      redraw();
    };
    map.on("move viewreset resize", onMove);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);

    // 只 fitBounds 一次（切月份会换 boundsKey）
    if (latlngs.length && fitted.current !== boundsKey) {
      fitted.current = boundsKey;
      drawCloud();
      map.fitBounds(L.latLngBounds(latlngs.map((cell) => L.latLng(cell.lat, cell.lng))), { padding: [24, 24] });
    } else {
      redraw();
    }

    return () => {
      window.cancelAnimationFrame(raf);
      map.off("move viewreset resize", onMove);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      dotCanvas.remove();
      ringCanvas.remove();
    };
  }, [map, trips, tileConfig.provider, light, color, boundsKey]);

  return null;
}

export default DotCloud;
