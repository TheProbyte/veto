// HORSE DROP finale: everyone lines up on the saloon roof and does a gainer onto their own saddled horse below.
// Press = jump (backflip while moving outward), hold = TUCK (spin faster), release = OPEN (slow down, spot the saddle).
// Best landing's game wins. My jump is simulated locally (sim.ts); others' are replayed from their input timelines.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../../props';
import type { Mini, MiniResult, Player, RoomEvent } from '../../../shared/types';
import { useNow } from '../../net';
import { sfx } from '../../sfx';
import { MiniBust } from '../../pixel/BustPreview';
import { PixelCover } from '../../pixel/PixelCover';
import { bustFor, legacyStyle, styleSig, type BustLook } from '../../pixel/sprites';
import { hashStr } from '../../pixel/palette';
import { BUZZ, buzz } from '../../scene/haptics';
import {
  HIP0, MAX_INPUTS, ROOF, SEAT, X0, cleanInputs, frameAt, horseVariant, judge, saddleX, simulate, type Jump, type Outcome,
} from './sim';
import {
  HORSE_AX, HORSE_AY, POSES, RIDER_C, drawSky, ease, horseSprite, mixPose, renderBackdrop, riderSprite, toScreen,
  type Geo, type HorseMode, type RPose,
} from './art';
import './horse.css';

const LANE_DX = 4, LANE_DY = 3;   // each depth lane: further right and up (the row receding along the roof edge)
const INTRO_MS = 1900;            // sunny reveal: iris + pan from the stormy saloon
const TAKEOFF_MS = 120;           // spring off the edge before the tuck/open shape takes over
const BLEND_MS = 260;

/** server stores horse scores x10 */
export const showScore = (r: MiniResult | undefined) => (r ? Math.round(r.score / 10) : 0);

interface Replay { inputs: number[]; jump: Jump; start: number } // start: performance.now() of the take-off (-Infinity = already landed)
interface Diver { pid: string; lane: number; saddle: number; variant: number; look: BustLook; sig: string; name: string }

function lookOf(p: Player | undefined, pid: string) {
  const pl = p ?? { id: pid, look: hashStr(pid) % 8 };
  const style = p?.style ?? legacyStyle(pl.look, pid);
  return { look: bustFor({ id: pid, look: pl.look, style }), sig: styleSig({ look: pl.look, style }) };
}

/* ---------------- per-diver pose at a moment ---------------- */
interface Shot { x: number; y: number; deg: number; pose: RPose; farLeg: boolean; horse: HorseMode; horseFrame: number; horseDx: number; dust: number; landed: boolean; straddled: boolean }

function standingShot(perf: number, d: Diver, waiting: boolean): Shot {
  // idle: a little sway; ready crouch-bob while it's go time
  const t = perf / 1000 + d.variant % 10;
  const bob = waiting ? (Math.sin(t * 2.4) + 1) / 2 : 0;
  const pose = waiting ? mixPose(POSES.stand, POSES.ready, 0.25 + bob * 0.35) : POSES.stand;
  const tail = (perf + (d.variant % 3000)) % 2700;
  return { x: X0, y: HIP0 - (waiting ? bob * 0.8 : 0), deg: 0, pose, farLeg: true, horse: 'idle', horseFrame: tail < 260 ? 1 : tail < 520 ? 2 : 0, horseDx: 0, dust: -1, landed: false, straddled: false };
}

