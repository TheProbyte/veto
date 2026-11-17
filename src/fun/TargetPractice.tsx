// Lobby target practice: a 20-second solo shooting gallery on the saloon's back bar. Bottles pop up on the shelves,
// the bar and the piano; gold ones are worth 3, the barkeep's coffee pot costs 2. The score (0..99) goes to the
// server once at the end of a round and the table keeps a top 5 (state.record.bottles).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import { PAL, hexRgb, rnd } from '../pixel/palette';
import { bayer, makeCanvas } from '../pixel/dither';
import { PixelSprite } from '../pixel/PixelCanvas';
import { computeLayout } from '../pixel/scene';
import { sfx } from '../sfx';
import { FONT35, FONT57, STAR_DIM, STAR_ICON, TARGET_ICON, bitText, clamp, lerp, spriteFrom } from './pix';
import './fun.css';

const ROUND_MS = 20000;
const READY_MS = 1300;
/** end-card star bands (score >= n) */
const STARS = [10, 20, 30];
const RANKS = ['Greenhorn', 'Fair shot', 'Sharpshooter', 'Dead-eye'];

const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/* ============================== sprites ============================== */

type Kind = 'brown' | 'green' | 'whiskey' | 'jug' | 'blue' | 'red' | 'gold' | 'pot';
const PTS: Record<Kind, number> = { brown: 1, green: 1, whiskey: 1, jug: 1, blue: 1, red: 1, gold: 3, pot: -2 };
const PLAIN: Kind[] = ['brown', 'green', 'whiskey', 'jug', 'blue', 'red'];

// h = lit edge, g = glint, m = body, d = shade, L = label, s = label print, c = cork / cap, q = liquid, k = glaze, l = handle
const BEER = [
  '..cc..',
  '..gm..',
  '..hm..',
  '..hd..',
  '.hmmd.',
  'hgmmmd',
  'hgmmmd',
  'LLLLLL',
  'LsLssL',
  'LLLLLL',
  'hmmmmd',
  'hmmmmd',
  '.dddd.',
];
const WINE = [
  '..cc..',
  '..cc..',
  '..hm..',
  '..hm..',
  '..hd..',
  '.hmmd.',
  'hgmmmd',
  'hgmmmd',
  'hmLLmd',
  'hmLsmd',
  'hmLLmd',
  'hmmmmd',
  'hmmmmd',
  '.dddd.',
];
const FLASK = [
  '..ccc..',
  '..hmd..',
  '.hmmmd.',
  'hgqqqqd',
  'hgLLLqd',
  'hqLsLqd',
  'hqLLLqd',
  'hqqqqqd',
  'hqqqqqd',
  '.ddddd.',
];
const JUG = [
  '..cc....',
  '..kd....',
  '.hkkd.l.',
  'hkkkkdll',
  'hgmmmmdl',
  'hgLLLmdl',
  'hmLsLmd.',
  'hmLLLmd.',
  'hmmmmmd.',
  '.hmmmd..',
  '..ddd...',
];
const VIAL = [
  '.ccc.',
  '.mmm.',
  'hgmmd',
  'hgmmd',
  'hLLLd',
  'hLsLd',
  'hLLLd',
  'hmmmd',
  'hmmmd',
  '.ddd.',
];
const ROUND = [
  '...c...',
  '...m...',
  '...m...',
  '..hmd..',
  '.hgmmd.',
  'hgmmmmd',
  'hgLLLmd',
  'hmLsLmd',
  'hmmmmmd',
  '.hmmmd.',
  '..ddd..',
];
const POT = [
  '.....kk.....',
  '....llll....',
  '...hmmmmd...',
  'ss.hmmmmd.kk',
  '.s.hwmmmdk.k',
  '..shmmmwdk.k',
  '...hmmmmdk.k',
  '..hmmwmmmdkk',
  '..hmmmmmmd..',
  '..hmmmmmmd..',
  '..dddddddd..',
];
const GOLD = { h: '#fff3b8', m: '#d4a52a', d: '#a87c18' };
const REDS = { h: '#d0503c', m: PAL.red1, d: PAL.red2 };
/** glass colours (shards) + what splashes out (drops) */
const SHARDS: Record<Kind, string[]> = {
  brown: ['#5a2e12', '#8a4a1c', '#c47a3a'], green: ['#1f4a22', '#2f6a3a', '#6fae6a'],
  whiskey: [PAL.parch3, PAL.parch2, PAL.parch], jug: [PAL.parch3, PAL.parch2, PAL.wood3],
  blue: [PAL.blue1, PAL.blue2, PAL.blue3], red: [REDS.d, REDS.m, REDS.h],
  gold: [GOLD.d, GOLD.m, GOLD.h], pot: [PAL.blue1, PAL.blue2, PAL.blue3],
};
const LIQUID: Record<Kind, string[]> = {
  brown: ['#e0a040', PAL.parch], green: [PAL.red1, PAL.red2], whiskey: [PAL.lamp1, PAL.lamp3], jug: [PAL.moon, PAL.parch2],
  blue: ['#6fae6a', PAL.felt3], red: ['#d0503c', PAL.red1], gold: ['#fff3b8', '#f2d36b'], pot: [PAL.wood2, PAL.wood1],
};

