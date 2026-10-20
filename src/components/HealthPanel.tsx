import { useCallback, useEffect, useState } from "react";

interface HealthView {
  ok: boolean;
  health: {
    lastSuccessAt: number | null;
    hoursSinceSuccess: number | null;
    consecutiveFailures: number;
    lastError: string | null;
    banner: boolean;
    reason: "never" | "stale" | "failures" | null;
  };
  detail: string;
  poll: { intervalSec: number; reason: string; reasonLabel: string };
  slots: Array<{ id: string; label: string; ok: boolean | null; kind: string | null; error: string | null }>;
}

function relative(ms: number | null): string {
  if (ms == null) return "从未成功";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${(diff / 3_600_000).toFixed(1)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function absolute(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function slotText(slot: HealthView["slots"][number]): string {
  if (slot.ok === true) return "正常";
  if (slot.ok === false) {
    if (slot.kind === "sign") return "需桌面端抓包（NAS 不使用）";
    if (slot.kind === "auth") return "登录失效";
    return slot.error?.trim() || "失败";
  }
  return "还没试过";
}

export function HealthPanel({ onOpenToken }: { onOpenToken?: () => void }) {
  const [view, setView] = useState<HealthView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-health");
      const body = (await res.json()) as HealthView;
      if (!res.ok || !body.ok) throw new Error(`HTTP ${res.status}`);
      setView(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读不到健康数据");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchNow = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/fetch-now", { method: "POST" });
      if (!res.ok) throw new Error(`拉取失败 (${res.status})`);
      setMsg("已触发一次拉取");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "拉取失败");
    } finally {
      setBusy(false);
    }
  };

  const healthy = view ? !view.health.banner : false;

  return (
    <div className="sync-hub-panel-body health-panel">
      {error && <div className="alert alert-danger">{error}</div>}
      {!view && !error && <p className="muted">读取中…</p>}
      {view && (
        <>
          <div className="health-head">
            <span className={`health-dot${healthy ? " ok" : " warn"}`} aria-hidden="true" />
            <strong>{healthy ? "采集正常" : "需要处理"}</strong>
            <span className="muted">{view.detail}</span>
          </div>

          <dl className="health-grid">
            <div>
              <dt>最近成功</dt>
              <dd>
                {relative(view.health.lastSuccessAt)}
                <small>{absolute(view.health.lastSuccessAt)}</small>
              </dd>
            </div>
            <div>
              <dt>连续失败</dt>
              <dd>{view.health.consecutiveFailures} 次</dd>
            </div>
            <div>
              <dt>下次轮询</dt>
              <dd>
                {Math.round(view.poll.intervalSec / 60)} 分钟
                <small>{view.poll.reasonLabel}</small>
              </dd>
            </div>
            <div>
              <dt>最近错误</dt>
              <dd className="health-error">{view.health.lastError ?? "无"}</dd>
            </div>
          </dl>

          <ul className="health-slots">
            {view.slots.map((slot) => (
              <li key={slot.id}>
                <span className={`health-dot${slot.ok === false ? " warn" : slot.ok ? " ok" : ""}`} aria-hidden="true" />
                <span className="health-slot-label">{slot.label}</span>
                <span className={slot.ok === false ? "health-error" : "muted"}>{slotText(slot)}</span>
              </li>
            ))}
          </ul>

          <div className="row backup-toolbar">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void fetchNow()}>
              {busy ? "拉取中…" : "立即拉取一次"}
            </button>
            <button type="button" className="btn ghost" onClick={() => void load()}>
              刷新
            </button>
            {onOpenToken && !healthy && (
              <button type="button" className="btn ghost" onClick={onOpenToken}>
                更新 Token
              </button>
            )}
          </div>
          {msg && <p className="muted">{msg}</p>}
        </>
      )}
    </div>
  );
}
