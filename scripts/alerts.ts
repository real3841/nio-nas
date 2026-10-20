import fs from "node:fs";
import path from "node:path";

export type AlertEvent = "token_invalid" | "sync_failed" | "backup_failed" | "test";
export type AlertLevel = "info" | "warn" | "error";

export interface AlertPayload {
  event: AlertEvent;
  level: AlertLevel;
  title: string;
  message: string;
}

export interface AlertDeps {
  webhookUrl?: string;
  wecomUrl?: string;
  /** data/alerts-state.json 的完整路径 */
  stateFile: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  /** 重试前的等待，测试里注入成 0 */
  sleep?: (ms: number) => Promise<void>;
  log?: (level: "info" | "error", message: string) => void;
}

export interface AlertResult {
  sent: string[];
  skipped: "duplicate" | "unconfigured" | null;
  errors: string[];
}

const RETRY_DELAY_MS = 2000;

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function readState(file: string): Record<string, number> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeState(file: string, state: Record<string, number>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function wecomBody(payload: AlertPayload): string {
  return JSON.stringify({
    msgtype: "markdown",
    markdown: { content: `**${payload.title}**\n${payload.message}` },
  });
}

/** 发一条告警：同日同事件只发一次；失败等 2 秒重试一次。 */
export async function dispatchAlert(payload: AlertPayload, deps: AlertDeps): Promise<AlertResult> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? (() => {});

  const webhookUrl = (deps.webhookUrl ?? "").trim();
  const wecomUrl = (deps.wecomUrl ?? "").trim();
  const result: AlertResult = { sent: [], skipped: null, errors: [] };

  if (!webhookUrl && !wecomUrl) {
    result.skipped = "unconfigured";
    log("info", `[alert] 未配置渠道，只记日志：${payload.event} ${payload.title}`);
    return result;
  }

  const ts = now();
  const state = readState(deps.stateFile);
  const key = `${payload.event}:${dayKey(ts)}`;
  if (payload.event !== "test" && state[key]) {
    result.skipped = "duplicate";
    log("info", `[alert] 今天已经发过 ${payload.event}，跳过`);
    return result;
  }

  const targets: Array<{ name: string; url: string; body: string }> = [];
  if (webhookUrl) {
    targets.push({
      name: "webhook",
      url: webhookUrl,
      body: JSON.stringify({ ...payload, ts }),
    });
  }
  if (wecomUrl) {
    targets.push({ name: "wecom", url: wecomUrl, body: wecomBody(payload) });
  }

  for (const target of targets) {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await doFetch(target.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: target.body,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        result.sent.push(target.name);
        lastError = "";
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt === 0) await sleep(RETRY_DELAY_MS);
      }
    }
    if (lastError) {
      result.errors.push(`${target.name}: ${lastError}`);
      log("error", `[alert] ${target.name} 发送失败：${lastError}`);
    }
  }

  if (result.sent.length > 0) {
    if (payload.event !== "test") {
      // 只有真发出去才占用当天的去重名额，发送失败下次还会再试。
      state[key] = ts;
      // 只保留最近 30 天的去重记录，避免状态文件无限增长。
      const cutoff = ts - 30 * 24 * 60 * 60 * 1000;
      for (const [k, at] of Object.entries(state)) if (at < cutoff) delete state[k];
      writeState(deps.stateFile, state);
    }
    log("info", `[alert] 已发送 ${payload.event} → ${result.sent.join("、")}`);
  }
  return result;
}
