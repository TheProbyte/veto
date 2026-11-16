// Whiskey Slide finale: each finalist game's champion slides a glass down the bar. Closest to the chalk mark wins;
// off the end of the bar = smashed on the floor.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import type { Player, Slide as SlideState } from '../../shared/types';
import { useNow } from '../net';
import { sfx } from '../sfx';
import { MiniBust } from '../pixel/BustPreview';
import { PixelCover } from '../pixel/PixelCover';
import { PixelSprite } from '../pixel/PixelCanvas';
import { PAL, hexRgb, rnd } from '../pixel/palette';
import { bayer } from '../pixel/dither';
import type { DrawFn } from '../pixel/sprites';
import { BUZZ, buzz } from '../scene/haptics';
import './gameplay.css';

const SLIDE_MS = 2200;  // a glass takes this long to come to rest
const FALL_MS = 650;    // tipping off the end and dropping out of sight
const PERIOD = 1100;    // power meter oscillation period
const TURN_MS = 15_000;  // server: a slider's window opens at turnDeadline - TURN_MS (after the intro / previous glass)
const REACH = 1.18;     // power 1.0 reaches this far down the bar (server: dist ≈ power * 1.18 + wobble)
const BAR_IN = 288;     // the bar is 24 ft long: distances read out in inches/feet
const K = 0.42;         // perspective foreshortening (mild: the action happens at 0.7..1.0)
const TMAX = 1.24;      // top of the bar canvas in bar units (room for the drop-off + spittoon)

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** power meter shape: a sine sweep 0 -> 1 -> 0 (fast through the middle where the sweet spot usually sits) */
const meter = (ms: number) => (1 - Math.cos((2 * Math.PI * ms) / PERIOD)) / 2;

/** glass position along the bar at `el` ms after release: constant deceleration to `dist` */
function glassAt(dist: number, el: number) {
  const p = Math.min(1, Math.max(0, el / SLIDE_MS));
  return dist * (1 - (1 - p) * (1 - p));
}
/** ms after release when a glass that falls passes the end of the bar */
function edgeMs(dist: number) {
  if (dist <= 1) return Infinity;
  // dist * (1 - (1-p)^2) = 1  ->  p = 1 - sqrt(1 - 1/dist)
  return (1 - Math.sqrt(1 - 1 / dist)) * SLIDE_MS;
}

const fmtMiss = (dist: number, mark: number, fell: boolean) => {
  if (fell) return 'SMASHED';
  const d = (dist - mark) * BAR_IN;
  const a = Math.abs(d);
  if (a < 1) return 'DEAD ON';
  const v = a >= 24 ? `${(a / 12).toFixed(1)} ft` : `${Math.round(a)}"`;
  return `${v} ${d < 0 ? 'short' : 'past'}`;
};

/* ---------------- projection shared by the canvases and the DOM glasses ---------------- */
// The whole screen is one coordinate system: the bar runs between `top` and `bot` (the free band between the
// header/roster and the controls), and the saloon around it (back wall, shelves, floor, stools, the counter's front)
// is painted in the same perspective so it all lines up.
interface Geo { W: number; H: number; cx: number; y0: number; yH: number; hw0: number; s: (t: number) => number; y: (t: number) => number; hw: (t: number) => number; tOf: (sy: number) => number }
function geo(W: number, H: number, top = 0, bot = H): Geo {
  const h = Math.max(40, bot - top);
  const y0 = bot - Math.max(8, h * 0.04);
  const yt = top + Math.max(6, h * 0.03);
  const sT = 1 / (1 + K * TMAX);
  const yH = (yt - sT * y0) / (1 - sT);
  // phones: the bar fills the width; wide screens: a narrower bar so the saloon around it shows
  const hw0 = W < 700 ? Math.min(W * 0.44, h * 0.95, 560) : Math.min(W * 0.3, h * 0.8, 470);
  const s = (t: number) => 1 / (1 + K * t);
  const y = (t: number) => yH + (y0 - yH) * s(t);
  const tOf = (sy: number) => { const ss = (sy - yH) / (y0 - yH); return (1 / ss - 1) / K; };
  return { W, H, cx: W / 2, y0, yH, hw0, s, y, hw: (t) => hw0 * s(t), tOf };
}
const TW = TMAX + 0.3;   // the back wall stands this far down the bar
/** the room's floor spans ±UR bar-half-widths; side walls beyond (left: the back bar, right: paneling) */
const roomUR = (W: number) => (W < 700 ? 2.3 : 1.55);
const laneSet = (n: number) => (n >= 3 ? [-0.56, 0, 0.56] : n === 2 ? [-0.42, 0.42] : [0]);

const rgbCache = new Map<string, [number, number, number]>();
const rgb = (h: string) => { let v = rgbCache.get(h); if (!v) { v = hexRgb(h); rgbCache.set(h, v); } return v; };
const BOTTLES = [PAL.felt3, PAL.lamp3, PAL.wood4, PAL.metal3, PAL.red1, '#2f5a3a', '#6a2f12', PAL.blue2];

