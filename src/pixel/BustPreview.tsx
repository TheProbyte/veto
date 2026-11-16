import { useEffect, useRef, type CSSProperties } from 'react';
import type { Look } from '../../shared/types';
import { BUST_H, BUST_W, bustFor, lookFromStyle, renderBust } from './sprites';
import { bayer } from './dither';
import './pixel.css';

const PAD = 18; // rows of headroom above the head for the hat drop
const CW = BUST_W, CH = BUST_H + PAD;

// hat drop with a 2-frame bounce, then settle (bust pixels, negative = above)
const DROP = [-13, -9, -4, 0, -2, 0, -1, 0];
// hat tip: lift, hold, back down (with a hand at the brim)
const TIP = [-1, -3, -4, -4, -4, -4, -3, -1, 0];
const FRAME_MS = 70;

const sigOf = (l: Look) => `${l.hat}.${l.hatColor}.${l.skin}.${l.face}.${l.hair}.${l.bandana}.${l.coat}`;

function puff(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, fade: number) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const v = 1 - Math.hypot(x, y * 1.3) / r;
    if (v > 0 && v * fade * 1.5 > bayer(cx + x, cy + y)) {
      c.fillStyle = v > 0.5 ? '#c9bba6' : '#8a7e70';
      c.fillRect(cx + x, cy + y, 1, 1);
    }
  }
}

/**
 * Live pixel preview of a gunslinger bust for a Look (character creator).
 * Idle blink/breath on a cheap timer (paused when hidden/offscreen); the hat drops on with a bounce
 * and a smoke puff whenever `look` changes; tips when `tipHat` turns true.
 */
export default function BustPreview({ look, scale = 4, className = '', tipHat = false, style }: {
  look: Look; scale?: number; className?: string; tipHat?: boolean; style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ look, drop: -1, tip: -1, visible: true, lastSig: sigOf(look) });
  const kick = useRef<() => void>(() => {});
  st.current.look = look;

  const sig = sigOf(look);
  useEffect(() => {
    const s = st.current;
    if (s.lastSig !== sig) { s.lastSig = sig; s.drop = 0; kick.current(); }
  }, [sig]);
  const prevTip = useRef(tipHat);
  useEffect(() => {
    if (tipHat && !prevTip.current) { st.current.tip = 0; kick.current(); }
    prevTip.current = tipHat;
  }, [tipHat]);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    cv.width = CW; cv.height = CH;
    const c = cv.getContext('2d'); if (!c) return;
    c.imageSmoothingEnabled = false;
    const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    const seed = Math.random() * 3;
    let timer = 0, dead = false, lastKey = '';
    const draw = () => {
      const s = st.current;
      const t = performance.now() / 1000 + seed;
      const blink = !reduce && (t % 3.7) < 0.14;
      const breath = !reduce && Math.sin(t * 2.2) > 0.3 ? 1 : 0;
      let hatDy = 0, hand = false, smoke = -1;
      if (s.drop >= 0) {
        hatDy = DROP[Math.min(DROP.length - 1, s.drop)];
        if (s.drop >= 3) smoke = s.drop - 3;
        s.drop++;
        if (s.drop >= DROP.length + 4) s.drop = -1;
      } else if (s.tip >= 0) {
        hatDy = TIP[Math.min(TIP.length - 1, s.tip)]; hand = s.tip < TIP.length - 1;
        s.tip++;
        if (s.tip >= TIP.length) s.tip = -1;
      }
      const key = `${sigOf(s.look)}|${+blink}|${breath}|${hatDy}|${+hand}|${smoke}`;
      if (key !== lastKey) {
        lastKey = key;
        const L = lookFromStyle(s.look, 'preview');
        const b = renderBust(L, { scale: 1, blink, rimRight: true, lit: false, dim: 1.05, ghost: false, hatDy, hand, padTop: PAD });
        c.clearRect(0, 0, CW, CH);
        c.drawImage(b, 0, breath);
        if (smoke >= 0 && smoke < 5) {
          const f = 1 - smoke / 5, r = 3 + smoke;
          puff(c, 9 - smoke * 2, PAD + 11 - smoke, r, f);
          puff(c, 39 + smoke * 2, PAD + 11 - smoke, r, f);
          puff(c, 24, PAD - 2 - smoke * 2, Math.max(2, r - 1), f * 0.8);
        }
      }
    };
    const busy = () => st.current.drop >= 0 || st.current.tip >= 0;
    const loop = () => {
      timer = 0;
      if (dead) return;
      if (document.hidden || !st.current.visible) return; // resumed by visibility/intersection
      draw();
      timer = window.setTimeout(loop, busy() ? FRAME_MS : 120);
    };
    const start = () => { if (!timer && !dead) { timer = window.setTimeout(loop, 0); } };
    kick.current = () => { clearTimeout(timer); timer = 0; start(); };
    const onVis = () => { if (!document.hidden) start(); };
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => { st.current.visible = es.some((e) => e.isIntersecting); if (st.current.visible) start(); });
      io.observe(cv);
    }
    draw();
    start();
    return () => { dead = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); io?.disconnect(); kick.current = () => {}; };
  }, []);

  return (
    <canvas
      ref={ref}
      className={`px-bust ${className}`}
      style={{ width: CW * scale, height: CH * scale, ...style }}
      aria-label="Your gunslinger"
      role="img"
    />
  );
}

/** Static head-and-shoulders bust for a player (toasts, lists). 48x40 canvas, drawn once per look. */
export function MiniBust({ p, className = '', style }: { p: { id: string; look: number; style?: Look; bot?: boolean; connected?: boolean }; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sig = p.style ? sigOf(p.style) : `l${p.look}`;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    cv.width = CW; cv.height = 40;
    const c = cv.getContext('2d'); if (!c) return;
    c.imageSmoothingEnabled = false;
    const b = renderBust(bustFor(p), { scale: 1, blink: false, rimRight: true, lit: false, dim: 1.05, ghost: false, bot: p.bot, padTop: 4 });
    c.clearRect(0, 0, CW, 40);
    c.drawImage(b, 0, 0);
  }, [p.id, sig, p.bot]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className={`px-bust px-minibust ${className}`} style={{ width: CW, height: 40, ...style }} aria-hidden />;
}
