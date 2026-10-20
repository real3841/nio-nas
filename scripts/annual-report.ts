import fs from "node:fs";
import path from "node:path";

export interface MonthRow {
  month: string;
  trips: number;
  km: number;
  cost: number;
  swaps: number;
}

export interface AnnualReport {
  from: string;
  to: string;
  months: MonthRow[];
  totalKm: number;
  totalTrips: number;
  totalCost: number;
  paidSwaps: number;
  allSwaps: number;
  costPerKm: number;
  bestMonth: MonthRow | null;
  topDay: { date: string; km: number } | null;
  topStations: Array<{ name: string; count: number }>;
  priciest: { date: string; price: number; station: string } | null;
  firstRecord: string;
  lastRecord: string;
  generatedAt: string;
}

interface ChangeOrder {
  createTime?: number;
  priceCash?: string;
  resourceAddress?: string;
  orderStatusName?: string;
}

interface Trip {
  s: number;
  e: number;
  k: number;
  p: Array<[number, number, number]>;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** 月字符串（2026-09）→ 该月第一天 00:00 的本地时间戳 */
function monthStart(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).getTime();
}

function monthEnd(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m, 1).getTime();
}

export function buildAnnualReport(dataDir: string, now = new Date(), monthsBack = 12): AnnualReport {
  const index = readJson<{ months?: MonthRow[]; totalKm?: number; totalTrips?: number }>(
    path.join(dataDir, "tracks-index.json"),
    {},
  );
  const allMonths = (index.months ?? []).filter((row) => Number.isFinite(row.km));
  const months = allMonths.slice(-monthsBack);
  const from = months[0]?.month ?? "";
  const to = months[months.length - 1]?.month ?? "";
  const windowStart = from ? monthStart(from) : 0;
  const windowEnd = to ? monthEnd(to) : 0;

  const orders = readJson<{ resultData?: { data?: ChangeOrder[] } }>(path.join(dataDir, "change.json"), {})
    .resultData?.data ?? [];
  const inWindow = orders.filter((order) => {
    const ts = order.createTime ?? 0;
    return ts >= windowStart && ts < windowEnd;
  });

  const costByMonth = new Map<string, { cost: number; swaps: number }>();
  for (const order of inWindow) {
    const month = new Date(order.createTime ?? 0).toISOString().slice(0, 7);
    const bucket = costByMonth.get(month) ?? { cost: 0, swaps: 0 };
    bucket.swaps += 1;
    if (order.priceCash) bucket.cost += Number(order.priceCash) || 0;
    costByMonth.set(month, bucket);
  }

  const rows: MonthRow[] = months.map((row) => {
    const bucket = costByMonth.get(row.month) ?? { cost: 0, swaps: 0 };
    return { month: row.month, trips: row.trips, km: Math.round(row.km * 10) / 10, cost: Math.round(bucket.cost * 100) / 100, swaps: bucket.swaps };
  });

  const totalKm = Math.round(rows.reduce((sum, row) => sum + row.km, 0) * 10) / 10;
  const totalTrips = rows.reduce((sum, row) => sum + row.trips, 0);
  const totalCost = Math.round(rows.reduce((sum, row) => sum + row.cost, 0) * 100) / 100;
  const paidSwaps = inWindow.filter((order) => order.priceCash).length;

  // 最长一天：按行程开始日期聚合
  const dayKm = new Map<string, number>();
  for (const row of rows) {
    const file = path.join(dataDir, `tracks-${row.month}.json`);
    const trips = readJson<{ trips?: Trip[] }>(file, {}).trips ?? [];
    for (const trip of trips) {
      const date = new Date(trip.s * 1000).toLocaleDateString("sv-SE");
      dayKm.set(date, (dayKm.get(date) ?? 0) + trip.k);
    }
  }
  const topDayEntry = [...dayKm.entries()].sort((a, b) => b[1] - a[1])[0];

  const stationCount = new Map<string, number>();
  for (const order of inWindow) {
    const name = order.resourceAddress?.trim();
    if (!name) continue;
    stationCount.set(name, (stationCount.get(name) ?? 0) + 1);
  }

  const priciest = inWindow
    .filter((order) => order.priceCash)
    .sort((a, b) => Number(b.priceCash) - Number(a.priceCash))[0];

  return {
    from,
    to,
    months: rows,
    totalKm,
    totalTrips,
    totalCost,
    paidSwaps,
    allSwaps: inWindow.length,
    costPerKm: totalKm > 0 ? Math.round((totalCost / totalKm) * 1000) / 1000 : 0,
    bestMonth: rows.length ? rows.reduce((best, row) => (row.km > best.km ? row : best), rows[0]) : null,
    topDay: topDayEntry ? { date: topDayEntry[0], km: Math.round(topDayEntry[1] * 10) / 10 } : null,
    topStations: [...stationCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count })),
    priciest: priciest
      ? {
          date: new Date(priciest.createTime ?? 0).toLocaleDateString("sv-SE"),
          price: Number(priciest.priceCash),
          station: priciest.resourceAddress ?? "",
        }
      : null,
    firstRecord: months[0]?.month ?? "",
    lastRecord: months[months.length - 1]?.month ?? "",
    generatedAt: now.toISOString(),
  };
}

const esc = (value: string): string =>
  value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] as string);

