import assert from "node:assert/strict";
import test from "node:test";
import { buildAttention } from "./attention";

const base = {
  now: 1_800_000_000_000,
  sampleAt: 1_800_000_000_000 - 5 * 60_000,
  moving: false,
  locked: true,
  openDoors: [] as string[],
  openWindows: [] as string[],
  tyreBad: [] as string[],
  tyreKnown: true,
  lvVolt: 12.6,
  maintainDue: false,
  defenderWarns: 0,
  sync: null,
};

test("一切正常时只给一行摘要", () => {
  const result = buildAttention(base);
  assert.equal(result.items.length, 0);
  assert.match(result.summary, /一切正常/);
  assert.match(result.summary, /已锁车/);
  assert.match(result.summary, /胎压正常/);
});

test("门没关、没锁车是 hot，且排在前面", () => {
  const result = buildAttention({
    ...base,
    locked: false,
    openDoors: ["左后门"],
    openWindows: ["左前窗"],
  });
  assert.equal(result.items[0].id, "doors");
  assert.equal(result.items[0].tone, "hot");
  assert.ok(result.items.some((i) => i.id === "unlocked"));
  assert.ok(result.items.findIndex((i) => i.id === "windows") > result.items.findIndex((i) => i.id === "unlocked"));
});

test("数据过期与连续失败", () => {
  const result = buildAttention({
    ...base,
    sampleAt: base.now - 5 * 3_600_000,
    sync: { stale: false, failures: 4, lastError: "sign_failed" },
  });
  assert.ok(result.items.some((i) => i.id === "stale" && /5 小时/.test(i.text)));
  assert.ok(result.items.some((i) => i.id === "sync-failed" && /sign_failed/.test(i.text)));
});

test("胎压、12V、保养、守卫", () => {
  const result = buildAttention({
    ...base,
    tyreBad: ["左前 2.1 bar"],
    lvVolt: 11.6,
    maintainDue: true,
    defenderWarns: 2,
  });
  assert.equal(result.items.filter((i) => i.tone === "hot").length, 2);
  assert.ok(result.items.some((i) => i.id === "maintain"));
  assert.ok(result.items.some((i) => i.id === "defender"));
});

test("没有数据时不假装正常", () => {
  const result = buildAttention({ ...base, sampleAt: null, tyreKnown: false });
  assert.ok(result.items.some((i) => i.id === "no-data"));
  assert.equal(result.summary, "");
});
