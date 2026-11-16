import { PAL, hexRgb, rnd } from './palette';
import { bayer, circle, ditherBands, ellipse, line, makeCanvas, px } from './dither';
import type { Look } from '../../shared/types';
import { peekPixelized, pixelize } from './pixelize';
import { BUST_H, BUST_W, bustFor, poseKey, renderBust, shade, styleSig, type BustLook, type Pose } from './sprites';

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

interface Rect { x: number; y: number; w: number; h: number }
interface WinGeo extends Rect { mesa: number[]; mull: Rect[] }
/** where the dynamic bits of the back wall live (filled in by drawWall) */
interface WallGeo {
  wins: WinGeo[];
  door: Rect | null; // doorway opening (batwing doors swing in it)
  piano: { x: number; floor: number } | null;
  shelf: { x0: number; x1: number; y: number };
  /** every wall fixture's footprint (frames, sills, shelf, piano, pictures): nothing may overlap */
  decor?: Rect[];
  /** the wanted poster's spot (big = room for the "LAST TIME" cover poster) + the bare wall under it */
  poster?: PosterSpot;
  /** each bottle on the shelf (cork included) + the shelf strip above the plank without / with the bottles (the cat knocks them off) */
  bottles?: (Rect & { col: string })[];
  shelfStrip?: { x: number; y: number; bare: ImageData; full: ImageData };
}
/** what the shelf cat does when you tap it */
export type CatAct = 'meow' | 'hiss' | 'knock' | 'leap';
const CAT_ACTS: CatAct[] = ['meow', 'hiss', 'knock', 'leap'];
const CAT_MS: Record<CatAct, number> = { meow: 1800, hiss: 1500, knock: 2600, leap: 950 };
/** a knocked bottle: falling, then shards */
interface Fall { cv: HTMLCanvasElement; x: number; y: number; vx: number; vy: number; rot: number; spin: number; ground: number; col: string }
interface Shard { x: number; y: number; vx: number; vy: number; life: number; col: string }
interface PosterSpot extends Rect { big: boolean; under: ImageData }

/** "LAST TIME" poster: parchment 18x35, two caption lines in a 3x5 font over a 12x18 cover */
const POSTER = { w: 18, h: 35, art: { x: 3, y: 15, w: 12, h: 18 } };
const FONT3: Record<string, string[]> = {
  L: ['#..', '#..', '#..', '#..', '###'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
};
function text3(c: Ctx, s: string, x: number, y: number, col: string) {
  c.fillStyle = col;
  for (const ch of s) {
    const g = FONT3[ch];
    if (g) g.forEach((row, yy) => { for (let xx = 0; xx < 3; xx++) if (row[xx] === '#') c.fillRect(x + xx, y + yy, 1, 1); });
    x += 4;
  }
}
/** parchment with burnt, dithered edges + a nail */
function parchment(c: Ctx, x0: number, y0: number, w: number, h: number) {
  c.fillStyle = PAL.parch2; c.fillRect(x0, y0, w, h);
  for (let y = y0; y < y0 + h; y++) for (let xx = x0; xx < x0 + w; xx++) {
    const e = Math.min(xx - x0, x0 + w - 1 - xx, y - y0, y0 + h - 1 - y);
    if (e < 2 && bayer(xx, y) > 0.4) px(c, xx, y, PAL.parch3);
  }
}
/** (re)paint the wanted poster in its spot: the generic one, or the last game's cover when `art` is given */
function paintPoster(c: Ctx, sp: PosterSpot, art: HTMLCanvasElement | null) {
  c.putImageData(sp.under, sp.x, sp.y);
  if (art && sp.big) {
    const { x, y, w, h } = sp;
    parchment(c, x, y, w, h);
    // torn corner + drop shadow on the wall
    px(c, x + w - 1, y + h - 1, PAL.wood0); px(c, x + w - 2, y + h - 1, PAL.wood0); px(c, x + w - 1, y + h - 2, PAL.wood0);
    const a = POSTER.art;
    c.fillStyle = PAL.ink; c.fillRect(x + a.x - 1, y + a.y - 1, a.w + 2, a.h + 2);
    c.drawImage(art, x + a.x, y + a.y, a.w, a.h);
    // caption on top (like WANTED), so it still reads when a hat hides the bottom of the poster
    text3(c, 'LAST', x + 2, y + 2, PAL.wood1);
    text3(c, 'TIME', x + 2, y + 8, PAL.red2);
    px(c, x + (w >> 1), y, PAL.metal3);
    return;
  }
  // generic: 13x17, top-centred in the spot
  const px0 = sp.x + ((sp.w - 13) >> 1), py0 = sp.y + (sp.big ? 4 : 0), pw2 = 13, ph = 17;
  parchment(c, px0, py0, pw2, ph);
  c.fillStyle = PAL.wood1; c.fillRect(px0 + 2, py0 + 2, pw2 - 4, 2);
  c.fillStyle = PAL.wood2; c.fillRect(px0 + 4, py0 + 5, 5, 5);
  c.fillStyle = PAL.wood1; c.fillRect(px0 + 5, py0 + 5, 3, 1);
  c.fillStyle = PAL.parch3; c.fillRect(px0 + 2, py0 + 12, pw2 - 4, 1); c.fillRect(px0 + 3, py0 + 14, pw2 - 6, 1);
  px(c, px0 + (pw2 >> 1), py0, PAL.metal3);
  c.fillStyle = PAL.red1; c.fillRect(px0 + pw2 - 4, py0 + ph - 4, 2, 2);
}

const DOOR_OUT = (c: Ctx, d: Rect, dawn: boolean, sun = false) => {
  // the street outside: sky, a far false-front building, mud
  ditherBands(c, d.x, d.y, d.w, d.h, dawn ? ['#3a2c5a', '#c4587a', '#ff8a3d', '#ffd39a'] : [PAL.blue0, PAL.blue1, PAL.blue1, PAL.blue2]);
  const bh = Math.round(d.h * 0.42);
  c.fillStyle = dawn ? '#4a2438' : '#0a1018'; c.fillRect(d.x, d.y + d.h - bh, d.w, bh);
  c.fillRect(d.x + 2, d.y + d.h - bh - 3, Math.max(2, d.w - 6), 3);
  px(c, d.x + Math.round(d.w * 0.7), d.y + d.h - bh + 3, dawn ? '#ffd39a' : PAL.lamp1);
  px(c, d.x + Math.round(d.w * 0.3), d.y + d.h - bh + 4, dawn ? '#c4587a' : PAL.lamp3);
  if (sun) circle(c, d.x + Math.round(d.w * 0.62), d.y + Math.round(Math.min(d.h * 0.24, d.h - bh - 4)), Math.max(2, Math.round(d.w * 0.16)), '#fff3c4');
  c.fillStyle = dawn ? '#5a3a22' : '#140c08'; c.fillRect(d.x, d.y + d.h - 3, d.w, 3);
  // jambs + lintel in shadow: the opening reads as a recess in the wall
  c.fillStyle = PAL.ink; c.fillRect(d.x, d.y, d.w, 1); c.fillRect(d.x, d.y, 1, d.h); c.fillRect(d.x + d.w - 1, d.y, 1, d.h);
};

function drawPiano(c: Ctx, x: number, floor: number) {
  // upright piano, back to the wall; ~24 x 20
  const w = 24, top = floor - 20;
  c.fillStyle = PAL.ink; c.fillRect(x - 1, top - 1, w + 2, 21);
  c.fillStyle = '#2a120c'; c.fillRect(x, top, w, 19);
  c.fillStyle = '#3e1c12'; c.fillRect(x, top, w, 2); c.fillRect(x + 2, top + 3, w - 4, 6);
  c.fillStyle = '#4e2618'; c.fillRect(x + 3, top + 4, w - 6, 1);
  c.fillStyle = PAL.lamp3; px(c, x + 6, top + 6, PAL.lamp3); px(c, x + w - 7, top + 6, PAL.lamp3);
  // sheet music + candle
  c.fillStyle = PAL.parch2; c.fillRect(x + 8, top - 4, 8, 5); c.fillStyle = PAL.parch3; c.fillRect(x + 9, top - 3, 6, 1); c.fillRect(x + 9, top - 1, 5, 1);
  c.fillStyle = PAL.parch; c.fillRect(x + 2, top - 4, 2, 4); px(c, x + 2, top - 5, PAL.lamp1);
  // keyboard
  const ky = top + 10;
  c.fillStyle = PAL.ink; c.fillRect(x - 1, ky, w + 2, 4);
  c.fillStyle = PAL.parch; c.fillRect(x, ky + 1, w, 2);
  for (let i = 1; i < w; i += 2) if (i % 7 !== 5) px(c, x + i, ky + 1, PAL.ink);
  // legs + lower panel
  c.fillStyle = '#1f0d08'; c.fillRect(x + 1, ky + 4, w - 2, floor - ky - 4);
  c.fillStyle = '#3e1c12'; c.fillRect(x + 1, floor - 2, 3, 2); c.fillRect(x + w - 4, floor - 2, 3, 2);
  // stool
  c.fillStyle = PAL.ink; c.fillRect(x + 7, floor - 5, 10, 2); c.fillStyle = PAL.wood3; c.fillRect(x + 8, floor - 5, 8, 1);
  c.fillStyle = PAL.wood1; c.fillRect(x + 9, floor - 3, 1, 3); c.fillRect(x + 14, floor - 3, 1, 3);
}

function drawWall(c: Ctx, L: Layout, emis: Uint8Array, cool: Float32Array, geo: WallGeo) {
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

  // ---- back-wall layout, decided up front so nothing overlaps:
  //   [left window] [picture] [shelf + bottles] [poster] [door] [right window]
  // The batwing doorway gets its own column between the shelf and the right window when there is
  // room (desktop / landscape); otherwise (portrait phones) it takes the right window's column and
  // that window goes. Its lintel sits just under the window heads and it runs down to the table edge.
  const ww = Math.round(Math.max(16, Math.min(36, W * 0.11)));
  const wy = Math.max(6, Math.round(tableTop * 0.14));
  const wh = Math.max(14, Math.min(Math.round(ww * (L.portrait ? 1.8 : 1.45)), rail - wy - 8));
  const wl = Math.round(W * 0.1);
  const sy = Math.round(tableTop * 0.6);
  const sx0 = Math.round(L.cx - W * 0.17), sx1 = Math.round(L.cx + W * 0.17);
  const winR = W - wl - ww;
  const used: Rect[] = [];
  const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
  const hits = (r: Rect, m = 1) => r.x - m < 0 || r.x + r.w + m > W || used.some((u) => r.x - m < u.x + u.w && r.x + r.w + m > u.x && r.y - m < u.y + u.h && r.y + r.h + m > u.y);
  // the table edge dips toward the sides: the doorway runs down to wherever it is lowest under it
  const floorUnder = (x0: number, x1: number) => { let m = 0; for (let xx = x0; xx <= x1; xx++) m = Math.max(m, Math.round(edgeY(L, xx))); return m + 1; };
  const doorTop = wy + Math.round(wh * 0.15);
  let door: Rect | null = null;
  let dropRight = false;
  {
    // mid: between the shelf (bottle tops included) and the right window, frames clear by 2px
    const gapL = sx1 + 5, gapR = winR - 8;
    const bottom = floorUnder(gapL, gapR);
    // about a window and a third tall: the lintel lands a little under the window heads
    const dh = Math.min(bottom - doorTop, Math.round(wh * 1.35));
    const dw = Math.min(28, Math.max(16, Math.round(dh * 0.52)), gapR - gapL);
    if (!L.portrait && dw >= 16 && dh >= 20) door = { x: Math.round((gapL + gapR) / 2 - dw / 2), y: bottom - dh, w: dw, h: dh };
    else {
      // the right window's column (portrait: taller than a window, so the lintel and the tops of the
      // batwings still show above the front row's hats)
      const cxR = winR + ww / 2;
      let dw2 = Math.max(16, Math.min(26, Math.round(ww * 1.15)));
      let x = Math.round(cxR - dw2 / 2);
      x = Math.min(x, W - 4 - dw2);
      x = Math.max(x, sx1 + 5);
      dw2 = Math.min(dw2, W - 4 - x);
      const b2 = floorUnder(x, x + dw2);
      const top2 = Math.max(doorTop, b2 - Math.round(wh * 2.2));
      if (dw2 >= 14 && b2 - top2 >= 20) { door = { x, y: top2, w: dw2, h: b2 - top2 }; dropRight = true; }
    }
  }
  geo.door = door;
  if (door) used.push(box(door.x - 3, door.y - 3, door.w + 6, door.h + 3));

  // windows
  const wins = dropRight ? [wl] : [wl, winR];
  wins.forEach((wx, wi) => {
    const mesa: number[] = [];
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
      mesa.push(hgt);
    }
    // rain sheen on the glass: a faint lighter dither near the top + a few beads
    for (let y = wy; y < wy + Math.round(wh * 0.5); y++) for (let xx = wx; xx < wx + ww; xx++) {
      if ((1 - (y - wy) / (wh * 0.5)) * 0.22 > bayer(xx, y) + 0.05 && (xx + y) % 3 === 0) px(c, xx, y, PAL.blue2);
    }
    for (let i = 0; i < Math.round(ww * wh / 40); i++) px(c, wx + Math.floor(rnd(wi, i, 71) * ww), wy + Math.floor(rnd(wi, i, 72) * wh), i % 3 ? PAL.blue3 : PAL.moon);
    for (let y = wy; y < wy + wh; y++) for (let xx = wx; xx < wx + ww; xx++) emis[y * W + xx] = 1;
    // mullions
    const mull = [{ x: wx + (ww >> 1) - 1, y: wy, w: 2, h: wh }, { x: wx, y: wy + Math.round(wh * 0.45), w: ww, h: 2 }];
    c.fillStyle = PAL.wood1; for (const m of mull) c.fillRect(m.x, m.y, m.w, m.h);
    geo.wins.push({ x: wx, y: wy, w: ww, h: wh, mesa, mull });
    // sill
    c.fillStyle = PAL.wood3; c.fillRect(wx - 4, wy + wh + 2, ww + 8, 2);
    c.fillStyle = PAL.blue3; c.fillRect(wx - 4, wy + wh + 2, ww + 8, 1);
    used.push(box(wx - 4, wy - 3, ww + 8, wh + 7));
  });
  const winBot = wy + wh;

  // bottle shelf (the strip above the plank is kept bare + full, so a bottle can be knocked off and restocked)
  const stripY = Math.max(0, sy - 17), stripW = Math.min(W, sx1) - Math.max(0, sx0);
  let bare: ImageData | null = null;
  if (stripW > 0 && sy - stripY > 0 && sx0 >= 0) { try { bare = c.getImageData(sx0, stripY, stripW, sy - stripY); } catch { bare = null; } }
  const bottles: (Rect & { col: string })[] = [];
  let bx = sx0 + 2, bi = 0, btop = sy;
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
    btop = Math.min(btop, sy - bh - 4);
    bottles.push({ x: bx, y: sy - bh - 4, w: bw, h: bh + 4, col });
    bx += bw + 1 + Math.floor(rnd(bi, 33) * 3); bi++;
  }
  c.fillStyle = PAL.wood3; c.fillRect(sx0, sy, sx1 - sx0, 2);
  c.fillStyle = PAL.wood4; c.fillRect(sx0, sy, sx1 - sx0, 1);
  c.fillStyle = PAL.ink; c.fillRect(sx0, sy + 2, sx1 - sx0, 1);
  c.fillStyle = PAL.wood1; c.fillRect(sx0 + 3, sy + 3, 2, 4); c.fillRect(sx1 - 5, sy + 3, 2, 4);
  geo.shelf = { x0: sx0, x1: sx1, y: sy };
  if (bare) {
    try {
      geo.shelfStrip = { x: sx0, y: stripY, bare, full: c.getImageData(sx0, stripY, stripW, sy - stripY) };
      geo.bottles = bottles.filter((b) => b.y >= stripY && b.x >= sx0 && b.x + b.w <= sx0 + stripW);
    } catch { /* no knockable bottles */ }
  }
  used.push(box(sx0, Math.min(btop, sy - 12), sx1 - sx0, sy + 7 - Math.min(btop, sy - 12))); // + headroom for the cat

  // ---- swinging doors' doorway (back wall) + piano corner
  const floor = L.tableTop + (L.portrait ? 2 : 4);
  if (door) {
    const d = door;
    c.fillStyle = PAL.ink; c.fillRect(d.x - 3, d.y - 3, d.w + 6, d.h + 3);
    c.fillStyle = PAL.wood3; c.fillRect(d.x - 2, d.y - 2, d.w + 4, d.h + 2);
    c.fillStyle = PAL.wood4; c.fillRect(d.x - 2, d.y - 2, d.w + 4, 1);
    // lintel shadow + jamb highlights so the opening reads as a recess in the wall
    c.fillStyle = PAL.wood1; c.fillRect(d.x - 2, d.y - 1, d.w + 4, 1);
    DOOR_OUT(c, d, false);
    for (let y = d.y + 1; y < d.y + d.h; y++) for (let xx = d.x + 1; xx < d.x + d.w - 1; xx++) emis[y * W + xx] = 1;
    // cool spill on the floor boards in front
    for (let y = d.y + d.h - 4; y < Math.min(H, d.y + d.h + 18); y++) for (let xx = d.x - 10; xx < d.x + d.w + 10; xx++) {
      if (xx < 0 || xx >= W || (y < d.y + d.h && xx >= d.x && xx < d.x + d.w)) continue;
      const v = Math.max(0, 1 - Math.abs(xx - (d.x + d.w / 2)) / (d.w * 0.9)) * Math.max(0, 1 - Math.abs(y - (d.y + d.h)) / 16) * 0.7;
      cool[y * W + xx] = Math.max(cool[y * W + xx], v);
    }
  }
  const pianoX = L.portrait ? 1 : 3;
  const pianoR = box(pianoX - 1, floor - 25, 26, 25);
  if (W >= 150 && floor - 24 > winBot + 2 - (L.portrait ? 0 : 12) && !hits(pianoR, 0)) { drawPiano(c, pianoX, floor); geo.piano = { x: pianoX, floor }; used.push(pianoR); }
  else geo.piano = null;

  // wanted poster: right of the shelf if there's wall there, else left of it. Reserve the big
  // "LAST TIME" poster (last game this table played) when it fits; the generic one is drawn in its
  // spot until a cover arrives (SceneRenderer.setPoster repaints just that rect).
  const spots = (pw: number) => [Math.round(W * 0.7), Math.round((sx1 + (door && !dropRight ? door.x - 3 : winR - 4)) / 2 - pw / 2), Math.round(W * 0.25), Math.round((wl + ww + 4 + sx0) / 2 - pw / 2)];
  const bigY = Math.max(5, Math.round(tableTop * 0.1));
  let pr: Rect | null = null, big = false;
  if (bigY + POSTER.h <= rail + 2) {
    const bx0 = spots(POSTER.w).find((x) => !hits(box(x, bigY, POSTER.w, POSTER.h)));
    if (bx0 !== undefined) { pr = box(bx0, bigY, POSTER.w, POSTER.h); big = true; }
  }
  if (!pr) {
    const py0 = Math.max(8, Math.round(tableTop * 0.16));
    const sx = spots(13).find((x) => !hits(box(x, py0, 13, 17)));
    if (sx !== undefined) pr = box(sx, py0, 13, 17);
  }
  if (pr) {
    used.push(pr);
    geo.poster = { ...pr, big, under: c.getImageData(pr.x, pr.y, pr.w, pr.h) };
    paintPoster(c, geo.poster, null);
  }
  // framed picture (left)
  const fx = Math.round(W * 0.25), fy = Math.max(8, Math.round(tableTop * 0.2)), fw = 14, fh = 11;
  const picR = box(fx - 1, fy - 5, fw + 2, fh + 6);
  if (!hits(picR)) {
    used.push(picR);
    c.fillStyle = PAL.ink; c.fillRect(fx - 1, fy - 1, fw + 2, fh + 2);
    c.fillStyle = PAL.lamp3; c.fillRect(fx, fy, fw, fh);
    c.fillStyle = PAL.wood4; c.fillRect(fx, fy, fw, 1);
    ditherBands(c, fx + 2, fy + 2, fw - 4, fh - 4, [PAL.blue1, PAL.lamp3, PAL.wood2]);
    for (let i = 0; i < fw - 4; i++) { const hh = 2 + ((i * 7) % 3); c.fillStyle = PAL.wood0; c.fillRect(fx + 2 + i, fy + fh - 2 - hh, 1, hh); }
    line(c, fx + 2, fy - 1, fx + fw / 2, fy - 5, PAL.wood0); line(c, fx + fw - 3, fy - 1, fx + fw / 2, fy - 5, PAL.wood0);
    px(c, fx + fw / 2, fy - 5, PAL.metal3);
  }
  geo.decor = used;
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