let SPR: Record<Kind, HTMLCanvasElement> | null = null;
let FLASH: Record<Kind, HTMLCanvasElement> | null = null;
function sprites() {
  if (SPR) return SPR;
  const g = PAL.white;
  SPR = {
    brown: spriteFrom(BEER, { h: '#c47a3a', g, m: '#8a4a1c', d: '#5a2e12', L: PAL.parch, s: PAL.red1, c: '#7a5232' }),
    green: spriteFrom(WINE, { h: '#6fae6a', g, m: '#2f6a3a', d: '#1f4a22', L: PAL.parch2, s: PAL.red2, c: PAL.red1 }),
    whiskey: spriteFrom(FLASK, { h: PAL.parch, g, m: PAL.parch2, d: PAL.parch3, q: PAL.lamp1, L: PAL.white, s: PAL.red1, c: PAL.wood3 }),
    jug: spriteFrom(JUG, { h: PAL.parch, g, m: PAL.parch2, d: PAL.parch3, k: PAL.wood3, L: PAL.parch, s: PAL.wood0, l: PAL.parch3, c: '#7a5232' }),
    blue: spriteFrom(VIAL, { h: PAL.blue3, g, m: PAL.blue2, d: PAL.blue1, L: PAL.parch, s: PAL.red1, c: PAL.metal3 }),
    red: spriteFrom(ROUND, { ...REDS, g, L: PAL.parch, s: PAL.ink, c: PAL.wood4 }),
    gold: spriteFrom(WINE, { ...GOLD, g, L: PAL.red1, s: '#f2d36b', c: '#6b4a0c' }),
    pot: spriteFrom(POT, { h: PAL.blue3, m: PAL.blue2, d: PAL.blue1, w: PAL.white, l: PAL.metal3, k: PAL.metal2, s: PAL.metal2 }),
  };
  return SPR;
}
/** white silhouettes for the impact frame */
function flashes() {
  if (FLASH) return FLASH;
  const out = {} as Record<Kind, HTMLCanvasElement>;
  for (const [k, sp] of Object.entries(sprites()) as [Kind, HTMLCanvasElement][]) {
    const [cv, c] = makeCanvas(sp.width, sp.height);
    c.drawImage(sp, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = PAL.white; c.fillRect(0, 0, sp.width, sp.height);
    out[k] = cv;
  }
  return (FLASH = out);
}

/* ============================== layout ============================== */

interface Surf { x0: number; x1: number; y: number; kind: 'shelf' | 'bar' | 'piano' }
interface Box { x0: number; x1: number; y0: number; y1: number }
interface Geo {
  W: number; H: number; S: number; surfs: Surf[]; bar: number; piano: { x0: number; x1: number; y: number };
  mirror: Box; lamps: { x: number; y: number }[]; hudTop: number; hudRight: number; hudLeft: number;
}

/** art-pixel geometry; `qb` = the quit button's rect (safe areas + where the HUD may go) */
function geo(vw: number, vh: number, qb: DOMRect | null, padL = 10): Geo {
  // the same chunky pixel as the saloon scene, but never so small that bottles get fiddly on a phone
  const S = clamp(computeLayout(vw, vh).P, 3, 6);
  const W = Math.ceil(vw / S), H = Math.ceil(vh / S);
  const portrait = H > W * 1.15;
  const hudTop = qb && qb.height ? Math.max(2, Math.floor(qb.top / S)) : 3;
  const hudRight = qb && qb.width ? Math.ceil((vw - qb.left) / S) + 2 : 16;
  const hudLeft = Math.max(2, Math.ceil((padL - 10) / S) + 2); // clear a landscape notch
  const hudBot = hudTop + 14;
  const bar = Math.round(H * (portrait ? 0.82 : 0.8));
  const surfs: Surf[] = [];
  let piano, mirror: Box;
  const lampY = hudBot + 3;
  let lamps: { x: number; y: number }[];
  if (portrait) {
    const a = Math.max(Math.round(H * 0.2), hudBot + 33), b = Math.max(Math.round(H * 0.46), a + 40);
    for (let i = 0; i < 3; i++) surfs.push({ x0: 6, x1: W - 6, y: Math.round(lerp(a, b, i / 2)), kind: 'shelf' });
    piano = { x0: 6, x1: Math.round(W * 0.62), y: Math.round(H * 0.63) };
    mirror = { x0: 3, x1: W - 4, y0: a - 19, y1: b + 6 };
    lamps = [{ x: Math.round(W / 2), y: lampY }];
  } else {
    const a = Math.max(Math.round(H * 0.24), hudBot + 19), b = Math.round(H * 0.6);
    for (let i = 0; i < 3; i++) surfs.push({ x0: 8, x1: Math.round(W * 0.64), y: Math.round(lerp(a, b, i / 2)), kind: 'shelf' });
    piano = { x0: Math.round(W * 0.69), x1: W - 8, y: Math.round(H * 0.52) };
    mirror = { x0: 4, x1: Math.round(W * 0.64) + 4, y0: a - 19, y1: b + 6 };
    lamps = [{ x: Math.round(W * 0.34), y: lampY }, { x: Math.round(W * 0.84), y: lampY }];
  }
  surfs.push({ x0: piano.x0 + 3, x1: piano.x1 - 3, y: piano.y, kind: 'piano' });
  surfs.push({ x0: 6, x1: W - 6, y: bar, kind: 'bar' });
  return { W, H, S, surfs, bar, piano, mirror, lamps, hudTop, hudRight, hudLeft };
}

/* ---- the back bar, painted once per size into a palette buffer, then lit + vignetted ---- */

const RGB = new Map<string, [number, number, number]>();
const rgbOf = (h: string) => { let v = RGB.get(h); if (!v) { v = hexRgb(h); RGB.set(h, v); } return v; };
const WALL = [PAL.ink, PAL.wood0, PAL.wood1, PAL.wood2, PAL.wood3, PAL.wood4, PAL.lamp3, PAL.lamp2];
const GLASS = [PAL.ink, PAL.blue0, PAL.blue1, PAL.blue2, PAL.blue3];
const GILT = [PAL.wood0, PAL.wood3, PAL.lamp3, PAL.lamp1, PAL.lamp0];
const BRASS = [PAL.wood1, PAL.lamp3, PAL.lamp1, PAL.lamp0];
/** one step darker (vignette) */
const DARKER: Record<string, string> = {
  [PAL.wood0]: PAL.ink, [PAL.wood1]: PAL.wood0, [PAL.wood2]: PAL.wood1, [PAL.wood3]: PAL.wood2, [PAL.wood4]: PAL.wood3,
  [PAL.lamp0]: PAL.lamp1, [PAL.lamp1]: PAL.lamp3, [PAL.lamp2]: PAL.lamp3, [PAL.lamp3]: PAL.wood3,
  [PAL.blue0]: PAL.ink, [PAL.blue1]: PAL.blue0, [PAL.blue2]: PAL.blue1, [PAL.blue3]: PAL.blue2, [PAL.metal3]: PAL.blue2,
  [PAL.parch]: PAL.parch2, [PAL.parch2]: PAL.parch3, [PAL.parch3]: PAL.wood3, [PAL.white]: PAL.parch, [PAL.red1]: PAL.red2, [PAL.red2]: PAL.wood0,
};
const pick = (ramp: string[], v: number, x: number, y: number) => ramp[clamp(Math.floor(v + bayer(x, y) - 0.5), 0, ramp.length - 1)];

function backdrop(g: Geo): HTMLCanvasElement {
  const { W, H, mirror: M, piano: P, bar: pb } = g;
  const buf: string[] = new Array(W * H).fill(PAL.ink);
  const set = (x: number, y: number, col: string) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = col; };
  const R = Math.max(W, H) * 0.55;
  const light = (x: number, y: number) => {
    let L = 0;
    for (const l of g.lamps) {
      const d = Math.hypot((x - l.x) / R, (y - l.y - 6) / (R * 0.75));
      L += Math.pow(Math.max(0, 1 - d), 1.7) + Math.pow(Math.max(0, 1 - d * 5), 2) * 0.6;
    }
    return Math.min(1.4, L);
  };
  // shelf shadows fall on whatever is behind (wall or mirror)
  const shadow = (x: number, y: number) => {
    for (const s of g.surfs) {
      if (s.kind !== 'shelf' || x < s.x0 - 2 || x > s.x1 + 2) continue;
      const d = y - s.y - 3;
      if (d >= 0 && d < 5) return 1.8 * (1 - d / 5);
    }
    return 0;
  };

  // plank wall with grain, seams and staggered butt joints
  const PW = 10;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const pl = Math.floor(x / PW), lx = x % PW;
    let v = 0.9 + light(x, y) * 5 + (rnd(pl, 3, 11) - 0.5) * 0.5 - shadow(x, y);
    const grain = Math.sin(y * 0.3 + pl * 2.1 + Math.sin(lx * 0.7 + y * 0.05 + pl) * 1.6);
    if (grain > 0.88) v -= 0.7;
    if (lx === 0) v -= 2;
    else if (lx === 1) v += 0.4;
    if ((y + pl * 17) % 47 === 0) v -= 1.6;
    if (rnd(pl, Math.floor(y / 5), 5) > 0.992 && lx > 3 && lx < 7) v -= 1.2; // knot
    set(x, y, pick(WALL, v, x, y));
  }
  // nail heads at the joints
  for (let x = 0; x < W; x += PW) for (let y = 0; y < H; y++) if ((y + Math.floor(x / PW) * 17) % 47 === 2) { set(x + 2, y, PAL.wood4); set(x + 2, y + 1, PAL.wood0); }

  // back-bar mirror: carved frame with a gilt bead, smoky glass with a diagonal sheen, the lamps reflected in it
  for (let y = M.y0; y <= M.y1; y++) for (let x = M.x0; x <= M.x1; x++) {
    const e = Math.min(x - M.x0, M.x1 - x, y - M.y0, M.y1 - y);
    if (e === 0 || e === 4) { set(x, y, PAL.ink); continue; }
    const lit = (y - M.y0 === e || x - M.x0 === e) ? 1 : -0.6;
    if (e <= 2) { set(x, y, pick(WALL, 2 + light(x, y) * 2.2 + lit * (e === 1 ? 1 : 0.4), x, y)); continue; }
    if (e === 3) { set(x, y, pick(GILT, 1.3 + light(x, y) * 2 + lit * 0.6, x, y)); continue; }
    const sheen = (x + y * 0.7 - M.x0) % 41;
    let v = 0.9 + light(x, y) * 1.9 - shadow(x, y) * 0.8 - (e < 7 ? 0.4 : 0);
    if (sheen < 3) v += 1.1; else if (sheen > 5 && sheen < 7) v += 0.6;
    set(x, y, pick(GLASS, v, x, y));
  }
  for (const l of g.lamps) {
    if (l.x < M.x0 + 6 || l.x > M.x1 - 6) continue;
    const ry = M.y0 + 8;
    for (let j = -4; j <= 4; j++) for (let i = -8; i <= 8; i++) {
      const d = Math.hypot(i / 8, j / 4); if (d > 1) continue;
      const x = l.x + i, y = ry + j, a = (1 - d) * 1.6;
      if (a > bayer(x, y)) set(x, y, a > 1.15 ? PAL.lamp0 : a > 0.6 ? PAL.lamp1 : PAL.lamp3);
    }
  }
  for (const [cx, cy] of [[M.x0 + 2, M.y0 + 2], [M.x1 - 2, M.y0 + 2], [M.x0 + 2, M.y1 - 2], [M.x1 - 2, M.y1 - 2]]) {
    set(cx, cy, PAL.lamp0); set(cx - 1, cy, PAL.lamp3); set(cx + 1, cy, PAL.lamp3); set(cx, cy - 1, PAL.lamp1); set(cx, cy + 1, PAL.lamp3);
  }

  // a weathered wanted poster in the empty wall space
  {
    const pw = Math.max(14, Math.min(26, P.x1 - P.x0 - 10, Math.round(W * 0.2)));
    const portrait = H > W * 1.15;
    const x0 = portrait ? Math.round((P.x1 + W) / 2 - pw / 2) : Math.round((P.x0 + P.x1) / 2 - pw / 2);
    const y0 = portrait ? g.surfs[2].y + 14 : g.lamps[g.lamps.length - 1].y + 14;
    const room = (portrait ? pb - 8 : P.y - 10) - y0;
    const ph = Math.min(Math.round(pw * 1.3), room);
    if (ph >= pw * 1.1 && ph > 14 && x0 + pw < W - 3) {
      for (let y = y0; y < y0 + ph; y++) for (let x = x0; x < x0 + pw; x++) {
        const edge = Math.min(x - x0, x0 + pw - 1 - x, y - y0, y0 + ph - 1 - y);
        const age = (edge < 2 ? 1.2 : 0) + rnd(x, y, 21) * 0.5;
        set(x, y, pick([PAL.parch3, PAL.parch2, PAL.parch], 2.2 - age + light(x, y) * 0.6, x, y));
      }
      for (let x = x0 + 1; x <= x0 + pw; x++) set(x, y0 + ph, PAL.ink);
      for (let y = y0 + 1; y <= y0 + ph; y++) set(x0 + pw, y, PAL.ink);
      const cx = x0 + Math.floor(pw / 2);
      for (let x = x0 + 2; x < x0 + pw - 2; x++) { set(x, y0 + 2, PAL.wood1); set(x, y0 + 3, PAL.wood1); }
      for (let x = x0 + 3; x < x0 + pw - 3; x += 3) set(x, y0 + 3, PAL.parch2);
      const fy = y0 + 6, fr = Math.max(3, Math.round(pw * 0.18));
      for (let j = 0; j <= fr * 2 + 1; j++) for (let i = -fr; i <= fr; i++) {
        if (Math.hypot(i / fr, (j - fr) / (fr + 0.5)) <= 1) set(cx + i, fy + 2 + j, PAL.wood3);
      }
      for (let i = -fr - 2; i <= fr + 2; i++) set(cx + i, fy + 2, PAL.wood0);
      for (let i = -fr + 1; i <= fr - 1; i++) { set(cx + i, fy, PAL.wood0); set(cx + i, fy + 1, PAL.wood0); }
      for (let k = 0; k < 3; k++) { const y = fy + fr * 2 + 6 + k * 2; if (y < y0 + ph - 2) for (let x = x0 + 3; x < x0 + pw - 3; x++) if (rnd(x, y, 7) > 0.25) set(x, y, PAL.wood2); }
      set(cx, y0, PAL.metal3); set(cx, y0 + 1, PAL.metal1);
    }
  }

  // shelves: lit lip, face, dark underside, brackets
  for (const s of g.surfs) {
    if (s.kind !== 'shelf') continue;
    for (let x = s.x0 - 2; x <= s.x1 + 2; x++) {
      const L = light(x, s.y);
      set(x, s.y, pick([PAL.wood3, PAL.wood4, PAL.lamp3], 0.8 + L * 2, x, s.y));
      set(x, s.y + 1, pick([PAL.wood2, PAL.wood3, PAL.wood4], 0.6 + L * 1.6, x, s.y + 1));
      set(x, s.y + 2, PAL.wood1);
      set(x, s.y + 3, PAL.ink);
    }
    set(s.x0 - 2, s.y + 1, PAL.wood2); set(s.x1 + 2, s.y + 1, PAL.wood2);
    for (const bx of [s.x0 + 3, Math.round((s.x0 + s.x1) / 2), s.x1 - 4]) {
      for (let k = 0; k < 4; k++) { const w = 4 - k; for (let i = 0; i < w; i++) set(bx + i, s.y + 3 + k, i === 0 ? PAL.wood3 : i === w - 1 ? PAL.ink : PAL.wood1); }
    }
  }

  // hanging lamps: chain, brass cap, amber shade, bright mantle
  for (const l of g.lamps) {
    for (let y = 0; y < l.y; y++) set(l.x, y, y % 2 ? PAL.metal2 : PAL.metal1);
    const rows: [number, string[]][] = [[1, BRASS], [2, BRASS], [3, GILT], [4, GILT], [5, GILT], [6, GILT]];
    rows.forEach(([hw, ramp], i) => {
      const y = l.y + i;
      for (let x = -hw - 1; x <= hw + 1; x++) set(l.x + x, y, Math.abs(x) === hw + 1 ? PAL.ink : pick(ramp, 1.3 + (x < 0 ? 1.1 : -0.5) + (i === 0 ? 0.6 : 0), l.x + x, y));
    });
    for (let x = -6; x <= 6; x++) set(l.x + x, l.y + 6, PAL.lamp3);
    for (let x = -4; x <= 4; x++) set(l.x + x, l.y + 7, Math.abs(x) <= 2 ? PAL.white : PAL.lamp0);
    for (let x = -2; x <= 2; x++) set(l.x + x, l.y + 8, Math.abs(x) <= 1 ? PAL.lamp0 : PAL.lamp1);
    set(l.x, l.y + 9, PAL.lamp1);
  }

  // upright piano: shaded cabinet, inlaid panel, music stand with a sheet, keys
  const pw = P.x1 - P.x0;
  for (let y = P.y - 1; y < pb; y++) for (let x = P.x0 - 1; x <= P.x1; x++) {
    if (x === P.x0 - 1 || x === P.x1 || y === P.y - 1) { set(x, y, PAL.ink); continue; }
    let v = 1.6 + light(x, y) * 3 + (x - P.x0 < 2 ? 0.8 : 0) - (P.x1 - x < 2 ? 0.8 : 0);
    if (Math.sin(y * 0.5 + Math.sin(x * 0.3) * 2) > 0.85) v -= 0.6;
    set(x, y, pick(WALL, v, x, y));
  }
  for (let x = P.x0; x < P.x1; x++) { set(x, P.y, pick([PAL.wood4, PAL.lamp3], 0.5 + light(x, P.y), x, P.y)); set(x, P.y + 1, PAL.wood3); set(x, P.y + 2, PAL.ink); }
  const ky = P.y + Math.max(9, Math.round((pb - P.y) * 0.45));
  const st = { x0: P.x0 + Math.round(pw * 0.3), x1: P.x1 - Math.round(pw * 0.3) };
  for (let y = P.y + 4; y < ky - 3; y++) for (let x = P.x0 + 3; x < P.x1 - 3; x++) {
    const edge = y === P.y + 4 || x === P.x0 + 3 ? PAL.ink : y === ky - 4 || x === P.x1 - 4 ? PAL.wood3 : null;
    set(x, y, edge ?? pick(WALL, 1.2 + light(x, y) * 2.4, x, y));
  }
  for (let y = P.y + 6; y < ky - 5; y++) for (let x = st.x0; x <= st.x1; x++) {
    set(x, y, x === st.x0 || x === st.x1 || y === P.y + 6 ? PAL.parch3 : (y - P.y) % 2 === 0 && x > st.x0 + 1 && x < st.x1 - 1 && rnd(x, y, 9) > 0.35 ? PAL.wood3 : PAL.parch);
  }
  for (let x = P.x0 + 1; x < P.x1 - 1; x++) { set(x, ky - 2, PAL.wood4); set(x, ky - 1, PAL.ink); }
  for (let y = ky; y < ky + 4; y++) for (let x = P.x0 + 2; x < P.x1 - 2; x++) set(x, y, y === ky + 3 ? PAL.parch3 : (x - P.x0) % 3 === 0 ? PAL.parch3 : PAL.white);
  for (let x = P.x0 + 3; x < P.x1 - 3; x += 3) if (((x - P.x0) / 3) % 7 !== 2 && ((x - P.x0) / 3) % 7 !== 6) for (let y = ky; y < ky + 2; y++) set(x + 1, y, PAL.ink);
  for (let x = P.x0; x < P.x1; x++) set(x, ky + 4, PAL.ink);

  // the bar: polished top catching the lamps, panelled front, brass foot rail
  for (let x = 0; x < W; x++) {
    const L = light(x, pb);
    set(x, pb - 1, PAL.ink);
    set(x, pb, pick([PAL.wood4, PAL.lamp3, PAL.lamp1, PAL.lamp0], 0.4 + L * 2.6, x, pb));
    set(x, pb + 1, pick([PAL.wood3, PAL.wood4, PAL.lamp3], 0.5 + L * 2, x, pb + 1));
    set(x, pb + 2, PAL.wood2);
    set(x, pb + 3, PAL.ink);
  }
  const rail = pb + Math.round((H - pb) * 0.72);
  const PN = 26;
  for (let y = pb + 4; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x % PN, py = y - pb - 4;
    const inset = px > 3 && px < PN - 3 && py > 2 && y < rail - 3;
    const frame = px > 2 && px < PN - 2 && py > 1 && y < rail - 2 && !inset;
    let v = 1.4 + light(x, y) * 2.2;
    if (px === 0) v = 0;
    else if (frame) v += (px === 3 || py === 2) ? 1.1 : -0.9;
    else if (inset) v += Math.sin(y * 0.6 + Math.sin(x * 0.25) * 2) > 0.7 ? -0.6 : 0.2;
    set(x, y, pick(WALL, v, x, y));
  }
  for (let x = 0; x < W; x++) {
    set(x, rail - 1, PAL.ink);
    set(x, rail, pick(BRASS, 1.6 + light(x, rail) * 2.4, x, rail));
    set(x, rail + 1, PAL.lamp3);
    set(x, rail + 2, PAL.ink);
    if (x % 40 === 20) for (let y = rail + 3; y < H; y++) set(x, y, y % 2 ? PAL.lamp3 : PAL.wood1);
  }

  // dark dithered vignette
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.hypot((x - W / 2) / (W / 2), (y - H * 0.45) / (H * 0.62));
    const s = (v - 0.78) * 1.5;
    if (s <= bayer(x, y)) continue;
    const i = y * W + x;
    buf[i] = s > 0.75 + bayer(x, y) * 0.5 ? PAL.ink : DARKER[buf[i]] ?? PAL.ink;
  }

  const [cv, c] = makeCanvas(W, H);
  const img = c.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const [r, gg, b] = rgbOf(buf[i]); img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
  c.putImageData(img, 0, 0);
  return cv;
}

