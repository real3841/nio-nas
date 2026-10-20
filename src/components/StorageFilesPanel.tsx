import { useEffect, useState } from "react";
import { fmtTime } from "../lib/vehicle";
import {
  fetchStorageFiles,
  formatFileSize,
  type StorageFileEntry,
  type StorageFilesResponse,
  type StorageSummary,
} from "../lib/storage-files";

function groupFiles(files: StorageFileEntry[]): {
  config: StorageFileEntry[];
  data: StorageFileEntry[];
  tracks: StorageFileEntry[];
} {
  return {
    config: files.filter((f) => f.kind === "config"),
    data: files.filter((f) => f.kind === "data"),
    tracks: files.filter((f) => f.kind === "tracks"),
  };
}

function SummaryBar({ summary, backupDir }: { summary: StorageSummary; backupDir: string }) {
  const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return (
    <div className="storage-summary">
      <div className="storage-summary-cells">
        <div>
          <span className="muted">数据</span>
          <strong>{formatFileSize(summary.data.bytes)}</strong>
        </div>
        <div>
          <span className="muted">轨迹</span>
          <strong>{formatFileSize(summary.tracks.bytes)}</strong>
        </div>
        <div>
          <span className="muted">备份</span>
          <strong>
            {formatFileSize(summary.backups.bytes)}
            <small> · {summary.backups.count} 份</small>
          </strong>
        </div>
        <div>
          <span className="muted">磁盘剩余</span>
          <strong className={summary.disk.freeBytes < 2 * 1024 ** 3 ? "storage-warn" : undefined}>
            {gb(summary.disk.freeBytes)}
          </strong>
        </div>
      </div>
      {summary.warnings.length > 0 && (
        <ul className="storage-warnings">
          {summary.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <p className="muted storage-files-dirs">
        备份目录：<code>{backupDir}</code>
      </p>
    </div>
  );
}

function FileRow({ file }: { file: StorageFileEntry }) {
  return (
    <div className={`storage-file-row${file.exists ? "" : " missing"}`}>
      <div className="storage-file-main">
        <span className="storage-file-label">{file.label}</span>
        <code className="storage-file-name">{file.id}</code>
      </div>
      <code className="storage-file-path" title={file.path}>
        {file.path}
      </code>
      <div className="storage-file-meta">
        {file.exists ? (
          <>
            <span>{formatFileSize(file.sizeBytes)}</span>
            {file.modifiedAt != null && <span> · {fmtTime(file.modifiedAt)}</span>}
          </>
        ) : (
          <span className="muted">尚未创建</span>
        )}
      </div>
    </div>
  );
}

export function useStorageFiles() {
  const [snapshot, setSnapshot] = useState<StorageFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchStorageFiles());
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载文件列表");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const existsCount = snapshot?.files.filter((f) => f.exists).length ?? 0;
  const totalCount = snapshot?.files.length ?? 0;

  return { snapshot, error, loading, existsCount, totalCount, reload: load };
}

interface StorageFilesPanelProps {
  embedded?: boolean;
  snapshot: StorageFilesResponse | null;
  error: string | null;
  loading: boolean;
  onReload: () => void;
}

export function StorageFilesPanel({
  embedded = false,
  snapshot,
  error,
  loading,
  onReload,
}: StorageFilesPanelProps) {
  const groups = snapshot ? groupFiles(snapshot.files) : null;

  const body = (
    <>
      {loading && <p className="muted api-hint">正在读取文件列表…</p>}
      {error && (
        <p className="muted api-hint">
          {error}
          {" · "}
          <button type="button" className="btn-link" onClick={() => void onReload()}>
            重试
          </button>
        </p>
      )}

      {groups && (
        <div className="storage-files-body">
          <SummaryBar summary={snapshot!.summary} backupDir={snapshot!.backupDir} />
          <p className="muted storage-files-dirs">
            应用目录：<code>{snapshot!.userDataDir}</code>
            {" · "}
            数据目录：<code>{snapshot!.dataDir}</code>
          </p>

          <div className="storage-files-group">
            <h4 className="storage-files-group-title">配置文件</h4>
            {groups.config.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </div>

          <div className="storage-files-group">
            <h4 className="storage-files-group-title">数据与记录</h4>
            {groups.data.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </div>

          {groups.tracks.length > 0 && (
            <div className="storage-files-group">
              <h4 className="storage-files-group-title">历史轨迹（{groups.tracks.length} 个文件）</h4>
              {groups.tracks.map((file) => (
                <FileRow key={file.path} file={file} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="sync-hub-panel-body storage-files-panel-embedded">{body}</div>;
  }

  return (
    <details className="card-manager-details">
      <summary className="card-manager-summary">
        <span>本地文件</span>
        <span className="drawer-summary-meta">
          {snapshot
            ? `${snapshot.files.filter((f) => f.exists).length}/${snapshot.files.length} 个已存在`
            : "点击展开"}
        </span>
      </summary>
      <div className="sync-hub-panel-body storage-files-panel-embedded">{body}</div>
    </details>
  );
}
