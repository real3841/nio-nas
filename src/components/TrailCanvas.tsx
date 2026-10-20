import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { hexToHsl, hexToRgba, slicePath, type PathPoint, type TrailPath } from "../lib/track-trail";

const STOP_RIPPLE_MS = 2600;
const HOT_METERS = 300; // 热区长度（按米算，不随缩放变化）
const STOP_GAP_SEC = 20 * 60; // 两趟之间超过 20 分钟算一次停留

const SPRITES = new Map<string, HTMLCanvasElement>();

/** 预渲染的柔光贴图：避免每帧/每个停留点新建径向渐变 */
function glowSprite(color: string, size: number): HTMLCanvasElement {
  const key = `${color}:${size}`;
  const cached = SPRITES.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, hexToRgba(color, 1));
    g.addColorStop(0.35, hexToRgba(color, 0.45));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  SPRITES.set(key, canvas);
  return canvas;
}

const stopGlowSprite = (color: string) => glowSprite(color, 64);
const headGlowSprite = (color: string) => glowSprite(color, 96);

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * 回放拖影：整条交给 canvas。
 * - 全程一层「地板」保证可见
 * - 最近 300 米一层热区
 * - 最后 70 屏幕像素做成由粗到细的锥形彗尾（不随缩放变形）
 */
