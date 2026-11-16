import { PAL, hexRgb, rnd } from './palette';
import { bayer, circle, ditherBands, ellipse, line, makeCanvas, px } from './dither';
import type { Look } from '../../shared/types';
import { BUST_H, BUST_W, bustFor, renderBust, shade, styleSig, type BustLook } from './sprites';

type Ctx = CanvasRenderingContext2D;

/* ================= layout ================= */

export interface Layout {
  vw: number; vh: number;
  P: number; // CSS px per scene pixel
  W: number; H: number; // internal resolution
  cx: number;
  tableTop: number; rx: number; ry: number; cy: number;
  s: number; // sprite scale
  lampLen: number;
  portrait: boolean; // phone-ish portrait: big busts in rows instead of an arc
}

/** Biggest internal canvas we light per frame; P grows past this so huge screens stay cheap. */
const MAX_PIXELS = 150_000;

export function computeLayout(vw: number, vh: number): Layout {
  vw = Math.max(200, vw); vh = Math.max(200, vh);
  let P = Math.max(2, Math.min(6, Math.round(Math.min(vw / 300, vh / 170))));
  while (Math.ceil(vw / P) * Math.ceil(vh / P) > MAX_PIXELS && P < 12) P++;
  const W = Math.ceil(vw / P), H = Math.ceil(vh / P);
  const portrait = W < H;
  const s = Math.max(portrait ? 0.78 : 0.62, Math.min(1, W / 320));
  const tableTop = Math.round(Math.min(H * 0.3, 34 + 60 * s));
  const rx = Math.round(W * 0.75);
  const ry = Math.round(Math.min(H * 0.5, W * 0.3));
  // portrait: busts are tall, so the lamp hangs short to stay clear of their hats
  const lampLen = portrait ? Math.max(6, Math.round(tableTop * 0.1)) : Math.max(8, Math.round(tableTop * 0.24));
  return { vw, vh, P, W, H, cx: Math.floor(W / 2), tableTop, rx, ry, cy: tableTop + ry, s, lampLen, portrait };
}

/** visual slot for a seat: fill from the middle of the arc outward */
const SLOT = [3, 4, 2, 5, 1, 6, 0, 7];

export interface SeatGeom { x: number; top: number; base: number; edge: number; w: number; h: number; depth: number; scale: number; back?: boolean; slot?: number }

export function edgeY(L: Layout, x: number) {
  const k = (x - L.cx) / L.rx;
  return L.cy - L.ry * Math.sqrt(Math.max(0, 1 - k * k));
}

/**
 * Where a seat's bust goes. `seats` is every occupied seat (the same list must be passed by the
 * canvas and the DOM nameplates). Portrait screens use rows of big busts: the first four to sit
 * get the front row, anyone else peeks from a slightly higher, smaller back row.
 */
export function seatGeom(L: Layout, seat: number, seats?: readonly number[]): SeatGeom {
  if (L.portrait && seats && seats.length) {
    const all = [...new Set(seats)].sort((a, b) => a - b);
    if (all.includes(seat)) return rowSeat(L, seat, all);
  }
  const k = SLOT[Math.max(0, Math.min(7, seat | 0))];
  const th = Math.PI * (0.93 - (0.86 * k) / 7);
  const x = Math.round(L.cx + L.W * (L.W < L.H ? 0.4 : 0.45) * Math.cos(th));
  const depth = Math.sin(th);
  const scale = L.s * (1.06 - 0.26 * depth);
  const w = Math.round(BUST_W * scale), h = Math.round(BUST_H * scale);
  const edge = Math.round(edgeY(L, x));
  const base = edge + Math.round(h * 0.3);
  return { x, top: base - h, base, edge, w, h, depth, scale };
}

const slotOf = (seat: number) => SLOT[Math.max(0, Math.min(7, seat | 0))];

