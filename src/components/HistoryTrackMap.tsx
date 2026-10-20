import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { fetchEnvConfig } from "../lib/env-config";
import { mapCoordsForProvider } from "../lib/gcj02";
import { saveDrawerOpen } from "../lib/drawer-state";
import { aggregateFlows, aggregateStations, type Station } from "../lib/track-aggregate";
import { resolveRange, shiftAnchor, toISODate, tripsInRange, type RangeMode } from "../lib/track-range";
import {
  AMAP_ROAD_URL,
  BASEMAPS,
  BASEMAP_REFERENCE_URL,
  mapTileFromEnv,
  resolveBasemap,
  type BasemapId,
  type MapTileConfig,
} from "../lib/map-tiles";
import { isNativeApp } from "../platform/transport";
import TrailCanvas from "./TrailCanvas";
import DotCloud from "./DotCloud";
import { buildPath, headAt } from "../lib/track-trail";

const TRACK_DRAWER_KEY = "nio-track-history-drawer";

/** 轨迹点：[经度, 纬度, 时间戳]，原始值为 GCJ-02 */
type Pt = [number, number, number];

interface TrackTrip {
  s: number;
  e: number;
  k: number;
  c: number;
  p: Pt[];
}

interface MonthFile {
  month: string;
  trips: TrackTrip[];
}

interface MonthMeta {
  month: string;
  trips: number;
  km: number;
  points: number;
}

interface TrackIndex {
  generatedAt: string;
  months: MonthMeta[];
  totalTrips: number;
  totalKm: number;
  totalPoints: number;
}

interface TrackSyncStatus {
  running: boolean;
  month: string | null;
  done: number;
  total: number;
  lastError: string | null;
  finishedAt: number | null;
}

/** 深色底图：Esri 的 Dark Gray，不需要 Key。subdomains 必须给，否则 Leaflet 取子域时会崩 */

/** 深色 / 浅色下的默认配色 */
const COLOR_DARK = "#ff5ec8";
const COLOR_DOT_DARK = "#ff8ada";
const COLOR_LIGHT = "#0091b3";
const COLOR_DOT_LIGHT = "#00b8d4";

/** 可选轨迹配色：深色底图上道路偏橙，这些颜色区分度较高 */
const PALETTE: { id: string; label: string; line: string; dot: string }[] = [
  { id: "pink", label: "粉红", line: "#ff5ec8", dot: "#ff8ada" },
  { id: "cyan", label: "青色", line: "#22d3ee", dot: "#67e8f9" },
  { id: "green", label: "亮绿", line: "#4ade80", dot: "#86efac" },
  { id: "amber", label: "橙黄", line: "#fbbf24", dot: "#fcd34d" },
  { id: "violet", label: "紫色", line: "#a78bfa", dot: "#c4b5fd" },
  { id: "red", label: "朱红", line: "#fb7185", dot: "#fda4af" },
  { id: "china", label: "中国红", line: "#e60012", dot: "#ff4d4f" },
  { id: "white", label: "雪白", line: "#f8fafc", dot: "#e2e8f0" },
];

