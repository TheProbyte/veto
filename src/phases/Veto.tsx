import { TURN_MS } from '../../shared/types';
import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { PixelArt, PixelSprite } from '../pixel/PixelCanvas';
import { crosshairDraw } from '../pixel/sprites';
import { PAL } from '../pixel/palette';
import { bayer } from '../pixel/dither';
import type { RoomProps } from '../props';
import { useNow } from '../net';
import { sfx } from '../sfx';
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
                <div className={`gbox ${g.cracks ? 'cracked' : ''}`}>
                  <PixelArt appid={g.appid} name={g.name} holes={g.cracks ? 1 : 0} cracked={!!g.cracks} />
                  {g.tier === 'pitch' && <span className="gbox-pitch">PITCH</span>}
                  {!!g.cracks && <span className="gbox-more">1 more</span>}
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
            <button className="btn-arrow px-btn" onPointerEnter={() => sfx.hover()} onClick={() => aimAt(-1)} aria-label="Aim left">◀</button>
            <button className="btn-fire px-btn" onPointerEnter={() => sfx.hover()} onClick={fire}>FIRE</button>
            <button className="btn-arrow px-btn" onPointerEnter={() => sfx.hover()} onClick={() => aimAt(1)} aria-label="Aim right">▶</button>
          </>
        )}
        {canShield && (
          <button className="btn-shield px-btn" onClick={() => send({ t: 'shield', appid: center.appid })} title="One per player. A shot at this game will ricochet.">
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
                <div className="grave-art"><PixelArt appid={g.appid} name={g.name} w={24} h={36} holes={g.tier === 'pitch' ? 2 : 1} /><span className="mini-stamp">NAH.</span></div>
                <div className="grave-by">{nameOf(g.killedBy)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const CROSS_COLD = crosshairDraw('rgba(232,213,181,.7)');
const CROSS_HOT = crosshairDraw('#ff3b2f');

function Crosshair({ hot }: { hot: boolean }) {
  return <PixelSprite draw={hot ? CROSS_HOT : CROSS_COLD} w={33} h={33} className={`crosshair ${hot ? 'hot' : ''}`} />;
}

const FW = 96, FH = 12;

function Fuse({ deadline, skew, mine }: { deadline: number; skew: number; mine: boolean }) {
  const now = useNow(skew);
  const rem = Math.min(TURN_MS, Math.max(0, deadline - now));
  const secs = Math.ceil(rem / 1000);
  const frantic = rem > 0 && rem < 10_000;
  const frac = Math.max(0, Math.min(1, rem / TURN_MS));

  useEffect(() => { if (secs > 0 && secs <= 5) sfx.tick(); }, [secs]);
  const hiss = mine && frantic;
  useEffect(() => { sfx.fuse(hiss); return () => sfx.fuse(false); }, [hiss]);

  const ref = useRef<HTMLCanvasElement>(null);
  const frame = Math.floor(now / 70);
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, FW, FH);
    const x0 = 9, len = FW - x0 - 4;
    const burnX = Math.round(x0 + len * frac);
    const wy = (x: number) => Math.round(6 + 2 * Math.sin((x - x0) / 6));
    // keg
    c.fillStyle = PAL.ink; c.fillRect(0, 1, 9, 10);
    c.fillStyle = PAL.wood3; c.fillRect(1, 2, 7, 8);
    c.fillStyle = PAL.metal2; c.fillRect(1, 3, 7, 1); c.fillRect(1, 8, 7, 1);
    c.fillStyle = PAL.wood4; c.fillRect(2, 2, 1, 8);
    for (let x = x0; x < x0 + len; x++) {
      const y = wy(x);
      if (x < burnX) {
        c.fillStyle = (x >> 1) % 2 ? PAL.parch2 : (frantic ? PAL.lamp3 : PAL.parch3);
        c.fillRect(x, y, 1, 2);
        c.fillStyle = PAL.wood0; c.fillRect(x, y + 2, 1, 1);
      } else if (bayer(x, y) > 0.45) { c.fillStyle = PAL.wood2; c.fillRect(x, y + 1, 1, 1); }
    }
    if (rem > 0) {
      const y = wy(burnX);
      for (let k = 0; k < 7; k++) {
        const a = k * 0.9 + frame * 1.7, r = 2 + ((k + frame) % 4);
        c.fillStyle = k % 2 ? PAL.lamp1 : PAL.lamp2;
        c.fillRect(Math.round(burnX + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.8), 1, 1);
      }
      c.fillStyle = PAL.lamp0; c.fillRect(burnX - 1, y - 1, 3, 3);
      c.fillStyle = PAL.white; c.fillRect(burnX, y, 1, 1);
    }
  }, [frame, frac, frantic, rem]);

  return (
    <div className={`fuse ${frantic ? 'frantic' : ''}`}>
      <canvas ref={ref} width={FW} height={FH} className="fuse-cv" aria-hidden />
      <div className="fuse-num">{secs}<small>s</small></div>
    </div>
  );
}