export function TrailCanvas({
  path,
  progress,
  light,
  color,
  follow,
  followZoom,
  playing = false,
}: {
  path: TrailPath;
  progress: number;
  light: boolean;
  color: string;
  follow: boolean;
  followZoom: number;
  playing?: boolean;
}) {
  const map = useMap();
  const progressRef = useRef(progress);
  const lightRef = useRef(light);
  const colorRef = useRef(color);
  const followRef = useRef(follow);
  const followZoomRef = useRef(followZoom);
  const drawRef = useRef<() => void>(() => {});
  /** draw 重入保护：panTo/zoom 同步触发的事件里不再重画 */
  const drawing = useRef(false);

  progressRef.current = progress;
  lightRef.current = light;
  colorRef.current = color;
  followRef.current = follow;
  followZoomRef.current = followZoom;

  const stops = useMemo(() => {
    const out: PathPoint[] = [];
    for (let i = 1; i < path.lines.length; i += 1) {
      const prev = path.lines[i - 1];
      const next = path.lines[i];
      if (next[0].ts - prev[prev.length - 1].ts >= STOP_GAP_SEC) out.push(prev[prev.length - 1]);
    }
    return out;
  }, [path]);

  useEffect(() => {
    const canvas = L.DomUtil.create("canvas", "trail-canvas") as HTMLCanvasElement;
    const pane = map.getPanes().overlayPane;
    pane.appendChild(canvas);
    let width = -1;
    let height = -1;

    const fitCanvas = () => {
      const size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(size.x * dpr);
      const h = Math.round(size.y * dpr);
      if (w !== width || h !== height) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
        width = w;
        height = h;
      }
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      canvas.style.transform = `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`;
      return dpr;
    };

    const draw = () => {
      if (drawing.current) return;
      drawing.current = true;
      try {
      const dpr = fitCanvas();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const size = map.getSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);

      const played = slicePath(path, progressRef.current);
      if (!played.length) return;

      const { h, s } = hexToHsl(colorRef.current);
      const isLight = lightRef.current;
      const base = isLight ? `hsl(${h}, ${s}%, 58%)` : `hsl(${h}, ${s}%, 40%)`;
      const hot = isLight ? `hsl(${h}, ${Math.min(100, s + 10)}%, 46%)` : `hsl(${h}, ${Math.min(100, s + 10)}%, 58%)`;
      const headColor = isLight ? `hsl(${h}, ${Math.min(100, s + 15)}%, 38%)` : `hsl(${h}, ${Math.min(100, s + 15)}%, 74%)`;

      const toXY = (p: { lat: number; lng: number }): L.Point => map.latLngToContainerPoint([p.lat, p.lng]);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // 1) 地板：整条走过的路，始终可见
      const basePath = new Path2D();
      for (const line of played) {
        line.forEach((p, i) => {
          const pt = toXY(p);
          if (i === 0) basePath.moveTo(pt.x, pt.y);
          else basePath.lineTo(pt.x, pt.y);
        });
      }
      ctx.globalAlpha = isLight ? 0.35 : 0.22;
      ctx.strokeStyle = base;
      ctx.lineWidth = 1.6;
      ctx.stroke(basePath);

      // 2) 热区：最近 300 米
      const lastLine = played[played.length - 1];
      const targetCum = lastLine[lastLine.length - 1].cum;
      const hotPath = new Path2D();
      let hotCount = 0;
      for (const line of played) {
        for (let i = 1; i < line.length; i += 1) {
          if (line[i].cum < targetCum - HOT_METERS) continue;
          const a = toXY(line[i - 1]);
          const b = toXY(line[i]);
          hotPath.moveTo(a.x, a.y);
          hotPath.lineTo(b.x, b.y);
          hotCount += 1;
        }
      }
      if (hotCount > 0) {
        ctx.strokeStyle = hot;
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = 10;
        ctx.stroke(hotPath);
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 6;
        ctx.stroke(hotPath);
      }

      // 3) 彗尾：按屏幕弧长跨趟回溯，一次成型的双带填充（不再是逐段描边）
      const tailPx = isLight ? 104 : 112;
      const pts: { x: number; y: number; d: number }[] = [];
      {
        let acc = 0;
        let prev: L.Point | null = null;
        let done = false;
        for (let li = played.length - 1; li >= 0 && !done; li -= 1) {
          const line = played[li];
          for (let i = line.length - 1; i >= 0; i -= 1) {
            const pt = toXY(line[i]);
            if (!prev) {
              prev = pt;
              pts.push({ x: pt.x, y: pt.y, d: 0 });
              continue;
            }
            acc += dist(prev.x, prev.y, pt.x, pt.y);
            if (acc > tailPx) {
              done = true;
              break;
            }
            pts.push({ x: pt.x, y: pt.y, d: acc });
            prev = pt;
          }
        }
      }

      const widthAt = (u: number) => (isLight ? 5.6 : 6.4) * Math.pow(1 - u, 1.25) + 0.35;
      const ribbon = (scale: number): Path2D => {
        const out = new Path2D();
        const left: { x: number; y: number }[] = [];
        const right: { x: number; y: number }[] = [];
        for (let i = 0; i < pts.length; i += 1) {
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          const tx = b.x - a.x;
          const ty = b.y - a.y;
          const len = Math.hypot(tx, ty) || 1;
          const nx = -ty / len;
          const ny = tx / len;
          const hw = (widthAt(Math.min(1, pts[i].d / tailPx)) * scale) / 2;
          left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
          right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
        }
        out.moveTo(left[0].x, left[0].y);
        for (let i = 1; i < left.length; i += 1) out.lineTo(left[i].x, left[i].y);
        for (let i = right.length - 1; i >= 0; i -= 1) out.lineTo(right[i].x, right[i].y);
        out.closePath();
        return out;
      };

      if (pts.length > 1) {
        const tailEnd = pts[pts.length - 1];
        const headPt = pts[0];
        const grad = ctx.createLinearGradient(tailEnd.x, tailEnd.y, headPt.x, headPt.y);
        const mul = isLight ? 0.85 : 1;
        grad.addColorStop(0, `hsla(${h}, ${s}%, 66%, 0)`);
        grad.addColorStop(0.35, `hsla(${h}, ${s}%, 66%, ${0.1 * mul})`);
        grad.addColorStop(0.72, `hsla(${Math.min(360, h + 5)}, ${Math.min(100, s + 5)}%, 74%, ${0.42 * mul})`);
        grad.addColorStop(1, `hsla(${Math.max(0, h - 8)}, ${s}%, ${isLight ? 62 : 92}%, ${isLight ? 0.8 : 0.95})`);

        if (!isLight) {
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = grad;
          ctx.fill(ribbon(2.4));
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = grad;
        ctx.fill(ribbon(1));

        // 细芯：贴着中心线的一根亮线，给出速度感
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = headColor;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 4) 停留点：常驻光晕 + 亮点 + 双环扩散（画在播放头之前，别盖住头部）
      const headPt = pts.length ? pts[0] : toXY(lastLine[lastLine.length - 1]);
      const now = performance.now();
      const stopPhase = (now % STOP_RIPPLE_MS) / STOP_RIPPLE_MS;
      const viewW = size.x + 64;
      const viewH = size.y + 64;
      let drawnStops = 0;
      for (let index = 0; index < stops.length && drawnStops < 40; index += 1) {
        const stop = stops[index];
        if (stop.cum > targetCum) break;
        const pt = toXY(stop);
        if (pt.x < -64 || pt.y < -64 || pt.x > viewW || pt.y > viewH) continue;
        drawnStops += 1;
        const headDist = dist(pt.x, pt.y, headPt.x, headPt.y);
        const nearHead = Math.min(1, Math.max(0, (headDist - 12) / 24));

        // 常驻光晕：用缓存 sprite，避免每点每帧新建渐变
        ctx.globalAlpha = (isLight ? 0.16 : 0.22) * nearHead;
        ctx.drawImage(stopGlowSprite(colorRef.current), pt.x - 13, pt.y - 13, 26, 26);

        // 中心亮点
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = isLight ? `hsl(${h}, ${s}%, 34%)` : "#ffffff";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.4, 0, Math.PI * 2);
        ctx.fill();

        // 双环错相，ease-out
        for (let ring = 0; ring < 2; ring += 1) {
          const t = (stopPhase + index * 0.37 + ring * 0.5) % 1;
          const radius = 3.5 + 13.5 * (1 - (1 - t) * (1 - t));
          ctx.globalAlpha = (isLight ? 0.42 : 0.5) * Math.pow(1 - t, 1.8) * (ring ? 0.45 : 1) * nearHead;
          ctx.strokeStyle = base;
          ctx.lineWidth = 1.6 * Math.pow(1 - t, 0.8) + 0.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // 5) 播放头：三层 bloom + 白核 + 扩散冲击波
      const head = headPt;
      const glow = headGlowSprite(colorRef.current);
      ctx.globalCompositeOperation = isLight ? "source-over" : "lighter";
      ctx.globalAlpha = isLight ? 0.18 : 0.3;
      ctx.drawImage(glow, head.x - 26, head.y - 26, 52, 52);
      ctx.globalAlpha = isLight ? 0.32 : 0.55;
      ctx.drawImage(glow, head.x - 12, head.y - 12, 24, 24);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(head.x, head.y, 3, 0, Math.PI * 2);
      ctx.fill();

      // 6) 跟随：锁定视距（可选）+ 播放头往画面中心拉
      // 注意：panTo / setZoom 会同步触发 move → draw，若不加节流会递归到爆栈
      if (followRef.current) {
        const zoom = followZoomRef.current;
        const animating = Boolean((map as unknown as { _animatingZoom?: boolean })._animatingZoom);
        if (zoom > 0 && !animating && Math.abs(map.getZoom() - zoom) > 0.01) {
          map.setZoom(zoom, { animate: false });
        }
        // 播放头偏离中心超过 18px 就瞬时回中：每帧挪一点，比动画 panTo 平滑
        const dx = head.x - size.x / 2;
        const dy = head.y - size.y / 2;
        if (Math.hypot(dx, dy) > 18) {
          map.setView(map.containerPointToLatLng([head.x, head.y]), map.getZoom(), { animate: false });
        }
      }
      ctx.globalAlpha = 1;
      } finally {
        drawing.current = false;
      }
    };

    drawRef.current = draw;
    const onMove = () => draw();
    const onZoomStart = () => {
      canvas.style.opacity = "0";
    };
    const onZoomEnd = () => {
      canvas.style.opacity = "1";
      draw();
    };
    map.on("move viewreset resize", onMove);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    draw();
    return () => {
      map.off("move viewreset resize", onMove);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      canvas.remove();
      drawRef.current = () => {};
    };
  }, [map, path, stops]);

  useEffect(() => {
    drawRef.current();
  }, [progress, light, color, follow, followZoom]);

  // 播放时按 ~30fps 重画，让冲击波持续扩散（暂停就停在当前帧）
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= 33) {
        last = now;
        drawRef.current();
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [playing]);

  return null;
}

export default TrailCanvas;