/** the saloon + the bar counter in perspective, painted once per size at a chunky pixel scale */
const RoomCanvas = memo(function RoomCanvas({ W, H, top, bot, mark, lanes }: { W: number; H: number; top: number; bot: number; mark: number; lanes: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || W < 10 || H < 10) return;
    const P = W < 520 ? 2 : 3;
    const cw = Math.ceil(W / P), ch = Math.ceil(H / P);
    cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d'); if (!c) return;
    const g = geo(W, H, top, bot);
    const L = laneSet(lanes);
    const UR = roomUR(W);
    const img = c.createImageData(cw, ch);
    const d = img.data;
    const put = (x: number, y: number, col: string, a = 1) => {
      if (x < 0 || y < 0 || x >= cw || y >= ch) return;
      const [r, gg, b] = rgb(col); const i = (y * cw + x) * 4;
      if (a >= 1) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; } else { d[i] += (r - d[i]) * a; d[i + 1] += (gg - d[i + 1]) * a; d[i + 2] += (b - d[i + 2]) * a; }
      d[i + 3] = 255;
    };
    const cxp = g.cx / P;
    const yWall = g.y(TW) / P, hwW = g.hw(TW) / P;
    const yEnd = g.y(1) / P;
    const y0p = g.y0 / P;
    // hanging lamps on the back wall (u in wall units) + a warm pool over the bar
    const lampsU = W > 900 ? [-1.75, 0, 1.75] : [-1.2, 1.2];
    for (let py = 0; py < ch; py++) {
      const sy = (py + 0.5) * P;
      for (let px = 0; px < cw; px++) {
        const dx = px + 0.5 - cxp;
        let col: string;
        // 1) back wall (above the wall's base, inside the room)
        if (py < yWall && Math.abs(dx) < UR * hwW) {
          const u = dx / hwW, v = (yWall - py) / hwW; // v: height above the floor in bar units
          const au = Math.abs(u);
          if (v < 0.05) col = PAL.ink;
          else if (v < 0.5) {
            // back-bar cabinet: framed panels
            const pu = ((u + UR) * 2.2) % 1, pv = (v - 0.05) / 0.45;
            const frame = pu < 0.08 || pu > 0.92 || pv < 0.1 || pv > 0.88;
            col = frame ? (bayer(px, py) > 0.5 ? PAL.wood2 : PAL.wood1) : pu < 0.16 ? PAL.wood4 : PAL.wood3;
            if (v > 0.47) col = PAL.lamp3;
          } else if (au < 1.25 && v > 0.58 && v < 1.55) {
            // the big mirror: dim reflection with diagonal sheen
            const edge = au > 1.17 || v < 0.64 || v > 1.49;
            if (edge) col = au > 1.21 || v < 0.6 || v > 1.53 ? PAL.ink : PAL.lamp3;
            else {
              const sheen = ((u * 1.4 + v * 1.1) % 0.55 + 0.55) % 0.55;
              col = sheen < 0.05 && bayer(px, py) > 0.3 ? PAL.blue3 : (v > 1.0 ? PAL.blue1 : bayer(px, py) > 0.5 ? PAL.blue1 : PAL.blue0);
              if (sheen > 0.05 && sheen < 0.08) col = PAL.blue2;
            }
          } else if (v > 1.85) {
            // ceiling beam
            col = v > 1.95 ? PAL.ink : PAL.wood1;
          } else {
            // wallpaper: oxblood stripes with tiny gold diamonds, a dado rail
            const stripe = Math.floor((u + 9) * 6) % 2;
            col = stripe ? PAL.red2 : '#3a0d0b';
            if (rnd(Math.floor((u + 9) * 24), Math.floor(v * 24), 9) > 0.93 && stripe) col = PAL.lamp3;
            if (v > 0.5 && v < 0.56) col = PAL.wood2;
          }
          // shelves either side of the mirror
          if (au > 1.3 && au < UR - 0.08) for (const sv of [0.86, 1.24, 1.6]) if (v > sv - 0.035 && v < sv) col = v > sv - 0.012 ? PAL.wood4 : PAL.wood2;
        } else if (py < yWall || Math.abs(dx) > UR * g.hw(Math.max(-0.5, g.tOf(sy))) / P) {
          // 2) side walls, in perspective: depth from x, height above the bar line from y
          const sd = Math.abs(dx) * P / (UR * g.hw0);
          const t = Math.min(TW, Math.max(-0.5, (1 / Math.max(0.05, sd) - 1) / K));
          const yf = g.y(t) / P, hw = g.hw(t) / P;
          const v = (yf - py) / hw;
          const left = dx < 0;
          if (v > 2.3) col = Math.floor(t * 8) % 2 ? PAL.ink : PAL.wood0; // ceiling beams
          else if (left) {
            // the back bar: cabinet, brass lip, then bays alternating mirror / bottle shelves
            const bay = Math.floor(t * 2.6 + 0.2), bf = (t * 2.6 + 0.2) % 1;
            const post = bf < 0.08;
            if (v < 0.42) col = post || Math.abs(v - 0.21) > 0.17 ? PAL.wood2 : bayer(px, py) > 0.8 ? PAL.wood4 : PAL.wood3;
            else if (v < 0.5) col = v < 0.45 ? PAL.lamp3 : PAL.ink;
            else if (post) col = v > 1.75 ? PAL.wood2 : PAL.wood3;
            else if (v < 1.75) {
              if (bay % 2 === 0) { // mirror
                const sheen = ((t * 3 + v * 0.8) % 0.6 + 0.6) % 0.6;
                col = bf > 0.92 || v < 0.56 || v > 1.68 ? PAL.lamp3 : sheen < 0.05 ? PAL.blue2 : bayer(px, py) > 0.5 ? PAL.blue1 : PAL.blue0;
              } else { // shelves
                col = [0.9, 1.3, 1.7].some((sv) => v > sv - 0.05 && v < sv) ? PAL.wood4 : '#24160d';
              }
            } else col = Math.floor(t * 18) % 2 ? PAL.red2 : '#3a0d0b';
          } else {
            // paneled wall: wainscot, dado rail, striped paper
            if (v < 0.04) col = PAL.ink;
            else if (v < 0.55) col = (t * 6) % 1 < 0.06 ? PAL.wood1 : bayer(px, py) > 0.75 ? PAL.wood3 : PAL.wood2;
            else if (v < 0.62) col = PAL.wood4;
            else col = Math.floor(t * 18) % 2 ? PAL.red2 : '#3a0d0b';
          }
        } else {
          const t = g.tOf(sy);
          const hw = g.hw(Math.max(-0.4, t)) / P;
          const u = dx / hw, au = Math.abs(u);
          if (py >= y0p) {
            // 3) the counter's front face (toward us) + the floor either side
            const inFront = Math.abs(dx) < g.hw0 / P * 1.0;
            if (inFront) {
              const fy = py - y0p;
              const pu = ((dx / (g.hw0 / P) + 1) * 3) % 1;
              col = fy < 2 ? PAL.lamp3 : fy < 4 ? PAL.ink : (pu < 0.06 || pu > 0.94) ? PAL.wood1 : bayer(px, py) > 0.85 ? PAL.wood4 : PAL.wood3;
              if (fy > 8 && (pu < 0.14 || pu > 0.86) && !(pu < 0.06 || pu > 0.94)) col = PAL.wood2;
              const rail = ch - py;
              if (rail > 5 && rail < 9) col = rail === 8 ? PAL.lamp0 : rail > 6 ? PAL.lamp1 : PAL.lamp3; // brass foot rail
            } else col = (Math.floor(Math.abs(dx) / 7) % 2 ? PAL.wood1 : PAL.wood0);
          } else if (t > 1) {
            // past the end of the counter: the saloon floor (sawdust boards), then the wall base
            const fl = Math.floor((t - 1) * 50);
            col = fl % 3 === 0 && bayer(px, py) > 0.3 ? PAL.ink : rnd(px >> 3, fl, 7) > 0.85 ? PAL.wood2 : bayer(px, py) > 0.55 ? PAL.wood1 : PAL.wood0;
            if (py < yEnd + 0.5 && py > yEnd - 2.5 && au < 1.05) col = PAL.ink; // the counter's end lip shadow
          } else if (t < 0 || au <= 1) {
            if (t < 0) col = au > 1 ? PAL.ink : (py % 2 ? PAL.wood2 : PAL.wood1);
            else if (au > 0.955) {
              // brass-capped rail along both edges
              col = au > 0.985 ? PAL.ink : (u < 0 ? PAL.lamp3 : PAL.wood4);
              if (au <= 0.985 && bayer(px, py) > 0.8) col = PAL.lamp1;
            } else {
              // planks run along the bar: seams converge toward the vanishing point
              const plank = Math.floor((u + 1) * 3.5);
              const seam = Math.abs(((u + 1) * 3.5) % 1) < 0.045 * (hw > 40 ? 1 : 1.6);
              const grain = rnd(Math.floor((u + 1) * 60), Math.floor(t * 70 + plank * 13), 11);
              const knot = Math.sin(u * 37 + plank) * Math.sin(t * 23 + plank * 3);
              col = seam ? PAL.wood1 : grain > 0.86 ? PAL.wood2 : grain < 0.08 ? PAL.wood4 : plank % 2 ? PAL.wood3 : '#4f3220';
              if (!seam && knot > 0.93) col = PAL.wood2;
              // the lanes: polished pale by years of dragged glasses, with fine drag scratches
              for (const ln of L) {
                const dl = Math.abs(u - ln);
                if (dl < 0.15 && !seam) {
                  const scratch = rnd(Math.floor(u * 140), 0, 13) > 0.7 && rnd(Math.floor(u * 140), Math.floor(t * 9), 14) > 0.25;
                  if (scratch && dl < 0.12) col = dl < 0.05 ? PAL.parch3 : PAL.wood4;
                  else if ((0.15 - dl) * 9 > bayer(px, py) + 0.3) col = col === PAL.wood2 ? PAL.wood3 : '#6a4429';
                }
              }
              // warm lamp glow pooled on the varnish
              const glow = Math.max(0, 1 - Math.hypot(u * 0.9, (t - 0.55) * 2.2));
              if (glow * 0.9 > bayer(px, py) + 0.35) col = col === PAL.wood1 ? PAL.wood2 : col === PAL.parch3 ? PAL.parch2 : PAL.wood4;
            }
          } else if (au < 1.09) {
            col = bayer(px, py) > 0.5 ? PAL.wood1 : PAL.wood0; // side face of the counter
            if (au < 1.015) col = PAL.ink;
          } else {
            // floor beside the bar: boards running away from us
            const bu = u * 2.5;
            const seam = Math.abs(bu % 1) < 0.05;
            col = seam ? PAL.ink : rnd(Math.floor(bu), Math.floor(t * 6), 21) > 0.7 ? PAL.wood2 : bayer(px, py) > 0.78 ? PAL.wood2 : PAL.wood1;
            if (Math.floor(t * 30) % 5 === 0 && bayer(px, py) > 0.6) col = PAL.wood0;
          }
        }
        put(px, py, col);
        // lamp light: dithered warm halos around each hanging lamp on the back wall
        if (py < yWall + 4) {
          for (const lu of lampsU) {
            const lx = cxp + lu * hwW, ly = yWall - 1.72 * hwW;
            const dd = Math.hypot(px - lx, (py - ly) * 1.3) / (hwW * 0.55);
            if (dd < 1 && (1 - dd) * 0.8 > bayer(px, py) + 0.15) put(px, py, dd < 0.25 ? PAL.lamp1 : PAL.lamp3, dd < 0.25 ? 0.6 : 0.35);
          }
        }
      }
    }
    // end lip of the counter
    const ye = Math.round(yEnd);
    const hwe = g.hw(1) / P;
    for (let x = Math.round(cxp - hwe); x <= Math.round(cxp + hwe); x++) { put(x, ye, PAL.lamp3); put(x, ye + 1, PAL.wood4); put(x, ye - 1, PAL.ink); }
    // chalk mark: a scuffed line across the bar
    const ym = g.y(mark) / P;
    const hwm = g.hw(mark) / P;
    for (let x = Math.round(cxp - hwm * 0.95); x <= Math.round(cxp + hwm * 0.95); x++) {
      for (let k = 0; k < 2; k++) {
        const yy = Math.round(ym) + k;
        if (k === 0 ? rnd(x, 3, 5) > 0.12 : bayer(x, yy) > 0.55) put(x, yy, k === 0 ? PAL.white : PAL.parch2);
      }
    }
    // brass tick nails every 1/10 of the bar on both rails
    for (let i = 1; i < 10; i++) {
      const t = i / 10, yy = Math.round(g.y(t) / P), hh = g.hw(t) / P;
      for (const sx of [-1, 1]) { const xx = Math.round(cxp + sx * hh * 0.97); put(xx, yy, PAL.lamp0); put(xx, yy + 1, PAL.lamp3); }
    }
    const y0t = Math.round(g.y(0.015) / P), hw00 = g.hw(0) / P;
    for (let x = Math.round(cxp - hw00 * 0.9); x <= Math.round(cxp + hw00 * 0.9); x += 2) put(x, y0t, PAL.parch3);
    c.putImageData(img, 0, 0);

    const R = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    // bottles on the back bar's shelves (left wall, odd bays) + a few on the back-bar top
    if (UR * g.hw0 < g.W / 2) {
      let k = 0;
      for (let t = TW - 0.02; t > -0.3; t -= 0.045) {
        const bay = Math.floor(t * 2.6 + 0.2), bf = (t * 2.6 + 0.2) % 1;
        k++;
        if (bf < 0.14 || bf > 0.94) continue;
        const hw = g.hw(t) / P, xw = cxp - UR * hw, yf = g.y(t) / P;
        if (xw < 1) continue;
        const shelves = bay % 2 ? [0.9, 1.3, 1.7] : [0.5];
        shelves.forEach((sv, si) => {
          if (rnd(k, si, 37) < 0.25) return;
          const tall = (0.2 + rnd(k, si, 34) * 0.13) * hw, bw = Math.max(2, hw * 0.06);
          const col = BOTTLES[Math.floor(rnd(k, si, 35) * BOTTLES.length)];
          const xb = xw - bw * 0.2, yb = yf - (sv - 0.05) * hw;
          R(xb - bw / 2 - 1, yb - tall - 1, bw + 2, tall + 1, PAL.ink);
          R(xb - bw / 2, yb - tall * 0.62, bw, tall * 0.62, col);
          R(xb - Math.max(1, bw / 5), yb - tall, Math.max(1, bw / 2.5), tall * 0.4, col);
          R(xb - bw / 2, yb - tall * 0.55, 1, tall * 0.4, 'rgba(255,246,228,.55)');
          if (bw > 4) R(xb - bw / 2, yb - tall * 0.42, bw, Math.max(1, tall * 0.14), PAL.parch2);
        });
      }
      // brass sconces with a warm halo on the paneled (right) wall
      for (const t of [0.15, 0.7, 1.2]) {
        const hw = g.hw(t) / P, xw = cxp + UR * hw, yl = g.y(t) / P - 1.15 * hw, sc = Math.max(1, hw * 0.025);
        if (xw > cw - 2) continue;
        const grd = c.createRadialGradient(xw, yl, 0, xw, yl, hw * 0.6);
        grd.addColorStop(0, 'rgba(255,179,92,.35)'); grd.addColorStop(1, 'rgba(255,179,92,0)');
        c.fillStyle = grd; c.fillRect(xw - hw * 0.6, yl - hw * 0.6, hw * 1.2, hw * 1.2);
        R(xw - sc, yl, sc * 2, sc * 3, PAL.ink); R(xw - sc + 1, yl + 1, sc * 2 - 2, sc * 2, PAL.lamp0); R(xw - sc, yl + sc * 3, sc * 2, sc, PAL.lamp3);
      }
    }
    // hanging lamps: chain, brass shade, bright bulb
    for (const lu of lampsU) {
      const lx = cxp + lu * hwW, ly = yWall - 1.72 * hwW, sc = hwW / 14;
      R(lx, 0, 1, ly - sc * 1.2, PAL.ink);
      R(lx - sc * 1.6, ly - sc * 1.2, sc * 3.2, sc * 1.1, PAL.ink);
      R(lx - sc * 1.4, ly - sc * 1.1, sc * 2.8, sc * 0.8, PAL.lamp3);
      R(lx - sc * 1.4, ly - sc * 1.1, sc * 1.0, sc * 0.4, PAL.lamp1);
      R(lx - sc * 0.6, ly - sc * 0.3, sc * 1.2, sc * 0.7, PAL.lamp0);
    }
    // stools along both sides of the bar (far ones first)
    for (const t of [1.0, 0.76, 0.52, 0.28, 0.04]) {
      for (const side of W < 700 ? [-1, 1] : [1]) {
        const hw = g.hw(t) / P, sxm = cxp + side * hw * (W < 700 ? 1.32 : 1.3), sym = g.y(t) / P + hw * 0.12;
        if (sxm < -hw || sxm > cw + hw) continue;
        const sw = hw * 0.2, sh = Math.max(2, hw * 0.05), lg = hw * 0.3;
        R(sxm - sw * 0.35, sym + sh, Math.max(1, hw * 0.035), lg, PAL.ink);
        R(sxm + sw * 0.3, sym + sh, Math.max(1, hw * 0.035), lg, PAL.ink);
        R(sxm - sw * 0.05, sym + sh, Math.max(1, hw * 0.03), lg * 1.05, PAL.wood1);
        R(sxm - sw * 0.4, sym + sh + lg * 0.6, sw * 0.8, Math.max(1, hw * 0.025), PAL.lamp3); // foot ring
        R(sxm - sw / 2 - 1, sym - 1, sw + 2, sh + 2, PAL.ink);
        R(sxm - sw / 2, sym, sw, sh, PAL.red1);
        R(sxm - sw / 2, sym, sw, Math.max(1, sh * 0.35), '#c4413a');
        R(sxm - sw / 2, sym + sh * 0.75, sw, Math.max(1, sh * 0.25), PAL.red2);
      }
    }
    // spittoon on the floor past the end
    const st = 1.13, spx = cxp + g.hw(st) / P * 0.55, spy = g.y(st) / P, sc = Math.max(1, Math.round(g.s(st) * (W < 520 ? 2.2 : 2.4)));
    const sp = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(spx + x * sc), Math.round(spy + y * sc), w * sc, h * sc); };
    sp(-6, 1, 12, 2, 'rgba(0,0,0,.5)');
    sp(-4, -6, 8, 7, PAL.ink); sp(-3, -5, 6, 5, PAL.lamp3); sp(-3, -5, 2, 4, PAL.lamp1); sp(2, -5, 1, 5, '#7a3a12');
    sp(-5, -8, 10, 2, PAL.ink); sp(-4, -8, 8, 1, PAL.lamp1); sp(-3, -7, 6, 1, PAL.wood0);
  }, [W, H, top, bot, mark, lanes]);
  return <canvas ref={ref} className="sl-cv" aria-hidden />;
});

