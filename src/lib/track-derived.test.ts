import assert from "node:assert/strict";
import test from "node:test";
import { dayBounds, describeTrip, latestTrip, sumKm, tripsOnDay } from "./track-derived";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

test("dayBounds 是本地时间的当天 0 点到次日 0 点", () => {
  const { start, end } = dayBounds(at(2026, 10, 20));
  assert.equal(start, Math.floor(new Date(2026, 9, 20).getTime() / 1000));
  assert.equal(end - start, 86400);
});

test("tripsOnDay 按出发时间归属，跨午夜算前一天", () => {
  const now = at(2026, 10, 20);
  const trips = [
    { s: Math.floor(at(2026, 10, 20, 8) / 1000), e: 0, k: 12 },
    { s: Math.floor(at(2026, 10, 20, 23) / 1000), e: 0, k: 8 },
    { s: Math.floor(at(2026, 10, 19, 23) / 1000), e: 0, k: 30 },
    { s: Math.floor(at(2026, 10, 20, 23) / 1000) + 3600, e: 0, k: 50 },
  ];
  const today = tripsOnDay(trips, now);
  assert.equal(today.length, 2);
  assert.equal(sumKm(today), 20);
});

test("sumKm 保留一位小数，坏值当 0", () => {
  assert.equal(sumKm([{ s: 1, e: 2, k: 1.24 }, { s: 1, e: 2, k: 2.33 }]), 3.6);
  assert.equal(sumKm([{ s: 1, e: 2, k: Number.NaN }]), 0);
});

test("latestTrip 取出发时间最晚的", () => {
  const latest = latestTrip([{ s: 10, e: 20, k: 5 }, { s: 30, e: 40, k: 7 }, { s: 20, e: 25, k: 1 }]);
  assert.equal(latest?.s, 30);
  assert.equal(latestTrip([]), null);
});

test("describeTrip 给分钟与一位小数公里", () => {
  const info = describeTrip({ s: 1_800_000_000, e: 1_800_000_000 + 1500, k: 12.34 });
  assert.equal(info.minutes, 25);
  assert.equal(info.km, 12.3);
});
