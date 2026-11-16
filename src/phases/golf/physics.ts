// Mini golf physics: pure + deterministic (no DOM). Course space is a 120x180 pixel grid of 6px tiles (portrait);
// everything (ghost positions on the wire included) is in these course pixels. Fixed 120 Hz steps.
import type { Course, Box } from './courses';

export const W = 120, H = 180, T = 6, COLS = 20, ROWS = 30;
export const BALL_R = 2;
export const CUP_R = 3.5;
export const DT = 1 / 120;
export const VMAX = 205;        // px/s at full power
export const MAX_STROKES = 10;
export const ROLL_CAP = 9;      // seconds: a stroke always ends by then (forced rest)
const ROLL = 52;                // constant rolling resistance px/s²
const DRAG = 0.6;               // speed-proportional drag 1/s
const SAND = 360;               // sand: heavy resistance
const SLOPE = 95;               // slope tiles push this hard (px/s²)
const CAPTURE = 105;            // slower than this over the cup = holed
const WALL_E = 0.68;

export const FLOOR = new Set(['.', 's', 'w', '^', 'v', '<', '>', 'b', '=', ',']);
export const isSlope = (c: string) => c === '^' || c === 'v' || c === '<' || c === '>';

export interface Ball { x: number; y: number; vx: number; vy: number }
export interface StepEv { hit: number; bump: number; water: boolean; oob: boolean; holed: boolean; tunnel: boolean; contact: boolean; cart: number; sand: boolean }
export const newEv = (): StepEv => ({ hit: 0, bump: 0, water: false, oob: false, holed: false, tunnel: false, contact: false, cart: 0, sand: false });

export function tileAt(c: Course, x: number, y: number): string {
  const cx = Math.floor(x / T), cy = Math.floor(y / T);
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return ' ';
  return c.grid[cy][cx];
}
export const solidTile = (c: Course, cx: number, cy: number) => {
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return true;
  return !FLOOR.has(c.grid[cy][cx]);
};

/** triangle wave 0..1..0 over `period` seconds, and its derivative (1/s) */
function tri(t: number, period: number, phase = 0): [number, number] {
  const u = ((t / period + phase) % 1 + 1) % 1;
  return u < 0.5 ? [u * 2, 2 / period] : [2 - u * 2, -2 / period];
}

/** a box's rect + velocity at time t (seconds since the hole opened) */
export function boxAt(b: Box, t: number): { x: number; y: number; w: number; h: number; vx: number; vy: number } {
  const m = b.move;
  if (!m) return { x: b.x, y: b.y, w: b.w, h: b.h, vx: 0, vy: 0 };
  if (m.loop) {
    // constant speed in x, wrapping across `span` (a train coming out of one tunnel into the other)
    const span = m.span ?? (W + b.w);
    const d = (((t + (m.phase ?? 0) * span / Math.abs(m.loop)) * m.loop) % span + span) % span;
    return { x: b.x + d, y: b.y, w: b.w, h: b.h, vx: m.loop, vy: 0 };
  }
  const [f, df] = tri(t, m.period ?? 3, m.phase ?? 0);
  const ease = (1 - Math.cos(f * Math.PI)) / 2, dease = (Math.PI / 2) * Math.sin(f * Math.PI) * df;
  return { x: b.x + (m.dx ?? 0) * ease, y: b.y + (m.dy ?? 0) * ease, w: b.w, h: b.h, vx: (m.dx ?? 0) * dease, vy: (m.dy ?? 0) * dease };
}

function collideRect(b: Ball, x0: number, y0: number, x1: number, y1: number, e: number, ev: StepEv, bvx = 0, bvy = 0): boolean {
  const qx = Math.max(x0, Math.min(b.x, x1)), qy = Math.max(y0, Math.min(b.y, y1));
  let dx = b.x - qx, dy = b.y - qy;
  let d = Math.hypot(dx, dy);
  if (d >= BALL_R) return false;
  let pen: number;
  if (d < 1e-6) {
    // centre inside: push out along the axis of least penetration
    const l = b.x - x0, r = x1 - b.x, u = b.y - y0, dn = y1 - b.y;
    const m = Math.min(l, r, u, dn);
    if (m === l) { dx = -1; dy = 0; } else if (m === r) { dx = 1; dy = 0; } else if (m === u) { dx = 0; dy = -1; } else { dx = 0; dy = 1; }
    pen = m + BALL_R; d = 1;
  } else { pen = BALL_R - d; dx /= d; dy /= d; }
  b.x += dx * pen; b.y += dy * pen;
  const rvx = b.vx - bvx, rvy = b.vy - bvy;
  const vn = rvx * dx + rvy * dy;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * dx; b.vy -= (1 + e) * vn * dy;
    if (-vn > ev.hit) ev.hit = -vn;
  }
  ev.contact = true;
  return true;
}

