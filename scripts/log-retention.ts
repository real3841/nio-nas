const DAY_MS = 86_400_000;

/** 运行日志按天保留：只留最近 N 天的条目。 */
export function pruneLogEntries<T extends { at: number }>(entries: T[], now: number, days = 30): T[] {
  const cutoff = now - days * DAY_MS;
  return entries.filter((entry) => entry.at >= cutoff);
}
