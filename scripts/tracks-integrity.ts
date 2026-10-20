import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";

export interface TrackMonthStat {
  month: string;
  trips: number;
  km: number;
  points: number;
  bytes: number;
  mtime: number;
}

export interface TracksIndex {
  generatedAt: string;
  months: Array<{ month: string; trips: number; km: number; points: number }>;
  totalTrips: number;
  totalKm: number;
  totalPoints: number;
}

export interface IntegrityCheck {
  needsRebuild: boolean;
  reasons: string[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 扫描数据目录里的轨迹月文件，算出真实统计。 */
export function scanTrackFiles(dataDir: string): TrackMonthStat[] {
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(dataDir)
      .filter((name) => /^tracks-\d{4}-\d{2}\.json$/.test(name))
      .sort();
  } catch {
    return [];
  }

  const months: TrackMonthStat[] = [];
  for (const name of names) {
    const filePath = path.join(dataDir, name);
    try {
      const stat = fs.statSync(filePath);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        month?: string;
        trips?: Array<{ k?: number; p?: unknown[] }>;
      };
      const trips = Array.isArray(data.trips) ? data.trips : [];
      const month = data.month ?? name.slice("tracks-".length, "tracks-".length + 7);
      months.push({
        month,
        trips: trips.length,
        km: round1(trips.reduce((sum, trip) => sum + (trip.k ?? 0), 0)),
        points: trips.reduce((sum, trip) => sum + (trip.p?.length ?? 0), 0),
        bytes: stat.size,
        mtime: stat.mtimeMs,
      });
    } catch {
      // 坏文件跳过，由 compareIndex 的“缺月”逻辑发现
    }
  }
  return months;
}

export function indexFromTracks(months: TrackMonthStat[], now = Date.now()): TracksIndex {
  const slim = months.map(({ month, trips, km, points }) => ({ month, trips, km, points }));
  return {
    generatedAt: new Date(now).toISOString(),
    months: slim,
    totalTrips: slim.reduce((sum, item) => sum + item.trips, 0),
    totalKm: round1(slim.reduce((sum, item) => sum + item.km, 0)),
    totalPoints: slim.reduce((sum, item) => sum + item.points, 0),
  };
}

/** 对比索引与磁盘，列出所有需要重建的理由。 */
export function compareIndex(
  index: Partial<TracksIndex> | null,
  scanned: TrackMonthStat[],
): IntegrityCheck {
  const reasons: string[] = [];
  if (scanned.length === 0) {
    return { needsRebuild: false, reasons: [] };
  }
  const indexMonths = Array.isArray(index?.months) ? index!.months! : [];
  if (index == null || indexMonths.length === 0) {
    reasons.push("没有索引（或索引为空）");
    return { needsRebuild: true, reasons };
  }

  const byDisk = new Map(scanned.map((month) => [month.month, month]));
  const byIndex = new Map(indexMonths.map((month) => [month.month, month]));

  for (const month of byIndex.keys()) {
    if (!byDisk.has(month)) reasons.push(`索引里有、磁盘上没有：${month}`);
  }
  for (const month of byDisk.keys()) {
    if (!byIndex.has(month)) reasons.push(`磁盘上有、索引里没有：${month}`);
  }

  for (const [month, disk] of byDisk) {
    const indexed = byIndex.get(month);
    if (!indexed) continue;
    if (indexed.trips !== disk.trips) {
      reasons.push(`${month} 行程数不一致：索引 ${indexed.trips} / 实际 ${disk.trips}`);
    }
    if (Math.abs(indexed.km - disk.km) > 0.15) {
      reasons.push(`${month} 里程不一致：索引 ${indexed.km} / 实际 ${disk.km}`);
    }
    if (indexed.points !== disk.points) {
      reasons.push(`${month} 轨迹点数不一致：索引 ${indexed.points} / 实际 ${disk.points}`);
    }
  }

  const newest = scanned.reduce((max, month) => Math.max(max, month.mtime), 0);
  const generatedAt = index.generatedAt ? Date.parse(index.generatedAt) : 0;
  if (!Number.isFinite(generatedAt) || generatedAt < newest) {
    reasons.push("索引比最新的月文件旧");
  }

  return { needsRebuild: reasons.length > 0, reasons };
}

export interface IntegrityReport {
  ok: true;
  rebuilt: boolean;
  reasons: string[];
  months: TrackMonthStat[];
  totals: { trips: number; km: number; points: number };
  generatedAt: string;
}

function readIndexFile(dataDir: string): TracksIndex | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "tracks-index.json"), "utf8")) as TracksIndex;
  } catch {
    return null;
  }
}

/** 检查并在需要时重建 tracks-index.json。返回报告（含重建原因）。 */
export function ensureTracksIndex(dataDir: string, options: { force?: boolean; now?: number } = {}): IntegrityReport {
  const now = options.now ?? Date.now();
  const scanned = scanTrackFiles(dataDir);
  const existing = readIndexFile(dataDir);
  const check = compareIndex(existing, scanned);
  const rebuilt = options.force === true || check.needsRebuild;

  if (rebuilt) {
    writeFileAtomic(path.join(dataDir, "tracks-index.json"), JSON.stringify(indexFromTracks(scanned, now)));
  }

  const totals = {
    trips: scanned.reduce((sum, month) => sum + month.trips, 0),
    km: round1(scanned.reduce((sum, month) => sum + month.km, 0)),
    points: scanned.reduce((sum, month) => sum + month.points, 0),
  };

  return {
    ok: true,
    rebuilt,
    reasons: options.force === true && check.reasons.length === 0 ? ["手动重建"] : check.reasons,
    months: scanned,
    totals,
    generatedAt: new Date(now).toISOString(),
  };
}
