/**
 * Steam art -> real pixel art.
 * box-filter downsample -> contrast/saturation boost -> median-cut palette (from the image, nudged toward
 * the saloon palette) -> ordered Bayer 4x4 dither -> dark edge outline. Results are cached per
 * appid+kind+size, as both a tiny canvas and a PNG data URL, so repeat renders are free.
 * Loads go through the same-origin CORS proxy (pxArt) so getImageData is allowed.
 */
import { pxArt } from '../../shared/types';
import { PAL, hexRgb } from './palette';
import { BAYER4 } from './dither';

export type CoverKind = 'box' | 'header' | 'square';
export interface Pixelized { cv: HTMLCanvasElement; url: string; src: 'box' | 'header' }

/** default target grids (art pixels) */
export const GRID: Record<CoverKind, [number, number]> = { box: [36, 54], header: [64, 30], square: [48, 48] };

const cache = new Map<string, Promise<Pixelized | null>>();
const done = new Map<string, Pixelized | null>();

/** synchronous peek (lets components paint a cached cover on first render with no flash) */
export function peekPixelized(appid: number, kind: CoverKind, w?: number, h?: number): Pixelized | null | undefined {
  const [gw, gh] = [w ?? GRID[kind][0], h ?? GRID[kind][1]];
  return done.get(`${appid}|${kind}|${gw}x${gh}`);
}

export function pixelize(appid: number, kind: CoverKind, w?: number, h?: number): Promise<Pixelized | null> {
  const gw = Math.max(4, Math.round(w ?? GRID[kind][0])), gh = Math.max(4, Math.round(h ?? GRID[kind][1]));
  const key = `${appid}|${kind}|${gw}x${gh}`;
  let p = cache.get(key);
  if (!p) {
    p = run(async () => {
      const order: ('box' | 'header')[] = kind === 'header' ? ['header', 'box'] : ['box', 'header'];
      for (const src of order) {
        const img = await loadImg(pxArt(appid, src));
        if (!img) continue;
        await idle();
        try {
          const cv = processImage(img, gw, gh, kind === 'header' ? 1.1 : 1.15);
          return { cv, url: cv.toDataURL('image/png'), src };
        } catch (e) { console.warn('pixelize', appid, e); }
      }
      return null;
    }).then((r) => { done.set(key, r); return r; });
    cache.set(key, p);
  }
  return p;
}

/* ---------- scheduling: at most 3 loads/processes at once, heavy step in idle time ---------- */

const MAX_ACTIVE = 3;
let active = 0;
const queue: (() => void)[] = [];
function run<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((res, rej) => {
    const go = () => {
      active++;
      job().then(res, rej).finally(() => { active--; const n = queue.shift(); if (n) n(); });
    };
    if (active < MAX_ACTIVE) go(); else queue.push(go);
  });
}
const idle = () => new Promise<void>((r) => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(() => r(), { timeout: 300 }); else setTimeout(r, 16);
});

function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => res(im.naturalWidth > 1 ? im : null);
    im.onerror = () => res(null);
    im.src = url;
  });
}

/* ---------- the processor ---------- */

const SALOON = [PAL.ink, PAL.wood1, PAL.wood2, PAL.wood3, PAL.wood4, PAL.lamp0, PAL.lamp1, PAL.lamp2, PAL.lamp3, PAL.red1, PAL.red2,
  PAL.parch, PAL.parch2, PAL.parch3, PAL.blue0, PAL.blue1, PAL.blue2, PAL.blue3, PAL.moon, PAL.skin1, PAL.skin2, PAL.skin3,
  PAL.felt1, PAL.felt2, PAL.felt3, PAL.metal1, PAL.metal2, PAL.metal3, PAL.metal4, PAL.white].map(hexRgb);

