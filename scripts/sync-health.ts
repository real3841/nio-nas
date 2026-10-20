import fs from "node:fs";
import path from "node:path";

/** 最近一次成功超过 6 小时，或连续失败 3 次，就该在页面顶部提醒。 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
export const FAILURE_STREAK = 3;

export interface SyncHealth {
  lastSuccessAt: number | null;
  hoursSinceSuccess: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  banner: boolean;
  reason: "never" | "stale" | "failures" | null;
}

export interface HealthEntry {
  slot?: string;
  level?: string;
  at?: number;
  message?: string;
}

/** 从「上次成功时间 + 最近的车况日志」算出是否需要顶部横幅。 */
export function computeSyncHealth(input: {
  now: number;
  lastSuccessAt: number | null;
  entries: HealthEntry[];
}): SyncHealth {
  const vehicle = input.entries.filter(
    (entry) => entry.slot === "vehicle" && (entry.level === "success" || entry.level === "error"),
  );

  let consecutiveFailures = 0;
  let lastError: string | null = null;
  for (let i = vehicle.length - 1; i >= 0; i -= 1) {
    const entry = vehicle[i];
    if (entry.level !== "error") break;
    consecutiveFailures += 1;
    if (!lastError) lastError = entry.message?.trim() || "抓取失败";
  }

  const hoursSinceSuccess =
    input.lastSuccessAt == null ? null : Math.max(0, (input.now - input.lastSuccessAt) / 3_600_000);

  let reason: SyncHealth["reason"] = null;
  if (input.lastSuccessAt == null) reason = "never";
  else if (hoursSinceSuccess != null && hoursSinceSuccess * 3_600_000 > STALE_AFTER_MS) reason = "stale";
  else if (consecutiveFailures >= FAILURE_STREAK) reason = "failures";

  return {
    lastSuccessAt: input.lastSuccessAt,
    hoursSinceSuccess,
    consecutiveFailures,
    lastError,
    banner: reason !== null,
    reason,
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** 读真实数据目录：vehicle.json 的修改时间 = 最近一次成功；fetch-log 的尾巴算连续失败。 */
export function readSyncHealth(dataDir: string, now = Date.now()): SyncHealth {
  const vehicleFile = path.join(dataDir, "vehicle.json");
  let lastSuccessAt: number | null = null;
  try {
    lastSuccessAt = fs.statSync(vehicleFile).mtimeMs;
  } catch {
    lastSuccessAt = null;
  }

  const log = readJson(path.join(dataDir, "fetch-log.json"));
  const entries = Array.isArray(log) ? (log as HealthEntry[]) : [];

  return computeSyncHealth({ now, lastSuccessAt, entries });
}

export function describeSyncHealth(health: SyncHealth): string {
  if (health.reason === "never") return "还没有成功采集过车辆数据";
  if (health.reason === "stale") {
    const hours = health.hoursSinceSuccess == null ? "?" : Math.floor(health.hoursSinceSuccess);
    return `已经 ${hours} 小时没有成功采集`;
  }
  if (health.reason === "failures") {
    return `连续 ${health.consecutiveFailures} 次采集失败：${health.lastError ?? "原因未知"}`;
  }
  return "采集正常";
}

/** 这三条要桌面端抓签名，NAS 看板不依赖，健康页不展示。 */
export const DESKTOP_ONLY_SLOT_IDS = new Set(["status", "journey", "daily"]);

export interface HealthViewSlot {
  id: string;
  label: string;
  ok: boolean | null;
  kind: string | null;
  error?: string | null;
}

/** /api/sync-health 的响应体：健康判断 + 轮询摘要 + 槽位状态，不暴露地址。 */
export function buildHealthView(input: {
  health: SyncHealth;
  detail: string;
  poll: { intervalSec: number; reason: string; reasonLabel: string };
  slots: Array<HealthViewSlot & Record<string, unknown>>;
}) {
  return {
    ok: true as const,
    health: input.health,
    detail: input.detail,
    poll: input.poll,
    slots: input.slots
      .filter((slot) => !DESKTOP_ONLY_SLOT_IDS.has(slot.id))
      .map((slot) => ({
        id: slot.id,
        label: slot.label,
        ok: slot.ok,
        kind: slot.kind,
        error: slot.error ?? null,
      })),
  };
}
