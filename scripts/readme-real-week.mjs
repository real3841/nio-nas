/** 用真实轨迹（默认 2026-10-01~07）生成 README 动图：点阵 + 回放 */
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
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function pngEncode(w, h, rgba) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

/* ---------- 轨迹 ---------- */
const DATA = "/workspace/nio-dash/data";
const MONTH = process.env.MONTH || "2026-10";
const D0 = Number(process.env.DAY0 || 1), D1 = Number(process.env.DAY1 || 7);
const file = `${DATA}/tracks-${MONTH}.json`;
const trips = JSON.parse(fs.readFileSync(file, "utf8")).trips
  .filter((t) => { const d = new Date(t.s * 1000); return d.getDate() >= D0 && d.getDate() <= D1; })
  .map((t) => ({ pts: t.p.map((p) => [p[0], p[1]]), s: t.s }))
  .filter((t) => t.pts.length > 1)
  .sort((a, b) => a.s - b.s)
  .filter((t) => {
    if (!process.env.LOCAL) return true;
    const c = t.pts[Math.floor(t.pts.length / 2)];
    return Math.abs(c[0] - 123.43) < 0.18 && Math.abs(c[1] - 41.85) < 0.18;
  });
const all = trips.flatMap((t) => t.pts);
console.log("trips", trips.length, "points", all.length);

const NW = 880, NH = 440, SC = 2, W = NW * SC, H = NH * SC;
const lngs = all.map((p) => p[0]), lats = all.map((p) => p[1]);
const BB = { lng0: Math.min(...lngs), lng1: Math.max(...lngs), lat0: Math.min(...lats), lat1: Math.max(...lats) };
const padX = (BB.lng1 - BB.lng0) * 0.05, padY = (BB.lat1 - BB.lat0) * 0.05;
BB.lng0 -= padX; BB.lng1 += padX; BB.lat0 -= padY; BB.lat1 += padY;

const PI = Math.PI;
const mx = (lng, zz) => (lng + 180) / 360 * 256 * 2 ** zz;
const my = (lat, zz) => (1 - Math.log(Math.tan(lat * PI / 180) + 1 / Math.cos(lat * PI / 180)) / PI) / 2 * 256 * 2 ** zz;
let z = 17;
while (z > 3 && (mx(BB.lng1, z) - mx(BB.lng0, z) > W * 0.92 || my(BB.lat0, z) - my(BB.lat1, z) > H * 0.92)) z--;
console.log("zoom", z, "span", ((BB.lng1 - BB.lng0) * 85).toFixed(0) + "km");
const cx = (mx(BB.lng0, z) + mx(BB.lng1, z)) / 2, cy = (my(BB.lat0, z) + my(BB.lat1, z)) / 2;
const left = cx - W / 2, top = cy - H / 2;
const toPx = (lng, lat) => [(mx(lng, z) - left) / SC, (my(lat, z) - top) / SC];

/* ---------- 底图 ---------- */
console.log("view", { left: Math.round(left), top: Math.round(top), z });
const mosaic = Buffer.alloc(W * H * 4);
const cover = new Uint8Array(W * H);
{
  const tx0 = Math.floor(left / 256), tx1 = Math.floor((left + W) / 256);
  const ty0 = Math.floor(top / 256), ty1 = Math.floor((top + H) / 256);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const sub = ["01", "02", "03", "04"][(tx + ty) % 4];
    const url = `https://webrd${sub}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${tx}&y=${ty}&z=${z}`;
    let img;
    try {
      const resp = await fetch(url);
      if (!resp.ok) { console.log("tile fail", tx, ty, resp.status); continue; }
      img = pngDecode(Buffer.from(await resp.arrayBuffer()));
    } catch (e) { console.log("tile error", tx, ty, e.message); continue; }
    // 空白瓦片（整块纯黑/纯白）直接跳过
    let sum = 0, cnt = 0;
    for (let yy = 0; yy < img.h; yy += 8) for (let xx = 0; xx < img.w; xx += 8) { const s0 = (yy * img.w + xx) * 4; sum += img.data[s0] + img.data[s0 + 1] + img.data[s0 + 2]; cnt++; }
    const mean = sum / cnt / 3;
    let bright = 0, total = 0;
    for (let yy = 0; yy < img.h; yy += 4) for (let xx = 0; xx < img.w; xx += 4) {
      const s0 = (yy * img.w + xx) * 4;
      if (img.data[s0] + img.data[s0 + 1] + img.data[s0 + 2] > 90) bright++;
      total++;
    }
    const brightRatio = bright / total;
    if (mean < 18 || mean > 250 || brightRatio < 0.15) { console.log("blank tile", tx, ty, mean.toFixed(1), brightRatio.toFixed(3)); continue; }
    const ox = Math.round(tx * 256 - left), oy = Math.round(ty * 256 - top);
    for (let yy = 0; yy < img.h; yy++) for (let xx = 0; xx < img.w; xx++) {
      const dx = ox + xx, dy = oy + yy;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const s = (yy * img.w + xx) * 4, d = (dy * W + dx) * 4;
      if (img.data[s + 3] < 8) continue;
      mosaic[d] = img.data[s]; mosaic[d + 1] = img.data[s + 1]; mosaic[d + 2] = img.data[s + 2]; mosaic[d + 3] = 255;
      cover[dy * W + dx] = 1;
    }
  }
}
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
  const d = (y * NW + x) * 4;
  let ok = true;
  for (let sy = 0; sy < SC; sy++) for (let sx = 0; sx < SC; sx++) if (!cover[(y * SC + sy) * W + (x * SC + sx)]) ok = false;
  if (ok && r / 4 > 238 && g / 4 > 238 && b / 4 > 238) ok = false;
  if (ok) { BG[d] = r / 4; BG[d + 1] = g / 4; BG[d + 2] = b / 4; }
  else { BG[d] = 14; BG[d + 1] = 16; BG[d + 2] = 22; }
  BG[d + 3] = 255;
}

