/**
 * Steam screenshots on a game card: hover (mouse, after ~400 ms) or long-press (touch) flips the card art
 * through the game's screenshots, pixelized (drawn small into a canvas, upscaled with image-rendering: pixelated),
 * one every ~1.2 s with a row of dots. Leaving / releasing returns to the box art. A long-press never counts as a tap.
 *
 *   const flip = useShotFlip(appid);
 *   <button {...flip.bind} onClick=…><span className="art">…<Cover/>{flip.overlay}</span></button>
 *
 * The overlay is a canvas placed after the cover (the dock's card flight grabs the first <img>, so no <img> here).
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { shotsUrl } from '../../shared/types';

const lists = new Map<number, Promise<string[]>>();
const imgs = new Map<string, Promise<HTMLImageElement | null>>();

function shotsOf(appid: number): Promise<string[]> {
  let p = lists.get(appid);
  if (!p) {
    p = fetch(shotsUrl(appid)).then((r) => (r.ok ? r.json() : [])).then((a) => (Array.isArray(a) ? a.filter((u) => typeof u === 'string').slice(0, 8) : [])).catch(() => []);
    lists.set(appid, p);
  }
  return p;
}
function imgOf(url: string): Promise<HTMLImageElement | null> {
  let p = imgs.get(url);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous'; im.decoding = 'async';
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = url;
    });
    imgs.set(url, p);
  }
  return p;
}

const HOVER_MS = 400, PRESS_MS = 450, CYCLE_MS = 1200;

/** cover-crop the screenshot into a small canvas: that's the pixelization */
function paint(cv: HTMLCanvasElement, im: HTMLImageElement) {
  const box = cv.parentElement?.getBoundingClientRect();
  const aspect = box && box.height > 0 ? box.width / box.height : 16 / 9;
  const w = aspect >= 1 ? 80 : Math.round(80 * aspect);
  const h = aspect >= 1 ? Math.round(80 / aspect) : 80;
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const c = cv.getContext('2d');
  if (!c) return;
  const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
  c.imageSmoothingEnabled = true;
  c.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export function useShotFlip(appid: number) {
  const [on, setOn] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const timer = useRef(0);
  const pressed = useRef<{ x: number; y: number; id: number } | null>(null);
  const ate = useRef(false); // a long-press fired: swallow the click it ends with
  const cv = useRef<HTMLCanvasElement | null>(null);

  const start = useCallback(() => {
    setOn(true); setIdx(0);
    shotsOf(appid).then((u) => setUrls(u));
  }, [appid]);
  const stop = useCallback(() => { clearTimeout(timer.current); pressed.current = null; setOn(false); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { stop(); setUrls([]); }, [appid, stop]);

  // cycle
  useEffect(() => {
    if (!on || urls.length < 2) return;
    const iv = window.setInterval(() => setIdx((i) => (i + 1) % urls.length), CYCLE_MS);
    return () => clearInterval(iv);
  }, [on, urls.length]);
  // draw the current shot (keep the box art until it's loaded); prefetch the next one
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on || !urls.length) { setShown(false); return; }
    let alive = true;
    const u = urls[idx % urls.length];
    imgOf(u).then((im) => { if (!alive || !im || !cv.current) return; try { paint(cv.current, im); setShown(true); } catch { /* tainted / gone */ } });
    if (urls.length > 1) void imgOf(urls[(idx + 1) % urls.length]);
    return () => { alive = false; };
  }, [on, urls, idx]);

  const bind = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(start, HOVER_MS);
    },
    onPointerLeave: (e: PointerEvent) => { if (e.pointerType === 'mouse' || !pressed.current) stop(); },
    onPointerDown: (e: PointerEvent) => {
      ate.current = false;
      if (e.pointerType === 'mouse') return;
      pressed.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { ate.current = true; start(); }, PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const p = pressed.current;
      if (!p || p.id !== e.pointerId || ate.current) return;
      if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10) { clearTimeout(timer.current); pressed.current = null; }
    },
    onPointerUp: (e: PointerEvent) => { if (e.pointerType !== 'mouse') stop(); },
    onPointerCancel: () => stop(),
    onContextMenu: (e: MouseEvent) => { if (pressed.current || ate.current) e.preventDefault(); },
    onClickCapture: (e: MouseEvent) => { if (ate.current) { ate.current = false; e.preventDefault(); e.stopPropagation(); } },
  };

  const overlay = on ? (
    <span className={`shotflip ${shown ? 'is-on' : ''}`} aria-hidden>
      <canvas ref={cv} className="shotflip-cv" width={80} height={45} />
      {urls.length > 1 && <span className="shotflip-dots">{urls.map((_, i) => <i key={i} className={i === idx % urls.length ? 'on' : ''} />)}</span>}
    </span>
  ) : null;
  return { bind, overlay, active: on && shown };
}

/** the art box of a card with the screenshot flip built in (the handlers live on the art, so a long-press there never taps the card) */
export function ShotArt({ appid, className, children }: { appid: number; className: string; children: ReactNode }) {
  const { bind, overlay, active } = useShotFlip(appid);
  return <span className={`${className} ${active ? 'is-shots' : ''}`} {...bind}>{children}{overlay}</span>;
}
