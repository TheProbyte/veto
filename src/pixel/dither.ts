/** Ordered (Bayer) dithering helpers. */
export const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((v) => (v + 0.5) / 16);

export const bayer = (x: number, y: number) => BAYER4[(y & 3) * 4 + (x & 3)];

type Ctx = CanvasRenderingContext2D;

export function px(c: Ctx, x: number, y: number, col: string, w = 1, h = 1) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

/** fill a rect with `col` where intensity(x,y) beats the Bayer threshold */
export function ditherRect(c: Ctx, x0: number, y0: number, w: number, h: number, col: string, intensity: (x: number, y: number) => number) {
  c.fillStyle = col;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (intensity(x, y) > bayer(x, y)) c.fillRect(x, y, 1, 1);
  }
}

/** vertical gradient between bands of palette colors with dithered transitions */
export function ditherBands(c: Ctx, x0: number, y0: number, w: number, h: number, cols: string[]) {
  const n = cols.length - 1;
  for (let y = 0; y < h; y++) {
    const f = (y / Math.max(1, h - 1)) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    for (let x = 0; x < w; x++) {
      c.fillStyle = t > bayer(x0 + x, y0 + y) ? cols[i + 1] : cols[i];
      c.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

/** filled ellipse via row spans (pixel-exact) */
export function ellipse(c: Ctx, cx: number, cy: number, rx: number, ry: number, col: string) {
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const k = 1 - (y * y) / (ry * ry + 0.0001);
    if (k < 0) continue;
    const hw = Math.round(rx * Math.sqrt(k));
    c.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2 + 1, 1);
  }
}

export function circle(c: Ctx, cx: number, cy: number, r: number, col: string) { ellipse(c, cx, cy, r, r, col); }

/** 1px line (Bresenham) */
export function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  c.fillStyle = col;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 2000; i++) {
    c.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w); cv.height = Math.max(1, h);
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  return [cv, c];
}
