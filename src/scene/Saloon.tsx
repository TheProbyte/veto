import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { RoomProps } from '../props';
import type { Phase, Player, ShotEvent } from '../../shared/types';
import { sfx } from '../sfx';
import TinStar from './TinStar';
import ShotFX from './ShotFX';
import SoundMenu from './SoundMenu';
import { DockBoard, DockSlot, play } from './Dock';
import { BUZZ, buzz, isPhone, reducedMotion } from './haptics';
import { PixelScene } from '../pixel/PixelCanvas';
import { computeLayout, seatGeom, type Layout, type SceneData, type ScenePlayer } from '../pixel/scene';

const mq = (q: string) => { try { return !!window.matchMedia?.(q).matches; } catch { return false; } };
/** landscape phone: lobby/nominate put the scene on the left half and the panel on the right */
const landPhone = () => mq('(max-height: 500px) and (orientation: landscape)');

/** like usePixelLayout, but the scene can be told to use only the left half of the screen */
function useStageLayout(split: boolean): Layout {
  const calc = () => computeLayout(split ? Math.ceil(window.innerWidth / 2) : window.innerWidth, window.innerHeight);
  const [L, setL] = useState(calc);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { const n = calc(); setL((o) => (o.W === n.W && o.H === n.H && o.P === n.P && o.vw === n.vw ? o : n)); });
    };
    on();
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, [split]); // eslint-disable-line react-hooks/exhaustive-deps
  return L;
}

interface Wipe { id: number; from: Phase; to: Phase; draw: boolean; closing: boolean }
const WIPE = { draw: { close: 420, hold: 640, open: 420 }, soft: { close: 220, hold: 70, open: 260 } };

