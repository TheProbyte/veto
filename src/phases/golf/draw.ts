// Pixel art for the golf courses: a static background per course + the moving bits drawn each frame.
import { PAL, rnd } from '../../pixel/palette';
import { bayer, makeCanvas } from '../../pixel/dither';
import type { Course, Theme } from './courses';
import { COLS, ROWS, T, W, H, CUP_R, FLOOR, boxAt, isSlope } from './physics';

type Ctx = CanvasRenderingContext2D;

interface Pal { f0: string; f1: string; wall: string; wallHi: string; wallLo: string; back0: string; back1: string; back2: string; slope: string }
const THEMES: Record<Theme, Pal> = {
  saloon: { f0: '#2e4a22', f1: '#2a4420', wall: PAL.wood3, wallHi: PAL.wood4, wallLo: PAL.wood1, back0: PAL.wood2, back1: '#33200f', back2: PAL.wood1, slope: '#5a3a22' },
  canyon: { f0: '#6f7a34', f1: '#66702f', wall: '#9a4a22', wallHi: '#c86a34', wallLo: '#5e2a12', back0: '#c4783a', back1: '#b0682f', back2: '#8e5226', slope: '#8a6a44' },
  rail: { f0: '#3f6a2a', f1: '#3a6227', wall: PAL.wood3, wallHi: PAL.parch3, wallLo: PAL.wood1, back0: '#7a5a3a', back1: '#6c4f32', back2: '#5a3f26', slope: '#5a4a2a' },
  grave: { f0: '#2c4024', f1: '#283b21', wall: '#6a6258', wallHi: '#a39a8c', wallLo: '#2e2a26', back0: '#1d1712', back1: '#16110d', back2: '#2a2018', slope: '#3a3a28' },
  mine: { f0: '#4a3e36', f1: '#443830', wall: '#2a201a', wallHi: '#5a4636', wallLo: '#120c09', back0: '#16100c', back1: '#1e1611', back2: '#0d0907', slope: '#5a4a3a' },
};
export const themePal = (t: Theme) => THEMES[t];

const fill = (c: Ctx, col: string, x: number, y: number, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

function disc(c: Ctx, cx: number, cy: number, r: number, col: string) {
  c.fillStyle = col;
  for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
    if (x * x + y * y <= r * r + r * 0.6) c.fillRect(Math.floor(cx + x), Math.floor(cy + y), 1, 1);
  }
}

function drawBackdrop(c: Ctx, th: Theme, p: Pal, x0: number, y0: number) {
  for (let y = y0; y < y0 + T; y++) for (let x = x0; x < x0 + T; x++) {
    let col = p.back0;
    const n = rnd(x, y, 7);
    if (th === 'saloon') { col = Math.floor(x / 10) % 2 ? p.back0 : p.back1; if ((x % 10) === 0) col = p.back2; if (n > 0.93) col = p.back2; }
    else if (th === 'canyon') { col = n > 0.8 + bayer(x, y) * 0.15 ? p.back1 : p.back0; if (n < 0.04) col = p.back2; }
    else if (th === 'rail') { col = n > 0.75 ? p.back1 : p.back0; if (n < 0.05) col = p.back2; }
    else if (th === 'grave') { col = n > 0.7 ? p.back1 : p.back0; if (n < 0.03) col = '#3a4a2a'; }
    else { col = n > 0.6 ? p.back1 : p.back0; if (n < 0.02) col = '#c8a040'; }
    fill(c, col, x, y);
  }
}

function drawFloor(c: Ctx, course: Course, p: Pal, ch: string, cx: number, cy: number) {
  const x0 = cx * T, y0 = cy * T;
  for (let y = y0; y < y0 + T; y++) for (let x = x0; x < x0 + T; x++) {
    const n = rnd(x, y, 3);
    let col = Math.floor(y / 12) % 2 ? p.f0 : p.f1; // mowing stripes
    if (ch === ',') col = '#4f7a34';
    if (n > 0.94) col = Math.floor(y / 12) % 2 ? p.f1 : p.f0;
    if (course.theme === 'saloon' && n > 0.97) col = '#36522a';
    if (ch === 's') col = n > 0.7 ? '#c9a462' : n < 0.08 ? '#a8844a' : '#d8b878';
    if (ch === 'w') col = n > 0.85 ? PAL.blue3 : (x + y * 2) % 9 === 0 ? '#4a6a8a' : PAL.blue2;
    if (ch === 'b') col = (x % 6) === 0 ? PAL.wood1 : n > 0.8 ? PAL.wood4 : PAL.wood3;
    if (ch === '=') {
      const tie = (x % 6) < 3;
      const ry = y - y0 + (cy % 2 ? 6 : 0); // track spans 2 rows (12px): rails at 3 and 8
      col = tie ? '#5a3a22' : '#6a5a3a';
      if (ry === 3 || ry === 8) col = PAL.metal3; else if (ry === 4 || ry === 9) col = PAL.metal1;
    }
    if (isSlope(ch)) {
      col = n > 0.8 ? '#7a5c3a' : p.slope;
      // chevrons pointing downhill
      const lx = x - x0, ly = y - y0;
      const [u, v] = ch === '^' ? [lx, 5 - ly] : ch === 'v' ? [lx, ly] : ch === '<' ? [ly, 5 - lx] : [ly, lx];
      const d = Math.abs(u - 2.5) - 0.5;
      if (v === 3 - d || v === 2 - d) col = '#3e2a18';
      if (course.theme === 'canyon' && n < 0.06) col = '#6a4a2a';
    }
    fill(c, col, x, y);
  }
}

