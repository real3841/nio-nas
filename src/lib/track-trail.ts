import { mapCoordsForProvider } from "./gcj02";
import type { MapTileConfig } from "./map-tiles";

type Pt = [number, number, number];

export interface TrailTrip {
  s: number;
  e: number;
  p: Pt[];
}

export interface TrailPoint {
  lat: number;
  lng: number;
  age: number;
}

export const BUCKETS = 40;
export const MAX_POINTS = 2600;
export const DENSE_TAIL = 300;
/** 同一位置阈值：位移小于它的采样点视为原地停留 */
export const MIN_METERS = 10;

/** 相邻两点间的大圆距离（米），轨迹去重/等距采样用 */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TrailSample {
  lat: number;
  lng: number;
  ts: number;
}

/** 每个行程按距离去重：原地不动（相邻点位移 < minMeters）的采样直接丢掉 */
export function trailSamples(trips: TrailTrip[], provider: MapTileConfig["provider"], minMeters = MIN_METERS): TrailSample[][] {
  const sorted = [...trips].sort((a, b) => a.s - b.s);
  const out: TrailSample[][] = [];
  for (const trip of sorted) {
    if (trip.p.length < 2) continue;
    const line: TrailSample[] = [];
    for (const [lng, lat, ts] of trip.p) {
      const mapped = mapCoordsForProvider(lat, lng, provider);
      if (!Number.isFinite(mapped.lat) || !Number.isFinite(mapped.lng)) continue;
      const prev = line[line.length - 1];
      if (prev && haversineMeters(prev, mapped) < minMeters) continue;
      line.push({ lat: mapped.lat, lng: mapped.lng, ts });
    }
    if (line.length >= 2) out.push(line);
  }
  return out;
}

/** 全部行程的总路程（米），用于按距离推进回放 */
export function trailLength(lines: TrailSample[][]): number {
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) total += haversineMeters(line[i - 1], line[i]);
  }
  return total;
}

/**
 * 按「走了多少路」而不是「过了多少时间」切片。
 * 停车、等充电这些原地不动的时段被去重掉，回放不会卡在原地。
 */
export function buildTrail(
  trips: TrailTrip[],
  progress: number,
  provider: MapTileConfig["provider"],
  max = MAX_POINTS,
  minMeters = MIN_METERS,
): TrailPoint[][] {
  const lines = trailSamples(trips, provider, minMeters);
  const total = trailLength(lines);
  if (!total) return [];
  const target = Math.min(1, Math.max(0, progress)) * total;
  if (target <= 0) return [];
  const kept: TrailPoint[][] = [];
  let walked = 0;
  for (const line of lines) {
    if (walked >= target - 1e-6) break;
    const points: TrailPoint[] = [];
    let reached = false;
    for (let i = 0; i < line.length; i += 1) {
      if (i > 0) {
        const step = haversineMeters(line[i - 1], line[i]);
        if (walked + step > target + 1e-6) {
          const ratio = step > 0 ? (target - walked) / step : 0;
          points.push({
            lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * ratio,
            lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * ratio,
            age: target / total,
          });
          walked = target;
          reached = true;
          break;
        }
        walked += step;
      }
      points.push({ lat: line[i].lat, lng: line[i].lng, age: walked / total });
    }
    if (points.length >= 2) kept.push(points);
    if (reached) break;
  }
  // 抽稀：总点数超上限时稀疏旧点，末尾 DENSE_TAIL 点保持原密度
  const count = kept.reduce((n, line) => n + line.length, 0);
  if (count <= max) return kept;
  const stride = Math.max(1, Math.ceil((count - DENSE_TAIL) / Math.max(1, max - DENSE_TAIL)));
  const out: TrailPoint[][] = [];
  for (const line of kept) {
    const denseFrom = Math.max(0, line.length - DENSE_TAIL);
    const sampled = line.filter((_, i) => i >= denseFrom || i % stride === 0);
    if (sampled.length >= 2) {
      if (sampled[sampled.length - 1] !== line[line.length - 1]) sampled.push(line[line.length - 1]);
      out.push(sampled);
    }
  }
  return out;
}

/** 播放头当前位置和时间戳（给时间标签用） */
export function trailHead(trips: TrailTrip[], progress: number, provider: MapTileConfig["provider"], minMeters = MIN_METERS): TrailSample | null {
  const lines = trailSamples(trips, provider, minMeters);
  const total = trailLength(lines);
  if (!total) return null;
  const target = Math.min(1, Math.max(0, progress)) * total;
  let walked = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 1) {
      if (i > 0) {
        const step = haversineMeters(line[i - 1], line[i]);
        if (walked + step >= target) {
          const ratio = step > 0 ? (target - walked) / step : 0;
          return {
            lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * ratio,
            lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * ratio,
            ts: line[i - 1].ts + (line[i].ts - line[i - 1].ts) * ratio,
          };
        }
        walked += step;
      }
    }
  }
  const last = lines[lines.length - 1];
  const tail = last[last.length - 1];
  return { lat: tail.lat, lng: tail.lng, ts: tail.ts };
}

/** #rrggbb → {h,s,l}，用于把调色板的线色套到拖影上 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x22d3ee;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

/**
 * 颜色/粗细：以播放头为中心往前衰减，但有一条可见的「地板」，
 * 老轨迹不会消失；播放结束（progress→1）时整体回落到地板。
 * hex 是当前线色，拖影整条跟着它走。
 */