/** one fixed step at time t. Returns events (hits for sfx, water / holed / tunnel). */
export function step(c: Course, b: Ball, t: number, ev: StepEv, tunnelLock: { v: number }) {
  const tile = tileAt(c, b.x, b.y);
  // slopes
  if (tile === '^') b.vy -= SLOPE * DT; else if (tile === 'v') b.vy += SLOPE * DT;
  else if (tile === '<') b.vx -= SLOPE * DT; else if (tile === '>') b.vx += SLOPE * DT;
  // rolling resistance
  const s = Math.hypot(b.vx, b.vy);
  if (s > 0) {
    if (tile === 's') ev.sand = true;
    const dec = (tile === 's' ? SAND : ROLL) + DRAG * s;
    const ns = Math.max(0, s - dec * DT);
    b.vx *= ns / s; b.vy *= ns / s;
  }
  // integrate in substeps so nothing tunnels
  const sp = Math.hypot(b.vx, b.vy);
  const n = Math.max(1, Math.ceil((sp * DT) / 0.9));
  for (let i = 0; i < n; i++) {
    b.x += (b.vx * DT) / n; b.y += (b.vy * DT) / n;
    // tiles
    const c0 = Math.floor((b.x - BALL_R) / T), c1 = Math.floor((b.x + BALL_R) / T);
    const r0 = Math.floor((b.y - BALL_R) / T), r1 = Math.floor((b.y + BALL_R) / T);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      if (solidTile(c, cx, cy)) collideRect(b, cx * T, cy * T, cx * T + T, cy * T + T, WALL_E, ev);
    }
    for (const o of c.circles) {
      const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy), R = o.r + BALL_R;
      if (d >= R || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      b.x = o.x + nx * R; b.y = o.y + ny * R;
      const vn = b.vx * nx + b.vy * ny;
      if (o.kind === 'bumper') {
        if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
        const vs = Math.hypot(b.vx, b.vy), out = Math.max(vs * 1.15, 95);
        b.vx = (b.vx / (vs || 1)) * out; b.vy = (b.vy / (vs || 1)) * out;
        if (vs < 1) { b.vx = nx * out; b.vy = ny * out; }
        ev.bump = Math.max(ev.bump, out);
      } else if (vn < 0) {
        const e = o.kind === 'cactus' ? 0.4 : 0.6;
        b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
        if (-vn > ev.hit) ev.hit = -vn;
      }
      ev.contact = true;
    }
    for (const o of c.boxes) {
      const r = boxAt(o, t);
      const hitIt = collideRect(b, r.x, r.y, r.x + r.w, r.y + r.h, o.move ? 0.8 : 0.55, ev, r.vx, r.vy);
      if (hitIt && o.move) ev.cart = Math.max(ev.cart, Math.hypot(r.vx, r.vy));
    }
  }
  // tunnels
  if (tunnelLock.v >= 0) {
    const tn = c.tunnels[tunnelLock.v];
    if (!tn || Math.hypot(b.x - tn.bx, b.y - tn.by) > 7) tunnelLock.v = -1;
  } else {
    for (let i = 0; i < c.tunnels.length; i++) {
      const tn = c.tunnels[i];
      if (Math.hypot(b.x - tn.ax, b.y - tn.ay) < 4) {
        const v = Math.max(70, Math.hypot(b.vx, b.vy));
        const l = Math.hypot(tn.dx, tn.dy) || 1;
        b.x = tn.bx; b.y = tn.by; b.vx = (tn.dx / l) * v; b.vy = (tn.dy / l) * v;
        tunnelLock.v = i; ev.tunnel = true;
        break;
      }
    }
  }
  // cup
  const hx = c.hole[0] - b.x, hy = c.hole[1] - b.y, hd = Math.hypot(hx, hy);
  if (hd < CUP_R) {
    const v = Math.hypot(b.vx, b.vy);
    if (v < CAPTURE || (hd < 1.4 && v < CAPTURE * 1.7)) ev.holed = true;
    if (!ev.holed && hd > 0.01) { b.vx += (hx / hd) * 900 * DT; b.vy += (hy / hd) * 900 * DT; } // lip
  }
  if (tileAt(c, b.x, b.y) === 'w') ev.water = true;
  if (solidTile(c, Math.floor(b.x / T), Math.floor(b.y / T))) ev.oob = true;
  if (b.x < 1 || b.y < 1 || b.x > W - 1 || b.y > H - 1) ev.oob = true; // squeezed out (e.g. by a cart): back to the last spot, no penalty
}

/** at rest? (on a slope only when pinned against something) */
export function resting(c: Course, b: Ball, ev: StepEv) {
  const s = Math.hypot(b.vx, b.vy);
  if (s > 3) return false;
  return !isSlope(tileAt(c, b.x, b.y)) || ev.contact;
}

/** a resting ball in the path of a moving obstacle gets shoved (no stroke) */
export function shoved(c: Course, b: Ball, t: number): boolean {
  for (const o of c.boxes) {
    if (!o.move) continue;
    const r = boxAt(o, t);
    const qx = Math.max(r.x, Math.min(b.x, r.x + r.w)), qy = Math.max(r.y, Math.min(b.y, r.y + r.h));
    if (Math.hypot(b.x - qx, b.y - qy) < BALL_R) return true;
  }
  return false;
}

/** launch velocity for an aim angle (radians, course space) and power 0..1 */
export function launch(angle: number, power: number): [number, number] {
  const v = VMAX * Math.pow(Math.max(0, Math.min(1, power)), 1.15);
  return [Math.cos(angle) * v, Math.sin(angle) * v];
}

export interface Outcome { x: number; y: number; holed: boolean; water: boolean; t: number; capped: boolean }
/** simulate a whole stroke (solver / tests) */
export function simulate(c: Course, x: number, y: number, angle: number, power: number, t0: number): Outcome {
  const b: Ball = { x, y, vx: 0, vy: 0 };
  [b.vx, b.vy] = launch(angle, power);
  const lock = { v: -1 };
  let t = t0;
  for (let i = 0; i < ROLL_CAP / DT; i++) {
    const ev = newEv();
    step(c, b, t, ev, lock);
    t += DT;
    if (ev.holed) return { x: c.hole[0], y: c.hole[1], holed: true, water: false, t, capped: false };
    if (ev.water || ev.oob) return { x, y, holed: false, water: true, t, capped: false };
    if (i > 2 && resting(c, b, ev)) return { x: b.x, y: b.y, holed: false, water: false, t, capped: false };
  }
  return { x: b.x, y: b.y, holed: false, water: false, t, capped: true };
}