function drawWall(c: Ctx, course: Course, p: Pal, cx: number, cy: number) {
  const x0 = cx * T, y0 = cy * T;
  const fl = (dx: number, dy: number) => { const X = cx + dx, Y = cy + dy; return X >= 0 && Y >= 0 && X < COLS && Y < ROWS && FLOOR.has(course.grid[Y][X]); };
  for (let y = y0; y < y0 + T; y++) for (let x = x0; x < x0 + T; x++) {
    const n = rnd(x, y, 11);
    let col = p.wall;
    if (course.theme === 'canyon' || course.theme === 'mine') col = n > 0.7 ? p.wallHi : n < 0.25 ? p.wallLo : p.wall;
    else if (course.theme === 'grave') col = (x % 4 === 0) ? p.wallLo : n > 0.8 ? p.wallHi : p.wall; // fence pickets
    else col = (y - y0) === 0 ? p.wallHi : n > 0.9 ? p.wallLo : p.wall;
    fill(c, col, x, y);
  }
  // bevels toward the fairway
  if (fl(0, 1)) fill(c, p.wallLo, x0, y0 + T - 1, T, 1);
  if (fl(0, -1)) fill(c, p.wallHi, x0, y0, T, 1);
  if (fl(1, 0)) fill(c, p.wallLo, x0 + T - 1, y0, 1, T);
  if (fl(-1, 0)) fill(c, p.wallHi, x0, y0, 1, T);
  if (course.theme === 'mine' && (cx + cy * 3) % 7 === 0) { fill(c, PAL.wood3, x0 + 2, y0, 2, T); }
}

function drawCirc(c: Ctx, o: Course['circles'][number]) {
  const { x, y, r } = o;
  if (o.kind === 'table') {
    disc(c, x + 1, y + 2, r, 'rgba(0,0,0,.35)');
    disc(c, x, y, r, PAL.wood1); disc(c, x, y, r - 1, PAL.wood3); disc(c, x - 1, y - 1, r - 3, PAL.wood4);
    fill(c, PAL.parch, x - 2, y - 1, 3, 2); fill(c, PAL.red1, x + 1, y + 1, 2, 3); fill(c, PAL.lamp0, x + 2, y - 3, 1, 2);
  } else if (o.kind === 'cactus') {
    disc(c, x + 1, y + 2, r, 'rgba(0,0,0,.3)');
    disc(c, x, y, r, '#2a4a1a'); disc(c, x, y, r - 1, '#3f6a2a'); fill(c, '#6a9a3a', x - 1, y - 2, 1, 3);
    fill(c, '#3f6a2a', x - r - 2, y - 1, 2, 2); fill(c, '#3f6a2a', x + r, y, 2, 2); fill(c, PAL.parch, x, y - 1, 1, 1); fill(c, '#e05a7a', x + 1, y - 3, 1, 1);
  } else if (o.kind === 'rock') {
    disc(c, x + 1, y + 1, r, 'rgba(0,0,0,.35)');
    disc(c, x, y, r, PAL.metal1); disc(c, x - 0.5, y - 0.5, r - 1, '#6a5a4a'); fill(c, '#9a8a72', x - 2, y - 2, 2, 1);
  } else if (o.kind === 'barrel') {
    disc(c, x + 1, y + 1, r, 'rgba(0,0,0,.35)');
    disc(c, x, y, r, PAL.wood1); disc(c, x, y, r - 1, PAL.wood3); fill(c, PAL.metal2, x - r + 1, y, r * 2 - 1, 1); fill(c, PAL.wood4, x - 1, y - 2, 2, 1);
  } else {
    // bumper: brass ring, red cap (flash drawn dynamically)
    disc(c, x + 1, y + 1, r, 'rgba(0,0,0,.4)');
    disc(c, x, y, r, PAL.lamp3); disc(c, x, y, r - 1, PAL.red1); fill(c, '#ff6a50', x - 1, y - 2, 2, 1);
  }
}