function rowSeat(L: Layout, seat: number, all: number[]): SeatGeom {
  const byArc = (a: number, b: number) => slotOf(a) - slotOf(b);
  const front = all.slice(0, 4).sort(byArc);
  const backRow = all.slice(4).sort(byArc);
  const k = front.length;
  const sp = (L.W * 0.94) / k; // slot width per front bust
  const fs = Math.min(1.4, (sp * 1.12) / BUST_W);
  const isBack = !front.includes(seat);
  const row = isBack ? backRow : front;
  const i = row.indexOf(seat), kb = row.length;
  const off = (i - (kb - 1) / 2) * (isBack && kb === 4 ? sp * 0.92 : sp);
  const x = Math.round(L.cx + off);
  const edge = Math.round(edgeY(L, x));
  if (!isBack) {
    const w = Math.round(BUST_W * fs), h = Math.round(BUST_H * fs);
    const base = edge + Math.round(h * 0.3);
    // outer seats sit a touch nearer, so they overlap inward neighbours
    const depth = 0.45 - 0.15 * Math.min(1, Math.abs(off) / (L.W * 0.5));
    return { x, top: base - h, base, edge, w, h, depth, scale: fs, slot: sp };
  }
  const scale = fs * 0.8;
  const w = Math.round(BUST_W * scale), h = Math.round(BUST_H * scale);
  // sits higher so faces peek between the front hats; the front busts' shoulders hide the cut-off bottom
  const base = edge - Math.round(BUST_H * fs * 0.14);
  return { x, top: base - h, base, edge, w, h, depth: 0.92, scale, back: true, slot: sp };
}

/* ================= static layers ================= */

