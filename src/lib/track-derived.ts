/** 从本地轨迹月文件推导「今天」和「最近一趟」——签名接口挂了也有数 */

export interface TrackTripLike {
  s: number;
  e: number;
  k: number;
  c?: number;
  p?: unknown[];
}

/** 本地时区的今天 00:00 – 明天 00:00（秒） */
export function dayBounds(now: number): { start: number; end: number } {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return { start: Math.floor(start / 1000), end: Math.floor(end / 1000) };
}

/** 以「出发时间」落在今天为准 */
export function tripsOnDay(trips: TrackTripLike[], now: number): TrackTripLike[] {
  const { start, end } = dayBounds(now);
  return trips.filter((trip) => trip.s >= start && trip.s < end).sort((a, b) => a.s - b.s);
}

export function sumKm(trips: TrackTripLike[]): number {
  return Math.round(trips.reduce((sum, trip) => sum + (Number.isFinite(trip.k) ? trip.k : 0), 0) * 10) / 10;
}

export function latestTrip(trips: TrackTripLike[]): TrackTripLike | null {
  let best: TrackTripLike | null = null;
  for (const trip of trips) {
    if (!best || trip.s > best.s) best = trip;
  }
  return best;
}

/** 最近一趟的展示字段：起止时间、里程、用时 */
export function describeTrip(trip: TrackTripLike): { start: number; end: number; km: number; minutes: number } {
  const minutes = Math.max(0, Math.round((trip.e - trip.s) / 60));
  return { start: trip.s, end: trip.e, km: Math.round(trip.k * 10) / 10, minutes };
}
