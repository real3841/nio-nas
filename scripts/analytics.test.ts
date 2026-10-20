import assert from "node:assert/strict";
import { test } from "node:test";
import { swapStats, tripStats, monthlySummary, monthlyLedger } from "./analytics.js";

test("monthlySummary 汇总总量、月均、最好月份，并保留 12 个月序列", () => {
  const months = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2025, i, 1));
    return {
      month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      trips: 10 + i,
      km: 100 + i * 10,
      points: 1000,
    };
  });
  const summary = monthlySummary(months);
  assert.equal(summary.months.length, 12);
  assert.equal(summary.months.at(-1)!.month, months.at(-1)!.month);
  assert.equal(summary.totals.trips, months.reduce((a, m) => a + m.trips, 0));
  assert.equal(summary.totals.km, months.reduce((a, m) => a + m.km, 0));
  assert.equal(summary.bestMonth?.month, months.at(-1)!.month);
  assert.equal(summary.avgKmPerMonth, Math.round(summary.totals.km / months.length));
});

test("monthlySummary 空数据不炸", () => {
  const summary = monthlySummary([]);
  assert.deepEqual(summary.totals, { trips: 0, km: 0 });
  assert.equal(summary.bestMonth, null);
  assert.equal(summary.months.length, 0);
});

test("tripStats 给出平均里程/时长、最长行程、充电占比、时段与星期分布", () => {
  const base = 1_700_000_000;
  const trips = [
    { s: base, e: base + 1800, k: 10, c: 0 },
    { s: base + 86_400 * 3, e: base + 86_400 * 3 + 3600, k: 30, c: 1 },
    { s: base + 86_400 * 4, e: base + 86_400 * 4 + 900, k: 5, c: 1 },
  ];
  const stats = tripStats(trips);
  assert.equal(stats.count, 3);
  assert.equal(stats.totalKm, 45);
  assert.equal(stats.avgKm, 15);
  assert.equal(stats.avgMinutes, 35);
  assert.equal(stats.longest?.km, 30);
  assert.equal(stats.chargingCount, 2);
  assert.equal(stats.chargingShare, 67);
  assert.equal(stats.hours.reduce((a, b) => a + b, 0), 3);
  assert.equal(stats.weekdays.reduce((a, b) => a + b, 0), 3);
});

test("tripStats 空数据返回零值", () => {
  const stats = tripStats([]);
  assert.equal(stats.count, 0);
  assert.equal(stats.avgKm, 0);
  assert.equal(stats.longest, null);
  assert.equal(stats.chargingShare, 0);
  assert.deepEqual(stats.hours, Array(24).fill(0));
});

test("swapStats 只数已完成换电，均价按次数均摊", () => {
  const done = { orderType: "pe_shaman_change", orderStatus: "100" };
  const orders = [
    { createTime: 4, priceCash: "24.24", resourceAddress: "A 站", ...done },
    { createTime: 3, priceCash: "6.5", resourceAddress: "A 站", ...done },
    { createTime: 2, priceCash: "", resourceAddress: "B 站", ...done }, // 免费换电：算次数、不算钱
    { createTime: 1, priceCash: "99", resourceAddress: "C 站", orderType: "pe_shaman_change", orderStatus: "255" }, // 已取消
    { createTime: 1, priceCash: "50", resourceAddress: "D 站", orderType: "nsom_so_maintenance", orderStatus: "100" }, // 保养
  ];
  const stats = swapStats(orders);
  assert.equal(stats.count, 3);
  assert.equal(stats.fee, 30.74);
  assert.equal(stats.avgFee, 10.25); // 30.74 / 3，保证 count × avgFee ≈ fee
  assert.equal(stats.priced, 2);
  assert.deepEqual(stats.topStations[0], { address: "A 站", count: 2 });
  assert.equal(stats.topStations.find((s) => s.address === "C 站"), undefined);
});

test("monthlyLedger 只算本月、跳过取消单、算环比与每公里", () => {
  const now = new Date(2026, 9, 20, 12).getTime(); // 2026-10-20
  const months = [
    { month: "2026-08", trips: 100, km: 1000 },
    { month: "2026-09", trips: 111, km: 1092.6 },
    { month: "2026-10", trips: 90, km: 900 },
  ];
  const done = { orderType: "pe_shaman_change", orderStatus: "100" };
  const oct = new Date(2026, 9, 5).getTime();
  const sep = new Date(2026, 8, 5).getTime();
  const orders = [
    { createTime: oct, priceCash: "60", ...done },
    { createTime: oct, priceCash: "40.5", ...done },
    { createTime: oct, priceCash: "77", orderType: "pe_shaman_change", orderStatus: "255" },
    { createTime: sep, priceCash: "88", ...done },
  ];
  const ledger = monthlyLedger(months, orders, now);
  assert.equal(ledger.month, "2026-10");
  assert.equal(ledger.km, 900);
  assert.equal(ledger.prevMonth, "2026-09");
  assert.equal(ledger.deltaPct, -18);
  assert.equal(ledger.swaps, 2);
  assert.equal(ledger.swapFee, 100.5);
  assert.equal(ledger.perKm, 0.112);
});

test("monthlyLedger 没有上月数据时环比为空", () => {
  const ledger = monthlyLedger([{ month: "2026-10", trips: 1, km: 10 }], [], new Date(2026, 9, 2).getTime());
  assert.equal(ledger.deltaPct, null);
  assert.equal(ledger.perKm, null);
  assert.equal(ledger.swaps, 0);
});

test("swapStats 无订单返回零值", () => {
  const stats = swapStats([]);
  assert.deepEqual(stats, { count: 0, fee: 0, avgFee: 0, priced: 0, topStations: [] });
});
