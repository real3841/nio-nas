import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyBareToken } from "./quick-auth.js";
import { handleTokenUpdateRequest, runTokenUpdate } from "./token-api.js";

const TOKEN = "2.01v7" + "a".repeat(42);

test("写入 Bearer 后立即试拉车况与换电，并回报槽位", async () => {
  const calls: string[] = [];
  const result = await runTokenUpdate("Bearer " + TOKEN, {
    update: (token) => {
      calls.push("update:" + token.slice(0, 5));
      return { ok: true, warnings: [] };
    },
    trigger: async (target) => {
      calls.push("trigger:" + target);
    },
    slots: () => [
      { id: "widget", ok: true, kind: null },
      { id: "change", ok: true, kind: null },
      { id: "checkin", ok: false, kind: "auth" },
    ],
  });

  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["update:Beare", "trigger:vehicle", "trigger:change"]);
  const slots = (result.body as { slots: Array<{ id: string }> }).slots;
  assert.deepEqual(slots.map((s) => s.id), ["widget", "change", "checkin"]);
});

test("Token 不合法时返回 400 且不触发抓取", async () => {
  let triggered = false;
  const result = await runTokenUpdate("x", {
    update: () => ({ ok: false, warnings: ["没认出 Bearer"] }),
    trigger: async () => {
      triggered = true;
    },
    slots: () => [],
  });
  assert.equal(result.status, 400);
  assert.equal(triggered, false);
});

test("HTTP 面：POST /api/token/update 返回逐槽位结果", async () => {
  const server = http.createServer((req, res) => {
    void handleTokenUpdateRequest(req, res, {
      update: () => ({ ok: true, warnings: [] }),
      trigger: async () => {},
      slots: () => [{ id: "widget", ok: false, kind: "auth", error: "401" }],
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/token/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; slots: Array<{ kind: string }> };
    assert.equal(body.ok, true);
    assert.equal(body.slots[0].kind, "auth");
  } finally {
    server.close();
  }
});

test("applyBareToken 原子写入 .env、600 权限、置 widget 模式", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nio-token-"));
  const envFile = path.join(dir, "deploy", ".env");
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, "NIO_VEHICLE_API_MODE=url\nNIO_CHECKIN_ACCESS_TOKEN=\n", "utf8");
  const prev = process.env.NIO_ENV_FILE;
  process.env.NIO_ENV_FILE = envFile;
  try {
    const result = applyBareToken(TOKEN);
    assert.equal(result.ok, true);
    const content = fs.readFileSync(envFile, "utf8");
    assert.match(content, /NIO_VEHICLE_ACCESS_TOKEN=2\.01v7/);
    assert.match(content, /NIO_VEHICLE_API_MODE=widget/);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    assert.deepEqual(
      fs.readdirSync(path.dirname(envFile)).filter((f) => f.includes(".tmp-")),
      [],
    );
  } finally {
    if (prev === undefined) delete process.env.NIO_ENV_FILE;
    else process.env.NIO_ENV_FILE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