/* ============================== game state ============================== */

interface Tgt { id: number; kind: Kind; surf: number; x: number; y: number; born: number; life: number; vx: number; toss?: { vy: number; g: number; y0: number } }
type BitK = 'shard' | 'drop' | 'spark' | 'smoke' | 'ember' | 'chip';
interface Bit { k: BitK; x: number; y: number; vx: number; vy: number; col: string; t: number; life: number; r?: number }
interface Game {
  g: Geo; bg: HTMLCanvasElement; decal: HTMLCanvasElement;
  start: number; tgts: Tgt[]; bits: Bit[]; hud: Bit[]; nextSpawn: number; id: number;
  score: number; hits: number; combo: number; best: number; flash: { x: number; y: number; t: number } | null;
  kx: number; ky: number; freeze: number; impact: { kind: Kind; x: number; y: number; t: number } | null; bump: number;
  lastTick: number; ended: boolean; endT: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function spawn(G: Game, now: number) {
  const t = clamp((now - G.start) / ROUND_MS, 0, 1);
  const spr = sprites();
  const live = G.tgts.length;
  if (live >= 3 + Math.round(t * 3)) return;
  const potLive = G.tgts.some((q) => q.kind === 'pot');
  const r = Math.random();
  const kind: Kind = r < 0.12 && !potLive && t > 0.08 ? 'pot' : r < 0.23 ? 'gold' : PLAIN[Math.floor(Math.random() * PLAIN.length)];
  const sp = spr[kind];
  // a tossed bottle flying up from behind the bar (later in the round)
  if (kind !== 'pot' && t > 0.25 && Math.random() < 0.16) {
    const gg = G.g.H * 2.2, air = rand(1.0, 1.35);
    G.tgts.push({ id: ++G.id, kind, surf: -1, x: rand(G.g.W * 0.15, G.g.W * 0.85), y: G.g.bar + sp.height, born: now, life: air * 1000,
      vx: rand(-0.2, 0.2) * G.g.W, toss: { vy: gg * air / 2, g: gg, y0: G.g.bar + sp.height } });
    return;
  }
  // weight surfaces by width
  const ws = G.g.surfs.map((s) => s.x1 - s.x0);
  let left = Math.random() * ws.reduce((a, b) => a + b, 0), si = 0;
  for (; si < ws.length - 1; si++) { left -= ws[si]; if (left <= 0) break; }
  const s = G.g.surfs[si];
  let x = 0;
  for (let k = 0; k < 6; k++) {
    x = rand(s.x0 + sp.width / 2 + 1, s.x1 - sp.width / 2 - 1);
    if (!G.tgts.some((q) => q.surf === si && Math.abs(q.x - x) < sp.width + 4)) break;
  }
  const life = clamp(lerp(1400, 1000, t) + rand(-250, 100), 600, 1400);
  const slide = kind !== 'pot' && Math.random() < (s.kind === 'bar' ? 0.55 : 0.22) * (0.5 + t);
  G.tgts.push({ id: ++G.id, kind, surf: si, x, y: s.y, born: now, life, vx: slide ? (Math.random() < 0.5 ? -1 : 1) * rand(0.12, 0.22) * G.g.W : 0 });
}

function puff(list: Bit[], x: number, y: number, n: number, big = 1) {
  for (let i = 0; i < n; i++) list.push({ k: 'smoke', x: x + rand(-2, 2), y: y + rand(-2, 1), vx: rand(-6, 6), vy: rand(-14, -6), col: '', t: 0, life: rand(420, 700) * big, r: rand(1.5, 2.6) * big });
}

function burst(G: Game, x: number, y: number, kind: Kind) {
  const glass = SHARDS[kind], liq = LIQUID[kind];
  for (let i = 0; i < 14; i++) {
    const a = rand(-Math.PI, 0) + rand(-0.5, 0.5), v = rand(25, 85);
    G.bits.push({ k: 'shard', x: x + rand(-2, 2), y: y + rand(-3, 3), vx: Math.cos(a) * v, vy: Math.sin(a) * v - 12, col: glass[i % glass.length], t: 0, life: rand(500, 900) });
  }
  for (let i = 0; i < 16; i++) {
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), v = rand(15, 60);
    G.bits.push({ k: 'drop', x, y: y + rand(-1, 2), vx: Math.cos(a) * v, vy: Math.sin(a) * v - 18, col: liq[i % liq.length], t: 0, life: rand(450, 850) });
  }
  if (kind === 'gold') for (let i = 0; i < 10; i++) G.bits.push({ k: 'spark', x: x + rand(-6, 6), y: y + rand(-8, 4), vx: rand(-8, 8), vy: rand(-18, -4), col: i % 2 ? '#fff3b8' : PAL.white, t: 0, life: rand(450, 800) });
  puff(G.bits, x, y, kind === 'pot' ? 4 : 2, kind === 'pot' ? 1.3 : 1);
  // splash stain on the wall behind
  const dc = G.decal.getContext('2d');
  if (dc && y < G.g.bar - 2) {
    const col = liq[1] ?? liq[0];
    dc.fillStyle = col;
    for (let i = 0; i < 7; i++) {
      const px = Math.round(x + rand(-5, 5)), py = Math.round(y + rand(-4, 3));
      if (bayer(px, py) < 0.6) dc.fillRect(px, py, 1, 1);
    }
    dc.fillRect(Math.round(x + rand(-3, 3)), Math.round(y), 1, Math.round(rand(2, 4))); // one drip
  }
}