function flightShot(j: Jump, el: number, perf: number, variant: number): Shot {
  const f = frameAt(j, Math.min(el, j.landMs));
  const shape = mixPose(POSES.open, POSES.tuck, ease(f.tuck));
  let pose: RPose;
  if (el < TAKEOFF_MS) pose = mixPose(POSES.ready, POSES.takeoff, ease(el / TAKEOFF_MS));
  else if (el < BLEND_MS) pose = mixPose(POSES.takeoff, shape, ease((el - TAKEOFF_MS) / (BLEND_MS - TAKEOFF_MS)));
  else pose = shape;
  const tail = (perf + (variant % 3000)) % 2700;
  if (el < j.landMs) return { x: f.x, y: f.y, deg: f.deg, pose, farLeg: true, horse: 'idle', horseFrame: tail < 260 ? 1 : tail < 520 ? 2 : 0, horseDx: 0, dust: -1, landed: false, straddled: false };
  const tl = Math.min(20000, el - j.landMs);
  if (j.straddled) {
    const settle = Math.exp(-tl / 230);
    const deg = 360 + j.err * settle * Math.cos(tl / 75);
    const sitIn = ease(tl / 160);
    let p = mixPose(shape, POSES.sit, sitIn);
    if (j.score >= 80 && tl > 600) p = mixPose(POSES.sit, POSES.sitUp, ease(Math.min(1, (tl - 600) / 220)) * (0.75 + 0.25 * Math.sin((tl - 600) / 140)));
    return { x: f.x, y: SEAT - (tl < 140 ? 1 : 0), deg, pose: p, farLeg: tl < 120, horse: tl < 140 ? 'thud' : 'idle', horseFrame: tail < 260 ? 1 : tail < 520 ? 2 : 0, horseDx: 0, dust: tl, landed: true, straddled: true };
  }
  // miss: keep tumbling into the dirt, the horse rears and bolts
  const p = Math.min(1, tl / 330);
  const target = 360 + (j.err < 0 ? -90 : 90);
  const deg = f.deg + (target - f.deg) * ease(p);
  const y = SEAT + (3 - SEAT) * p * p;
  const x = f.x + 7 * (1 - (1 - p) * (1 - p));
  const run = Math.max(0, tl - 260) / 1000;
  return {
    x, y, deg, pose: mixPose(shape, POSES.sprawl, ease(p)), farLeg: true,
    horse: tl < 260 ? 'rear' : 'gallop', horseFrame: Math.floor(tl / 70) & 3, horseDx: 90 * run * run + 25 * run, dust: tl, landed: true, straddled: false,
  };
}

/** final pose for a result with no replay data (bots): seated if they scored, else in the dirt */
function staticShot(score100: number, variant: number): Shot {
  const ok = score100 >= 20;
  const err = ok ? 0 : (variant & 1 ? -40 : 40);
  const j = { ...judge(err, ok ? 0 : 12), frames: [{ t: 0, x: X0 + 44, y: SEAT, deg: 360 + err, tuck: 0 }], landMs: 0, err, dx: 0 } as Jump;
  return flightShot(j, 20000, 0, variant);
}

/* ---------------- drawing ---------------- */
function drawDust(c: CanvasRenderingContext2D, x: number, y: number, tl: number, big: boolean) {
  if (tl < 0 || tl > 650) return;
  const k = tl / 650;
  const n = big ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i / (n - 1));
    const r = 3 + k * (big ? 14 : 9);
    const px = Math.round(x + Math.cos(a) * r * (i % 2 ? 1 : 0.7));
    const py = Math.round(y - Math.sin(a) * r * 0.45 - k * 3);
    if ((i * 7 + 3) % 16 / 16 > k * 1.1) {
      c.fillStyle = i % 3 ? '#e0c08a' : '#f0dcb0';
      c.fillRect(px, py, big ? 2 : 1, big ? 2 : 1);
    }
  }
}

function drawMarker(c: CanvasRenderingContext2D, x: number, y: number, perf: number) {
  const b = Math.round((Math.sin(perf / 180) + 1) * 1);
  c.fillStyle = '#0b0705'; c.fillRect(x - 3, y - 6 + b, 7, 1); c.fillRect(x - 2, y - 5 + b, 5, 1); c.fillRect(x - 1, y - 4 + b, 3, 1);
  c.fillStyle = '#ffb35c'; c.fillRect(x - 2, y - 6 + b, 5, 1); c.fillRect(x - 1, y - 5 + b, 3, 1);
}

/* ---------------- component ---------------- */
type MyPhase = 'ready' | 'air' | 'landed';

