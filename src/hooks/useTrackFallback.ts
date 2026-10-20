import { useEffect, useState } from "react";
import { latestTrip, sumKm, tripsOnDay, type TrackTripLike } from "../lib/track-derived";

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function readMonth(key: string): Promise<TrackTripLike[]> {
  try {
    const res = await fetch(`/data/tracks-${key}.json`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { trips?: TrackTripLike[] };
    return Array.isArray(json.trips) ? json.trips : [];
  } catch {
    return [];
  }
}

/**
 * 签名接口（daily / journey）不可用时的本地兜底：
 * 当月轨迹文件里已经有公里数，够算今天的里程和最近一趟。
 */
export function useTrackFallback() {
  // 挂载时取一次时间，避免 Date.now() 每次渲染变化导致重复拉取
  const [now] = useState(() => Date.now());
  const [trips, setTrips] = useState<TrackTripLike[] | null>(null);

  useEffect(() => {
    let alive = true;
    const date = new Date(now);
    const current = monthKey(date);
    const prevDate = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const previous = monthKey(prevDate);

    void (async () => {
      const currentTrips = await readMonth(current);
      let all = currentTrips;
      // 月初头几天当月还没行程时，翻上个月拿「最近一趟」
      if (currentTrips.length === 0) all = [...(await readMonth(previous))];
      if (alive) setTrips(all);
    })();

    return () => {
      alive = false;
    };
  }, [now]);

  const todayTrips = trips == null ? null : tripsOnDay(trips, now);
  return {
    loading: trips == null,
    todayKm: todayTrips == null ? null : sumKm(todayTrips),
    todayCount: todayTrips?.length ?? 0,
    lastTrip: trips == null ? null : latestTrip(trips),
  };
}
