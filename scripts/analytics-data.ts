import fs from "node:fs";
import path from "node:path";
import { monthlyLedger, monthlySummary, swapStats, tripStats, type MonthPoint, type SwapOrderLike, type TripLike } from "./analytics.js";

export interface AnalyticsView {
  ok: true;
  generatedAt: number;
  monthly: Array<{ month: string; trips: number; km: number }>;
  totals: { trips: number; km: number };
  avgKmPerMonth: number;
  bestMonth: { month: string; km: number } | null;
  trips: ReturnType<typeof tripStats>;
  swaps: ReturnType<typeof swapStats>;
  ledger: ReturnType<typeof monthlyLedger>;
}

const CACHE_MS = 60_000;
let cache: { at: number; view: AnalyticsView } | null = null;

function readIndex(dataDir: string): MonthPoint[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "tracks-index.json"), "utf8")) as {
      months?: MonthPoint[];
    };
    return Array.isArray(parsed.months) ? parsed.months : [];
  } catch {
    return [];
  }
}

function readTrips(dataDir: string): TripLike[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dataDir).filter((name) => /^tracks-\d{4}-\d{2}\.json$/.test(name)).sort();
  } catch {
    return [];
  }
  const trips: TripLike[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8")) as { trips?: TripLike[] };
      if (Array.isArray(parsed.trips)) trips.push(...parsed.trips);
    } catch {
      // 单个文件坏掉不影响整体统计
    }
  }
  return trips;
}

function readSwapOrders(dataDir: string): SwapOrderLike[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "change.json"), "utf8")) as {
      resultData?: { data?: SwapOrderLike[] };
    };
    return Array.isArray(parsed.resultData?.data) ? parsed.resultData.data : [];
  } catch {
    return [];
  }
}

export function buildAnalytics(dataDir: string, now = Date.now()): AnalyticsView {
  if (cache && now - cache.at < CACHE_MS) return cache.view;

  const allMonths = readIndex(dataDir);
  const monthly = monthlySummary(allMonths);
  const trips = tripStats(readTrips(dataDir));
  const orders = readSwapOrders(dataDir);
  const swaps = swapStats(orders);

  const view: AnalyticsView = {
    ok: true,
    generatedAt: now,
    monthly: monthly.months,
    totals: monthly.totals,
    avgKmPerMonth: monthly.avgKmPerMonth,
    bestMonth: monthly.bestMonth,
    trips,
    swaps,
    ledger: monthlyLedger(allMonths, orders, now),
  };
  cache = { at: now, view };
  return view;
}

/** 测试用：清掉进程内缓存。 */
export function resetAnalyticsCache(): void {
  cache = null;
}
