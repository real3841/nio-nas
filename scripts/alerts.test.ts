import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { dispatchAlert, type AlertPayload } from "./alerts.js";

const PAYLOAD: AlertPayload = {
  event: "sync_failed",
  level: "error",
  title: "车辆同步异常",
  message: "连续 3 次采集失败",
};

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, hits: number) => void,
  fn: (url: string, hits: () => number) => Promise<void>,
): Promise<void> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    handler(req, res, count);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${port}/hook`, () => count);
  } finally {
    server.close();
  }
}

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempState(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nio-alert-"));
  tempDirs.push(dir);
  return path.join(dir, "alerts-state.json");
}

test("发送成功：JSON 带 event，状态落盘，同日第二次跳过", async () => {
  const stateFile = tempState();
  let bodies: string[] = [];
  await withServer(
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        bodies.push(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200).end("ok");
      });
    },
    async (url, hits) => {
      const first = await dispatchAlert(PAYLOAD, { webhookUrl: url, stateFile, sleep: async () => {} });
      assert.deepEqual(first.sent, ["webhook"]);
      assert.equal(JSON.parse(bodies[0]).event, "sync_failed");

      const second = await dispatchAlert(PAYLOAD, { webhookUrl: url, stateFile, sleep: async () => {} });
      assert.equal(second.skipped, "duplicate");
      assert.equal(hits(), 1);
    },
  );
  assert.ok(fs.existsSync(stateFile));
});

test("第一次 500，2 秒后重试一次成功", async () => {
  const stateFile = tempState();
  await withServer(
    (_req, res, hits) => {
      res.writeHead(hits === 1 ? 500 : 200).end("x");
    },
    async (url, hits) => {
      const result = await dispatchAlert(PAYLOAD, { webhookUrl: url, stateFile, sleep: async () => {} });
      assert.deepEqual(result.sent, ["webhook"]);
      assert.equal(hits(), 2);
    },
  );
});

test("两次都失败：报错但不阻塞", async () => {
  const stateFile = tempState();
  await withServer(
    (_req, res) => {
      res.writeHead(503).end("down");
    },
    async (url, hits) => {
      const result = await dispatchAlert(PAYLOAD, { webhookUrl: url, stateFile, sleep: async () => {} });
      assert.equal(result.sent.length, 0);
      assert.equal(result.errors.length, 1);
      assert.equal(hits(), 2);
      // 失败不占用当天的去重名额
      const again = await dispatchAlert(PAYLOAD, { webhookUrl: url, stateFile, sleep: async () => {} });
      assert.notEqual(again.skipped, "duplicate");
    },
  );
});

test("没配渠道：只记日志，不发请求", async () => {
  const logs: string[] = [];
  const result = await dispatchAlert(PAYLOAD, {
    stateFile: tempState(),
    log: (_level, message) => logs.push(message),
  });
  assert.equal(result.skipped, "unconfigured");
  assert.equal(logs.length, 1);
});

test("企业微信：发 markdown 格式", async () => {
  const stateFile = tempState();
  let body = "";
  await withServer(
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        body = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200).end("ok");
      });
    },
    async (url) => {
      const result = await dispatchAlert(PAYLOAD, { wecomUrl: url, stateFile, sleep: async () => {} });
      assert.deepEqual(result.sent, ["wecom"]);
      const parsed = JSON.parse(body) as { msgtype: string; markdown: { content: string } };
      assert.equal(parsed.msgtype, "markdown");
      assert.match(parsed.markdown.content, /车辆同步异常/);
    },
  );
});
