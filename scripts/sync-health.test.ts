import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHealthView, computeSyncHealth, describeSyncHealth } from "./sync-health.js";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

test("最近成功在 6 小时内且没有连续失败：不弹横幅", () => {
  const health = computeSyncHealth({
    now: NOW,
    lastSuccessAt: NOW - 2 * HOUR,
    entries: [
      { slot: "vehicle", level: "error", message: "500" },
      { slot: "vehicle", level: "success", message: "ok" },
      { slot: "vehicle", level: "error", message: "boom" },
    ],
  });
  assert.equal(health.banner, false);
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(describeSyncHealth(health), "采集正常");
});

test("连续 3 次失败：弹横幅并带最后一次错误", () => {
  const health = computeSyncHealth({
    now: NOW,
    lastSuccessAt: NOW - 1 * HOUR,
    entries: [
      { slot: "vehicle", level: "success", message: "ok" },
      { slot: "vehicle", level: "error", message: "第一" },
      { slot: "vehicle", level: "info", message: "开始拉取" },
      { slot: "vehicle", level: "error", message: "第二" },
      { slot: "vehicle", level: "error", message: "第三" },
    ],
  });
  assert.equal(health.banner, true);
  assert.equal(health.reason, "failures");
  assert.equal(health.consecutiveFailures, 3);
  assert.equal(health.lastError, "第三");
});

test("超过 6 小时没有成功：即使日志还在成功也算 stale", () => {
  const health = computeSyncHealth({
    now: NOW,
    lastSuccessAt: NOW - 7 * HOUR,
    entries: [{ slot: "vehicle", level: "success", message: "ok" }],
  });
  assert.equal(health.reason, "stale");
  assert.equal(health.banner, true);
  assert.match(describeSyncHealth(health), /7 小时没有成功采集/);
});

test("从未成功过：reason=never", () => {
  const health = computeSyncHealth({ now: NOW, lastSuccessAt: null, entries: [] });
  assert.equal(health.reason, "never");
  assert.equal(health.banner, true);
  assert.equal(describeSyncHealth(health), "还没有成功采集过车辆数据");
});

test("buildHealthView：只透出轮询摘要和槽位的关键字段", () => {
  const view = buildHealthView({
    health: {
      lastSuccessAt: 1_800_000_000_000,
      hoursSinceSuccess: 1.5,
      consecutiveFailures: 0,
      lastError: null,
      banner: false,
      reason: null,
    },
    detail: "上次成功 1.5 小时前",
    poll: { intervalSec: 3600, reason: "night", reasonLabel: "夜间" },
    slots: [
      { id: "widget", label: "车辆", ok: true, kind: null, address: "https://secret.example/x", needsUrl: false },
      { id: "journey", label: "最近行程", ok: false, kind: "sign", error: null },
      { id: "change", label: "换电", ok: false, kind: "sign", error: "签名失败", address: "https://secret.example/y", needsUrl: false },
    ],
  });
  assert.equal(view.ok, true);
  assert.equal(view.poll.reasonLabel, "夜间");
  assert.deepEqual(view.slots, [
    { id: "widget", label: "车辆", ok: true, kind: null, error: null },
    { id: "change", label: "换电", ok: false, kind: "sign", error: "签名失败" },
  ]);
  assert.equal("address" in (view.slots[0] as object), false);
  assert.equal(view.slots.some((slot) => slot.id === "journey"), false);
});
