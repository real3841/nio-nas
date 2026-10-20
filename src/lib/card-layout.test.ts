import assert from "node:assert/strict";
import test from "node:test";
import { LAYOUT_VERSION, ORDER_CARDS, VEHICLE_CARDS, mergeLayout } from "./card-layout";

test("默认只留 4 张主卡", () => {
  const layout = mergeLayout(VEHICLE_CARDS, null);
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  assert.deepEqual(visible, ["battery", "daily_mileage", "recent_journey", "charging"]);
  assert.equal(layout.version, LAYOUT_VERSION);
  assert.equal(mergeLayout(ORDER_CARDS, null).hidden.length, ORDER_CARDS.length);
});

test("v1 老布局一次性收起次要卡片", () => {
  const saved = { order: ["battery", "doors_visual", "tyre", "daily_mileage"], hidden: [] };
  const layout = mergeLayout(VEHICLE_CARDS, saved);
  assert.ok(layout.hidden.includes("doors_visual"));
  assert.ok(layout.hidden.includes("tyre"));
  assert.equal(layout.version, LAYOUT_VERSION);
});

test("已经是 v2 的布局尊重用户手动打开", () => {
  const saved = { order: ["battery", "doors_visual"], hidden: [], version: LAYOUT_VERSION };
  const layout = mergeLayout(VEHICLE_CARDS, saved);
  assert.ok(!layout.hidden.includes("doors_visual"));
  assert.ok(layout.hidden.includes("tyre"));
});

test("失效 id 被剔除，不会白屏", () => {
  const layout = mergeLayout(VEHICLE_CARDS, { order: ["nope", "battery"], hidden: ["nope"], version: LAYOUT_VERSION });
  assert.ok(!layout.order.includes("nope"));
  assert.ok(layout.order.includes("battery"));
});
