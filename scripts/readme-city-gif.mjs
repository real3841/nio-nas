/**
 * 生成 README 用的北京「点阵 / 回放」动图：
 * - 40 条真实路线：起终点是真实地点，路径走 OSRM 的驾车路线（真实道路）
 * - 底图：高德栅格瓦片拼成北京城区，程序化转深色
 * - 输出：docs/assets/dots-shenyang.gif / playback-shenyang.gif
 */
import fs from "node:fs";
import zlib from "node:zlib";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;

/* ---------- PNG ---------- */
function pngDecode(buf) {
  let p = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = []; let plte = null, trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error("bitdepth " + bd);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : ct === 3 ? 1 : 0;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++], line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, s = x * ch;
      if (ct === 3) { const idx = cur[s]; out[i] = plte[idx * 3]; out[i + 1] = plte[idx * 3 + 1]; out[i + 2] = plte[idx * 3 + 2]; out[i + 3] = trns && idx < trns.length ? trns[idx] : 255; }
      else if (ch === 1) { out[i] = out[i + 1] = out[i + 2] = cur[s]; out[i + 3] = 255; }
      else if (ch === 2) { out[i] = out[i + 1] = out[i + 2] = cur[s]; out[i + 3] = cur[s + 1]; }
      else { out[i] = cur[s]; out[i + 1] = cur[s + 1]; out[i + 2] = cur[s + 2]; out[i + 3] = ch === 4 ? cur[s + 3] : 255; }
    }
    prev = cur;
  }
  return { w, h, data: out };
}

/* ---------- PNG 编码（仅调试单帧用） ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function pngEncode(w, h, rgba) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

/* ---------- 坐标 ---------- */
const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;
const outOfChina = (lng, lat) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
const tLat = (x, y) => {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  return r;
};
const tLng = (x, y) => {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  return r;
};
const wgs84ToGcj = (lng, lat) => {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const radLat = lat / 180 * PI; let magic = Math.sin(radLat); magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
};
const gcjToWgs = (lng, lat) => {
  let wLng = lng, wLat = lat;
  for (let i = 0; i < 2; i++) {
    const [gLng, gLat] = wgs84ToGcj(wLng, wLat);
    wLng += lng - gLng; wLat += lat - gLat;
  }
  return [wLng, wLat];
};

/* ---------- 真实地点（GCJ-02） ---------- */
const POIS = [
  ["沈阳站", 123.4298, 41.7947], ["沈阳北站", 123.4362, 41.8186], ["中街", 123.4550, 41.8020],
  ["太原街", 123.4180, 41.7950], ["三好街", 123.4280, 41.7760], ["五爱市场", 123.4530, 41.7830],
  ["铁西广场", 123.3730, 41.7950], ["于洪广场", 123.3080, 41.7950], ["北陵公园", 123.4300, 41.8460],
  ["沈北大学城", 123.4200, 41.9150], ["道义", 123.3900, 41.8900], ["浑南大学城", 123.4500, 41.7300],
  ["奥体中心", 123.4620, 41.7440], ["桃仙机场", 123.4830, 41.6400], ["苏家屯", 123.3440, 41.6650],
  ["沈阳南站", 123.4200, 41.7100], ["大东龙之梦", 123.4880, 41.8130], ["陶瓷城", 123.5100, 41.8300],
  ["丁香湖", 123.3600, 41.8300], ["开发区", 123.2600, 41.7600], ["农业大学", 123.5700, 41.8200],
  ["长白岛", 123.3760, 41.7450], ["金廊", 123.4350, 41.7900], ["东陵", 123.5500, 41.7800],
  ["沈抚新城", 123.6200, 41.8100], ["造化", 123.3300, 41.8900], ["白塔堡", 123.4600, 41.6900],
  ["沙岭", 123.2600, 41.8200], ["虎石台", 123.4700, 41.9400], ["浑河站", 123.3900, 41.7500],
];

/* ---------- 一条连续的 40 段真实驾车路线（OSRM，结果缓存） ---------- */
const CACHE = "docs/assets/routes-shenyang.json";
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = mulberry32(20261020);

async function osrmRoute(a, b) {
  const [lngA, latA] = gcjToWgs(POIS[a][1], POIS[a][2]);
  const [lngB, latB] = gcjToWgs(POIS[b][1], POIS[b][2]);
  const url = `https://router.project-osrm.org/route/v1/driving/${lngA},${latA};${lngB},${latB}?overview=full&geometries=geojson`;
  const json = await (await fetch(url)).json();
  if (json.code !== "Ok" || !json.routes?.[0]) return null;
  return {
    from: POIS[a][0], to: POIS[b][0],
    km: +(json.routes[0].distance / 1000).toFixed(1),
    pts: json.routes[0].geometry.coordinates.map(([lng, lat]) => wgs84ToGcj(lng, lat)),
  };
}

