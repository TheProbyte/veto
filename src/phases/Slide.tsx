// Whiskey Slide finale (phase 'mini', kind 'slide'): everyone slides one glass at once, each down their own lane.
// Closest to the chalk mark wins for the game they play for; off the end of the bar = smashed on the floor.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import type { MiniResult, Player } from '../../shared/types';
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
const REACH = 1.18;     // power 1.0 reaches this far down the bar (server: dist ≈ power * 1.18 + wobble)
const BAR_IN = 288;     // the bar is 24 ft long (for the dead-on clink)
const K = 0.42;         // perspective foreshortening
const TMAX = 1.12;      // top of the bar canvas in bar units (room for the drop-off)
const SPAN = 0.92;      // the lanes cover this much of the bar's half-width

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** power meter shape: a sine sweep 0 -> 1 -> 0 */
const meter = (ms: number) => (1 - Math.cos((2 * Math.PI * ms) / PERIOD)) / 2;
/** glass position along the bar at `el` ms after release: constant deceleration to `dist` */
function glassAt(dist: number, el: number) {
  const p = Math.min(1, Math.max(0, el / SLIDE_MS));
  return dist * (1 - (1 - p) * (1 - p));
}
/** ms after release when a glass that falls passes the end of the bar */
function edgeMs(dist: number) {
  if (dist <= 1) return Infinity;
  return (1 - Math.sqrt(1 - 1 / dist)) * SLIDE_MS;
}
/** when a replayed glass is done moving (at rest, or gone off the end) */
const restMs = (dist: number, fell: boolean, reduce: boolean) => (reduce ? 500 : fell ? Math.min(SLIDE_MS, edgeMs(dist)) + FALL_MS : SLIDE_MS);

/* ---------------- projection shared by the canvas and the DOM glasses ---------------- */
interface Geo { W: number; H: number; cx: number; y0: number; yH: number; hw0: number; s: (t: number) => number; y: (t: number) => number; hw: (t: number) => number; tOf: (sy: number) => number }
function geo(W: number, H: number, top = 0, bot = H): Geo {
  const h = Math.max(40, bot - top);
  const y0 = bot;
  const yt = top + Math.max(6, h * 0.03);
  const sT = 1 / (1 + K * TMAX);
  const yH = (yt - sT * y0) / (1 - sT);
  // phones: the bar fills the width; wide screens: a bit narrower so the room frames it
  const hw0 = W < 700 ? Math.min(W * 0.47, h * 1.1, 560) : Math.min(W * 0.38, h * 0.95, 620);
  const s = (t: number) => 1 / (1 + K * t);
  const y = (t: number) => yH + (y0 - yH) * s(t);
  const tOf = (sy: number) => { const ss = (sy - yH) / (y0 - yH); return (1 / ss - 1) / K; };
  return { W, H, cx: W / 2, y0, yH, hw0, s, y, hw: (t) => hw0 * s(t), tOf };
}
const TW = TMAX + 0.3;   // the back wall stands this far down the bar
/** lane centres in bar half-widths (-1..1) */
const laneU = (n: number, i: number) => (-1 + (2 * i + 1) / Math.max(1, n)) * SPAN;

const rgbCache = new Map<string, [number, number, number]>();
const rgb = (h: string) => { let v = rgbCache.get(h); if (!v) { v = hexRgb(h); rgbCache.set(h, v); } return v; };
const LANE_A = '#5c3c25', LANE_B = '#533521', WALL = '#2a1611', WALL2 = '#331c14';

