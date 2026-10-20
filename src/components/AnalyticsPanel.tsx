import { useEffect, useState } from "react";

interface MonthlyPoint {
  month: string;
  trips: number;
  km: number;
}

interface Analytics {
  ok: boolean;
  generatedAt: number;
  monthly: MonthlyPoint[];
  totals: { trips: number; km: number };
  avgKmPerMonth: number;
  bestMonth: { month: string; km: number } | null;
  trips: {
    count: number;
    totalKm: number;
    avgKm: number;
    avgMinutes: number;
    longest: { s: number; km: number } | null;
    chargingCount: number;
    chargingShare: number;
    hours: number[];
    weekdays: number[];
  };
  swaps: {
    count: number;
    fee: number;
    avgFee: number;
    priced: number;
    topStations: Array<{ address: string; count: number }>;
  };
  ledger: {
    month: string;
    trips: number;
    km: number;
    prevMonth: string;
    prevKm: number;
    deltaPct: number | null;
    swaps: number;
    swapFee: number;
    perKm: number | null;
  };
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function fmtMonth(month: string): string {
  const [, m] = month.split("-");
  return `${Number(m)}月`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function BarRow({
  items,
  valueOf,
  labelOf,
  unit,
  titleOf,
}: {
  items: Array<{ key: string; value: number; label: string; title?: string }>;
  valueOf: (item: { value: number }) => number;
  labelOf: (item: { label: string }) => string;
  unit: string;
  titleOf?: (item: { title?: string; label: string; value: number }) => string;
}) {
  const max = Math.max(1, ...items.map((item) => valueOf(item)));
  return (
    <div className="analytics-bars" role="img" aria-label={unit}>
      {items.map((item) => {
        const height = Math.max(3, Math.round((valueOf(item) / max) * 100));
        return (
          <div className="analytics-bar" key={item.key}>
            <div className="analytics-bar-track">
              <div
                className="analytics-bar-fill"
                style={{ height: `${height}%` }}
                title={titleOf ? titleOf(item) : `${item.label}：${valueOf(item)} ${unit}`}
              />
            </div>
            <span className="analytics-bar-label">{labelOf(item)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || data || loading) return;
    setLoading(true);
    setError(null);
    fetch("/api/analytics")
      .then(async (res) => {
        const body = (await res.json()) as Analytics & { error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error ?? `无法加载分析数据 (${res.status})`);
        setData(body);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "无法加载分析数据"))
      .finally(() => setLoading(false));
  }, [open, data, loading, attempt]);

  const content = () => {
    if (loading) return <p className="muted api-hint">正在统计…</p>;
    if (error)
      return (
        <p className="muted api-hint">
          {error}
          {" · "}
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            重试
          </button>
        </p>
      );
    if (!data) return null;
    if (data.monthly.length === 0 && data.trips.count === 0) {
      return <p className="muted card-empty-hint">还没有可统计的轨迹，先在「历史轨迹」里补全历史。</p>;
    }

    const monthItems = data.monthly.map((point) => ({
      key: point.month,
      value: point.km,
      label: fmtMonth(point.month),
      title: `${point.month}：${point.km} km · ${point.trips} 趟`,
    }));
    const hourItems = data.trips.hours.map((value, hour) => ({
      key: `h${hour}`,
      value,
      label: hour % 3 === 0 ? String(hour) : "",
      title: `${hour} 点出发：${value} 次`,
    }));
    const weekdayItems = data.trips.weekdays.map((value, index) => ({
      key: `w${index}`,
      value,
      label: WEEKDAYS[index],
      title: `周${WEEKDAYS[index]}：${value} 次`,
    }));

    return (
      <>
        <div className="analytics-kpis">
          <div className="analytics-kpi">
            <span className="muted">总里程</span>
            <strong>{data.totals.km.toLocaleString("zh-CN")} km</strong>
            <span className="muted">覆盖 {data.monthly.length} 个月</span>
          </div>
          <div className="analytics-kpi">
            <span className="muted">总行程</span>
            <strong>{data.totals.trips.toLocaleString("zh-CN")} 趟</strong>
            <span className="muted">平均 {data.trips.avgKm} km / 趟</span>
          </div>
          <div className="analytics-kpi">
            <span className="muted">月均里程</span>
            <strong>{data.avgKmPerMonth.toLocaleString("zh-CN")} km</strong>
            <span className="muted">{data.bestMonth ? `最好 ${data.bestMonth.month}（${data.bestMonth.km} km）` : "—"}</span>
          </div>
          <div className="analytics-kpi">
            <span className="muted">单次最长</span>
            <strong>{data.trips.longest ? `${data.trips.longest.km} km` : "—"}</strong>
            <span className="muted">{data.trips.longest ? `发生在 ${fmtDate(data.trips.longest.s)}` : "—"}</span>
          </div>
        </div>

        <section className="analytics-block">
          <h4 className="analytics-title">最近 12 个月里程</h4>
          <BarRow
            items={monthItems}
            valueOf={(item) => item.value}
            labelOf={(item) => item.label}
            unit="km"
            titleOf={(item) => item.title ?? ""}
          />
        </section>

        <div className="analytics-split">
          <section className="analytics-block">
            <h4 className="analytics-title">出发时段（24 小时）</h4>
            <BarRow
              items={hourItems}
              valueOf={(item) => item.value}
              labelOf={(item) => item.label}
              unit="次"
              titleOf={(item) => item.title ?? ""}
            />
          </section>
          <section className="analytics-block">
            <h4 className="analytics-title">星期分布</h4>
            <BarRow
              items={weekdayItems}
              valueOf={(item) => item.value}
              labelOf={(item) => item.label}
              unit="次"
              titleOf={(item) => item.title ?? ""}
            />
          </section>
        </div>

        <section className="analytics-block">
          <h4 className="analytics-title">换电</h4>
          <p className="analytics-swap-line">
            共 <strong>{data.swaps.count}</strong> 次 · 合计 <strong>¥{data.swaps.fee.toFixed(2)}</strong> · 平均单次{" "}
            <strong>¥{data.swaps.avgFee.toFixed(2)}</strong>
            {data.trips.chargingShare > 0 && <> · 充电行程占 {data.trips.chargingShare}%</>}
          </p>
          {data.swaps.topStations.length > 0 && (
            <ul className="analytics-stations">
              {data.swaps.topStations.map((station) => (
                <li key={station.address}>
                  <span>{station.address}</span>
                  <span className="muted">{station.count} 次</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="muted analytics-foot">
          统计时间 {new Date(data.generatedAt).toLocaleString("zh-CN")} · 数据来自本地轨迹与换电记录
        </p>
      </>
    );
  };

  return (
    <details className="trend-drawer" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>月度分析</summary>
      {open && <div className="analytics-body">{content()}</div>}
    </details>
  );
}
