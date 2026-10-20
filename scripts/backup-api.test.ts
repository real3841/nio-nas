import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleBackupRequest, listBackups } from "./backup-api";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "nio-backup-api-"));
  const data = join(base, "data");
  const backupDir = join(base, "backup");
  const envFile = join(base, "app.env");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(backupDir, "daily"), { recursive: true });
  writeFileSync(join(data, "vehicle.json"), "{}");
  writeFileSync(envFile, "A=1\n");
  return { base, data, backupDir, envFile };
}

async function serve(opts: { backupDir: string; dataDir: string; envFile: string }) {
  const server = createServer((req, res) => {
    void (async () => {
      const pathname = (req.url ?? "/").split("?")[0];
      const handled = await handleBackupRequest(req, res, pathname, req.method ?? "GET", opts);
      if (!handled) res.writeHead(404).end();
    })();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("list returns archives newest first with bucket and size", async () => {
  const fx = fixture();
  writeFileSync(join(fx.backupDir, "daily", "nio-backup-20261018-033000.tar.gz"), "old");
  writeFileSync(join(fx.backupDir, "daily", "nio-backup-20261019-033000.tar.gz"), "newer");

  const entries = listBackups(fx.backupDir);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "nio-backup-20261019-033000.tar.gz");

  const s = await serve({ backupDir: fx.backupDir, dataDir: fx.data, envFile: fx.envFile });
  try {
    const body = await (await fetch(`${s.base}/api/backup/list`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.retention.daily, 7);
    assert.equal(body.backups.length, 2);
  } finally {
    await s.close();
  }
});

test("download serves a known archive and rejects traversal-ish names", async () => {
  const fx = fixture();
  const name = "nio-backup-20261019-033000.tar.gz";
  writeFileSync(join(fx.backupDir, "daily", name), "archive-bytes");
  const s = await serve({ backupDir: fx.backupDir, dataDir: fx.data, envFile: fx.envFile });
  try {
    const ok = await fetch(`${s.base}/api/backup/download?name=daily/${name}`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "archive-bytes");
    assert.match(ok.headers.get("content-disposition") ?? "", /attachment/);

    for (const bad of ["daily/../app.env", "/etc/passwd", "daily/nope.tar.gz", "daily/" + name.replace(".tar.gz", ".zip")]) {
      const r = await fetch(`${s.base}/api/backup/download?name=${encodeURIComponent(bad)}`);
      assert.ok([400, 404].includes(r.status), `${bad} -> ${r.status}`);
    }
  } finally {
    await s.close();
  }
});

test("run creates a real archive through the CLI", async () => {
  const fx = fixture();
  const s = await serve({ backupDir: fx.backupDir, dataDir: fx.data, envFile: fx.envFile });
  try {
    const r = await fetch(`${s.base}/api/backup/run`, { method: "POST" });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.match(body.file, /daily\/nio-backup-\d{8}-\d{6}\.tar\.gz$/);
    assert.ok(existsSync(join(fx.backupDir, body.file)));
    const files = readdirSync(join(fx.backupDir, "daily"));
    assert.ok(files.every((f) => !f.endsWith(".partial")));
  } finally {
    await s.close();
  }
});
