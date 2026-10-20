import assert from "node:assert/strict";
import test from "node:test";
import { buildPath, buildTrail, haversineMeters, headAt, hexToHsl, hexToRgba, MAX_POINTS, shade, slicePath, trailHead, trailLength, trailSamples, type TrailTrip } from "./track-trail";

/** 1 纬 ≈ 111km，所以每 0.001 度约 111 米 —— 便于构造可控的距离 */
const trip = (startTs: number, n: number, stepDeg = 0.001): TrailTrip => ({
  s: startTs,
  e: startTs + (n - 1) * 60,
  p: Array.from({ length: n }, (_, i) => [121.5, 38.9 + i * stepDeg, startTs + i * 60] as [number, number, number]),
});

test("原地停留的点被去掉，回放不卡住", () => {
  const stay: TrailTrip = {
    s: 0,
    e: 300,
    p: [
      [121.5, 38.9, 0],
      [121.5, 38.9, 60],
      [121.5, 38.9, 120],
      [121.5, 38.9001, 180], // 11 米，仍算原地
      [121.5, 38.902, 240], // 222 米，动了
      [121.5, 38.902, 300],
    ],
  };
  const lines = trailSamples([stay], "amap");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 3); // 起点、0.902、终点前那次没动被并掉？
  assert.ok(trailLength(lines) > 200);
});

test("buildTrail 按距离推进：0 空、1 走完", () => {
  const trips = [trip(0, 11), trip(3600, 11)];
  assert.deepEqual(buildTrail(trips, 0, "amap"), []);
  const full = buildTrail(trips, 1, "amap");
  assert.equal(full.length, 2);
  assert.equal(full[0].length, 11);
  assert.equal(full[1].length, 11);
  assert.equal(full[0][0].age, 0);
  assert.ok(Math.abs(full[1][10].age - 1) < 1e-9);
});

test("buildTrail 半程停在第二段中间", () => {
  const trips = [trip(0, 11), trip(3600, 11)];
  const half = buildTrail(trips, 0.5, "amap");
  // 两段等长，一半正好走完第一段
  assert.equal(half.length, 1);
  assert.equal(half[0][half[0].length - 1].lat, 38.91);
  const justOver = buildTrail(trips, 0.75, "amap");
  assert.equal(justOver.length, 2);
  const head = justOver[1][justOver[1].length - 1];
  assert.ok(head.age > 0.7 && head.age < 0.8);
  assert.ok(head.lat > 38.903 && head.lat < 38.907, `lat=${head.lat}`);
});

test("buildTrail 抽稀保留终点", () => {
  const big = trip(0, 3000, 0.00001); // 每步约 1.1 米
  const full = buildTrail([big], 1, "amap", 500, 0);
  const kept = full[0].length;
  assert.ok(kept <= 560, `kept=${kept}`);
  assert.ok(kept > 300, `kept=${kept}`);
  assert.equal(full[0][full[0].length - 1].lat, big.p[big.p.length - 1][1]);
});

test("trailHead 插值出时间戳", () => {
  const trips = [trip(1000, 11)];
  const head = trailHead(trips, 0.5, "amap");
  assert.ok(head);
  assert.ok(head!.ts > 1000 + 4 * 60 && head!.ts < 1000 + 6 * 60, `ts=${head!.ts}`);
  assert.equal(trailHead([], 0.5, "amap"), null);
});

test("haversineMeters 与 shade", () => {
  assert.ok(Math.abs(haversineMeters({ lat: 38.9, lng: 121.5 }, { lat: 38.901, lng: 121.5 }) - 111) < 3);
  const head = shade(0.5, 0.5, false);
  const mid = shade(0.3, 0.5, false);
  const old = shade(0, 0.5, false);
  assert.ok(head.alpha > mid.alpha);
  assert.ok(mid.alpha > old.alpha);
  assert.ok(old.alpha > 0.3, "老轨迹不能消失");
  assert.ok(head.width > old.width);
  // 播放结束：整条回落到同一条地板
  const finish = shade(1, 1, false);
  for (const a of [0, 0.3, 0.6, 1]) assert.ok(Math.abs(shade(a, 1, false).alpha - finish.alpha) < 1e-9);
  // 快结束时还留着一点亮头
  assert.ok(shade(0.97, 0.97, false).alpha > finish.alpha + 0.05);
  assert.ok(shade(1, 1, false).color.includes("hsl("));
});

test("拖影颜色跟线色走", () => {
  const pink = shade(0.5, 0.5, false, "#ff5ec8");
  const cyanId = hexToHsl("#22d3ee");
  assert.ok(Math.abs(cyanId.h - 187) < 2, `h=${cyanId.h}`);
  assert.match(pink.color, /^hsl\(32[0-2]/);
  const green = shade(0.5, 0.5, false, "#4ade80");
  assert.notEqual(green.color, pink.color);
  assert.ok(hexToRgba("#22d3ee", 0.5).startsWith("rgba(34, 211, 238"));
});

test("buildPath 预计算累计里程，slicePath 不越过进度", () => {
  const trips = [trip(0, 11), trip(3600, 11)];
  const path = buildPath(trips, "amap");
  assert.ok(path.total > 2000 && path.total < 2400, `total=${path.total}`);
  const half = slicePath(path, 0.5);
  assert.ok(half.length >= 1);
  const last = half[half.length - 1];
  assert.ok(Math.abs(last[last.length - 1].cum - path.total / 2) < 1);
  assert.deepEqual(slicePath(path, 0), []);
});

test("headAt 与全量切片一致", () => {
  const path = buildPath([trip(1000, 11)], "amap");
  const head = headAt(path, 0.25);
  assert.ok(head);
  assert.ok(head!.ts > 1000 && head!.ts < 1000 + 10 * 60);
  assert.ok(head!.cum > 200 && head!.cum < 400);
  assert.equal(headAt({ lines: [], render: [], total: 0 }, 0.5), null);
});

test("抽稀后绘制点数受控且每趟首尾保留", () => {
  const trips = Array.from({ length: 40 }, (_, i) => trip(i * 7200, 600, 0.00002));
  const path = buildPath(trips, "amap", 0);
  const drawn = path.render.reduce((n, line) => n + line.length, 0);
  assert.ok(drawn <= MAX_POINTS + trips.length * 2 + 5, `drawn=${drawn}`);
  assert.ok(path.render.every((line) => line.length >= 2));
});