function drawWall(c: Ctx, L: Layout, emis: Uint8Array, cool: Float32Array) {
  const { W, H, tableTop } = L;
  // planks
  let x = 0, k = 0;
  while (x < W) {
    const pw = 9 + Math.floor(rnd(k, 1) * 6);
    const base = k % 3 === 0 ? PAL.wood2 : k % 3 === 1 ? '#33200f' : '#3f2717';
    c.fillStyle = base; c.fillRect(x, 0, pw, H);
    c.fillStyle = PAL.wood0; c.fillRect(x, 0, 1, H);
    c.fillStyle = shade(base, 1.25); c.fillRect(x + 1, 0, 1, H);
    // grain streaks
    for (let g = 0; g < 7; g++) {
      const gx = x + 2 + Math.floor(rnd(k, g, 3) * (pw - 3));
      const gy = Math.floor(rnd(k, g, 4) * H);
      const gl = 6 + Math.floor(rnd(k, g, 5) * 26);
      c.fillStyle = rnd(k, g, 6) > 0.5 ? PAL.wood1 : shade(base, 1.18);
      c.fillRect(gx, gy, 1, gl);
    }
    // knot
    if (rnd(k, 9) > 0.6) { const ky = Math.floor(rnd(k, 10) * H); ellipse(c, x + (pw >> 1), ky, 1, 2, PAL.wood1); px(c, x + (pw >> 1), ky, PAL.wood0); }
    // plank butt joint
    const jy = Math.floor(rnd(k, 11) * H);
    c.fillStyle = PAL.wood0; c.fillRect(x + 1, jy, pw - 1, 1);
    // nails
    for (const ny of [4, Math.round(tableTop * 0.52), jy + 2]) { px(c, x + 2, ny, PAL.metal2); px(c, x + pw - 2, ny, PAL.metal1); }
    x += pw; k++;
  }
  // top shadow band
  for (let y = 0; y < 8; y++) for (let xx = 0; xx < W; xx++) if ((8 - y) / 8 > bayer(xx, y)) px(c, xx, y, PAL.wood0);
  // chair rail + wainscot
  const rail = Math.round(tableTop * 0.8);
  c.fillStyle = PAL.wood0; c.fillRect(0, rail + 3, W, H);
  for (let xx = 0; xx < W; xx += 18) { c.fillStyle = '#1d120a'; c.fillRect(xx + 2, rail + 6, 14, H); c.fillStyle = PAL.wood0; c.fillRect(xx + 3, rail + 7, 12, H); }
  c.fillStyle = PAL.wood3; c.fillRect(0, rail, W, 2);
  c.fillStyle = PAL.wood4; c.fillRect(0, rail, W, 1);
  c.fillStyle = PAL.ink; c.fillRect(0, rail + 2, W, 1);

  // windows
  const ww = Math.round(Math.max(16, Math.min(36, W * 0.11)));
  const wy = Math.max(6, Math.round(tableTop * 0.14));
  const wh = Math.max(14, Math.min(Math.round(ww * 1.45), rail - wy - 8));
  const wl = Math.round(W * 0.1);
  const wins = [wl, W - wl - ww];
  wins.forEach((wx, wi) => {
    // blue spill on wall below/around (cool light map)
    for (let y = wy - 6; y < H; y++) for (let xx = wx - 14; xx < wx + ww + 14; xx++) {
      if (xx < 0 || xx >= W || y < 0) continue;
      const dy = y - (wy + wh);
      const inside = xx >= wx && xx < wx + ww && y >= wy && y < wy + wh;
      let v = 0;
      if (inside) v = 0;
      else if (dy > 0) {
        const spread = (ww / 2) + dy * 0.35;
        const off = Math.abs(xx - (wx + ww / 2) - dy * (wi ? -0.25 : 0.25));
        v = Math.max(0, 1 - off / spread) * Math.max(0, 1 - dy / (H * 0.55)) * 0.85;
      } else {
        const ddx = Math.max(wx - xx, xx - (wx + ww), 0), ddy = Math.max(wy - y, 0);
        v = Math.max(0, 1 - Math.hypot(ddx, ddy) / 12) * 0.6;
      }
      cool[y * W + xx] = Math.max(cool[y * W + xx], v);
    }
    // frame
    c.fillStyle = PAL.ink; c.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    c.fillStyle = PAL.wood3; c.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
    c.fillStyle = PAL.wood4; c.fillRect(wx - 2, wy - 2, ww + 4, 1);
    // sky
    ditherBands(c, wx, wy, ww, wh, [PAL.blue0, PAL.blue1, PAL.blue2, PAL.blue1]);
    for (let i = 0; i < 6; i++) px(c, wx + 1 + Math.floor(rnd(wi, i, 21) * (ww - 2)), wy + 1 + Math.floor(rnd(wi, i, 22) * wh * 0.5), i % 2 ? PAL.blue3 : PAL.moon);
    if (wi === 0) {
      const mx = wx + Math.round(ww * 0.68), my = wy + Math.round(wh * 0.24), mr = Math.max(2, Math.round(ww * 0.16));
      circle(c, mx, my, mr + 2, PAL.blue2);
      circle(c, mx, my, mr, PAL.moon);
      px(c, mx - 1, my, PAL.blue3); px(c, mx + 1, my + 1, PAL.blue3); px(c, mx, my - 2, PAL.blue3);
    }
    // distant mesa silhouette
    for (let xx = 0; xx < ww; xx++) {
      const hgt = Math.round(wh * 0.18 + Math.sin((xx + wi * 13) * 0.35) * 2 + (xx % 7 < 3 ? 2 : 0));
      c.fillStyle = PAL.blue0; c.fillRect(wx + xx, wy + wh - hgt, 1, hgt);
    }
    for (let y = wy; y < wy + wh; y++) for (let xx = wx; xx < wx + ww; xx++) emis[y * W + xx] = 1;
    // mullions
    c.fillStyle = PAL.wood1; c.fillRect(wx + (ww >> 1) - 1, wy, 2, wh); c.fillRect(wx, wy + Math.round(wh * 0.45), ww, 2);
    // sill
    c.fillStyle = PAL.wood3; c.fillRect(wx - 4, wy + wh + 2, ww + 8, 2);
    c.fillStyle = PAL.blue3; c.fillRect(wx - 4, wy + wh + 2, ww + 8, 1);
  });

  // bottle shelf
  const sy = Math.round(tableTop * 0.6);
  const sx0 = Math.round(L.cx - W * 0.17), sx1 = Math.round(L.cx + W * 0.17);
  let bx = sx0 + 2, bi = 0;
  const BOT = ['#1f3318', '#5a2a10', '#2a1a10', '#1e2c3d', '#6b3a12', '#3a0f0f'];
  while (bx < sx1 - 3) {
    if (Math.abs(bx - L.cx) < 6) { bx += 7; continue; }
    const bw = 3 + Math.floor(rnd(bi, 31) * 2), bh = 6 + Math.floor(rnd(bi, 32) * 7);
    const col = BOT[bi % BOT.length];
    c.fillStyle = col; c.fillRect(bx, sy - bh, bw, bh);
    c.fillRect(bx + (bw >> 1), sy - bh - 3, 1, 3);
    px(c, bx + (bw >> 1), sy - bh - 4, PAL.wood1);
    c.fillStyle = shade(col, 1.9); c.fillRect(bx, sy - bh + 1, 1, bh - 2);
    if (bi % 2 === 0) { c.fillStyle = PAL.parch3; c.fillRect(bx, sy - Math.round(bh * 0.6), bw, 2); }
    bx += bw + 1 + Math.floor(rnd(bi, 33) * 3); bi++;
  }
  c.fillStyle = PAL.wood3; c.fillRect(sx0, sy, sx1 - sx0, 2);
  c.fillStyle = PAL.wood4; c.fillRect(sx0, sy, sx1 - sx0, 1);
  c.fillStyle = PAL.ink; c.fillRect(sx0, sy + 2, sx1 - sx0, 1);
  c.fillStyle = PAL.wood1; c.fillRect(sx0 + 3, sy + 3, 2, 4); c.fillRect(sx1 - 5, sy + 3, 2, 4);

  // framed picture (left)
  const fx = Math.round(W * 0.25), fy = Math.max(8, Math.round(tableTop * 0.2)), fw = 14, fh = 11;
  if (fx + fw < sx0 - 1) {
    c.fillStyle = PAL.ink; c.fillRect(fx - 1, fy - 1, fw + 2, fh + 2);
    c.fillStyle = PAL.lamp3; c.fillRect(fx, fy, fw, fh);
    c.fillStyle = PAL.wood4; c.fillRect(fx, fy, fw, 1);
    ditherBands(c, fx + 2, fy + 2, fw - 4, fh - 4, [PAL.blue1, PAL.lamp3, PAL.wood2]);
    for (let i = 0; i < fw - 4; i++) { const hh = 2 + ((i * 7) % 3); c.fillStyle = PAL.wood0; c.fillRect(fx + 2 + i, fy + fh - 2 - hh, 1, hh); }
    line(c, fx + 2, fy - 1, fx + fw / 2, fy - 5, PAL.wood0); line(c, fx + fw - 3, fy - 1, fx + fw / 2, fy - 5, PAL.wood0);
    px(c, fx + fw / 2, fy - 5, PAL.metal3);
  }
  // wanted poster (right)
  const px0 = Math.round(W * 0.7), py0 = Math.max(8, Math.round(tableTop * 0.16)), pw2 = 13, ph = 17;
  if (px0 > sx1 + 1 && px0 + pw2 < W - wl - ww - 4) {
    c.fillStyle = PAL.parch2; c.fillRect(px0, py0, pw2, ph);
    for (let y = py0; y < py0 + ph; y++) for (let xx = px0; xx < px0 + pw2; xx++) {
      const e = Math.min(xx - px0, px0 + pw2 - 1 - xx, y - py0, py0 + ph - 1 - y);
      if (e < 2 && bayer(xx, y) > 0.4) px(c, xx, y, PAL.parch3);
    }
    c.fillStyle = PAL.wood1; c.fillRect(px0 + 2, py0 + 2, pw2 - 4, 2);
    c.fillStyle = PAL.wood2; c.fillRect(px0 + 4, py0 + 5, 5, 5);
    c.fillStyle = PAL.wood1; c.fillRect(px0 + 5, py0 + 5, 3, 1);
    c.fillStyle = PAL.parch3; c.fillRect(px0 + 2, py0 + 12, pw2 - 4, 1); c.fillRect(px0 + 3, py0 + 14, pw2 - 6, 1);
    px(c, px0 + (pw2 >> 1), py0, PAL.metal3);
    c.fillStyle = PAL.red1; c.fillRect(px0 + pw2 - 4, py0 + ph - 4, 2, 2);
  }
}

