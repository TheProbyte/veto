import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { RoomProps } from '../props';
import type { Player, ShotEvent } from '../../shared/types';
import { sfx } from '../sfx';
import Character from './Character';
import TinStar from './TinStar';
import ShotFX from './ShotFX';

/** Seat geometry: 8 seats on the far arc of the table. depth 1 = far/center, 0 = near/sides. */
export function seatPos(seat: number) {
  const s = Math.max(0, Math.min(7, seat));
  const th = Math.PI * (0.93 - (0.86 * s) / 7);
  const x = 50 + 45 * Math.cos(th);
  const depth = Math.sin(th);
  return { x, depth, top: 17 - 10 * depth, scale: 1.12 - 0.42 * depth };
}

const MOTES = Array.from({ length: 22 }, (_, i) => ({
  left: 30 + ((i * 37) % 40),
  top: 8 + ((i * 53) % 60),
  dur: 14 + ((i * 7) % 12),
  delay: -((i * 3.3) % 20),
  size: 1 + (i % 3),
}));

export default function Saloon({ state, me, children }: RoomProps & { children: ReactNode }) {
  const [muted, setMuted] = useState(() => sfx.isMuted());
  const [fx, setFx] = useState<ShotEvent | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);

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
    setFx(s);
    const timers: number[] = [];
    if (s.kind === 'ricochet') {
      sfx.ricochet();
      sceneRef.current?.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
        { duration: 260 },
      );
    } else {
      sfx.shot();
      const kf: Keyframe[] = [
          { transform: 'translate(0,0) rotate(0)' },
          { transform: 'translate(-14px,8px) rotate(-.6deg)' },
          { transform: 'translate(12px,-10px) rotate(.5deg)' },
          { transform: 'translate(-8px,6px)' },
          { transform: 'translate(5px,-3px)' },
          { transform: 'translate(0,0)' },
        ];
      sceneRef.current?.animate(kf, { duration: 520, easing: 'ease-out' });
      frontRef.current?.animate(kf, { duration: 420, easing: 'ease-out' });
      timers.push(window.setTimeout(() => sfx.stamp(), 680));
    }
    timers.push(window.setTimeout(() => setFx((f) => (f && f.id === s.id ? null : f)), 2700));
    return () => timers.forEach(clearTimeout);
  }, [state.lastShot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const veto = state.phase === 'veto';
  const shooter = veto ? state.turnOrder[state.turnIdx] : undefined;
  const shooterSeat = state.players.find((p) => p.id === shooter);
  const swing = shooterSeat ? Math.max(-38, Math.min(38, (seatPos(shooterSeat.seat).x - 50) * 0.75)) : 0;

  const seats = useMemo(() => [...state.players].sort((a, b) => seatPos(b.seat).depth - seatPos(a.seat).depth), [state.players]);

  return (
    <div className={`saloon phase-${state.phase} ${shooter ? 'has-shooter' : ''}`}>
      <div className="scene" ref={sceneRef}>
        <div className="wall">
          <div className="window w1"><i /></div>
          <div className="window w2"><i /></div>
          <div className="shelf">
            <Bottles />
          </div>
          <div className="wall-poster"><b>WANTED</b><span>a good game</span><em>$500</em></div>
          <div className="wainscot" />
        </div>

        <div className="lamp" style={{ '--swing': `${-swing}deg` } as CSSProperties}>
          <div className="lamp-chain" />
          <svg className="lamp-body" viewBox="0 0 80 110" aria-hidden>
            <path d="M28 6 h24 l-4 14 h-16z" fill="#2a1f17" />
            <path d="M14 34 Q40 14 66 34 L60 44 H20Z" fill="#3a2b1e" />
            <path d="M26 44 Q24 70 40 78 Q56 70 54 44Z" fill="#ffcf8a" opacity=".9" />
            <path d="M33 54 Q40 40 47 54 Q47 66 40 68 Q33 66 33 54Z" fill="#fff3d6" />
            <path d="M22 78 H58 L54 90 H26Z" fill="#2a1f17" />
          </svg>
          <div className="lamp-glow" />
          <div className="lamp-cone" />
        </div>

        <div className="motes" aria-hidden>
          {MOTES.map((m, i) => (
            <i key={i} style={{ left: `${m.left}%`, top: `${m.top}%`, width: m.size, height: m.size, animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s` }} />
          ))}
        </div>

        <div className="seats">
          {seats.map((p) => (
            <Seat key={p.id} p={p} me={me} shooter={shooter} order={veto ? state.turnOrder.indexOf(p.id) : -1} turnIdx={state.turnIdx} n={state.turnOrder.length} />
          ))}
        </div>

        <div className="table-wrap" aria-hidden>
          <div className="table">
            <div className="felt" />
          </div>
        </div>

        <div className="vignette" />
      </div>

      <div className="saloon-front" ref={frontRef}>
        <div className="saloon-stage">{children}</div>
      </div>

      {fx && <ShotFX key={fx.id} shot={fx} board={state.board} players={state.players} />}

      <div className="grain" aria-hidden />

      <button
        className="mute-btn"
        title={muted ? 'Unmute' : 'Mute'}
        aria-label={muted ? 'Unmute sound' : 'Mute sound'}
        onClick={() => { const m = !muted; sfx.setMuted(m); setMuted(m); if (!m) { sfx.unlock(); sfx.ambience(true); } }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
          {muted
            ? <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />}
        </svg>
      </button>
    </div>
  );
}

function Seat({ p, me, shooter, order, turnIdx, n }: { p: Player; me: string; shooter?: string; order: number; turnIdx: number; n: number }) {
  const pos = seatPos(p.seat);
  const lit = shooter === p.id;
  const dark = !!shooter && !lit;
  const rel = order >= 0 && n > 0 ? (order - turnIdx + n) % n : -1;
  const style = {
    left: `${pos.x}%`,
    top: `${pos.top}vh`,
    '--sc': pos.scale,
    '--blur': `${Math.max(0, (pos.depth - 0.35) * 1.8).toFixed(2)}px`,
    '--dim': (0.72 + 0.28 * (1 - pos.depth)).toFixed(2),
    zIndex: Math.round((1 - pos.depth) * 10) + (lit ? 20 : 0),
  } as CSSProperties;
  return (
    <div className={`seat ${lit ? 'lit' : ''} ${dark ? 'dark' : ''} ${p.connected ? '' : 'ghost'} ${p.id === me ? 'me' : ''}`} style={style}>
      <div className="seat-fig">
        <Character look={p.look} rimRight={pos.x < 50} lit={lit} />
        {p.steam?.avatar && <img className="seat-avatar" src={p.steam.avatar} alt="" draggable={false} />}
      </div>
      <div className="seat-plate">
        {!p.shieldUsed && <TinStar size={13} />}
        <span className="seat-name">{p.name}{p.id === me ? ' (you)' : ''}</span>
        {p.host && <span className="seat-host">HOST</span>}
      </div>
      {rel >= 0 && <div className={`seat-order ${rel === 0 ? 'now' : ''}`}>{rel === 0 ? 'SHOOTING' : rel === 1 ? 'NEXT' : `#${rel + 1}`}</div>}
      {!p.connected && <div className="seat-away">stepped out</div>}
    </div>
  );
}

function Bottles() {
  const b = [
    [14, 34, 6], [24, 26, 5], [32, 40, 7], [44, 22, 9], [54, 32, 5], [62, 38, 6], [74, 28, 8], [86, 36, 6], [96, 24, 5],
    [130, 34, 6], [140, 30, 7], [152, 40, 6], [164, 24, 9], [176, 36, 5], [186, 28, 6],
  ];
  return (
    <svg viewBox="0 0 200 50" preserveAspectRatio="none" aria-hidden>
      {b.map(([x, h, w], i) => (
        <g key={i} fill={i % 4 === 1 ? '#2b1a0f' : '#120b07'}>
          <rect x={x - w / 2} y={50 - h} width={w} height={h} rx={w / 3} />
          <rect x={x - 1.2} y={50 - h - 8} width={2.4} height={10} />
          {i % 3 === 0 && <rect x={x - w / 2 + 1} y={50 - h + 4} width={1.2} height={h - 8} fill="#ff8a3d" opacity=".35" />}
        </g>
      ))}
      <rect x="0" y="48" width="200" height="2" fill="#3b2416" />
    </svg>
  );
}