/** the saloon + the bar in perspective: calm, few details, painted once per size at a chunky pixel scale */
const RoomCanvas = memo(function RoomCanvas({ W, H, top, bot, mark, lanes }: { W: number; H: number; top: number; bot: number; mark: number; lanes: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || W < 10 || H < 10) return;
    const P = W < 520 ? 2 : 3;
    const cw = Math.ceil(W / P), ch = Math.ceil(H / P);
    cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d'); if (!c) return;
    const g = geo(W, H, top, bot);
    const n = Math.max(1, lanes);
    const img = c.createImageData(cw, ch);
    const d = img.data;
    const put = (x: number, y: number, col: string) => {
      if (x < 0 || y < 0 || x >= cw || y >= ch) return;
      const [r, gg, b] = rgb(col); const i = (y * cw + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    };
    const cxp = g.cx / P;
    const yWall = g.y(TW) / P, hwW = g.hw(TW) / P;
    const y0p = g.y0 / P, hw0p = g.hw0 / P;
    for (let py = 0; py < ch; py++) {
      const sy = (py + 0.5) * P;
      for (let px = 0; px < cw; px++) {
        const dx = px + 0.5 - cxp;
        let col: string;
        if (py < yWall) {
          // back wall: wainscot, rail, plain dark paper with one warm lamp glow
          const v = (yWall - py) / hwW;
          if (v < 0.04) col = PAL.ink;
          else if (v < 0.42) col = Math.abs(((dx / hwW) * 2.4) % 1) < 0.05 ? PAL.wood1 : bayer(px, py) > 0.85 ? PAL.wood3 : PAL.wood2;
          else if (v < 0.48) col = PAL.wood4;
          else {
            const glow = 1 - Math.hypot(dx / hwW / 1.6, (v - 1.3) / 0.9);
            col = glow > 0.55 + bayer(px, py) * 0.4 ? '#4a2516' : glow > 0.2 + bayer(px, py) * 0.3 ? WALL2 : WALL;
          }
        } else if (py >= y0p) {
          // the counter's front face (toward us; the lane plates sit on it) + floor either side
          const fy = py - y0p;
          if (Math.abs(dx) < hw0p) col = fy < 2 ? PAL.lamp3 : fy < 3 ? PAL.ink : bayer(px, py) > 0.9 ? PAL.wood2 : PAL.wood1;
          else col = bayer(px, py) > 0.8 ? PAL.wood1 : PAL.wood0;
        } else {
          const t = g.tOf(sy);
          const hw = g.hw(Math.max(-0.4, t)) / P;
          const u = dx / hw, au = Math.abs(u);
          if (t > 1) {
            // past the end of the bar: dark floor
            col = bayer(px, py) > 0.88 ? PAL.wood1 : PAL.wood0;
          } else if (au <= 1) {
            if (au > 0.965) col = au > 0.99 ? PAL.ink : PAL.lamp3; // brass rail
            else if (au >= SPAN) col = PAL.wood2;
            else {
              const lf = ((u / SPAN + 1) * n) / 2; // lane coordinate
              const li = Math.floor(lf), k = Math.round(lf);
              const edge = Math.abs(lf - k) * (2 * hw * SPAN / n); // art px from the nearest lane divider
              col = k > 0 && k < n && edge < 0.5 ? PAL.wood1 : li % 2 ? LANE_B : LANE_A;
              if (col !== PAL.wood1 && rnd(Math.floor(u * 40), Math.floor(t * 30), 3) > 0.97) col = li % 2 ? LANE_A : LANE_B;
            }
          } else if (au < 1.06) col = PAL.wood1; // side face of the counter
          else col = bayer(px, py) > 0.8 ? PAL.wood1 : PAL.wood0;
        }
        put(px, py, col);
      }
    }
    // end lip of the bar
    const ye = Math.round(g.y(1) / P), hwe = g.hw(1) / P;
    for (let x = Math.round(cxp - hwe); x <= Math.round(cxp + hwe); x++) { put(x, ye - 1, PAL.ink); put(x, ye, PAL.lamp3); put(x, ye + 1, PAL.ink); }
    // the chalk mark: a bold line clean across the bar
    const ym = Math.round(g.y(mark) / P), hwm = g.hw(mark) / P;
    for (let x = Math.round(cxp - hwm * 0.96); x <= Math.round(cxp + hwm * 0.96); x++) {
      put(x, ym - 1, rnd(x, 1, 5) > 0.2 ? PAL.white : PAL.parch);
      put(x, ym, PAL.white);
      if (P === 2) put(x, ym + 1, rnd(x, 2, 5) > 0.5 ? PAL.parch : PAL.parch2);
    }
    c.putImageData(img, 0, 0);
  }, [W, H, top, bot, mark, lanes]);
  return <canvas ref={ref} className="sl-cv" aria-hidden />;
});

