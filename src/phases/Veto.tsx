import { DEFAULT_SETTINGS } from '../../shared/types';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { PixelArt, PixelSprite } from '../pixel/PixelCanvas';
import { crosshairDraw } from '../pixel/sprites';
import { PAL } from '../pixel/palette';
import { bayer } from '../pixel/dither';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import TinStar from '../scene/TinStar';
import { BUZZ, buzz } from '../scene/haptics';
import { useShotExtras } from './ShotExtras';
import SheriffPanel from './SheriffPanel';
import './gameplay.css';

export default function Veto({ state, me, send, skew, on }: RoomProps) {
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
  const settings = state.settings ?? DEFAULT_SETTINGS;
  const turnMs = Math.max(5, settings.turnSecs || 30) * 1000;
  // how many games survive the shootout: 'last' = 1, 'duel' = 2, 'cylinder' / 'slide' = cylinderAt
  const finaleN = settings.finale === 'last' ? 1 : settings.finale === 'duel' ? 2 : (settings.cylinderAt ?? 3);
  const finaleTail = settings.finale === 'last' ? 'last one standing wins' : settings.finale === 'duel' ? 'then a quick-draw duel decides'
    : settings.finale === 'slide' ? 'then a whiskey slide decides' : 'then the cylinder decides';
  const finaleNow = settings.finale === 'last' ? 'last one standing' : settings.finale === 'duel' ? 'the quick-draw decides'
    : settings.finale === 'slide' ? 'the whiskey slide decides' : 'the cylinder decides';
  /** the tin star is private: you only ever know about your own */
  const starred = (g?: { shieldedBy?: string[] }) => !!g?.shieldedBy?.includes(me);
  const revengeOn = myTurn && mine?.revengeOn ? mine.revengeOn : undefined;
  useShotExtras(state, skew);

  useEffect(() => { if (myTurn) { sfx.cock(); buzz(BUZZ.myTurn); } }, [myTurn, state.turnIdx]);

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
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest?.('.emo-wheel, .sound'))) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); keyRef.current.aimAt(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); keyRef.current.aimAt(1); }
      else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) keyRef.current.fire(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // swipe (touch, pen or mouse): ~30px horizontal flick aims; any real drag cancels the tap-to-fire click
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) swiped.current = true;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      drag.current = null;
      aimAt(dx < 0 ? 1 : -1);
    }
  };
  const onEnd = (e: React.PointerEvent) => { if (drag.current?.id === e.pointerId) drag.current = null; };

  const [epi, setEpi] = useState<number | null>(null);
  const epiGame = dead.find((g) => g.appid === epi);
  const canShield = !!mine && !mine.shieldUsed && !!center && !starred(center);

  // tin star spins in and pins on when a shield lands (not for stars already pinned when we arrived)
  const starSeen = useRef<Set<number> | null>(null);
  const [pinning, setPinning] = useState<Set<number>>(() => new Set());
  const shieldKey = state.board.filter((g) => starred(g)).map((g) => g.appid).join(',');
  useEffect(() => {
    const now = new Set(state.board.filter((g) => starred(g)).map((g) => g.appid));
    if (starSeen.current) {
      const fresh = [...now].filter((a) => !starSeen.current!.has(a));
      if (fresh.length) {
        setPinning(new Set(fresh));
        const t1 = window.setTimeout(() => sfx.clink(), 480);
        const t2 = window.setTimeout(() => setPinning(new Set()), 900);
        starSeen.current = now;
        return () => { clearTimeout(t1); clearTimeout(t2); };
      }
    }
    starSeen.current = now;
  }, [shieldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`veto ${myTurn ? 'my-turn' : ''} ${revengeOn ? 'revenge' : ''}`}>
      <div className="veto-head">
        <div className="veto-count">
          <b>{n}</b> left {n > finaleN ? <span>· shoot down to {finaleN}, {finaleTail}</span> : <span>· {finaleNow}</span>}
          {n > finaleN && <span className="gp-fin-short">· shoot down to {finaleN}</span>}
        </div>
        <div className="veto-status">
          {myTurn ? <span className="your-shot">Your shot, partner.</span> : <span><b>{shooter?.name ?? 'Someone'}</b> is taking aim…</span>}
        </div>
        {revengeOn && <div className="gp-revenge-tag">REVENGE on {nameOf(revengeOn)}</div>}
        {state.turnDeadline > 0 && <Fuse deadline={state.turnDeadline} skew={skew} mine={myTurn} turnMs={turnMs} />}
      </div>

      {state.sheriff && <SheriffPanel state={state} me={me} send={send} skew={skew} on={on} finaleN={finaleN} />}

      <div className="carousel" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd}>
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
                if (swiped.current) { swiped.current = false; return; }
                if (d === 0) fire(); else if (myTurn) { sfx.whoosh(); send({ t: 'aim', appid: g.appid }); }
              }}
            >
              <div className="cbox-bob">
                <div className={`gbox ${g.cracks ? 'cracked' : ''}`}>
                  <PixelArt appid={g.appid} name={g.name} holes={g.cracks ? 1 : 0} cracked={!!g.cracks} />
                  {g.tier === 'pitch' && <span className="gbox-pitch">PITCH</span>}
                  {!!g.cracks && <span className="gbox-more">1 more</span>}
                  {starred(g) && (pinning.has(g.appid)
                    ? <span className="px-star-wrap px-star-pin"><TinStar size={46} className="gbox-star" /></span>
                    : <TinStar size={46} className="gbox-star" />)}
                </div>
                {d === 0 && <div className="cbox-name">{g.name}</div>}
                {d === 0 && starred(g) && <div className="cbox-shield mine">Your star: a shot here ricochets</div>}
                {d === 0 && (g.by.length ? <div className="cbox-by">brought by {g.by.map(nameOf).join(', ')}</div> : <div className="cbox-by">dealt by the house</div>)}
              </div>
              {d === 0 && <Crosshair hot={myTurn} revenge={!!revengeOn} />}
            </div>
          );
        })}
        {n === 0 && <div className="veto-empty">Smoke clears…</div>}
      </div>

      {(myTurn || canShield) && (
        <div className={`veto-controls ${myTurn ? '' : 'idle'}`}>
          <button className="btn-arrow turn-btn px-btn" disabled={!myTurn} onPointerEnter={() => sfx.hover()} onClick={() => aimAt(-1)} aria-label="Aim left">◀</button>
          <button className={`btn-fire turn-btn px-btn ${revengeOn ? 'avenge' : ''}`} disabled={!myTurn} onPointerEnter={() => sfx.hover()} onClick={fire}>{myTurn ? (revengeOn ? 'AVENGE' : 'FIRE') : 'WAIT'}</button>
          <button className="btn-arrow turn-btn px-btn" disabled={!myTurn} onPointerEnter={() => sfx.hover()} onClick={() => aimAt(1)} aria-label="Aim right">▶</button>
          {canShield && (
            <button
              className="btn-shield px-btn"
              onClick={() => send({ t: 'shield', appid: center.appid })}
              title="One per player. A shot at this game will ricochet."
              aria-label={`Pin tin star on ${center.name}`}
            >
              <TinStar size={20} /><span className="lbl-long">Pin tin star on {center.name}</span><span className="lbl-short">Star</span>
            </button>
          )}
        </div>
      )}
      {myTurn && <div className="veto-hint">← → to aim · Space to fire · swipe on mobile</div>}

      {dead.length > 0 && (
        <div className="graveyard">
          <div className="graveyard-label">Boot Hill <small>{dead.length}</small></div>
          <div className="graveyard-row">
            {dead.map((g, i) => (
              <div
                className={`grave ${g.lastWords ? 'has-words' : ''} ${epi === g.appid ? 'sel' : ''}`}
                key={g.appid}
                style={{ '--r': `${((i * 47) % 14) - 7}deg` } as CSSProperties}
                title={g.lastWords ? `${g.name}: "${g.lastWords}"` : g.name}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse' && g.lastWords) setEpi(g.appid); }}
                onPointerLeave={(e) => { if (e.pointerType === 'mouse') setEpi((x) => (x === g.appid ? null : x)); }}
                onClick={() => { if (g.lastWords) { sfx.click(); setEpi((x) => (x === g.appid ? null : g.appid)); } }}
              >
                <div className="grave-art"><PixelArt appid={g.appid} name={g.name} w={24} h={36} holes={g.tier === 'pitch' ? 2 : 1} /><span className="mini-stamp">NAH.</span></div>
                <div className="grave-by">{nameOf(g.killedBy)}</div>
              </div>
            ))}
          </div>
          {epiGame?.lastWords && <div className="gp-epitaph"><b>{epiGame.name}</b> · "{epiGame.lastWords}"</div>}
        </div>
      )}
    </div>
  );
}

const CROSS_COLD = crosshairDraw('rgba(232,213,181,.7)');
const CROSS_HOT = crosshairDraw('#ff3b2f');

function Crosshair({ hot, revenge }: { hot: boolean; revenge?: boolean }) {
  return <PixelSprite draw={hot ? CROSS_HOT : CROSS_COLD} w={33} h={33} className={`crosshair ${hot ? 'hot' : ''} ${revenge ? 'revenge' : ''}`} />;
}

const FW = 96, FH = 12;

/** ~14 renders/s is plenty for the fuse sparkle and seconds (a per-rAF clock would re-render 60x/s). */
function useTick(skew: number, ms = 70) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + skew), ms);
    return () => clearInterval(id);
  }, [skew, ms]);
  return now;
}

function Fuse({ deadline, skew, mine, turnMs }: { deadline: number; skew: number; mine: boolean; turnMs: number }) {
  const now = useTick(skew);
  const rem = Math.min(turnMs, Math.max(0, deadline - now));
  const secs = Math.ceil(rem / 1000);
  const frantic = rem > 0 && rem < Math.min(10_000, turnMs / 3);
  const frac = Math.max(0, Math.min(1, rem / turnMs));

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
