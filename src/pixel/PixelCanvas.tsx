import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { PAL, hashStr, rnd } from './palette';
import { bayer, makeCanvas, px } from './dither';
import { computeLayout, SceneRenderer, type CatAct, type Layout, type SceneData } from './scene';
import { drawCrack, holeAt, type DrawFn } from './sprites';
import { peekPixelized, pixelize, type Pixelized } from './pixelize';
import './pixel.css';

/* ================= viewport layout ================= */

export function usePixelLayout(): Layout {
  const [L, setL] = useState(() => computeLayout(window.innerWidth, window.innerHeight));
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const n = computeLayout(window.innerWidth, window.innerHeight);
      setL((o) => (o.W === n.W && o.H === n.H && o.P === n.P ? o : n));
    }); };
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);
  return L;
}

/* ================= main scene canvas ================= */

const FPS = 13;
const FPS_LOW = 10;

/** Narrow or weak devices get a slower loop and fewer dust motes. Evaluated once per mount. */
export function motionProfile() {
  const mq = (q: string) => { try { return !!window.matchMedia?.(q).matches; } catch { return false; } };
  const reduce = mq('(prefers-reduced-motion: reduce)');
  const cores = navigator.hardwareConcurrency || 8;
  const low = window.innerWidth < 600 || cores <= 4;
  return { reduce, low, fps: reduce ? 4 : low ? FPS_LOW : FPS, motes: reduce ? 6 : low ? 17 : 34 };
}

/** hit-testing the live scene from screen (client) coordinates: the shelf cat */
export interface SceneApi {
  /** is the shelf cat (visible, not behind a bust) under this point? */
  catAt(clientX: number, clientY: number): boolean;
  /** tap the cat: starts its next reaction (null = missed / it's busy) */
  pokeCat(clientX: number, clientY: number, touch?: boolean): CatAct | null;
}

/** One canvas, its own rAF loop (~10-13fps). Scene data is read from a ref, so React never re-renders per frame. Pauses while the tab is hidden. */
export function PixelScene({ layout, data, api }: { layout: Layout; data: SceneData; api?: MutableRefObject<SceneApi | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || layout.W < 1 || layout.H < 1) return;
    cv.width = layout.W; cv.height = layout.H;
    const c = cv.getContext('2d', { willReadFrequently: true });
    if (!c) return;
    c.imageSmoothingEnabled = false;
    const prof = motionProfile();
    let r: SceneRenderer | null = null;
    try { r = new SceneRenderer(layout, { motes: prof.motes, reduce: prof.reduce, low: prof.low }); } catch (e) { console.error(e); return; }
    let raf = 0, last = 0, dead = false;
    const step = 1000 / prof.fps;
    const tick = (t: number) => {
      raf = 0;
      if (dead || document.hidden) return;
      raf = requestAnimationFrame(tick);
      if (t - last < step) return;
      last = t;
      try { r!.frame(c, t, dataRef.current); } catch (e) { console.error(e); dead = true; }
    };
    const start = () => { if (!raf && !dead && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); } };
    // screen -> scene pixels; a finger gets a bigger target than a mouse
    const toScene = (x: number, y: number) => {
      const b = cv.getBoundingClientRect();
      return { sx: ((x - b.left) * layout.W) / Math.max(1, b.width), sy: ((y - b.top) * layout.H) / Math.max(1, b.height) };
    };
    const pad = (touch: boolean) => Math.max(2, Math.ceil((touch ? 14 : 6) / layout.P));
    if (api) api.current = {
      catAt: (x, y) => { if (dead || !r) return false; const p = toScene(x, y); return r.catHit(p.sx, p.sy, pad(false)); },
      pokeCat: (x, y, touch) => { if (dead || !r) return null; const p = toScene(x, y); return r.pokeCat(p.sx, p.sy, pad(!!touch)); },
    };
    const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start(); };
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => { dead = true; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); if (api) api.current = null; };
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const style: CSSProperties = { width: layout.W * layout.P, height: layout.H * layout.P };
  return <canvas ref={ref} className="px-scene" style={style} aria-hidden />;
}

/* ================= tiny static sprites ================= */

export const PixelSprite = memo(function PixelSprite({ draw, w, h, className = '', style }: { draw: DrawFn; w: number; h: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current; if (!cv) return;
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); if (!c) return;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, w, h);
    draw(c, w, h);
  }, [draw, w, h]);
  return <canvas ref={ref} className={`px-sprite ${className}`} style={style} aria-hidden />;
});

/* ================= box art ================= */

function frameBox(c: CanvasRenderingContext2D, w: number, h: number) {
  // case edges + highlight
  c.fillStyle = 'rgba(255,240,210,.35)'; c.fillRect(1, 1, w - 2, 1); c.fillRect(1, 1, 1, h - 2);
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(w - 2, 1, 1, h - 2); c.fillRect(1, h - 2, w - 2, 1);
  c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(2, 2, 1, h - 4); // spine crease
  c.fillStyle = PAL.ink;
  c.fillRect(0, 0, w, 1); c.fillRect(0, h - 1, w, 1); c.fillRect(0, 0, 1, h); c.fillRect(w - 1, 0, 1, h);
  c.clearRect(0, 0, 1, 1); c.clearRect(w - 1, 0, 1, 1); c.clearRect(0, h - 1, 1, 1); c.clearRect(w - 1, h - 1, 1, 1);
}

function placeholder(c: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / h;
    const col = v + (rnd(x, y, seed) - 0.5) * 0.2 > 0.4 + bayer(x, y) * 0.4 ? PAL.wood1 : PAL.wood2;
    px(c, x, y, col);
  }
  c.fillStyle = PAL.lamp3; c.fillRect(3, 3, w - 6, 1); c.fillRect(3, h - 4, w - 6, 1);
}

