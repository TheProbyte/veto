import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { hashStr, rnd, PAL } from './palette';
import { bayer, px } from './dither';
import { GRID, peekPixelized, pixelize, type CoverKind } from './pixelize';
import { PixelSprite } from './PixelCanvas';
import './pixel.css';

/** Pixel placeholder: dithered wood plank card with a brass rule (the name is a DOM overlay in the pixel font). */
export const placeholderDraw = (seed: number) => (c: CanvasRenderingContext2D, w: number, h: number) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / h;
    const plank = Math.floor((x + (seed % 5)) / 9) % 2;
    const col = v + (rnd(x, y, seed) - 0.5) * 0.2 > 0.4 + bayer(x, y) * 0.4 ? PAL.wood1 : plank ? PAL.wood2 : '#33200f';
    px(c, x, y, col);
  }
  c.fillStyle = PAL.lamp3; c.fillRect(2, 2, w - 4, 1); c.fillRect(2, h - 3, w - 4, 1);
  c.fillStyle = PAL.ink; c.fillRect(0, 0, w, 1); c.fillRect(0, h - 1, w, 1); c.fillRect(0, 0, 1, h); c.fillRect(w - 1, 0, 1, h);
};

/**
 * A Steam cover turned into real pixel art. Fills its container (100% x 100%, cover-cropped).
 * Falls back box -> header (or header -> box) -> a pixel placeholder with the game's name.
 * Processing starts only once it's near the viewport.
 */
export const PixelCover = memo(function PixelCover({ appid, name, kind = 'box', className = '', style, w, h, showName }: {
  appid: number; name: string; kind?: CoverKind; className?: string; style?: CSSProperties;
  /** optional grid override (art pixels) */
  w?: number; h?: number;
  /** force the name label even when art loaded */
  showName?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const peek = peekPixelized(appid, kind, w, h);
  const [res, setRes] = useState<{ key: string; url: string | null } | null>(peek !== undefined ? { key: `${appid}|${kind}|${w}|${h}`, url: peek?.url ?? null } : null);
  const key = `${appid}|${kind}|${w}|${h}`;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let alive = true;
    const go = () => pixelize(appid, kind, w, h).then((r) => { if (alive) setRes({ key, url: r?.url ?? null }); });
    const cached = peekPixelized(appid, kind, w, h);
    if (cached !== undefined) { setRes({ key, url: cached?.url ?? null }); return; }
    if (typeof IntersectionObserver === 'undefined') { go(); return () => { alive = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = res && res.key === key ? res : null;
  const [gw, gh] = [w ?? GRID[kind][0], h ?? GRID[kind][1]];
  const draw = useMemo(() => placeholderDraw(hashStr(String(appid)) % 997), [appid]);
  const ar = `${gw} / ${gh}`;
  return (
    <div ref={ref} className={`pxcover pxcover-${kind} ${cur?.url ? 'ok' : cur ? 'missing' : 'loading'} ${className}`} style={{ '--ar': ar, ...style } as CSSProperties} title={name}>
      {cur?.url
        ? <img src={cur.url} alt={name} draggable={false} />
        : <PixelSprite draw={draw} w={gw} h={gh} className="pxcover-ph" />}
      {(showName || (cur && !cur.url)) && <span className="pxcover-name">{name}</span>}
    </div>
  );
});

export default PixelCover;
