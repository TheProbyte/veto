// Mini golf finale: everyone plays the same hole at once (state.mini.map picks one of 5 courses), each for the
// finalist game they back. Each client simulates its own ball locally (fixed 120 Hz steps); every rest spot is shared
// as a miniMove so the others see ghost balls; holing out sends golfDone. Fewest strokes (then fastest) wins.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../../props';
import type { Mini, Player, RoomState } from '../../../shared/types';
import { useNow } from '../../net';
import { sfx } from '../../sfx';
import { MiniBust } from '../../pixel/BustPreview';
import { PixelCover } from '../../pixel/PixelCover';
import { PAL, hashStr } from '../../pixel/palette';
import { courseFor, type Course } from './courses';
import { W, H, DT, MAX_STROKES, ROLL_CAP, launch, newEv, resting, shoved, step, type Ball } from './physics';
import { drawBall, drawCourseBg, drawDynamic, drawFlag } from './draw';
import './golf.css';

const GHOST_COLS = ['#ff6a50', '#5ac8fa', '#ffd34a', '#b48cff', '#7ee07e', '#ff9ad5', '#ffb35c', '#9ae6e6'];
const CONF_COLS = [PAL.lamp0, PAL.lamp1, PAL.red1, '#5ac8fa', '#7ee07e', PAL.white, '#ffd34a'];
const HOP_MS = 650;
const CELEBRATE_MS = 2600;

type Phase = 'wait' | 'aim' | 'roll' | 'holed' | 'over';
interface Ghost { x: number; y: number; fx: number; fy: number; t0: number; strokes: number; holed: boolean; col: string }
interface Conf { x: number; y: number; vx: number; vy: number; life: number; col: string }
interface Saved { x: number; y: number; s: number; d?: [number, number]; h?: number }

const colorFor = (pid: string) => GHOST_COLS[hashStr(pid) % GHOST_COLS.length];
const gameNameIn = (st: RoomState, a: number) => st.board.find((g) => g.appid === a)?.name ?? st.pool.find((g) => g.appid === a)?.name ?? `App ${a}`;
const fmtClock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const loadSaved = (k: string): Saved | null => { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) as Saved : null; } catch { return null; } };
const save = (k: string, v: Saved) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** measure the free stage box */
function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const on = () => { const r = el.getBoundingClientRect(); const n = { w: Math.floor(r.width), h: Math.floor(r.height) }; setSz((o) => (o.w === n.w && o.h === n.h ? o : n)); };
    on();
    const ro = new ResizeObserver(on); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, sz] as const;
}

export default function Golf({ state, me, send, skew, on }: RoomProps) {
  const mini = state.mini;
  if (!mini) return createPortal(<div className="gf"><div className="gf-title gf-mid">Raking the greens…</div></div>, document.body);
  return <GolfGame key={`${mini.startedAt}|${mini.map}`} state={state} mini={mini} me={me} send={send} skew={skew} on={on} />;
}

