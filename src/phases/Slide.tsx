// Whiskey Slide finale: each finalist game's champion slides a glass down the bar. Closest to the chalk mark wins;
// off the end of the bar = smashed on the floor.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import type { Player, Slide as SlideState } from '../../shared/types';
import { useNow } from '../net';
import { sfx } from '../sfx';
import { MiniBust } from '../pixel/BustPreview';
import { PixelCover } from '../pixel/PixelCover';
import { PixelSprite } from '../pixel/PixelCanvas';
import { PAL, hexRgb, rnd } from '../pixel/palette';
import { bayer } from '../pixel/dither';
import type { DrawFn } from '../pixel/sprites';
import { BUZZ, buzz } from '../scene/haptics';
import './gameplay.css';

const SLIDE_MS = 2200;  // a glass takes this long to come to rest
const FALL_MS = 650;    // tipping off the end and dropping out of sight
const PERIOD = 1100;    // power meter oscillation period
const TURN_MS = 15_000;  // server: a slider's window opens at turnDeadline - TURN_MS (after the intro / previous glass)
const REACH = 1.18;     // power 1.0 reaches this far down the bar (server: dist ≈ power * 1.18 + wobble)
const BAR_IN = 288;     // the bar is 24 ft long: distances read out in inches/feet
const K = 0.42;         // perspective foreshortening (mild: the action happens at 0.7..1.0)
const TMAX = 1.24;      // top of the bar canvas in bar units (room for the drop-off + spittoon)

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** power meter shape: a sine sweep 0 -> 1 -> 0 (fast through the middle where the sweet spot usually sits) */
const meter = (ms: number) => (1 - Math.cos((2 * Math.PI * ms) / PERIOD)) / 2;

/** glass position along the bar at `el` ms after release: constant deceleration to `dist` */
function glassAt(dist: number, el: number) {
  const p = Math.min(1, Math.max(0, el / SLIDE_MS));
  return dist * (1 - (1 - p) * (1 - p));
}
/** ms after release when a glass that falls passes the end of the bar */
function edgeMs(dist: number) {
  if (dist <= 1) return Infinity;
  // dist * (1 - (1-p)^2) = 1  ->  p = 1 - sqrt(1 - 1/dist)
  return (1 - Math.sqrt(1 - 1 / dist)) * SLIDE_MS;
}

const fmtMiss = (dist: number, mark: number, fell: boolean) => {
  if (fell) return 'SMASHED';
  const d = (dist - mark) * BAR_IN;
  const a = Math.abs(d);
  if (a < 1) return 'DEAD ON';
  const v = a >= 24 ? `${(a / 12).toFixed(1)} ft` : `${Math.round(a)}"`;
  return `${v} ${d < 0 ? 'short' : 'past'}`;
};

/* ---------------- projection shared by the canvas and the DOM glasses ---------------- */
interface Geo { W: number; H: number; cx: number; y0: number; yH: number; hw0: number; s: (t: number) => number; y: (t: number) => number; hw: (t: number) => number }
function geo(W: number, H: number): Geo {
  const y0 = H - Math.max(8, H * 0.04);
  const top = Math.max(6, H * 0.03);
  const sT = 1 / (1 + K * TMAX);
  const yH = (top - sT * y0) / (1 - sT);
  const hw0 = Math.min(W * 0.44, H * 0.95, 560);
  const s = (t: number) => 1 / (1 + K * t);
  return { W, H, cx: W / 2, y0, yH, hw0, s, y: (t) => yH + (y0 - yH) * s(t), hw: (t) => hw0 * s(t) };
}

const rgbCache = new Map<string, [number, number, number]>();
const rgb = (h: string) => { let v = rgbCache.get(h); if (!v) { v = hexRgb(h); rgbCache.set(h, v); } return v; };

