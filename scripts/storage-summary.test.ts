import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeStorage } from "./storage-summary.js";

const GB = 1024 ** 3;

test("按类别汇总字节与文件数，只算存在的文件", () => {
  const summary = summarizeStorage({
    files: [
      { kind: "data", exists: true, sizeBytes: 100 },
      { kind: "data", exists: true, sizeBytes: 200 },
      { kind: "data", exists: false, sizeBytes: null },
      { kind: "config", exists: true, sizeBytes: 50 },
      { kind: "tracks", exists: true, sizeBytes: 900 },
    ],
    backups: [{ size: 300 }, { size: 700 }],
    disk: { freeBytes: 50 * GB, totalBytes: 100 * GB },
  });
  assert.deepEqual(summary.data, { bytes: 300, count: 2 });
  assert.deepEqual(summary.config, { bytes: 50, count: 1 });
  assert.deepEqual(summary.tracks, { bytes: 900, count: 1 });
  assert.deepEqual(summary.backups, { bytes: 1000, count: 2 });
  assert.equal(summary.disk.usedPct, 50);
  assert.deepEqual(summary.warnings, []);
});

test("盘快满、没有备份时给警告", () => {
  const summary = summarizeStorage({
    files: [],
    backups: [],
    disk: { freeBytes: 1 * GB, totalBytes: 100 * GB },
  });
  assert.equal(summary.disk.usedPct, 99);
  assert.deepEqual(summary.warnings, ["磁盘剩余不足 2GB", "还没有任何备份"]);
});

test("已用 ≥90% 也警告", () => {
  const summary = summarizeStorage({
    files: [],
    backups: [{ size: 1 }],
    disk: { freeBytes: 9 * GB, totalBytes: 100 * GB },
  });
  assert.ok(summary.warnings.includes("磁盘使用已超过 90%"));
});
