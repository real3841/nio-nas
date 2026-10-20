export type Pt = [number, number, number];

export interface TrackTripLike {
  s: number;
  e: number;
  k: number;
  c?: number;
  p: Pt[];
}

export interface Station {
  key: string;
  lng: number;
  lat: number;
  count: number;
}

export interface Flow {
  key: string;
  from: { lng: number; lat: number };
  to: { lng: number; lat: number };
  count: number;
}

/** 把坐标量化到网格，减少 GPS 抖动造成的「一站变多站」。精度 3 位小数 ≈ 100m。 */
function cellOf(lng: number, lat: number, precision: number): string {
  return `${lng.toFixed(precision)},${lat.toFixed(precision)}`;
}

/** 起点/终点落在同一网格的次数 → 常去站点。 */
export function aggregateStations(trips: TrackTripLike[], limit = 40, precision = 3): Station[] {
  const cells = new Map<string, Station>();
  const add = (pt: Pt | undefined) => {
    if (!pt) return;
    const key = cellOf(pt[0], pt[1], precision);
    const existing = cells.get(key);
    if (existing) existing.count += 1;
    else cells.set(key, { key, lng: Number(pt[0].toFixed(precision)), lat: Number(pt[1].toFixed(precision)), count: 1 });
  };
  for (const trip of trips) {
    add(trip.p[0]);
    add(trip.p[trip.p.length - 1]);
  }
  return [...cells.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** 起点 → 终点的高频路线（按网格聚合后的 Top N）。 */
export function aggregateFlows(trips: TrackTripLike[], limit = 20, precision = 3): Flow[] {
  const pairs = new Map<string, Flow>();
  for (const trip of trips) {
    const first = trip.p[0];
    const last = trip.p[trip.p.length - 1];
    if (!first || !last) continue;
    if (first[0] === last[0] && first[1] === last[1]) continue;
    const from = { lng: Number(first[0].toFixed(precision)), lat: Number(first[1].toFixed(precision)) };
    const to = { lng: Number(last[0].toFixed(precision)), lat: Number(last[1].toFixed(precision)) };
    if (from.lng === to.lng && from.lat === to.lat) continue; // 短途两头落在同一格，画线没有意义
    const key = `${from.lng},${from.lat}->${to.lng},${to.lat}`;
    const existing = pairs.get(key);
    if (existing) existing.count += 1;
    else pairs.set(key, { key, from, to, count: 1 });
  }
  return [...pairs.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export interface PlaybackFrame {
  /** 已走完的行程点数 */
  donePoints: number;
  /** 当前行程已走到的点（含端点） */
  current: Pt[];
  /** 播放头所在位置 */
  position: Pt | null;
  /** 已完成的行程数 */
  doneTrips: number;
  totalTrips: number;
}

/** 按时间 t 切片：给出已完成的行程与当前行程的前缀，用于逐帧回放。 */
export function playbackFrame(trips: TrackTripLike[], t: number): PlaybackFrame {
  const sorted = [...trips].sort((a, b) => a.s - b.s);
  let donePoints = 0;
  let doneTrips = 0;
  let current: Pt[] = [];
  let position: Pt | null = null;

  for (const trip of sorted) {
    if (trip.p.length === 0) continue;
    if (trip.e <= t) {
      donePoints += trip.p.length;
      doneTrips += 1;
      position = trip.p[trip.p.length - 1];
      continue;
    }
    if (trip.s > t) break;
    // 正在进行的行程：按时间插值出前缀（末点插值，播放头不会一格一格跳）
    let index = 0;
    while (index < trip.p.length && trip.p[index][2] <= t) index += 1;
    current = trip.p.slice(0, Math.max(1, index));
    const prev = trip.p[index - 1];
    const next = trip.p[index];
    if (prev && next && next[2] > prev[2]) {
      const frac = Math.min(1, Math.max(0, (t - prev[2]) / (next[2] - prev[2])));
      current.push([
        prev[0] + (next[0] - prev[0]) * frac,
        prev[1] + (next[1] - prev[1]) * frac,
        t,
      ]);
    }
    position = current[current.length - 1] ?? null;
    break;
  }

  return { donePoints, current, position, doneTrips, totalTrips: sorted.length };
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 丢掉原地抖动的点：连续位移小于 minMeters 的不画，首尾保留 */
export function simplifyPath<T extends [number, number]>(points: T[], minMeters = 12): T[] {
  if (points.length <= 2) return points;
  const out: T[] = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (haversineMeters(last, points[i]) >= minMeters) {
      out.push(points[i]);
      last = points[i];
    }
  }
  const tail = points[points.length - 1];
  if (out[out.length - 1] !== tail) out.push(tail);
  return out;
}