export interface ScenePlayer { id: string; seat: number; look: number; style?: Look; connected: boolean; bot?: boolean }

/** Transient things the scene should play. Pushed by the React side into `SceneFX.queue`; the frame loop drains it. */
export type SceneEvt =
  | { k: 'emote'; pid: string; emote: string; at: number }
  | { k: 'bolt'; big: boolean; at: number } // lightning (big = on top of a slow-mo / revenge shot)
  | { k: 'doors'; leave: boolean; at: number }
  | { k: 'slowmo'; at: number };
export interface SceneFX {
  queue: SceneEvt[];
  /** piano tempo in bpm right now (0 = the pianist rests) */
  tempo: () => number;
  /** the scene decided an ambient lightning bolt struck (play thunder a moment later) */
  onBolt?: (big: boolean) => void;
  /** something the shelf cat did needs a sound (a knocked bottle hit the floor) */
  onCat?: (e: 'shatter') => void;
}
export interface SceneData {
  players: ScenePlayer[];
  shooter?: string;
  phase: string;
  shot?: { at: number; actor: string; kind: string }; // performance.now() based
  dimAll: number; // 1 normal, lower for roulette/result
  fx?: SceneFX;
  /** appid of the game this table played last time (the "LAST TIME" wanted poster); 0/undefined = generic poster */
  poster?: number;
}

/** emote durations (ms of scene time); keep in step with the HTML caption in Saloon (EMOTE_POP_MS) */
const EMO_MS: Record<string, number> = { tip: 1700, spit: 1900, laugh: 1900, yeehaw: 1800, clap: 1600, shrug: 1800, angry: 1900, drink: 2100 };
const IDLE_MS: Record<string, number> = { cards: 1900, sip: 2000, hat: 1100, look: 1700 };
const IDLE_KINDS = ['cards', 'sip', 'hat', 'look'] as const;
/** slow clap contact times (ms): sfx.clap() lands its claps on these */
const CLAPS = [250, 670, 1090];
const CLAP_HOLD = 220; // >= 2 frames at 10fps
const YEE = { up: 220, catch: 1100, h: 24 };