function drawBox(c: Ctx, b: { x: number; y: number; w: number; h: number }, kind: string) {
  const x = Math.round(b.x), y = Math.round(b.y), w = b.w, h = b.h;
  if (kind === 'chair') { fill(c, PAL.wood1, x, y, w, h); fill(c, PAL.wood4, x, y, w - 1, h - 1); fill(c, PAL.wood3, x + 1, y + 1, w - 2, h - 2); }
  else if (kind === 'bar') {
    fill(c, 'rgba(0,0,0,.35)', x + 1, y + 2, w, h);
    fill(c, PAL.wood1, x, y, w, h); fill(c, PAL.wood3, x, y, w, h - 2); fill(c, PAL.wood4, x, y, w, 1); fill(c, PAL.lamp3, x, y + h - 2, w, 1);
    for (let i = 3; i < w - 2; i += 7) { fill(c, '#6a2f12', i + x, y + 2, 2, 3); fill(c, PAL.lamp0, i + x, y + 2, 1, 1); }
  } else if (kind === 'door') {
    fill(c, PAL.ink, x, y, w, h); fill(c, PAL.wood4, x, y, w, h - 1);
    for (let i = 1; i < w; i += 2) fill(c, PAL.wood3, x + i, y, 1, h - 1);
    fill(c, PAL.lamp3, x, y, 1, h); fill(c, PAL.lamp3, x + w - 1, y, 1, h);
  } else if (kind === 'cart') {
    fill(c, 'rgba(0,0,0,.4)', x + 1, y + 2, w, h);
    fill(c, PAL.metal0, x, y, w, h); fill(c, PAL.metal2, x + 1, y + 1, w - 2, h - 2); fill(c, PAL.metal1, x + 2, y + 2, w - 4, h - 4);
    for (let i = 3; i < w - 3; i += 3) { fill(c, '#e8c050', x + i, y + 3, 2, 2); fill(c, '#a8802a', x + i + 1, y + 5, 2, 2); }
    fill(c, PAL.metal4, x + 1, y + 1, w - 2, 1);
  } else if (kind === 'trough') {
    fill(c, 'rgba(0,0,0,.35)', x + 1, y + 2, w, h);
    fill(c, PAL.wood1, x, y, w, h); fill(c, PAL.wood4, x, y, w, 1); fill(c, PAL.blue2, x + 1, y + 1, w - 2, h - 2); fill(c, PAL.blue3, x + 3, y + 2, 4, 1);
  } else if (kind === 'stone') {
    fill(c, 'rgba(0,0,0,.45)', x + 1, y + 2, w, h);
    fill(c, PAL.metal1, x, y + 1, w, h - 1); fill(c, PAL.metal1, x + 1, y, w - 2, 1);
    fill(c, PAL.metal3, x + 1, y + 1, w - 2, h - 2); fill(c, PAL.metal4, x + 1, y + 1, 1, h - 3);
    fill(c, PAL.metal1, x + 2, y + 2, 1, 3); fill(c, PAL.metal1, x + 1, y + 3, 3, 1);
  } else {
    fill(c, PAL.wood1, x, y, w, h); fill(c, PAL.wood4, x + 1, y + 1, w - 2, h - 2); fill(c, PAL.wood1, x + 1, y + 1, w - 2, 1);
    for (let i = 0; i < w - 2; i++) fill(c, PAL.wood1, x + 1 + i, y + 1 + Math.round((i * (h - 3)) / (w - 3)), 1, 1);
  }
}

