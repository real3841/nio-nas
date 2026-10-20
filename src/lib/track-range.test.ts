import assert from "node:assert/strict";
import { test } from "node:test";
import { monthsBetween, resolveRange, shiftAnchor, tripsInRange } from "./track-range.js";

test("日/周/月区间覆盖正确的本地时间", () => {
  const day = resolveRange({ mode: "day", anchor: "2026-10-19" });
  assert.equal(new Date(day.from).getDate(), 19);
  assert.equal(new Date(day.to).getDate(), 19);
  assert.ok(day.to - day.from === 24 * 3600 * 1000 - 1);
  assert.equal(day.label, "2026-10-19 全天");

  const week = resolveRange({ mode: "week", anchor: "2026-10-19" }); // 周一
  assert.equal(new Date(week.from).getDay(), 1);
  assert.equal(new Date(week.to).getDay(), 0);
  assert.equal(week.to - week.from, 7 * 24 * 3600 * 1000 - 1);

  const month = resolveRange({ mode: "month", anchor: "2026-02-15" });
  assert.equal(new Date(month.from).getDate(), 1);
  assert.equal(new Date(month.to).getDate(), 28);
  assert.equal(month.months.length, 1);
});

test("自定义区间颠倒时自动纠正，并跨年列出月份", () => {
  const custom = resolveRange({ mode: "custom", anchor: "2026-10-19", from: "2025-12-20", to: "2025-11-01" });
  assert.equal(custom.label, "2025-11-01 ~ 2025-12-20");
  assert.deepEqual(custom.months, ["2025-11", "2025-12"]);
  assert.deepEqual(monthsBetween(new Date(2025, 10, 1).getTime(), new Date(2026, 1, 1).getTime()), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
});

test("shiftAnchor 按模式前后移动", () => {
  assert.equal(shiftAnchor("day", "2026-10-31", 1), "2026-11-01");
  assert.equal(shiftAnchor("week", "2026-10-19", -1), "2026-10-12");
  assert.equal(shiftAnchor("month", "2026-01-31", 1), "2026-02-01");
});

test("tripsInRange 保留与区间重叠的行程", () => {
  const trips = [
    { s: 100, e: 200 },
    { s: 500, e: 600 },
    { s: 195, e: 260 },
  ];
  assert.deepEqual(tripsInRange(trips, 0, 300), [trips[0], trips[2]]);
  assert.deepEqual(tripsInRange(trips, 601, 900), []);
});
