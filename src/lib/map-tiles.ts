export type MapTileProvider = "osm" | "amap";

export interface MapTileConfig {
  provider: MapTileProvider;
  url: string;
  attribution: string;
  subdomains?: string[];
  maxZoom: number;
}

export function mapTileFromEnv(map: {
  NIO_AMAP_JS_KEY?: string;
}): MapTileConfig {
  if (map.NIO_AMAP_JS_KEY?.trim()) {
    return {
      provider: "amap",
      url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
      attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
      subdomains: ["1", "2", "3", "4"],
      maxZoom: 18,
    };
  }

  return {
    provider: "osm",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: ["a", "b", "c"],
    maxZoom: 19,
  };
}

/** 可选底图：中文高德 + Esri 的深灰/浅灰/卫星（英文注记） */
export type BasemapId =
  | "auto"
  | "amap"
  | "amap-sat"
  | "amap-sat-road"
  | "esri-dark"
  | "esri-light"
  | "esri-sat";

export interface BasemapOption {
  id: BasemapId;
  label: string;
  /** 是否需要叠加英文注记层 */
  reference?: boolean;
}

export const BASEMAPS: BasemapOption[] = [
  { id: "auto", label: "自动（跟随深浅色）" },
  { id: "amap", label: "高德 · 标准（中文）" },
  { id: "amap-sat", label: "高德 · 卫星（无路名）" },
  { id: "amap-sat-road", label: "高德 · 卫星 + 路网" },
  { id: "esri-dark", label: "Esri · 深灰（英文注记）", reference: true },
  { id: "esri-light", label: "Esri · 浅灰（英文注记）", reference: true },
  { id: "esri-sat", label: "Esri · 卫星" },
];

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

function esriConfig(path: string, label: string, maxZoom = 19): MapTileConfig {
  return {
    provider: "osm",
    url: `${ESRI}/${path}/MapServer/tile/{z}/{y}/{x}`,
    attribution: `&copy; <a href="https://www.esri.com/">Esri</a> · ${label}`,
    subdomains: ["a"],
    maxZoom,
  };
}

/** 按 id 解析底图；auto 保持原来的「有高德 Key 用高德，否则按深浅色选 Esri」 */
export function resolveBasemap(id: BasemapId, hasAmapKey: boolean, dark: boolean): MapTileConfig {
  switch (id) {
    case "amap":
      return amapConfig(7);
    case "amap-sat":
    case "amap-sat-road":
      return amapConfig(6);
    case "esri-dark":
      return esriConfig("Canvas/World_Dark_Gray_Base", "Dark Gray Canvas", 16);
    case "esri-light":
      return esriConfig("Canvas/World_Light_Gray_Base", "Light Gray Canvas", 16);
    case "esri-sat":
      return esriConfig("World_Imagery", "World Imagery");
    case "auto":
    default:
      if (hasAmapKey) return amapConfig(7);
      return dark
        ? esriConfig("Canvas/World_Dark_Gray_Base", "Dark Gray Canvas", 16)
        : esriConfig("Canvas/World_Light_Gray_Base", "Light Gray Canvas", 16);
  }
}

function amapConfig(style: 6 | 7): MapTileConfig {
  return {
    provider: "amap",
    url: `https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=${style}&x={x}&y={y}&z={z}`,
    attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
    subdomains: ["1", "2", "3", "4"],
    maxZoom: 18,
  };
}

/** 高德路网叠加层（透明底，只画路名/路网），配合卫星底图 */
export const AMAP_ROAD_URL =
  "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}";

/** Esri 深灰/浅灰的注记层（地名、路名，英文） */
export const BASEMAP_REFERENCE_URL: Record<string, string> = {
  "esri-dark": `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  "esri-light": `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
};