/** 独立的年报页：不依赖前端构建，先用来看叙事成不成立。 */
export function renderAnnualReportHtml(report: AnnualReport): string {
  const maxKm = Math.max(1, ...report.months.map((row) => row.km));
  const bars = report.months
    .map((row) => {
      const height = Math.max(4, Math.round((row.km / maxKm) * 160));
      const label = row.month.slice(5);
      return `<div class="bar-col" title="${esc(row.month)}：${row.km} km · ¥${row.cost.toFixed(2)}">
        <div class="bar-value">${Math.round(row.km)}</div>
        <div class="bar" style="height:${height}px"></div>
        <div class="bar-cost">${row.cost > 0 ? `¥${Math.round(row.cost)}` : "—"}</div>
        <div class="bar-label">${label}</div>
      </div>`;
    })
    .join("");

  const stations = report.topStations
    .map((station, i) => `<li><span class="rank">${i + 1}</span>${esc(station.name)}<em>${station.count} 次</em></li>`)
    .join("");

  const headline = `过去 ${report.months.length} 个月，你跑了 ${report.totalKm.toLocaleString("zh-CN")} 公里，换电 ${report.paidSwaps} 次花了 ¥${report.totalCost.toFixed(2)}。`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>用车年报 · ${esc(report.from)} ~ ${esc(report.to)}</title>
<style>
  :root { --bg:#eef1f6; --panel:#fff; --text:#111827; --muted:#6b7280; --line:#e3e8ef; --blue:#2563eb; --amber:#f59e0b; --green:#16a34a; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:400 14px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}
  main{max-width:880px;margin:0 auto;padding:32px 20px 64px}
  .eyebrow{font-size:12px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
  h1{font-size:28px;line-height:1.25;margin:6px 0 4px;font-weight:700}
  .range{color:var(--muted);font-size:13px}
  .headline{margin:20px 0 24px;font-size:18px;line-height:1.6;font-weight:600}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
  .kpi b{display:block;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .kpi span{display:block;font-size:11px;color:var(--muted);margin-top:2px}
  section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px;margin-bottom:16px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 16px;font-weight:600}
  .chart{display:flex;align-items:flex-end;gap:6px;height:220px}
  .bar-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px}
  .bar{width:100%;background:linear-gradient(180deg,#3b82f6,#2563eb);border-radius:4px 4px 0 0;min-height:4px}
  .bar-value{font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums}
  .bar-cost{font-size:10px;color:var(--amber);font-variant-numeric:tabular-nums}
  .bar-label{font-size:10px;color:var(--muted)}
  .split{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .fact b{font-size:22px;font-variant-numeric:tabular-nums}
  .fact p{margin:2px 0 0;color:var(--muted);font-size:12px}
  ol{list-style:none;margin:0;padding:0}
  li{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
  li:last-child{border-bottom:0}
  li em{margin-left:auto;color:var(--muted);font-style:normal;font-variant-numeric:tabular-nums}
  .rank{width:18px;height:18px;border-radius:50%;background:#eff6ff;color:var(--blue);font-size:11px;display:grid;place-items:center;font-weight:600}
  .note{font-size:12px;color:var(--muted);line-height:1.7}
  .note strong{color:var(--text)}
  @media (max-width:640px){ .kpis{grid-template-columns:1fr 1fr} .split{grid-template-columns:1fr} h1{font-size:22px} }
  @media print{ body{background:#fff} section,.kpi{border-color:#ddd} }
</style></head>
<body><main>
  <div class="eyebrow">NIO · 用车年报</div>
  <h1>这 ${report.months.length} 个月，你的车过得怎么样</h1>
  <div class="range">${esc(report.from)} ~ ${esc(report.to)} · 数据来自 NAS 本地记录</div>

  <p class="headline">${esc(headline)}</p>

  <div class="kpis">
    <div class="kpi"><b>${report.totalKm.toLocaleString("zh-CN")}</b><span>公里</span></div>
    <div class="kpi"><b>¥${report.totalCost.toFixed(2)}</b><span>换电花费</span></div>
    <div class="kpi"><b>¥${report.costPerKm.toFixed(3)}</b><span>每公里</span></div>
    <div class="kpi"><b>${report.paidSwaps}</b><span>次付费换电</span></div>
  </div>

  <section>
    <h2>每个月的里程与花费</h2>
    <div class="chart">${bars}</div>
    <p class="note" style="margin-top:10px">柱子是里程（km），柱子下方的橙色数字是当月换电花费。免费换电显示「—」。</p>
  </section>

  <div class="split">
    <section>
      <h2>最远的一个月</h2>
      <div class="fact"><b>${report.bestMonth ? report.bestMonth.month : "—"}</b>
        <p>${report.bestMonth ? `${report.bestMonth.km} km · 换电 ${report.bestMonth.swaps} 次 ¥${report.bestMonth.cost.toFixed(2)}` : "无数据"}</p>
      </div>
    </section>
    <section>
      <h2>最费电的一天</h2>
      <div class="fact"><b>${report.topDay ? report.topDay.date : "—"}</b>
        <p>${report.topDay ? `跑了 ${report.topDay.km} km` : "无数据"}</p>
      </div>
    </section>
  </div>

  <section>
    <h2>最常去的换电站</h2>
    ${stations ? `<ol>${stations}</ol>` : `<p class="note">这段时间没有换电记录。</p>`}
    <p class="note" style="margin-top:8px">${report.priciest ? `最贵的一次是 ${esc(report.priciest.date)}，¥${report.priciest.price.toFixed(2)}，在 ${esc(report.priciest.station)}。` : ""}</p>
  </section>

  <section>
    <h2>口径</h2>
    <p class="note">统计期间 <strong>${esc(report.from)} ~ ${esc(report.to)}</strong>，共 ${report.totalTrips} 趟行程、${report.allSwaps} 笔换电订单（其中 ${report.paidSwaps} 笔付费）。
    花费<strong>只含换电账单，不含家充/充电桩电费</strong>，所以「每公里」是偏低的下限。轨迹来自车机接口，断联的行程不计入。
    生成于 ${new Date(report.generatedAt).toLocaleString("zh-CN")}。</p>
  </section>
</main></body></html>`;
}
