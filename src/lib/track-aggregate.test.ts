import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateFlows, aggregateStations, playbackFrame, simplifyPath, type TrackTripLike } from "./track-aggregate.js";

const trip = (s: number, e: number, points: Array<[number, number, number]>): TrackTripLike => ({
  s,
  e,
  k: 1,
  p: points,
});

test("aggregateStations 把相邻抖动合并并按次数排序", () => {
  const trips = [
    trip(0, 10, [[121.6001, 38.9101, 0], [121.7, 38.95, 10]]),
    trip(20, 30, [[121.6002, 38.9102, 20], [121.7, 38.9501, 30]]),
    trip(40, 50, [[121.9, 39.0, 40], [121.6003, 38.9103, 50]]),
  ];
  const stations = aggregateStations(trips);
  assert.equal(stations[0].count, 3);
  assert.equal(stations[0].key, "121.600,38.910");
  assert.ok(stations.length <= 4);
});

test("aggregateFlows 统计同一 OD 并跳过原地往返", () => {
  const trips = [
    trip(0, 10, [[121.6, 38.91, 0], [121.7, 38.95, 10]]),
    trip(20, 30, [[121.6, 38.91, 20], [121.7, 38.95, 30]]),
    trip(40, 50, [[121.6, 38.91, 40], [121.6, 38.91, 50]]),
  ];
  const flows = aggregateFlows(trips);
  assert.equal(flows.length, 1);
  assert.equal(flows[0].count, 2);
});

test("playbackFrame 给出已完成点数、当前前缀与位置", () => {
  const trips = [
    trip(0, 100, [[1, 1, 0], [1.1, 1.1, 50], [1.2, 1.2, 100]]),
    trip(200, 300, [[2, 2, 200], [2.1, 2.1, 300]]),
  ];
  const mid = playbackFrame(trips, 60);
  assert.equal(mid.doneTrips, 0);
  // 末点按时间插值：50 秒的点和 100 秒的点之间补出 60 秒的位置
  assert.deepEqual(mid.current.map((p) => p[2]), [0, 50, 60]);
  assert.ok(Math.abs(mid.position![0] - 1.12) < 1e-9);
  assert.ok(Math.abs(mid.position![1] - 1.12) < 1e-9);
  assert.equal(mid.position![2], 60);

  const after = playbackFrame(trips, 150);
  assert.equal(after.doneTrips, 1);
  assert.equal(after.donePoints, 3);
  assert.deepEqual(after.position, [1.2, 1.2, 100]);

  const end = playbackFrame(trips, 999);
  assert.equal(end.doneTrips, 2);
  assert.equal(end.current.length, 0);
});

test("playbackFrame 空行程数组不炸", () => {
  const frame = playbackFrame([], 100);
  assert.equal(frame.doneTrips, 0);
  assert.equal(frame.position, null);
  assert.deepEqual(frame.current, []);
});

test("simplifyPath 去掉原地抖动但保留首尾", () => {
  const jitter: Array<[number, number]> = [
    [121.6, 38.91],
    [121.600001, 38.910001],
    [121.600002, 38.910002],
    [121.61, 38.92],
    [121.610001, 38.920001],
  ];
  const out = simplifyPath(jitter, 12);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], jitter[0]);
  assert.deepEqual(out[1], jitter[3]);
  assert.deepEqual(out[2], jitter[4]);
  assert.equal(simplifyPath([[121.6, 38.91]] as Array<[number, number]>).length, 1);
});
