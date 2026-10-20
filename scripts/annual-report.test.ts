import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildAnnualReport, renderAnnualReportHtml } from "./annual-report.js";

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "annual-"));
  fs.writeFileSync(
    path.join(dir, "tracks-index.json"),
    JSON.stringify({
      months: [
        { month: "2025-09", trips: 10, km: 100, points: 1000 },
        { month: "2025-10", trips: 20, km: 300, points: 2000 },
        { month: "2025-11", trips: 30, km: 500, points: 3000 },
      ],
    }),
  );
  for (const month of ["2025-09", "2025-10", "2025-11"]) {
    fs.writeFileSync(path.join(dir, `tracks-${month}.json`), JSON.stringify({ month, trips: [] }));
  }
  fs.writeFileSync(
    path.join(dir, "change.json"),
    JSON.stringify({
      resultData: {
        data: [
          { createTime: new Date(2025, 9, 3).getTime(), priceCash: "30.00", resourceAddress: "A 站" },
          { createTime: new Date(2025, 9, 9).getTime(), priceCash: "", resourceAddress: "A 站" },
          { createTime: new Date(2025, 10, 2).getTime(), priceCash: "20.00", resourceAddress: "B 站" },
          { createTime: new Date(2024, 0, 1).getTime(), priceCash: "999.00", resourceAddress: "老订单" },
        ],
      },
    }),
  );
  return dir;
}

test("buildAnnualReport 只统计窗口内月份与订单", () => {
  const dir = fixture();
  const report = buildAnnualReport(dir, new Date(2025, 11, 1), 2);
  assert.equal(report.months.length, 2);
  assert.deepEqual(report.months.map((row) => row.month), ["2025-10", "2025-11"]);
  assert.equal(report.totalKm, 800);
  assert.equal(report.totalCost, 50);
  assert.equal(report.paidSwaps, 2);
  assert.equal(report.costPerKm, 0.063);
  assert.equal(report.bestMonth?.month, "2025-11");
});

test("renderAnnualReportHtml 转义站点名并给出结论句", () => {
  const html = renderAnnualReportHtml(buildAnnualReport(fixture(), new Date(2025, 11, 1), 2));
  assert.match(html, /过去 2 个月，你跑了 800 公里/);
  assert.match(html, /B 站/);
  assert.match(html, /<style>/);
});