function bounds(t: Tgt): [number, number, number, number] {
  const sp = sprites()[t.kind];
  return [Math.round(t.x - sp.width / 2), Math.round(t.y - sp.height), sp.width, sp.height];
}

function stepBits(list: Bit[], dt: number, H: number) {
  for (const b of list) {
    b.t += dt * 1000;
    const grav = b.k === 'smoke' ? -4 : b.k === 'spark' ? 20 : b.k === 'drop' ? 260 : b.k === 'ember' ? 90 : 200;
    if (b.k === 'smoke') { b.vx *= 1 - dt * 2; b.vy *= 1 - dt * 1.5; }
    b.vy += grav * dt; b.x += b.vx * dt; b.y += b.vy * dt;
  }
  return list.filter((b) => b.t < b.life && b.y < H + 4);
}

function tick(G: Game, now: number, dt: number, spawning: boolean) {
  if (spawning && now >= G.nextSpawn && now - G.start < ROUND_MS - 400) {
    spawn(G, now);
    const t = clamp((now - G.start) / ROUND_MS, 0, 1);
    G.nextSpawn = now + lerp(450, 280, t) + rand(0, 120);
  }
  for (const q of G.tgts) {
    if (q.toss) {
      const s = (now - q.born) / 1000;
      q.y = q.toss.y0 - (q.toss.vy * s - (q.toss.g * s * s) / 2);
      q.x += q.vx * dt;
    } else if (q.vx) {
      const s = G.g.surfs[q.surf], hw = sprites()[q.kind].width / 2;
      q.x += q.vx * dt;
      if (q.x < s.x0 + hw) { q.x = s.x0 + hw; q.vx = -q.vx; }
      if (q.x > s.x1 - hw) { q.x = s.x1 - hw; q.vx = -q.vx; }
    }
  }
  G.tgts = G.tgts.filter((q) => now - q.born < q.life);
}

