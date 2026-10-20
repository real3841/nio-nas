import fs from "node:fs";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const PINK = [255, 94, 200], CYAN = [94, 234, 255];
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

const HOT = [
  [116.46, 39.91], [116.48, 40.00], [116.31, 39.98], [116.30, 40.05],
  [116.45, 39.94], [116.50, 39.80], [116.66, 39.90], [116.34, 39.99],
  [116.40, 39.86], [116.54, 39.96], [116.25, 39.90], [116.60, 40.02],
];

// 40 条随机路线：起点/终点取不同热点，中间 3–5 个抖动航点，Catmull-Rom 采样
const ROUTES = [];
for (let i = 0; i < 40; i++) {
  let a = Math.floor(rnd() * HOT.length), b = Math.floor(rnd() * HOT.length);
  if (b === a) b = (a + 1 + Math.floor(rnd() * (HOT.length - 1))) % HOT.length;
  const start = HOT[a], end = HOT[b];
  const wps = [start];
  const mid = 3 + Math.floor(rnd() * 3);
  for (let k = 1; k <= mid; k++) {
    const f = k / (mid + 1);
    wps.push([
      start[0] + (end[0] - start[0]) * f + gauss() * 0.018,
      start[1] + (end[1] - start[1]) * f + gauss() * 0.014,
    ]);
  }
  wps.push(end);
  const pts = [];
  for (let k = 0; k < wps.length - 1; k++) {
    const p0 = wps[Math.max(0, k - 1)], p1 = wps[k], p2 = wps[k + 1], p3 = wps[Math.min(wps.length - 1, k + 2)];
    const steps = 26;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const cr = (q0, q1, q2, q3) => 0.5 * (2 * q1 + (-q0 + q2) * t + (2 * q0 - 5 * q1 + 4 * q2 - q3) * t2 + (-q0 + 3 * q1 - 3 * q2 + q3) * t3);
      pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push([end[0], end[1]]);
  ROUTES.push({ pts, color: rnd() < 0.16 ? CYAN : PINK, phase: rnd() });
}

const all = ROUTES.flatMap((r) => r.pts);
const B = {
  lng0: Math.min(...all.map((p) => p[0])) - 0.01,
  lng1: Math.max(...all.map((p) => p[0])) + 0.01,
  lat0: Math.min(...all.map((p) => p[1])) - 0.01,
  lat1: Math.max(...all.map((p) => p[1])) + 0.01,
};

const SPR = 48;
const sprite = new Float32Array(SPR * SPR);
for (let y = 0; y < SPR; y++) for (let x = 0; x < SPR; x++) {
  const dx = (x + 0.5) / SPR * 2 - 1, dy = (y + 0.5) / SPR * 2 - 1;
  const d = Math.hypot(dx, dy);
  sprite[y * SPR + x] = d > 1 ? 0 : Math.pow(1 - d, 2.4) * 0.85 + Math.pow(Math.max(0, 1 - d * 3.1), 2.2);
};

function makeCanvas(W, H) {
  const px = (lng) => ((lng - B.lng0) / (B.lng1 - B.lng0)) * (W - 40) + 20;
  const py = (lat) => ((B.lat1 - lat) / (B.lat1 - B.lat0)) * (H - 40) + 20;
  const bg = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const dx = (x / W - 0.5) * 1.5, dy = (y / H - 0.5) * 1.5;
    const v = Math.max(0, 1 - Math.hypot(dx, dy)) * 7;
    bg[i] = 10 + v * 0.5; bg[i + 1] = 12 + v * 0.85; bg[i + 2] = 17 + v * 1.5; bg[i + 3] = 255;
  }
  for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; bg[i] += 3; bg[i + 1] += 3; bg[i + 2] += 4; }
  for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; bg[i] += 3; bg[i + 1] += 3; bg[i + 2] += 4; }

  const blit = (buf, cx, cy, size, color, alpha, white = 0.45) => {
    const half = size / 2;
    const x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(W - 1, Math.ceil(cx + half));
    const y0 = Math.max(0, Math.floor(cy - half)), y1 = Math.min(H - 1, Math.ceil(cy + half));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const u = Math.floor(((x + 0.5 - (cx - half)) / size) * SPR);
      const v = Math.floor(((y + 0.5 - (cy - half)) / size) * SPR);
      if (u < 0 || v < 0 || u >= SPR || v >= SPR) continue;
      const g = sprite[v * SPR + u];
      if (g <= 0.002) continue;
      const i = (y * W + x) * 4;
      const w = g * white * alpha * 255, c = g * (1 - white) * alpha * 255;
      buf[i] = Math.min(255, buf[i] + c * color[0] / 255 + w);
      buf[i + 1] = Math.min(255, buf[i + 1] + c * color[1] / 255 + w);
      buf[i + 2] = Math.min(255, buf[i + 2] + c * color[2] / 255 + w);
    }
  };
  const ring = (buf, cx, cy, r, color, alpha) => {
    const steps = Math.max(24, Math.ceil(r * 6));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4, k = alpha * 255;
      buf[i] = Math.min(255, buf[i] + k * color[0] / 255);
      buf[i + 1] = Math.min(255, buf[i + 1] + k * color[1] / 255);
      buf[i + 2] = Math.min(255, buf[i + 2] + k * color[2] / 255);
    }
  };
  return { bg, px, py, blit, ring };
}

