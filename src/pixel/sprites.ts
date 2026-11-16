import { PAL, hashStr, hexRgb, rnd } from './palette';
import { bayer, circle, ellipse, line, makeCanvas, px } from './dither';

type Ctx = CanvasRenderingContext2D;

/* ================= gunslinger bust ================= */

export const BUST_W = 48;
export const BUST_H = 56;

const HAT_COLS = ['#3b2416', '#1a1310', '#5a3a22', '#2c2620', '#6b4a2a', '#24180f', '#3d2b22', '#4a3524'];
const HAT_BANDS = [PAL.red2, PAL.wood0, PAL.lamp3, PAL.blue1, PAL.parch3, PAL.red1, PAL.wood0, PAL.metal2];
const COATS = ['#3b2416', '#22252b', '#4a2c1a', '#2e2a20', '#3a1a16', '#1e2c3d', '#5a4630', '#26301c'];
const SCARVES = [PAL.red1, '#b5651d', PAL.blue2, '#7a1414', '#6b1d4a', '#a8841f', PAL.red1, '#2f5d3a'];
const SKINS: [string, string, string][] = [
  [PAL.skin0, PAL.skin1, PAL.skin2],
  [PAL.skin1, PAL.skin2, PAL.skin3],
  ['#3e271a', PAL.skin0, PAL.skin1],
  [PAL.skin0, PAL.skin2, PAL.skin3],
];
const HAIRS = ['#1a110b', '#3b2416', '#6e4a2a', '#8a8580', '#a0522d', '#0b0705'];
const GLINTS = [PAL.lamp1, PAL.parch, PAL.blue3, PAL.lamp0];

export interface BustLook {
  hat: number; // 0 cattleman, 1 bowler, 2 top hat, 3 sombrero, 4 bandana wrap
  hatCol: string; band: string; coat: string; scarf: string;
  skin: [string, string, string]; hair: string; facial: number; glint: string;
}

export function bustLook(look: number, id: string): BustLook {
  const l = ((look % 8) + 8) % 8;
  const h = hashStr(id || String(look));
  const HAT_BY_LOOK = [0, 1, 2, 3, 0, 4, 2, 0];
  return {
    hat: (h >>> 20) % 5 === 0 ? (HAT_BY_LOOK[l] + 1 + ((h >>> 3) % 4)) % 5 : HAT_BY_LOOK[l],
    hatCol: HAT_COLS[(l + (h & 1)) % 8],
    band: HAT_BANDS[(l + (h >>> 5)) % 8],
    coat: COATS[l],
    scarf: SCARVES[(l + ((h >>> 9) % 3 === 0 ? 3 : 0)) % 8],
    skin: SKINS[(h >>> 11) % 4],
    hair: HAIRS[(h >>> 14) % HAIRS.length],
    facial: (h >>> 17) % 4, // 0 beard, 1 stubble, 2 moustache, 3 clean
    glint: GLINTS[(h >>> 23) % 4],
  };
}

export interface BustOpts {
  scale: number; // 1 = 48x56
  blink: boolean;
  rimRight: boolean; // lamp is to the right of this player
  lit: boolean; // current shooter
  dim: number; // 0..1 multiplier for distance darkening
  ghost: boolean;
}

