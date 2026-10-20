#!/usr/bin/env tsx
/**
 * 备份引擎：生成带清单的归档、列出归档、恢复到空目录。
 *
 *   tsx scripts/backup.ts run
 *   tsx scripts/backup.ts list
 *   tsx scripts/backup.ts restore --archive <file> --to <dir> [--force] [--dry-run]
 *
 * 目录与文件通过环境变量覆盖，测试不碰生产数据：
 *   NIO_DATA_DIR     默认 /workspace/nio-dash/data
 *   NIO_BACKUP_DIR   默认 /workspace/nio-backup
 *   NIO_ENV_FILE     默认 <repo>/deploy/.env
 *   NIO_BACKUP_NOW   固定“现在”的时刻（ISO），用于测试与演练
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(process.env.NIO_DATA_DIR || "/workspace/nio-dash/data");
const BACKUP_DIR = resolve(process.env.NIO_BACKUP_DIR || "/workspace/nio-backup");
const ENV_FILE = resolve(process.env.NIO_ENV_FILE || join(REPO_ROOT, "deploy", ".env"));
const NOW = process.env.NIO_BACKUP_NOW ? new Date(process.env.NIO_BACKUP_NOW) : new Date();

const RETENTION = { daily: 7, weekly: 4, monthly: 6 } as const;
type Bucket = keyof typeof RETENTION;

class BackupError extends Error {}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function walk(dir: string, prefix: string, out: { path: string; bytes: number; sha256: string }[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(abs, rel, out);
    else if (entry.isFile()) {
      const buf = readFileSync(abs);
      out.push({ path: rel, bytes: buf.length, sha256: sha256(buf) });
    }
  }
  return out;
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

function archiveName(now = NOW): string {
  return `nio-backup-${stamp(now)}.tar.gz`;
}

function bucketDir(bucket: Bucket): string {
  return join(BACKUP_DIR, bucket);
}

function listBucket(bucket: Bucket): string[] {
  const dir = bucketDir(bucket);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tar.gz"))
    .sort()
    .reverse();
}

function prune(bucket: Bucket) {
  const files = listBucket(bucket);
  for (const stale of files.slice(RETENTION[bucket])) {
    rmSync(join(bucketDir(bucket), stale), { force: true });
  }
}

function tracksSummary(): Record<string, number> | null {
  const index = join(DATA_DIR, "tracks-index.json");
  if (!existsSync(index)) return null;
  try {
    const data = JSON.parse(readFileSync(index, "utf8"));
    const months: Array<{ trips?: number; km?: number }> = Array.isArray(data.months) ? data.months : [];
    return {
      months: months.length,
      trips: Number(data.totalTrips ?? months.reduce((s, m) => s + Number(m.trips || 0), 0)),
      km: Number(data.totalKm ?? months.reduce((s, m) => s + Number(m.km || 0), 0)),
    };
  } catch {
    return null;
  }
}

function cmdRun() {
  if (!existsSync(DATA_DIR)) throw new BackupError(`数据目录不存在：${DATA_DIR}`);

  const lock = join(BACKUP_DIR, ".run.lock");
  if (existsSync(lock)) {
    const age = Date.now() - statSync(lock).mtimeMs;
    if (age < 10 * 60_000) throw new BackupError(`已有备份在运行（${Math.round(age / 1000)}s 前开始）`);
    rmSync(lock, { force: true });
  }
  mkdirSync(BACKUP_DIR, { recursive: true });
  writeFileSync(lock, String(process.pid));

  const staging = mkdtempSync(join(tmpdir(), "nio-backup-"));
  const target = join(bucketDir("daily"), archiveName());
  const partial = `${target}.partial`;
  try {
    cpSync(DATA_DIR, join(staging, "data"), { recursive: true });
    const config: { path: string; bytes: number; sha256: string }[] = [];
    if (existsSync(ENV_FILE)) {
      const rel = `deploy/${basename(ENV_FILE)}`;
      mkdirSync(join(staging, "deploy"), { recursive: true });
      copyFileSync(ENV_FILE, join(staging, rel));
      const buf = readFileSync(join(staging, rel));
      config.push({ path: rel, bytes: buf.length, sha256: sha256(buf) });
    }

    const files = [...walk(join(staging, "data"), "data"), ...config];
    const manifest = {
      version: 1,
      createdAt: NOW.toISOString(),
      source: { dataDir: DATA_DIR, envFile: existsSync(ENV_FILE) ? ENV_FILE : null },
      tracks: tracksSummary(),
      files,
      totalBytes: files.reduce((s, f) => s + f.bytes, 0),
    };
    writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));

    mkdirSync(bucketDir("daily"), { recursive: true });
    execFileSync("tar", ["-czf", partial, "-C", staging, "."], { stdio: "pipe" });
    renameSync(partial, target);
    rmSync(staging, { recursive: true, force: true });

    if (NOW.getUTCDay() === 0) {
      mkdirSync(bucketDir("weekly"), { recursive: true });
      copyFileSync(target, join(bucketDir("weekly"), basename(target)));
    }
    if (NOW.getUTCDate() === 1) {
      mkdirSync(bucketDir("monthly"), { recursive: true });
      copyFileSync(target, join(bucketDir("monthly"), basename(target)));
    }

    prune("daily");
    prune("weekly");
    prune("monthly");

    writeFileSync(
      join(DATA_DIR, "backup-state.json"),
      JSON.stringify({ lastRunAt: NOW.toISOString(), file: target }, null, 2),
    );

    console.log(target);
    console.log(
      `清单：${files.length} 个文件，${(manifest.totalBytes / 1024).toFixed(1)} KB` +
        (manifest.tracks ? `，轨迹 ${manifest.tracks.months} 个月 / ${manifest.tracks.trips} 趟 / ${manifest.tracks.km} km` : ""),
    );
  } catch (err) {
    rmSync(partial, { force: true });
    rmSync(staging, { recursive: true, force: true });
    throw err;
  } finally {
    rmSync(lock, { force: true });
  }
}

function cmdList() {
  for (const bucket of Object.keys(RETENTION) as Bucket[]) {
    for (const name of listBucket(bucket)) {
      const st = statSync(join(bucketDir(bucket), name));
      console.log(`${bucket}/${name}\t${st.size}\t${st.mtime.toISOString()}`);
    }
  }
}

function verifyAndCopy(archive: string, to: string, force: boolean, dryRun: boolean) {
  const staging = mkdtempSync(join(tmpdir(), "nio-restore-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", staging], { stdio: "pipe" });
    const manifestPath = join(staging, "manifest.json");
    if (!existsSync(manifestPath)) throw new BackupError("归档里没有 manifest.json，拒绝恢复");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const stagingRoot = resolve(staging) + sep;
    for (const f of manifest.files ?? []) {
      const abs = resolve(staging, f.path);
      if (!abs.startsWith(stagingRoot)) throw new BackupError(`清单里有越界路径：${f.path}`);
      if (!existsSync(abs)) throw new BackupError(`归档缺文件：${f.path}`);
      const buf = readFileSync(abs);
      if (buf.length !== f.bytes) throw new BackupError(`大小不符：${f.path}`);
      if (sha256(buf) !== f.sha256) throw new BackupError(`校验和不符：${f.path}`);
    }

    console.log(`校验通过：${manifest.files.length} 个文件（${manifest.createdAt}）`);
    if (dryRun) return;

    if (existsSync(to) && readdirSync(to).length > 0 && !force) {
      throw new BackupError(`目标目录非空：${to}（加 --force 覆盖）`);
    }
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(staging)) {
      if (entry === "manifest.json") continue;
      cpSync(join(staging, entry), join(to, entry), { recursive: true, force: true });
    }
    console.log(`已恢复到 ${to}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function cmdRestore() {
  const archive = arg("archive");
  const to = arg("to");
  if (!archive || !to) throw new BackupError("用法：restore --archive <file> --to <dir> [--force] [--dry-run]");
  if (!existsSync(archive)) throw new BackupError(`归档不存在：${archive}`);
  verifyAndCopy(resolve(archive), resolve(to), flag("force"), flag("dry-run"));
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "run") cmdRun();
  else if (cmd === "list") cmdList();
  else if (cmd === "restore") cmdRestore();
  else {
    console.error("用法：backup.ts <run|list|restore> [...]");
    process.exit(2);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof BackupError ? err.message : err);
  process.exit(1);
}