interface Anim { kind: string; v: number; emote: boolean }
interface Pose2 { pose?: Pose; hatDy?: number; hatRot?: number; hand?: boolean; pad?: number; jx?: number; jy?: number; blink?: boolean }

/** what a bust looks like `age` ms into an emote / idle animation. Key poses are held >= 150ms
 * (phones draw at 10fps), with a wind-up before and an overshoot / settle after. */
function animPose(a: Anim, age: number): Pose2 {
  const f = (ms: number) => Math.floor(age / ms);
  switch (a.kind) {
    case 'tip': // hand to the brim, hat lifted high, a little bow; then back on
      if (age < 180) return { hand: true, hatDy: -1, pad: 18, pose: { mouth: 'grin' } };
      if (age < 320) return { hand: true, hatDy: -7, pad: 18, pose: { mouth: 'grin', brow: 'up' } };
      if (age < 1150) return { hand: true, hatDy: -10, pad: 18, pose: { mouth: 'grin', lids: 'happy', hy: 2 } };
      if (age < 1400) return { hand: true, hatDy: -4, pad: 18, pose: { mouth: 'grin', hy: 1 } };
      return { hatDy: 0, hand: age < 1550, pad: 18, pose: { mouth: 'grin' } };
    case 'hat': return { hatDy: age < 150 ? -2 : age < 700 ? -3 : age < 850 ? -1 : 0, hand: age < 900 };
    case 'spit': // cheeks puffed and lean back, PTOO forward, watch it land, smug
      if (age < 300) return { pose: { mouth: 'o', hy: -1, lids: 'wide' }, jy: -1 };
      if (age < 460) return { pose: { mouth: 'open', hx: 2, hy: 1, eyes: 1 }, jx: 1 };
      if (age < 950) return { pose: { mouth: 'o', hx: 1, eyes: 1 } };
      return { pose: { mouth: 'grin', eyes: 1, brow: 'up' } };
    case 'laugh': // head thrown back, belly shake
      if (age < 150) return { pose: { mouth: 'grin', lids: 'happy', hy: 1 }, jy: 1 };
      if (age < 1700) return f(150) % 2
        ? { pose: { mouth: 'wide', lids: 'happy', hy: -3 }, jx: 1, jy: -1 }
        : { pose: { mouth: 'open', lids: 'happy', hy: -1 }, jx: -1, jy: 1 };
      return { pose: { mouth: 'grin', lids: 'happy' } };
    case 'yeehaw': { // grab the brim, crouch, fling it spinning sky-high, catch it, slap it back on
      const pose: Pose = { mouth: 'wide', brow: 'up' };
      if (age < YEE.up) return { hand: true, hatDy: -1, pad: 44, jy: 1, pose: { mouth: 'grin', brow: 'up' } };
      if (age < YEE.catch) {
        const k = (age - YEE.up) / (YEE.catch - YEE.up);
        const dy = -2 * Math.round((YEE.h * 4 * k * (1 - k)) / 2) - 4;
        return { hatDy: dy, hatRot: f(90) % 4, pad: 44, jy: age < YEE.up + 150 ? -1 : 0, pose: { ...pose, arm: 'fling' } };
      }
      if (age < 1300) return { hand: true, hatDy: -6, pad: 44, pose };
      if (age < 1450) return { hand: true, hatDy: -2, pad: 44, jy: 1, pose };
      return { hatDy: 0, pad: 44, pose: { mouth: 'grin', brow: 'up' } };
    }
    case 'clap': { // slow clap: wind-up, then palms meet on each clap sound
      const on = CLAPS.some((t0) => age >= t0 && age < t0 + CLAP_HOLD);
      const first = CLAPS.some((t0) => age >= t0 && age < t0 + 80);
      return { pose: { arm: on ? 'clap' : 'clapOpen', mouth: 'grin', brow: age > 600 ? 'up' : undefined }, jy: first ? 1 : 0 };
    }
    case 'shrug': // palms in, then shoulders to the ears + palms out + head tilt, hold, relax
      if (age < 180) return { pose: { arm: 'shrugIn', mouth: 'wavy' }, jy: 1 };
      if (age < 320) return { pose: { arm: 'shrug', mouth: 'wavy', brow: 'quiz', hx: -1, hy: 1 }, jy: -2 };
      if (age < 1500) return { pose: { arm: 'shrug', mouth: 'wavy', brow: 'quiz', hx: -1, hy: 1, eyes: f(500) % 2 ? 1 : -1 }, jy: -1 };
      return { pose: { arm: 'shrugIn', mouth: 'wavy' } };
    case 'angry': // red, gritted teeth, shaking fists
      if (age < 150) return { pose: { brow: 'angry', mouth: 'grit', red: true }, jy: 1 };
      if (age < 1700) return { pose: { brow: 'angry', mouth: 'grit', red: true, arm: f(100) % 2 ? 'fists' : 'fists2' }, jx: f(70) % 2 ? 1 : -1 };
      return { pose: { brow: 'angry', mouth: 'grit', red: true } };
    case 'drink': // pick up, raise it high, knock it back, "ahh"
      if (age < 300) return { pose: { arm: 'glass', eyes: -1 } };
      if (age < 650) return { pose: { arm: 'toast', mouth: 'grin', brow: 'up' }, jy: age < 420 ? -1 : 0 };
      if (age < 1400) return { pose: { arm: 'drink', lids: 'shut', hy: -2 } };
      return { pose: { arm: 'glass', mouth: 'open', lids: 'happy' }, jy: age < 1550 ? 1 : 0 };
    case 'sip': {
      const up = age > 400 && age < 1500;
      return { pose: { arm: up ? 'glassUp' : 'glass', eyes: up ? undefined : -1 }, blink: up && age > 700 };
    }
    case 'cards': return { pose: { arm: (['cards', 'cards2', 'cards3', 'cards2'] as const)[f(160) % 4] } };
    case 'look': return { pose: { eyes: age < 800 ? -1 : 1 } };
  }
  return {};
}

/* tiny pixel glyphs for emote FX ('#' = on) */
const GL = {
  star7: ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'],
  star5: ['..#..', '.###.', '#####', '.###.', '..#..'],
  star3: ['.#.', '###', '.#.'],
  q: ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  vein5: ['.#.#.', '##.##', '.....', '##.##', '.#.#.'],
  vein7: ['..#.#..', '..#.#..', '###.###', '.......', '###.###', '..#.#..', '..#.#..'],
  rayL: ['#..', '.#.', '..#'],
  rayR: ['..#', '.#.', '#..'],
  heart: ['#.#', '###', '.#.'],
};
/** the shelf cat's colours */
const CAT0 = '#161210', CAT1 = '#2e2722', CAT_EYE = '#d8c040';
/** a glyph at scale k, centred on (x, y), with a 1-cell ink outline */
function glyph(c: Ctx, rows: string[], x: number, y: number, col: string, k = 1, ink: string | null = PAL.ink) {
  const h = rows.length, w = rows[0].length;
  const x0 = Math.round(x - (w * k) / 2), y0 = Math.round(y - (h * k) / 2);
  for (const pass of ink ? [0, 1] : [1]) {
    c.fillStyle = pass ? col : ink!;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (rows[j][i] !== '#') continue;
      if (pass) c.fillRect(x0 + i * k, y0 + j * k, k, k);
      else c.fillRect(x0 + (i - 1) * k, y0 + (j - 1) * k, k * 3, k * 3);
    }
  }
}
function puff(c: Ctx, x: number, y: number, r: number, fade: number, light = '#c9bba6', dark = '#8a7e70') {
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
    const v = 1 - Math.hypot(xx, yy) / (r + 0.5);
    if (v > 0 && v * fade * 1.6 > bayer(x + xx, y + yy)) px(c, x + xx, y + yy, v > 0.45 ? light : dark);
  }
}

interface Drop { x: number; y: number; v: number; len: number }
interface Gust { x: number; y: number; vx: number; vy: number; life: number }

export class SceneRenderer {
  L: Layout;
  bg: HTMLCanvasElement;
  bgc: Ctx;
  /** appid the poster should show (-1 = not decided yet) */
  posterWant = -1;
  table: HTMLCanvasElement;
  dawnWin: HTMLCanvasElement;
  emis: Uint8Array;
  cool: Float32Array;
  vig: Float32Array;
  /** per frame: 1 where a bust is the visible pixel (doorway / window light never lands on these) */
  fg: Uint8Array;
  /** opaque pixels of the table layer (drawn over the busts' lower edge) */
  tableMask: Uint8Array;
  /** alpha mask per cached bust sprite */
  spriteMasks = new WeakMap<HTMLCanvasElement, Uint8Array>();
  geo: WallGeo = { wins: [], door: null, piano: null, shelf: { x0: 0, x1: 0, y: 0 } };
  sprites = new Map<string, HTMLCanvasElement>();
  looks = new Map<string, BustLook>();
  lampA = 0;
  motes: { x: number; y: number; vx: number; vy: number; p: number }[] = [];
  reduce: boolean;
  low: boolean;
  // clocks: `vt` is scene time (runs slow during slow-mo); real time only drives the clock itself
  vt = 0; lastReal = -1; slowUntil = 0;
  shotSeen = -1; shotV = -1e9;
  bolt = { v: -1e9, big: false }; nextBolt = 6000;
  dawn = 0;
  rain: Drop[][] = [];
  gust: Gust[] = [];
  doorV = -1e9; doorLeave = false;
  anims = new Map<string, Anim>();
  /** when the current shooter's turn started (scene time): a little draw hop + hammer glint */
  turn = { id: '', v: -1e9 };
  nextIdle = new Map<string, number>();
  cat = { x: 0, dir: 1, state: 'walk' as 'walk' | 'sit' | 'bolt' | 'gone' | 'act', until: 4000, v: 0 };
  /** the cat's current tap reaction (scene time) */
  catAct: { k: CatAct; v: number; x0: number; x1: number; bi: number; dropped: boolean } | null = null;
  catTurn = 0;
  falls: Fall[] = [];
  shards: Shard[] = [];
  /** knocked bottles: index -> scene time it's back on the shelf */
  missing = new Map<number, number>();