export function processImage(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength },
  gw: number, gh: number, sat = 1.15, colours = 13): HTMLCanvasElement {
  const iw = (img.naturalWidth || (img.width as number)) || 1, ih = (img.naturalHeight || (img.height as number)) || 1;
  // cover-crop to the grid aspect (biased slightly up: titles/logos tend to sit high on box art)
  const ta = gw / gh, ia = iw / ih;
  let sw = iw, sh = ih, sx = 0, sy = 0;
  if (ia > ta) { sw = ih * ta; sx = (iw - sw) / 2; } else { sh = iw / ta; sy = (ih - sh) * 0.4; }
  // 1) box-filter downsample: draw at k x grid, then average k*k blocks
  const k = Math.max(1, Math.min(6, Math.floor(Math.min(sw / gw, sh / gh))));
  const tw = gw * k, th = gh * k;
  const tmp = document.createElement('canvas');
  tmp.width = tw; tmp.height = th;
  const tc = tmp.getContext('2d', { willReadFrequently: true })!;
  tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
  tc.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
  const src = tc.getImageData(0, 0, tw, th).data;
  const N = gw * gh;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const kk = k * k;
  let meanL = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < k; yy++) {
      let o = ((y * k + yy) * tw + x * k) * 4;
      for (let xx = 0; xx < k; xx++, o += 4) { r += src[o]; g += src[o + 1]; b += src[o + 2]; }
    }
    const i = y * gw + x;
    R[i] = r / kk; G[i] = g / kk; B[i] = b / kk;
    meanL += 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
  }
  meanL /= N;
  // 2) contrast + saturation boost, slight warm cast
  for (let i = 0; i < N; i++) {
    const l = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    const f = (v: number) => {
      const s = l + (v - l) * sat;
      return Math.max(0, Math.min(255, (s - meanL) * 1.12 + meanL));
    };
    R[i] = Math.min(255, f(R[i]) * 1.03); G[i] = f(G[i]); B[i] = f(B[i]) * 0.96;
  }
  // 3) palette from the image itself (median cut), nudged toward the saloon palette
  const pal = medianCut(R, G, B, colours).map((c) => {
    let best = SALOON[0], bd = 1e9;
    for (const s of SALOON) { const d = dist(c, s); if (d < bd) { bd = d; best = s; } }
    const t = 0.16;
    return [c[0] + (best[0] - c[0]) * t, c[1] + (best[1] - c[1]) * t, c[2] + (best[2] - c[2]) * t] as Col;
  });
  // ensure there's a proper dark for outlines
  pal.push(darkest(pal).map((v) => v * 0.45) as Col);
  // 4) ordered dither: Bayer offset, then nearest palette colour
  const spread = 34;
  const q = new Uint8Array(N);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x;
    const o = (BAYER4[(y & 3) * 4 + (x & 3)] - 0.5) * spread;
    q[i] = nearest(pal, R[i] + o, G[i] + o, B[i] + o);
  }
  // 5) edge darkening: the darker side of a strong edge gets an outline pixel
  const lum = pal.map((c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  const out = new Uint8Array(q);
  const dk = pal.length - 1;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x, l = lum[q[i]];
    let mx = 0;
    if (x + 1 < gw) mx = Math.max(mx, lum[q[i + 1]] - l);
    if (y + 1 < gh) mx = Math.max(mx, lum[q[i + gw]] - l);
    if (x > 0) mx = Math.max(mx, lum[q[i - 1]] - l);
    if (y > 0) mx = Math.max(mx, lum[q[i - gw]] - l);
    if (mx > 95 && l < 110) out[i] = dk;
    else if (mx > 70) { const c = pal[q[i]]; out[i] = nearest(pal, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6); }
  }
  const cv = document.createElement('canvas');
  cv.width = gw; cv.height = gh;
  const c = cv.getContext('2d')!;
  const id = c.createImageData(gw, gh);
  for (let i = 0; i < N; i++) {
    const col = pal[out[i]];
    // 1px darkened rim around the whole cover
    const x = i % gw, y = (i / gw) | 0;
    const e = x === 0 || y === 0 || x === gw - 1 || y === gh - 1 ? 0.62 : 1;
    id.data[i * 4] = col[0] * e; id.data[i * 4 + 1] = col[1] * e; id.data[i * 4 + 2] = col[2] * e; id.data[i * 4 + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  return cv;
}

type Col = [number, number, number];
const dist = (a: Col | number[], b: Col | number[]) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; // perceptual-ish weights
};
function nearest(pal: Col[], r: number, g: number, b: number) {
  let bi = 0, bd = 1e12;
  for (let j = 0; j < pal.length; j++) {
    const p = pal[j], dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bd) { bd = d; bi = j; }
  }
  return bi;
}
const darkest = (pal: Col[]) => pal.reduce((a, c) => (c[0] + c[1] + c[2] < a[0] + a[1] + a[2] ? c : a), pal[0]);

function medianCut(R: Float32Array, G: Float32Array, B: Float32Array, n: number): Col[] {
  const ch = [R, G, B];
  const all = Array.from({ length: R.length }, (_, i) => i);
  type Box = { ix: number[]; range: number; c: number };
  const mk = (ix: number[]): Box => {
    let best = 0, bc = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const i of ix) { const v = ch[c][i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      // weight green higher (perceptual), so splits follow what the eye sees
      const r = (hi - lo) * (c === 1 ? 1.2 : 1);
      if (r > best) { best = r; bc = c; }
    }
    return { ix, range: best * Math.sqrt(ix.length), c: bc };
  };
  const boxes: Box[] = [mk(all)];
  while (boxes.length < n) {
    let bi = -1, br = 0;
    boxes.forEach((b, i) => { if (b.ix.length > 1 && b.range > br) { br = b.range; bi = i; } });
    if (bi < 0 || br < 4) break;
    const b = boxes[bi];
    const arr = ch[b.c];
    const s = b.ix.slice().sort((x, y) => arr[x] - arr[y]);
    const m = s.length >> 1;
    boxes.splice(bi, 1, mk(s.slice(0, m)), mk(s.slice(m)));
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bb = 0;
    for (const i of b.ix) { r += R[i]; g += G[i]; bb += B[i]; }
    const k = b.ix.length || 1;
    return [r / k, g / k, bb / k] as Col;
  });
}
