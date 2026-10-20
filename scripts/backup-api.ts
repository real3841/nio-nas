/**
 * 备份的 HTTP 面与每日调度。
 *
 *   GET  /api/backup/list
 *   POST /api/backup/run
 *   GET  /api/backup/download?name=daily/nio-backup-YYYYMMDD-HHmmss.tar.gz
 *
 * 恢复刻意不开放 HTTP：只走 CLI，避免网页误操作覆盖生产数据。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "backup.ts");
const BUCKETS = ["daily", "weekly", "monthly"] as const;
const NAME_RE = /^(daily|weekly|monthly)\/nio-backup-\d{8}-\d{6}\.tar\.gz$/;

export interface BackupOptions {
  backupDir: string;
  dataDir: string;
  envFile: string;
}

interface BackupEntry {
  bucket: (typeof BUCKETS)[number];
  name: string;
  size: number;
  mtime: string;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function listBackups(backupDir: string): BackupEntry[] {
  const out: BackupEntry[] = [];
  for (const bucket of BUCKETS) {
    const dir = path.join(backupDir, bucket);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".tar.gz")) continue;
      const st = fs.statSync(path.join(dir, name));
      out.push({ bucket, name, size: st.size, mtime: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

let running: Promise<{ ok: true; file: string }> | null = null;

export function runBackup(opts: BackupOptions): Promise<{ ok: true; file: string }> {
  if (running) return running;
  const task = new Promise<{ ok: true; file: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", SCRIPT, "run"],
      {
        cwd: REPO_ROOT,
        timeout: 10 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          NIO_DATA_DIR: opts.dataDir,
          NIO_BACKUP_DIR: opts.backupDir,
          NIO_ENV_FILE: opts.envFile,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || err.message).trim().split("\n").pop() || "备份失败"));
          return;
        }
        const file = stdout.trim().split("\n")[0] ?? "";
        if (!file) {
          reject(new Error("备份进程没有返回归档路径"));
          return;
        }
        resolve({ ok: true, file: path.relative(opts.backupDir, file) });
      },
    );
  });
  running = task.finally(() => {
    running = null;
  });
  return task;
}

export async function handleBackupRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  opts: BackupOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/api/backup/")) return false;

  if (pathname === "/api/backup/list" && method === "GET") {
    json(res, 200, { ok: true, backupDir: opts.backupDir, retention: { daily: 7, weekly: 4, monthly: 6 }, backups: listBackups(opts.backupDir) });
    return true;
  }

  if (pathname === "/api/backup/run" && method === "POST") {
    try {
      const result = await runBackup(opts);
      json(res, 200, { ...result, at: Date.now() });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/backup/download" && method === "GET") {
    const name = new URL(req.url ?? "/", "http://localhost").searchParams.get("name") ?? "";
    if (!NAME_RE.test(name)) {
      json(res, 400, { ok: false, error: "非法归档名" });
      return true;
    }
    const root = path.resolve(opts.backupDir);
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      json(res, 404, { ok: false, error: "归档不存在" });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${path.basename(name)}"`,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  json(res, 404, { ok: false, error: "not_found" });
  return true;
}

/**
 * 每天 03:30（北京时间）备份一次；当天已经成功过就跳过。
 * 容器时区是 UTC，所以固定用 19:30 UTC —— 中国没有夏令时，等价于次日 03:30 CST。
 */
export function startDailyBackupScheduler(
  opts: BackupOptions,
  onError?: (err: Error) => void,
): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  // 只认「今天 19:30 UTC 之后成功过」：白天手动备份过也不能让夜间那次被跳过。
  const alreadyDone = () => {
    const stateFile = path.join(opts.dataDir, "backup-state.json");
    if (!fs.existsSync(stateFile)) return false;
    try {
      const { lastRunAt } = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { lastRunAt?: string };
      const slot = new Date();
      slot.setUTCHours(19, 30, 0, 0);
      return Boolean(lastRunAt) && new Date(lastRunAt!).getTime() >= slot.getTime();
    } catch {
      return false;
    }
  };

  const arm = () => {
    if (stopped) return;
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(19, 30, 0, 0);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    timer = setTimeout(() => {
      void (async () => {
        try {
          if (!alreadyDone()) await runBackup(opts);
          else console.log("[backup] 今天已经备份过，跳过");
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          console.error("[backup]", e.message);
          onError?.(e);
        } finally {
          arm();
        }
      })();
    }, next.getTime() - now.getTime());
    timer.unref?.();
  };

  arm();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
