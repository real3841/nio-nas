export type RangeMode = "day" | "week" | "month" | "custom";

export interface RangeInput {
  mode: RangeMode;
  /** 锚点日期，YYYY-MM-DD（本地时区） */
  anchor: string;
  /** 自定义区间的起止，YYYY-MM-DD */
  from?: string;
  to?: string;
}

export interface ResolvedRange {
  from: number;
  to: number;
  label: string;
  months: string[];
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** 某天 00:00 的本地时间戳 */
const dayStart = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
/** 某天 23:59:59.999 的本地时间戳 */
const dayEnd = (date: Date): number => dayStart(date) + 24 * 3600 * 1000 - 1;

export function shiftAnchor(mode: RangeMode, anchor: string, delta: number): string {
  const date = parseISODate(anchor);
  if (mode === "day") date.setDate(date.getDate() + delta);
  else if (mode === "week") date.setDate(date.getDate() + delta * 7);
  else {
    date.setDate(1); // 避免 1/31 + 1 个月跳到 3 月
    date.setMonth(date.getMonth() + delta);
  }
  return toISODate(date);
}

const shortDate = (date: Date): string => `${date.getMonth() + 1}月${date.getDate()}日`;

export function resolveRange(input: RangeInput): ResolvedRange {
  const anchor = parseISODate(input.anchor);

  if (input.mode === "custom") {
    const from = dayStart(parseISODate(input.from ?? input.anchor));
    const to = dayEnd(parseISODate(input.to ?? input.anchor));
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return {
      from: start,
      to: end,
      label: `${toISODate(new Date(start))} ~ ${toISODate(new Date(end))}`,
      months: monthsBetween(start, end),
    };
  }

  if (input.mode === "day") {
    return { from: dayStart(anchor), to: dayEnd(anchor), label: `${toISODate(anchor)} 全天`, months: monthsBetween(dayStart(anchor), dayEnd(anchor)) };
  }

  if (input.mode === "week") {
    const monday = new Date(anchor);
    const offset = (monday.getDay() + 6) % 7; // 周一 = 0
    monday.setDate(monday.getDate() - offset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      from: dayStart(monday),
      to: dayEnd(sunday),
      label: `${shortDate(monday)} ~ ${shortDate(sunday)}`,
      months: monthsBetween(dayStart(monday), dayEnd(sunday)),
    };
  }

  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return {
    from: dayStart(first),
    to: dayEnd(last),
    label: `${first.getFullYear()} 年 ${first.getMonth() + 1} 月`,
    months: monthsBetween(dayStart(first), dayEnd(last)),
  };
}

/** 覆盖 [from,to] 的月份列表（YYYY-MM），按时间正序。 */
export function monthsBetween(from: number, to: number): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const stop = new Date(end.getFullYear(), end.getMonth(), 1);
  const months: string[] = [];
  while (cursor.getTime() <= stop.getTime() && months.length < 240) {
    months.push(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** 行程与区间有重叠即算（跨零点的行程不会漏）。 */
export function tripsInRange<T extends { s: number; e: number }>(trips: T[], from: number, to: number): T[] {
  return trips.filter((trip) => trip.e >= from && trip.s <= to);
}
