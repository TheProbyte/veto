// Small pixel helpers shared by the lobby target practice and the group photo.
import { PAL } from '../pixel/palette';
import { makeCanvas } from '../pixel/dither';
import type { DrawFn } from '../pixel/sprites';

type Ctx = CanvasRenderingContext2D;

/** ASCII sprite -> canvas with an automatic 1px ink outline. '.' = empty, any other char maps through `cols`. */
export function spriteFrom(rows: string[], cols: Record<string, string>, outline: string | null = PAL.ink): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const o = outline ? 1 : 0;
  const [cv, c] = makeCanvas(w + o * 2, h + o * 2);
  const solid = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && (rows[y][x] ?? '.') !== '.';
  if (outline) {
    c.fillStyle = outline;
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (solid(x, y)) continue;
      if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1)) c.fillRect(x + o, y + o, 1, 1);
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x] ?? '.';
    if (ch === '.') continue;
    c.fillStyle = cols[ch] ?? '#f0f';
    c.fillRect(x + o, y + o, 1, 1);
  }
  return cv;
}

const iconFrom = (rows: string[], cols: Record<string, string>): DrawFn => {
  let cv: HTMLCanvasElement | null = null;
  return (c: Ctx) => { cv ??= spriteFrom(rows, cols); c.drawImage(cv, 0, 0); };
};

/** 13x13 bullseye target (button icon) */
export const TARGET_ICON = { w: 13, h: 13, draw: iconFrom([
  '...rrrrr...',
  '..rwwwwwr..',
  '.rwwrrrwwr.',
  'rwwrwwwrwwr',
  'rwrwwrwwrwr',
  'rwrwrrrwrwr',
  'rwrwwrwwrwr',
  'rwwrwwwrwwr',
  '.rwwrrrwwr.',
  '..rwwwwwr..',
  '...rrrrr...',
], { r: '#c0281f', w: PAL.parch }) };

/** 15x12 box camera (button icon) */
export const CAMERA_ICON = { w: 15, h: 12, draw: iconFrom([
  '..mmm........',
  '.mkkkm..ddd..',
  'dddddddddddd.',
  'dlllllllllldd',
  'dlllggggglldd',
  'dllgkwwkkglld',
  'dllgkwkkkglld',
  'dllgkkkkkglld',
  'dlllggggglldd',
  'ddddddddddddd',
], { m: PAL.metal3, k: PAL.ink, d: PAL.wood1, l: PAL.wood4, g: PAL.metal4, w: PAL.white }) };

/** keep only crisp alpha (binarize) so canvas text reads as pixel text */
export function hardAlpha(c: Ctx, w: number, h: number, cut = 110) {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= cut ? 255 : 0;
  c.putImageData(img, 0, 0);
}

/** wait (briefly) for the pixel fonts so canvas text uses them; never blocks for long */
export function fontsReady(ms = 900): Promise<void> {
  const f = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!f) return Promise.resolve();
  const load = Promise.all([f.load('16px "Silkscreen"'), f.load('700 16px "Silkscreen"'), f.load('16px "Pixelify Sans"')]).then(() => undefined, () => undefined);
  return Promise.race([load, new Promise<void>((r) => setTimeout(r, ms))]);
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