/** skid marks + the wet streak trailing each sliding glass (redrawn while anything moves) */
function SkidCanvas({ g, throws, games, now, reduce }: { g: Geo; throws: SlideState['throws']; games: number[]; now: number; reduce: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const P = g.W < 520 ? 2 : 3;
  useEffect(() => {
    const cv = ref.current; if (!cv || g.W < 10) return;
    const cw = Math.ceil(g.W / P), ch = Math.ceil(g.H / P);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const c = cv.getContext('2d'); if (!c) return;
    c.clearRect(0, 0, cw, ch);
    const L = laneSet(games.length);
    const cxp = g.cx / P;
    throws.forEach((th, k) => {
      const lane = L[games.indexOf(th.game)] ?? 0;
      const el = now - th.at;
      const end = Math.min(1, reduce ? (el < 500 ? 0 : th.dist) : glassAt(th.dist, Math.max(0, el)));
      if (end <= 0.02) return;
      const yA = Math.floor(g.y(end) / P), yB = Math.ceil(g.y(0.02) / P);
      const old = k < throws.length - games.length; // earlier rounds: fainter
      for (let py = yA; py <= yB; py++) {
        const t = Math.max(0, g.tOf((py + 0.5) * P));
        const hw = g.hw(t) / P, x = cxp + lane * hw, half = Math.max(1, hw * 0.07);
        // permanent skid: two scuffed runner lines
        const a = (old ? 0.16 : 0.3) * (rnd(py, k, 51) > 0.2 ? 1 : 0.3);
        c.fillStyle = `rgba(11,7,5,${a})`;
        c.fillRect(Math.round(x - half), py, 1, 1); c.fillRect(Math.round(x + half - 1), py, 1, 1);
        // the wet streak: shiny, fading after the glass passed
        const pass = th.dist > t ? (1 - Math.sqrt(Math.max(0, 1 - t / th.dist))) * SLIDE_MS : SLIDE_MS;
        const wet = reduce ? 0 : 0.6 * Math.max(0, 1 - (el - pass) / 2200);
        if (wet > 0.02) {
          c.fillStyle = `rgba(196,88,31,${wet * 0.55})`; c.fillRect(Math.round(x - half * 0.8), py, Math.max(1, Math.round(half * 1.6)), 1);
          if ((py + k) % 3 !== 0) { c.fillStyle = `rgba(255,231,184,${wet * 0.7})`; c.fillRect(Math.round(x - half * 0.25), py, Math.max(1, Math.round(half * 0.4)), 1); }
        }
      }
    });
  }, [g, throws, games, now, reduce, P]);
  return <canvas ref={ref} className="sl-cv sl-skid" aria-hidden />;
}

/* ---------------- sprites ---------------- */
const GW = 16, GH = 20;
/** whiskey tumbler: see-through glass, amber whiskey with a sloshing surface (tilt -2..2), an ice cube, condensation */
const drawGlass = (tilt: number): DrawFn => (c) => {
  const r = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  r(2, 18, 13, 2, 'rgba(0,0,0,.45)');                     // shadow on the bar
  // tapered tumbler: 14px wide at the rim, 12px at the heavy base
  const L = (y: number) => (y < 9 ? 1 : 2), Rr = (y: number) => (y < 9 ? 15 : 14);
  for (let y = 1; y < 19; y++) {
    const l = L(y), rr = Rr(y);
    r(l, y, 1, 1, PAL.ink); r(rr - 1, y, 1, 1, PAL.ink);  // side outlines
    r(l + 1, y, rr - l - 2, 1, 'rgba(159,182,196,.42)');   // see-through glass
  }
  r(2, 18, 12, 1, PAL.ink);                               // bottom edge
  r(3, 15, 10, 3, 'rgba(207,224,234,.85)');               // thick base
  r(4, 16, 6, 1, 'rgba(255,246,228,.6)');
  // whiskey: surface tilts with the slosh
  for (let x = 3; x < 13; x++) {
    const sy = Math.round(8 + ((x - 7.5) / 5) * tilt);
    r(x, sy, 1, 15 - sy, PAL.lamp3);
    r(x, sy, 1, 1, PAL.lamp1);                            // bright meniscus
    if ((x + tilt) % 4 === 0) r(x, sy - 1, 1, 1, 'rgba(255,246,228,.75)'); // foam fleck
  }
  r(4, 10, 3, 3, 'rgba(207,224,234,.8)'); r(4, 10, 1, 1, PAL.white); // ice cube
  r(9, 12, 3, 2, PAL.lamp2);                              // depth glow
  r(3, 2, 1, 11, 'rgba(255,246,228,.8)'); r(12, 3, 1, 2, 'rgba(255,246,228,.55)'); // highlights
  r(11, 9, 1, 1, PAL.white); r(13, 12, 1, 1, 'rgba(255,255,255,.7)'); r(3, 14, 1, 1, 'rgba(255,255,255,.6)'); // condensation beads
  r(2, 0, 12, 1, PAL.ink); r(2, 1, 12, 1, '#cfe0ea'); r(3, 1, 3, 1, PAL.white); // rim
};
const GLASSES = [-2, -1, 0, 1, 2].map((k) => drawGlass(k));
const glassSprite = (tilt: number) => GLASSES[Math.max(-2, Math.min(2, Math.round(tilt))) + 2];
/** slosh: a lively wobble while sliding, damped after it stops */
const sloshAt = (el: number) => {
  if (el < 0) return 0;
  if (el < SLIDE_MS) return 2 * Math.sin(el / 85) * (1 - el / SLIDE_MS * 0.6);
  return 1.6 * Math.sin(el / 70) * Math.exp(-(el - SLIDE_MS) / 260);
};
const SHARDS = Array.from({ length: 12 }, (_, i) => ({ a: (i * 31 + ((i * 13) % 9)) % 180 - 90, d: 26 + ((i * 37) % 40), c: i % 3 === 0 ? PAL.lamp1 : i % 3 === 1 ? '#cfe0ea' : '#9fb6c4' }));

/* ---------------- main ---------------- */
type ThrowT = SlideState['throws'][number];

/** the full-screen stage size + the free band (between the header and the controls) the bar runs through */
function useStage() {
  const stage = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState({ w: 0, h: 0, top: 0, bot: 0 });
  useEffect(() => {
    const el = stage.current, z = zone.current; if (!el || !z) return;
    const on = () => {
      const a = el.getBoundingClientRect(), b = z.getBoundingClientRect();
      const n = { w: Math.round(a.width), h: Math.round(a.height), top: Math.round(b.top - a.top), bot: Math.round(b.bottom - a.top) };
      setSz((o) => (o.w === n.w && o.h === n.h && o.top === n.top && o.bot === n.bot ? o : n));
    };
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el); ro.observe(z);
    return () => ro.disconnect();
  }, []);
  return [stage, zone, sz] as const;
}

