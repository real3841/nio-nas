import { useCallback, useEffect, useState } from "react";
import { formatFileSize } from "../lib/storage-files";
import { fmtTime } from "../lib/vehicle";

interface BackupEntry {
  bucket: "daily" | "weekly" | "monthly";
  name: string;
  size: number;
  mtime: string;
}

interface BackupList {
  ok: boolean;
  backupDir: string;
  retention: { daily: number; weekly: number; monthly: number };
  backups: BackupEntry[];
}

const BUCKET_LABEL: Record<string, string> = { daily: "日备", weekly: "周备", monthly: "月备" };

export function BackupPanel() {
  const [list, setList] = useState<BackupList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/backup/list", { cache: "no-store" });
      const body = (await res.json()) as BackupList & { error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "无法读取备份列表");
      setList(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取备份列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/backup/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "备份失败");
      setMessage(`已生成 ${body.file}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "备份失败");
    } finally {
      setRunning(false);
    }
  };

  const latest = list?.backups[0];

  return (
    <div className="sync-hub-panel-body">
      <p className="muted">
        每天 03:30 自动打包 data 目录和 deploy/.env，保留 {list?.retention.daily ?? 7} 份日备、
        {list?.retention.weekly ?? 4} 份周备、{list?.retention.monthly ?? 6} 份月备。归档带清单和校验和，
        恢复用命令行：<code>npm run backup -- restore --archive &lt;文件&gt; --to &lt;空目录&gt;</code>。
      </p>

      <div className="backup-toolbar">
        <button type="button" className="btn" onClick={() => void run()} disabled={running}>
          {running ? "备份中…" : "立即备份"}
        </button>
        <button type="button" className="btn ghost" onClick={() => void load()} disabled={running}>
          刷新列表
        </button>
        <span className="muted">
          {latest ? `最近备份 ${fmtTime(Date.parse(latest.mtime))}` : "还没有备份"}
          {list ? ` · 目录 ${list.backupDir}` : ""}
        </span>
      </div>

      {message && <p className="nas-hint">{message}</p>}
      {error && <p className="nas-error">{error}</p>}

      <div className="backup-list">
        {(list?.backups ?? []).slice(0, 12).map((b) => (
          <div className="storage-file-row" key={`${b.bucket}/${b.name}`}>
            <div className="storage-file-main">
              <span className="storage-file-label">{BUCKET_LABEL[b.bucket] ?? b.bucket}</span>
              <code className="storage-file-name">{b.name}</code>
            </div>
            <div className="storage-file-meta">
              <span>{formatFileSize(b.size)}</span>
              <span> · {fmtTime(Date.parse(b.mtime))}</span>
            </div>
            <a
              className="btn ghost"
              href={`/api/backup/download?name=${encodeURIComponent(`${b.bucket}/${b.name}`)}`}
              download
            >
              下载
            </a>
          </div>
        ))}
        {loading && <p className="muted">读取中…</p>}
        {!loading && list && list.backups.length === 0 && <p className="muted">还没有归档，点「立即备份」生成第一份。</p>}
      </div>
    </div>
  );
}