const COLOR_KEY = "nio-track-color";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${path}?_=${Date.now()}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function TrackLayer({
  trips,
  mode,
  tileConfig,
  boundsKey,
  light,
  lineColor,
  dotColor,
}: {
  trips: TrackTrip[];
  mode: "line" | "dot";
  tileConfig: MapTileConfig;
  boundsKey: string;
  light: boolean;
  lineColor: string;
  dotColor: string;
}) {
  const map = useMap();
  const fitted = useRef<string>("");
  const isLight = light;
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [map]);

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.3 });
    const group = L.layerGroup().addTo(map);
    const bounds: L.LatLng[] = [];

    for (const trip of trips) {
      if (trip.p.length < 2) continue;
      const latlngs: [number, number][] = [];
      for (const p of trip.p) {
        const mapped = mapCoordsForProvider(p[1], p[0], tileConfig.provider);
        latlngs.push([mapped.lat, mapped.lng]);
      }

      if (mode === "line") {
        // 放大后线也要跟着变粗，否则单条线在高倍下会显得比低倍更淡
        const boost = zoom >= 15 ? 1.7 : zoom >= 13 ? 1.4 : 1;
        L.polyline(latlngs, {
          renderer,
          color: lineColor,
          weight: 2 * boost,
          opacity: isLight ? 0.8 : 0.62,
          interactive: false,
        }).addTo(group);
      } else {
        const step = Math.max(1, Math.ceil(latlngs.length / 160));
        for (let i = 0; i < latlngs.length; i += step) {
          L.circleMarker(latlngs[i], {
            renderer,
            radius: 1.4,
            stroke: false,
            fillColor: dotColor,
            fillOpacity: isLight ? 0.8 : 0.6,
            interactive: false,
          }).addTo(group);
        }
      }

      for (let i = 0; i < latlngs.length; i += Math.max(1, Math.floor(latlngs.length / 10))) {
        bounds.push(L.latLng(latlngs[i]));
      }
    }

    if (trips.length === 0) return () => void map.removeLayer(group);

    if (bounds.length && fitted.current !== boundsKey) {
      fitted.current = boundsKey;
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
    }

    return () => {
      map.removeLayer(group);
    };
  }, [map, trips, mode, tileConfig.provider, boundsKey, isLight, lineColor, dotColor, zoom]);

  return null;
}

/** 常去站点：圆圈大小按到访次数；可叠加高频起终点连线。 */
function StationLayer({
  stations,
  flows,
  tileConfig,
  light,
  showFlows,
}: {
  stations: Station[];
  flows: ReturnType<typeof aggregateFlows>;
  tileConfig: MapTileConfig;
  light: boolean;
  showFlows: boolean;
}) {
  const map = useMap();
  const fitted = useRef("");

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const bounds: L.LatLng[] = [];
    const max = Math.max(1, ...stations.map((station) => station.count));

    for (const flow of flows) {
      if (!showFlows) break;
      const from = mapCoordsForProvider(flow.from.lat, flow.from.lng, tileConfig.provider);
      const to = mapCoordsForProvider(flow.to.lat, flow.to.lng, tileConfig.provider);
      L.polyline(
        [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
        {
          color: "#22d3ee",
          weight: Math.min(6, 1 + flow.count * 0.8),
          opacity: light ? 0.35 : 0.28,
          interactive: false,
        },
      ).addTo(group);
    }

    for (const station of stations) {
      const mapped = mapCoordsForProvider(station.lat, station.lng, tileConfig.provider);
      const radius = 5 + Math.round(Math.sqrt(station.count / max) * 14);
      L.circleMarker([mapped.lat, mapped.lng], {
        radius,
        color: "#2563eb",
        weight: 2,
        fillColor: "#38bdf8",
        fillOpacity: 0.45,
      })
        .bindTooltip(`${station.count} 次起/终`, { direction: "top", offset: [0, -6] })
        .addTo(group);
      bounds.push(L.latLng(mapped.lat, mapped.lng));
    }

    const key = stations.map((station) => station.key).join("|");
    if (bounds.length && fitted.current !== key) {
      fitted.current = key;
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
    }

    return () => {
      map.removeLayer(group);
    };
  }, [map, stations, flows, tileConfig.provider, light, showFlows]);

  return null;
}

/** 回放：canvas 负责画，这里只在区间/单趟变化时把视野罩住。 */
function PlaybackLayer({
  path,
  progress,
  light,
  color,
  follow,
  followZoom,
  playing,
  fitKey,
}: {
  path: ReturnType<typeof buildPath>;
  progress: number;
  light: boolean;
  color: string;
  follow: boolean;
  followZoom: number;
  playing: boolean;
  fitKey: string;
}) {
  const map = useMap();
  const fitted = useRef("");

  useEffect(() => {
    if (!path.lines.length || fitted.current === fitKey) return;
    fitted.current = fitKey;
    const bounds: L.LatLngExpression[] = [];
    for (const line of path.lines) for (const p of line) bounds.push([p.lat, p.lng]);
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
  }, [map, path, fitKey]);

  return <TrailCanvas path={path} progress={progress} light={light} color={color} follow={follow} followZoom={followZoom} playing={playing} />;
}