/** Draws a bust into a fresh offscreen canvas. Rim light computed from the silhouette. */
export function renderBust(L: BustLook, o: BustOpts): HTMLCanvasElement {
  const s = o.scale;
  const W = Math.max(8, Math.round(BUST_W * s));
  const H = Math.max(8, Math.round(BUST_H * s));
  const [cv, c] = makeCanvas(W, H);
  const X = (v: number) => Math.round(v * s);
  const R = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(X(x), X(y), Math.max(1, X(x + w) - X(x)), Math.max(1, X(y + h) - X(y)));
  };
  const E = (cx: number, cy: number, rx: number, ry: number, col: string) => ellipse(c, X(cx), X(cy), Math.max(1, X(rx)), Math.max(1, X(ry)), col);
  const [sk0, sk1, sk2] = L.skin;

  // --- coat / shoulders
  for (let y = 29; y < 56; y++) {
    const t = Math.min(1, (y - 29) / 7);
    const hw = Math.round(9 + 14 * Math.sqrt(t));
    R(24 - hw, y, hw * 2, 1, L.coat);
  }
  // coat shading: darker under-chest dither
  const coatD = shade(L.coat, 0.55);
  c.fillStyle = coatD;
  for (let y = X(38); y < H; y++) for (let x = 0; x < W; x++) {
    const t = (y - X(38)) / Math.max(1, H - X(38));
    const yy = y / s, tt = Math.min(1, (yy - 29) / 7), hw = 9 + 14 * Math.sqrt(Math.max(0, tt));
    if (t * 1.3 > bayer(x, y) && Math.abs(x / s - 24) < hw - 0.5) c.fillRect(x, y, 1, 1);
  }
  // lapels + shirt
  R(21, 30, 6, 14, '#1a120c');
  R(22, 31, 4, 12, PAL.parch3);
  line(c, X(19), X(30), X(22), X(46), PAL.ink);
  line(c, X(29), X(30), X(26), X(46), PAL.ink);
  // buttons / badge pocket glint
  R(24, 39, 1, 1, PAL.metal3);
  // raised collar
  R(15, 28, 4, 4, L.coat); R(29, 28, 4, 4, L.coat);
  // neck
  R(20, 24, 8, 6, sk0);

  // --- bandana (neck wrap + triangle)
  R(17, 27, 14, 2, L.scarf);
  for (let i = 0; i < 7; i++) R(18 + i, 29 + i, Math.max(1, 12 - i * 2), 1, L.scarf);
  R(19, 29, 10, 1, PAL.red2);
  R(24, 31, 1, 3, PAL.red2);

  // --- head
  E(24, 17, 10, 10, sk1);
  E(24, 25, 7, 3, sk1); // jaw
  // brim shadow over upper face (face mostly in shadow)
  const brimShadow = L.hat === 4 ? 13 : 19;
  for (let y = X(6); y < X(brimShadow + 3); y++) for (let x = X(13); x < X(36); x++) {
    const t = (X(brimShadow + 3) - y) / Math.max(1, X(5));
    if (y < X(brimShadow) || t > bayer(x, y)) { c.fillStyle = sk0; if (inHead(x / s, y / s)) c.fillRect(x, y, 1, 1); }
  }
  // cheek highlight (very subtle)
  R(17, 21, 2, 1, sk2);
  // nose
  R(24, 18, 1, 3, sk2); R(25, 21, 1, 1, sk0);
  // eyes
  if (!o.blink) {
    R(19, 16, 3, 1, PAL.ink); R(27, 16, 3, 1, PAL.ink);
    R(o.rimRight ? 21 : 19, 16, 1, 1, L.glint);
    R(o.rimRight ? 29 : 27, 16, 1, 1, L.glint);
  } else {
    R(19, 17, 3, 1, '#2a1a10'); R(27, 17, 3, 1, '#2a1a10');
  }
  // facial hair
  if (L.facial === 0) {
    E(24, 25, 8, 4, L.hair);
    R(16, 19, 2, 6, L.hair); R(31, 19, 2, 6, L.hair);
    R(21, 23, 7, 1, PAL.ink);
  } else if (L.facial === 1) {
    for (let y = X(21); y < X(29); y++) for (let x = X(16); x < X(33); x++) {
      if (inHead(x / s, y / s) && rnd(x, y, 7) > 0.55) px(c, x, y, L.hair);
    }
    R(22, 24, 5, 1, PAL.ink);
  } else if (L.facial === 2) {
    R(20, 22, 9, 2, L.hair); R(19, 23, 1, 2, L.hair); R(29, 23, 1, 2, L.hair);
    R(22, 25, 5, 1, PAL.ink);
  } else {
    R(22, 24, 5, 1, sk0);
  }
  // hair at temples
  if (L.hat !== 4) { R(14, 12, 2, 6, L.hair); R(32, 12, 2, 6, L.hair); }

  // --- hat
  const hc = L.hatCol;
  const hd = shade(hc, 0.6);
  const hl = shade(hc, 1.45);
  switch (L.hat) {
    case 0: // cattleman, wide brim, pinched crown
      E(24, 12, 21, 3, hd);
      E(24, 11, 21, 2, hc);
      R(15, 2, 18, 9, hc);
      R(17, 1, 6, 1, hc); R(26, 1, 6, 1, hc);
      R(23, 2, 3, 2, hd); // pinch
      R(15, 8, 18, 2, L.band);
      R(4, 11, 40, 1, hl);
      break;
    case 1: // bowler
      E(24, 9, 10, 8, hc);
      R(13, 9, 22, 3, hc);
      E(24, 12, 13, 2, hd);
      R(14, 9, 20, 2, L.band);
      R(18, 3, 4, 1, hl);
      break;
    case 2: // top hat
      R(16, -4, 16, 15, hc);
      R(16, -4, 16, 1, hl);
      R(16, 7, 16, 3, L.band);
      E(24, 12, 14, 2, hd);
      R(11, 11, 26, 1, hl);
      break;
    case 3: // sombrero-ish
      E(24, 13, 24, 4, hd);
      E(24, 12, 23, 3, hc);
      for (let i = 0; i < 9; i++) R(18 - i * 0.5, 2 + i, 12 + i, 1, hc);
      R(14, 9, 20, 2, L.band);
      R(2, 12, 44, 1, hl);
      for (let x = 4; x < 44; x += 4) R(x, 14, 1, 1, L.band);
      break;
    default: // bandana-only head wrap
      E(24, 10, 11, 6, L.scarf);
      R(13, 10, 22, 3, L.scarf);
      R(13, 12, 22, 1, PAL.red2);
      R(34, 11, 3, 2, L.scarf); R(35, 13, 2, 3, L.scarf); R(36, 16, 1, 2, PAL.red2);
      for (let i = 0; i < 5; i++) R(16 + i * 4, 7 + (i % 2), 1, 1, shade(L.scarf, 1.5));
  }

  // --- post pass: rim light, back light, dim/ghost
  const img = c.getImageData(0, 0, W, H);
  const d = img.data;
  const dir = o.rimRight ? 1 : -1;
  const A = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]);
  const rim1 = hexRgb(o.lit ? PAL.lamp0 : PAL.lamp1);
  const rim2 = hexRgb(o.lit ? PAL.lamp1 : PAL.lamp2);
  const back = hexRgb(PAL.blue3);
  const out = new Uint8ClampedArray(d);
  const dim = Math.max(0.25, Math.min(1.2, o.dim));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (!A(x + dir, y)) {
      [r, g, b] = mix([r, g, b], rim1, o.lit ? 0.95 : 0.8);
    } else if (!A(x + 2 * dir, y) || (!A(x + dir, y - 1) && y < H * 0.55)) {
      [r, g, b] = mix([r, g, b], rim2, o.lit ? 0.6 : 0.45);
    } else if (o.lit && !A(x + 3 * dir, y) && bayer(x, y) > 0.5) {
      [r, g, b] = mix([r, g, b], rim2, 0.3);
    } else if (!A(x - dir, y)) {
      [r, g, b] = mix([r, g, b], back, 0.35);
    }
    r *= dim; g *= dim; b *= dim;
    if (o.ghost) { const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.8; r = g = b = l; out[i + 3] = bayer(x, y) > 0.5 ? 150 : 90; }
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
  c.putImageData(new ImageData(out, W, H), 0, 0);
  return cv;
}