export default function Saloon({ state, me, children }: RoomProps & { children: ReactNode }) {
  const [fx, setFx] = useState<ShotEvent | null>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const [land, setLand] = useState(landPhone);
  useEffect(() => {
    const on = () => setLand(landPhone());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // ---- phase-change wipe: detected during render so the new phase never paints before the iris closes
  const [seenPhase, setSeenPhase] = useState<Phase>(state.phase);
  const [wipe, setWipe] = useState<Wipe | null>(null);
  if (seenPhase !== state.phase) {
    setSeenPhase(state.phase);
    const draw = seenPhase === 'nominate' && state.phase === 'veto';
    setWipe(reducedMotion() ? (draw ? { id: Date.now(), from: seenPhase, to: state.phase, draw, closing: false } : null)
      : { id: Date.now(), from: seenPhase, to: state.phase, draw, closing: true });
  }
  const frozen = useRef<ReactNode>(children);
  const closing = !!wipe?.closing;
  // (a render that just detected the phase change is thrown away and redone; never let it snapshot the new phase)
  if (!closing && seenPhase === state.phase) frozen.current = children;
  const phase: Phase = closing ? wipe!.from : state.phase;
  useEffect(() => {
    if (!wipe) return;
    const T = wipe.draw ? WIPE.draw : WIPE.soft;
    const timers: number[] = [];
    // drawSting lands ~0.45s after the call, i.e. right as DRAW! slams in at T.close
    if (wipe.draw) { play('cardRiffle'); timers.push(window.setTimeout(() => { if (!play('drawSting')) sfx.shot(); }, Math.max(0, T.close - 450))); }
    if (wipe.closing) timers.push(window.setTimeout(() => setWipe((w) => (w && w.id === wipe.id ? { ...w, closing: false } : w)), T.close + T.hold / 2));
    timers.push(window.setTimeout(() => setWipe((w) => (w && w.id === wipe.id ? null : w)), T.close + T.hold + T.open + 40));
    return () => timers.forEach(clearTimeout);
  }, [wipe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const split = land && (phase === 'lobby' || phase === 'nominate');
  const layout = useStageLayout(split);
  const shotRef = useRef<SceneData['shot']>(undefined);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // first gesture: unlock audio + start ambience
  useEffect(() => {
    const go = () => { sfx.unlock(); sfx.ambience(true); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  }, []);

  // chair scrape + nameplate pop when someone new sits down
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const ids = new Set(state.players.map((p) => p.id));
    const added: string[] = [];
    if (seen.current) for (const id of ids) if (!seen.current.has(id)) added.push(id);
    seen.current = ids;
    if (!added.length) return;
    sfx.chair();
    setFresh((f) => new Set([...f, ...added]));
    const t = window.setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((id) => n.delete(id)); return n; }), 1400);
    return () => clearTimeout(t);
  }, [state.players]);

  // shot animations (never on first mount)
  const lastId = useRef<number | undefined>(state.lastShot?.id);
  useEffect(() => {
    const s = state.lastShot;
    if (!s || s.id === lastId.current) return;
    lastId.current = s.id;
    shotRef.current = { at: performance.now(), actor: s.actor, kind: s.kind };
    setFx(s);
    const timers: number[] = [];
    const P = layout.P;
    // phones get a shorter FX (CSS uses --fxd too) and no shake of the scrolling overlay:
    // a transform there would re-anchor the fixed action bar mid-animation.
    const phone = isPhone();
    const dur = phone ? 1600 : 2700;
    const shake = !phone && !reducedMotion();
    const stepKf = (pts: [number, number][]): Keyframe[] => pts.map(([x, y]) => ({ transform: `translate(${x * P}px, ${y * P}px)`, easing: 'steps(1, end)' }));
    if (s.kind === 'ricochet') {
      sfx.ricochet();
      buzz(BUZZ.ricochet);
      if (shake) frontRef.current?.animate(stepKf([[0, 0], [-1, 0], [1, 0], [-1, 0], [0, 0]]), { duration: 260 });
    } else {
      sfx.shot();
      buzz(s.kind === 'crack' ? BUZZ.crack : BUZZ.hit);
      if (shake) frontRef.current?.animate(stepKf([[0, 0], [-3, 2], [3, -2], [-2, 1], [2, -1], [-1, 0], [0, 0]]), { duration: 440 });
      if (s.kind !== 'crack') timers.push(window.setTimeout(() => sfx.stamp(), Math.round(dur * 0.252)));
    }
    timers.push(window.setTimeout(() => setFx((f) => (f && f.id === s.id ? null : f)), dur));
    return () => timers.forEach(clearTimeout);
  }, [state.lastShot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const veto = state.phase === 'veto';
  const shooter = veto ? state.turnOrder[state.turnIdx] : undefined;

  const data: SceneData = useMemo(() => ({
    players: state.players.map((p) => ({ id: p.id, seat: p.seat, look: p.look, style: p.style, connected: p.connected }) as ScenePlayer),
    shooter,
    phase: state.phase,
    shot: shotRef.current,
    dimAll: state.phase === 'roulette' ? 0.45 : state.phase === 'result' ? 0.6 : 1,
  }), [state.players, shooter, state.phase, fx]); // eslint-disable-line react-hooks/exhaustive-deps

  const stageTop = layout.tableTop * layout.P + (layout.portrait ? 30 : 44);
  const seats = useMemo(() => state.players.map((p) => p.seat), [state.players]);
  const table = phase === 'lobby' || phase === 'nominate';

  return (
    <div className={`saloon phase-${phase} ${shooter ? 'has-shooter' : ''} ${table ? 'has-dock' : ''} ${split ? 'is-split' : ''}`} style={{ '--P': `${layout.P}px`, '--stage-top': `${stageTop}px` } as CSSProperties}>
      <div className="scene">
        <PixelScene layout={layout} data={data} />
        <div className={`seats ${layout.portrait && state.players.length > 4 ? 'has-back' : ''}`}>
          {state.players.map((p) => (
            <Seat key={p.id} p={p} me={me} L={layout} seats={seats} shooter={shooter} order={veto ? state.turnOrder.indexOf(p.id) : -1} turnIdx={state.turnIdx} n={state.turnOrder.length} fresh={fresh.has(p.id)} />
          ))}
        </div>
      </div>

      <div className="saloon-ui">
        <div className="front-top" aria-hidden />
        <div className="saloon-front" ref={frontRef}>
          <DockSlot.Provider value={slot}>
            <div className="saloon-stage">{closing ? frozen.current : children}</div>
          </DockSlot.Provider>
        </div>
        {table && (
          <div className="dock" role="region" aria-label="The dealer's table">
            <div className="dock-in">
              {phase === 'nominate' && <DockBoard board={state.board} players={state.players} me={me} />}
              <div className="dock-actions" ref={setSlot} />
            </div>
          </div>
        )}
      </div>

      {fx && <ShotFX key={fx.id} shot={fx} board={state.board} players={state.players} />}

      {wipe && <PhaseWipe key={wipe.id} w={wipe} />}

      <SoundMenu phase={state.phase} />
    </div>
  );
}

/** pixel iris: black tiles close in rings toward the centre, then open from it (opacity only) */
function PhaseWipe({ w }: { w: Wipe }) {
  const T = w.draw ? WIPE.draw : WIPE.soft;
  const tiles = useMemo(() => {
    if (!w.closing) return [];
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = Math.max(26, Math.ceil(Math.max(vw, vh) / 26));
    const cols = Math.ceil(vw / size), rows = Math.ceil(vh / size);
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    const maxD = Math.hypot(cx, cy) || 1;
    const out: { x: number; y: number; d: number }[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      // quantize into rings so it reads as a stepped pixel iris
      const d = Math.round((Math.hypot((x - cx) * 1.0, (y - cy) * 1.0) / maxD) * 7) / 7;
      out.push({ x, y, d });
    }
    return out.map((t) => ({ ...t, size }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`wipe ${w.draw ? 'is-draw' : ''} ${w.closing ? '' : 'is-instant'}`} aria-hidden style={{ '--wc': `${T.close}ms`, '--wh': `${T.hold}ms`, '--wo': `${T.open}ms` } as CSSProperties}>
      {tiles.map((t, i) => (
        <i key={i} style={{ left: t.x * t.size, top: t.y * t.size, width: t.size + 1, height: t.size + 1,
          '--d1': `${Math.round((1 - t.d) * T.close * 0.85)}ms`, '--d2': `${Math.round(T.close + T.hold + t.d * T.open * 0.85)}ms` } as CSSProperties} />
      ))}
      {w.draw && <div className="draw-title"><span>DRAW!</span></div>}
    </div>
  );
}

function Seat({ p, me, L, seats, shooter, order, turnIdx, n, fresh }: { p: Player; me: string; L: Layout; seats: number[]; shooter?: string; order: number; turnIdx: number; n: number; fresh?: boolean }) {
  const g = seatGeom(L, p.seat, seats);
  const lit = shooter === p.id;
  const dark = !!shooter && !lit;
  const rel = order >= 0 && n > 0 ? (order - turnIdx + n) % n : -1;
  const P = L.P;
  const style = {
    left: g.x * P,
    top: g.top * P,
    width: g.w * P,
    height: (g.edge - g.top) * P,
    zIndex: Math.round((1 - g.depth) * 10) + (lit ? 20 : 0),
    ...(g.slot ? { '--slot': `${Math.floor(g.slot * P) - 6}px` } : {}),
  } as CSSProperties;
  return (
    <div className={`seat ${lit ? 'lit' : ''} ${dark ? 'dark' : ''} ${p.connected ? '' : 'ghost'} ${p.id === me ? 'me' : ''} ${g.back ? 'back' : ''} ${g.slot ? 'row' : ''} ${fresh ? 'fresh' : ''}`} style={style}>
      {p.steam?.avatar && <img className="seat-avatar" src={p.steam.avatar} alt="" draggable={false} />}
      <div className="seat-plate">
        {!p.shieldUsed && <TinStar size={12} />}
        <span className="seat-name">{p.name}{p.id === me && <span className="seat-you"> (you)</span>}</span>
        {p.host && <span className="seat-host" title="Host">HOST</span>}
      </div>
      {rel >= 0 && <div className={`seat-order ${rel === 0 ? 'now' : rel === 1 ? 'next' : ''}`}>{rel === 0 ? 'SHOOTING' : rel === 1 ? 'NEXT' : `#${rel + 1}`}</div>}
      {!p.connected && <div className="seat-away">stepped out</div>}
    </div>
  );
}