/** the bar counter in perspective, painted once per size at a chunky pixel scale */
const BarCanvas = memo(function BarCanvas({ W, H, mark }: { W: number; H: number; mark: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || W < 10 || H < 10) return;
    const P = W < 520 ? 2 : 3;
    const cw = Math.ceil(W / P), ch = Math.ceil(H / P);
    cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d'); if (!c) return;
    const g = geo(W, H);
    const img = c.createImageData(cw, ch);
    const d = img.data;
    const put = (x: number, y: number, col: string) => {
      if (x < 0 || y < 0 || x >= cw || y >= ch) return;
      const [r, gg, b] = rgb(col); const i = (y * cw + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    };
    const tOf = (sy: number) => { const s = (sy - g.yH) / (g.y0 - g.yH); return (1 / s - 1) / K; };
    const yEnd = g.y(1) / P;
    for (let py = 0; py < ch; py++) {
      const sy = (py + 0.5) * P;
      const t = tOf(sy);
      const hw = g.hw(Math.max(0, t)) / P;
      const cx = g.cx / P;
      for (let px = 0; px < cw; px++) {
        const u = (px + 0.5 - cx) / hw;
        const au = Math.abs(u);
        let col: string;
        if (t > 1) {
          // past the end: the saloon floor far below, then the back wall
          if (t > TMAX - 0.05) {
            col = (py % 6 === 0) ? PAL.ink : bayer(px, py) > 0.6 ? PAL.wood1 : PAL.wood0;
          } else {
            const fl = Math.floor((t - 1) * 60);
            col = fl % 3 === 0 && bayer(px, py) > 0.3 ? PAL.ink : rnd(px >> 3, fl, 7) > 0.85 ? PAL.wood2 : bayer(px, py) > 0.55 ? PAL.wood1 : PAL.wood0;
            // the counter's end lip throws a shadow on the floor behind it
            if (py < yEnd + 0.5 && py > yEnd - 2.5 && au < 1.05) col = PAL.ink;
          }
        } else if (t < 0 || au <= 1) {
          if (t < 0) {
            // front edge facing us
            col = au > 1 ? PAL.ink : (py % 2 ? PAL.wood2 : PAL.wood1);
          } else if (au > 0.955) {
            // brass-capped rail along both edges
            col = au > 0.985 ? PAL.ink : (u < 0 ? PAL.lamp3 : PAL.wood4);
            if (au <= 0.985 && bayer(px, py) > 0.8) col = PAL.lamp1;
          } else {
            // planks run along the bar: seams converge toward the vanishing point
            const plank = Math.floor((u + 1) * 3.5);
            const seam = Math.abs(((u + 1) * 3.5) % 1) < 0.045 * (hw > 40 ? 1 : 1.6);
            const grain = rnd(Math.floor((u + 1) * 60), Math.floor(t * 70 + plank * 13), 11);
            col = seam ? PAL.wood1 : grain > 0.86 ? PAL.wood2 : grain < 0.08 ? PAL.wood4 : plank % 2 ? PAL.wood3 : '#4f3220';
            // warm lamp glow pooled on the varnish
            const glow = Math.max(0, 1 - Math.hypot(u * 0.9, (t - 0.55) * 2.2));
            if (glow * 0.9 > bayer(px, py) + 0.35) col = col === PAL.wood1 ? PAL.wood2 : PAL.wood4;
          }
        } else if (au < 1.09) {
          // side face of the counter
          col = bayer(px, py) > 0.5 ? PAL.wood1 : PAL.wood0;
          if (au < 1.015) col = PAL.ink;
        } else {
          // floor beside the bar
          col = Math.floor(t * 30) % 4 === 0 && bayer(px, py) > 0.2 ? PAL.ink : bayer(px, py) > 0.78 ? PAL.wood1 : PAL.wood0;
        }
        put(px, py, col);
      }
    }
    // end lip of the counter
    const ye = Math.round(yEnd);
    const hwe = g.hw(1) / P, cxp = g.cx / P;
    for (let x = Math.round(cxp - hwe); x <= Math.round(cxp + hwe); x++) { put(x, ye, PAL.lamp3); put(x, ye + 1, PAL.wood4); put(x, ye - 1, PAL.ink); }
    // chalk mark: a scuffed line across the bar
    const ym = g.y(mark) / P;
    const hwm = g.hw(mark) / P;
    for (let x = Math.round(cxp - hwm * 0.95); x <= Math.round(cxp + hwm * 0.95); x++) {
      for (let k = 0; k < 2; k++) {
        const yy = Math.round(ym) + k;
        if (k === 0 ? rnd(x, 3, 5) > 0.12 : bayer(x, yy) > 0.55) put(x, yy, k === 0 ? PAL.white : PAL.parch2);
      }
    }
    // brass tick nails every 1/10 of the bar on both rails
    for (let i = 1; i < 10; i++) {
      const t = i / 10, yy = Math.round(g.y(t) / P), hh = g.hw(t) / P;
      for (const sx of [-1, 1]) { const xx = Math.round(cxp + sx * hh * 0.97); put(xx, yy, PAL.lamp0); put(xx, yy + 1, PAL.lamp3); }
    }
    // start chalk tick
    const y0 = Math.round(g.y(0.015) / P), hw00 = g.hw(0) / P;
    for (let x = Math.round(cxp - hw00 * 0.9); x <= Math.round(cxp + hw00 * 0.9); x += 2) put(x, y0, PAL.parch3);
    c.putImageData(img, 0, 0);
    // spittoon on the floor past the end
    const st = 1.13, sx = cxp + g.hw(st) / P * 0.55, sy = g.y(st) / P, sc = Math.max(1, Math.round(g.s(st) * (W < 520 ? 2.2 : 2.4)));
    const sp = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(sx + x * sc), Math.round(sy + y * sc), w * sc, h * sc); };
    sp(-6, 1, 12, 2, 'rgba(0,0,0,.5)');
    sp(-4, -6, 8, 7, PAL.ink); sp(-3, -5, 6, 5, PAL.lamp3); sp(-3, -5, 2, 4, PAL.lamp1); sp(2, -5, 1, 5, '#7a3a12');
    sp(-5, -8, 10, 2, PAL.ink); sp(-4, -8, 8, 1, PAL.lamp1); sp(-3, -7, 6, 1, PAL.wood0);
  }, [W, H, mark]);
  return <canvas ref={ref} className="sl-cv" aria-hidden />;
});