function inHead(x: number, y: number) {
  const dx = (x - 24) / 10.5, dy = (y - 17.5) / 11;
  return dx * dx + dy * dy <= 1.05 || (y > 22 && y < 29 && Math.abs(x - 24) < 8.5);
}

function mix(a: number[], b: number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(hex: string, k: number): string {
  const [r, g, b] = hexRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/* ================= small FX / UI sprites (for PixelSprite) ================= */

export type DrawFn = (c: Ctx, w: number, h: number) => void;

export const drawHole: DrawFn = (c, w, h) => {
  const cx = w >> 1, cy = h >> 1;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3, r = 4 + (i % 3);
    line(c, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PAL.parch3);
  }
  circle(c, cx, cy, 3, PAL.wood2);
  circle(c, cx, cy, 2, PAL.ink);
  px(c, cx - 2, cy - 3, PAL.parch);
};

export const drawSmoke: DrawFn = (c, w, h) => {
  const cx = w / 2, cy = h / 2;
  const blobs: [number, number, number][] = [[0, 0, 0.42], [-0.22, 0.12, 0.3], [0.24, 0.1, 0.3], [0.05, -0.2, 0.28]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (const [bx, by, br] of blobs) {
      const dx = (x - cx) / w - bx, dy = (y - cy) / h - by;
      v = Math.max(v, 1 - Math.sqrt(dx * dx + dy * dy) / br);
    }
    if (v <= 0) continue;
    if (v * 1.6 > bayer(x, y)) px(c, x, y, v > 0.55 ? '#b9ab98' : v > 0.3 ? '#8a7e70' : '#5b5249');
  }
};

export const drawStar: DrawFn = (c, w, h) => {
  const cx = (w - 1) / 2, cy = (h - 1) / 2, R = w * 0.48, r = w * 0.2;
  const poly: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : r;
    poly.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inPoly(x + 0.5, y + 0.5, poly)) continue;
    const t = (x + y) / (w + h);
    const col = t < 0.35 ? PAL.metal4 : t < 0.5 ? PAL.white : t < 0.7 ? PAL.metal3 : PAL.metal2;
    px(c, x, y, col);
  }
  // outline
  const img = c.getImageData(0, 0, w, h);
  const a = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && img.data[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!a(x, y) && (a(x + 1, y) || a(x - 1, y) || a(x, y + 1) || a(x, y - 1))) px(c, x, y, '#2a2520');
  }
  circle(c, Math.round(cx), Math.round(cy), Math.max(1, Math.round(w * 0.1)), PAL.metal2);
};

