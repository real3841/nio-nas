export interface MonthPoint {
  month: string;
  trips: number;
  km: number;
  points?: number;
}

export interface TripLike {
  s: number;
  e: number;
  k: number;
  c: number;
}

export interface SwapOrderLike {
  createTime: number;
  priceCash?: string;
  resourceAddress?: string;
  /** 订单类型，换电为 pe_shaman_change */
  orderType?: string;
  /** "100" = 已完成；其余为取消/终止/赔付等 */
  orderStatus?: string;
}

const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** 最近 12 个月的里程/行程序列 + 全量合计。 */
export function monthlySummary(months: MonthPoint[]) {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const totals = sorted.reduce(
    (acc, month) => ({ trips: acc.trips + month.trips, km: acc.km + month.km }),
    { trips: 0, km: 0 },
  );
  const best = sorted.reduce<MonthPoint | null>(
    (best, month) => (best == null || month.km >= best.km ? month : best),
    null,
  );
  return {
    months: sorted.slice(-12).map((month) => ({ month: month.month, trips: month.trips, km: month.km })),
    totals: { trips: totals.trips, km: round(totals.km, 1) },
    avgKmPerMonth: sorted.length === 0 ? 0 : Math.round(totals.km / sorted.length),
    bestMonth: best == null ? null : { month: best.month, km: round(best.km, 1) },
  };
}

function hourOf(ts: number): number {
  return new Date(ts * 1000).getHours();
}

function weekdayOf(ts: number): number {
  // 0 = 周一 … 6 = 周日
  return (new Date(ts * 1000).getDay() + 6) % 7;
}

/** 行程层面的均值、极值、充电占比与时段/星期分布。 */
export function tripStats(trips: TripLike[]) {
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  let totalKm = 0;
  let totalMinutes = 0;
  let charging = 0;
  let longest: { s: number; km: number } | null = null;

  for (const trip of trips) {
    totalKm += trip.k;
    totalMinutes += Math.max(0, trip.e - trip.s) / 60;
    if (trip.c === 1) charging += 1;
    if (longest == null || trip.k > longest.km) longest = { s: trip.s, km: trip.k };
    hours[hourOf(trip.s)] += 1;
    weekdays[weekdayOf(trip.s)] += 1;
  }

  const count = trips.length;
  return {
    count,
    totalKm: round(totalKm, 1),
    avgKm: count === 0 ? 0 : round(totalKm / count, 1),
    avgMinutes: count === 0 ? 0 : Math.round(totalMinutes / count),
    longest,
    chargingCount: charging,
    chargingShare: count === 0 ? 0 : Math.round((charging / count) * 100),
    hours,
    weekdays,
  };
}

const SWAP_TYPE = "pe_shaman_change";

/** 只有「换电且已完成」的订单才算一次换电；取消/终止/赔付不算 */
function isCompletedSwap(order: SwapOrderLike): boolean {
  const type = order.orderType ?? SWAP_TYPE;
  return type === SWAP_TYPE && order.orderStatus === "100";
}

/** 换电：完成次数、总花费、平均单次、常去站点（口径与 SwapHistory 一致） */
export function swapStats(orders: SwapOrderLike[]) {
  const done = orders.filter(isCompletedSwap);
  let fee = 0;
  let priced = 0;
  const stations = new Map<string, number>();
  for (const order of done) {
    const price = Number.parseFloat(order.priceCash ?? "");
    if (Number.isFinite(price) && price > 0) {
      fee += price;
      priced += 1;
    }
    const address = order.resourceAddress?.trim();
    if (address) stations.set(address, (stations.get(address) ?? 0) + 1);
  }
  return {
    count: done.length,
    fee: round(fee, 2),
    /** 按完成次数均摊：fee / count，保证 count × avgFee ≈ fee */
    avgFee: done.length === 0 ? 0 : round(fee / done.length, 2),
    /** 有价格的订单数（免费换电不计入均价分母里的金额，但计入次数） */
    priced,
    topStations: [...stations.entries()]
      .map(([address, count]) => ({ address, count }))
      .sort((a, b) => b.count - a.count || a.address.localeCompare(b.address))
      .slice(0, 3),
  };
}

/** 本月账本：里程、环比、换电次数与花费、每公里成本。 */
export function monthlyLedger(months: MonthPoint[], orders: SwapOrderLike[], now: number) {
  const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const current = new Date(now);
  const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
  const curKey = monthKey(current);
  const prevKey = monthKey(previous);
  const cur = months.find((month) => month.month === curKey);
  const prev = months.find((month) => month.month === prevKey);
  const swaps = orders.filter((order) => isCompletedSwap(order) && monthKey(new Date(order.createTime)) === curKey);
  const fee = swaps.reduce((sum, order) => {
    const price = Number.parseFloat(order.priceCash ?? "");
    return sum + (Number.isFinite(price) && price > 0 ? price : 0);
  }, 0);
  const km = round(cur?.km ?? 0, 1);
  const prevKm = round(prev?.km ?? 0, 1);
  return {
    month: curKey,
    trips: cur?.trips ?? 0,
    km,
    prevMonth: prevKey,
    prevKm,
    deltaPct: prevKm > 0 ? round(((km - prevKm) / prevKm) * 100, 0) : null,
    swaps: swaps.length,
    swapFee: round(fee, 2),
    perKm: km > 0 && fee > 0 ? round(fee / km, 3) : null,
  };
}

