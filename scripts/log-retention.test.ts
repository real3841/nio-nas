import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneLogEntries } from "./log-retention.js";

const DAY = 86_400_000;

test("丢掉 30 天前的日志，保留最近的最少 20 条", () => {
  const now = 300 * DAY;
  const old = Array.from({ length: 5 }, (_, i) => ({ at: (10 + i) * DAY, id: `old${i}` }));
  const recent = [{ at: now - DAY, id: "recent" }];
  const kept = pruneLogEntries([...old, ...recent], now, 30);
  assert.deepEqual(kept.map((entry) => entry.id), ["recent"]);

  const tiny = pruneLogEntries(
    Array.from({ length: 3 }, (_, i) => ({ at: now - (i + 1) * 3_600_000, id: `t${i}` })),
    now,
    30,
  );
  assert.equal(tiny.length, 3, "窗口内的少量条目全部保留");
});

test("空数组与边界时间不出错", () => {
  assert.deepEqual(pruneLogEntries([], Date.now(), 30), []);
  const now = 100 * DAY;
  const edge = [{ at: now - 30 * DAY, id: "edge" }];
  assert.equal(pruneLogEntries(edge, now, 30).length, 1, "正好 30 天前保留");
});