export default function Horse(p: RoomProps) {
  const { state, me, send, skew, on } = p;
  const mini = state.mini;
  const now = useNow(skew);
  const players = mini?.players ?? [];
  const playing = !!mini && players.includes(me);

  const divers = useMemo<Diver[]>(() => {
    if (!mini) return [];
    const order = [...players].sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
    return order.map((pid, lane) => {
      const pl = state.players.find((x) => x.id === pid);
      const { look, sig } = lookOf(pl, pid);
      return { pid, lane, saddle: saddleX(mini.seed, pid), variant: horseVariant(mini.seed, pid), look, sig, name: pl?.name ?? 'A stranger' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mini?.seed, players.join(','), me, state.players.map((x) => `${x.id}${x.name}${x.style ? styleSig(x) : x.look}`).join('|')]);

  // refs the animation loop reads
  const live = useRef({ mini, divers, me, skew });
  live.current = { mini, divers, me, skew };
  const replays = useRef(new Map<string, Replay>());
  const landedSeen = useRef(new Set<string>());
  const my = useRef<{ phase: MyPhase; inputs: number[]; takeoff: number; held: boolean; sent: boolean }>({ phase: 'ready', inputs: [], takeoff: 0, held: false, sent: false });
  const mountAt = useRef(performance.now());
  const introOn = useRef(!!mini && mini.startedAt - (Date.now() + skew) > 900);
  const stageRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);

  const [held, setHeld] = useState(false);
  const [phase, setPhase] = useState<MyPhase>('ready');
  const [mine, setMine] = useState<{ score: number; label: string; outcome: Outcome } | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [goFlash, setGoFlash] = useState(false);

  // results already in at mount: final poses, no replays (also: I already jumped -> no second jump)
  const initDone = useRef(false);
  if (!initDone.current && mini) {
    initDone.current = true;
    for (const [pid, r] of Object.entries(mini.results)) {
      landedSeen.current.add(pid);
      if (r.data && r.data.length) {
        const inputs = cleanInputs(r.data);
        replays.current.set(pid, { inputs, jump: simulate(inputs, saddleX(mini.seed, pid)), start: -Infinity });
      }
    }
    if (mini.results[me]) { my.current.phase = 'landed'; my.current.sent = true; }
  }
  useEffect(() => { if (my.current.phase === 'landed') setPhase('landed'); }, []);

  // live replays: relayed miniMove events, plus stored result data (whichever arrives first)
  const startReplay = (pid: string, data: number[] | undefined) => {
    const m = live.current.mini;
    if (!m || pid === live.current.me || replays.current.has(pid) || !data || !data.length) return;
    const inputs = cleanInputs(data);
    replays.current.set(pid, { inputs, jump: simulate(inputs, saddleX(m.seed, pid)), start: performance.now() });
    sfx.whoosh();
  };
  const startRef = useRef(startReplay);
  startRef.current = startReplay;
  useEffect(() => on((e: RoomEvent) => { if (e.t === 'mini') startRef.current(e.pid, e.data); }), [on]);
  useEffect(() => {
    if (!mini) return;
    for (const [pid, r] of Object.entries(mini.results)) if (r.data) startReplay(pid, r.data);
  }); // every render; startReplay dedupes

  /* ---------------- input ---------------- */
  const serverNow = () => Date.now() + live.current.skew;
  const canJump = () => {
    const m = live.current.mini;
    if (!m || !m.players.includes(live.current.me) || m.results[live.current.me]) return false;
    const t = serverNow();
    return t >= m.startedAt && t < m.deadline;
  };
  const press = () => {
    const s = my.current;
    if (s.held) return;
    if (s.phase === 'ready') {
      if (!canJump()) return;
      s.phase = 'air'; s.takeoff = performance.now(); s.inputs = [0]; s.held = true;
      setPhase('air'); setHeld(true);
      sfx.whoosh();
      return;
    }
    if (s.phase === 'air' && s.inputs.length < MAX_INPUTS) {
      s.inputs.push(Math.max(s.inputs[s.inputs.length - 1], Math.round(performance.now() - s.takeoff)));
      s.held = true; setHeld(true);
      sfx.swish();
    }
  };
  const release = () => {
    const s = my.current;
    if (!s.held) return;
    s.held = false; setHeld(false);
    if (s.phase === 'air' && s.inputs.length < MAX_INPUTS) s.inputs.push(Math.max(s.inputs[s.inputs.length - 1], Math.round(performance.now() - s.takeoff)));
  };
  const pressRef = useRef({ press, release });
  pressRef.current = { press, release };
  useEffect(() => {
    const up = () => pressRef.current.release();
    const vis = () => { if (document.hidden) up(); };
    const kd = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (e.repeat) return;
      pressRef.current.press();
    };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); up(); } };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  /* ---------------- animation loop ---------------- */
  useEffect(() => {
    let raf = 0;
    let geoKey = '';
    let back: HTMLCanvasElement | null = null;
    let geo: Geo | null = null;
    let P = 2;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const cv = cvRef.current, st = stageRef.current;
      const { mini: m, divers: ds, me: meId } = live.current;
      if (!cv || !st || !m) return;
      const sw = st.clientWidth, sh = st.clientHeight;
      if (sw < 10 || sh < 10) return;
      P = Math.max(1, Math.min(Math.floor(sh / 150), Math.floor(sw / 120)));
      const W = Math.ceil(sw / P), H = Math.ceil(sh / P);
      const lanes = Math.max(1, ds.length);
      const ox = Math.max(18, Math.round(W / 2 - (24 + 2 * (lanes - 1))));
      const oy = H - Math.max(10, Math.round(H * 0.08));
      const key = `${W}x${H}x${lanes}x${ox}x${oy}`;
      if (key !== geoKey) {
        geoKey = key;
        geo = { W, H, ox, oy, lanes, dx: LANE_DX, dy: LANE_DY };
        back = renderBackdrop(geo, ROOF);
        cv.width = W; cv.height = H;
        cv.style.width = `${W * P}px`; cv.style.height = `${H * P}px`;
        cv.style.left = `${Math.floor((sw - W * P) / 2)}px`;
        cv.style.top = `${sh - H * P}px`;
      }
      const g = geo!;
      const c = cv.getContext('2d')!;
      c.imageSmoothingEnabled = false;
      const perf = performance.now();
      // intro pan: the street rises into view as the iris opens
      const it = introOn.current ? Math.min(1, (perf - mountAt.current) / INTRO_MS) : 1;
      const pan = Math.round((1 - ease(it)) * 70);
      c.fillStyle = '#3f8fd6'; c.fillRect(0, 0, W, H);
      c.drawImage(back!, 0, pan);
      c.save(); c.translate(0, pan);
      drawSky(c, g, perf);
      // others' standing lane order: back to front
      const t = Date.now() + live.current.skew;
      const go = t >= m.startedAt && t < m.deadline;
      for (let i = ds.length - 1; i >= 0; i--) {
        const d = ds[i];
        let shot: Shot;
        const rep = d.pid === meId && my.current.phase === 'air' ? null : replays.current.get(d.pid);
        if (d.pid === meId && my.current.phase === 'air') {
          const el = perf - my.current.takeoff;
          const j = simulate(my.current.inputs, d.saddle, el);
          if (j.landMs >= 0 && el >= j.landMs) {
            // landed: lock in the timeline (drop anything after touchdown), score it, tell everyone
            const inputs = cleanInputs(my.current.inputs.filter((v) => v <= j.landMs));
            const fin = simulate(inputs, d.saddle);
            my.current.phase = 'landed'; my.current.inputs = inputs;
            replays.current.set(meId, { inputs, jump: fin, start: my.current.takeoff });
            landedSeen.current.add(meId);
            if (!my.current.sent) {
              my.current.sent = true;
              send({ t: 'miniMove', data: inputs.slice(0, MAX_INPUTS) });
              send({ t: 'horseDone', score: fin.score, inputs: inputs.slice(0, MAX_INPUTS) });
            }
            if (fin.straddled) { sfx.stamp(); buzz(BUZZ.crack); if (fin.outcome === 'perfect') { sfx.win(); buzz(BUZZ.win); } }
            else { sfx.glass(); buzz(BUZZ.hit); }
            setPhase('landed'); setHeld(false); my.current.held = false;
            setMine({ score: fin.score, label: fin.label, outcome: fin.outcome });
            shot = flightShot(fin, el, perf, d.variant);
          } else shot = flightShot(j, el, perf, d.variant);
        } else if (rep) {
          const el = perf - rep.start;
          shot = flightShot(rep.jump, el, perf, d.variant);
          if (shot.landed && !landedSeen.current.has(d.pid)) {
            landedSeen.current.add(d.pid);
            if (rep.jump.straddled) sfx.stamp(); else sfx.glass();
            setToast({ text: `${d.name}: ${rep.jump.label}${rep.jump.straddled ? ` ${rep.jump.score}` : ''}`, key: perf });
          }
        } else if (m.results[d.pid]) {
          shot = staticShot(showScore(m.results[d.pid]), d.variant);
        } else shot = standingShot(perf + i * 517, d, go);
        // horse
        const hs = horseSprite(d.variant, shot.horse, shot.horseFrame);
        const [hx, hy] = toScreen(g, d.saddle + shot.horseDx, 0, d.lane);
        c.drawImage(hs, Math.round(hx - HORSE_AX), Math.round(hy - HORSE_AY + 1));
        // rider
        const sp = riderSprite(d.sig, d.look, shot.pose, shot.deg, { farLeg: shot.farLeg, blink: !shot.landed && ((perf + d.variant) % 3100) < 120 });
        const [rx, ry] = toScreen(g, shot.x, shot.y, d.lane);
        c.drawImage(sp, Math.round(rx - RIDER_C / 2), Math.round(ry - RIDER_C / 2));
        if (shot.dust >= 0) drawDust(c, rx, toScreen(g, 0, shot.straddled ? 2 : 0, d.lane)[1], shot.dust, !shot.straddled);
        if (d.pid === meId && my.current.phase === 'ready' && !m.results[meId]) drawMarker(c, Math.round(rx), Math.round(ry - 24), perf);
      }
      c.restore();
      // iris: from the dark, stormy saloon out into the sun
      if (it < 1) {
        const mx = g.ox + X0, myy = g.oy - HIP0 + pan;
        const R = Math.hypot(W, H) * ease(Math.max(0, (it - 0.12) / 0.88));
        c.fillStyle = '#0b0705';
        for (let y = 0; y < H; y++) {
          const dy = y - myy;
          const hw = R * R - dy * dy > 0 ? Math.floor(Math.sqrt(R * R - dy * dy)) : -1;
          if (hw < 0) c.fillRect(0, y, W, 1);
          else { c.fillRect(0, y, Math.max(0, mx - hw), 1); c.fillRect(mx + hw, y, W, 1); }
        }
        // rain on the dark
        c.fillStyle = '#3a5470';
        for (let i = 0; i < 40; i++) {
          const rx = Math.floor((i * 37 + perf / 3) % W), ry = Math.floor((i * 53 + perf / 1.5) % H);
          if (Math.hypot(rx - mx, ry - myy) > R) c.fillRect(rx, ry, 1, 3);
        }
        if (it < 0.5) { c.globalAlpha = (0.5 - it) * 0.9; c.fillStyle = '#1e2c3d'; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [send]);

  /* ---------------- countdown + timers ---------------- */
  const pre = mini ? Math.ceil((mini.startedAt - now) / 1000) : 0;
  const lastTick = useRef(0);
  useEffect(() => {
    if (pre > 0 && pre <= 3 && lastTick.current !== pre) { lastTick.current = pre; sfx.tick(); }
    if (pre <= 0 && lastTick.current > 0) { lastTick.current = 0; setGoFlash(true); const id = window.setTimeout(() => setGoFlash(false), 800); return () => window.clearTimeout(id); }
  }, [pre]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 2600); return () => window.clearTimeout(id); }, [toast]);

  if (!mini) return createPortal(<div className="hd"><div className="hd-title hd-wait">Saddling up…</div></div>, document.body);

  const gameName = (a: number | undefined) => (a === undefined ? '' : state.board.find((x) => x.appid === a)?.name ?? state.pool.find((x) => x.appid === a)?.name ?? `App ${a}`);
  const myBack = mini.backs[me];
  const left = Math.max(0, Math.ceil((mini.deadline - now) / 1000));
  const started = now >= mini.startedAt;
  const timeUp = now >= mini.deadline;
  const iDone = !!mini.results[me] || phase === 'landed';
  const showBoard = !playing || iDone || timeUp || mini.winner !== undefined;

  let line: ReactNode;
  if (mini.winner !== undefined) line = <span className="hd-verdict"><b>{gameName(mini.winner)}</b> wins!</span>;
  else if (!started) line = <span>Steady… <em>{Math.max(1, pre)}</em></span>;
  else if (!playing) line = <span>Watching the jumps <em className={left <= 5 ? 'hot' : ''}>{left}s</em></span>;
  else if (phase === 'ready' && !timeUp) line = <span><b>Tap</b> to jump · <b>hold</b> to tuck · let go to open <em className={left <= 5 ? 'hot' : ''}>{left}s</em></span>;
  else if (phase === 'air') line = <span>{held ? 'TUCK!' : 'Open up… spot the saddle'}</span>;
  else line = <span>Waiting on the others… <em className={left <= 5 ? 'hot' : ''}>{left}s</em></span>;

  const holdLabel = !started ? 'STEADY…' : timeUp && phase === 'ready' ? "TIME'S UP" : phase === 'air' ? (held ? 'TUCK' : 'OPEN') : 'HOLD';

  return createPortal(
    <div className={`hd${phase === 'air' ? ' in-air' : ''}`}>
      <header className="hd-head">
        <div className="hd-title">Horse Drop</div>
        <div className="hd-line">{line}</div>
        {playing && myBack !== undefined && (
          <div className="hd-for"><PixelCover appid={myBack} name={gameName(myBack)} className="hd-for-cover" /> <span>for <b>{gameName(myBack)}</b></span></div>
        )}
      </header>
      <div className="hd-stage" ref={stageRef} onPointerDown={(e) => { if (e.button === 0 || e.pointerType !== 'mouse') pressRef.current.press(); }} style={{ touchAction: 'none' } as CSSProperties}>
        <canvas ref={cvRef} className="hd-cv" aria-hidden />
        {!started && <div className="hd-count" key={pre}>{pre > 3 ? 'Steady…' : Math.max(1, pre)}</div>}
        {goFlash && <div className="hd-count hd-go">JUMP!</div>}
        {mine && (
          <div className={`hd-result ${mine.outcome}`} key="mine">
            <div className="hd-result-label">{mine.label}</div>
            <div className="hd-result-score">{mine.score}</div>
          </div>
        )}
        {toast && <div className="hd-toast" key={toast.key}>{toast.text}</div>}
      </div>
      <footer className={`hd-ctl${showBoard ? ' board' : ''}`}>
        {showBoard
          ? <Board mini={mini} me={me} players={state.players} gameName={gameName} />
          : (
            <button
              type="button"
              className={`hd-hold${held ? ' held' : ''}`}
              disabled={!started || (timeUp && phase === 'ready')}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } pressRef.current.press(); }}
              onPointerUp={() => pressRef.current.release()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="hd-hold-big">{holdLabel}</span>
              <small>{phase === 'air' ? 'hold = spin faster · let go = slow down' : 'tap = jump · hold = tuck'}</small>
            </button>
          )}
      </footer>
    </div>,
    document.body,
  );
}

