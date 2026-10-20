export interface SyncHealthView {
  lastSuccessAt: number | null;
  hoursSinceSuccess: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  banner: boolean;
  reason: "never" | "stale" | "failures" | null;
}

export function syncHealthText(health: SyncHealthView): string {
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

export function syncHealthDetail(health: SyncHealthView): string {
  const last =
    health.lastSuccessAt == null
      ? "从未成功"
      : new Date(health.lastSuccessAt).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  return `最近成功：${last} · 连续失败 ${health.consecutiveFailures} 次`;
}
