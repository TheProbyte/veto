// The Barkeep's pixel portrait (head + shoulders: bowler, handlebar moustache, bowtie, waistcoat, apron),
// drawn with the same drawBarkeep() as the saloon scene. The mouth (and a gesturing hand) animate while `talking`.
import { useEffect, useRef, type CSSProperties } from 'react';
import { PAL } from './palette';
import { bayer } from './dither';
import { drawBarkeep } from './barkeep';
import './pixel.css';

/** portrait canvas, in barkeep pixels */
export const PORTRAIT_W = 22;
export const PORTRAIT_H = 26;
const OX = 11, OY = 2; // where his hat top sits in the frame

function paint(c: CanvasRenderingContext2D, f: number, talking: boolean, blink: boolean) {
  const W = PORTRAIT_W, H = PORTRAIT_H;
  // back-bar wall: dark planks with the lamp's warm glow from the upper left
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = 1 - Math.hypot(x - 4, y - 3) / 22;
    const b = bayer(x, y);
    c.fillStyle = g > 0.55 + b * 0.25 ? PAL.wood3 : g > 0.2 + b * 0.3 ? PAL.wood2 : x % 7 === 0 ? PAL.wood0 : PAL.wood1;
    c.fillRect(x, y, 1, 1);
  }
  // a bottle shelf behind him
  c.fillStyle = PAL.wood4; c.fillRect(0, 12, W, 1);
  c.fillStyle = PAL.ink; c.fillRect(0, 13, W, 1);
  for (const [bx, bh, col] of [[1, 6, '#1f3318'], [4, 4, '#5a2a10'], [17, 5, '#1e2c3d'], [19, 7, '#6b3a12']] as const) {
    c.fillStyle = col; c.fillRect(bx, 12 - bh, 2, bh); c.fillRect(bx + (bh > 5 ? 0 : 1), 12 - bh - 2, 1, 2);
  }
  const mouth = talking ? ([0, 1, 2, 1, 2, 0] as const)[f % 6] : 0;
  drawBarkeep(c, OX, OY, { pose: talking ? 'talk' : 'idle', f, dir: 0, mouth, blink, counter: false });
  // frame
  c.fillStyle = PAL.ink;
  c.fillRect(0, 0, W, 1); c.fillRect(0, H - 1, W, 1); c.fillRect(0, 0, 1, H); c.fillRect(W - 1, 0, 1, H);
}

/** `size` = CSS px per portrait pixel (the canvas is PORTRAIT_W x PORTRAIT_H) */
export function BarkeepPortrait({ talking = false, size = 4, className = '', style }: { talking?: boolean; size?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const talk = useRef(talking);
  talk.current = talking;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    cv.width = PORTRAIT_W; cv.height = PORTRAIT_H;
    const c = cv.getContext('2d'); if (!c) return;
    c.imageSmoothingEnabled = false;
    const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    let f = 0, timer = 0, blinkAt = 2000 + Math.random() * 2000, t = 0, lastKey = '';
    const tick = () => {
      timer = 0;
      t += 150;
      if (!reduce) f++;
      if (t > blinkAt + 150) blinkAt = t + 2500 + Math.random() * 3000;
      const blink = !reduce && t > blinkAt;
      const tk = talk.current;
      const key = `${tk ? f % 6 : 0}|${tk ? f % 4 : 0}|${+blink}|${+tk}`;
      if (key !== lastKey) { lastKey = key; paint(c, tk ? f : 0, tk, blink); }
      if (!document.hidden) timer = window.setTimeout(tick, 150);
    };
    const onVis = () => { if (!document.hidden && !timer) tick(); };
    paint(c, 0, talk.current, false);
    timer = window.setTimeout(tick, 150);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(timer); timer = 0; document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return (
    <canvas ref={ref} className={`px-bust px-barkeep ${className}`} role="img" aria-label="The Barkeep"
      style={{ width: PORTRAIT_W * size, height: PORTRAIT_H * size, imageRendering: 'pixelated', ...style }} />
  );
}

export default BarkeepPortrait;