async function fetchChain() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  // 30 个点沿城市外圈按方位排序 → 30 段首尾相接的环线，每段只走一次，避免路线重合
  const cy = POIS.reduce((n, p) => n + p[2], 0) / POIS.length;
  const cx = POIS.reduce((n, p) => n + p[1], 0) / POIS.length;
  const order = POIS.map((p, i) => ({ i, a: Math.atan2(p[2] - cy, p[1] - cx) }))
    .sort((m, n) => m.a - n.a).map((o) => o.i);
  const startAt = Math.floor(rnd() * order.length);
  const nodes = [];
  for (let k = 0; k < 20; k++) nodes.push(order[(startAt + Math.floor(k * 1.5)) % order.length]);
  nodes.push(nodes[0]);
  const chain = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const leg = await osrmRoute(nodes[i], nodes[i + 1]);
    if (!leg) { console.log("skip", POIS[nodes[i]][0], "->", POIS[nodes[i + 1]][0]); continue; }
    chain.push(leg);
    await new Promise((r) => setTimeout(r, 120));
  }
  fs.writeFileSync(CACHE, JSON.stringify(chain));
  return chain;
}
const CHAIN = await fetchChain();
const ROUTES = CHAIN;
const CHAIN_PTS = CHAIN.flatMap((r) => r.pts);
console.log("legs", CHAIN.length, "points", CHAIN_PTS.length,
  "km", CHAIN.reduce((n, r) => n + r.km, 0).toFixed(0));

/* ---------- 底图 ---------- */
const NW = 880, NH = 440, SC = 2, W = NW * SC, H = NH * SC;
const all = ROUTES.flatMap((r) => r.pts);
const lngs = all.map((p) => p[0]), lats = all.map((p) => p[1]);
const BB = {
  lng0: Math.min(...lngs) - 0.008, lng1: Math.max(...lngs) + 0.008,
  lat0: Math.min(...lats) - 0.008, lat1: Math.max(...lats) + 0.008,
};
let z = 17;
const spanX = (lng) => (lng + 180) / 360 * 256 * 2 ** z;
const spanY = (lat) => (1 - Math.log(Math.tan(lat * PI / 180) + 1 / Math.cos(lat * PI / 180)) / PI) / 2 * 256 * 2 ** z;
while (z > 3 && (spanX(BB.lng1) - spanX(BB.lng0) > W * 0.9 || spanY(BB.lat0) - spanY(BB.lat1) > H * 0.9)) z--;
/* 让 30 段链自然铺满更大范围，不再额外放大 */
const world = 256 * 2 ** z;
const mx = (lng) => (lng + 180) / 360 * world;
const my = (lat) => (1 - Math.log(Math.tan(lat * PI / 180) + 1 / Math.cos(lat * PI / 180)) / PI) / 2 * world;
const cx = (mx(BB.lng0) + mx(BB.lng1)) / 2, cy = (my(BB.lat0) + my(BB.lat1)) / 2;
const left = cx - W / 2, top = cy - H / 2;
const toPx = (lng, lat) => [(mx(lng) - left) / SC, (my(lat) - top) / SC];

const mosaic = Buffer.alloc(W * H * 4);
{
  const tx0 = Math.floor(left / 256), tx1 = Math.floor((left + W) / 256);
  const ty0 = Math.floor(top / 256), ty1 = Math.floor((top + H) / 256);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const sub = ["01", "02", "03", "04"][(tx + ty) % 4];
    const url = `https://webrd${sub}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${tx}&y=${ty}&z=${z}`;
    const img = pngDecode(Buffer.from(await (await fetch(url)).arrayBuffer()));
    const ox = Math.round(tx * 256 - left), oy = Math.round(ty * 256 - top);
    for (let yy = 0; yy < img.h; yy++) for (let xx = 0; xx < img.w; xx++) {
      const dx = ox + xx, dy = oy + yy;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const s = (yy * img.w + xx) * 4, d = (dy * W + dx) * 4;
      mosaic[d] = img.data[s]; mosaic[d + 1] = img.data[s + 1]; mosaic[d + 2] = img.data[s + 2]; mosaic[d + 3] = 255;
    }
  }
}
// 转深色（反相 + 色相 180° + 压暗）
for (let i = 0; i < W * H * 4; i += 4) {
  const r = 255 - mosaic[i], g = 255 - mosaic[i + 1], b = 255 - mosaic[i + 2];
  mosaic[i] = Math.max(0, Math.min(255, (-0.574 * r + 1.430 * g + 0.144 * b) * 0.95 + 4));
  mosaic[i + 1] = Math.max(0, Math.min(255, (0.426 * r + 0.430 * g + 0.144 * b) * 0.95 + 6));
  mosaic[i + 2] = Math.max(0, Math.min(255, (0.426 * r + 1.430 * g - 0.856 * b) * 0.95 + 12));
}
const BG = new Uint8Array(NW * NH * 4);
for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++) {
  let r = 0, g = 0, b = 0;
  for (let sy = 0; sy < SC; sy++) for (let sx = 0; sx < SC; sx++) {
    const i = ((y * SC + sy) * W + (x * SC + sx)) * 4; r += mosaic[i]; g += mosaic[i + 1]; b += mosaic[i + 2];
  }
  const d = (y * NW + x) * 4; BG[d] = r / 4; BG[d + 1] = g / 4; BG[d + 2] = b / 4; BG[d + 3] = 255;
}