export function shade(age: number, head: number, light: boolean, hex = "#22d3ee"): { color: string; width: number; alpha: number } {
  const behind = Math.max(0, head - age);
  const glow = Math.exp(-behind / 0.16);
  const endFade = head <= 0.9 ? 1 : Math.max(0, 1 - (head - 0.9) / 0.1);
  const floor = light ? 0.3 : 0.34;
  const alpha = floor + (0.99 - floor) * glow * endFade;
  const { h, s } = hexToHsl(hex);
  const sat = Math.min(100, Math.max(s * 0.8, 45) + 20 * glow);
  const lum = (light ? 50 : 36) + 26 * glow;
  return {
    color: `hsl(${h.toFixed(1)}, ${sat.toFixed(1)}%, ${lum.toFixed(1)}%)`,
    width: 1.5 + 3.2 * glow,
    alpha,
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x22d3ee;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface PathPoint {
  lat: number;
  lng: number;
  ts: number;
  /** 从第一趟出发算起的累计里程（米），趟与趟之间的空档不计 */
  cum: number;
}

export interface TrailPath {
  /** 全量点（算播放头用，二分够快） */
  lines: PathPoint[][];
  /** 抽稀后的绘制用点（每帧只切这一份） */
  render: PathPoint[][];
  total: number;
}

/**
 * 一次性预处理：去重、投影、累计里程。
 * 回放时只在这份数据上做二分和切片，不再每帧重算。
 */
export function buildPath(trips: TrailTrip[], provider: MapTileConfig["provider"], minMeters = MIN_METERS): TrailPath {
  const samples = trailSamples(trips, provider, minMeters);
  const lines: PathPoint[][] = [];
  let cum = 0;
  for (const line of samples) {
    const out: PathPoint[] = [];
    for (let i = 0; i < line.length; i += 1) {
      if (i > 0) cum += haversineMeters(line[i - 1], line[i]);
      out.push({ lat: line[i].lat, lng: line[i].lng, ts: line[i].ts, cum });
    }
    if (out.length >= 2) lines.push(out);
  }
  return { lines, render: downsample(lines, MAX_POINTS), total: cum };
}

function lowerBound(line: PathPoint[], target: number): number {
  let lo = 0;
  let hi = line.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line[mid].cum <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 按累计里程切出「已经走过的部分」，二分定位；只切抽稀后的绘制点 */
export function slicePath(path: TrailPath, progress: number, max = MAX_POINTS): PathPoint[][] {
  const target = Math.min(1, Math.max(0, progress)) * path.total;
  if (target <= 0) return [];
  const out: PathPoint[][] = [];
  for (const line of path.render) {
    if (line[0].cum >= target) break;
    const i = lowerBound(line, target);
    const points = line.slice(0, i + 1);
    const next = line[i + 1];
    if (next && line[i].cum < target) {
      const span = next.cum - line[i].cum;
      const ratio = span > 0 ? (target - line[i].cum) / span : 0;
      points.push({
        lat: line[i].lat + (next.lat - line[i].lat) * ratio,
        lng: line[i].lng + (next.lng - line[i].lng) * ratio,
        ts: line[i].ts + (next.ts - line[i].ts) * ratio,
        cum: target,
      });
    }
    if (points.length >= 2) out.push(points);
  }
  if (out.length === 0 && path.render.length) {
    // 进度刚起步时也先画出第一段的首点，避免闪空
    const first = path.render[0];
    if (first.length >= 2) out.push(first.slice(0, 2));
  }
  return out.length > max ? downsample(out, max) : out;
}

function downsample(lines: PathPoint[][], max: number): PathPoint[][] {
  const total = lines.reduce((n, line) => n + line.length, 0);
  if (total <= max) return lines;
  const stride = Math.max(1, Math.ceil((total - DENSE_TAIL) / Math.max(1, max - DENSE_TAIL)));
  const cut = total - DENSE_TAIL;
  const out: PathPoint[][] = [];
  let idx = 0;
  for (const line of lines) {
    const kept: PathPoint[] = [];
    for (let i = 0; i < line.length; i += 1) {
      // 每趟的首尾必须留，否则会出现断头；总末尾 DENSE_TAIL 点全留
      const edge = i === 0 || i === line.length - 1;
      if (edge || idx >= cut || idx % stride === 0) kept.push(line[i]);
      idx += 1;
    }
    if (kept.length >= 2) out.push(kept);
    else if (kept.length === 1 && out.length) out[out.length - 1].push(kept[0]);
  }
  return out;
}

/** 播放头位置（插值后） */
export function headAt(path: TrailPath, progress: number): PathPoint | null {
  const target = Math.min(1, Math.max(0, progress)) * path.total;
  if (!path.lines.length) return null;
  let last: PathPoint | null = null;
  for (const line of path.lines) {
    if (line[0].cum > target) break;
    const i = lowerBound(line, target);
    const next = line[i + 1];
    if (!next || line[i].cum >= target) return line[i];
    const span = next.cum - line[i].cum;
    const ratio = span > 0 ? (target - line[i].cum) / span : 0;
    return {
      lat: line[i].lat + (next.lat - line[i].lat) * ratio,
      lng: line[i].lng + (next.lng - line[i].lng) * ratio,
      ts: line[i].ts + (next.ts - line[i].ts) * ratio,
      cum: target,
    };
  }
  const tail = path.lines[path.lines.length - 1];
  last = tail[tail.length - 1];
  return last;
}