/* ---------------- scoreboard ---------------- */
function Board({ mini, me, players, gameName }: { mini: Mini; me: string; players: Player[]; gameName: (a: number | undefined) => string }) {
  const rows = mini.players.map((pid) => ({ pid, r: mini.results[pid], p: players.find((x) => x.id === pid) }));
  rows.sort((a, b) => (b.r ? b.r.score : -1) - (a.r ? a.r.score : -1));
  const decided = mini.winner !== undefined;
  return (
    <div className="hd-board">
      {rows.map(({ pid, r, p }) => {
        const back = mini.backs[pid];
        const won = decided && back === mini.winner;
        const label = r ? (r.label || labelFor(r, mini.seed, pid)) : 'on the roof…';
        return (
          <div key={pid} className={`hd-row${pid === me ? ' me' : ''}${won ? ' won' : ''}${decided && !won ? ' lost' : ''}${mini.winnerPid === pid ? ' champ' : ''}`}>
            <MiniBust p={p ?? { id: pid, look: hashStr(pid) % 8 }} className="hd-row-bust" />
            <div className="hd-row-txt">
              <div className="hd-row-name">{p?.name ?? 'A stranger'}{pid === me && <i> (you)</i>}{mini.winnerPid === pid && <span className="hd-star">★</span>}</div>
              <div className="hd-row-label">{label}</div>
            </div>
            <div className="hd-row-score">{r ? showScore(r) : '—'}</div>
            {back !== undefined && <PixelCover appid={back} name={gameName(back)} className="hd-row-cover" />}
          </div>
        );
      })}
    </div>
  );
}

function labelFor(r: MiniResult, seed: number, pid: string) {
  if (r.data && r.data.length) return simulate(cleanInputs(r.data), saddleX(seed, pid)).label;
  return r.score >= 200 ? 'Landed it' : 'Missed the horse';
}