function drawTable(c: Ctx, L: Layout) {
  const { W, H, cx, cy, rx, ry } = L;
  // floor below everything near the bottom
  for (let y = cy + ry - 2; y < H; y++) {
    c.fillStyle = (y >> 2) % 2 ? PAL.wood0 : PAL.ink; c.fillRect(0, y, W, 1);
  }
  // apron (table thickness)
  ellipse(c, cx, cy + 5, rx, ry, PAL.ink);
  ellipse(c, cx, cy + 3, rx, ry, PAL.wood1);
  ellipse(c, cx, cy, rx, ry, PAL.ink);
  ellipse(c, cx, cy, rx - 1, ry - 1, PAL.wood3);
  ellipse(c, cx, cy + 1, rx - 2, ry - 1, PAL.wood4);
  ellipse(c, cx, cy + 2, rx - 3, ry - 2, PAL.wood3);
  ellipse(c, cx, cy + 3, rx - 6, ry - 6, PAL.wood2);
  ellipse(c, cx, cy + 3, rx - 7, ry - 7, PAL.ink);
  // felt, dithered radial
  const frx = rx - 8, fry = ry - 8;
  for (let y = cy - fry + 3; y < Math.min(H, cy + fry + 3); y++) {
    const ky = (y - cy - 3) / fry;
    const hw = Math.round(frx * Math.sqrt(Math.max(0, 1 - ky * ky)));
    for (let x = Math.max(0, cx - hw); x < Math.min(W, cx + hw); x++) {
      const d = Math.hypot((x - cx) / frx, (y - (cy - fry * 0.4)) / fry);
      const v = 1 - d;
      const b = bayer(x, y);
      const col = v > 0.55 + b * 0.2 ? PAL.felt3 : v > 0.25 + b * 0.25 ? PAL.felt2 : v > b * 0.25 ? PAL.felt1 : PAL.felt0;
      c.fillStyle = rnd(x, y, 55) > 0.97 ? PAL.felt0 : col; c.fillRect(x, y, 1, 1);
    }
  }
  // rim grain
  for (let i = 0; i < rx * 2; i++) {
    const a = rnd(i, 61) * Math.PI;
    const x = Math.round(cx + Math.cos(Math.PI + a) * (rx - 4)), y = Math.round(cy - Math.sin(a) * (ry - 3) + 1);
    px(c, x, y, rnd(i, 62) > 0.5 ? PAL.wood2 : PAL.wood4);
  }
  // props: chips, cards, glass (portrait: the felt is under the UI and the nameplates, skip them)
  if (L.portrait) return;
  const py = L.tableTop + Math.round(L.ry * 0.28);
  const chipX = Math.round(cx - W * 0.3), cardX = Math.round(cx + W * 0.22), glassX = Math.round(cx + W * 0.36);
  const chipCols = [[PAL.red1, PAL.red2], [PAL.parch, PAL.parch3], [PAL.blue2, PAL.blue1], [PAL.red1, PAL.red2]];
  for (let st = 0; st < 3; st++) {
    const sx = chipX + st * 7, n = 3 + ((st * 5) % 4);
    ellipse(c, sx, py + 2, 3, 1, PAL.ink);
    for (let k = 0; k < n; k++) {
      const [a, b] = chipCols[(k + st) % 4];
      c.fillStyle = b; c.fillRect(sx - 3, py - k * 2, 7, 2);
      c.fillStyle = a; c.fillRect(sx - 3, py - k * 2, 7, 1);
      px(c, sx, py - k * 2 + 1, PAL.parch);
    }
    ellipse(c, sx, py - n * 2 + 1, 3, 1, chipCols[(n + st) % 4][0]);
  }
  // cards fanned
  for (let k = 0; k < 3; k++) {
    const x0 = cardX + k * 4, y0 = py - 2 + (k === 1 ? -1 : 0);
    c.fillStyle = PAL.ink; c.fillRect(x0 - 1, y0 - 1, 7, 9);
    c.fillStyle = PAL.parch; c.fillRect(x0, y0, 5, 7);
    px(c, x0 + 2, y0 + 3, k % 2 ? PAL.ink : PAL.red1);
    px(c, x0, y0, k % 2 ? PAL.ink : PAL.red1);
  }
  // whiskey glass
  if (glassX < W - 4) {
    c.fillStyle = PAL.metal1; c.fillRect(glassX - 3, py - 7, 7, 9);
    c.fillStyle = PAL.blue1; c.fillRect(glassX - 2, py - 6, 5, 7);
    c.fillStyle = PAL.lamp3; c.fillRect(glassX - 2, py - 3, 5, 4);
    c.fillStyle = PAL.lamp2; c.fillRect(glassX - 2, py - 3, 5, 1);
    c.fillStyle = PAL.metal4; c.fillRect(glassX - 2, py - 6, 1, 5);
  }
}

