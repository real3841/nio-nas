import assert from "node:assert/strict";
import { test } from "node:test";
import { compareIndex, indexFromTracks } from "./tracks-integrity.js";

const file = (month: string, trips: number, km: number, points: number, mtime = 1000) => ({
  month,
  trips,
  km,
  points,
  mtime,
  bytes: 100,
});

test("索引与文件一致时不重建", () => {
  const scanned = [file("2025-12", 10, 100.5, 500), file("2026-01", 20, 200, 900)];
  const index = { ...indexFromTracks(scanned, 2000) };
  const check = compareIndex(index, scanned);
  assert.equal(check.needsRebuild, false);
  assert.deepEqual(check.reasons, []);
});

test("缺月份、多月份、数字漂移、索引过期都会触发重建", () => {
  const scanned = [file("2026-01", 21, 201.2, 901)];
  const stale = {
    generatedAt: new Date(1000).toISOString(),
    months: [{ month: "2026-01", trips: 20, km: 200, points: 900 }, { month: "2025-11", trips: 1, km: 1, points: 1 }],
    totalTrips: 21,
    totalKm: 201,
    totalPoints: 901,
  };
  const check = compareIndex(stale, scanned);
  assert.equal(check.needsRebuild, true);
  assert.ok(check.reasons.some((r) => r.includes("索引里有、磁盘上没有：2025-11")));
  assert.ok(check.reasons.some((r) => r.includes("2026-01")));
});

test("索引生成时间早于月文件修改时间 → 重建", () => {
  const scanned = [file("2026-02", 5, 50, 100, 5000)];
  const index = { ...indexFromTracks(scanned, 1000) };
  assert.equal(compareIndex(index, scanned).needsRebuild, true);
});

test("缺少索引文件时直接给重建理由", () => {
  const check = compareIndex(null, [file("2026-02", 5, 50, 100)]);
  assert.equal(check.needsRebuild, true);
  assert.ok(check.reasons.some((r) => r.includes("没有索引")));
});
