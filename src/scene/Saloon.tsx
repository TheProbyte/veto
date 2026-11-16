import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { RoomProps } from '../props';
import type { Player, ShotEvent } from '../../shared/types';
import { sfx } from '../sfx';
import TinStar from './TinStar';
import ShotFX from './ShotFX';
import { BUZZ, buzz, isPhone, reducedMotion } from './haptics';
import { PixelScene, usePixelLayout } from '../pixel/PixelCanvas';
import { seatGeom, type Layout, type SceneData } from '../pixel/scene';

export default function Saloon({ state, me, children }: RoomProps & { children: ReactNode }) {
  const [fx, setFx] = useState<ShotEvent | null>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const layout = usePixelLayout();
  const shotRef = useRef<SceneData['shot']>(undefined);

  // first gesture: unlock audio + start ambience
  useEffect(() => {
    const go = () => { sfx.unlock(); sfx.ambience(true); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  }, []);

  // chair scrape when someone new sits down
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(state.players.map((p) => p.id));
    if (seen.current) {
      for (const id of ids) if (!seen.current.has(id)) { sfx.chair(); break; }
    }
    seen.current = ids;
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
    players: state.players.map((p) => ({ id: p.id, seat: p.seat, look: p.look, connected: p.connected })),
    shooter,
    phase: state.phase,
    shot: shotRef.current,
    dimAll: state.phase === 'roulette' ? 0.45 : state.phase === 'result' ? 0.6 : 1,
  }), [state.players, shooter, state.phase, fx]); // eslint-disable-line react-hooks/exhaustive-deps

  const stageTop = layout.tableTop * layout.P + (layout.portrait ? 30 : 44);
  const seats = useMemo(() => state.players.map((p) => p.seat), [state.players]);

  return (
    <div className={`saloon phase-${state.phase} ${shooter ? 'has-shooter' : ''}`} style={{ '--P': `${layout.P}px`, '--stage-top': `${stageTop}px` } as CSSProperties}>
      <div className="scene">
        <PixelScene layout={layout} data={data} />
        <div className={`seats ${layout.portrait && state.players.length > 4 ? 'has-back' : ''}`}>
          {state.players.map((p) => (
            <Seat key={p.id} p={p} me={me} L={layout} seats={seats} shooter={shooter} order={veto ? state.turnOrder.indexOf(p.id) : -1} turnIdx={state.turnIdx} n={state.turnOrder.length} />
          ))}
        </div>
      </div>

      <div className="saloon-front" ref={frontRef}>
        <div className="saloon-stage">{children}</div>
      </div>

      {fx && <ShotFX key={fx.id} shot={fx} board={state.board} players={state.players} />}

      <SoundButton />
    </div>
  );
}

function Seat({ p, me, L, seats, shooter, order, turnIdx, n }: { p: Player; me: string; L: Layout; seats: number[]; shooter?: string; order: number; turnIdx: number; n: number }) {
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
    <div className={`seat ${lit ? 'lit' : ''} ${dark ? 'dark' : ''} ${p.connected ? '' : 'ghost'} ${p.id === me ? 'me' : ''} ${g.back ? 'back' : ''} ${g.slot ? 'row' : ''}`} style={style}>
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

function SoundButton() {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() => sfx.isMuted());
  const [vol, setVol] = useState(() => sfx.getVolume());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc); };
  }, [open]);
  const toggleMute = () => {
    const m = !muted; sfx.setMuted(m); setMuted(m);
    if (!m) { sfx.unlock(); sfx.ambience(true); }
  };
  const quiet = muted || vol <= 0;
  return (
    <div className="sound" ref={ref}>
      <button className="sound-btn px-btn" aria-expanded={open} aria-label="Sound settings" title="Sound" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 12 12" width="20" height="20" aria-hidden shapeRendering="crispEdges">
          <path d="M1 4h2v4H1zM3 4h1V3h1V2h1v8H5V9H4V8H3z" fill="currentColor" />
          {quiet
            ? <path d="M8 4h1v1H8zM10 4h1v1h-1zM9 5h1v2H9zM8 7h1v1H8zM10 7h1v1h-1z" fill="currentColor" />
            : <path d="M8 5h1v2H8zM9 3h1v1H9zM10 4h1v4h-1zM9 8h1v1H9z" fill="currentColor" />}
        </svg>
      </button>
      {open && (
        <div className="sound-pop px-box" role="dialog" aria-label="Sound">
          <label className="sound-row">
            <span>Volume</span>
            <input
              type="range" min={0} max={1} step={0.05} value={vol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVol(v); sfx.setVolume(v);
                if (v > 0 && muted) { sfx.setMuted(false); setMuted(false); }
                sfx.unlock(); sfx.ambience(true);
              }}
              aria-label="Volume"
            />
            <b>{Math.round(vol * 100)}</b>
          </label>
          <button className="px-btn px-btn-sm sound-mute" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
        </div>
      )}
    </div>
  );
}
