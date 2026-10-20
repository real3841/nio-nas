import { useEffect, useState } from "react";

interface AlertsEnv {
  NIO_ALERT_WEBHOOK_URL: string;
  NIO_ALERT_WECOM_URL: string;
}

const EMPTY: AlertsEnv = { NIO_ALERT_WEBHOOK_URL: "", NIO_ALERT_WECOM_URL: "" };

export function AlertsPanel() {
  const [draft, setDraft] = useState<AlertsEnv | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/config");
        const body = (await res.json()) as { ok?: boolean; alerts?: Partial<AlertsEnv> };
        if (!alive) return;
        setDraft({ ...EMPTY, ...(body.alerts ?? {}) });
      } catch {
        if (alive) setError("读不到告警配置");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/config/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `保存失败 (${res.status})`);
      setMsg("已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/alerts/test", { method: "POST" });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        result?: { sent: string[]; skipped: string | null; errors: string[] };
      };
      if (body.result?.skipped === "unconfigured") {
        setError("两个地址都还空着，先填一个并保存");
      } else if (!body.ok) {
        setError(body.result?.errors.join("；") || body.error || "发送失败");
      } else {
        setMsg(`测试消息已发送（${body.result?.sent.join("、") ?? ""}）`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="sync-hub-panel-body alerts-panel">
      <p className="muted">
        采集连续失败、Token 失效、备份失败时会推一条消息；同一天同一事件只发一次。企业微信填群机器人 Webhook 地址。
      </p>
      {!draft && !error && <p className="muted">读取中…</p>}
      {draft && (
        <>
          <label className="auth-slot-field">
            <span>通用 Webhook（任意接收端，JSON）</span>
            <input
              type="url"
              value={draft.NIO_ALERT_WEBHOOK_URL}
              placeholder="https://example.com/hooks/nio"
              onChange={(event) => setDraft({ ...draft, NIO_ALERT_WEBHOOK_URL: event.target.value })}
            />
          </label>
          <label className="auth-slot-field">
            <span>企业微信群机器人</span>
            <input
              type="url"
              value={draft.NIO_ALERT_WECOM_URL}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"
              onChange={(event) => setDraft({ ...draft, NIO_ALERT_WECOM_URL: event.target.value })}
            />
          </label>
          <div className="row backup-toolbar">
            <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? "保存中…" : "保存"}
            </button>
            <button type="button" className="btn ghost" disabled={testing} onClick={() => void sendTest()}>
              {testing ? "发送中…" : "发送测试消息"}
            </button>
          </div>
        </>
      )}
      {msg && <p className="muted">{msg}</p>}
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