export function HistoryTrackMap({ embedded = false }: { embedded?: boolean }) {
  const [openState, setOpenState] = useState(false);
  const open = embedded || openState;

  const [index, setIndex] = useState<TrackIndex | null>(null);
  const [months, setMonths] = useState<Record<string, TrackTrip[]>>({});
  const [active, setActive] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"line" | "dot" | "stations" | "playback">("line");
  // 回放进度 0..1，按「走过的路」推进，不按墙钟 —— 原地停车不占时间
  const [playP, setPlayP] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [durationSec, setDurationSec] = useState(45);
  const [follow, setFollow] = useState(false);
  const [followZoom, setFollowZoom] = useState(0);
  const [focusTrip, setFocusTrip] = useState<TrackTrip | null>(null);
  const resumeAfterDrag = useRef(false);
  const [showFlows, setShowFlows] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>("day");
  const [anchor, setAnchor] = useState<string>(() => toISODate(new Date()));
  const [customFrom, setCustomFrom] = useState<string>(() => toISODate(new Date(Date.now() - 6 * 864e5)));
  const [customTo, setCustomTo] = useState<string>(() => toISODate(new Date()));
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "ready">("idle");
  const [appTiles, setAppTiles] = useState<MapTileConfig>(() => mapTileFromEnv({}));
  const [useDark, setUseDark] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>(() => {
    try {
      const saved = localStorage.getItem("nio-track-basemap");
      if (saved && BASEMAPS.some((item) => item.id === saved)) return saved as BasemapId;
    } catch {
      /* ignore */
    }
    return "auto";
  });
  const pickBasemap = (id: BasemapId) => {
    setBasemap(id);
    try {
      localStorage.setItem("nio-track-basemap", id);
    } catch {
      /* ignore */
    }
  };
  const [colorId, setColorId] = useState<string>(() => {
    try {
      return localStorage.getItem(COLOR_KEY) ?? "auto";
    } catch {
      return "auto";
    }
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [syncStatus, setSyncStatus] = useState<TrackSyncStatus | null>(null);

  /** 应用设置里解析出的浅色底图（高德或 OSM）。深色如何处理由 base 决定 */
  const tileConfig = appTiles;

  useEffect(() => {
    if (!open) return;
    const load = () => {
      void fetchEnvConfig()
        .then((cfg) => setAppTiles(mapTileFromEnv(cfg.map)))
        .catch(() => setAppTiles(mapTileFromEnv({})));
    };
    load();
    window.addEventListener("nio-map-config-updated", load);
    return () => window.removeEventListener("nio-map-config-updated", load);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("loading");
    setIndex(null);
    setMonths({});
    void (async () => {
      const idx = await fetchJson<TrackIndex>("/data/tracks-index.json");
      if (cancelled) return;
      if (!idx || !idx.months?.length) {
        setStatus("empty");
        return;
      }
      setIndex(idx);
      const latest = idx.months[idx.months.length - 1].month;
      const today = toISODate(new Date());
      setAnchor(today.startsWith(latest) ? today : `${latest}-15`);
      setActive(new Set([latest]));
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reloadToken]);

  // 原生模式下轮询同步进度；结束后刷新索引
  useEffect(() => {
    if (!open || !isNativeApp()) return;
    let timer = 0;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/tracks/status?_=${Date.now()}`);
        if (res.ok) {
          const next = (await res.json()) as TrackSyncStatus;
          if (cancelled) return;
          setSyncStatus((prev) => {
            if (prev?.running && !next.running) setReloadToken((v) => v + 1);
            return next;
          });
        }
      } catch {
        // 忽略，下一轮重试
      }
      if (!cancelled) timer = window.setTimeout(poll, 2500);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    for (const month of active) {
      if (months[month]) continue;
      void (async () => {
        const file = await fetchJson<MonthFile>(`/data/tracks-${month}.json`);
        if (!file) return;
        setMonths((prev) => (prev[month] ? prev : { ...prev, [month]: file.trips }));
      })();
    }
  }, [open, active, months]);

  const startSync = async (monthCount: number) => {
    try {
      const res = await fetch("/api/tracks/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: monthCount, refreshCurrent: true }),
      });
      if (res.ok) setSyncStatus((await res.json()) as TrackSyncStatus);
    } catch {
      // 忽略
    }
  };

  const range = useMemo(
    () => resolveRange({ mode: rangeMode, anchor, from: customFrom, to: customTo }),
    [rangeMode, anchor, customFrom, customTo],
  );

  const windowMonths = useMemo(() => {
    const available = new Set((index?.months ?? []).map((m) => m.month));
    return range.months.filter((month) => available.has(month));
  }, [range.months, index]);
  const windowKey = windowMonths.join(",");

  // 区间变化 → 只加载覆盖这个区间的月份
  useEffect(() => {
    if (!windowKey) return;
    setActive(new Set(windowKey.split(",")));
  }, [windowKey]);

  const allTrips = useMemo(() => {
    const out: TrackTrip[] = [];
    for (const month of active) out.push(...(months[month] ?? []));
    return out;
  }, [active, months]);

  // 行程时间是 epoch 秒，区间是毫秒
  const trips = useMemo(
    () => tripsInRange(allTrips, range.from / 1000, range.to / 1000),
    [allTrips, range],
  );

  const shown = useMemo(() => {
    let km = 0;
    let points = 0;
    for (const t of trips) {
      km += t.k ?? 0;
      points += t.p.length;
    }
    return { km, points };
  }, [trips]);

  const boundsKey = useMemo(() => [...active].sort().join(","), [active]);

  const stations = useMemo(() => aggregateStations(trips), [trips]);
  const flows = useMemo(() => aggregateFlows(trips), [trips]);

  const playRange = useMemo(() => {
    if (trips.length === 0) return null;
    const start = Math.min(...trips.map((trip) => trip.s));
    const end = Math.max(...trips.map((trip) => trip.e));
    return { start, end };
  }, [trips]);

  // 换区间就把播放头归零
  useEffect(() => {
    setPlayP(null);
    setPlaying(false);
    setFocusTrip(null);
  }, [range.from, range.to]);

  // 进入回放自动播放；播放头在区间外时回到起点
  useEffect(() => {
    if (view !== "playback") {
      setPlaying(false);
      return;
    }
    if (!playRange) return;
    setPlayP((prev) => (prev == null || prev >= 1 ? 0 : prev));
    setPlaying(true);
  }, [view, playRange]);

  // 回放时钟：按「选定的总时长」走完，和区间长短无关
  useEffect(() => {
    if (!playing || !playRange) return;
    const step = 50 / (durationSec * 1000);
    const timer = window.setInterval(() => {
      setPlayP((prev) => {
        const next = (prev ?? 0) + step;
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, playRange, durationSec]);


  const segStyle = (on: boolean): React.CSSProperties => ({
    background: on ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.05)",
    border: 0,
    color: on ? "#e8ecf4" : "#8b93a7",
    borderRadius: 7,
    padding: "5px 12px",
    fontSize: 11,
    cursor: "pointer",
  });

  const syncing = Boolean(syncStatus?.running);
  /** 高德底图 + 深色：给栅格瓦片加反色滤镜，保留中文路名 */
  const hasAmapKey = tileConfig.provider === "amap";
  const base = resolveBasemap(basemap, hasAmapKey, useDark);
  const darkAmap = useDark && base.provider === "amap";

  // 单趟聚焦时只放这一趟
  const displayTrips = useMemo(() => (focusTrip ? [focusTrip] : trips), [focusTrip, trips]);
  const trailPath = useMemo(() => buildPath(displayTrips, base.provider), [displayTrips, base.provider]);
  const head = playP != null ? headAt(trailPath, playP) : null;
  const playedKm = playP != null ? (playP * trailPath.total) / 1000 : 0;
  const totalKm = trailPath.total / 1000;
  const tripIndex = useMemo(() => {
    if (playP == null) return 0;
    const target = playP * trailPath.total;
    let done = 0;
    for (const line of trailPath.lines) {
      if (line[line.length - 1].cum <= target) done += 1;
      else break;
    }
    return Math.min(trailPath.lines.length, done + 1);
  }, [playP, trailPath]);
  const rangeTrips = useMemo(() => [...trips].sort((a, b) => a.s - b.s), [trips]);

  const preset = PALETTE.find((item) => item.id === colorId);
  const lineColor = preset?.line ?? (useDark ? COLOR_DARK : COLOR_LIGHT);
  const dotColor = preset?.dot ?? (useDark ? COLOR_DOT_DARK : COLOR_DOT_LIGHT);

  const pickColor = (id: string) => {
    setColorId(id);
    try {
      if (id === "auto") localStorage.removeItem(COLOR_KEY);
      else localStorage.setItem(COLOR_KEY, id);
    } catch {
      // 忽略存储失败
    }
  };

  const body = (
    <>
      {status === "empty" && (
        <div className="muted" style={{ padding: "10px 0" }}>
          <p style={{ margin: "0 0 10px" }}>还没有轨迹数据。</p>
          {isNativeApp() ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void startSync(1)} style={segStyle(false)}>
                抓取当月
              </button>
              <button type="button" onClick={() => void startSync(60)} style={segStyle(false)}>
                补全全部历史
              </button>
            </div>
          ) : (
            <p style={{ margin: 0 }}>
              在项目目录运行 <code>npm run tracks:fetch</code> 抓取后重新打开。
            </p>
          )}
        </div>
      )}

      {status === "loading" && <p className="muted">读取轨迹索引…</p>}

      {index && (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "10px 0 0" }}>
            {isNativeApp() ? (
              <>
                <button
                  type="button"
                  onClick={() => void startSync(1)}
                  disabled={syncing}
                  style={{ ...segStyle(false), opacity: syncing ? 0.5 : 1 }}
                >
                  {syncing ? "抓取中…" : "刷新当月"}
                </button>
                <button
                  type="button"
                  onClick={() => void startSync(60)}
                  disabled={syncing}
                  style={{ ...segStyle(false), opacity: syncing ? 0.5 : 1 }}
                >
                  补全历史
                </button>
              </>
            ) : null}
            <span className="muted" style={{ fontSize: 11 }}>
              {syncing
                ? `${syncStatus?.month ?? ""} · ${syncStatus?.done}/${syncStatus?.total}`
                : (syncStatus?.lastError ?? "")}
            </span>
          </div>

          <div className="track-range-bar">
            <div className="track-range-modes">
              {([
                ["day", "日"],
                ["week", "周"],
                ["month", "月"],
                ["custom", "区间"],
              ] as Array<[RangeMode, string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRangeMode(mode)}
                  className={rangeMode === mode ? "is-on" : ""}
                >
                  {label}
                </button>
              ))}
            </div>

            {rangeMode === "custom" ? (
              <div className="track-range-custom">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="开始日期" />
                <span>~</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="结束日期" />
              </div>
            ) : (
              <div className="track-range-nav">
                <button type="button" aria-label="上一段" onClick={() => setAnchor((v) => shiftAnchor(rangeMode, v, -1))}>
                  ‹
                </button>
                <span className="track-range-label">{range.label}</span>
                <button type="button" aria-label="下一段" onClick={() => setAnchor((v) => shiftAnchor(rangeMode, v, 1))}>
                  ›
                </button>
              </div>
            )}

          </div>

          <div className="track-toolbar">
            <div className="track-seg" role="tablist" aria-label="轨迹视图">
              {([
                ["line", "轨迹线"],
                ["dot", "点云"],
                ["stations", "常去站点"],
                ["playback", "回放"],
              ] as Array<[typeof view, string]>).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "is-on" : ""} onClick={() => setView(id)}>
                  {label}
                </button>
              ))}
            </div>

            <button type="button" className={`track-pill${useDark ? " is-on" : ""}`} onClick={() => setUseDark((v) => !v)} aria-pressed={useDark}>
              深色
            </button>

            <select
              className="track-select"
              value={basemap}
              onChange={(e) => pickBasemap(e.target.value as BasemapId)}
              aria-label="底图"
              title="底图"
            >
              {BASEMAPS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            <span className="palette-dots">
              {PALETTE.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  aria-pressed={colorId === item.id}
                  onClick={() => pickColor(item.id)}
                  className={`palette-dot${colorId === item.id ? " is-on" : ""}`}
                  style={{ background: item.line }}
                />
              ))}
              <button
                type="button"
                title="跟随深浅色自动"
                onClick={() => pickColor("auto")}
                className={`track-pill track-pill--mini${colorId === "auto" ? " is-on" : ""}`}
              >
                自动
              </button>
            </span>

            <select
              className="track-select palette-select"
              value={colorId}
              onChange={(e) => pickColor(e.target.value)}
              aria-label="轨迹配色"
            >
              {PALETTE.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              <option value="auto">自动</option>
            </select>

            <span className="track-meta">
              {trips.length} 趟 · {shown.points.toLocaleString()} 点
              {!hasAmapKey && basemap === "auto" && " · 未取到高德 Key"}
            </span>
          </div>

          {(view === "stations" || view === "playback") && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              {view === "stations" && (
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 11, color: "#8b93a7" }}>
                  <input type="checkbox" checked={showFlows} onChange={(e) => setShowFlows(e.target.checked)} />
                  高频起终点连线（{flows.length} 条）
                </label>
              )}
              {view === "playback" && playRange && playP != null && (
                <>
                  <button type="button" onClick={() => setPlaying((v) => !v)} style={segStyle(playing)}>
                    {playing ? "暂停" : "播放"}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={Math.round(playP * 1000)}
                    onPointerDown={() => {
                      resumeAfterDrag.current = playing;
                      setPlaying(false);
                    }}
                    onPointerUp={() => {
                      if (resumeAfterDrag.current) setPlaying(true);
                    }}
                    onChange={(e) => setPlayP(Number(e.target.value) / 1000)}
                    style={{ flex: "1 1 200px", accentColor: lineColor }}
                    aria-label="回放进度"
                  />
                  <span style={{ fontSize: 11, color: "#8b93a7", fontVariantNumeric: "tabular-nums", minWidth: 190 }}>
                    {new Date((head?.ts ?? playRange.start) * 1000).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {` · 第 ${tripIndex}/${Math.max(1, trailPath.lines.length)} 趟 · ${playedKm.toFixed(1)}/${totalKm.toFixed(1)} km`}
                  </span>
                  <select
                    value={durationSec}
                    onChange={(e) => setDurationSec(Number(e.target.value))}
                    style={segStyle(false)}
                    aria-label="回放时长"
                    title="整段回放用多久"
                  >
                    <option value={15}>15 秒</option>
                    <option value={45}>45 秒</option>
                    <option value={120}>2 分钟</option>
                    <option value={300}>5 分钟</option>
                  </select>
                  <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 11, color: "#8b93a7" }}>
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                    跟随
                  </label>
                  {follow && (
                    <select
                      value={followZoom}
                      onChange={(e) => setFollowZoom(Number(e.target.value))}
                      style={segStyle(false)}
                      aria-label="跟随视距"
                      title="跟随时的缩放级别"
                    >
                      <option value={0}>视距不变</option>
                      <option value={13}>13 级（城市）</option>
                      <option value={14}>14 级</option>
                      <option value={15}>15 级（街道）</option>
                      <option value={16}>16 级（路口）</option>
                    </select>
                  )}
                </>
              )}
            </div>
          )}

          {view === "playback" && rangeTrips.length > 1 && (
            <div className="trip-chips" role="list" aria-label="区间内的行程">
              {focusTrip && (
                <button
                  type="button"
                  className="trip-chip is-reset"
                  onClick={() => {
                    setFocusTrip(null);
                    setPlayP(0);
                    setPlaying(true);
                  }}
                >
                  全程
                </button>
              )}
              {rangeTrips.map((trip) => (
                <button
                  key={trip.s}
                  type="button"
                  role="listitem"
                  className={`trip-chip ${focusTrip?.s === trip.s ? "is-active" : ""}`}
                  onClick={() => {
                    setFocusTrip(focusTrip?.s === trip.s ? null : trip);
                    setPlayP(0);
                    setPlaying(true);
                  }}
                  title={`${new Date(trip.s * 1000).toLocaleString("zh-CN")} · ${trip.k} km`}
                >
                  {new Date(trip.s * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                  <span>{trip.k} km</span>
                </button>
              ))}
            </div>
          )}

          <div
            style={{
              height: embedded ? "clamp(560px, calc(100svh - 236px), 1800px)" : 420,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <MapContainer
              key={`${base.provider}-${base.url}-${useDark ? "dark" : "light"}`}
              center={[38.91, 121.6]}
              zoom={11}
              scrollWheelZoom
              preferCanvas
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                url={base.url}
                attribution={base.attribution}
                maxZoom={base.maxZoom}
                subdomains={base.subdomains ?? ["a"]}
                className={darkAmap ? "nio-dark-tiles" : undefined}
              />
              {basemap === "amap-sat-road" && (
                <TileLayer
                  key="amap-road-overlay"
                  url={AMAP_ROAD_URL}
                  subdomains={["1", "2", "3", "4"]}
                  maxZoom={18}
                  opacity={0.9}
                />
              )}
              {BASEMAP_REFERENCE_URL[basemap] && (
                <TileLayer
                  url={BASEMAP_REFERENCE_URL[basemap]}
                  maxZoom={16}
                  subdomains={["a"]}
                  opacity={0.85}
                />
              )}
              {view === "line" && (
                <TrackLayer
                  trips={trips}
                  mode="line"
                  tileConfig={base}
                  boundsKey={`${boundsKey}-${useDark ? "dark" : "light"}-${colorId}`}
                  light={!useDark}
                  lineColor={lineColor}
                  dotColor={dotColor}
                />
              )}
              {view === "dot" && (
                <DotCloud
                  trips={trips}
                  tileConfig={base}
                  light={!useDark}
                  color={dotColor}
                  boundsKey={`${range.from}-${range.to}-${focusTrip?.s ?? "all"}`}
                />
              )}
              {view === "stations" && (
                <StationLayer
                  stations={stations}
                  flows={flows}
                  tileConfig={base}
                  light={!useDark}
                  showFlows={showFlows}
                />
              )}
              {view === "playback" && playP != null && (
                <PlaybackLayer path={trailPath} progress={playP} light={!useDark} color={lineColor} follow={follow} followZoom={followZoom} playing={playing} fitKey={`${focusTrip?.s ?? "all"}-${range.from}-${range.to}`} />
              )}
            </MapContainer>
          </div>
        </>
      )}
    </>
  );

  if (embedded) return <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 12 }}>{body}</div>;

  return (
    <details
      className="trend-drawer"
      open={openState}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpenState(next);
        saveDrawerOpen(TRACK_DRAWER_KEY, next);
      }}
    >
      <summary>
        <span>历史轨迹</span>
        <span className="drawer-summary-meta">
          {status === "empty" ? "暂无数据" : index ? `${active.size} 个月 · ${trips.length} 趟` : "读取中…"}
        </span>
      </summary>
      {openState && body}
    </details>
  );
}
