import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const CLI = join(ROOT, "scripts", "backup.ts");

function run(args: string[], env: Record<string, string> = {}, expectFail = false) {
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (expectFail) throw new Error(`expected failure, got success: ${out}`);
    return out;
  } catch (err: any) {
    if (!expectFail) throw err;
    return String(err.stderr ?? err.stdout ?? err.message);
  }
}

/** A throwaway data dir + backup dir, both outside the repo. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "nio-backup-test-"));
  const data = join(base, "data");
  const dest = join(base, "backup");
  mkdirSync(join(data, "tracks"), { recursive: true });
  writeFileSync(join(data, "vehicle.json"), JSON.stringify({ v: 1 }));
  writeFileSync(join(data, "tracks", "2026-10.json"), JSON.stringify({ trips: 2 }));
  writeFileSync(
    join(data, "tracks-index.json"),
    JSON.stringify({ months: [{ month: "2026-10", trips: 2, km: 12.5 }] }),
  );
  const envFile = join(base, "app.env");
  writeFileSync(envFile, "NIO_VEHICLE_ACCESS_TOKEN=secret-value\n");
  return { base, data, dest, envFile };
}

function envFor(fx: ReturnType<typeof fixture>, extra: Record<string, string> = {}) {
  return {
    NIO_DATA_DIR: fx.data,
    NIO_BACKUP_DIR: fx.dest,
    NIO_ENV_FILE: fx.envFile,
    NIO_BACKUP_NOW: "2026-10-19T05:30:00Z",
    ...extra,
  };
}

function tarList(archive: string): string[] {
  return execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

test("run writes an archive containing data, env and a manifest", () => {
  const fx = fixture();
  run(["run"], envFor(fx));

  const daily = join(fx.dest, "daily");
  const files = readdirSync(daily).filter((f) => f.endsWith(".tar.gz"));
  assert.equal(files.length, 1);

  const entries = tarList(join(daily, files[0]));
  assert.ok(entries.some((e) => e.includes("data/vehicle.json")), "data present");
  assert.ok(entries.some((e) => e.includes("manifest.json")), "manifest present");
  assert.ok(!entries.some((e) => e.endsWith(".partial")), "no partial file");

  const manifest = JSON.parse(
    execFileSync("tar", ["-xzOf", join(daily, files[0]), "./manifest.json"], { encoding: "utf8" }),
  );
  assert.equal(manifest.version, 1);
  assert.ok(manifest.files.length >= 3);
  const vehicle = manifest.files.find((f: { path: string }) => f.path === "data/vehicle.json");
  assert.equal(vehicle.bytes, readFileSync(join(fx.data, "vehicle.json")).length);
  assert.match(vehicle.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.tracks.trips, 2);
});

test("list shows the archives newest first", () => {
  const fx = fixture();
  run(["run"], envFor(fx, { NIO_BACKUP_NOW: "2026-10-18T05:30:00Z" }));
  run(["run"], envFor(fx, { NIO_BACKUP_NOW: "2026-10-19T05:30:00Z" }));
  const out = run(["list"], envFor(fx));
  const names = out.split("\n").filter((l) => l.startsWith("daily/nio-backup-"));
  assert.equal(names.length, 2);
  assert.ok(names[0].includes("20261019"), "newest first");
});

test("restore rehydrates an empty directory and verifies the manifest", () => {
  const fx = fixture();
  run(["run"], envFor(fx));
  const archive = join(
    fx.dest,
    "daily",
    readdirSync(join(fx.dest, "daily")).find((f) => f.endsWith(".tar.gz"))!,
  );

  const target = join(fx.base, "restored");
  mkdirSync(target);
  run(["restore", "--archive", archive, "--to", target], envFor(fx));

  assert.equal(readFileSync(join(target, "data/vehicle.json"), "utf8"), JSON.stringify({ v: 1 }));
  assert.equal(readFileSync(join(target, "deploy/app.env"), "utf8"), "NIO_VEHICLE_ACCESS_TOKEN=secret-value\n");
});

test("restore refuses a non-empty target unless --force, and --dry-run writes nothing", () => {
  const fx = fixture();
  run(["run"], envFor(fx));
  const archive = join(
    fx.dest,
    "daily",
    readdirSync(join(fx.dest, "daily")).find((f) => f.endsWith(".tar.gz"))!,
  );

  const target = join(fx.base, "occupied");
  mkdirSync(target);
  writeFileSync(join(target, "keep.txt"), "do not touch");

  const err = run(["restore", "--archive", archive, "--to", target], envFor(fx), true);
  assert.match(err, /非空|not empty|--force/i);

  const dry = join(fx.base, "dry");
  mkdirSync(dry);
  run(["restore", "--archive", archive, "--to", dry, "--dry-run"], envFor(fx));
  assert.equal(readdirSync(dry).length, 0);
});

test("retention keeps 7 daily archives and prunes the rest", () => {
  const fx = fixture();
  mkdirSync(join(fx.dest, "daily"), { recursive: true });
  for (let i = 1; i <= 9; i++) {
    writeFileSync(join(fx.dest, "daily", `nio-backup-2026100${i}-053000.tar.gz`), "x");
  }
  run(["run"], envFor(fx));
  const kept = readdirSync(join(fx.dest, "daily")).filter((f) => f.endsWith(".tar.gz"));
  assert.equal(kept.length, 7);
  assert.ok(!existsSync(join(fx.dest, "daily", "nio-backup-20261001-053000.tar.gz")));
});