/* ---------- 发光 ---------- */
const SPR = 48, sprite = new Float32Array(SPR * SPR);
for (let y = 0; y < SPR; y++) for (let x = 0; x < SPR; x++) {
  const dx = (x + 0.5) / SPR * 2 - 1, dy = (y + 0.5) / SPR * 2 - 1, d = Math.hypot(dx, dy);
  sprite[y * SPR + x] = d > 1 ? 0 : Math.pow(1 - d, 2.4) * 0.85 + Math.pow(Math.max(0, 1 - d * 3.1), 2.2);
}
const PINK = [255, 62, 62];
const blit = (buf, cx, cy, size, color, alpha, white = 0.45) => {
  const half = size / 2;
  const x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(NW - 1, Math.ceil(cx + half));
  const y0 = Math.max(0, Math.floor(cy - half)), y1 = Math.min(NH - 1, Math.ceil(cy + half));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const u = Math.floor(((x + 0.5 - (cx - half)) / size) * SPR), v = Math.floor(((y + 0.5 - (cy - half)) / size) * SPR);
    if (u < 0 || v < 0 || u >= SPR || v >= SPR) continue;
    const g = sprite[v * SPR + u]; if (g <= 0.002) continue;
    const i = (y * NW + x) * 4, w = g * white * alpha * 255, c = g * (1 - white) * alpha * 255;
    buf[i] = Math.min(255, buf[i] + c * color[0] / 255 + w);
    buf[i + 1] = Math.min(255, buf[i + 1] + c * color[1] / 255 + w);
    buf[i + 2] = Math.min(255, buf[i + 2] + c * color[2] / 255 + w);
  }
};
const segMax = (mask, x0, y0, x1, y1, w, val) => {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w)), maxX = Math.min(NW - 1, Math.ceil(Math.max(x0, x1) + w));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w)), maxY = Math.min(NH - 1, Math.ceil(Math.max(y0, y1) + w));
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1e-6;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    let t = ((x - x0) * dx + (y - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
    if (d > w / 2 + 1) continue;
    const k = Math.min(1, w / 2 + 0.5 - d);
    if (k <= 0.002) continue;
    const i = y * NW + x;
    mask[i] = Math.max(mask[i], k * val * 255);
  }
};
const composite = (buf, mask, color) => {
  for (let i = 0; i < NW * NH; i++) {
    const m = mask[i];
    if (m < 1) continue;
    const a = m / 255, j = i * 4;
    buf[j] = buf[j] * (1 - a) + color[0] * a;
    buf[j + 1] = buf[j + 1] * (1 - a) + color[1] * a;
    buf[j + 2] = buf[j + 2] * (1 - a) + color[2] * a;
  }
};
const ring = (buf, cx, cy, r, color, alpha) => {
  const steps = Math.max(24, Math.ceil(r * 6));
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * PI * 2, x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (x < 0 || y < 0 || x >= NW || y >= NH) continue;
    const i = (y * NW + x) * 4, k = alpha * 255;
    buf[i] = Math.min(255, buf[i] + k * color[0] / 255);
    buf[i + 1] = Math.min(255, buf[i + 1] + k * color[1] / 255);
    buf[i + 2] = Math.min(255, buf[i + 2] + k * color[2] / 255);
  }
};
const seg = (buf, x0, y0, x1, y1, w, color, alpha) => {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w)), maxX = Math.min(NW - 1, Math.ceil(Math.max(x0, x1) + w));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w)), maxY = Math.min(NH - 1, Math.ceil(Math.max(y0, y1) + w));
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1e-6;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    let t = ((x - x0) * dx + (y - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
    if (d > w / 2 + 1) continue;
    const k = alpha * Math.min(1, w / 2 + 0.5 - d);
    if (k <= 0.002) continue;
    const i = (y * NW + x) * 4;
    buf[i] = Math.min(255, buf[i] + k * 255 * color[0] / 255);
    buf[i + 1] = Math.min(255, buf[i + 1] + k * 255 * color[1] / 255);
    buf[i + 2] = Math.min(255, buf[i + 2] + k * 255 * color[2] / 255);
  }
};
const colorOf = () => PINK;

