// Pixel loading screen: a stagecoach rolling across a desert strip (canvas pixel art), label in pixel text, animated dots.
// `inline` renders a small strip for use inside panels (e.g. Nominate while the pool loads).
import { useEffect, useRef } from 'react';

const W = 96, H = 30; // canvas pixels (upscaled with image-rendering: pixelated)
const C = {
  sky0: '#2a1440', sky1: '#5a1f4a', sky2: '#a83a3a', sky3: '#e0702e', sun: '#ffd27a', mesa: '#4a1e2c', mesa2: '#6b2a2c',
  sand: '#c98a4a', sand2: '#a86a36', sand3: '#e3a862', ink: '#1a0c08', wood: '#7a4a22', wood2: '#5a3418', red: '#9e1b1b',
  brass: '#e0b050', horse: '#6a3a1e', horse2: '#4a2814', dust: '#e8c890', cactus: '#3c6a3a', cactus2: '#2a4a28', wheel: '#2a1608', win: '#ffcf7e',
};

function draw(c: CanvasRenderingContext2D, t: number, inline: boolean) {
  const r = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  // sky bands
  if (!inline) {
    r(0, 0, W, 5, C.sky0); r(0, 5, W, 4, C.sky1); r(0, 9, W, 4, C.sky2); r(0, 13, W, 5, C.sky3);
    r(66, 9, 8, 1, C.sun); r(64, 10, 12, 4, C.sun); r(65, 14, 10, 2, C.sun);
    // mesas (slow parallax)
    const m = -((t * 3) % W);
    for (const o of [m, m + W]) { r(o + 8, 12, 18, 6, C.mesa); r(o + 11, 10, 11, 2, C.mesa); r(o + 40, 14, 24, 4, C.mesa2); r(o + 44, 12, 14, 2, C.mesa2); r(o + 78, 13, 12, 5, C.mesa); }
  } else {
    c.clearRect(0, 0, W, 18);
  }
  // ground
  r(0, 18, W, 12, C.sand); r(0, 18, W, 1, C.sand3);
  const g = -((t * 26) % 16);
  for (let x = g; x < W; x += 16) { r(x + 2, 22, 3, 1, C.sand2); r(x + 10, 26, 2, 1, C.sand2); r(x + 6, 28, 4, 1, C.sand3); }
  // cacti / rocks (faster)
  const k = -((t * 26) % 64);
  for (const o of [k, k + 64]) {
    r(o + 20, 11, 3, 8, C.cactus); r(o + 17, 13, 2, 3, C.cactus); r(o + 17, 15, 3, 1, C.cactus); r(o + 24, 12, 2, 3, C.cactus); r(o + 22, 14, 3, 1, C.cactus); r(o + 22, 11, 1, 8, C.cactus2);
    r(o + 50, 17, 5, 2, C.sand2); r(o + 51, 16, 3, 1, C.sand2);
  }
  // the coach (fixed x, bobs)
  const f = Math.floor(t * 10) % 2; const b = f; const x0 = 30;
  // horses
  for (const hx of [x0 + 34, x0 + 25]) {
    r(hx, 12 + b, 7, 4, C.horse); r(hx + 6, 10 + b, 3, 3, C.horse); r(hx + 8, 11 + b, 2, 2, C.horse2); r(hx - 1, 12 + b, 1, 3, C.horse2);
    if (f) { r(hx, 16 + b, 1, 3, C.horse2); r(hx + 5, 16 + b, 1, 2, C.horse2); r(hx + 6, 18, 1, 1, C.horse2); r(hx + 2, 16 + b, 1, 2, C.horse2); }
    else { r(hx + 1, 16 + b, 1, 3, C.horse2); r(hx + 4, 16 + b, 1, 3, C.horse2); r(hx + 6, 16 + b, 1, 2, C.horse2); r(hx - 1, 17 + b, 1, 2, C.horse2); }
  }
  r(x0 + 22, 14 + b, 4, 1, C.wood2); // yoke
  // body
  r(x0, 6 + b, 20, 1, C.ink); r(x0 + 1, 5 + b, 18, 1, C.red); // roof
  r(x0 + 2, 3 + b, 14, 2, C.wood2); r(x0 + 3, 2 + b, 12, 1, C.brass); // luggage
  r(x0, 7 + b, 20, 8, C.wood); r(x0, 7 + b, 20, 1, C.brass); r(x0, 14 + b, 20, 1, C.wood2);
  r(x0 + 3, 8 + b, 5, 4, C.win); r(x0 + 11, 8 + b, 5, 4, C.win); r(x0 + 4, 9 + b, 3, 2, C.ink);
  r(x0 + 20, 9 + b, 3, 4, C.wood2); r(x0 + 21, 6 + b, 2, 3, C.ink); // driver box + driver
  r(x0 + 21, 5 + b, 3, 1, C.wood2);
  // wheels (spin: 2 frames)
  for (const wx of [x0 + 2, x0 + 14]) {
    r(wx, 15, 5, 5, C.wheel); r(wx + 1, 16, 3, 3, C.wood);
    if (f) { r(wx + 2, 15, 1, 5, C.wheel); r(wx, 17, 5, 1, C.wheel); } else { r(wx + 1, 16, 1, 1, C.wheel); r(wx + 3, 18, 1, 1, C.wheel); r(wx + 3, 16, 1, 1, C.wheel); r(wx + 1, 18, 1, 1, C.wheel); }
    r(wx + 2, 17, 1, 1, C.brass);
  }
  // dust puffs behind
  const p = (t * 4) % 1;
  r(x0 - 3 - p * 10, 16 - p * 3, 3, 2, C.dust); r(x0 - 8 - p * 12, 14 - p * 2, 2, 2, C.dust);
}

export default function LoadingScreen({ label, inline }: { label?: string; inline?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext('2d');
    if (!cv || !c) return;
    const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    let raf = 0, last = -1;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const step = Math.floor(t * 10); // 10 fps, stepped like a sprite
      if (step !== last) { last = step; draw(c, reduce ? 0 : step / 10, !!inline); }
      if (!reduce) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inline]);
  const text = (label ?? 'Loading').replace(/(…|\.\.\.)\s*$/, '');
  return (
    <div className={inline ? 'ld ld-inline' : 'ld'} role="status" aria-live="polite" aria-busy="true">
      <canvas ref={ref} className="ld-cv" width={W} height={H} aria-hidden />
      <div className="ld-label">{text}<span className="ld-dots" aria-hidden><i>.</i><i>.</i><i>.</i></span></div>
    </div>
  );
}
