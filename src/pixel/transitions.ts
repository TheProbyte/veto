/* Phase transitions, painted per pixel on a low-res canvas (the scene's W x H, scaled by P): each kind says,
 * for every pixel and moment, whether it is covered and in what colour. Pixel-stepped (~16 fps), ≤ 700 ms in all. */
import { PAL, hexRgb, rnd } from './palette';
import { bayer } from './dither';
import { FELTS } from '../../shared/types';

export type TxKind = 'shuffle' | 'dust' | 'sun' | 'felt' | 'whiskey' | 'cylinder' | 'lantern';
export interface TxTiming { close: number; hold: number; open: number }
export const TX_T: Record<TxKind, TxTiming> = {
  shuffle: { close: 300, hold: 70, open: 300 },
  dust: { close: 280, hold: 90, open: 300 },
  sun: { close: 300, hold: 100, open: 290 },
  felt: { close: 280, hold: 80, open: 280 },
  whiskey: { close: 300, hold: 80, open: 300 },
  cylinder: { close: 300, hold: 90, open: 290 },
  lantern: { close: 300, hold: 90, open: 300 },
};
/** the frame clock steps every STEP ms (crisp, not tweened) */
export const TX_STEP = 60;

const C = (h: string) => { const [r, g, b] = hexRgb(h); return (255 << 24) | (b << 16) | (g << 8) | r; };
const NONE = 0;