  constructor(L: Layout, opts: { motes?: number; reduce?: boolean; low?: boolean } = {}) {
    this.L = L;
    this.reduce = !!opts.reduce;
    this.low = !!opts.low;
    const { W, H } = L;
    this.emis = new Uint8Array(W * H);
    this.cool = new Float32Array(W * H);
    const [bg, bc] = makeCanvas(W, H);
    drawWall(bc, L, this.emis, this.cool, this.geo);
    this.bg = bg; this.bgc = bc;
    const [tb, tc] = makeCanvas(W, H);
    drawTable(tc, L);
    this.table = tb;
    this.fg = new Uint8Array(W * H);
    this.tableMask = alphaMask(tb);
    // the table is lit by the lamp + the room's ambient only: no window / doorway spill (or the
    // doorway's own emissive pixels where its foot dips behind the rim) lands on it. The floor
    // strip at the very bottom keeps a faint share of the spill.
    const floorY = L.cy + L.ry - 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!this.tableMask[i]) continue;
      this.emis[i] = 0;
      this.cool[i] = y >= floorY && Math.abs(x - L.cx) >= L.rx * Math.sqrt(Math.max(0, 1 - ((y - L.cy - 3) / (L.ry + 2)) ** 2)) ? this.cool[i] * 0.3 : 0;
    }
    // dawn skies for the windows + doorway (drawn over the night ones at the result)
    const [dw, dc] = makeCanvas(W, H);
    this.geo.wins.forEach((w, wi) => {
      ditherBands(dc, w.x, w.y, w.w, w.h, ['#3a2c5a', '#7a3c6a', '#c4587a', '#ff8a3d', '#ffd39a']);
      if (wi === 1) { circle(dc, w.x + Math.round(w.w * 0.35), w.y + w.h - Math.round(w.h * 0.18), Math.max(2, Math.round(w.w * 0.18)), '#fff3c4'); }
      for (let i = 0; i < 4; i++) { dc.fillStyle = '#ffd39a'; dc.fillRect(w.x + Math.floor(rnd(wi, i, 81) * (w.w - 6)), w.y + 2 + i * 3, 4 + (i % 3), 1); }
      w.mesa.forEach((hgt, xx) => { dc.fillStyle = '#4a2438'; dc.fillRect(w.x + xx, w.y + w.h - hgt, 1, hgt); });
      dc.fillStyle = PAL.wood1; for (const m of w.mull) dc.fillRect(m.x, m.y, m.w, m.h);
    });
    // with only one window (portrait: the doorway took the right one) the sun rises in the doorway
    if (this.geo.door) DOOR_OUT(dc, this.geo.door, true, this.geo.wins.length < 2);
    this.dawnWin = dw;
    this.vig = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W * 0.62), dy = (y - H * 0.36) / (H * 0.72);
      const d = Math.sqrt(dx * dx + dy * dy);
      this.vig[y * W + x] = Math.max(0.08, 1 - Math.max(0, d - 0.45) * 1.5);
    }
    for (let i = 0; i < (opts.motes ?? 34); i++) this.motes.push({ x: rnd(i, 1, 9) * W, y: rnd(i, 2, 9) * H * 0.8, vx: (rnd(i, 3, 9) - 0.5) * 2, vy: -0.4 - rnd(i, 4, 9) * 1.2, p: rnd(i, 5, 9) * 6.28 });
    // rain streaks per window (+ the doorway)
    const rects: Rect[] = [...this.geo.wins, ...(this.geo.door ? [this.geo.door] : [])];
    rects.forEach((r, ri) => {
      const n = Math.max(4, Math.round((r.w * r.h) / (this.low ? 34 : 20)));
      this.rain.push(Array.from({ length: n }, (_, i) => ({ x: rnd(ri, i, 91) * (r.w + 6), y: rnd(ri, i, 92) * r.h, v: 0.09 + rnd(ri, i, 93) * 0.07, len: 2 + Math.floor(rnd(ri, i, 94) * 3) })));
    });
    this.cat.x = this.geo.shelf.x0 + 4;
  }

  sprite(p: ScenePlayer, g: SeatGeom, blink: boolean, lit: boolean, rimRight: boolean, gun = 0, ps: Pose2 = {}) {
    const dimQ = Math.round((1.08 - 0.32 * g.depth) * 4) / 4;
    const sig = styleSig(p);
    const key = `${p.id}|${sig}|${g.scale.toFixed(3)}|${+blink}|${+lit}|${+rimRight}|${dimQ}|${+!p.connected}|${gun}|${+!!p.bot}|${poseKey(ps.pose)}|${ps.hatDy ?? 0}|${ps.hatRot ?? 0}|${+!!ps.hand}|${ps.pad ?? 0}`;
    let cv = this.sprites.get(key);
    if (!cv) {
      let look = this.looks.get(p.id + sig);
      if (!look) { look = bustFor(p); this.looks.set(p.id + sig, look); }
      cv = renderBust(look, { scale: g.scale, blink, lit, rimRight, dim: lit ? 0.95 : dimQ, ghost: !p.connected, gun, bot: p.bot, pose: ps.pose, hatDy: ps.hatDy, hatRot: ps.hatRot, hand: ps.hand, padTop: ps.pad });
      if (this.sprites.size > 220) this.sprites.clear();
      this.sprites.set(key, cv);
    }
    return cv;
  }

  /** show the last game's cover on the wanted poster (0 = the generic one). Repaints only the poster's rect of the cached wall. */
  setPoster(appid: number) {
    if (appid === this.posterWant) return;
    this.posterWant = appid;
    const sp = this.geo.poster;
    if (!sp) return;
    if (!appid || !sp.big) { paintPoster(this.bgc, sp, null); return; }
    const { w, h } = POSTER.art;
    const show = (cv: HTMLCanvasElement | null) => { if (this.posterWant === appid) paintPoster(this.bgc, sp, cv); };
    const hit = peekPixelized(appid, 'box', w, h);
    const done = (a: { cv: HTMLCanvasElement; src: string } | null | undefined) => {
      if (!a) return show(null);
      if (a.src === 'box') return show(a.cv);
      // only the wide header art exists: centre-crop it instead of squashing it into the poster
      const hw = Math.round(h * 460 / 215);
      const hh = peekPixelized(appid, 'header', hw, h);
      const crop = (b: { cv: HTMLCanvasElement } | null | undefined) => {
        if (!b) return show(null);
        const [cv, cc] = makeCanvas(w, h);
        cc.drawImage(b.cv, Math.round((hw - w) / 2), 0, w, h, 0, 0, w, h);
        show(cv);
      };
      if (hh !== undefined) crop(hh); else pixelize(appid, 'header', hw, h).then(crop, () => show(null));
    };
    if (hit !== undefined) done(hit);
    else { paintPoster(this.bgc, sp, null); pixelize(appid, 'box', w, h).then(done, () => show(null)); }
  }

  /** where the shooter's revolver barrel ends, in scene pixels */
  muzzle(g: SeatGeom) {
    return { x: Math.round(g.x - g.w / 2 + 36 * g.scale), y: Math.round(g.top + 26 * g.scale) };
  }

  /** drain transient events (drop stale ones: a hidden tab stops the loop and they pile up) */
  private drain(t: number, D: SceneData) {
    const q = D.fx?.queue;
    if (!q || !q.length) return;
    const evs = q.splice(0, q.length);
    for (const e of evs) {
      if (t - e.at > 3000) continue;
      // back-dated to when it arrived (the sound already started then), so clap contacts land on the claps
      if (e.k === 'emote') this.anims.set(e.pid, { kind: e.emote, v: this.vt - Math.max(0, Math.min(400, t - e.at)), emote: true });
      else if (e.k === 'bolt') { this.bolt = { v: this.vt, big: e.big }; this.nextBolt = this.vt + 9000 + Math.random() * 12000; }
      else if (e.k === 'doors') { this.doorV = this.vt; this.doorLeave = e.leave; this.spawnGust(e.leave ? 34 : 18); }
      else if (e.k === 'slowmo') this.slowUntil = t + 1500;
    }
  }

  private spawnGust(n: number) {
    const d = this.geo.door;
    if (!d || this.reduce) return;
    const dir = d.x + d.w / 2 > this.L.cx ? -1 : 1;
    for (let i = 0; i < (this.low ? n >> 1 : n); i++) {
      this.gust.push({ x: d.x + Math.random() * d.w, y: d.y + d.h * (0.2 + Math.random() * 0.7), vx: dir * (0.03 + Math.random() * 0.06), vy: 0.005 + Math.random() * 0.025, life: 700 + Math.random() * 700 });
    }
  }

  frame(c: Ctx, t: number, D: SceneData) {
    const L = this.L;
    const { W, H, cx } = L;
    // ---- scene clock (slow-mo halves it)
    const dtReal = this.lastReal < 0 ? 0 : Math.min(250, t - this.lastReal);
    this.lastReal = t;
    const rate = t < this.slowUntil && !this.reduce ? 0.45 : 1;
    const dt = dtReal * rate;
    this.vt += dt;
    const vt = this.vt;
    this.drain(t, D);
    const sec = vt / 1000;
    this.setPoster(D.poster ?? 0);
    // shot age in scene time, stamped when first seen
    if (D.shot && D.shot.at !== this.shotSeen) {
      this.shotSeen = D.shot.at;
      const lag = t - D.shot.at;
      // a renderer rebuilt after a resize sees an old shot: don't replay it
      if (lag > 2500) this.shotV = -1e9;
      else {
        this.shotV = vt - Math.max(0, lag) * rate;
        if (this.cat.state === 'walk' || this.cat.state === 'sit' || this.cat.state === 'act') { this.catAct = null; this.cat.state = 'bolt'; this.cat.dir = this.cat.x - this.geo.shelf.x0 < this.geo.shelf.x1 - this.cat.x ? -1 : 1; }
      }
    }
    const shotAge = D.shot ? vt - this.shotV : 1e9;
    // ---- weather: storm until the result, then dawn
    const result = D.phase === 'result';
    if (dtReal === 0 && result) this.dawn = 1; // first frame of a rebuilt renderer: already morning
    this.dawn = Math.max(0, Math.min(1, this.dawn + (result ? dt / 3500 : -dtReal / 600)));
    const storm = this.dawn < 1;
    if (storm && !result && vt > this.nextBolt) {
      this.bolt = { v: vt, big: Math.random() < 0.25 };
      this.nextBolt = vt + 9000 + Math.random() * 16000;
      D.fx?.onBolt?.(this.bolt.big);
    }
    const bAge = vt - this.bolt.v;
    let boltK = 0;
    if (!this.reduce && bAge < 700 && !result) {
      boltK = bAge < 70 ? 1 : bAge < 130 ? 0.25 : bAge < 210 ? 0.85 : Math.max(0, 0.6 * (1 - (bAge - 210) / 490));
      if (!this.bolt.big) boltK *= 0.6;
    }

    // integer screen shake
    let ox = 0, oy = 0;
    if (shotAge < 420 && !this.reduce) {
      const amp = D.shot!.kind === 'ricochet' ? 1 : shotAge < 160 ? 3 : 2;
      ox = Math.round((rnd(Math.floor(vt / 60), 1) - 0.5) * 2 * amp);
      oy = Math.round((rnd(Math.floor(vt / 60), 2) - 0.5) * 2 * amp);
    }
    c.setTransform(1, 0, 0, 1, ox, oy);
    c.fillStyle = PAL.ink; c.fillRect(-4, -4, W + 8, H + 8);
    c.drawImage(this.bg, 0, 0);

    // ---- windows + doorway: rain, lightning, dawn
    this.drawWeather(c, vt, dt, boltK, storm);
    // ---- back corner: the piano player
    this.drawPianist(c, vt, D, shotAge);
    // ---- the cat on the bottle shelf (+ anything it knocked off)
    this.drawCat(c, vt, dt, D);

    const seats = D.players.map((p) => p.seat);
    const geoms = D.players.map((p) => ({ p, g: seatGeom(L, p.seat, seats) })).sort((a, b) => b.g.depth - a.g.depth);
    const shooterG = geoms.find((x) => x.p.id === D.shooter);
    // (a renderer rebuilt mid-turn, e.g. on resize, doesn't replay the draw)
    if ((D.shooter ?? '') !== this.turn.id) this.turn = { id: D.shooter ?? '', v: dtReal === 0 ? -1e9 : vt };
    const turnAge = vt - this.turn.v;

    // lamp swing (pendulum), biased toward the shooter
    const target = shooterG ? Math.max(-0.35, Math.min(0.35, Math.atan2(shooterG.g.x - cx, L.tableTop * 1.6))) : 0;
    this.lampA += (target - this.lampA) * (this.reduce ? 1 : 0.08);
    const a = this.reduce ? this.lampA : this.lampA + Math.sin(sec * 1.1) * 0.05 + Math.sin(sec * 2.7) * 0.012;
    const lx = Math.round(cx + Math.sin(a) * L.lampLen), ly = Math.round(Math.cos(a) * L.lampLen);

    // idle animations: random, staggered, never during your turn
    if (!this.reduce) for (const { p } of geoms) {
      const cur = this.anims.get(p.id);
      if (cur) {
        const dur = cur.emote ? EMO_MS[cur.kind] ?? 1500 : IDLE_MS[cur.kind] ?? 1500;
        if (vt - cur.v > dur || (!cur.emote && p.id === D.shooter)) this.anims.delete(p.id);
        continue;
      }
      const nx = this.nextIdle.get(p.id);
      if (nx === undefined) { this.nextIdle.set(p.id, vt + 3000 + Math.random() * 9000); continue; }
      if (vt > nx) {
        this.nextIdle.set(p.id, vt + 6000 + Math.random() * 9000);
        if (p.id !== D.shooter && p.connected && shotAge > 2500 && D.phase !== 'roulette') this.anims.set(p.id, { kind: IDLE_KINDS[Math.floor(Math.random() * IDLE_KINDS.length)], v: vt, emote: false });
      }
    } else for (const [id, cur] of this.anims) if (vt - cur.v > (EMO_MS[cur.kind] ?? 1500)) this.anims.delete(id);

    // players
    this.fg.fill(0);
    const overlays: { g: SeatGeom; a: Anim; age: number; ox: number; oy: number; ps: Pose2 }[] = [];
    for (const { p, g } of geoms) {
      const ph = (p.id.charCodeAt(0) || 0) * 0.37 + p.seat;
      const bob = !this.reduce && Math.sin(sec * 1.6 + ph) > 0.2 ? 1 : 0;
      let blink = ((sec + ph * 1.7) % 4.3) < 0.16;
      const lit = p.id === D.shooter;
      const isActor = !!D.shot && D.shot.actor === p.id;
      const gun = (lit || (isActor && shotAge < 1500)) && !this.reduce ? (isActor && shotAge < 220 && D.shot!.kind !== 'ricochet' ? 2 : 1) : lit ? 1 : 0;
      // everyone else flinches for a moment on each shot
      let jx = 0, jy = 0;
      const flinch = !isActor && shotAge < 260 && !this.reduce;
      if (flinch) {
        const k = shotAge < 90 ? 2 : 1;
        jx = (rnd(p.seat, Math.floor(shotAge / 70), 5) > 0.5 ? 1 : -1) * k; jy = shotAge < 130 ? 1 : 0;
      }
      // your turn: the revolver comes up with a little hop
      if (lit && turnAge < 300 && !this.reduce) jy -= turnAge < 150 ? 2 : 1;
      const an = this.anims.get(p.id);
      // a flinch: eyes go wide (unless an emote owns the face)
      let ps: Pose2 = flinch && !an && !gun ? { pose: { lids: 'wide' } } : {};
      if (an) {
        const age = vt - an.v;
        // reduced motion: freeze on the key pose
        const pa = animPose(an, this.reduce ? Math.min(age, an.kind === 'clap' ? CLAPS[1] + 20 : 600) : age);
        if (this.reduce) { pa.jx = 0; pa.jy = 0; pa.hatRot = 0; }
        // the shooter's hands are on the revolver: no pose, but the props / effects still play
        if (!gun) {
          ps = pa;
          if (ps.blink) blink = true;
          jx += ps.jx ?? 0; jy += ps.jy ?? 0;
        }
        if (an.emote) overlays.push({ g, a: an, age, ox: jx, oy: bob + jy, ps });
      }
      const cv = this.sprite(p, g, blink, lit, g.x < lx, gun, ps);
      const pad = Math.round((ps.pad ?? 0) * g.scale);
      const bx = Math.round(g.x - cv.width / 2) + jx, by = g.top - pad + bob + jy + (gun === 2 ? 1 : 0);
      c.drawImage(cv, bx, by);
      let m = this.spriteMasks.get(cv);
      if (!m) { m = alphaMask(cv); this.spriteMasks.set(cv, m); }
      stampMask(this.fg, W, H, m, cv.width, cv.height, bx + ox, by + oy);
    }
    c.drawImage(this.table, 0, 0);
    { // the table covers the busts' lower edge: it takes the floor spill again
      const tm = this.tableMask, fg = this.fg;
      for (let y = Math.max(0, oy); y < Math.min(H, H + oy); y++) {
        const r = y * W, rs = (y - oy) * W;
        for (let x = Math.max(0, ox); x < Math.min(W, W + ox); x++) if (tm[rs + x - ox]) fg[r + x] = 0;
      }
    }

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
    const flick = this.reduce ? 0.95 : 0.9 + 0.1 * Math.sin(sec * 9.3) * Math.sin(sec * 3.1 + 1) + (rnd(Math.floor(vt / 80), 7) > 0.93 ? -0.18 : 0);
    const dawn = this.dawn;
    const amb = (D.shooter ? 0.42 : 0.52) * D.dimAll + dawn * 0.14 + boltK * 0.35;
    const R = W * 0.55;
    const tanA = Math.tan(a);
    const flash = shotAge < 140 ? 1.6 * (1 - shotAge / 140) : 0;
    const flashAct = D.shot && flash > 0 ? geoms.find((x) => x.p.id === D.shot!.actor) : undefined;
    const fM = flashAct ? this.muzzle(flashAct.g) : null;
    const fX = fM ? fM.x : cx, fY = fM ? fM.y : L.tableTop;
    const sp = shooterG ? { x: shooterG.g.x, y: shooterG.g.top + shooterG.g.h * 0.45, r: shooterG.g.h * 0.75 } : null;
    const lampK = D.dimAll;
    const emisK = Math.max(0.75 * D.dimAll + 0.25, dawn);
    // window spill: cold blue at night, warm pink-orange at dawn, white-blue in a lightning flash
    const coolK = (0.35 + dawn * 0.25) * Math.max(D.dimAll, dawn) + boltK * 1.4;
    const cR = 0.2 + dawn * 1.2 + boltK * 0.9, cG = 0.6 + dawn * 0.15 + boltK * 0.9, cB = 1.5 - dawn * 0.9 + boltK * 0.6;
    // the piano's candle: a small warm pool in the corner
    const pn = this.geo.piano;
    const cdx = pn ? pn.x + 8 : -999, cdy = pn ? pn.floor - 20 : -999, cdr = 30;
    const cflick = 0.85 + 0.15 * Math.sin(sec * 7.1 + 2);
    const fg = this.fg;
    for (let y = 0; y < H; y++) {
      const dy = y - ly;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        const bust = fg[i] === 1;
        if (!bust && this.emis[i]) {
          d[o] *= emisK; d[o + 1] *= emisK; d[o + 2] *= emisK; continue;
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
        if (x < cdx + cdr && x > cdx - cdr && y > cdy - cdr && y < cdy + cdr) {
          const v = 1 - Math.hypot(x - cdx, (y - cdy) * 0.8) / cdr;
          if (v > 0) lamp += v * 1.1 * cflick;
        }
        const b = bayer(x, y);
        const lq = Math.floor(lamp * 5 + b) / 5;
        const av = amb * this.vig[i];
        const aq = Math.floor(av * 7 + b) / 7;
        // window / doorway spill (and its lightning + dawn colour) lights the wall and floor, never the busts:
        // they get the storm and the morning through the seat-independent ambient term instead
        const cl = bust ? 0 : Math.floor(this.cool[i] * 3 + b) / 3 * coolK;
        d[o] = d[o] * (aq * 0.85 + lq * 1.3 + cl * cR);
        d[o + 1] = d[o + 1] * (aq * 0.9 + lq * 1.0 + cl * cG);
        d[o + 2] = d[o + 2] * (aq * 1.12 + lq * 0.62 + cl * cB);
      }
    }
    c.putImageData(img, 0, 0);

    // ---- emissive layer: lamp glass + flame
    const fh = 4 + (rnd(Math.floor(vt / 90), 3) > 0.5 ? 1 : 0);
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
    const mk = this.reduce ? 0 : dt / 77;
    for (const m of this.motes) {
      m.x += (m.vx * 0.25 + Math.sin(sec + m.p) * 0.15) * mk; m.y += m.vy * 0.25 * mk;
      if (m.y < 0) { m.y = H * 0.8; m.x = rnd(Math.floor(vt), m.p * 100) * W; }
      if (m.x < 0) m.x += W; if (m.x > W) m.x -= W;
      const mx = Math.round(m.x), my = Math.round(m.y);
      const ddy = my - ly;
      const inCone = ddy > 0 && Math.abs(mx - lx - tanA * ddy) < 3 + ddy * 0.42;
      const near = Math.hypot(mx - lx, ddy) < W * 0.25;
      if (inCone || near) px(c, mx, my, Math.sin(sec * 2 + m.p) > 0 ? PAL.lamp1 : PAL.parch2);
      else if (this.cool[Math.min(W * H - 1, Math.max(0, my * W + mx))] > 0.3) px(c, mx, my, PAL.blue2);
    }

    // ---- rain blown in through the doors
    if (this.gust.length) {
      this.gust = this.gust.filter((g) => (g.life -= dt) > 0);
      for (const g of this.gust) {
        g.x += g.vx * dt; g.y += g.vy * dt; g.vy += 0.00004 * dt;
        const x0 = Math.round(g.x), y0 = Math.round(g.y);
        px(c, x0, y0, PAL.blue3); px(c, x0 - Math.sign(g.vx), y0 - 1, PAL.blue2);
      }
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

    // ---- hammer glint as the shooter's revolver comes up
    if (shooterG && turnAge > 80 && turnAge < 560 && !this.reduce) {
      const mz = this.muzzle(shooterG.g);
      glyph(c, Math.floor(turnAge / 120) % 2 ? GL.star5 : GL.star7, mz.x + 1, mz.y - 2, '#fff3b8', shooterG.g.scale >= 1.02 ? 2 : 1);
    }

    // ---- emote props that leave the bust: spit arc + spittoon, steam puffs
    for (const o of overlays) this.drawEmoteFx(c, o.g, o.a, o.age, o.ox, o.oy, o.ps);
    // ---- the cat's MEOW! / hearts / HISS (unlit, so they read)
    this.drawCatFx(c, vt);
  }

  private drawWeather(c: Ctx, vt: number, dt: number, boltK: number, storm: boolean) {
    const { wins, door } = this.geo;
    const rects: Rect[] = [...wins, ...(door ? [door] : [])];
    const dq = Math.round(this.dawn * 4) / 4;
    if (dq > 0) { c.globalAlpha = dq; c.drawImage(this.dawnWin, 0, 0); c.globalAlpha = 1; }
    // rain streaks
    if (storm) {
      const vis = 1 - this.dawn;
      rects.forEach((r, ri) => {
        const drops = this.rain[ri];
        if (!drops) return;
        for (let i = 0; i < drops.length; i++) {
          const dr = drops[i];
          if (!this.reduce) { dr.y += dr.v * dt; if (dr.y > r.h + 2) { dr.y -= r.h + 4; dr.x = Math.random() * (r.w + 6); } }
          if (vis < 1 && rnd(ri, i, 7) > vis) continue;
          const col = boltK > 0.3 ? PAL.white : i % 3 ? PAL.blue2 : PAL.blue3;
          for (let k = 0; k < dr.len; k++) {
            const x = Math.round(r.x + dr.x - (dr.y + k) * 0.25), y = Math.round(r.y + dr.y + k);
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) px(c, x, y, col);
          }
        }
      });
    }
    // lightning: windows blow out white, the land goes black, sometimes a bolt
    if (boltK > 0.15) {
      wins.forEach((w, wi) => {
        c.fillStyle = boltK > 0.6 ? PAL.white : PAL.moon; c.fillRect(w.x, w.y, w.w, w.h);
        w.mesa.forEach((hgt, xx) => { c.fillStyle = PAL.blue0; c.fillRect(w.x + xx, w.y + w.h - hgt, 1, hgt); });
        if (boltK > 0.5 && (this.bolt.big || wi === Math.floor(this.bolt.v / 1000) % wins.length)) {
          let x = w.x + Math.round(w.w * (0.3 + rnd(Math.floor(this.bolt.v), wi, 3) * 0.4)), y = w.y;
          while (y < w.y + w.h - (w.mesa[0] ?? 3)) {
            const nx = Math.max(w.x, Math.min(w.x + w.w - 1, x + Math.round((rnd(x, y, 5) - 0.5) * 5))), ny = y + 2 + Math.floor(rnd(y, x, 6) * 3);
            line(c, x, y, nx, ny, '#8fd0ff'); x = nx; y = ny;
          }
        }
      });
      if (door) { c.fillStyle = boltK > 0.6 ? PAL.moon : PAL.blue3; c.fillRect(door.x, door.y, door.w, Math.round(door.h * 0.58)); }
    }
    for (const w of wins) { c.fillStyle = PAL.wood1; for (const m of w.mull) c.fillRect(m.x, m.y, m.w, m.h); }
    // batwing doors: two slatted half-doors that swing (damped) when someone comes or goes
    if (door) {
      const age = vt - this.doorV;
      let open = 0; // 0 closed .. 1 wide open
      if (age < 2600) {
        const k = this.reduce ? (age < 900 ? 0.7 : 0) : Math.exp(-age / (this.doorLeave ? 700 : 600)) * Math.abs(Math.cos(age / 170));
        open = Math.min(1, k * (this.doorLeave ? 1.15 : 1));
      }
      const half = door.w / 2;
      const lw = Math.max(1, Math.round(half * (1 - open * 0.85)));
      const y0 = door.y + Math.round(door.h * 0.3), y1 = door.y + Math.round(door.h * 0.82);
      for (const side of [0, 1]) {
        const x0 = side ? door.x + door.w - lw : door.x;
        c.fillStyle = PAL.wood1; c.fillRect(x0, y0, lw, y1 - y0);
        c.fillStyle = PAL.wood2; for (let yy = y0 + 2; yy < y1 - 1; yy += 3) c.fillRect(x0, yy, lw, 1);
        c.fillStyle = PAL.ink; c.fillRect(side ? x0 : x0 + lw - 1, y0, 1, y1 - y0);
        // scalloped top edge
        c.fillStyle = PAL.wood2; c.fillRect(x0, y0 - 1, Math.max(1, lw - 2), 1);
        c.fillStyle = PAL.metal2; px(c, side ? door.x + door.w - 1 : door.x, y0 + 2, PAL.metal3); px(c, side ? door.x + door.w - 1 : door.x, y1 - 3, PAL.metal3);
      }
    }
  }

  private drawPianist(c: Ctx, vt: number, D: SceneData, shotAge: number) {
    const pi = this.geo.piano;
    if (!pi) return;
    const x = pi.x, floor = pi.floor, top = floor - 20, ky = top + 10;
    const bpm = D.fx?.tempo() ?? 0;
    const startled = shotAge < 1800;
    const playing = bpm > 0 && !startled && !this.reduce;
    const beat = playing ? Math.floor((vt / 60000) * bpm * 2) : 0; // eighth notes
    const bx = x + 8; // his back, centered on the keyboard
    // body (seen from behind): white shirt, black waistcoat, sleeve garters
    c.fillStyle = PAL.ink; c.fillRect(bx - 1, ky - 3, 10, floor - 5 - ky + 3);
    c.fillStyle = PAL.parch2; c.fillRect(bx, ky - 2, 8, floor - 6 - ky + 2);
    c.fillStyle = '#1c1612'; c.fillRect(bx + 1, ky - 1, 6, floor - 7 - ky + 1);
    c.fillStyle = '#3a2c22'; c.fillRect(bx + 4, ky - 1, 1, floor - 7 - ky + 1);
    // arms out to the keys; hands bob on the beat (alternating)
    const lUp = playing && beat % 2 === 0 ? 1 : 0, rUp = playing && beat % 2 === 1 ? 1 : 0;
    c.fillStyle = PAL.parch2; c.fillRect(bx - 4, ky - 2, 4, 2); c.fillRect(bx + 8, ky - 2, 4, 2);
    c.fillStyle = PAL.red1; c.fillRect(bx - 3, ky - 2, 1, 2); c.fillRect(bx + 10, ky - 2, 1, 2); // garters
    c.fillStyle = PAL.skin2; c.fillRect(bx - 6, ky - lUp, 3, 2); c.fillRect(bx + 11, ky - rUp, 3, 2);
    // head + bowler; looks over his shoulder when a shot rings out
    const hx = bx + 1, hy = ky - 9;
    c.fillStyle = PAL.ink; c.fillRect(hx - 1, hy - 1, 8, 8);
    c.fillStyle = '#1c120c'; c.fillRect(hx, hy, 6, 6); // hair, back of head
    c.fillStyle = PAL.skin1; c.fillRect(hx + 1, hy + 5, 4, 2); // neck
    if (startled) {
      // turned: a profile peeking right, wide eye
      c.fillStyle = PAL.skin2; c.fillRect(hx + 3, hy + 1, 4, 5); c.fillRect(hx + 7, hy + 3, 1, 1);
      px(c, hx + 5, hy + 2, PAL.white); px(c, hx + 6, hy + 2, PAL.ink);
      c.fillStyle = '#3a2418'; c.fillRect(hx + 4, hy + 4, 3, 1); // moustache
    } else {
      c.fillStyle = PAL.skin1; c.fillRect(hx, hy + 2, 1, 2); c.fillRect(hx + 5, hy + 2, 1, 2); // ears
    }
    // bowler
    c.fillStyle = PAL.ink; c.fillRect(hx - 2, hy - 1, 10, 2);
    c.fillStyle = '#1c1612'; c.fillRect(hx, hy - 5, 6, 5); c.fillRect(hx + 1, hy - 6, 4, 1);
    c.fillStyle = PAL.metal2; c.fillRect(hx, hy - 2, 6, 1);
    c.fillStyle = '#2a2420'; c.fillRect(hx - 2, hy - 1, 10, 1);
    px(c, hx + 1, hy - 5, PAL.metal3);
    // music notes drifting up while he plays
    if (playing) {
      const ph = (vt / 60000 * bpm) % 2;
      const nx = x + 18 + Math.round(ph * 2), ny = top - 4 - Math.round(ph * 4);
      if (ph < 1.6) { px(c, nx, ny, PAL.parch2); px(c, nx + 1, ny - 1, PAL.parch2); px(c, nx + 1, ny - 2, PAL.parch2); px(c, nx + 2, ny - 2, PAL.parch2); }
    }
  }

  /** the cat's box on the shelf in scene pixels (null while it's away, bolting, or there's no shelf) */
  catBox(): Rect | null {
    const sh = this.geo.shelf, cat = this.cat;
    if (sh.x1 - sh.x0 < 24 || cat.state === 'gone' || cat.state === 'bolt') return null;
    const x = Math.round(cat.x);
    if (this.catAct?.k === 'leap') { const a = this.catAct; return { x: Math.min(a.x0, a.x1) - 2, y: sh.y - 22, w: Math.abs(a.x1 - a.x0) + 13, h: 23 }; }
    return { x: x - 2, y: sh.y - 11, w: 13, h: 12 };
  }

  /** is (sx, sy) on the cat (within pad scene px), not on a bust in front of it, with enough of the cat in view? */
  catHit(sx: number, sy: number, pad = 2): boolean {
    const b = this.catBox();
    if (!b) return false;
    if (sx < b.x - pad || sx >= b.x + b.w + pad || sy < b.y - pad || sy >= b.y + b.h + pad) return false;
    const { W, H } = this.L, fg = this.fg;
    const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? fg[Math.floor(y) * W + Math.floor(x)] : 1);
    if (at(sx, sy)) return false; // that's the bust in front of it
    let vis = 0, n = 0;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { n++; if (!at(x, y)) vis++; }
    return n > 0 && vis / n > 0.35;
  }

  /** a tap on the cat: starts the next reaction in the cycle; null if it didn't land / it's busy */
  pokeCat(sx: number, sy: number, pad = 2): CatAct | null {
    if (this.catAct || !this.catHit(sx, sy, pad)) return null;
    const sh = this.geo.shelf, cat = this.cat;
    const lo = sh.x0 + 2, hi = sh.x1 - 9;
    for (let tries = 0; tries < CAT_ACTS.length; tries++) {
      const k = CAT_ACTS[this.catTurn++ % CAT_ACTS.length];
      const x0 = cat.x;
      if (k === 'knock') {
        // the nearest bottle still on the shelf that the cat can stand beside
        let best = -1, bd = 1e9;
        (this.geo.bottles ?? []).forEach((b, bi) => {
          if (this.missing.has(bi) || this.falls.length > 2) return;
          const d = Math.abs(b.x + b.w / 2 - (x0 + 4));
          if (d < bd) { bd = d; best = bi; }
        });
        if (best < 0) continue;
        const b = this.geo.bottles![best];
        // stand on the side of the bottle the cat is on (or whichever side has room)
        let left = x0 + 4 < b.x + b.w / 2;
        if (left && b.x - 9 < lo) left = false;
        if (!left && b.x + b.w + 1 > hi) left = true;
        const x1 = Math.max(lo, Math.min(hi, left ? b.x - 9 : b.x + b.w + 1));
        this.catAct = { k, v: this.vt, x0, x1, bi: best, dropped: false };
        cat.dir = left ? 1 : -1;
      } else if (k === 'leap') {
        if (hi - lo < 20) continue;
        // somewhere at least a third of the shelf away
        const span = hi - lo, far = span / 3;
        let x1 = lo + Math.random() * span;
        if (Math.abs(x1 - x0) < far) x1 = x0 + (x0 - lo > hi - x0 ? -1 : 1) * (far + Math.random() * far);
        x1 = Math.max(lo, Math.min(hi, x1));
        this.catAct = { k, v: this.vt, x0, x1, bi: -1, dropped: false };
        cat.dir = x1 >= x0 ? 1 : -1;
      } else {
        this.catAct = { k, v: this.vt, x0, x1: x0, bi: -1, dropped: false };
        if (k === 'hiss') cat.dir = x0 - sh.x0 < sh.x1 - x0 ? 1 : -1;
      }
      cat.state = 'act';
      return k;
    }
    return null;
  }

  private drawCat(c: Ctx, vt: number, dt: number, D: SceneData) {
    const sh = this.geo.shelf, cat = this.cat;
    // knocked bottles come back after a while (the barkeep restocks)
    if (this.missing.size && this.geo.shelfStrip && this.geo.bottles) {
      const st = this.geo.shelfStrip;
      for (const [bi, back] of this.missing) {
        if (vt < back) continue;
        const b = this.geo.bottles[bi];
        if (b) this.bgc.putImageData(st.full, st.x, st.y, b.x - st.x, b.y - st.y, b.w, b.h);
        this.missing.delete(bi);
      }
    }
    this.drawFalls(c, dt, D);
    if (sh.x1 - sh.x0 < 24) return;
    const lo = sh.x0 + 2, hi = sh.x1 - 9;
    if (cat.state === 'gone') {
      if (vt > cat.until) { cat.state = 'walk'; cat.dir = Math.random() < 0.5 ? 1 : -1; cat.x = cat.dir > 0 ? lo : hi; cat.until = vt + 3000 + Math.random() * 4000; }
      return;
    }
    const y = sh.y; // shelf top; the cat stands on it
    if (cat.state === 'act' && this.catAct) {
      if (this.drawCatAct(c, vt, y, D)) return;
      // done: sit a while where it ended up
      this.catAct = null;
      cat.state = 'sit'; cat.until = vt + 4000 + Math.random() * 5000;
    } else if (cat.state === 'act') { cat.state = 'sit'; cat.until = vt + 4000; }
    if (!this.reduce) {
      if (cat.state === 'walk') {
        cat.x += cat.dir * dt * 0.006;
        if (cat.x < lo || cat.x > hi) { cat.x = Math.max(lo, Math.min(hi, cat.x)); cat.dir *= -1; }
        if (vt > cat.until) { cat.state = 'sit'; cat.until = vt + 5000 + Math.random() * 8000; }
      } else if (cat.state === 'sit') {
        if (vt > cat.until) { cat.state = 'walk'; cat.dir = Math.random() < 0.5 ? 1 : -1; cat.until = vt + 3000 + Math.random() * 5000; }
      } else if (cat.state === 'bolt') {
        cat.x += cat.dir * dt * 0.06;
        if (cat.x < lo - 10 || cat.x > hi + 10) { cat.state = 'gone'; cat.until = vt + 9000 + Math.random() * 12000; return; }
      }
    } else if (cat.state === 'bolt') { cat.state = 'sit'; }
    const x = Math.round(cat.x);
    if (cat.state === 'sit') { this.catSit(c, x, y, vt); return; }
    this.catSide(c, x, y, cat.dir, vt, { run: cat.state === 'bolt' });
  }

  /** sitting, facing out, tail swishing */
  private catSit(c: Ctx, x: number, y: number, vt: number, o: { mouth?: boolean; happy?: boolean; look?: number } = {}) {
    const C0 = CAT0, C1 = CAT1;
    c.fillStyle = C0; c.fillRect(x + 1, y - 6, 5, 6); c.fillRect(x + 1, y - 9, 5, 3);
    px(c, x + 1, y - 10, C0); px(c, x + 5, y - 10, C0);
    c.fillStyle = C1; c.fillRect(x + 2, y - 4, 3, 3);
    if (o.happy) { px(c, x + 2, y - 8, C1); px(c, x + 4, y - 8, C1); }
    else { const lk = o.look ?? 0; px(c, x + 2, y - 8 + lk, CAT_EYE); px(c, x + 4, y - 8 + lk, CAT_EYE); }
    if (o.mouth) { px(c, x + 3, y - 7, '#c0506a'); px(c, x + 3, y - 6, '#5a1a24'); }
    const sw = this.reduce ? 0 : Math.round(Math.sin(vt / 260) * 2);
    c.fillStyle = C0; c.fillRect(x + 6, y - 1, 2, 1); c.fillRect(x + 7, y - 3, 1, 2); px(c, x + 7 + (sw > 0 ? 1 : 0), y - 4 + (sw < 0 ? 1 : 0), C0);
  }

  /** side view: walking / bolting / crouched / airborne / swiping a paw */
  private catSide(c: Ctx, x: number, y: number, d: number, vt: number, o: { run?: boolean; crouch?: boolean; air?: boolean; paw?: boolean; still?: boolean } = {}) {
    const C0 = CAT0;
    const f = Math.floor(vt / 160) % 2;
    const bx = x, hx = d > 0 ? x + 7 : x - 1;
    const dy = o.crouch ? 1 : 0;
    c.fillStyle = C0; c.fillRect(bx, y - 4 + dy, 8, 3);
    c.fillRect(hx - (d > 0 ? 0 : 1), y - 6 + dy, 3, 3); px(c, hx + (d > 0 ? 0 : 1), y - 7 + dy, C0); px(c, hx + (d > 0 ? 2 : -1), y - 7 + dy, C0);
    px(c, hx + (d > 0 ? 2 : -1), y - 5 + dy, CAT_EYE);
    c.fillStyle = C0;
    if (o.air) {
      // stretched out: front legs reaching, back legs trailing
      c.fillRect(d > 0 ? bx + 8 : bx - 2, y - 2, 2, 1); c.fillRect(d > 0 ? bx - 2 : bx + 8, y - 3, 2, 1);
    } else if (o.paw) {
      // one front paw up and out at the bottle
      c.fillRect(d > 0 ? bx + 8 : bx - 2, y - 4, 2, 1); c.fillRect(bx + (d > 0 ? 1 : 6), y - 1, 1, 1);
    } else if (!o.crouch) {
      const s = o.still ? 0 : o.run ? Math.floor(vt / 60) % 2 : f;
      c.fillRect(bx + (s ? 1 : 0), y - 1, 1, 1); c.fillRect(bx + (s ? 6 : 7), y - 1, 1, 1);
    }
    // tail: up when walking, straight back when bolting / leaping
    const tx = d > 0 ? bx - 1 : bx + 8;
    if (o.run || o.air) c.fillRect(d > 0 ? bx - 3 : bx + 8, y - 4 + dy, 3, 1);
    else { c.fillRect(tx, y - 6 + dy, 1, 3); px(c, tx + (f ? -d : 0), y - 7 + dy, C0); }
  }

  /** arched back, fur on end, tail puffed, mouth open */
  private catArch(c: Ctx, x: number, y: number, d: number, vt: number) {
    const C0 = CAT0;
    const jit = this.reduce ? 0 : Math.floor(vt / 70) % 2;
    const bx = x;
    c.fillStyle = C0;
    // legs straight (tiptoe), body high and bowed up in the middle
    c.fillRect(bx, y - 3, 1, 3); c.fillRect(bx + 1, y - 3, 1, 3); c.fillRect(bx + 6, y - 3, 1, 3); c.fillRect(bx + 7, y - 3, 1, 3);
    c.fillRect(bx, y - 6, 8, 3); c.fillRect(bx + 1, y - 7, 6, 1); c.fillRect(bx + 2, y - 8, 4, 1);
    // fur on end along the arch (bristling)
    for (let i = 0; i < 4; i++) if ((i + jit) % 2 === 0) px(c, bx + 2 + i, y - 9, C0);
    px(c, bx + 1, y - 8, C0); px(c, bx + 6, y - 8, C0);
    // head low at the front, ears flat back
    const hx = d > 0 ? x + 7 : x - 2;
    c.fillRect(hx, y - 5, 3, 3); px(c, d > 0 ? hx : hx + 2, y - 6, C0);
    px(c, hx + (d > 0 ? 1 : 1), y - 5, CAT_EYE);
    px(c, d > 0 ? hx + 2 : hx, y - 3, '#c0506a'); px(c, d > 0 ? hx + 3 : hx - 1, y - 3, '#fff3e0');
    // tail puffed straight up
    const tx = d > 0 ? x - 2 : x + 8;
    c.fillRect(tx, y - 10 - jit, 2, 6 + jit); px(c, tx - 1 + jit * 3, y - 9, C0);
  }

  /** draws the current reaction; false once it's over */
  private drawCatAct(c: Ctx, vt: number, y: number, D: SceneData): boolean {
    const a = this.catAct!, cat = this.cat;
    const age = vt - a.v;
    if (age > CAT_MS[a.k]) { cat.x = a.x1; return false; }
    switch (a.k) {
      case 'meow': {
        this.catSit(c, Math.round(cat.x), y, vt, { mouth: age > 120 && age < 700, happy: age > 900 });
        return true;
      }
      case 'hiss': {
        if (age < 120 || age > 1350) this.catSide(c, Math.round(cat.x), y, cat.dir, vt, { crouch: true });
        else this.catArch(c, Math.round(cat.x), y, cat.dir, vt);
        return true;
      }
      case 'leap': {
        const k = Math.max(0, Math.min(1, (age - 180) / 560));
        if (age < 180) { this.catSide(c, Math.round(a.x0), y, cat.dir, vt, { crouch: true }); return true; }
        if (k >= 1) { cat.x = a.x1; this.catSide(c, Math.round(a.x1), y, cat.dir, vt, { crouch: true }); return true; }
        const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
        cat.x = a.x0 + (a.x1 - a.x0) * e;
        const hgt = Math.min(16, 8 + Math.abs(a.x1 - a.x0) * 0.15);
        this.catSide(c, Math.round(cat.x), y - Math.round(hgt * 4 * k * (1 - k)), cat.dir, vt, { air: true });
        return true;
      }
      case 'knock': {
        const walkMs = Math.min(900, Math.abs(a.x1 - a.x0) / 0.03);
        const b = this.geo.bottles?.[a.bi];
        if (age < walkMs) {
          cat.x = a.x0 + (a.x1 - a.x0) * (age / Math.max(1, walkMs));
          this.catSide(c, Math.round(cat.x), y, cat.dir, vt, { run: false });
          return true;
        }
        cat.x = a.x1;
        const t = age - walkMs;
        // two little test taps, then the swipe that sends it over
        const paw = (t > 150 && t < 300) || (t > 450 && t < 600) || (t > 800 && t < 1050);
        if (t > 850 && !a.dropped) { a.dropped = true; if (b) this.dropBottle(a.bi, b, cat.dir); }
        if (t > 1250) this.catSit(c, Math.round(cat.x), y, vt, { look: 1 });
        else this.catSide(c, Math.round(cat.x), y, cat.dir, vt, { paw, still: true });
        return true;
      }
    }
    return false;
  }

  /** take a bottle off the wall layer and send it tumbling off the shelf */
  private dropBottle(bi: number, b: Rect & { col: string }, dir: number) {
    const st = this.geo.shelfStrip;
    if (!st || this.missing.has(bi) || b.w < 1 || b.h < 1) return;
    const [cv, cc] = makeCanvas(b.w, b.h);
    cc.putImageData(st.full, st.x - b.x, st.y - b.y, b.x - st.x, b.y - st.y, b.w, b.h);
    // only the bottle falls: clear the wall pixels beside its neck + cork
    const id = cc.getImageData(0, 0, b.w, b.h), bw = st.bare.width, bd = st.bare.data;
    for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
      const o = (yy * b.w + xx) * 4, q = ((b.y - st.y + yy) * bw + (b.x - st.x + xx)) * 4;
      if (id.data[o] === bd[q] && id.data[o + 1] === bd[q + 1] && id.data[o + 2] === bd[q + 2]) id.data[o + 3] = 0;
    }
    cc.putImageData(id, 0, 0);
    this.bgc.putImageData(st.bare, st.x, st.y, b.x - st.x, b.y - st.y, b.w, b.h);
    this.missing.set(bi, this.vt + 22000 + Math.random() * 12000);
    // it smashes on the chair rail under the shelf (the floor itself is hidden behind the busts)
    const ground = Math.min(this.L.H - 2, Math.max(this.geo.shelf.y + 10, Math.round(this.L.tableTop * 0.8)));
    this.falls.push({ cv, x: b.x + b.w / 2, y: b.y + b.h / 2, vx: dir * (0.012 + Math.random() * 0.006), vy: -0.03, rot: 0, spin: dir * 0.012, ground, col: b.col });
  }

  /** falling bottles (behind the busts) and the glass they leave */
  private drawFalls(c: Ctx, dt: number, D: SceneData) {
    if (this.falls.length) {
      const keep: Fall[] = [];
      for (const f of this.falls) {
        f.vy += 0.00045 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.spin * dt;
        if (f.y + f.cv.height / 2 >= f.ground) {
          D.fx?.onCat?.('shatter');
          const n = this.low ? 8 : 14;
          for (let i = 0; i < n; i++) {
            const a = -Math.PI * (0.1 + 0.8 * Math.random());
            const sp = 0.02 + Math.random() * 0.05;
            this.shards.push({ x: f.x, y: f.ground - 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 500 + Math.random() * 500, col: i % 3 === 0 ? '#e8f4ff' : i % 3 === 1 ? shade(f.col, 2.4) : shade(f.col, 1.6) });
          }
          continue;
        }
        keep.push(f);
        // quarter-turn steps keep it pixel-crisp
        const q = Math.round(f.rot / (Math.PI / 4)) * (Math.PI / 4);
        c.save();
        c.translate(Math.round(f.x), Math.round(f.y));
        c.rotate(q);
        c.drawImage(f.cv, -Math.floor(f.cv.width / 2), -Math.floor(f.cv.height / 2));
        c.restore();
      }
      this.falls = keep;
    }
    if (this.shards.length) {
      this.shards = this.shards.filter((s) => (s.life -= dt) > 0);
      for (const s of this.shards) {
        s.vy += 0.00025 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
        px(c, Math.round(s.x), Math.round(s.y), s.col);
      }
    }
  }

  /** MEOW! + hearts / HISS!, unlit so they read */
  private drawCatFx(c: Ctx, vt: number) {
    const a = this.catAct;
    if (!a || (a.k !== 'meow' && a.k !== 'hiss')) return;
    const age = vt - a.v;
    const x = Math.round(this.cat.x), y = this.geo.shelf.y;
    const W = this.L.W;
    const word = a.k === 'meow' ? 'MEOW!' : 'HISS!';
    const show = a.k === 'meow' ? age > 120 && age < 1300 : age > 150 && age < 1250;
    if (show) {
      const tw = word.length * 4 - 1;
      const hop = this.reduce ? 0 : age < 260 ? 2 : age < 380 ? 1 : 0;
      const tx = Math.max(2, Math.min(W - tw - 2, x + 4 - Math.floor(tw / 2)));
      const ty = Math.max(2, y - 18 - hop);
      // ink outline, then the letters
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) text3(c, word, tx + ox, ty + oy, PAL.ink);
      text3(c, word, tx, ty, a.k === 'meow' ? '#fff3c4' : '#ff8a5c');
    }
    if (a.k === 'meow' && age > 300) {
      for (let i = 0; i < 3; i++) {
        const t = age - 300 - i * 260;
        if (t < 0 || t > 1100) continue;
        const k = t / 1100;
        const hx = x + 3 + (i - 1) * 5 + Math.round(Math.sin(t / 180 + i) * 1.5);
        const hy = y - 11 - Math.round(k * 14);
        if (k < 0.85 || Math.floor(t / 80) % 2) glyph(c, GL.heart, hx, hy, '#ff6b8a', 1);
      }
    }
  }

  /** emote props + effects, drawn after the lighting pass so they stay bright and readable */
  private drawEmoteFx(c: Ctx, g: SeatGeom, a: Anim, age: number, ox: number, oy: number, ps: Pose2) {
    const s = g.scale;
    const k = s >= 1.02 ? 2 : 1; // glyph scale: big busts get chunkier effects
    const bl = Math.round(g.x - Math.round(BUST_W * s) / 2) + ox;
    const B = (bx: number, by: number) => ({ x: Math.round(bl + bx * s), y: Math.round(g.top + oy + by * s) });
    const tw = Math.floor(age / 120) % 2; // twinkle phase
    const hx = ps.pose?.hx ?? 0, hy = ps.pose?.hy ?? 0;
    switch (a.kind) {
      case 'tip': {
        if (age > 200 && age < 1250) {
          const p = B(42 + hx, (ps.hatDy ?? 0) + 2 + hy);
          glyph(c, tw ? GL.star7 : GL.star5, p.x, p.y, '#fff3b8', k);
          px(c, p.x, p.y, PAL.white, 1, 1);
          if (age > 420) { const q = B(6, (ps.hatDy ?? 0) - 2 + hy); glyph(c, tw ? GL.star3 : GL.star5, q.x, q.y, '#ffd36b', k); }
        }
        break;
      }
      case 'spit': {
        // brass spittoon on the table edge to the player's right
        const tx = Math.round(g.x + g.w * 0.5), ty = Math.round(g.edge + 2) - (age < 120 ? 3 : age < 200 ? -1 : 0);
        if (age < 1850) {
          c.fillStyle = PAL.ink; c.fillRect(tx - 6, ty - 7, 13, 10); c.fillRect(tx - 5, ty - 8, 11, 1);
          c.fillStyle = '#8a6214'; c.fillRect(tx - 5, ty - 6, 11, 8);
          c.fillStyle = '#c99a2a'; c.fillRect(tx - 5, ty - 6, 11, 2); c.fillRect(tx - 4, ty - 3, 2, 4);
          c.fillStyle = '#ffe08a'; c.fillRect(tx - 3, ty - 3, 1, 2); c.fillRect(tx - 4, ty - 6, 3, 1);
          c.fillStyle = '#5a3e0a'; c.fillRect(tx - 3, ty - 6, 7, 1); // mouth of the bowl
          c.fillStyle = '#3a2808'; c.fillRect(tx - 2, ty - 5, 5, 1);
        }
        const m = B(29 + 2, 24 + 1);
        if (age >= 300 && age < 850) {
          const u = (age - 300) / 550;
          const pt = (q: number) => ({ x: Math.round(m.x + (tx - m.x) * q), y: Math.round(m.y + (ty - 7 - m.y) * q - Math.sin(q * Math.PI) * (8 + 10 * s)) });
          for (const [dq, col] of [[0.16, '#5f8090'], [0.08, '#8fb0c0'], [0, '#e8f6ff']] as const) {
            const q = Math.max(0, u - dq); const p = pt(q);
            const z = dq ? k : k + 1; // the gob itself a size up from its trail
            c.fillStyle = PAL.ink; c.fillRect(p.x - 1, p.y - 1, z + 2, z + 2);
            c.fillStyle = col; c.fillRect(p.x, p.y, z, z);
          }
        }
        if (age >= 850 && age < 1250) {
          const u = (age - 850) / 400;
          for (const d of [-1, 1]) for (const sp of [1, 2]) {
            const x = Math.round(tx + d * sp * (2 + u * 5)), y = Math.round(ty - 8 - Math.sin(u * Math.PI) * (3 + sp * 2));
            px(c, x, y, '#cfe6f0', k, k);
          }
          glyph(c, tw ? GL.star5 : GL.star7, tx + 7, ty - 10, '#fff3b8', k); // ding!
        }
        break;
      }
      case 'laugh': {
        if (age > 150 && age < 1700) {
          const u = (age % 300) / 300;
          for (const [ex, d] of [[16, -1], [32, 1]] as const) {
            const p = B(ex + hx, 16 + hy);
            px(c, p.x + d * Math.round(1 + u * 4), p.y + Math.round(u * u * 4), '#8fd0ff', k, k);
          }
        }
        break;
      }
      case 'yeehaw': {
        // dust kicked up off the shoulders when the hat goes, and again on the catch
        for (const [t0, n] of [[YEE.up, 1], [YEE.catch, 0.6]] as const) {
          if (age < t0 || age > t0 + 520) continue;
          const u = (age - t0) / 520;
          for (const d of [-1, 1]) for (let i = 0; i < 2; i++) {
            const p = B(24 + d * (20 + u * 10 + i * 5), 34 - u * 6 - i * 3);
            puff(c, p.x, p.y, Math.max(1, Math.round((1 + u * 2.5) * Math.max(1, s) * n)) + i, 1 - u, '#d8c4a0', '#9a8466');
          }
        }
        // speed lines under the rising hat
        if (age > YEE.up && age < YEE.up + 380) {
          const top = B(24, (ps.hatDy ?? 0) + 14);
          for (const dx of [-6, 0, 6]) { c.fillStyle = '#e8d5b5'; c.fillRect(top.x + Math.round(dx * s), top.y, 1, 3 + k * 2); }
        }
        break;
      }
      case 'clap': {
        for (const t0 of CLAPS) {
          if (age < t0 || age >= t0 + CLAP_HOLD) continue;
          const big = age < t0 + 80;
          const col = big ? PAL.white : '#fff3b8';
          // impact rays fanning up and out from where the palms meet + ticks at the sides (the face stays clear)
          const d0 = big ? 9 : 8;
          const l = B(24 - d0, 22), r = B(24 + d0, 22);
          glyph(c, GL.rayL, l.x, l.y, col, k); glyph(c, GL.rayR, r.x, r.y, col, k);
          for (const d of [-1, 1]) {
            const q = B(24 + d * (big ? 11 : 10), 28);
            c.fillStyle = PAL.ink; c.fillRect(q.x - 1, q.y - 1, k + 2, 4 * k + 2);
            c.fillStyle = col; c.fillRect(q.x, q.y, k, 4 * k);
          }
          if (big) { const p = B(24, 36); glyph(c, GL.star3, p.x, p.y, PAL.white, k); }
        }
        break;
      }
      case 'shrug': {
        // question marks floating up from around the head
        // (they stay beside the head: the caption owns the space above it)
        const spots: [number, number, number][] = [[250, 2, 6], [480, 46, 4], [760, 6, 3], [1000, 42, 1]];
        for (const [t0, bx, by] of spots) {
          const u = (age - t0) / 700;
          if (u < 0 || u > 1) continue;
          if (u > 0.75 && tw) continue; // flicker out
          const p = B(bx, by);
          glyph(c, GL.q, p.x, p.y - Math.round(u * 7 * Math.max(1, s)), PAL.parch, k);
        }
        break;
      }
      case 'angry': {
        if (age < 1800) {
          // solid, outlined steam puffs jetting from both ears
          for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
            const ph = ((age / 500) + i / 3) % 1;
            if (ph > 0.85 && tw) continue;
            const p = B(24 + side * (12 + ph * 9) + hx, 17 - ph * 15);
            const r = Math.max(1, Math.round((1 + ph * 1.6) * k));
            circle(c, p.x, p.y, r + 1, PAL.ink);
            circle(c, p.x, p.y, r, ph < 0.55 ? '#f4ece0' : '#b8aea4');
            if (r > 1) px(c, p.x - 1, p.y - 1, PAL.white);
          }
          // pulsing vein mark by the temple
          const p = B(37, 3);
          glyph(c, f2(age, 160) ? GL.vein7 : GL.vein5, p.x, p.y, '#ff3a2a', k);
        }
        break;
      }
      case 'drink': {
        if (age >= 300 && age < 650 && tw) { const p = B(41, 7); glyph(c, GL.star5, p.x, p.y, '#fff3b8', k); }
        if (age >= 1400 && age < 2000) { const p = B(37, 25); glyph(c, tw ? GL.star7 : GL.star3, p.x, p.y, '#fff3b8', k); }
        break;
      }
    }
  }
}

const f2 = (age: number, ms: number) => Math.floor(age / ms) % 2 === 1;

/** 1 where the canvas has any opacity */
function alphaMask(cv: HTMLCanvasElement): Uint8Array {
  const w = cv.width, h = cv.height, m = new Uint8Array(w * h);
  const d = cv.getContext('2d')!.getImageData(0, 0, w, h).data;
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  return m;
}
/** OR a sprite mask into a W x H mask at (x0, y0), clipped */
function stampMask(dst: Uint8Array, W: number, H: number, m: Uint8Array, w: number, h: number, x0: number, y0: number) {
  const ya = Math.max(0, -y0), yb = Math.min(h, H - y0), xa = Math.max(0, -x0), xb = Math.min(w, W - x0);
  for (let y = ya; y < yb; y++) {
    const r = (y0 + y) * W + x0, s = y * w;
    for (let x = xa; x < xb; x++) if (m[s + x]) dst[r + x] = 1;
  }
}

export function rgbOf(hex: string) { return hexRgb(hex); }