/* ---- drawing ---- */

function drawBits(c: CanvasRenderingContext2D, list: Bit[]) {
  for (const b of list) {
    const x = Math.round(b.x), y = Math.round(b.y), f = b.t / b.life;
    switch (b.k) {
      case 'smoke': {
        const r = (b.r ?? 2) * (1 + f * 1.4), dens = (1 - f) * 1.5, ri = Math.ceil(r);
        for (let j = -ri; j <= ri; j++) for (let i = -ri; i <= ri; i++) {
          const d = Math.hypot(i, j) / r; if (d > 1) continue;
          const a = dens * (1 - d * 0.7);
          if (a <= bayer(x + i, y + j)) continue;
          c.fillStyle = a > 0.9 ? '#b9ab98' : a > 0.5 ? '#8a7e70' : '#5b5249';
          c.fillRect(x + i, y + j, 1, 1);
        }
        break;
      }
      case 'shard': {
        c.fillStyle = b.col;
        const spin = Math.floor(b.t / 70) % 3;
        if (f < 0.6) c.fillRect(x, y, spin === 0 ? 2 : 1, spin === 1 ? 2 : 1); else c.fillRect(x, y, 1, 1);
        if (spin === 2 && f < 0.5) { c.fillStyle = PAL.white; c.fillRect(x, y, 1, 1); }
        break;
      }
      case 'drop':
        c.fillStyle = b.col; c.fillRect(x, y, 1, 1);
        if (f < 0.7) c.fillRect(Math.round(b.x - b.vx * 0.02), Math.round(b.y - b.vy * 0.02), 1, 1);
        break;
      case 'spark':
        c.fillStyle = b.col; c.fillRect(x, y, 1, 1);
        if (Math.floor(b.t / 90) % 2 === 0 && f < 0.6) { c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); }
        break;
      default:
        c.fillStyle = b.col; c.fillRect(x, y, 1, 1);
    }
  }
}