/* ---------------- sprites ---------------- */
const drawGlass = (tint: string): DrawFn => (c) => {
  // 14x16 whiskey tumbler
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(1, 14, 13, 2);
  c.fillStyle = PAL.ink; c.fillRect(1, 1, 12, 14);
  c.fillStyle = '#9fb6c4'; c.fillRect(2, 2, 10, 12);
  c.fillStyle = '#cfe0ea'; c.fillRect(2, 2, 10, 1);
  c.fillStyle = PAL.lamp3; c.fillRect(2, 7, 10, 6);
  c.fillStyle = tint; c.fillRect(2, 7, 10, 1); c.fillRect(3, 8, 8, 1);
  c.fillStyle = PAL.lamp1; c.fillRect(3, 9, 2, 3);
  c.fillStyle = PAL.white; c.fillRect(3, 3, 1, 3); c.fillRect(10, 3, 1, 1);
  c.fillStyle = '#6d8492'; c.fillRect(2, 13, 10, 1); c.fillRect(11, 3, 1, 10);
};
const GLASS = drawGlass(PAL.lamp0);
const SHARDS = Array.from({ length: 12 }, (_, i) => ({ a: (i * 31 + ((i * 13) % 9)) % 180 - 90, d: 26 + ((i * 37) % 40), c: i % 3 === 0 ? PAL.lamp1 : i % 3 === 1 ? '#cfe0ea' : '#9fb6c4' }));

/* ---------------- main ---------------- */
type ThrowT = SlideState['throws'][number];

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [sz, setSz] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const on = () => setSz({ w: el.clientWidth, h: el.clientHeight });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, sz] as const;
}