export default function Slide({ state, me, send, skew }: RoomProps) {
  const sl = state.slide;
  const [stageRef, zoneRef, sz] = useStage();
  const reduce = useMemo(reduced, []);
  const lastThrow = sl?.throws[sl.throws.length - 1];
  // keep the clock running through the last glass's slide + the reveal (winner may land the same instant)
  const settleAt = lastThrow ? lastThrow.at + SLIDE_MS + 400 : 0;
  const now = useNow(skew, !!sl && (!sl.winner || Date.now() + skew < settleAt + 1500));

  const player = (id?: string): Player | undefined => state.players.find((p) => p.id === id);
  const gameName = (a: number) => state.board.find((g) => g.appid === a)?.name ?? state.pool.find((g) => g.appid === a)?.name ?? `App ${a}`;

  const games = sl?.games ?? [];
  const order = sl?.order ?? [];
  const turn = sl?.turn ?? 0;
  const curIdx = sl && turn < order.length ? order[turn] : -1;
  const curGame = curIdx >= 0 ? games[curIdx] : undefined;
  const curChamp = curIdx >= 0 ? sl!.champs[curIdx] : undefined;
  const myTurn = !!sl && !sl.winner && curChamp === me;
  // a re-slide: only the games in `order` slide again; their throws this round are the last `turn` throws
  const roundThrows: ThrowT[] = sl ? sl.throws.slice(Math.max(0, sl.throws.length - Math.min(turn, sl.throws.length))) : [];
  const resliding = new Set(order.map((i) => games[i]));
  const throwFor = (appid: number): ThrowT | undefined => {
    const cur = [...roundThrows].reverse().find((t) => t.game === appid);
    if (cur) return cur;
    if (sl && sl.round > 1 && resliding.has(appid) && !sl.winner) return undefined; // back at the start for the re-slide
    return sl ? [...sl.throws].reverse().find((t) => t.game === appid) : undefined;
  };
  const ghostFor = (appid: number): ThrowT | undefined => {
    if (!sl || sl.round < 2 || !resliding.has(appid)) return undefined;
    const all = sl.throws.filter((t) => t.game === appid);
    const cur = throwFor(appid);
    return [...all].reverse().find((t) => t !== cur);
  };

  // the previous glass is still sliding: the next slider waits for it to settle
  // (the server holds the next turn for its own animation window, ~2.6s after the release)
  const busyUntil = lastThrow ? lastThrow.at + Math.max(2650, Math.min(SLIDE_MS, edgeMs(lastThrow.dist)) + FALL_MS) : 0;
  const animating = !!lastThrow && now < busyUntil && now - lastThrow.at < 4000;
  const opensAt = sl && sl.turnDeadline > 0 ? sl.turnDeadline - TURN_MS : 0;
  const steady = !!sl && !sl.winner && curIdx >= 0 && now < opensAt;
  const settled = (!lastThrow || !animating) && !steady;
  const revealed = !!sl?.winner && settled;

  /* ---- sounds for each fresh throw (never for ones already at rest when we arrived) ---- */
  const heard = useRef<Set<string>>(new Set());
  const throwKey = sl ? sl.throws.map((t) => `${t.game}:${t.at}`).join('|') : '';
  useEffect(() => {
    if (!sl) return;
    const timers: number[] = [];
    for (const t of sl.throws) {
      const k = `${t.game}:${t.at}`;
      if (heard.current.has(k)) continue;
      heard.current.add(k);
      const age = Date.now() + skew - t.at;
      if (age > 600) continue; // reload / late join: already at rest, no sound
      const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, ms - age)));
      at(0, () => { sfx.swish(); sfx.cardSlide(); });
      if (!reduce) { at(450, () => sfx.cardSlide()); at(1000, () => sfx.cardSlide()); }
      if (t.fell) {
        const e = reduce ? 600 : Math.min(SLIDE_MS, edgeMs(t.dist)) + FALL_MS * 0.6;
        at(e, () => { sfx.stamp(); sfx.glass(); });
        at(e + 50, () => sfx.clink());
        at(e + 120, () => sfx.glass());
        at(e + 90, () => buzz(BUZZ.hit));
      } else {
        at(reduce ? 600 : SLIDE_MS - 120, () => { sfx.glass(); if (Math.abs(t.dist - sl.mark) * BAR_IN < 6) sfx.clink(); });
      }
    }
    return () => { /* timers outlive re-renders on purpose; they're short */ };
  }, [throwKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // the winner reveal
  useEffect(() => {
    if (!revealed) return;
    sfx.drawSting();
    const t = window.setTimeout(() => sfx.stamp(), 500);
    buzz(BUZZ.win);
    return () => clearTimeout(t);
  }, [revealed]);

  // tie-break announcement
  const round = sl?.round ?? 1;
  useEffect(() => { if (round > 1) { sfx.coin(); } }, [round]);

  /* ---- power meter (driven by performance.now from the press: immune to clock skew resets) ---- */
  const [charging, setCharging] = useState<number | null>(null); // performance.now() at press
  const [, force] = useState(0);
  const sentKey = useRef('');
  const turnKey = sl ? `${sl.round}:${sl.turn}:${sl.throws.length}` : '';
  const [released, setReleased] = useState<{ key: string; power: number } | null>(null);
  const alreadySent = released?.key === turnKey || sentKey.current === turnKey;
  const canSlide = myTurn && settled && !alreadySent;
  useEffect(() => { setCharging(null); }, [turnKey]);
  // the server didn't take it (socket blip / too early): unlock so the slider can try again
  useEffect(() => {
    if (!released || released.key !== turnKey) return;
    const t = window.setTimeout(() => { if (sentKey.current === released.key) sentKey.current = ''; setReleased(null); }, 1800);
    return () => clearTimeout(t);
  }, [released, turnKey]);
  useEffect(() => { if (myTurn) { sfx.spurs(); buzz(BUZZ.myTurn); } }, [myTurn, turnKey]);
  useEffect(() => {
    if (charging === null) return;
    let raf = 0;
    const tick = () => { force((x) => x + 1); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [charging]);
  const power = charging !== null ? meter(performance.now() - charging) : released?.key === turnKey ? released.power : 0;

  const ctl = useRef({ canSlide, charging, turnKey });
  ctl.current = { canSlide, charging, turnKey };
  const startRef = useRef<() => void>(() => {});
  const releaseRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});
  startRef.current = () => {
    if (!ctl.current.canSlide || ctl.current.charging !== null) return;
    sfx.click();
    setCharging(performance.now());
  };
  releaseRef.current = () => {
    const { charging: at, canSlide: ok, turnKey: k } = ctl.current;
    if (at === null) return;
    setCharging(null);
    if (!ok || sentKey.current === k) return;
    const pw = Math.min(1, Math.max(0, Math.round(meter(performance.now() - at) * 1000) / 1000));
    sentKey.current = k;
    setReleased({ key: k, power: pw });
    send({ t: 'slide', power: pw });
  };
  cancelRef.current = () => { if (ctl.current.charging !== null) setCharging(null); };

  // Space: hold to charge, release to slide. A Space still held from before this screen (no keydown seen) is ignored.
  useEffect(() => {
    let down = false;
    const skip = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.emo, .emo-wheel, .sound, input, textarea, select');
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (skip(e.target)) return;
      e.preventDefault();
      if (e.repeat || down) return;
      down = true;
      startRef.current();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (!down) return;
      e.preventDefault();
      down = false;
      releaseRef.current();
    };
    const onCancel = () => { down = false; cancelRef.current(); };
    const onVis = () => { if (document.hidden) onCancel(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onCancel);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onCancel); document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const holdPtr = useRef<number | null>(null);
  const onBtnDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    holdPtr.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    startRef.current();
  };
  const onBtnUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdPtr.current !== e.pointerId) return;
    holdPtr.current = null;
    releaseRef.current();
  };
  const onBtnCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdPtr.current !== e.pointerId) return;
    holdPtr.current = null;
    cancelRef.current();
  };

  if (!sl) return createPortal(<div className="sl"><div className="sl-title">Lining up the glasses…</div></div>, document.body);

  const g = geo(sz.w, sz.h, sz.top, sz.bot);
  const lanes = laneSet(games.length);
  const gs0 = Math.max(30, Math.min(84, g.hw0 * 0.3));
  const sweet = sl.mark / REACH;
  const fallAt = 1 / REACH;
  const secs = sl.turnDeadline > 0 && !steady ? Math.min(TURN_MS / 1000, Math.max(0, Math.ceil((sl.turnDeadline - now) / 1000))) : 0;
  const winIdx = sl.winner !== undefined ? games.indexOf(sl.winner) : -1;
  const winTh = sl.winner !== undefined ? throwFor(sl.winner) : undefined;
  const curPlayer = player(curChamp);
  const holding = charging !== null;
  const canHold = myTurn && !alreadySent;

  const status = (i: number) => {
    const appid = games[i];
    const th = throwFor(appid);
    if (th) {
      const el = now - th.at;
      if (el < SLIDE_MS && !reduce) return { txt: 'sliding…', cls: 'live' };
      return { txt: fmtMiss(th.dist, sl.mark, th.fell), cls: th.fell ? 'fell' : 'rest' };
    }
    if (i === curIdx) return { txt: myTurn ? 'your slide' : 'up now', cls: 'up' };
    if (sl.round > 1 && !resliding.has(appid)) return { txt: 'out', cls: 'out' };
    return { txt: 'waiting', cls: '' };
  };

  // one short line under the title
  let line: JSX.Element;
  if (revealed && winIdx >= 0) line = <div className="sl-verdict">Closest: <b>{gameName(sl.winner!)}</b>{winTh ? <small> · {fmtMiss(winTh.dist, sl.mark, winTh.fell)}</small> : null}</div>;
  else if (sl.winner !== undefined || curIdx < 0) line = <div className="sl-line">Measuring…</div>;
  else if (animating) line = <div className="sl-line">Sliding…</div>;
  else if (steady) line = <div className="sl-line">Steady… <b>{curChamp === me ? 'you' : curPlayer?.name ?? 'a ghost'}</b> first, for <b>{gameName(curGame!)}</b></div>;
  else if (myTurn) line = <div className="sl-line mine">Your slide for <b>{gameName(curGame!)}</b>{secs > 0 && <em className={secs <= 5 ? 'hot' : ''}>{secs}s</em>}</div>;
  else line = <div className="sl-line"><b>{curPlayer?.name ?? 'A ghost'}</b> slides for <b>{gameName(curGame!)}</b>{secs > 0 && <em className={secs <= 5 ? 'hot' : ''}>{secs}s</em>}</div>;

  const t0 = performance.now();
  return createPortal(
    <div className={`sl ${myTurn ? 'my-turn' : ''} ${revealed ? 'decided' : ''} ${reduce ? 'reduce' : ''} ${holding ? 'holding' : ''}`} role="main" aria-label="Whiskey slide" ref={stageRef}>
      <div className="sl-stage">
        <RoomCanvas W={sz.w} H={sz.h} top={sz.top} bot={sz.bot} mark={sl.mark} lanes={games.length} />
        {sz.w > 0 && (
          <>
            <SkidCanvas g={g} throws={sl.throws} games={games} now={now} reduce={reduce} />
            <div className="sl-mark-lbl" style={{ top: g.y(sl.mark), left: g.cx + g.hw(sl.mark) + 4 }}>MARK</div>
            <div className="sl-end-lbl" style={{ top: g.y(1), left: g.cx - g.hw(1) - 4 }}>END</div>
            {games.map((appid, i) => {
              const ghost = ghostFor(appid);
              if (!ghost || ghost.fell) return null;
              const lane = lanes[i] ?? 0;
              const s = g.s(ghost.dist), size = gs0 * s;
              return <div key={`gh${appid}`} className="sl-ghost" style={{ left: g.cx + lane * g.hw(ghost.dist), top: g.y(ghost.dist), width: size, height: size * GH / GW }}><span>last</span></div>;
            })}
            {games.map((appid, i) => {
              const th = throwFor(appid);
              const lane = lanes[i] ?? 0;
              let t = 0, fallP = 0, gone = false, tilt = 0;
              if (th) {
                const el = now - th.at;
                tilt = reduce ? 0 : sloshAt(el);
                if (reduce) {
                  t = el < 500 ? 0 : Math.min(th.dist, 1);
                  if (th.fell && el >= 500) gone = true;
                } else if (th.fell) {
                  const e = Math.min(SLIDE_MS, edgeMs(th.dist));
                  if (el < e) t = glassAt(th.dist, el);
                  else { fallP = Math.min(1, (el - e) / FALL_MS); t = 1 + (th.dist - 1) * fallP; gone = fallP >= 1; }
                } else t = glassAt(th.dist, el);
              }
              const isCur = i === curIdx && !th && !sl.winner;
              const mineNow = isCur && canHold;
              if (mineNow && holding && !reduce) tilt = Math.sin((t0 - (charging ?? 0)) / 110) * 1.4;
              const s = g.s(t);
              const size = gs0 * s;
              const x = g.cx + lane * g.hw(t), y = g.y(t);
              const win = revealed && i === winIdx, lose = revealed && i !== winIdx;
              const smashEl = th?.fell ? now - th.at - (reduce ? 500 : Math.min(SLIDE_MS, edgeMs(th.dist)) + FALL_MS * 0.6) : -1;
              const tagSize = Math.max(22, Math.min(44, size * 0.75));
              const lift = mineNow && holding ? -Math.max(6, size * 0.16) : 0;
              const style = {
                left: x, top: y, width: size, height: size * GH / GW, zIndex: Math.round(100 - t * 50),
                transform: `translate(-50%, -100%) translateY(${fallP * size * 0.9 + lift}px) rotate(${fallP * (lane >= 0 ? 70 : -70)}deg)`,
                opacity: gone ? 0 : 1 - fallP * 0.85,
              } as CSSProperties;
              const meterSide = lane < 0 ? 'left' : 'right'; // the meter sits on the inner side (the tag takes the outer one)
              const grab = Math.max(96, size * 2.3);
              return (
                <div key={appid}>
                  {!gone && (
                    <div className={`sl-glass ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${isCur ? 'cur' : ''} ${mineNow ? 'mine' : ''} ${mineNow && holding ? 'held' : ''}`} style={style}>
                      <PixelSprite draw={glassSprite(tilt)} w={GW} h={GH} className="sl-glass-sp" />
                      {fallP === 0 && <PixelSprite draw={glassSprite(-tilt)} w={GW} h={GH} className="sl-glass-refl" />}
                      <div className="sl-tag" style={{ width: tagSize, height: tagSize, [lane < 0 ? 'right' : 'left']: '88%' } as CSSProperties}>
                        <PixelCover appid={appid} name={gameName(appid)} kind="square" />
                      </div>
                      {lose && <span className="sl-gstamp">NAH.</span>}
                    </div>
                  )}
                  {mineNow && (
                    <>
                      <button
                        className={`sl-grab ${holding ? 'held' : ''}`}
                        style={{ left: x, top: y - size * GH / GW / 2, width: grab, height: grab }}
                        disabled={!canSlide}
                        onPointerDown={onBtnDown} onPointerUp={onBtnUp} onPointerCancel={onBtnCancel} onLostPointerCapture={onBtnCancel}
                        onContextMenu={(e) => e.preventDefault()}
                        aria-label="Hold your glass, let go to slide"
                      />
                      <div
                        className={`sl-vmeter ${holding ? 'on' : ''} ${meterSide}`}
                        style={{ left: meterSide === 'right' ? x + size * 0.5 + 14 : x - size * 0.5 - 14, top: y - 4, height: Math.max(110, size * 2.6) } as CSSProperties}
                        aria-hidden
                      >
                        <i className="sl-vz-fell" style={{ bottom: `${fallAt * 100}%` }} />
                        <i className="sl-vz-sweet" style={{ bottom: `${(sweet - 0.045) * 100}%`, height: '9%' }} />
                        <b className="sl-vneedle" style={{ bottom: `${power * 100}%` }} />
                      </div>
                    </>
                  )}
                  {th?.fell && smashEl >= 0 && smashEl < 1600 && (
                    <div className="sl-smash" style={{ left: x, top: g.y(1) }}>
                      {!reduce && SHARDS.map((sh, k) => <i key={k} style={{ '--a': `${sh.a}deg`, '--d': `${sh.d * Math.max(0.6, s * 1.4)}px`, background: sh.c } as CSSProperties} />)}
                      <b>CRASH!</b>
                    </div>
                  )}
                  {th && !(th.fell && !gone && fallP < 1) && (now - th.at >= SLIDE_MS || reduce) && !(th.fell && smashEl < 1600) && (
                    <div className={`sl-read ${th.fell ? 'fell' : ''} ${win ? 'win' : ''}`} style={{ left: x, top: th.fell ? g.y(1) - 4 : y + 4 }}>
                      {fmtMiss(th.dist, sl.mark, th.fell)}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="sl-head">
        <div className="sl-title">Whiskey Slide{sl.round > 1 && <span className="sl-tie">TIE! Re-slide</span>}</div>
        <div className="sl-rules">Closest to the chalk wins. Off the end loses.</div>
        {line}
      </div>

      <div className="sl-roster">
        {games.map((appid, i) => {
          const champ = player(sl.champs[i]);
          const st = status(i);
          const win = revealed && i === winIdx, lose = revealed && i !== winIdx;
          return (
            <div key={appid} className={`sl-card px-box ${i === curIdx && !sl.winner ? 'cur' : ''} ${win ? 'win' : ''} ${lose ? 'lose' : ''}`}>
              <div className="sl-card-art">
                <PixelCover appid={appid} name={gameName(appid)} kind="square" />
                {lose && <span className="sl-stamp">NAH.</span>}
              </div>
              <div className="sl-card-txt">
                <div className="sl-card-name">{gameName(appid)}</div>
                <div className="sl-card-champ">
                  {champ && <MiniBust p={champ} className="sl-mini" />}
                  <span className={sl.champs[i] === me ? 'me' : ''}>{sl.champs[i] === me ? 'you' : champ?.name ?? 'a ghost'}</span>
                </div>
                <div className={`sl-card-st ${st.cls}`}>{st.txt}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sl-zone" ref={zoneRef} />

      <div className="sl-ctl">
        {canHold ? (
          <div className={`sl-tip ${holding ? 'hot' : ''}`}>
            {steady ? 'Steady…' : !settled ? 'Wait…' : holding ? 'Let go on the gold!' : 'Hold your glass. Let go to slide.'}
            {!holding && settled && !steady && <small>or hold Space</small>}
          </div>
        ) : myTurn && alreadySent ? (
          <div className="sl-tip">Sent at {Math.round((released?.power ?? 0) * 100)}%</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