/** paint frame `ms` of a transition into `buf` (W*H little-endian RGBA words) */
export function paintTx(buf: Uint32Array, kind: TxKind, W: number, H: number, ms: number, felt = 0) {
  const T = TX_T[kind];
  ms = Math.floor(ms / TX_STEP) * TX_STEP;
  const closing = ms < T.close + T.hold;
  const u = closing ? Math.min(1, ms / T.close) : Math.min(1, (ms - T.close - T.hold) / T.open);
  const t = ms / 1000;
  const cx = W / 2, cy = H / 2, maxR = Math.hypot(cx, cy) || 1;
  buf.fill(NONE);
  const put = (i: number, col: number) => { buf[i] = col; };

  switch (kind) {
    case 'shuffle': { // rows of card backs slide in from alternate sides, stack up, then fly off the other way
      const cw = 12, ch = 16;
      const back = C(PAL.red1), back2 = C('#c4382a'), edge = C(PAL.parch), ink = C(PAL.ink), shadow = C('#050302');
      const rows = Math.ceil(H / ch) + 1;
      for (let j = 0; j < rows; j++) {
        const odd = j % 2 === 1, ox = odd ? cw >> 1 : 0;
        const cols = Math.ceil((W + cw) / cw) + 1;
        for (let k = 0; k < cols; k++) {
          const x0 = k * cw - ox, y0 = j * ch - 2;
          const jit = rnd(j, k, 17) * 0.16;
          const along = (odd ? 1 - (x0 + cw) / (W + cw) : x0 / (W + cw)) * 0.84;
          const f = along + jit;
          // closing: in once its turn comes (front sweeps from its side); opening: out in the same order
          const on = closing ? f < u * 1.02 : f >= u * 1.02;
          if (!on) continue;
          // still sliding: offset toward its entry side for the frame it arrives / leaves
          const near = closing ? u * 1.02 - f : f - u * 1.02;
          const slide = near < 0.1 ? Math.round((0.1 - near) * 60) * (odd ? 1 : -1) * (closing ? 1 : -1) : 0;
          for (let y = Math.max(0, y0); y < Math.min(H, y0 + ch); y++) {
            const yy = y - y0;
            for (let x = Math.max(0, x0 + slide); x < Math.min(W, x0 + cw + slide); x++) {
              const xx = x - x0 - slide;
              let col: number;
              if (xx === 0 || yy === 0 || xx === cw - 1 || yy === ch - 1) col = ink;
              else if (xx === 1 || yy === 1 || xx === cw - 2 || yy === ch - 2) col = edge;
              else col = (xx + yy) % 4 === 0 || (xx - yy + 64) % 4 === 0 ? back2 : back;
              if (yy === ch - 1 && xx > 0) col = shadow;
              put(y * W + x, col);
            }
          }
        }
      }
      break;
    }
    case 'dust': { // a swirling dust devil fills the room from the middle, then blows out from the middle
      const cols = [C('#4a3420'), C('#6b5032'), C('#8a6a48'), C('#a8845a'), C('#c9a87a')];
      const rot = t * 5;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = (y - cy) * 1.4;
        const r = Math.hypot(dx, dy) / maxR;
        const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
        const sw = (a + r * 1.6 + rot * 0.1) % 1; // spiral arms
        const f = r * 0.78 + sw * 0.22;
        const b = bayer(x, y);
        const on = closing ? f < u * 1.05 + (b - 0.5) * 0.08 : f >= u * 1.05 + (b - 0.5) * 0.08;
        if (!on) continue;
        const band = (Math.sin((a + r * 2.2 - rot * 0.15) * Math.PI * 8) * 0.5 + 0.5) * 0.7 + rnd(x >> 1, y >> 1, Math.floor(t * 16)) * 0.3;
        put(y * W + x, cols[Math.min(4, Math.floor(band * 4 + b * 0.9))]);
      }
      break;
    }
    case 'sun': { // sunlight blooms in from the top-right and whites the room out; then the glare fades off
      const sx = W * 0.82, sy = H * 0.12, R = Math.hypot(Math.max(sx, W - sx), Math.max(sy, H - sy));
      const white = C(PAL.white), y0 = C('#fff3c4'), y1 = C(PAL.lamp0), y2 = C(PAL.lamp1);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const f = Math.hypot(x - sx, (y - sy) * 1.2) / R;
        const b = bayer(x, y);
        // rays: stepped wedges that run ahead of the bloom
        const ray = (Math.floor(((Math.atan2(y - sy, x - sx) / Math.PI) * 12 + 24)) % 2) * 0.08;
        if (closing) {
          const e = u * 1.15 + ray - f;
          if (e < (b - 0.5) * 0.06) continue;
          put(y * W + x, e > 0.3 ? white : e > 0.18 ? y0 : e > 0.08 ? y1 : y2);
        } else {
          if (b < u * 1.1 - (1 - f) * 0.12) continue; // dithered fade, the far corners clear first
          put(y * W + x, u > 0.55 && b > 0.8 ? y1 : u > 0.3 ? y0 : white);
        }
      }
      break;
    }
    case 'felt': { // a fresh putting green rolls across on a diagonal, with a stitched leading edge and mower stripes
      const fz = FELTS[0];
      const c0 = C(fz.dark), c1 = C(fz.base), c2 = C(fz.light), stitch = C(PAL.parch), ink = C(PAL.ink);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const qx = x & ~3, qy = y & ~3; // 4px stepped edge
        const f = (qx / W) * 0.72 + (1 - qy / H) * 0.28;
        const e = closing ? u * 1.04 - f : f - u * 1.04;
        if (e < 0) continue;
        let col = Math.floor((x + y) / 7) % 2 ? c1 : c2;
        if (bayer(x, y) > 0.86) col = c0;
        if (e < 0.012) col = ink;
        else if (e < 0.03) col = (x + y) % 3 === 0 ? stitch : c0;
        put(y * W + x, col);
      }
      break;
    }
    case 'whiskey': { // a wave of whiskey sloshes up the screen with a foamy crest, then drains away
      const deep = C('#6b2e0c'), mid = C(PAL.lamp3), hi = C(PAL.lamp2), foam = C(PAL.lamp0), cream = C(PAL.white), bub = C(PAL.lamp1);
      const level = closing ? u * (H + 16) : (1 - u) * (H + 16);
      for (let x = 0; x < W; x++) {
        const surf = Math.round(H - level + Math.sin(x * 0.13 + t * 9) * 3 + Math.sin(x * 0.047 - t * 6) * 4);
        for (let y = Math.max(0, surf); y < H; y++) {
          const d = y - surf;
          const b = bayer(x, y);
          let col = d < 1 ? cream : d < 3 ? foam : d < 7 ? hi : d + b * 10 < 22 ? mid : deep;
          if (d > 6 && rnd(x, Math.floor(y + t * 40), 5) > 0.992) col = bub;
          buf[y * W + x] = col;
        }
        // splash droplets flung above the crest
        if (closing && u < 0.95 && rnd(x, 3, Math.floor(t * 16)) > 0.93) {
          const yy = surf - 3 - Math.floor(rnd(x, 4, Math.floor(t * 16)) * 8);
          if (yy >= 0 && yy < H) buf[yy * W + x] = foam;
        }
      }
      break;
    }
    case 'cylinder': { // a revolver cylinder spins; a gunmetal sweep follows it round, then sweeps the room clear
      const m0 = C(PAL.metal0), m1 = C(PAL.metal1), m2 = C(PAL.metal2), m3 = C(PAL.metal3), m4 = C(PAL.metal4), ink = C(PAL.ink);
      const R = Math.min(W, H) * 0.36, hole = R * 0.24, ring = R * 0.58;
      const spin = (closing ? u : 1 + u) * Math.PI * 2 * 0.75; // turns as it sweeps
      const holes = Array.from({ length: 6 }, (_, k) => ({ x: cx + Math.cos(spin + (k * Math.PI) / 3) * ring, y: cy + Math.sin(spin + (k * Math.PI) / 3) * ring }));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const a = ((Math.atan2(y - cy, x - cx) + Math.PI / 2) / (Math.PI * 2) + 1) % 1;
        const aq = Math.floor(a * 24) / 24;
        const on = closing ? aq < u : aq >= u;
        if (!on) continue;
        const r = Math.hypot(x - cx, y - cy);
        const b = bayer(x, y);
        let col = (r / maxR) * 0.6 + b * 0.4 > 0.5 ? m0 : m1;
        if (r < R) {
          col = r > R - 1.5 ? ink : r > R - 3 ? m4 : (x - cx) + (y - cy) < -R * 0.4 && b > 0.5 ? m3 : m2;
          if (r < R * 0.16) col = r < R * 0.08 ? ink : m3; // the pin
          for (const h of holes) {
            const hr = Math.hypot(x - h.x, y - h.y);
            if (hr < hole) col = hr > hole - 1.3 ? m4 : ink;
          }
          // flutes between the chambers
          if (r > R * 0.84 && r < R - 3 && Math.floor(((Math.atan2(y - cy, x - cx) - spin) / (Math.PI / 3)) * 2 + 64) % 2 === 0) col = m1;
        }
        put(y * W + x, col);
      }
      break;
    }
    case 'lantern': { // the lantern sputters (dark flickers), goes out, then catches and floods the room with warm light
      const dark = C('#050302'), warm0 = C('#1c0f06'), warm1 = C(PAL.lamp3), warm2 = C(PAL.lamp1), warm3 = C(PAL.lamp0);
      if (closing) {
        const step = Math.min(6, Math.floor(u * 6.99));
        const dens = [0.25, 0.7, 0.35, 0.9, 0.6, 1, 1][step];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (bayer(x, y) >= dens) continue;
          // the dying flame's last glow in the middle during the hold
          const r = Math.hypot(x - cx, (y - cy) * 1.3);
          put(y * W + x, u >= 1 && r < 6 ? (r < 2.5 ? warm3 : bayer(x, y) > 0.4 ? warm2 : warm1) : dark);
        }
      } else {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const f = Math.hypot(x - cx, (y - cy) * 1.3) / maxR;
          const e = f - u * 1.12;
          if (e < 0) {
            // inside the light: a last warm dither that thins out
            if (e > -0.08 && bayer(x, y) > 0.5) put(y * W + x, warm3);
            else if (e > -0.16 && bayer(x, y) > 0.82) put(y * W + x, warm2);
            continue;
          }
          put(y * W + x, e < 0.05 ? warm2 : e < 0.12 ? warm1 : warm0);
        }
      }
      break;
    }
  }
}