export default function Slide({ state, me, send, skew }: RoomProps) {
  const sl = state.slide;
  const [barRef, sz] = useSize<HTMLDivElement>();
  const reduce = useMemo(reduced, []);
  const lastThrow = sl?.throws[sl.throws.length - 1];
  // keep the clock running through the last glass's slide + the reveal (winner may land the same instant)
  const settleAt = lastThrow ? lastThrow.at + SLIDE_MS + 400 : 0;
  const now = useNow(skew, !!sl && (!sl.winner || Date.now() + skew < settleAt + 1500));

  const player = (id?: string): Player | undefined => state.players.find((p) => p.id === id);
  const gameName = (a: number) => state.board.find((g) => g.appid === a)?.name ?? state.pool.find((g) => g.appid === a)?.name ?? `App ${a}`;

  const games = sl?.games ?? [];
  const order = sl?.order ?? [];
  const turn = sl?.turn ?? 0;
  const curIdx = sl && turn < order.length ? order[turn] : -1;
  const curGame = curIdx >= 0 ? games[curIdx] : undefined;
  const curChamp = curIdx >= 0 ? sl!.champs[curIdx] : undefined;
  const myTurn = !!sl && !sl.winner && curChamp === me;
  // a re-slide: only the games in `order` slide again; their throws this round are the last `turn` throws
  const roundThrows: ThrowT[] = sl ? sl.throws.slice(Math.max(0, sl.throws.length - Math.min(turn, sl.throws.length))) : [];
  const resliding = new Set(order.map((i) => games[i]));
  const throwFor = (appid: number): ThrowT | undefined => {
    const cur = [...roundThrows].reverse().find((t) => t.game === appid);
    if (cur) return cur;
    if (sl && sl.round > 1 && resliding.has(appid) && !sl.winner) return undefined; // back at the start for the re-slide
    return sl ? [...sl.throws].reverse().find((t) => t.game === appid) : undefined;
  };
  const ghostFor = (appid: number): ThrowT | undefined => {
    if (!sl || sl.round < 2 || !resliding.has(appid)) return undefined;
    const all = sl.throws.filter((t) => t.game === appid);
    const cur = throwFor(appid);
    return [...all].reverse().find((t) => t !== cur);
  };

  // the previous glass is still sliding: the next slider waits for it to settle
  // (the server holds the next turn for its own animation window, ~2.6s after the release)
  const busyUntil = lastThrow ? lastThrow.at + Math.max(2650, Math.min(SLIDE_MS, edgeMs(lastThrow.dist)) + FALL_MS) : 0;
  const animating = !!lastThrow && now < busyUntil && now - lastThrow.at < 4000;
  const opensAt = sl && sl.turnDeadline > 0 ? sl.turnDeadline - TURN_MS : 0;
  const steady = !!sl && !sl.winner && curIdx >= 0 && now < opensAt;
  const settled = (!lastThrow || !animating) && !steady;
  const revealed = !!sl?.winner && settled;

  /* ---- sounds for each fresh throw (never for ones already at rest when we arrived) ---- */
  const heard = useRef<Set<string>>(new Set());
  const throwKey = sl ? sl.throws.map((t) => `${t.game}:${t.at}`).join('|') : '';
  useEffect(() => {
    if (!sl) return;
    const timers: number[] = [];
    for (const t of sl.throws) {
      const k = `${t.game}:${t.at}`;
      if (heard.current.has(k)) continue;
      heard.current.add(k);
      const age = Date.now() + skew - t.at;
      if (age > 600) continue; // reload / late join: already at rest, no sound
      const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, ms - age)));
      at(0, () => { sfx.swish(); sfx.cardSlide(); });
      if (!reduce) { at(450, () => sfx.cardSlide()); at(1000, () => sfx.cardSlide()); }
      if (t.fell) {
        const e = reduce ? 600 : Math.min(SLIDE_MS, edgeMs(t.dist)) + FALL_MS * 0.6;
        at(e, () => { sfx.stamp(); sfx.glass(); });
        at(e + 50, () => sfx.clink());
        at(e + 120, () => sfx.glass());
        at(e + 90, () => buzz(BUZZ.hit));
      } else {
        at(reduce ? 600 : SLIDE_MS - 120, () => { sfx.glass(); if (Math.abs(t.dist - sl.mark) * BAR_IN < 6) sfx.clink(); });
      }
    }
    return () => { /* timers outlive re-renders on purpose; they're short */ };
  }, [throwKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // the winner reveal
  useEffect(() => {
    if (!revealed) return;
    sfx.drawSting();
    const t = window.setTimeout(() => sfx.stamp(), 500);
    buzz(BUZZ.win);
    return () => clearTimeout(t);
  }, [revealed]);

  // tie-break announcement
  const round = sl?.round ?? 1;
  useEffect(() => { if (round > 1) { sfx.coin(); } }, [round]);

  /* ---- power meter (driven by performance.now from the press: immune to clock skew resets) ---- */
  const [charging, setCharging] = useState<number | null>(null); // performance.now() at press
  const [, force] = useState(0);
  const sentKey = useRef('');
  const turnKey = sl ? `${sl.round}:${sl.turn}:${sl.throws.length}` : '';
  const [released, setReleased] = useState<{ key: string; power: number } | null>(null);
  const alreadySent = released?.key === turnKey || sentKey.current === turnKey;
  const canSlide = myTurn && settled && !alreadySent;
  useEffect(() => { setCharging(null); }, [turnKey]);
  // the server didn't take it (socket blip / too early): unlock so the slider can try again
  useEffect(() => {
    if (!released || released.key !== turnKey) return;
    const t = window.setTimeout(() => { if (sentKey.current === released.key) sentKey.current = ''; setReleased(null); }, 1800);
    return () => clearTimeout(t);
  }, [released, turnKey]);
  useEffect(() => { if (myTurn) { sfx.spurs(); buzz(BUZZ.myTurn); } }, [myTurn, turnKey]);
  useEffect(() => {
    if (charging === null) return;
    let raf = 0;
    const tick = () => { force((x) => x + 1); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [charging]);
  const power = charging !== null ? meter(performance.now() - charging) : released?.key === turnKey ? released.power : 0;

  const ctl = useRef({ canSlide, charging, turnKey });
  ctl.current = { canSlide, charging, turnKey };
  const startRef = useRef<() => void>(() => {});
  const releaseRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});
  startRef.current = () => {
    if (!ctl.current.canSlide || ctl.current.charging !== null) return;
    sfx.click();
    setCharging(performance.now());
  };
  releaseRef.current = () => {
    const { charging: at, canSlide: ok, turnKey: k } = ctl.current;
    if (at === null) return;
    setCharging(null);
    if (!ok || sentKey.current === k) return;
    const pw = Math.min(1, Math.max(0, Math.round(meter(performance.now() - at) * 1000) / 1000));
    sentKey.current = k;
    setReleased({ key: k, power: pw });
    send({ t: 'slide', power: pw });
  };
  cancelRef.current = () => { if (ctl.current.charging !== null) setCharging(null); };

  // Space: hold to charge, release to slide. A Space still held from before this screen (no keydown seen) is ignored.
  useEffect(() => {
    let down = false;
    const skip = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.emo, .emo-wheel, .sound, input, textarea, select');
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (skip(e.target)) return;
      e.preventDefault();
      if (e.repeat || down) return;
      down = true;
      startRef.current();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (!down) return;
      e.preventDefault();
      down = false;
      releaseRef.current();
    };
    const onCancel = () => { down = false; cancelRef.current(); };
    const onVis = () => { if (document.hidden) onCancel(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onCancel);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onCancel); document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const holdPtr = useRef<number | null>(null);
  const onBtnDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    holdPtr.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    startRef.current();
  };
  const onBtnUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdPtr.current !== e.pointerId) return;
    holdPtr.current = null;
    releaseRef.current();
  };
  const onBtnCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdPtr.current !== e.pointerId) return;
    holdPtr.current = null;
    cancelRef.current();
  };

  if (!sl) return createPortal(<div className="sl"><div className="sl-title">Lining up the glasses…</div></div>, document.body);

  const g = geo(sz.w, sz.h);
  const lanes = games.length >= 3 ? [-0.56, 0, 0.56] : games.length === 2 ? [-0.42, 0.42] : [0];
  const gs0 = Math.max(30, Math.min(78, g.hw0 * 0.3));
  const sweet = sl.mark / REACH;
  const fallAt = 1 / REACH;
  const secs = sl.turnDeadline > 0 && !steady ? Math.min(TURN_MS / 1000, Math.max(0, Math.ceil((sl.turnDeadline - now) / 1000))) : 0;
  const winIdx = sl.winner !== undefined ? games.indexOf(sl.winner) : -1;
  const winTh = sl.winner !== undefined ? throwFor(sl.winner) : undefined;
  const curPlayer = player(curChamp);

  const status = (i: number) => {
    const appid = games[i];
    const th = throwFor(appid);
    if (th) {
      const el = now - th.at;
      if (el < SLIDE_MS && !reduce) return { txt: 'sliding…', cls: 'live' };
      return { txt: fmtMiss(th.dist, sl.mark, th.fell), cls: th.fell ? 'fell' : 'rest' };
    }
    if (i === curIdx) return { txt: myTurn ? 'your slide' : 'up now', cls: 'up' };
    if (sl.round > 1 && !resliding.has(appid)) return { txt: 'out', cls: 'out' };
    return { txt: 'waiting', cls: '' };
  };

  // stand-out line under the title
  let line: JSX.Element;
  if (revealed && winIdx >= 0) line = <div className="sl-verdict">Closest to the mark: <b>{gameName(sl.winner!)}</b>{winTh ? <small> · {fmtMiss(winTh.dist, sl.mark, winTh.fell)}</small> : null}</div>;
  else if (sl.winner !== undefined || curIdx < 0) line = <div className="sl-line">Measuring with the barkeep's tape…</div>;
  else if (animating) line = <div className="sl-line">Glass on the move…</div>;
  else if (steady) line = <div className="sl-line">Steady… <b>{curChamp === me ? 'you' : curPlayer?.name ?? 'a ghost'}</b> slides first for <b>{gameName(curGame!)}</b></div>;
  else if (myTurn) line = <div className="sl-line mine">Your slide for <b>{gameName(curGame!)}</b>{secs > 0 && <em className={secs <= 5 ? 'hot' : ''}>{secs}s</em>}</div>;
  else line = <div className="sl-line"><b>{curPlayer?.name ?? 'A ghost'}</b> is sliding for <b>{gameName(curGame!)}</b>{secs > 0 && <em className={secs <= 5 ? 'hot' : ''}>{secs}s</em>}</div>;

  return createPortal(
    <div className={`sl ${myTurn ? 'my-turn' : ''} ${revealed ? 'decided' : ''} ${reduce ? 'reduce' : ''}`} role="main" aria-label="Whiskey slide">
      <div className="sl-head">
        <div className="sl-title">Whiskey Slide{sl.round > 1 && <span className="sl-tie">TIE! Re-slide</span>}</div>
        <div className="sl-rules">Closest to the chalk wins. Off the end? Nah.</div>
        {line}
      </div>

      <div className="sl-roster">
        {games.map((appid, i) => {
          const champ = player(sl.champs[i]);
          const st = status(i);
          const win = revealed && i === winIdx, lose = revealed && i !== winIdx;
          return (
            <div key={appid} className={`sl-card px-box ${i === curIdx && !sl.winner ? 'cur' : ''} ${win ? 'win' : ''} ${lose ? 'lose' : ''}`}>
              <div className="sl-card-art">
                <PixelCover appid={appid} name={gameName(appid)} kind="square" />
                {lose && <span className="sl-stamp">NAH.</span>}
              </div>
              <div className="sl-card-txt">
                <div className="sl-card-name">{gameName(appid)}</div>
                <div className="sl-card-champ">
                  {champ && <MiniBust p={champ} className="sl-mini" />}
                  <span className={sl.champs[i] === me ? 'me' : ''}>{sl.champs[i] === me ? 'you' : champ?.name ?? 'a ghost'}</span>
                </div>
                <div className={`sl-card-st ${st.cls}`}>{st.txt}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sl-bar" ref={barRef}>
        <BarCanvas W={sz.w} H={sz.h} mark={sl.mark} />
        {sz.w > 0 && (
          <>
            <div className="sl-mark-lbl" style={{ top: g.y(sl.mark), left: g.cx + g.hw(sl.mark) + 4 }}>MARK</div>
            <div className="sl-end-lbl" style={{ top: g.y(1), left: g.cx - g.hw(1) - 4 }}>END</div>
            {games.map((appid, i) => {
              const ghost = ghostFor(appid);
              if (!ghost || ghost.fell) return null;
              const lane = lanes[i] ?? 0;
              const s = g.s(ghost.dist), size = gs0 * s;
              return <div key={`gh${appid}`} className="sl-ghost" style={{ left: g.cx + lane * g.hw(ghost.dist), top: g.y(ghost.dist), width: size, height: size * 16 / 14 }}><span>last</span></div>;
            })}
            {games.map((appid, i) => {
              const th = throwFor(appid);
              const lane = lanes[i] ?? 0;
              let t = 0, fallP = 0, gone = false;
              if (th) {
                const el = now - th.at;
                if (reduce) {
                  t = el < 500 ? 0 : Math.min(th.dist, 1);
                  if (th.fell && el >= 500) gone = true;
                } else if (th.fell) {
                  const e = Math.min(SLIDE_MS, edgeMs(th.dist));
                  if (el < e) t = glassAt(th.dist, el);
                  else { fallP = Math.min(1, (el - e) / FALL_MS); t = 1 + (th.dist - 1) * fallP; gone = fallP >= 1; }
                } else t = glassAt(th.dist, el);
              }
              const s = g.s(t);
              const size = gs0 * s;
              const x = g.cx + lane * g.hw(t), y = g.y(t);
              const win = revealed && i === winIdx, lose = revealed && i !== winIdx;
              const smashEl = th?.fell ? now - th.at - (reduce ? 500 : Math.min(SLIDE_MS, edgeMs(th.dist)) + FALL_MS * 0.6) : -1;
              const tagSize = Math.max(20, Math.min(40, size * 0.75));
              const isCur = i === curIdx && !th && !sl.winner;
              const style = {
                left: x, top: y, width: size, height: size * 16 / 14, zIndex: Math.round(100 - t * 50),
                transform: `translate(-50%, -100%) translateY(${fallP * size * 0.9}px) rotate(${fallP * (lane >= 0 ? 70 : -70)}deg)`,
                opacity: gone ? 0 : 1 - fallP * 0.85,
              } as CSSProperties;
              return (
                <div key={appid}>
                  {!gone && (
                    <div className={`sl-glass ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${isCur ? 'cur' : ''}`} style={style}>
                      <PixelSprite draw={GLASS} w={14} h={16} className="sl-glass-sp" />
                      <div className="sl-tag" style={{ width: tagSize, height: tagSize, [lane < 0 ? 'right' : 'left']: '88%' } as CSSProperties}>
                        <PixelCover appid={appid} name={gameName(appid)} kind="square" />
                      </div>
                      {lose && <span className="sl-gstamp">NAH.</span>}
                    </div>
                  )}
                  {th?.fell && smashEl >= 0 && smashEl < 1600 && (
                    <div className="sl-smash" style={{ left: x, top: g.y(1) }}>
                      {!reduce && SHARDS.map((sh, k) => <i key={k} style={{ '--a': `${sh.a}deg`, '--d': `${sh.d * Math.max(0.6, s * 1.4)}px`, background: sh.c } as CSSProperties} />)}
                      <b>CRASH!</b>
                    </div>
                  )}
                  {th && !(th.fell && !gone && fallP < 1) && (now - th.at >= SLIDE_MS || reduce) && !(th.fell && smashEl < 1600) && (
                    <div className={`sl-read ${th.fell ? 'fell' : ''} ${win ? 'win' : ''}`} style={{ left: x, top: th.fell ? g.y(1) - 4 : y + 4 }}>
                      {fmtMiss(th.dist, sl.mark, th.fell)}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="sl-ctl">
        {myTurn && !alreadySent ? (
          <>
            <div className={`sl-meter ${charging !== null ? 'on' : ''}`} aria-hidden>
              <i className="sl-zone-fell" style={{ left: `${fallAt * 100}%` }} />
              <i className="sl-zone-sweet" style={{ left: `${(sweet - 0.045) * 100}%`, width: '9%' }} />
              <b className="sl-needle" style={{ left: `${power * 100}%` }} />
              <span className="sl-meter-lbl">{charging !== null ? 'let go on the gold' : 'power'}</span>
            </div>
            <button
              className={`sl-hold px-btn ${charging !== null ? 'held' : ''}`}
              disabled={!canSlide}
              onPointerDown={onBtnDown} onPointerUp={onBtnUp} onPointerCancel={onBtnCancel} onLostPointerCapture={onBtnCancel}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Hold to charge, release to slide"
            >
              {steady ? 'STEADY…' : !settled ? 'WAIT…' : charging !== null ? 'RELEASE!' : 'HOLD TO SLIDE'}
              <small>{charging !== null ? 'let go to slide' : 'or hold Space'}</small>
            </button>
          </>
        ) : myTurn && alreadySent ? (
          <div className="sl-spect px-box">Sent at {Math.round((released?.power ?? 0) * 100)}% power…</div>
        ) : !sl.winner && curIdx >= 0 ? (
          <div className="sl-spect px-box">{curPlayer?.id === me ? 'Your slide' : 'Watching the bar'}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