/* ================= runtime scene ================= */

export interface ScenePlayer { id: string; seat: number; look: number; style?: Look; connected: boolean }
export interface SceneData {
  players: ScenePlayer[];
  shooter?: string;
  phase: string;
  shot?: { at: number; actor: string; kind: string }; // performance.now() based
  dimAll: number; // 1 normal, lower for roulette/result
}

export class SceneRenderer {
  L: Layout;
  bg: HTMLCanvasElement;
  table: HTMLCanvasElement;
  emis: Uint8Array;
  cool: Float32Array;
  vig: Float32Array;
  sprites = new Map<string, HTMLCanvasElement>();
  looks = new Map<string, BustLook>();
  lampA = 0;
  motes: { x: number; y: number; vx: number; vy: number; p: number }[] = [];
  reduce: boolean;

  constructor(L: Layout, opts: { motes?: number; reduce?: boolean } = {}) {
    this.L = L;
    this.reduce = !!opts.reduce;
    const { W, H } = L;
    this.emis = new Uint8Array(W * H);
    this.cool = new Float32Array(W * H);
    const [bg, bc] = makeCanvas(W, H);
    drawWall(bc, L, this.emis, this.cool);
    this.bg = bg;
    const [tb, tc] = makeCanvas(W, H);
    drawTable(tc, L);
    this.table = tb;
    this.vig = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W * 0.62), dy = (y - H * 0.36) / (H * 0.72);
      const d = Math.sqrt(dx * dx + dy * dy);
      this.vig[y * W + x] = Math.max(0.08, 1 - Math.max(0, d - 0.45) * 1.5);
    }
    for (let i = 0; i < (opts.motes ?? 34); i++) this.motes.push({ x: rnd(i, 1, 9) * W, y: rnd(i, 2, 9) * H * 0.8, vx: (rnd(i, 3, 9) - 0.5) * 2, vy: -0.4 - rnd(i, 4, 9) * 1.2, p: rnd(i, 5, 9) * 6.28 });
  }

  sprite(p: ScenePlayer, g: SeatGeom, blink: boolean, lit: boolean, rimRight: boolean, gun = 0) {
    const dimQ = Math.round((1.08 - 0.32 * g.depth) * 4) / 4;
    const sig = styleSig(p);
    const key = `${p.id}|${sig}|${g.scale.toFixed(3)}|${+blink}|${+lit}|${+rimRight}|${dimQ}|${+!p.connected}|${gun}`;
    let cv = this.sprites.get(key);
    if (!cv) {
      let look = this.looks.get(p.id + sig);
      if (!look) { look = bustFor(p); this.looks.set(p.id + sig, look); }
      cv = renderBust(look, { scale: g.scale, blink, lit, rimRight, dim: lit ? 0.95 : dimQ, ghost: !p.connected, gun });
      if (this.sprites.size > 96) this.sprites.clear();
      this.sprites.set(key, cv);
    }
    return cv;
  }

  /** where the shooter's revolver barrel ends, in scene pixels */
  muzzle(g: SeatGeom) {
    return { x: Math.round(g.x - g.w / 2 + 36 * g.scale), y: Math.round(g.top + 26 * g.scale) };
  }

  frame(c: Ctx, t: number, D: SceneData) {
    const L = this.L;
    const { W, H, cx } = L;
    const sec = t / 1000;
    const shotAge = D.shot ? t - D.shot.at : 1e9;
    // integer screen shake
    let ox = 0, oy = 0;
    if (shotAge < 420 && !this.reduce) {
      const amp = D.shot!.kind === 'ricochet' ? 1 : shotAge < 160 ? 3 : 2;
      ox = Math.round((rnd(Math.floor(t / 60), 1) - 0.5) * 2 * amp);
      oy = Math.round((rnd(Math.floor(t / 60), 2) - 0.5) * 2 * amp);
    }
    c.setTransform(1, 0, 0, 1, ox, oy);
    c.fillStyle = PAL.ink; c.fillRect(-4, -4, W + 8, H + 8);
    c.drawImage(this.bg, 0, 0);

    const seats = D.players.map((p) => p.seat);
    const geoms = D.players.map((p) => ({ p, g: seatGeom(L, p.seat, seats) })).sort((a, b) => b.g.depth - a.g.depth);
    const shooterG = geoms.find((x) => x.p.id === D.shooter);

    // lamp swing (pendulum), biased toward the shooter
    const target = shooterG ? Math.max(-0.35, Math.min(0.35, Math.atan2(shooterG.g.x - cx, L.tableTop * 1.6))) : 0;
    this.lampA += (target - this.lampA) * (this.reduce ? 1 : 0.08);
    const a = this.reduce ? this.lampA : this.lampA + Math.sin(sec * 1.1) * 0.05 + Math.sin(sec * 2.7) * 0.012;
    const lx = Math.round(cx + Math.sin(a) * L.lampLen), ly = Math.round(Math.cos(a) * L.lampLen);

    // players
    for (const { p, g } of geoms) {
      const ph = (p.id.charCodeAt(0) || 0) * 0.37 + p.seat;
      const bob = !this.reduce && Math.sin(sec * 1.6 + ph) > 0.2 ? 1 : 0;
      const blink = ((sec + ph * 1.7) % 4.3) < 0.16;
      const lit = p.id === D.shooter;
      const isActor = !!D.shot && D.shot.actor === p.id;
      const gun = (lit || (isActor && shotAge < 1500)) && !this.reduce ? (isActor && shotAge < 220 && D.shot!.kind !== 'ricochet' ? 2 : 1) : lit ? 1 : 0;
      // everyone else flinches for a moment on each shot
      let jx = 0, jy = 0;
      if (!isActor && shotAge < 260 && !this.reduce) {
        const k = shotAge < 90 ? 2 : 1;
        jx = (rnd(p.seat, Math.floor(shotAge / 70), 5) > 0.5 ? 1 : -1) * k; jy = shotAge < 130 ? 1 : 0;
      }
      const cv = this.sprite(p, g, blink, lit, g.x < lx, gun);
      c.drawImage(cv, Math.round(g.x - cv.width / 2) + jx, g.top + bob + jy + (gun === 2 ? 1 : 0));
    }
    c.drawImage(this.table, 0, 0);

    // chain + lamp body (unlit layer; flame drawn after lighting)
    for (let i = 0; i <= L.lampLen - 2; i++) {
      const xx = Math.round(cx + Math.sin(a) * i), yy = Math.round(Math.cos(a) * i);
      px(c, xx, yy, i % 2 ? PAL.metal2 : PAL.metal1);
    }
    c.fillStyle = PAL.metal1; c.fillRect(lx - 4, ly - 1, 9, 2); c.fillRect(lx - 3, ly - 2, 7, 1);
    c.fillStyle = PAL.metal2; c.fillRect(lx - 4, ly - 1, 9, 1);
    c.fillStyle = PAL.wood1; c.fillRect(lx - 3, ly + 8, 7, 3);
    c.fillStyle = PAL.wood3; c.fillRect(lx - 3, ly + 8, 7, 1);

    // ---- lighting pass
    const img = c.getImageData(0, 0, W, H);
    const d = img.data;
    const flick = this.reduce ? 0.95 : 0.9 + 0.1 * Math.sin(sec * 9.3) * Math.sin(sec * 3.1 + 1) + (rnd(Math.floor(t / 80), 7) > 0.93 ? -0.18 : 0);
    const amb = (D.shooter ? 0.42 : 0.52) * D.dimAll;
    const R = W * 0.55;
    const tanA = Math.tan(a);
    const flash = shotAge < 140 ? 1.6 * (1 - shotAge / 140) : 0;
    const flashAct = D.shot && flash > 0 ? geoms.find((x) => x.p.id === D.shot!.actor) : undefined;
    const fM = flashAct ? this.muzzle(flashAct.g) : null;
    const fX = fM ? fM.x : cx, fY = fM ? fM.y : L.tableTop;
    const sp = shooterG ? { x: shooterG.g.x, y: shooterG.g.top + shooterG.g.h * 0.45, r: shooterG.g.h * 0.75 } : null;
    const lampK = D.dimAll;
    for (let y = 0; y < H; y++) {
      const dy = y - ly;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        if (this.emis[i]) {
          const k = 0.75 * D.dimAll + 0.25;
          d[o] *= k; d[o + 1] *= k; d[o + 2] *= k; continue;
        }
        const dx = x - lx;
        const dist = Math.sqrt(dx * dx + dy * dy * 1.3);
        let lamp = Math.max(0, 1 - dist / R);
        lamp = lamp * lamp * 0.95;
        if (dy > 0) {
          const ax = Math.abs(dx - tanA * dy), hw = 3 + dy * 0.42;
          if (ax < hw) lamp += 0.5 * Math.sqrt(1 - ax / hw) * Math.max(0, 1 - dy / (H * 0.9));
        }
        lamp *= flick * lampK;
        if (sp) {
          const sdx = x - sp.x, sdy = (y - sp.y) * 0.8;
          const v = 1 - Math.sqrt(sdx * sdx + sdy * sdy) / sp.r;
          if (v > 0) lamp += v * 0.42;
        }
        if (flash > 0) {
          const v = 1 - Math.hypot(x - fX, y - fY) / (W * 0.5);
          if (v > 0) lamp += v * flash;
        }
        const b = bayer(x, y);
        const lq = Math.floor(lamp * 5 + b) / 5;
        const av = amb * this.vig[i];
        const aq = Math.floor(av * 7 + b) / 7;
        const cl = Math.floor(this.cool[i] * 3 + b) / 3 * 0.35 * D.dimAll;
        d[o] = d[o] * (aq * 0.85 + lq * 1.3 + cl * 0.2);
        d[o + 1] = d[o + 1] * (aq * 0.9 + lq * 1.0 + cl * 0.6);
        d[o + 2] = d[o + 2] * (aq * 1.12 + lq * 0.62 + cl * 1.5);
      }
    }
    c.putImageData(img, 0, 0);

    // ---- emissive layer: lamp glass + flame
    const fh = 4 + (rnd(Math.floor(t / 90), 3) > 0.5 ? 1 : 0);
    c.fillStyle = shade(PAL.lamp1, 0.8 * lampK + 0.2); c.fillRect(lx - 2, ly + 1, 5, 7);
    c.fillStyle = PAL.lamp2; c.fillRect(lx - 3, ly + 2, 1, 5); c.fillRect(lx + 3, ly + 2, 1, 5);
    c.fillStyle = PAL.lamp0; c.fillRect(lx - 1, ly + 7 - fh, 3, fh);
    c.fillStyle = PAL.white; c.fillRect(lx, ly + 8 - fh, 1, fh - 1);
    // halo ring dither
    for (let yy = -9; yy <= 12; yy++) for (let xx = -9; xx <= 9; xx++) {
      const r = Math.hypot(xx, (yy - 4) * 1.1);
      if (r < 5 || r > 9) continue;
      if ((1 - (r - 5) / 4) * 0.5 * flick * lampK > bayer(lx + xx, ly + yy)) px(c, lx + xx, ly + yy, PAL.lamp2);
    }

    // ---- dust motes in the light
    for (const m of this.motes) {
      m.x += m.vx * 0.25 + Math.sin(sec + m.p) * 0.15; m.y += m.vy * 0.25;
      if (m.y < 0) { m.y = H * 0.8; m.x = rnd(Math.floor(t), m.p * 100) * W; }
      if (m.x < 0) m.x += W; if (m.x > W) m.x -= W;
      const mx = Math.round(m.x), my = Math.round(m.y);
      const ddy = my - ly;
      const inCone = ddy > 0 && Math.abs(mx - lx - tanA * ddy) < 3 + ddy * 0.42;
      const near = Math.hypot(mx - lx, ddy) < W * 0.25;
      if (inCone || near) px(c, mx, my, Math.sin(sec * 2 + m.p) > 0 ? PAL.lamp1 : PAL.parch2);
      else if (this.cool[Math.min(W * H - 1, Math.max(0, my * W + mx))] > 0.3) px(c, mx, my, PAL.blue2);
    }

    // ---- muzzle flash + smoke at the shooter
    if (D.shot && shotAge < 2200) {
      const act = geoms.find((x) => x.p.id === D.shot!.actor);
      if (act) {
        const mz = this.muzzle(act.g);
        const gx = mz.x, gy = mz.y - 1;
        if (shotAge < 130 && D.shot.kind !== 'ricochet') {
          const r = shotAge < 60 ? 7 : 5;
          for (let k = 0; k < 8; k++) { const an = k * 0.785 + 0.3; line(c, gx, gy, gx + Math.cos(an) * r * (k % 2 ? 0.6 : 1), gy + Math.sin(an) * r * (k % 2 ? 0.6 : 1), PAL.lamp1); }
          circle(c, gx, gy, 3, PAL.lamp0); circle(c, gx, gy, 1, PAL.white);
        }
        if (shotAge > 60) {
          const age = (shotAge - 60) / 2140;
          for (let k = 0; k < 4; k++) {
            const sx = gx + Math.round((k - 1.5) * 3 + Math.sin(age * 6 + k) * 3), sy = gy - Math.round(age * 26 + k * 3);
            const r = Math.round(2 + age * 6 + (k % 2));
            for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
              const v = 1 - Math.hypot(xx, yy) / r;
              if (v > 0 && v * (1 - age) * 1.4 > bayer(sx + xx, sy + yy)) px(c, sx + xx, sy + yy, v > 0.5 ? '#8a7e70' : '#5b5249');
            }
          }
        }
      }
    }
  }
}

export function rgbOf(hex: string) { return hexRgb(hex); }