export const drawFlash: DrawFn = (c, w, h) => {
  const cx = w >> 1, cy = h >> 1;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + 0.2;
    const r = (i % 2 ? 0.3 : 0.5) * w;
    line(c, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PAL.lamp1);
  }
  circle(c, cx, cy, Math.round(w * 0.22), PAL.lamp2);
  circle(c, cx, cy, Math.round(w * 0.16), PAL.lamp1);
  circle(c, cx, cy, Math.round(w * 0.09), PAL.white);
};

export const drawCrack: DrawFn = (c, w, h) => {
  const cx = Math.round(w * 0.55), cy = Math.round(h * 0.4);
  const rays: [number, number][] = [[-0.9, -0.8], [0.7, -0.9], [1, 0.2], [0.4, 1], [-0.6, 0.9], [-1, 0.1]];
  for (const [dx, dy] of rays) {
    let x = cx, y = cy;
    for (let k = 0; k < 4; k++) {
      const nx = x + dx * w * 0.12 + (rnd(x, y, k) - 0.5) * 4, ny = y + dy * h * 0.1 + (rnd(y, x, k) - 0.5) * 4;
      line(c, x, y, nx, ny, PAL.ink);
      line(c, x + 1, y, nx + 1, ny, 'rgba(232,213,181,.55)');
      x = nx; y = ny;
    }
  }
  circle(c, cx, cy, 2, PAL.ink);
};

export const crosshairDraw = (col: string): DrawFn => (c, w, h) => {
  const cx = w >> 1, cy = h >> 1, r = Math.round(w * 0.3);
  for (let a = 0; a < 360; a += 3) {
    const t = (a * Math.PI) / 180;
    px(c, Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), col);
  }
  c.fillStyle = col;
  c.fillRect(cx, 2, 1, cy - r - 1); c.fillRect(cx, cy + r + 2, 1, h - cy - r - 4);
  c.fillRect(2, cy, cx - r - 1, 1); c.fillRect(cx + r + 2, cy, w - cx - r - 4, 1);
  c.fillRect(cx, cy, 1, 1);
};

/** one bullet-hole decal drawn straight into a box-art canvas */
export function holeAt(c: Ctx, x: number, y: number) {
  px(c, x - 1, y - 2, PAL.parch3); px(c, x + 2, y + 1, PAL.parch3); px(c, x - 2, y + 1, PAL.parch3);
  c.fillStyle = PAL.wood2; c.fillRect(x - 1, y - 1, 3, 3);
  c.fillStyle = PAL.ink; c.fillRect(x, y - 1, 1, 3); c.fillRect(x - 1, y, 3, 1);
}

function inPoly(x: number, y: number, poly: [number, number][]) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