function drawHud(c: CanvasRenderingContext2D, G: Game, now: number) {
  const { W, hudTop: top, hudRight, hudLeft } = G.g;
  // carved wooden score plate with brass nails
  const px0 = hudLeft, pw = 19, ph = 13;
  c.fillStyle = PAL.ink; c.fillRect(px0 - 1, top - 1, pw + 2, ph + 2);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const v = y === 0 ? 4.4 : y === 1 ? 3.4 : y === ph - 1 ? 1 : 2.4 + (Math.sin(y * 0.9 + Math.sin(x * 0.4) * 1.6) > 0.8 ? -0.7 : 0) + (x === 0 ? 0.8 : 0);
    c.fillStyle = pick(WALL, v, x, y); c.fillRect(px0 + x, top + y, 1, 1);
  }
  for (const nx of [px0 + 1, px0 + pw - 2]) { c.fillStyle = PAL.lamp1; c.fillRect(nx, top + 1, 1, 1); c.fillStyle = PAL.lamp3; c.fillRect(nx, top + ph - 2, 1, 1); }
  const sc = String(clamp(Math.round(G.score), 0, 99));
  const tw = sc.length * 6 - 1;
  const hot = now - G.bump < 110;
  const dx = px0 + Math.floor((pw - tw) / 2), dy = top + 3;
  // carved into the plank: a dark cut with gilt paint in it
  bitText(c, FONT57, sc, dx, dy, (gy) => (hot ? PAL.white : gy < 3 ? PAL.lamp0 : PAL.lamp1), PAL.wood0);

  // the fuse: burns from the plate toward a bundle of dynamite; sags a touch between them
  const fx0 = px0 + pw + 3, fx1 = W - hudRight - 9, fy = top + 4;
  const el = clamp((now - G.start) / ROUND_MS, 0, 1);
  const lit = now >= G.start && !G.ended;
  const sx = Math.round(lerp(fx0, fx1, G.ended ? 1 : Math.max(0, el)));
  const sag = (x: number) => fy + Math.round(Math.sin(((x - fx0) / Math.max(1, fx1 - fx0)) * Math.PI) * 2);
  const late = el > 0.75 && lit && Math.floor(now / 200) % 2 === 0;
  for (let x = fx0; x <= fx1; x++) {
    const y = sag(x);
    if (x < sx) { if ((x + Math.floor(x / 3)) % 2 === 0) { c.fillStyle = x % 3 ? PAL.metal1 : PAL.wood2; c.fillRect(x, y, 1, 1); } continue; }
    c.fillStyle = PAL.ink; c.fillRect(x, y - 1, 1, 1); c.fillRect(x, y + 2, 1, 1);
    const tw = x % 4;
    c.fillStyle = late ? (tw < 2 ? PAL.lamp2 : PAL.red1) : tw < 2 ? PAL.parch : PAL.parch3;
    c.fillRect(x, y, 1, 1);
    c.fillStyle = late ? (tw < 2 ? PAL.red1 : PAL.red2) : tw === 1 || tw === 2 ? PAL.parch2 : PAL.wood4;
    c.fillRect(x, y + 1, 1, 1);
  }
  // dynamite bundle (gone once it blows)
  if (!G.ended) {
    const bx = fx1 + 1, by = fy - 1;
    c.fillStyle = PAL.ink; c.fillRect(bx - 1, by - 1, 9, 9);
    for (let i = 0; i < 3; i++) {
      const x = bx + i * 2 + (i > 0 ? i - 1 : 0);
      c.fillStyle = PAL.red1; c.fillRect(x, by, 2, 7);
      c.fillStyle = '#d0503c'; c.fillRect(x, by, 1, 7);
      c.fillStyle = PAL.red2; c.fillRect(x + 1, by + 1, 1, 6);
      c.fillStyle = PAL.parch2; c.fillRect(x, by + 3, 2, 1);
    }
    c.fillStyle = PAL.wood0; c.fillRect(bx, by + 3, 1, 1);
  }
  // the spark
  if (lit) {
    const y = sag(sx), f = Math.floor(now / 45);
    c.fillStyle = PAL.lamp2;
    for (let i = 0; i < 5; i++) { const a = rnd(f, i, 3) * Math.PI * 2, r = 1 + Math.floor(rnd(i, f, 4) * (el > 0.75 ? 3 : 2)); c.fillRect(sx + Math.round(Math.cos(a) * r), y + Math.round(Math.sin(a) * r), 1, 1); }
    c.fillStyle = PAL.lamp1; c.fillRect(sx - 1, y, 3, 1); c.fillRect(sx, y - 1, 1, 3);
    c.fillStyle = PAL.white; c.fillRect(sx, y, 1, 1);
    if (Math.random() < 0.35) G.hud.push({ k: 'ember', x: sx, y, vx: rand(-14, 14), vy: rand(-22, -6), col: Math.random() < 0.5 ? PAL.lamp1 : PAL.lamp2, t: 0, life: rand(200, 420) });
  }
  // combo tally under the fuse
  if (G.combo >= 2 && !G.ended) {
    const blink = G.combo % 5 === 0 && Math.floor(now / 120) % 2 === 0;
    bitText(c, FONT35, `x${G.combo}`, fx0, top + 8, () => (blink ? PAL.white : PAL.lamp1), PAL.ink);
  }
  drawBits(c, G.hud);
}

