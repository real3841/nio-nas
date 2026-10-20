import fs from "node:fs";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const W = 800, H = 450, FRAMES = 60, FPS = 20;
const BG = [11, 13, 18];
const PINK = [255, 94, 200];
const CYAN = [94, 234, 255];

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = mulberry32(20261020);
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// 北京主城区一带（天安门为基准，经纬度线性投影）
const LNG0 = 116.16, LNG1 = 116.62, LAT0 = 39.72, LAT1 = 40.06;
const px = (lng) => ((lng - LNG0) / (LNG1 - LNG0)) * W;
const py = (lat) => ((LAT1 - lat) / (LAT1 - LAT0)) * H;

// 8 个热点（国贸、望京、中关村、西二旗、三里屯、亦庄、通州、五道口）
const HOT = [
  [116.46, 39.91], [116.48, 40.00], [116.31, 39.98], [116.30, 40.05],
  [116.45, 39.94], [116.50, 39.80], [116.66, 39.90], [116.34, 39.99],
  [116.40, 39.86], [116.54, 39.96],
];
const pts = [];
for (const [lng, lat] of HOT) {
  const n = 62 + Math.floor(rnd() * 14);
  for (let i = 0; i < n; i++) {
    pts.push([lng + gauss() * 0.020, lat + gauss() * 0.016, PINK]);
  }
}
while (pts.length < 800) {
  const c = HOT[Math.floor(rnd() * HOT.length)];
  pts.push([c[0] + gauss() * 0.035, c[1] + gauss() * 0.030, rnd() < 0.14 ? CYAN : PINK]);
}

// 预生成发光贴图（加法混合）
const SPR = 48;
const sprite = new Float32Array(SPR * SPR * 3);
for (let y = 0; y < SPR; y++) {
  for (let x = 0; x < SPR; x++) {
    const dx = (x + 0.5) / SPR * 2 - 1, dy = (y + 0.5) / SPR * 2 - 1;
    const d = Math.hypot(dx, dy);
    if (d > 1) continue;
    const halo = Math.pow(1 - d, 2.4);
    const core = Math.pow(Math.max(0, 1 - d * 3.1), 2.2);
    const k = (y * SPR + x) * 3;
    sprite[k] = halo * 0.85 + core * 1.0;
    sprite[k + 1] = halo * 0.85 + core * 1.0;
    sprite[k + 2] = halo * 0.85 + core * 1.0;
  }
}

const blit = (buf, cx, cy, size, color, alpha, white = 0.45) => {
  const half = size / 2;
  const x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(W - 1, Math.ceil(cx + half));
  const y0 = Math.max(0, Math.floor(cy - half)), y1 = Math.min(H - 1, Math.ceil(cy + half));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const u = Math.floor(((x + 0.5 - (cx - half)) / size) * SPR);
      const v = Math.floor(((y + 0.5 - (cy - half)) / size) * SPR);
      if (u < 0 || v < 0 || u >= SPR || v >= SPR) continue;
      const s = (v * SPR + u) * 3;
      const g = sprite[s];
      if (g <= 0.002) continue;
      const i = (y * W + x) * 4;
      const w = g * white * alpha * 255;
      const c = g * (1 - white) * alpha * 255;
      buf[i] = Math.min(255, buf[i] + c * (color[0] / 255) + w);
      buf[i + 1] = Math.min(255, buf[i + 1] + c * (color[1] / 255) + w);
      buf[i + 2] = Math.min(255, buf[i + 2] + c * (color[2] / 255) + w);
    }
  }
};

const ring = (buf, cx, cy, r, color, alpha) => {
  const steps = Math.max(24, Math.ceil(r * 6));
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = ((y | 0) * W + (x | 0)) * 4;
    const k = alpha * 255;
    buf[i] = Math.min(255, buf[i] + k * (color[0] / 255));
    buf[i + 1] = Math.min(255, buf[i + 1] + k * (color[1] / 255));
    buf[i + 2] = Math.min(255, buf[i + 2] + k * (color[2] / 255));
  }
};

const gif = GIFEncoder();
const bgBuf = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const dx = (x / W - 0.5) * 1.4, dy = (y / H - 0.5) * 1.4;
    const v = Math.max(0, 1 - Math.hypot(dx, dy)) * 6;
    bgBuf[i] = BG[0] + v * 0.6;
    bgBuf[i + 1] = BG[1] + v;
    bgBuf[i + 2] = BG[2] + v * 1.6;
    bgBuf[i + 3] = 255;
  }
}
// 极淡网格
for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; bgBuf[i] += 3; bgBuf[i + 1] += 3; bgBuf[i + 2] += 4; }
for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; bgBuf[i] += 3; bgBuf[i + 1] += 3; bgBuf[i + 2] += 4; }

for (let f = 0; f < FRAMES; f++) {
  const t = f / FRAMES;
  const buf = new Uint8Array(bgBuf);
  for (let i = 0; i < pts.length; i++) {
    const [lng, lat, color] = pts[i];
    const x = px(lng), y = py(lat);
    const phase = ((i * 7) % FRAMES) / FRAMES;
    const life = (t - phase + 1) % 1;
    const breathe = 0.72 + 0.28 * Math.sin((t + phase) * Math.PI * 2);
    blit(buf, x, y, 13 + 7 * breathe, color, 0.95 * breathe);
    if (life < 0.55) {
      const p = life / 0.55;
      ring(buf, x, y, 2 + p * 17, color, 0.5 * (1 - p) ** 1.6);
    }
  }
  const rgba = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
  let frame = rgba;
  const palette = quantize(frame, 48, { format: "rgb444" });
  const index = applyPalette(frame, palette, "rgb444");
  gif.writeFrame(index, W, H, { palette, delay: Math.round(1000 / FPS), repeat: 0 });
}
gif.finish();
const out = Buffer.from(gif.bytes());
fs.writeFileSync(new URL("../docs/assets/dots-beijing.gif", import.meta.url), out);
console.log("dots-beijing.gif", (out.length / 1024).toFixed(0) + "KB");