for (const [px, py] of [[800, 250], [750, 200], [860, 320], [400, 200]]) {
  const i = (py * NW + px) * 4;
  console.log("px", px, py, BG[i], BG[i + 1], BG[i + 2]);
}
if (process.env.DEBUG_BG) {
  fs.writeFileSync("/tmp/bg-week.png", pngEncode(NW, NH, Buffer.from(BG)));
  console.log("bg -> /tmp/bg-week.png");
}

/* ---------- 绘制 ---------- */
const SPR = 48, sprite = new Float32Array(SPR * SPR);
for (let y = 0; y < SPR; y++) for (let x = 0; x < SPR; x++) {
  const dx = (x + 0.5) / SPR * 2 - 1, dy = (y + 0.5) / SPR * 2 - 1, d = Math.hypot(dx, dy);
  sprite[y * SPR + x] = d > 1 ? 0 : Math.pow(1 - d, 2.4) * 0.85 + Math.pow(Math.max(0, 1 - d * 3.1), 2.2);
}
const RED = [255, 62, 62];
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
const encode = (out, frames, fps, draw) => {
  const gif = GIFEncoder();
  const sample = new Uint8Array(BG);
  draw(sample, 0.45);
  const palette = quantize(sample, 32, { format: "rgb444" });
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
};

/* ---------- 点阵 ---------- */
{
  const cells = new Map();
  for (const t of trips) for (const p of t.pts) {
    const [x0, y0] = toPx(p[0], p[1]);
    const x = Math.round(x0 / 2) * 2, y = Math.round(y0 / 2) * 2;
    const key = x + "," + y, hit = cells.get(key);
    if (hit) hit.n++; else cells.set(key, { x, y, n: 1 });
  }
  const dots = [...cells.values()];
  console.log("dots", dots.length);
  encode(`docs/assets/dots-week${process.env.LOCAL ? "-local" : ""}.gif`, 60, 20, (buf, t) => {
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i], ph = ((i * 7) % 60) / 60;
      const breathe = 0.72 + 0.28 * Math.sin((t + ph) * PI * 2);
      const size = (8 + Math.min(6, Math.log2(d.n + 1) * 2)) * (0.92 + 0.16 * breathe);
      blit(buf, d.x, d.y, size, RED, 0.95 * breathe);
      const life = (t - ph + 1) % 1;
      if (life < 0.5) ring(buf, d.x, d.y, 2 + (life / 0.5) * 11, RED, 0.4 * (1 - life / 0.5) ** 1.6);
    }
  });
}

/* ---------- 回放：按距离匀速，段与段之间不连线 ---------- */
const SPEED_PX = 0.55; // 每帧前进的屏幕像素（约）
const tripPx = trips.map((t) => t.pts.map((p) => toPx(p[0], p[1])));
const tripLen = tripPx.map((px) => {
  const cum = [0];
  for (let i = 1; i < px.length; i++) cum.push(cum[i - 1] + Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1]));
  return cum;
});
const totalPx = tripLen.reduce((n, c) => n + c[c.length - 1], 0);
const FRAMES = 96;
const stepPx = totalPx / FRAMES;
const drawPlayback = (buf, t) => {
  const travelled = t * totalPx;
  const mask = new Uint8Array(NW * NH);
  let acc = 0, head = null;
  for (let i = 0; i < trips.length; i++) {
    const len = tripLen[i][tripLen[i].length - 1];
    const start = acc, end = acc + len;
    acc = end;
    if (travelled <= start) break;
    const local = Math.min(len, travelled - start);
    const px = tripPx[i], cum = tripLen[i];
    let k = 0;
    while (k < cum.length - 1 && cum[k + 1] <= local) k++;
    for (let j = 0; j < k; j++) {
      const behind = travelled - (start + cum[j]);
      segMax(mask, px[j][0], px[j][1], px[j + 1][0], px[j + 1][1], 3.4, 0.5 + 0.5 * Math.exp(-behind / 220));
    }
    if (k < px.length - 1 && local > cum[k]) {
      const f = (local - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
      head = [px[k][0] + (px[k + 1][0] - px[k][0]) * f, px[k][1] + (px[k + 1][1] - px[k][1]) * f];
      segMax(mask, px[k][0], px[k][1], head[0], head[1], 3.4, 1);
    } else if (k > 0) head = px[k];
  }
  composite(buf, mask, [255, 46, 46]);
  if (head) {
    blit(buf, head[0], head[1], 34, RED, 0.45);
    blit(buf, head[0], head[1], 16, [255, 250, 250], 1, 0.95);
    ring(buf, head[0], head[1], 8 + 6 * ((t * 6) % 1), RED, 0.35);
  }
};
if (process.env.DEBUG_FRAME) {
  const buf = new Uint8Array(BG);
  drawPlayback(buf, Number(process.env.DEBUG_FRAME));
  fs.writeFileSync("/tmp/playback-real.png", pngEncode(NW, NH, Buffer.from(buf)));
  console.log("frame -> /tmp/playback-real.png");
}
encode(`docs/assets/playback-week${process.env.LOCAL ? "-local" : ""}.gif`, Math.round(FRAMES * 0.7), 20, drawPlayback);
