/**
 * 首屏「现在有事吗」：把散落在 12 张卡里的状态压成一句话或一个短列表。
 * 纯函数，输入是从 vehicle.status 抽出来的事实，输出按严重程度排序的条目。
 */

export type AttentionTone = "hot" | "warm";

export interface AttentionItem {
  id: string;
  text: string;
  tone: AttentionTone;
  /** 点开要跳去的地方，比如更新 Token */
  action?: "token" | "settings" | "track" | null;
}

export interface AttentionInput {
  now: number;
  /** 车况采样时间（毫秒），null = 从来没拉到过 */
  sampleAt: number | null;
  moving: boolean;
  locked: boolean;
  openDoors: string[];
  openWindows: string[];
  /** 已超出正常范围的轮胎，形如「左前 2.1 bar」 */
  tyreBad: string[];
  /** 是否拿到了胎压数据（widget 模式下可能没有） */
  tyreKnown: boolean;
  /** 12V 电瓶电压，null = 没有数据 */
  lvVolt: number | null;
  maintainDue: boolean;
  defenderWarns: number;
  sync: { stale: boolean; failures: number; lastError: string | null } | null;
}

export interface AttentionResult {
  items: AttentionItem[];
  /** 没有异常时的一行说明 */
  summary: string;
}

const STALE_HOURS = 2;

function hoursAgo(now: number, at: number): number {
  return Math.max(0, Math.round((now - at) / 3_600_000));
}

export function buildAttention(input: AttentionInput): AttentionResult {
  const items: AttentionItem[] = [];

  if (input.sampleAt == null) {
    items.push({ id: "no-data", text: "还没有车况数据", tone: "hot", action: "token" });
  } else {
    const age = hoursAgo(input.now, input.sampleAt);
    if (age >= STALE_HOURS) {
      items.push({ id: "stale", text: `车况数据 ${age} 小时没更新`, tone: "hot", action: "token" });
    }
  }

  if (input.sync && input.sync.failures >= 3) {
    items.push({
      id: "sync-failed",
      text: `连续 ${input.sync.failures} 次拉取失败${input.sync.lastError ? `：${input.sync.lastError}` : ""}`,
      tone: "hot",
      action: "token",
    });
  }

  if (input.openDoors.length > 0) {
    items.push({ id: "doors", text: `${input.openDoors.join("、")} 开着`, tone: "hot", action: null });
  }

  if (!input.moving && !input.locked) {
    items.push({ id: "unlocked", text: "车没有锁", tone: "hot", action: null });
  }

  if (input.openWindows.length > 0) {
    items.push({ id: "windows", text: `${input.openWindows.join("、")} 没关`, tone: "warm", action: null });
  }

  if (input.tyreBad.length > 0) {
    items.push({ id: "tyre", text: `胎压异常：${input.tyreBad.join("、")}`, tone: "hot", action: null });
  }

  if (input.lvVolt != null) {
    if (input.lvVolt < 11.8) items.push({ id: "lv", text: `12V 电瓶 ${input.lvVolt.toFixed(1)}V，偏低`, tone: "hot", action: null });
    else if (input.lvVolt < 12.2) items.push({ id: "lv", text: `12V 电瓶 ${input.lvVolt.toFixed(1)}V`, tone: "warm", action: null });
  }

  if (input.defenderWarns > 0) {
    items.push({ id: "defender", text: `守卫模式报过 ${input.defenderWarns} 次警`, tone: "warm", action: null });
  }

  if (input.maintainDue) {
    items.push({ id: "maintain", text: "到了保养提醒", tone: "warm", action: null });
  }

  // 严重的排前面，同级保持加入顺序
  items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "hot" ? -1 : 1));

  const facts: string[] = [input.locked ? "已锁车" : input.moving ? "行驶中" : "未锁车"];
  facts.push(input.openDoors.length ? `${input.openDoors.length} 处门开着` : "车门关闭");
  if (input.openWindows.length) facts.push(`${input.openWindows.length} 处窗开着`);
  if (input.tyreKnown && input.tyreBad.length === 0) facts.push("胎压正常");
  if (input.sampleAt != null) facts.push(`${hoursAgo(input.now, input.sampleAt)} 小时前更新`);

  return {
    items,
    summary: items.length === 0 ? `一切正常 · ${facts.join(" · ")}` : "",
  };
}