function encode(out, frames, fps, draw) {
  const gif = GIFEncoder();
  const sample = new Uint8Array(BG);
  draw(sample, 0.55);
  const palette = quantize(new Uint8ClampedArray(sample.buffer, sample.byteOffset, sample.byteLength), 32, { format: "rgb444" });
  for (let f = 0; f < frames; f++) {
    const buf = new Uint8Array(BG);
    draw(buf, f / frames);
    const rgba = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
    gif.writeFrame(applyPalette(rgba, palette, "rgb444"), NW, NH, { palette, delay: Math.round(1000 / fps), repeat: 0 });
  }
  gif.finish();
  const bytes = Buffer.from(gif.bytes());
  fs.writeFileSync(out, bytes);
  console.log(out.split("/").pop(), (bytes.length / 1024).toFixed(0) + "KB");
}

// A 点阵
{
  const cells = new Map();
  for (const r of ROUTES) for (let k = 0; k < r.pts.length; k += 3) {
    const [x0, y0] = toPx(r.pts[k][0], r.pts[k][1]);
    const x = Math.round(x0 / 2) * 2, y = Math.round(y0 / 2) * 2;
    const key = x + "," + y, hit = cells.get(key);
    if (hit) hit.n++; else cells.set(key, { x, y, n: 1, color: r.color });
  }
  const dots = [...cells.values()];
  console.log("dots", dots.length);
  encode("docs/assets/dots-shenyang.gif", 60, 20, (buf, t) => {
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i], phase = ((i * 7) % 60) / 60;
      const breathe = 0.72 + 0.28 * Math.sin((t + phase) * PI * 2);
      const size = (7.5 + Math.min(4.5, Math.log2(d.n + 1) * 1.6)) * (0.92 + 0.16 * breathe);
      blit(buf, d.x, d.y, size, colorOf(), 0.92 * breathe, 0.24);
      const life = (t - phase + 1) % 1;
      if (life < 0.5) ring(buf, d.x, d.y, 2 + (life / 0.5) * 10, colorOf(), 0.4 * (1 - life / 0.5) ** 1.6);
    }
  });
}

// B 回放：一条连续的红线跑出来，走过就留下
const drawPlayback = (buf, t) => {
  const N = CHAIN_PTS.length;
  const head = Math.floor(t * (N - 1));
  const xy = (k) => toPx(CHAIN_PTS[k][0], CHAIN_PTS[k][1]);
  const xyA = xy(0), xyB = xy(Math.min(N - 1, 1));
  const stepPx = Math.hypot(xyB[0] - xyA[0], xyB[1] - xyA[1]) || 1;
  const mask = new Uint8Array(NW * NH);
  for (let k = 0; k < head; k++) {
    const [x0, y0] = xy(k), [x1, y1] = xy(k + 1);
    const behind = (head - k) * stepPx;
    segMax(mask, x0, y0, x1, y1, 2.1, 0.5 + 0.5 * Math.exp(-behind / 240));
  }
  composite(buf, mask, [255, 46, 46]);
  const [hx, hy] = xy(head);
  // 超级亮的彗星头：大光晕 + 白核 + 扩散环
  blit(buf, hx, hy, 42, PINK, 0.7);
  blit(buf, hx, hy, 24, [255, 250, 250], 1, 0.95);
  blit(buf, hx, hy, 12, [255, 255, 255], 1, 1);
  ring(buf, hx, hy, 12 + 10 * ((t * 5) % 1), PINK, 0.6);
};
if (process.env.DEBUG_FRAME) {
  const buf = new Uint8Array(BG);
  drawPlayback(buf, Number(process.env.DEBUG_FRAME));
  fs.writeFileSync("/tmp/playback-frame.png", pngEncode(NW, NH, Buffer.from(buf)));
  console.log("frame -> /tmp/playback-frame.png");
}
encode("docs/assets/playback-shenyang.gif", 84, 20, drawPlayback);
