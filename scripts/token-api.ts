import type http from "node:http";

export interface TokenUpdateDeps {
  /** 把 Bearer 写进 .env；返回是否成功与提示 */
  update: (token: string) => { ok: boolean; warnings: string[] };
  /** 触发一次抓取，失败时抛出错误（消息会展示给用户） */
  trigger: (target: "vehicle" | "change") => Promise<unknown>;
  /** 当前各槽位状态，更新后立刻回报 */
  slots: () => Array<{ id: string; ok: boolean | null; kind: string | null; error?: string | null }>;
}

export interface TokenUpdateResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_BODY = 8 * 1024;

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("请求体太大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 一步更新：写 Token → 立刻试拉车况与换电 → 返回逐槽位结果。 */
export async function runTokenUpdate(token: string, deps: TokenUpdateDeps): Promise<TokenUpdateResult> {
  const updated = deps.update(token);
  if (!updated.ok) {
    return { status: 400, body: { ok: false, error: updated.warnings[0] ?? "没有认出 Bearer Token" } };
  }

  const runs: Record<string, string> = {};
  for (const target of ["vehicle", "change"] as const) {
    try {
      await deps.trigger(target);
      runs[target] = "ok";
    } catch (err) {
      runs[target] = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      tokenUpdated: true,
      runs,
      slots: deps.slots(),
      warnings: updated.warnings,
    },
  };
}

/** 处理 POST /api/token/update；不是这个请求就返回 false。 */
export async function handleTokenUpdateRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: TokenUpdateDeps,
): Promise<boolean> {
  const raw = await readBody(req);
  let token = "";
  try {
    const body = JSON.parse(raw || "{}") as { token?: unknown };
    token = typeof body.token === "string" ? body.token : "";
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "请求格式不对" }));
    return true;
  }

  const result = await runTokenUpdate(token, deps);
  res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(result.body));
  return true;
}