/** the static course: backdrop, fairway, walls, scenery, cup, tee */
export function drawCourseBg(course: Course): HTMLCanvasElement {
  const [cv, c] = makeCanvas(W, H);
  const p = THEMES[course.theme];
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    const ch = course.grid[cy][cx];
    if (FLOOR.has(ch)) drawFloor(c, course, p, ch, cx, cy);
    else {
      let near = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X >= 0 && Y >= 0 && X < COLS && Y < ROWS && FLOOR.has(course.grid[Y][X])) near = true;
      }
      if (near) drawWall(c, course, p, cx, cy); else drawBackdrop(c, course.theme, p, cx * T, cy * T);
    }
  }
  // wall drop shadows on the fairway (below / right of a wall)
  c.fillStyle = 'rgba(0,0,0,.28)';
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    if (!FLOOR.has(course.grid[cy][cx])) continue;
    if (cy > 0 && !FLOOR.has(course.grid[cy - 1][cx])) c.fillRect(cx * T, cy * T, T, 2);
    if (cx > 0 && !FLOOR.has(course.grid[cy][cx - 1])) c.fillRect(cx * T, cy * T, 1, T);
  }
  // railroad: rails continue through the tunnel mouths in the walls
  for (const r of course.tracks ?? []) {
    for (const cx of [0, 1, COLS - 2, COLS - 1]) { drawFloor(c, course, p, '=', cx, r); drawFloor(c, course, p, '=', cx, r + 1); }
    fill(c, PAL.ink, 0, r * T - 1, 12, 1); fill(c, PAL.ink, W - 12, r * T - 1, 12, 1);
    fill(c, 'rgba(0,0,0,.5)', 0, r * T, 3, 12); fill(c, 'rgba(0,0,0,.5)', W - 3, r * T, 3, 12);
  }
  // scenery
  for (const o of course.circles) drawCirc(c, o);
  for (const b of course.boxes) if (!b.move) drawBox(c, b, b.kind);
  // tunnels: mine-shaft mouth (A) and exit (B)
  for (const tn of course.tunnels) {
    for (const [x, y, big] of [[tn.ax, tn.ay, 1], [tn.bx, tn.by, 0]] as const) {
      disc(c, x, y, big ? 5 : 4, PAL.wood3); disc(c, x, y, big ? 4 : 3, PAL.ink); fill(c, PAL.wood4, x - (big ? 5 : 4), y - 1, 1, 3); fill(c, PAL.wood4, x + (big ? 5 : 4), y - 1, 1, 3);
    }
  }
  // tee mat
  const [tx, ty] = course.tee;
  fill(c, '#1e3016', tx - 5, ty - 4, 11, 9); fill(c, '#5a8a3a', tx - 4, ty - 3, 9, 7); fill(c, '#4a7a30', tx - 4, ty + 3, 9, 1);
  fill(c, PAL.parch, tx - 4, ty - 3, 1, 1); fill(c, PAL.parch, tx + 4, ty - 3, 1, 1);
  // green ring around the cup + cup
  const [hx, hy] = course.hole;
  for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
    const d = Math.hypot(x, y);
    const ch = course.grid[Math.floor((hy + y) / T)]?.[Math.floor((hx + x) / T)];
    if (d < 8 && (ch === '.' || ch === ',') && (d < 6.5 || bayer(hx + x, hy + y) > 0.5)) fill(c, (Math.floor((hy + y) / 3) % 2) ? '#5a8a3a' : '#548234', hx + x, hy + y);
  }
  disc(c, hx, hy, CUP_R + 0.4, '#1a2410');
  disc(c, hx, hy, CUP_R - 0.2, PAL.ink);
  fill(c, '#2a2a2a', hx - 2, hy + 2, 4, 1);
  return cv;
}

/** moving obstacles, water shimmer, bumper flashes, flag (course space) */
export function drawDynamic(c: Ctx, course: Course, t: number, flash: number[]) {
  // water shimmer
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    if (course.grid[cy][cx] !== 'w') continue;
    const k = Math.floor(t * 3 + rnd(cx, cy, 5) * 9) % 6;
    fill(c, PAL.blue3, cx * T + k, cy * T + ((cx * 5 + cy) % 5), 2, 1);
  }
  for (const b of course.boxes) if (b.move) drawBox(c, boxAt(b, t), b.kind);
  course.circles.forEach((o, i) => {
    if (o.kind === 'bumper' && flash[i] > 0) { disc(c, o.x, o.y, o.r, PAL.lamp0); disc(c, o.x, o.y, o.r - 2, PAL.lamp1); }
  });
}

/** flag on a pole planted in the cup (display space, upright) */
export function drawFlag(c: Ctx, hx: number, hy: number, t: number) {
  hx = Math.round(hx); hy = Math.round(hy);
  fill(c, 'rgba(0,0,0,.35)', hx + 1, hy - 1, 6, 1);
  fill(c, PAL.parch2, hx, hy - 12, 1, 12);
  const wv = Math.floor(t * 4) % 2;
  fill(c, PAL.red1, hx + 1, hy - 12, 5, 3); fill(c, '#d0302a', hx + 1, hy - 12, 4 + wv, 2); fill(c, PAL.red2, hx + 5, hy - 10 + wv, 1, 1);
}

const BALL = ['.##.', '####', '####', '.##.'];
export function drawBall(c: Ctx, x: number, y: number, col: string, hi: string, alpha = 1, lift = 0) {
  const X = Math.round(x) - 2, Y = Math.round(y) - 2;
  c.globalAlpha = alpha * 0.5;
  c.fillStyle = PAL.ink;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (BALL[j][i] === '#') c.fillRect(X + i + 1, Y + j + 1, 1, 1);
  c.globalAlpha = alpha;
  const Yl = Y - Math.round(lift);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (BALL[j][i] === '#') { c.fillStyle = col; c.fillRect(X + i, Yl + j, 1, 1); }
  c.fillStyle = hi; c.fillRect(X + 1, Yl + 1, 1, 1);
  c.globalAlpha = 1;
}