/* ---------------- sprites ---------------- */
const GW = 16, GH = 20;
/** whiskey tumbler (clean): glass, amber whiskey with a sloshing surface (tilt -2..2), one highlight */
const drawGlass = (tilt: number): DrawFn => (c) => {
  const r = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  r(2, 18, 13, 2, 'rgba(0,0,0,.45)');
  const L = (y: number) => (y < 9 ? 1 : 2), Rr = (y: number) => (y < 9 ? 15 : 14);
  for (let y = 1; y < 19; y++) {
    const l = L(y), rr = Rr(y);
    r(l, y, 1, 1, PAL.ink); r(rr - 1, y, 1, 1, PAL.ink);
    r(l + 1, y, rr - l - 2, 1, 'rgba(170,192,206,.5)');
  }
  r(2, 18, 12, 1, PAL.ink);
  r(3, 15, 10, 3, '#cfe0ea');
  for (let x = 3; x < 13; x++) {
    const sy = Math.round(8 + ((x - 7.5) / 5) * tilt);
    r(x, sy, 1, 15 - sy, PAL.lamp3);
    r(x, sy, 1, 1, PAL.lamp1);
  }
  r(9, 11, 3, 3, PAL.lamp2);
  r(3, 2, 1, 11, 'rgba(255,246,228,.8)');
  r(2, 0, 12, 1, PAL.ink); r(2, 1, 12, 1, '#cfe0ea');
};
const GLASSES = [-2, -1, 0, 1, 2].map((k) => drawGlass(k));
const glassSprite = (tilt: number) => GLASSES[Math.max(-2, Math.min(2, Math.round(tilt))) + 2];
const sloshAt = (el: number) => {
  if (el < 0) return 0;
  if (el < SLIDE_MS) return 2 * Math.sin(el / 85) * (1 - el / SLIDE_MS * 0.6);
  return 1.6 * Math.sin(el / 70) * Math.exp(-(el - SLIDE_MS) / 260);
};
const SHARDS = Array.from({ length: 10 }, (_, i) => ({ a: (i * 31 + ((i * 13) % 9)) % 180 - 90, d: 22 + ((i * 37) % 34), c: i % 3 === 0 ? PAL.lamp1 : i % 3 === 1 ? '#cfe0ea' : '#9fb6c4' }));

/* ---------------- main ---------------- */
/** the full-screen stage size + the free band (between the header and the plates) the bar runs through */
function useStage() {
  const stage = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState({ w: 0, h: 0, top: 0, bot: 0 });
  useEffect(() => {
    const el = stage.current, z = zone.current; if (!el || !z) return;
    const on = () => {
      const a = el.getBoundingClientRect(), b = z.getBoundingClientRect();
      // centred on the full viewport (the stage is full-screen; nothing docks beside it any more)
      const n = { w: Math.round(a.width), h: Math.round(a.height), top: Math.round(b.top - a.top), bot: Math.round(b.bottom - a.top) };
      setSz((o) => (o.w === n.w && o.h === n.h && o.top === n.top && o.bot === n.bot ? o : n));
    };
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el); ro.observe(z);
    const iv = window.setInterval(on, 700);
    return () => { ro.disconnect(); clearInterval(iv); };
  }, []);
  return [stage, zone, sz] as const;
}