function GolfGame({ state, mini, me, send, skew, on }: RoomProps & { mini: Mini }) {
  const course = courseFor(mini.map);
  const bg = useMemo(() => drawCourseBg(course), [course]);
  const reduce = useMemo(reduced, []);
  const [stageRef, sz] = useBox();
  const cvRef = useRef<HTMLCanvasElement>(null);
  const tagRefs = useRef(new Map<string, HTMLDivElement>());
  const saveKey = `nah.golf.${mini.startedAt}.${me}`;
  const myResult = mini.results[me];

  // layout: portrait course on phones; rotated a quarter turn (tee left, cup right) on wide screens
  const BORDER = 6;
  const rotP = sz.w > sz.h * 1.1;
  const cw = rotP ? H : W, ch = rotP ? W : H;
  const scale = Math.max(1, Math.floor(Math.min((sz.w - BORDER * 2) / cw, (sz.h - BORDER * 2) / ch)));
  const maxDrag = Math.max(80, Math.min(200, Math.min(sz.w, sz.h) * 0.32));
  const view = useRef({ rot: rotP, scale, maxDrag });
  view.current = { rot: rotP, scale, maxDrag };

  // live props for the loop
  const live = useRef({ state, mini, skew, send });
  live.current = { state, mini, skew, send };

  const saved0 = useMemo(() => loadSaved(saveKey), [saveKey]);
  const G = useRef({
    ball: { x: saved0?.x ?? course.tee[0], y: saved0?.y ?? course.tee[1], vx: 0, vy: 0 } as Ball,
    last: [saved0?.x ?? course.tee[0], saved0?.y ?? course.tee[1]] as [number, number],
    strokes: saved0?.s ?? 0,
    phase: (myResult || saved0?.d ? 'over' : 'wait') as Phase,
    simT: -1, rollT: 0, lock: { v: -1 },
    flash: course.circles.map(() => 0),
    conf: [] as Conf[],
    ghosts: new Map<string, Ghost>(),
    aim: null as null | { id: number; x0: number; y0: number },
    angle: Math.atan2(course.hole[1] - course.tee[1], course.hole[0] - course.tee[0]),
    power: 0, kbd: false,
    done: (saved0?.d ?? null) as [number, number] | null,
    holed: !!(saved0?.d && saved0.h === 1) || !!(myResult && myResult.score > 0),
    lastHit: 0, holedAt: 0,
  });
  const [ui, setUi] = useState({ strokes: G.current.strokes, phase: G.current.phase, power: 0 });
  const [toast, setToast] = useState<{ text: string; k: number } | null>(null);
  const [celebrate, setCelebrate] = useState<number | null>(null);
  const [ghostTick, setGhostTick] = useState(0);
  const sync = () => {
    const g = G.current;
    setUi((o) => (o.strokes === g.strokes && o.phase === g.phase && o.power === g.power ? o : { strokes: g.strokes, phase: g.phase, power: g.power }));
  };
  const flashMsg = (text: string) => setToast({ text, k: Date.now() });

  /* ---- ghosts: seed everyone else at the tee, then follow their miniMove events ---- */
  const others = mini.players.filter((pid) => pid !== me);
  useEffect(() => {
    const gs = G.current.ghosts;
    for (const pid of others) if (!gs.has(pid)) gs.set(pid, { x: course.tee[0], y: course.tee[1], fx: course.tee[0], fy: course.tee[1], t0: 0, strokes: 0, holed: false, col: colorFor(pid) });
  }, [others.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => on((e) => {
    if (e.t !== 'mini' || e.pid === me || !Array.isArray(e.data) || e.data.length < 2) return;
    const [x, y, s = 0, h = 0] = e.data.map(Number);
    if (![x, y, s, h].every(Number.isFinite)) return;
    const gs = G.current.ghosts;
    const g0 = gs.get(e.pid) ?? { x: course.tee[0], y: course.tee[1], fx: course.tee[0], fy: course.tee[1], t0: 0, strokes: 0, holed: false, col: colorFor(e.pid) };
    const t = performance.now();
    const u = Math.min(1, (t - g0.t0) / HOP_MS);
    const cx = g0.fx + (g0.x - g0.fx) * u, cy = g0.fy + (g0.y - g0.fy) * u;
    gs.set(e.pid, { ...g0, fx: cx, fy: cy, x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)), t0: t, strokes: Math.max(0, Math.min(99, Math.round(s))), holed: h === 1 });
    setGhostTick((n) => n + 1);
  }), [on, me, course]);
  // players with a result but no event (bots, missed packets): straight into the cup
  useEffect(() => {
    const gs = G.current.ghosts;
    for (const [pid, r] of Object.entries(mini.results)) {
      if (pid === me) continue;
      const g = gs.get(pid);
      if (g && !g.holed && r.score > 0) gs.set(pid, { ...g, fx: g.x, fy: g.y, x: course.hole[0], y: course.hole[1], t0: performance.now(), holed: true, strokes: r.data?.[0] ?? g.strokes });
    }
  }, [mini.results, me, course]);

  /* ---- actions ---- */
  const finish = (strokes: number, holed: boolean) => {
    const g = G.current;
    g.holed = holed;
    const ms = Math.max(0, Math.round(Date.now() + live.current.skew - live.current.mini.startedAt));
    g.done = [strokes, ms];
    live.current.send({ t: 'golfDone', strokes, ms });
    save(saveKey, { x: Math.round(g.ball.x), y: Math.round(g.ball.y), s: strokes, d: g.done, h: holed ? 1 : 0 });
  };
  const shareRest = (holed: boolean) => {
    const g = G.current;
    live.current.send({ t: 'miniMove', data: [Math.round(g.ball.x), Math.round(g.ball.y), g.strokes, holed ? 1 : 0] });
    if (!holed) save(saveKey, { x: Math.round(g.ball.x), y: Math.round(g.ball.y), s: g.strokes });
  };
  const putt = () => {
    const g = G.current;
    if (g.phase !== 'aim' || g.power < 0.06) return;
    const [vx, vy] = launch(g.angle, g.power);
    g.last = [g.ball.x, g.ball.y];
    save(saveKey, { x: Math.round(g.ball.x), y: Math.round(g.ball.y), s: g.strokes + 1 }); // a reload mid-roll keeps the stroke
    g.ball.vx = vx; g.ball.vy = vy;
    g.strokes++; g.rollT = 0; g.phase = 'roll'; g.power = 0; g.aim = null;
    sfx.click();
    sync();
  };

  // re-send golfDone until the server has it (the socket may have been down)
  useEffect(() => {
    if (myResult) return;
    const id = window.setInterval(() => {
      const g = G.current, m = live.current.mini;
      if (g.done && !m.results[me] && Date.now() + live.current.skew < m.deadline) live.current.send({ t: 'golfDone', strokes: g.done[0], ms: g.done[1] });
    }, 2500);
    return () => clearInterval(id);
  }, [myResult, me]);
  useEffect(() => { if (myResult && G.current.phase !== 'over' && G.current.phase !== 'holed') { G.current.phase = 'over'; sync(); } }, [myResult]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- the loop: fixed-step physics + drawing ---- */
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const [cc, cctx] = (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; return [c, x] as const; })();
    let raf = 0, prev = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const g = G.current, { mini: m, skew: sk } = live.current;
      const nowS = Date.now() + sk;
      const tReal = (nowS - m.startedAt) / 1000;
      const pnow = performance.now(), dtR = Math.min(0.1, (pnow - prev) / 1000); prev = pnow;
      if (g.simT < 0 || tReal - g.simT > 0.5) g.simT = Math.max(0, tReal);
      // phase gates
      if (g.phase === 'wait' && nowS >= m.startedAt) { g.phase = 'aim'; sync(); }
      if ((g.phase === 'aim' || g.phase === 'roll') && nowS >= m.deadline && !g.done) { g.phase = 'over'; g.aim = null; g.power = 0; sync(); }
      // physics
      let n = 0;
      while (g.simT < tReal && n++ < 60) {
        const t = g.simT; g.simT += DT;
        if (g.phase === 'aim' && shoved(course, g.ball, t)) { g.phase = 'roll'; g.rollT = 0; g.aim = null; g.power = 0; sfx.stamp(); sync(); }
        if (g.phase !== 'roll') continue;
        const ev = newEv();
        step(course, g.ball, t, ev, g.lock);
        g.rollT += DT;
        if (ev.hit > 35 && pnow - g.lastHit > 90) { g.lastHit = pnow; sfx.cardSlap(); }
        if (ev.bump) { const i = course.circles.findIndex((o) => o.kind === 'bumper' && Math.hypot(o.x - g.ball.x, o.y - g.ball.y) < o.r + 4); if (i >= 0) g.flash[i] = 0.18; sfx.ricochet(); }
        if (ev.cart > 0 && pnow - g.lastHit > 150) { g.lastHit = pnow; sfx.stamp(); }
        if (ev.tunnel) sfx.whoosh();
        if (ev.holed) {
          g.ball.x = course.hole[0]; g.ball.y = course.hole[1]; g.ball.vx = g.ball.vy = 0;
          g.phase = 'holed'; g.holedAt = pnow;
          finish(g.strokes, true); shareRest(true);
          sfx.glass(); window.setTimeout(() => sfx.clink(), 140);
          if (g.strokes === 1) { sfx.coin(); window.setTimeout(() => sfx.yeehaw(), 500); }
          if (!reduce) for (let i = 0; i < 70; i++) {
            const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 70;
            g.conf.push({ x: course.hole[0], y: course.hole[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 1.2 + Math.random() * 1.4, col: CONF_COLS[i % CONF_COLS.length] });
          }
          setCelebrate(g.strokes);
          window.setTimeout(() => { setCelebrate(null); if (G.current.phase === 'holed') { G.current.phase = 'over'; sync(); } }, CELEBRATE_MS);
          sync();
          break;
        }
        if (ev.water || ev.oob) {
          if (ev.water) { g.strokes++; sfx.swish(); flashMsg('Splash! +1 stroke'); } else flashMsg('Back to your spot');
          g.ball.x = g.last[0]; g.ball.y = g.last[1]; g.ball.vx = g.ball.vy = 0; g.lock.v = -1;
        }
        const rest = (g.rollT > 0.05 && resting(course, g.ball, ev)) || g.rollT > ROLL_CAP || ev.water || ev.oob;
        if (rest) {
          g.ball.vx = g.ball.vy = 0;
          shareRest(false);
          if (g.strokes >= MAX_STROKES) { g.phase = 'over'; finish(MAX_STROKES, false); flashMsg(`${MAX_STROKES} strokes: that'll do`); }
          else g.phase = 'aim';
          sync();
        }
      }
      for (let i = 0; i < g.flash.length; i++) g.flash[i] = Math.max(0, g.flash[i] - dtR);

      /* draw (course space) */
      cctx.drawImage(bg, 0, 0);
      drawDynamic(cctx, course, Math.max(0, g.simT), g.flash);
      if (g.phase === 'aim' && g.power > 0.02) {
        const L = 6 + g.power * 46;
        const col = g.power > 0.85 ? '#ff6a50' : g.power > 0.55 ? PAL.lamp1 : PAL.lamp0;
        for (let d = 4; d < L; d += 3) {
          const x = Math.round(g.ball.x + Math.cos(g.angle) * d), y = Math.round(g.ball.y + Math.sin(g.angle) * d);
          cctx.fillStyle = PAL.ink; cctx.fillRect(x + 1, y + 1, 1, 1);
          cctx.fillStyle = col; cctx.fillRect(x, y, 1, 1);
        }
        const ex = g.ball.x + Math.cos(g.angle) * L, ey = g.ball.y + Math.sin(g.angle) * L;
        cctx.fillStyle = col; cctx.fillRect(Math.round(ex) - 1, Math.round(ey), 3, 1); cctx.fillRect(Math.round(ex), Math.round(ey) - 1, 1, 3);
      }
      if (g.conf.length) {
        for (const c of g.conf) {
          c.life -= dtR; c.vx *= 1 - dtR * 1.5; c.vy = c.vy * (1 - dtR * 1.5) + 40 * dtR; c.x += c.vx * dtR; c.y += c.vy * dtR;
          if (c.life > 0) { cctx.fillStyle = c.col; cctx.fillRect(Math.round(c.x), Math.round(c.y), (c.life * 7) % 2 > 1 ? 2 : 1, 1); }
        }
        g.conf = g.conf.filter((c) => c.life > 0);
      }
      /* blit to the display canvas (rotated on wide screens) */
      const { rot } = view.current;
      const dw = rot ? H : W, dh = rot ? W : H;
      if (cv.width !== dw || cv.height !== dh) { cv.width = dw; cv.height = dh; }
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      if (rot) ctx.setTransform(0, 1, -1, 0, H, 0); else ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cc, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // billboards (balls, flag) in display space so they stay upright when the course is turned
      const D = (x: number, y: number): [number, number] => (rot ? [H - y, x] : [x, y]);
      { const [fx, fy] = D(course.hole[0], course.hole[1]); drawFlag(ctx, fx, fy, g.simT); }
      for (const [pid, gh] of g.ghosts) {
        const u = Math.min(1, (pnow - gh.t0) / HOP_MS);
        const [x, y] = D(gh.fx + (gh.x - gh.fx) * u, gh.fy + (gh.y - gh.fy) * u);
        const lift = reduce ? 0 : Math.sin(Math.PI * u) * Math.min(10, 2 + Math.hypot(gh.x - gh.fx, gh.y - gh.fy) * 0.12);
        const gone = gh.holed && u >= 1;
        if (!gone) drawBall(ctx, x, y, gh.col, PAL.white, 0.6, lift);
        const el = tagRefs.current.get(pid);
        if (el) {
          const s = view.current.scale;
          el.style.transform = `translate(${Math.round(x * s)}px, ${Math.round((y - lift - 2) * s)}px)`;
          el.style.opacity = gh.strokes > 0 && !gone ? '1' : '0';
        }
      }
      if (g.phase === 'aim' || g.phase === 'roll' || g.phase === 'wait' || (g.phase === 'over' && !g.holed)) {
        const [x, y] = D(g.ball.x, g.ball.y);
        const pulse = g.phase === 'aim' && !g.aim && Math.floor(pnow / 400) % 2 === 0;
        if (pulse) { ctx.fillStyle = 'rgba(255,231,184,.35)'; ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6); }
        drawBall(ctx, x, y, PAL.white, '#ffffff');
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [course, bg, sz.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- input: drag back from anywhere (slingshot), release to putt ---- */
  const toCourseVec = (u: number, v: number): [number, number] => (view.current.rot ? [v, -u] : [u, v]);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    const g = G.current;
    if (g.phase !== 'aim' || g.aim) return;
    sfx.unlock();
    g.aim = { id: e.pointerId, x0: e.clientX, y0: e.clientY }; g.kbd = false; g.power = 0;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = G.current;
    if (!g.aim || g.aim.id !== e.pointerId || g.phase !== 'aim') return;
    const du = g.aim.x0 - e.clientX, dv = g.aim.y0 - e.clientY; // pull back: the shot goes the other way
    const len = Math.hypot(du, dv);
    const pw = Math.min(1, len / view.current.maxDrag);
    if (len > 4) { const [x, y] = toCourseVec(du, dv); g.angle = Math.atan2(y, x); }
    const q = Math.round(pw * 100) / 100;
    if (q !== g.power) { g.power = q; sync(); }
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = G.current;
    if (!g.aim || g.aim.id !== e.pointerId) return;
    g.aim = null;
    if (g.power >= 0.06) putt(); else { g.power = 0; sync(); }
  };
  const onCancel = () => { const g = G.current; g.aim = null; g.power = 0; sync(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const g = G.current;
      if (g.phase !== 'aim' || g.aim) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      const step = e.shiftKey ? 0.02 : 0.07;
      if (e.key === 'ArrowLeft') g.angle -= step;
      else if (e.key === 'ArrowRight') g.angle += step;
      else if (e.key === 'ArrowUp') g.power = Math.min(1, Math.round((g.power + 0.05) * 100) / 100);
      else if (e.key === 'ArrowDown') g.power = Math.max(0, Math.round((g.power - 0.05) * 100) / 100);
      else if (e.key === ' ' || e.key === 'Enter') { if (g.power >= 0.06) putt(); }
      else return;
      e.preventDefault();
      g.kbd = true; sync();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 1600); return () => clearTimeout(id); }, [toast]);

  /* ---- winner reveal sound ---- */
  const myBack = mini.backs[me] ?? mini.games[0];
  const heardWin = useRef(mini.winner !== undefined);
  useEffect(() => {
    if (mini.winner === undefined || heardWin.current) return;
    heardWin.current = true;
    if (mini.winner === myBack) sfx.yeehaw(); else sfx.glass();
  }, [mini.winner, myBack]);

  const player = (id: string): Player | undefined => state.players.find((p) => p.id === id);
  const myGameName = gameNameIn(state, myBack);
  const phase = ui.phase;
  const showBoard = phase === 'over' && celebrate === null;
  const frameStyle = { width: cw * scale, height: ch * scale } as CSSProperties;

  return createPortal(
    <div className={`gf ${reduce ? 'reduce' : ''} gf-${phase}`} role="main" aria-label="Mini golf">
      <header className="gf-head">
        <div className="gf-for">
          <div className="gf-for-art"><PixelCover appid={myBack} name={myGameName} kind="box" /></div>
          <div className="gf-for-txt"><small>Playing for</small><b>{myGameName}</b></div>
        </div>
        <div className="gf-hole">
          <div className="gf-title">{course.name}</div>
          <div className="gf-sub">Par {course.par} · <span className={ui.strokes >= MAX_STROKES - 2 ? 'hot' : ''}>Stroke {Math.min(ui.strokes + (phase === 'aim' || phase === 'wait' ? 1 : 0), MAX_STROKES)}</span>/{MAX_STROKES}</div>
        </div>
        <Clock deadline={mini.deadline} startedAt={mini.startedAt} skew={skew} />
      </header>

      <div className={`gf-stage ${phase === 'aim' ? 'live' : ''}`} ref={stageRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onLostPointerCapture={onCancel}>
        {sz.w > 0 && (
          <div className="gf-frame" style={frameStyle}>
            <div className="gf-pad">
              <canvas ref={cvRef} className="gf-cv" style={frameStyle} width={cw} height={ch} aria-label={`${course.name}: drag back from anywhere to aim, release to putt`} />
              <div className="gf-tags" aria-hidden>
                {others.map((pid) => {
                  const pl = player(pid);
                  return (
                    <div key={pid} className="gf-tag" ref={(el) => { if (el) tagRefs.current.set(pid, el); else tagRefs.current.delete(pid); }} style={{ '--gc': colorFor(pid), opacity: 0 } as CSSProperties}>
                      <span>{pl && <MiniBust p={pl} className="gf-tag-bust" />}<i>{(pl?.name ?? '?').slice(0, 9)}</i></span>
                    </div>
                  );
                })}
              </div>
            </div>
            {phase === 'wait' && <Steady startedAt={mini.startedAt} skew={skew} course={course} />}
            {toast && <div key={toast.k} className="gf-toast">{toast.text}</div>}
            {celebrate !== null && (
              <div className="gf-cele" aria-live="polite">
                <div className="gf-cele-big">{celebrate === 1 ? 'HOLE IN ONE!' : `Holed in ${celebrate}!`}</div>
                <div className="gf-cele-sub">{celebrate === 1 ? 'Drinks are on you.' : celebrate <= course.par ? 'Smooth as rye.' : 'It counts.'}</div>
              </div>
            )}
          </div>
        )}
        {showBoard && <Board state={state} mini={mini} me={me} course={course} ghosts={G.current.ghosts} tick={ghostTick} mine={G.current.done} />}
      </div>

      <footer className="gf-foot">
        {phase === 'aim' || phase === 'roll' ? (
          <>
            <div className="gf-meter" aria-label="Power"><i style={{ width: `${Math.round(ui.power * 100)}%` }} className={ui.power > 0.85 ? 'hot' : ''} /><span>POWER</span></div>
            <div className="gf-hint">{phase === 'roll' ? 'Rolling…' : ui.power > 0 ? 'Release to putt' : 'Drag back from anywhere · let go to putt'}</div>
          </>
        ) : phase === 'wait' ? <div className="gf-hint">Everyone tees off together. Fewest strokes wins.</div>
          : phase === 'over' && !G.current.holed ? <div className="gf-hint">{G.current.done ? `Out of strokes: ${MAX_STROKES} on the card.` : "Time's up."}</div>
          : <div className="gf-hint">Holed. Watching the others…</div>}
      </footer>
    </div>,
    document.body,
  );
}

