export type StorageKind = "config" | "data" | "tracks";

export interface StorageFileLike {
  kind: StorageKind;
  exists: boolean;
  sizeBytes: number | null;
}

export interface StorageSummary {
  data: { bytes: number; count: number };
  config: { bytes: number; count: number };
  tracks: { bytes: number; count: number };
  backups: { bytes: number; count: number };
  disk: { freeBytes: number; totalBytes: number; usedPct: number };
  warnings: string[];
}

const LOW_FREE_BYTES = 2 * 1024 ** 3;

function bucket(files: StorageFileLike[], kind: StorageKind) {
  return files
    .filter((file) => file.kind === kind && file.exists && file.sizeBytes != null)
    .reduce(
      (acc, file) => ({ bytes: acc.bytes + (file.sizeBytes ?? 0), count: acc.count + 1 }),
      { bytes: 0, count: 0 },
    );
}

/** 数据/配置/轨迹/备份汇总 + 磁盘告警；纯函数，方便测试。 */
export function summarizeStorage(input: {
  files: StorageFileLike[];
  backups: Array<{ size: number }>;
  disk: { freeBytes: number; totalBytes: number };
}): StorageSummary {
  const totalBytes = Math.max(0, input.disk.totalBytes);
  const freeBytes = Math.max(0, input.disk.freeBytes);
  const usedPct = totalBytes === 0 ? 0 : Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10;

  const backups = input.backups.reduce(
    (acc, item) => ({ bytes: acc.bytes + item.size, count: acc.count + 1 }),
    { bytes: 0, count: 0 },
  );

  const warnings: string[] = [];
  if (freeBytes < LOW_FREE_BYTES) warnings.push("磁盘剩余不足 2GB");
  else if (usedPct >= 90) warnings.push("磁盘使用已超过 90%");
  if (backups.count === 0) warnings.push("还没有任何备份");

  return {
    data: bucket(input.files, "data"),
    config: bucket(input.files, "config"),
    tracks: bucket(input.files, "tracks"),
    backups,
    disk: { freeBytes, totalBytes, usedPct },
    warnings,
  };
}