/** Steam box art downsampled to a tiny canvas and upscaled with nearest-neighbour. */
export const PixelArt = memo(function PixelArt({ appid, name, w = 36, h = 54, className = '', holes = 0, cracked = false, style }: {
  appid: number; name: string; w?: number; h?: number; className?: string; holes?: number; cracked?: boolean; style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); if (!c) return;
    let alive = true;
    const seed = hashStr(String(appid)) % 997;
    const finish = () => {
      // light dithered shade at the very bottom (sits on the table)
      for (let y = Math.floor(h * 0.8); y < h; y++) for (let x = 0; x < w; x++) {
        if (((y - h * 0.8) / (h * 0.2)) * 0.5 > bayer(x, y) + 0.2) { c.fillStyle = 'rgba(11,7,5,.45)'; c.fillRect(x, y, 1, 1); }
      }
      for (let k = 0; k < holes; k++) {
        const hx = 6 + Math.floor(rnd(seed, k, 3) * (w - 12)), hy = 8 + Math.floor(rnd(seed, k, 4) * (h - 16));
        holeAt(c, hx, hy);
      }
      if (cracked) drawCrack(c, w, h);
      frameBox(c, w, h);
    };
    c.imageSmoothingEnabled = false;
    const paint = (a: Pixelized | null | undefined) => {
      c.clearRect(0, 0, w, h);
      if (!a) { placeholder(c, w, h, seed); setMissing(a === null); finish(); return; }
      c.drawImage(a.cv, 0, 0, w, h);
      setMissing(false);
      finish();
    };
    const hit = peekPixelized(appid, 'box', w, h);
    paint(hit);
    if (hit !== undefined) return () => { alive = false; };
    const go = () => pixelize(appid, 'box', w, h).then((a) => { if (alive) paint(a); });
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'undefined' || !cv.parentElement) go();
    else {
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io?.disconnect(); go(); } }, { rootMargin: '200px' });
      io.observe(cv.parentElement);
    }
    return () => { alive = false; io?.disconnect(); };
  }, [appid, w, h, holes, cracked]);
  return (
    <div className={`pxart pxart-v2 ${className}`} style={style}>
      <canvas ref={ref} aria-label={name} role="img" />
      {missing && <span className="pxart-name">{name}</span>}
    </div>
  );
});

/* ================= textured pixel panel backgrounds ================= */

export type PanelKind = 'paper' | 'wood' | 'metal';

function paintPanel(c: CanvasRenderingContext2D, w: number, h: number, kind: PanelKind) {
  if (kind === 'paper') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const e = Math.min(x, w - 1 - x, y, h - 1 - y);
      // torn stepped edge
      const tear = Math.floor(rnd(x + y * 3, 0, 41) * 3);
      if (e < tear - 1) continue;
      const stain = Math.sin(x * 0.09 + 1) * Math.cos(y * 0.07) * 0.5 + 0.5;
      const burn = Math.max(0, 1 - e / 7);
      const n = rnd(x, y, 42);
      let col: string = PAL.parch;
      if (burn * 1.2 > bayer(x, y) + 0.15) col = burn > 0.75 ? PAL.parch3 : PAL.parch2;
      else if (stain > 0.72 + bayer(x, y) * 0.25) col = PAL.parch2;
      else if (n > 0.985) col = PAL.parch3;
      px(c, x, y, col);
    }
    // nails
    for (const [nx, ny] of [[4, 4], [w - 6, 4], [4, h - 6], [w - 6, h - 6]]) {
      c.fillStyle = PAL.metal1; c.fillRect(nx, ny, 3, 3);
      c.fillStyle = PAL.metal3; c.fillRect(nx, ny, 2, 2);
      c.fillStyle = PAL.metal4; c.fillRect(nx, ny, 1, 1);
      c.fillStyle = 'rgba(42,26,16,.5)'; c.fillRect(nx + 1, ny + 3, 3, 1);
    }
  } else if (kind === 'wood') {
    for (let y = 0; y < h; y++) {
      const plank = Math.floor(y / 7);
      for (let x = 0; x < w; x++) {
        const seam = y % 7 === 0;
        const g = rnd(Math.floor(x / 5) + plank * 31, plank, 43) > 0.8;
        px(c, x, y, seam ? PAL.ink : g ? PAL.wood1 : plank % 2 ? PAL.wood2 : '#33200f');
      }
    }
  } else {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (x + y) / (w + h);
      px(c, x, y, v + (bayer(x, y) - 0.5) * 0.2 < 0.4 ? PAL.metal2 : PAL.metal1);
    }
  }
}

/** Fills its (positioned) parent with a pixel texture, re-painted on resize at a fixed pixel size. */
export function PixelPanel({ kind = 'paper', size = 4 }: { kind?: PanelKind; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const paint = () => {
      // layout size (ignores transforms, so a scaling entrance animation doesn't paint a tiny texture)
      const par = cv.parentElement as HTMLElement | null;
      if (!par) return;
      const box = { width: par.offsetWidth, height: par.offsetHeight };
      const w = Math.max(4, Math.ceil(box.width / size)), h = Math.max(4, Math.ceil(box.height / size));
      if (cv.width === w && cv.height === h) return;
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d'); if (!c) return;
      paintPanel(c, w, h, kind);
    };
    paint();
    const ro = new ResizeObserver(paint);
    if (cv.parentElement) ro.observe(cv.parentElement);
    return () => ro.disconnect();
  }, [kind, size]);
  return <canvas ref={ref} className="px-panel" aria-hidden />;
}

export { makeCanvas };
