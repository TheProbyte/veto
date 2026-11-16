import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { RoomProps } from '../props';
import { useNow } from '../net';
import { sfx } from '../sfx';
import GameArt from '../scene/GameArt';
import TinStar from '../scene/TinStar';

export default function Veto({ state, me, send, skew }: RoomProps) {
  const alive = state.board.filter((g) => g.alive);
  const dead = state.board.filter((g) => !g.alive);
  const n = alive.length;
  let ci = alive.findIndex((g) => g.appid === state.aim);
  if (ci < 0) ci = 0;
  const center = alive[ci];
  const shooterId = state.turnOrder[state.turnIdx];
  const shooter = state.players.find((p) => p.id === shooterId);
  const myTurn = shooterId === me && state.turnDeadline > 0;
  const mine = state.players.find((p) => p.id === me);
  const nameOf = (id?: string) => state.players.find((p) => p.id === id)?.name ?? '???';

  useEffect(() => { if (myTurn) sfx.cock(); }, [myTurn, state.turnIdx]);

  const aimAt = useCallback((delta: number) => {
    if (!myTurn || n < 2) return;
    const g = alive[(((ci + delta) % n) + n) % n];
    sfx.whoosh();
    send({ t: 'aim', appid: g.appid });
  }, [myTurn, n, ci, alive, send]);

  const fire = useCallback(() => {
    if (!myTurn || !center) return;
    send({ t: 'fire', appid: center.appid });
  }, [myTurn, center, send]);

  // keyboard
  const keyRef = useRef({ aimAt, fire });
  keyRef.current = { aimAt, fire };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); keyRef.current.aimAt(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); keyRef.current.aimAt(1); }
      else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) keyRef.current.fire(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // swipe
  const sx = useRef<number | null>(null);
  const swiped = useRef(false);
  const onDown = (e: React.PointerEvent) => { sx.current = e.clientX; swiped.current = false; };
  const onUp = (e: React.PointerEvent) => {
    if (sx.current == null) return;
    const dx = e.clientX - sx.current;
    sx.current = null;
    if (Math.abs(dx) > 40) { swiped.current = true; aimAt(dx < 0 ? 1 : -1); }
  };

  const canShield = !!mine && !mine.shieldUsed && !!center && !center.shieldedBy;

  return (
    <div className={`veto ${myTurn ? 'my-turn' : ''}`}>
      <div className="veto-head">
        <div className="veto-count">
          <b>{n}</b> left {n > 3 ? <span>· shoot down to 3, then the cylinder decides</span> : <span>· the cylinder decides</span>}
        </div>
        <div className="veto-status">
          {myTurn ? <span className="your-shot">Your shot, partner.</span> : <span><b>{shooter?.name ?? 'Someone'}</b> is taking aim…</span>}
        </div>
        {state.turnDeadline > 0 && <Fuse deadline={state.turnDeadline} skew={skew} mine={myTurn} />}
      </div>

      <div className="carousel" onPointerDown={onDown} onPointerUp={onUp}>
        {alive.map((g, i) => {
          let d = i - ci;
          if (n > 2) { d = ((d % n) + n) % n; if (d > n / 2) d -= n; }
          const a = Math.abs(d);
          const style = {
            '--d': d,
            '--a': a,
            opacity: a > 2 ? 0 : 1 - a * 0.28,
            zIndex: 10 - a,
            pointerEvents: a > 2 ? 'none' : 'auto',
          } as CSSProperties;
          return (
            <div
              key={g.appid}
              className={`cbox ${d === 0 ? 'center' : ''}`}
              style={style}
              onClick={() => {
                if (swiped.current) return;
                if (d === 0) fire(); else if (myTurn) { sfx.whoosh(); send({ t: 'aim', appid: g.appid }); }
              }}
            >
              <div className="cbox-bob">
                <div className="gbox">
                  <GameArt appid={g.appid} name={g.name} />
                  <div className="gbox-sheen" />
                  {g.shieldedBy && <TinStar size={46} className="gbox-star" />}
                </div>
                {d === 0 && <div className="cbox-name">{g.name}</div>}
                {d === 0 && g.shieldedBy && <div className="cbox-shield">protected by {nameOf(g.shieldedBy)}'s tin star</div>}
                {d === 0 && (g.by.length ? <div className="cbox-by">brought by {g.by.map(nameOf).join(', ')}</div> : <div className="cbox-by">dealt by the house</div>)}
              </div>
              {d === 0 && <Crosshair hot={myTurn} />}
            </div>
          );
        })}
        {n === 0 && <div className="veto-empty">Smoke clears…</div>}
      </div>

      <div className="veto-controls">
        {myTurn && (
          <>
            <button className="btn-arrow" onClick={() => aimAt(-1)} aria-label="Aim left">◀</button>
            <button className="btn-fire" onClick={fire}>FIRE</button>
            <button className="btn-arrow" onClick={() => aimAt(1)} aria-label="Aim right">▶</button>
          </>
        )}
        {canShield && (
          <button className="btn-shield" onClick={() => send({ t: 'shield', appid: center.appid })} title="One per player. A shot at this game will ricochet.">
            <TinStar size={20} /> Pin tin star on {center.name}
          </button>
        )}
      </div>
      {myTurn && <div className="veto-hint">← → to aim · Space to fire · swipe on mobile</div>}

      {dead.length > 0 && (
        <div className="graveyard">
          <div className="graveyard-label">Boot Hill</div>
          <div className="graveyard-row">
            {dead.map((g, i) => (
              <div className="grave" key={g.appid} style={{ '--r': `${((i * 47) % 14) - 7}deg` } as CSSProperties}>
                <div className="grave-art"><GameArt appid={g.appid} name={g.name} /><span className="mini-stamp">NAH.</span></div>
                <div className="grave-by">{nameOf(g.killedBy)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Crosshair({ hot }: { hot: boolean }) {
  return (
    <svg className={`crosshair ${hot ? 'hot' : ''}`} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="30" fill="none" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="3" />
      <path d="M50 8 V30 M50 70 V92 M8 50 H30 M70 50 H92" strokeWidth="2.5" />
    </svg>
  );
}

const ROPE = 'M' + Array.from({ length: 61 }, (_, i) => { const x = 20 + i * 5; return `${x} ${(22 + 6 * Math.sin((x - 20) / 24)).toFixed(2)}`; }).join(' L');

function Fuse({ deadline, skew, mine }: { deadline: number; skew: number; mine: boolean }) {
  const now = useNow(skew);
  const rem = Math.max(0, deadline - now);
  const secs = Math.ceil(rem / 1000);
  const frantic = rem > 0 && rem < 10_000;
  const total = 30_000;
  const frac = Math.max(0, Math.min(1, rem / total));

  useEffect(() => { if (secs > 0 && secs <= 5) sfx.tick(); }, [secs]);
  const hiss = mine && frantic;
  useEffect(() => { sfx.fuse(hiss); return () => sfx.fuse(false); }, [hiss]);

  // fuse path: wavy rope from left to right, burning from the right end
  const L = 300;
  const burnX = 20 + L * frac;
  const wy = (x: number) => 22 + 6 * Math.sin((x - 20) / 24);
  return (
    <div className={`fuse ${frantic ? 'frantic' : ''}`}>
      <svg viewBox="0 0 360 40" className="fuse-svg" aria-hidden>
        <defs>
          <clipPath id="fuse-clip"><rect x="0" y="0" width={burnX} height="40" /></clipPath>
        </defs>
        <path d={ROPE} className="fuse-ash" />
        <path d={ROPE} className="fuse-rope" clipPath="url(#fuse-clip)" />
        <rect x="4" y="12" width="18" height="20" rx="3" className="fuse-keg" />
        {rem > 0 && (
          <g transform={`translate(${burnX} ${wy(burnX)})`} className="fuse-spark">
            <circle r="7" fill="#ff8a3d" opacity=".35" />
            <circle r="3.5" fill="#fff3c4" />
            {Array.from({ length: 6 }, (_, i) => (
              <line key={i} x1="0" y1="0" x2={Math.cos(i + now / 90) * 11} y2={Math.sin(i * 1.7 + now / 70) * 11} stroke="#ffb35c" strokeWidth="1.5" />
            ))}
          </g>
        )}
      </svg>
      <div className="fuse-num">{secs}<small>s</small></div>
    </div>
  );
}