function draw(c: CanvasRenderingContext2D, G: Game, now: number) {
  c.setTransform(1, 0, 0, 1, Math.round(G.kx), Math.round(G.ky));
  c.drawImage(G.bg, 0, 0);
  c.drawImage(G.decal, 0, 0);
  const spr = sprites();
  for (const q of G.tgts) {
    const sp = spr[q.kind];
    const [x, y, w, h] = bounds(q);
    const age = now - q.born, left = q.life - age;
    // pop up from behind the surface / sink back down (tossed bottles fly up from behind the bar)
    const rise = q.toss ? 1 : Math.min(1, age / 90, left / 110);
    const dy = Math.round(h * (1 - Math.max(0, rise)));
    if (!q.toss && rise >= 1) { c.fillStyle = PAL.wood1; c.fillRect(x + 1, q.y, w - 2, 1); } // contact shadow
    c.save();
    c.beginPath(); c.rect(x - 2, -2, w + 4, (q.toss ? G.g.bar : q.y) + 3); c.clip();
    c.drawImage(sp, x, y + dy);
    c.restore();
    // glints: a twinkle that travels round the shelf; gold sparkles all the time
    const ph = (now + q.id * 377) % (q.kind === 'gold' ? 520 : 1500);
    if (rise >= 1 && ph < 130 && q.kind !== 'pot') {
      const gx = x + 2, gy = y + dy + Math.round(h * 0.45);
      c.fillStyle = PAL.lamp0; c.fillRect(gx - 1, gy, 3, 1); c.fillRect(gx, gy - 1, 1, 3);
      c.fillStyle = PAL.white; c.fillRect(gx, gy, 1, 1);
    }
    if (q.kind === 'gold' && Math.floor(now / 140) % 3 === 0) { c.fillStyle = PAL.white; c.fillRect(x + w - 2, y + dy + 3, 1, 1); c.fillRect(x - 1, y + dy + 1, 1, 1); }
    if (q.kind === 'pot' && rise >= 1) { // steam wisps
      const f = Math.floor(now / 120);
      c.fillStyle = PAL.parch2;
      c.fillRect(x + 1 - (f % 2), y - 2 - (f % 3), 1, 1);
      c.fillRect(x + (f % 2), y - 4 - (f % 2), 1, 1);
    }
  }
  drawBits(c, G.bits);
  // impact frame: the bottle flashes white for a beat before it's gone
  if (G.impact && now - G.impact.t < 70) {
    const fl = flashes()[G.impact.kind];
    c.drawImage(fl, G.impact.x - Math.round(fl.width / 2), G.impact.y - fl.height);
  }
  if (G.flash && now - G.flash.t < 80) {
    const { x, y } = G.flash, r = now - G.flash.t < 40 ? 5 : 3;
    c.fillStyle = PAL.lamp2;
    for (let i = -r; i <= r; i++) { c.fillRect(x + i, y, 1, 1); c.fillRect(x, y + i, 1, 1); }
    for (let i = -(r >> 1); i <= r >> 1; i++) { c.fillRect(x + i, y + i, 1, 1); c.fillRect(x + i, y - i, 1, 1); }
    c.fillStyle = PAL.lamp1; c.fillRect(x - 1, y - 1, 3, 3);
    c.fillStyle = PAL.white; c.fillRect(x, y, 1, 1);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  drawHud(c, G, now);
}

/* ============================== component ============================== */

type Phase = 'ready' | 'play' | 'over';

const spriteDraw = (k: Kind) => (c: CanvasRenderingContext2D) => { c.drawImage(sprites()[k], 0, 0); };
const LEGEND = (['brown', 'gold', 'pot'] as Kind[]).map((k) => ({ k, draw: spriteDraw(k) }));

function Gallery({ onClose, onSubmit, tableBest }: { onClose: () => void; onSubmit: (score: number) => void; tableBest: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const quitRef = useRef<HTMLButtonElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ score: 0, combo: 0, hits: 0 });
  const [final, setFinal] = useState<{ score: number; hits: number; best: number; record: boolean } | null>(null);
  const [canAct, setCanAct] = useState(false);
  const [round, setRound] = useState(0);
  const coarse = useRef(false);
  const calm = useRef(false);
  const submitRef = useRef(onSubmit); submitRef.current = onSubmit;
  const bestRef = useRef(tableBest); bestRef.current = tableBest;

  useEffect(() => {
    try { coarse.current = matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
    calm.current = reduceMotion();
  }, []);

  // one round per `round` value
  useEffect(() => {
    const cv = cvRef.current, el = wrap.current; if (!cv || !el) return;
    const c = cv.getContext('2d'); if (!c) return;
    let dead = false, raf = 0, sent = false;
    const setup = () => {
      let padL = 10;
      try { padL = parseFloat(getComputedStyle(hudRef.current!).paddingLeft) || 10; } catch { /* default */ }
      const g = geo(el.clientWidth || innerWidth, el.clientHeight || innerHeight, quitRef.current?.getBoundingClientRect() ?? null, padL);
      const prev = game.current;
      if (prev && prev.g.W === g.W && prev.g.H === g.H && prev.g.hudTop === g.hudTop && prev.g.hudLeft === g.hudLeft) return;
      cv.width = g.W; cv.height = g.H;
      cv.style.width = `${g.W * g.S}px`; cv.style.height = `${g.H * g.S}px`;
      c.imageSmoothingEnabled = false;
      const [decal] = makeCanvas(g.W, g.H);
      const t0 = performance.now();
      game.current = prev
        ? { ...prev, g, bg: backdrop(g), decal, tgts: [], bits: [], hud: [] }
        : { g, bg: backdrop(g), decal, start: t0 + READY_MS, tgts: [], bits: [], hud: [], nextSpawn: t0 + READY_MS + 150, id: 0,
          score: 0, hits: 0, combo: 0, best: 0, flash: null, kx: 0, ky: 0, freeze: 0, impact: null, bump: 0, lastTick: 99, ended: false, endT: 0 };
    };
    game.current = null;
    setup();
    setPhase('ready'); setFinal(null); setCanAct(false); setHud({ score: 0, combo: 0, hits: 0 });
    let readyShown = true;
    const onResize = () => setup();
    addEventListener('resize', onResize);
    let last = performance.now();
    const loop = () => {
      if (dead) return;
      const G = game.current!;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const frozen = now < G.freeze; // hit-stop: only the FX hold still; targets, spawns, expiry and the clock run on
      if (now >= G.start && readyShown) { readyShown = false; setPhase('play'); sfx.cock(); }
      if (now >= G.start) tick(G, now, dt, !G.ended);
      if (!frozen) {
        G.bits = stepBits(G.bits, dt, G.g.H);
        G.hud = stepBits(G.hud, dt, G.g.H);
        const k = Math.pow(0.0001, dt); // springy screen kick decays fast
        G.kx *= k; G.ky *= k;
        if (Math.abs(G.kx) < 0.5) G.kx = 0;
        if (Math.abs(G.ky) < 0.5) G.ky = 0;
      }
      const el2 = now - G.start;
      const secLeft = Math.ceil((ROUND_MS - el2) / 1000);
      if (!G.ended && el2 > 0 && secLeft <= 5 && secLeft >= 1 && secLeft < G.lastTick) { G.lastTick = secLeft; sfx.tick(); }
      if (!G.ended && el2 >= ROUND_MS) {
        G.ended = true; G.endT = now;
        G.tgts = [];
        const score = clamp(Math.round(G.score), 0, 99);
        if (!sent) { sent = true; submitRef.current(score); }
        // the fuse reaches the dynamite
        const fx1 = G.g.W - G.g.hudRight - 9 + 4, fy = G.g.hudTop + 4;
        puff(G.hud, fx1, fy, 6, 1.4);
        for (let i = 0; i < 14; i++) G.hud.push({ k: 'ember', x: fx1, y: fy, vx: rand(-50, 50), vy: rand(-50, 10), col: i % 2 ? PAL.lamp1 : PAL.lamp0, t: 0, life: rand(300, 650) });
        if (!calm.current) { G.ky = 3; G.kx = rand(-2, 2); }
        setFinal({ score, hits: G.hits, best: G.best, record: score > 0 && score > bestRef.current });
        setPhase('over');
        if (score > 0) sfx.win();
        window.setTimeout(() => { if (!dead) setCanAct(true); }, 650);
      }
      draw(c, G, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { dead = true; cancelAnimationFrame(raf); removeEventListener('resize', onResize); };
  }, [round]);

  const popup = (x: number, y: number, text: string, cls: string) => {
    const fx = fxRef.current, G = game.current; if (!fx || !G) return;
    const s = document.createElement('span');
    s.className = `fun-tp-pop ${cls}`;
    s.textContent = text;
    s.style.left = `${x * G.g.S}px`; s.style.top = `${y * G.g.S}px`;
    fx.appendChild(s);
    window.setTimeout(() => s.remove(), 750);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const G = game.current, cv = cvRef.current; if (!G || !cv) return;
    const now = performance.now();
    if (now < G.start || G.ended) return;
    const r = cv.getBoundingClientRect();
    // the canvas is drawn shifted by the kick: aim at what's on screen
    const x = Math.floor((e.clientX - r.left) / G.g.S - Math.round(G.kx)), y = Math.floor((e.clientY - r.top) / G.g.S - Math.round(G.ky));
    G.flash = { x, y, t: now };
    sfx.shot();
    const pad = coarse.current || e.pointerType === 'touch' ? 4 : 1;
    let hit: Tgt | null = null, hd = 1e9;
    for (const q of G.tgts) {
      const [bx, by, bw, bh] = bounds(q);
      if (q.toss && y > G.g.bar) continue; // the part behind the bar is hidden
      if (x >= bx - pad && x < bx + bw + pad && y >= by - pad && y < by + bh + pad) {
        if (!q.toss && now - q.born < 50) continue; // not up yet
        const d = Math.hypot(x - (bx + bw / 2), y - (by + bh / 2));
        if (d < hd) { hd = d; hit = q; }
      }
    }
    const kick = calm.current ? 0 : 1;
    if (hit) {
      const [bx, by, bw, bh] = bounds(hit);
      G.tgts = G.tgts.filter((q) => q !== hit);
      burst(G, bx + bw / 2, by + bh / 2, hit.kind);
      G.impact = { kind: hit.kind, x: Math.round(hit.x), y: Math.round(hit.y), t: now };
      G.freeze = kick ? now + 55 : 0;
      G.kx = rand(-2.5, 2.5) * kick; G.ky = -2.5 * kick;
      const pts = PTS[hit.kind];
      if (pts < 0) {
        G.combo = 0;
        G.score = Math.max(0, G.score + pts);
        sfx.steam();
        popup(bx + bw / 2, by, `${pts} the coffee!`, 'bad');
      } else {
        G.combo++; G.hits++;
        G.best = Math.max(G.best, G.combo);
        let add = pts;
        const bonus = G.combo > 0 && G.combo % 5 === 0;
        if (bonus) add += 1;
        G.score = Math.min(99, G.score + add);
        G.bump = now;
        sfx.shatter();
        if (hit.kind === 'gold') sfx.coin();
        popup(bx + bw / 2, by, bonus ? `+${add} combo!` : `+${add}`, hit.kind === 'gold' ? 'gold' : '');
      }
    } else {
      G.combo = 0;
      G.kx = rand(-1, 1) * kick; G.ky = -1 * kick;
      const dc = G.decal.getContext('2d');
      if (dc && y < G.g.H - 2) {
        // bullet hole + a few wood chips
        dc.fillStyle = PAL.parch3; dc.fillRect(x - 1, y - 2, 1, 1); dc.fillRect(x + 2, y + 1, 1, 1);
        dc.fillStyle = PAL.wood0; dc.fillRect(x - 1, y - 1, 3, 3);
        dc.fillStyle = PAL.ink; dc.fillRect(x, y - 1, 1, 3); dc.fillRect(x - 1, y, 3, 1);
        for (let i = 0; i < 5; i++) G.bits.push({ k: 'chip', x, y, vx: rand(-30, 30), vy: rand(-40, -10), col: i % 2 ? PAL.wood4 : PAL.wood3, t: 0, life: rand(300, 500) });
      }
    }
    puff(G.bits, x, y, 1, 0.8);
    setHud({ score: Math.round(G.score), combo: G.combo, hits: G.hits });
  };

  // Esc quits (no submit)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const stars = final ? STARS.filter((n) => final.score >= n).length : 0;
  const next = final ? STARS.find((n) => final.score < n) : undefined;

  return (
    <div className="fun-tp-overlay" ref={wrap} role="dialog" aria-modal="true" aria-label="Target practice">
      <canvas ref={cvRef} className="fun-tp-canvas" onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()} />
      <div className="fun-tp-fx" ref={fxRef} aria-hidden />
      <span className="fun-sr" aria-live="polite">{phase === 'play' ? `${hud.score} points${hud.combo >= 2 ? `, combo ${hud.combo}` : ''}` : ''}</span>
      <div className="fun-tp-hud" ref={hudRef}>
        <button ref={quitRef} type="button" className="px-btn px-btn-sm fun-x" onClick={() => { sfx.click(); onClose(); }} aria-label="Quit target practice (no score)">✕</button>
      </div>
      {phase === 'ready' && (
        <div className="fun-tp-banner px-box">
          <b>Target practice</b>
          <div className="fun-tp-legend">
            {LEGEND.map(({ k, draw: d }) => {
              const sp = sprites()[k];
              return (
                <span key={k} className={`fun-tp-leg ${k}`}>
                  <PixelSprite draw={d} w={sp.width} h={sp.height} className="fun-ico" style={{ width: `calc(var(--pt) * ${sp.width * 1.5})`, height: `calc(var(--pt) * ${sp.height * 1.5})` }} />
                  <b>{k === 'pot' ? '−2' : k === 'gold' ? '+3' : '+1'}</b>
                </span>
              );
            })}
          </div>
          <span>Shoot the bottles. Leave the coffee pot alone.</span>
        </div>
      )}
      {phase === 'over' && final && (
        <div className="fun-tp-end px-box">
          <div className="fun-tp-stars" aria-label={`${stars} of 3 stars`}>
            {STARS.map((n, i) => {
              const on = i < stars, ic = on ? STAR_ICON : STAR_DIM;
              return <PixelSprite key={n} draw={ic.draw} w={ic.w} h={ic.h} className={`fun-star ${on ? 'on' : ''}`} style={{ animationDelay: `${150 + i * 220}ms` }} />;
            })}
          </div>
          <div className="fun-tp-rank">{RANKS[stars]}</div>
          <div className="fun-tp-big">{final.score} <small>{final.score === 1 ? 'point' : 'points'}</small></div>
          <div className="fun-tp-sub">{final.hits} {final.hits === 1 ? 'bottle' : 'bottles'} · best combo x{final.best}{next !== undefined ? ` · ${next - final.score} more for a star` : ''}</div>
          {final.record && <div className="fun-tp-rec">New table record!</div>}
          <div className="fun-tp-acts">
            <button type="button" className="px-btn px-btn-sm" disabled={!canAct} onClick={() => { sfx.click(); setRound((r) => r + 1); }}>Again</button>
            <button type="button" className="px-btn px-btn-sm" disabled={!canAct} onClick={() => { sfx.click(); onClose(); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BottleBoard({ rows, me, limit = 5 }: { rows: { pid: string; name: string; score: number }[]; me: string; limit?: number }) {
  if (!rows.length) return <p className="fun-board-empty">No marks yet. Be the first.</p>;
  return (
    <ol className="fun-board">
      {rows.slice(0, limit).map((r, i) => (
        <li key={`${r.pid}-${i}`} className={r.pid === me ? 'me' : ''}>
          <span className="n">{i + 1}.</span>
          <span className="nm">{r.name}</span>
          <span className="sc">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

/** the full top 5 in a small modal (the lobby block itself only shows a one-line summary) */
function BoardPop({ rows, me, onClose }: { rows: { pid: string; name: string; score: number }[]; me: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fun-modal" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fun-board-pop px-box" role="dialog" aria-modal="true" aria-labelledby="fun-board-h">
        <div className="fun-board-pop-head">
          <PixelSprite draw={TARGET_ICON.draw} w={TARGET_ICON.w} h={TARGET_ICON.h} className="fun-ico" style={{ width: `calc(var(--pt) * ${TARGET_ICON.w})`, height: `calc(var(--pt) * ${TARGET_ICON.h})` }} />
          <b id="fun-board-h">Best shots at this table</b>
          <button ref={closeRef} type="button" className="px-btn px-btn-sm fun-x" onClick={() => { sfx.click(); onClose(); }} aria-label="Close">✕</button>
        </div>
        <BottleBoard rows={rows} me={me} />
      </div>
    </div>
  );
}

export default function TargetPractice({ state, me, send }: RoomProps) {
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState(false);
  const rows = state.record?.bottles ?? [];
  const best = rows.reduce((m, r) => Math.max(m, r.score), 0);
  const close = useCallback(() => setOpen(false), []);
  const closeBoard = useCallback(() => setBoard(false), []);
  const submit = useCallback((score: number) => send({ t: 'bottles', score }), [send]);
  // the round ends with the lobby: close if the phase moves on
  useEffect(() => { if (state.phase !== 'lobby') { setOpen(false); setBoard(false); } }, [state.phase]);
  const top = rows.slice(0, 3);
  return (
    <div className="fun-tp">
      <div className="fun-tp-row">
        <button type="button" className="nh-btn nh-btn-sm fun-btn" onClick={() => { sfx.click(); setOpen(true); }}>
          <PixelSprite draw={TARGET_ICON.draw} w={TARGET_ICON.w} h={TARGET_ICON.h} className="fun-ico" style={{ width: `calc(var(--pt) * ${TARGET_ICON.w})`, height: `calc(var(--pt) * ${TARGET_ICON.h})` }} />
          <span>Target practice</span>
        </button>
        {rows.length > 0 && (
          <button type="button" className="fun-board-btn" aria-haspopup="dialog" onClick={() => { sfx.click(); setBoard(true); }}>Board</button>
        )}
      </div>
      {top.length ? (
        <p className="fun-tp-best" title={rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.name} ${r.score}`).join('\n')}>
          <span className="k">Best:</span>
          {top.map((r, i) => (
            <span key={`${r.pid}-${i}`} className={`e ${r.pid === me ? 'me' : ''}`}>
              {i > 0 && <i aria-hidden>·</i>}
              <span className="nm">{r.name}</span>
              <b>{r.score}</b>
            </span>
          ))}
        </p>
      ) : (
        <p className="fun-tp-best empty">No marks yet. Be the first.</p>
      )}
      {open && createPortal(<Gallery onClose={close} onSubmit={submit} tableBest={best} />, document.body)}
      {board && createPortal(<BoardPop rows={rows} me={me} onClose={closeBoard} />, document.body)}
    </div>
  );
}
