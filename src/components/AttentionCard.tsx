import { useEffect, useMemo, useState } from "react";
import { buildAttention, type AttentionItem } from "../lib/attention";
import type { SyncHealthView } from "../lib/sync-health";
import { statusFlagOpen, statusFlagOn, type VehicleResponse } from "../lib/vehicle";

type Status = VehicleResponse["data"]["status"];

const DOORS: { key: string; label: string }[] = [
  { key: "door_ajar_front_left_status", label: "左前门" },
  { key: "door_ajar_front_right_status", label: "右前门" },
  { key: "door_ajar_rear_left_status", label: "左后门" },
  { key: "door_ajar_rear_right_status", label: "右后门" },
  { key: "engine_hood_ajar_status", label: "前备箱" },
  { key: "tailgate_ajar_status", label: "尾门" },
  { key: "second_charge_port_ajar_status", label: "充电口" },
];

const WINDOWS: { key: string; label: string }[] = [
  { key: "win_front_left_posn", label: "左前窗" },
  { key: "win_front_right_posn", label: "右前窗" },
  { key: "win_rear_left_posn", label: "左后窗" },
  { key: "win_rear_right_posn", label: "右后窗" },
];

const TYRES: { key: string; label: string }[] = [
  { key: "front_left", label: "左前" },
  { key: "front_right", label: "右前" },
  { key: "rear_left", label: "左后" },
  { key: "rear_right", label: "右后" },
];

/** 保养：maintain_status 非 0，或维保列表里有未完成的项 */
function maintainDue(status: Status): boolean {
  const raw = (status.maintain_status ?? {}) as Record<string, unknown>;
  if (typeof raw.maintain_status === "number" && raw.maintain_status >= 1) return true;
  const list = raw.current_maintenance_list;
  return Array.isArray(list) && list.length > 0;
}

function readTyre(status: Status): { bad: string[]; known: boolean } {
  const t = (status.tyre_status ?? {}) as Record<string, unknown>;
  const known = TYRES.some(({ key }) => typeof t[`${key}_wheel_press_bar`] === "number");
  if (!known) return { bad: [], known: false };
  const bad: string[] = [];
  for (const { key, label } of TYRES) {
    const value = t[`${key}_wheel_press_bar`];
    if (typeof value !== "number") continue;
    if (value < 2.2 || value > 3.4) bad.push(`${label} ${value.toFixed(1)} bar`);
  }
  return { bad, known: true };
}

/** 12V 电瓶：不同接口字段不一样，取第一个数字 */
function readLvVolt(status: Status): number | null {
  const raw = (status.lv_batt_status ?? {}) as Record<string, unknown>;
  for (const key of ["lv_batt_voltage", "voltage", "batt_voltage", "lv_voltage"]) {
    const value = raw[key];
    if (typeof value === "number" && value > 0) return value;
  }
  return null;
}

function readSampleAt(status: Status): number | null {
  const candidates = [
    status.soc_status?.sample_time,
    status.door_status?.sample_time,
    status.exterior_status?.sample_time,
  ].filter((v): v is number => typeof v === "number" && v > 0);
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

export function AttentionCard({ status, syncHealth }: { status: Status; syncHealth: SyncHealthView | null }) {
  // 每分钟重算一次「几小时没更新」，不依赖整页刷新
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const result = useMemo(() => {
    const doorStatus = (status.door_status ?? {}) as Record<string, unknown>;
    const windowStatus = (status.window_status ?? {}) as Record<string, unknown>;
    const openDoors = DOORS.filter(({ key }) => statusFlagOpen(doorStatus[key])).map(({ label }) => label);
    const openWindows = WINDOWS.filter(({ key }) => (Number(windowStatus[key]) || 0) > 0)
      .map(({ label }) => label)
      .concat(Number(windowStatus.sun_roof_posn) > 0 ? ["天窗"] : []);
    const tyre = readTyre(status);
    return buildAttention({
      now,
      sampleAt: readSampleAt(status),
      moving: status.exterior_status?.vehicle_state === 1,
      locked: statusFlagOn(doorStatus.vehicle_lock_status),
      openDoors,
      openWindows,
      tyreBad: tyre.bad,
      tyreKnown: tyre.known,
      lvVolt: readLvVolt(status),
      maintainDue: maintainDue(status),
      defenderWarns: 0,
      sync: syncHealth
        ? {
            stale: Boolean(syncHealth.banner),
            failures: syncHealth.consecutiveFailures,
            lastError: syncHealth.lastError,
          }
        : null,
    });
  }, [status, syncHealth, now]);

  const shown = result.items.slice(0, 3);
  const rest = result.items.length - shown.length;

  return (
    <section className={`attention-card ${result.items.length === 0 ? "is-clear" : "has-issue"}`} aria-label="当前是否需要处理">
      {result.items.length === 0 ? (
        <p className="attention-clear">
          <span className="attention-dot" aria-hidden="true" />
          {result.summary}
        </p>
      ) : (
        <>
          <ul className="attention-list">
            {shown.map((item: AttentionItem) => (
              <li key={item.id} className={`attention-item ${item.tone}`}>
                <span className="attention-mark" aria-hidden="true" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && <p className="attention-more">还有 {rest} 条，见下方状态卡</p>}
        </>
      )}
    </section>
  );
}

export default AttentionCard;