function encode(out, W, H, frames, fps, draw) {
  const gif = GIFEncoder();
  const { bg } = makeCanvas(W, H);
  for (let f = 0; f < frames; f++) {
    const buf = new Uint8Array(bg);
    draw(buf, f / frames, f);
    const rgba = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
    const palette = quantize(rgba, 48, { format: "rgb444" });
    const index = applyPalette(rgba, palette, "rgb444");
    gif.writeFrame(index, W, H, { palette, delay: Math.round(1000 / fps), repeat: 0 });
  }
  gif.finish();
  const bytes = Buffer.from(gif.bytes());
  fs.writeFileSync(out, bytes);
  console.log(out.split("/").pop(), (bytes.length / 1024).toFixed(0) + "KB");
}

// A. 点阵：40 条路线的点全部铺开，按 3px 网格合并去重
{
  const W = 800, H = 450;
  const c = makeCanvas(W, H);
  const cells = new Map();
  for (const r of ROUTES) for (const [lng, lat] of r.pts) {
    const x = Math.round(c.px(lng) / 3) * 3, y = Math.round(c.py(lat) / 3) * 3;
    const key = x + "," + y;
    const hit = cells.get(key);
    if (hit) hit.n++;
    else cells.set(key, { x, y, n: 1, color: r.color });
  }
  const dots = [...cells.values()];
  console.log("routes", ROUTES.length, "points", all.length, "dots", dots.length);
  encode("/workspace/nio-dash-nas/docs/assets/dots-beijing.gif", W, H, 60, 20, (buf, t) => {
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      const phase = ((i * 7) % 60) / 60;
      const breathe = 0.7 + 0.3 * Math.sin((t + phase) * Math.PI * 2);
      const size = (9 + Math.min(6, Math.log2(d.n + 1) * 2)) * (0.9 + 0.2 * breathe);
      c.blit(buf, d.x, d.y, size, d.color, 0.9 * breathe);
      const life = (t - phase + 1) % 1;
      if (life < 0.55) c.ring(buf, d.x, d.y, 2 + (life / 0.55) * 15, d.color, 0.45 * (1 - life / 0.55) ** 1.6);
    }
  });
}

// B. 回放：每条路线错峰开跑，彗尾 + 亮头
{
  const W = 800, H = 450, FRAMES = 96, FPS = 20;
  const c = makeCanvas(W, H);
  encode("/workspace/nio-dash-nas/docs/assets/playback-beijing.gif", W, H, FRAMES, FPS, (buf, t) => {
    // 底噪：先把整张路网淡淡铺一层，避免开头几帧全黑
    for (const r of ROUTES) {
      for (let k = 0; k < r.pts.length; k += 3) {
        c.blit(buf, c.px(r.pts[k][0]), c.py(r.pts[k][1]), 6, r.color, 0.2);
      }
    }
    for (let i = 0; i < ROUTES.length; i++) {
      const r = ROUTES[i];
      const start = (i / ROUTES.length) * 0.25;
      const p = Math.min(1, Math.max(0, (t - start) / 0.7));
      if (p <= 0) continue;
      const n = r.pts.length;
      const head = Math.floor(p * (n - 1));
      const tailLen = 34;
      for (let k = Math.max(0, head - tailLen); k <= head; k++) {
        const a = ((k - (head - tailLen)) / tailLen) ** 2;
        const [lng, lat] = r.pts[k];
        c.blit(buf, c.px(lng), c.py(lat), 4 + 5 * a, r.color, 0.85 * a);
      }
      const [hlng, hlat] = r.pts[head];
      const hx = c.px(hlng), hy = c.py(hlat);
      c.blit(buf, hx, hy, 22, [255, 255, 255], 0.95, 0.7);
      c.blit(buf, hx, hy, 26, r.color, 0.55);
      c.ring(buf, hx, hy, 12 + 10 * ((t * 3 + i * 0.13) % 1), r.color, 0.4);
    }
  });
}