/** narrow lanes: '38" short' -> '-38"', '2 ft past' -> '+2ft', smashed -> 'SMASH' (falls back to the server's label) */
const compact = (label: string) => {
  const m = label.match(/^([\d.]+\s*(?:"|”|ft|in))\s*(short|past|long|over)/i);
  if (m) return (/short/i.test(m[2]) ? '-' : '+') + m[1].replace(/\s+/g, '');
  if (/smash|fell|off the end|crash/i.test(label)) return 'SMASH';
  return label;
};

const replayOf = (r?: MiniResult) => (r && r.data && r.data.length ? { dist: r.data[0], fell: !!r.data[1], at: r.at } : undefined);

export default function Slide({ state, me, send, skew }: RoomProps) {
  const mini = state.mini?.kind === 'slide' ? state.mini : undefined;
  const [stageRef, zoneRef, sz] = useStage();
  const reduce = useMemo(reduced, []);
  const pids = mini?.players ?? [];
  const n = pids.length;
  const mark = mini?.mark ?? 0.8;
  const results = mini?.results ?? {};
  // keep the clock running through every glass's slide + the reveal (winner may land with the last result)
  const lastRest = Math.max(0, ...Object.values(results).map((r) => { const p = replayOf(r); return p ? p.at + restMs(p.dist, p.fell, reduce) : r.at; }));
  const now = useNow(skew, !!mini && (mini.winner === undefined || Date.now() + skew < lastRest + 2500));

  const player = (id?: string): Player | undefined => state.players.find((p) => p.id === id);
  const gameName = (a?: number) => (a === undefined ? '' : state.board.find((g) => g.appid === a)?.name ?? state.pool.find((g) => g.appid === a)?.name ?? `App ${a}`);

  const steady = !!mini && now < mini.startedAt;
  const settledPid = (pid: string) => {
    const r = results[pid]; if (!r) return false;
    const p = replayOf(r); if (!p) return true;
    return now >= p.at + restMs(p.dist, p.fell, reduce);
  };
  const doneCount = pids.filter((pid) => results[pid]).length;
  const allSettled = Object.keys(results).every(settledPid);
  const revealed = mini?.winner !== undefined && allSettled;
  const inGame = pids.includes(me);
  const myRes = results[me];

  /* ---- sounds for each fresh glass (never for ones already at rest when we arrived) ---- */
  const heard = useRef<Set<string>>(new Set());
  const resKey = Object.entries(results).map(([k, r]) => `${k}:${r.at}`).join('|');
  useEffect(() => {
    if (!mini) return;
    for (const [pid, r] of Object.entries(results)) {
      const k = `${pid}:${r.at}`;
      if (heard.current.has(k)) continue;
      heard.current.add(k);
      const p = replayOf(r);
      const age = Date.now() + skew - r.at;
      if (!p || age > 600) continue;
      const loud = pid === me || n <= 3;
      const at = (ms: number, fn: () => void) => window.setTimeout(fn, Math.max(0, ms - age));
      at(0, () => { sfx.swish(); if (loud) sfx.cardSlide(); });
      if (p.fell) {
        const e = reduce ? 500 : Math.min(SLIDE_MS, edgeMs(p.dist)) + FALL_MS * 0.6;
        at(e, () => { sfx.glass(); if (loud) sfx.stamp(); });
        if (pid === me) at(e + 90, () => buzz(BUZZ.hit));
      } else {
        at(reduce ? 500 : SLIDE_MS - 120, () => { sfx.glass(); if (Math.abs(p.dist - mark) * BAR_IN < 6) sfx.clink(); });
      }
    }
  }, [resKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // the winner reveal (skipped for a late join)
  useEffect(() => {
    if (!revealed || !mini) return;
    if (Date.now() + skew - Math.max(lastRest, mini.decidedAt ?? 0) > 2500) return;
    sfx.drawSting();
    const t = window.setTimeout(() => sfx.stamp(), 500);
    buzz(BUZZ.win);
    return () => clearTimeout(t);
  }, [revealed]); // eslint-disable-line react-hooks/exhaustive-deps

  // "go" cue when play opens
  const open = !!mini && inGame && !steady && !myRes && mini.winner === undefined && now < mini.deadline;
  useEffect(() => { if (open) { sfx.spurs(); buzz(BUZZ.myTurn); } }, [open]);

  /* ---- power meter (driven by performance.now from the press: immune to clock skew resets) ---- */
  const roundKey = mini ? `${mini.startedAt}` : '';
  const [charging, setCharging] = useState<number | null>(null);
  const [, force] = useState(0);
  const sentKey = useRef('');
  const [released, setReleased] = useState<{ key: string; power: number } | null>(null);
  const alreadySent = released?.key === roundKey || sentKey.current === roundKey;
  const canHold = open && !alreadySent;
  useEffect(() => { setCharging(null); }, [roundKey]);
  // the server didn't take it (socket blip / too early): unlock so I can try again
  useEffect(() => {
    if (!released || released.key !== roundKey || myRes) return;
    const t = window.setTimeout(() => { if (sentKey.current === released.key) sentKey.current = ''; setReleased(null); }, 2500);
    return () => clearTimeout(t);
  }, [released, roundKey, myRes]);
  useEffect(() => {
    if (charging === null) return;
    let raf = 0;
    const tick = () => { force((x) => x + 1); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [charging]);
  const power = charging !== null ? meter(performance.now() - charging) : released?.key === roundKey ? released.power : 0;

  const ctl = useRef({ canHold, charging, roundKey });
  ctl.current = { canHold, charging, roundKey };
  const startRef = useRef<() => void>(() => {});
  const releaseRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});
  startRef.current = () => {
    if (!ctl.current.canHold || ctl.current.charging !== null) return;
    sfx.click();
    setCharging(performance.now());
  };
  releaseRef.current = () => {
    const { charging: at, canHold: ok, roundKey: k } = ctl.current;
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

  if (!mini) return createPortal(<div className="sl"><div className="sl-title">Lining up the glasses…</div></div>, document.body);

  const g = geo(sz.w, sz.h, sz.top, sz.bot);
  const laneW = (2 * g.hw0 * SPAN) / Math.max(1, n);
  const gs0 = Math.max(24, Math.min(88, laneW * 0.72, (sz.bot - sz.top) * 0.22));
  const sweet = mark / REACH;
  const fallAt = 1 / REACH;
  const holding = charging !== null;
  const startSecs = Math.max(0, Math.ceil((mini.startedAt - now) / 1000));
  const leftSecs = Math.max(0, Math.ceil((mini.deadline - now) / 1000));
  const waiting = n - doneCount;
  const winPid = mini.winnerPid ?? pids.find((pid) => mini.winner !== undefined && mini.backs[pid] === mini.winner && results[pid] && results[pid].score === Math.max(...Object.values(results).map((r) => r.score)));
  const t0 = performance.now();

  let line: JSX.Element;
  if (revealed) line = <div className="sl-verdict"><span className="sl-v-long">Closest to the mark: </span><span className="sl-v-short">Closest: </span><b>{gameName(mini.winner)}</b></div>;
  else if (steady) line = <div className="sl-line">Steady… <b className="sl-count">{startSecs}</b></div>;
  else if (mini.winner !== undefined || (doneCount === n && n > 0)) line = <div className="sl-line">Measuring…</div>;
  else if (canHold) line = <div className="sl-line mine">Your slide for <b>{gameName(mini.backs[me])}</b><em className={leftSecs <= 5 ? 'hot' : ''}>{leftSecs}s</em></div>;
  else line = <div className="sl-line">{waiting === 1 ? '1 glass' : `${waiting} glasses`} to go<em className={leftSecs <= 5 ? 'hot' : ''}>{leftSecs}s</em></div>;

  return createPortal(
    <div className={`sl ${canHold ? 'my-turn' : ''} ${revealed ? 'decided' : ''} ${reduce ? 'reduce' : ''} ${holding ? 'holding' : ''} ${n > 4 ? 'many' : ''}`} role="main" aria-label="Whiskey slide" ref={stageRef}>
      <div className="sl-stage">
        <RoomCanvas W={sz.w} H={sz.h} top={sz.top} bot={sz.bot} mark={mark} lanes={n} />
        {sz.w > 0 && (
          <>
            <div className="sl-mark-lbl" style={{ top: g.y(mark), left: g.cx + g.hw(mark) + 6 }}>MARK</div>
            <div className="sl-end-lbl" style={{ top: g.y(1), left: g.cx - g.hw(1) - 6 }}>END</div>
            {pids.map((pid, i) => {
              const r = results[pid];
              const p = replayOf(r);
              const lane = laneU(n, i);
              let t = 0, fallP = 0, gone = false, tilt = 0;
              if (p) {
                const el = now - p.at;
                tilt = reduce ? 0 : sloshAt(el);
                if (reduce) {
                  t = el < 500 ? 0 : Math.min(p.dist, 1);
                  if (p.fell && el >= 500) gone = true;
                } else if (p.fell) {
                  const e = Math.min(SLIDE_MS, edgeMs(p.dist));
                  if (el < e) t = glassAt(p.dist, el);
                  else { fallP = Math.min(1, (el - e) / FALL_MS); t = 1 + (p.dist - 1) * fallP; gone = fallP >= 1; }
                } else t = glassAt(p.dist, el);
              }
              const mineNow = pid === me && canHold;
              if (mineNow && holding && !reduce) tilt = Math.sin((t0 - (charging ?? 0)) / 110) * 1.4;
              const s = g.s(t);
              const size = gs0 * s;
              const x = g.cx + lane * g.hw(t), y = g.y(t);
              const win = revealed && pid === winPid, lose = revealed && pid !== winPid;
              const smashEl = p?.fell ? now - p.at - (reduce ? 500 : Math.min(SLIDE_MS, edgeMs(p.dist)) + FALL_MS * 0.6) : -1;
              const lift = mineNow && holding ? -Math.max(6, size * 0.16) : 0;
              const style = {
                left: x, top: y, width: size, height: size * GH / GW, zIndex: Math.round(100 - t * 50),
                transform: `translate(-50%, -100%) translateY(${fallP * size * 0.9 + lift}px) rotate(${fallP * (lane >= 0 ? 70 : -70)}deg)`,
                opacity: gone ? 0 : 1 - fallP * 0.85,
              } as CSSProperties;
              const meterSide = lane < 0 ? 'right' : 'left'; // toward the middle of the bar
              const grab = Math.max(88, size * 2.2);
              return (
                <div key={pid}>
                  {!gone && (
                    <div className={`sl-glass ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${pid === me ? 'me' : ''} ${mineNow ? 'mine' : ''} ${mineNow && holding ? 'held' : ''}`} style={style}>
                      <PixelSprite draw={glassSprite(tilt)} w={GW} h={GH} className="sl-glass-sp" />
                    </div>
                  )}
                  {mineNow && (
                    <>
                      <button
                        className={`sl-grab ${holding ? 'held' : ''}`}
                        style={{ left: x, top: y - size * GH / GW / 2, width: grab, height: grab }}
                        onPointerDown={onBtnDown} onPointerUp={onBtnUp} onPointerCancel={onBtnCancel} onLostPointerCapture={onBtnCancel}
                        onContextMenu={(e) => e.preventDefault()}
                        aria-label="Hold your glass, let go to slide"
                      />
                      <div
                        className={`sl-vmeter ${holding ? 'on' : ''} ${meterSide}`}
                        style={{ left: meterSide === 'right' ? x + size * 0.5 + 10 : x - size * 0.5 - 10, top: y - 4, height: Math.max(110, Math.min(220, size * 2.8)) } as CSSProperties}
                        aria-hidden
                      >
                        <i className="sl-vz-fell" style={{ bottom: `${fallAt * 100}%` }} />
                        <i className="sl-vz-sweet" style={{ bottom: `${(sweet - 0.045) * 100}%`, height: '9%' }} />
                        <b className="sl-vneedle" style={{ bottom: `${power * 100}%` }} />
                      </div>
                    </>
                  )}
                  {p?.fell && smashEl >= 0 && smashEl < 1400 && (
                    <div className="sl-smash" style={{ left: x, top: g.y(1) }}>
                      {!reduce && SHARDS.map((sh, k) => <i key={k} style={{ '--a': `${sh.a}deg`, '--d': `${sh.d * Math.max(0.6, s * 1.3)}px`, background: sh.c } as CSSProperties} />)}
                      <b>CRASH</b>
                    </div>
                  )}
                </div>
              );
            })}
            {/* one plate per lane on the counter's front face: who, which game, and the readout */}
            {pids.map((pid, i) => {
              const pl = player(pid);
              const r = results[pid];
              const done = !!r && settledPid(pid);
              const p = replayOf(r);
              const win = revealed && pid === winPid, lose = revealed && pid !== winPid;
              const appid = mini.backs[pid];
              const st = done ? (laneW < 80 ? compact(r!.label) : r!.label) : r ? '…' : '';
              const cls = done ? (p?.fell || r!.score <= 0 ? 'fell' : 'rest') : '';
              return (
                <div key={pid} className={`sl-plate ${pid === me ? 'me' : ''} ${win ? 'win' : ''} ${lose ? 'lose' : ''}`}
                  style={{ left: g.cx + laneU(n, i) * g.hw0, top: g.y0 + 6, width: Math.max(30, laneW - 4) }}>
                  <div className="sl-plate-who">
                    {pl && <MiniBust p={pl} className="sl-plate-bust" />}
                    {appid !== undefined && <span className="sl-plate-cover"><PixelCover appid={appid} name={gameName(appid)} kind="square" /></span>}
                  </div>
                  <div className="sl-plate-name">{pid === me ? 'You' : pl?.name ?? '???'}</div>
                  <div className={`sl-plate-st ${cls}`} title={r?.label}>{st || '\u00a0'}</div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="sl-head">
        <div className="sl-title">Whiskey Slide</div>
        <div className="sl-rules">Closest to the chalk wins. Off the end loses.</div>
        {line}
      </div>

      <div className="sl-zone" ref={zoneRef} />
      <div className="sl-plates-space" />

      <div className="sl-ctl">
        {canHold ? (
          <div className={`sl-tip ${holding ? 'hot' : ''}`}>
            {holding ? 'Let go on the gold!' : 'Hold your glass. Let go to slide.'}
            <small>{!holding ? 'or hold Space' : '\u00a0'}</small>
          </div>
        ) : inGame && alreadySent && !myRes ? (
          <div className="sl-tip">Sent at {Math.round((released?.power ?? 0) * 100)}%</div>
        ) : steady && inGame ? (
          <div className="sl-tip">Get ready to hold your glass</div>
        ) : !inGame && !revealed ? (
          <div className="sl-tip dim">Watching</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