function Clock({ deadline, startedAt, skew }: { deadline: number; startedAt: number; skew: number }) {
  const now = useNow(skew);
  const left = deadline - Math.max(now, startedAt);
  return <div className={`gf-clock ${left < 15_000 ? 'hot' : ''}`} aria-label="Time left"><small>Time</small>{fmtClock(left)}</div>;
}

function Steady({ startedAt, skew, course }: { startedAt: number; skew: number; course: Course }) {
  const now = useNow(skew);
  const secs = Math.max(0, Math.ceil((startedAt - now) / 1000));
  const prev = useRef(secs);
  useEffect(() => { if (secs !== prev.current && secs > 0 && secs <= 3) sfx.tick(); prev.current = secs; }, [secs]);
  return (
    <div className="gf-steady">
      <div className="gf-steady-name">{course.name}</div>
      <div className="gf-steady-sub">{course.sub}</div>
      <div className="gf-steady-big">Steady…{secs > 0 && secs <= 5 ? <b> {secs}</b> : null}</div>
    </div>
  );
}

const Board = memo(function Board({ state, mini, me, course, ghosts, mine }: { state: RoomState; mini: Mini; me: string; course: Course; ghosts: Map<string, Ghost>; tick: number; mine: [number, number] | null }) {
  const rows = mini.players.map((pid) => {
    const r = mini.results[pid];
    const gh = ghosts.get(pid);
    const back = mini.backs[pid] ?? mini.games[0];
    let label = r ? r.label : pid === me && mine ? `${mine[0]} strokes` : gh && gh.strokes > 0 ? `on stroke ${gh.strokes + 1}` : 'teeing up…';
    if (r && r.score <= 0) label = r.label || 'Did not finish';
    return { pid, r, back, label, score: r ? r.score : -1 };
  }).sort((a, b) => b.score - a.score);
  const winner = mini.winner;
  const waiting = rows.filter((r) => !r.r).length;
  return (
    <div className={`gf-board ${winner !== undefined ? 'decided' : ''}`}>
      {winner !== undefined ? (
        <div className="gf-win">
          <div className="gf-win-art"><PixelCover appid={winner} name={gameNameIn(state, winner)} kind="box" /></div>
          <div><small>Tonight's pick</small><b>{gameNameIn(state, winner)}</b></div>
        </div>
      ) : <div className="gf-board-title">Scorecard · {course.name}<small>{waiting > 0 ? `waiting on ${waiting}…` : 'tallying…'}</small></div>}
      <ol className="gf-rows">
        {rows.map((row, i) => {
          const pl = state.players.find((p) => p.id === row.pid);
          const win = winner !== undefined && (mini.winnerPid ? row.pid === mini.winnerPid : row.back === winner && i === 0);
          return (
            <li key={row.pid} className={`gf-row ${row.pid === me ? 'me' : ''} ${win ? 'win' : ''} ${row.r ? 'done' : ''}`}>
              <span className="gf-rank">{row.r && row.score > 0 ? i + 1 : '–'}</span>
              <span className="gf-row-bust" style={{ '--gc': colorFor(row.pid) } as CSSProperties}>{pl && <MiniBust p={pl} />}</span>
              <span className="gf-row-name">{pl?.name ?? 'A stranger'}{row.pid === me ? ' (you)' : ''}<small>{row.label}</small></span>
              <span className="gf-row-art" title={gameNameIn(state, row.back)}><PixelCover appid={row.back} name={gameNameIn(state, row.back)} kind="box" /></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
});
