import { useEffect, useState } from "react";

interface Ledger {
  month: string;
  trips: number;
  km: number;
  prevMonth: string;
  prevKm: number;
  deltaPct: number | null;
  swaps: number;
  swapFee: number;
  perKm: number | null;
}

type State = "loading" | "ready" | "error";

function fmtMonth(month: string): string {
  const [year, m] = month.split("-");
  return `${year} 年 ${Number(m)} 月`;
}

/**
 * 首屏「这个月值不值」：里程、环比、换电次数与花费、每公里成本。
 * 口径与 AnalyticsPanel / SwapHistory 共用 /api/analytics，保证同一个数只有一种说法。
 */
export function MonthlyLedgerCard() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [state, setState] = useState<State>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch("/api/analytics", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ ledger?: Ledger }>;
      })
      .then((json) => {
        if (!alive) return;
        if (!json.ledger) throw new Error("缺少 ledger");
        setLedger(json.ledger);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state === "loading") {
    return (
      <section className="ledger-card ledger-skeleton" aria-busy="true" aria-label="本月账本加载中">
        <div className="ledger-skel-line" />
        <div className="ledger-skel-line short" />
      </section>
    );
  }

  if (state === "error" || !ledger) {
    return (
      <section className="ledger-card ledger-empty">
        <p>本月账本加载失败。</p>
        <button type="button" className="btn btn-small" onClick={() => setAttempt((n) => n + 1)}>
          重试
        </button>
      </section>
    );
  }

  const empty = ledger.trips === 0 && ledger.swaps === 0;
  if (empty) {
    return (
      <section className="ledger-card ledger-empty">
        <h2 className="ledger-month">{fmtMonth(ledger.month)}</h2>
        <p>这个月还没有形成行程记录。</p>
      </section>
    );
  }

  const delta = ledger.deltaPct;
  const deltaText = delta == null ? "上月无数据" : `${delta > 0 ? "+" : ""}${delta}%`;
  const deltaTone = delta == null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  return (
    <section className="ledger-card" aria-label="本月账本">
      <header className="ledger-head">
        <h2 className="ledger-month">{fmtMonth(ledger.month)}</h2>
        <span className={`ledger-delta ${deltaTone}`} title={`上月 ${ledger.prevMonth}：${ledger.prevKm} km`}>
          {deltaText} vs 上月
        </span>
      </header>

      <p className="ledger-hero">
        <strong>{Math.round(ledger.km).toLocaleString("zh-CN")}</strong>
        <span>km</span>
        <em>{ledger.trips} 趟</em>
      </p>

      <dl className="ledger-facts">
        <div>
          <dt>换电</dt>
          <dd>
            {ledger.swaps} 次 · ¥{ledger.swapFee.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt>每公里</dt>
          <dd>{ledger.perKm == null ? "—" : `¥${ledger.perKm.toFixed(2)}`}</dd>
        </div>
      </dl>

      <a className="ledger-link" href="/report" target="_blank" rel="noreferrer">
        看年报 →
      </a>
    </section>
  );
}

export default MonthlyLedgerCard;
