import assert from "node:assert/strict";
import { test } from "node:test";
import { BASEMAPS, BASEMAP_REFERENCE_URL, resolveBasemap } from "./map-tiles";

test("auto: 有高德 Key 用高德，没有就按深浅色选 Esri", () => {
  assert.equal(resolveBasemap("auto", true, false).provider, "amap");
  assert.match(resolveBasemap("auto", false, true).url, /World_Dark_Gray_Base/);
  assert.match(resolveBasemap("auto", false, false).url, /World_Light_Gray_Base/);
});

test("显式底图不受深浅色影响", () => {
  assert.match(resolveBasemap("amap-sat", true, false).url, /style=6/);
  assert.match(resolveBasemap("esri-dark", true, false).url, /World_Dark_Gray_Base/);
  assert.equal(resolveBasemap("esri-sat", true, false).provider, "osm");
});

test("英文注记层只有深灰/浅灰两个", () => {
  assert.ok(BASEMAP_REFERENCE_URL["esri-dark"]);
  assert.ok(BASEMAP_REFERENCE_URL["esri-light"]);
  assert.equal(BASEMAP_REFERENCE_URL["esri-sat"], undefined);
  assert.equal(new Set(BASEMAPS.map((item) => item.id)).size, BASEMAPS.length);
});
