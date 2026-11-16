import { DEFAULT_SETTINGS } from '../../shared/types';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { PixelArt, PixelSprite } from '../pixel/PixelCanvas';
import { crosshairDraw, drawCrack, drawFlash, drawSmoke, holeAt, type DrawFn } from '../pixel/sprites';
import { PAL, hashStr, rnd } from '../pixel/palette';
import { bayer } from '../pixel/dither';
import { FINE_H, FINE_W, pixelize } from '../pixel/pixelize';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import TinStar from '../scene/TinStar';
import { BUZZ, buzz } from '../scene/haptics';
import { useShotExtras } from './ShotExtras';
import SheriffPanel from './SheriffPanel';
import './gameplay.css';

/** server: pause between a shot and the next fuse (shot FX + last words) */
const SHOT_PAUSE = 3200;

export default function Veto({ state, me, send, skew, on }: RoomProps) {
  const alive = state.board.filter((g) => g.alive);
  const dead = state.board.filter((g) => !g.alive);
  const n = alive.length;
  let ci = alive.findIndex((g) => g.appid === state.aim);
  if (ci < 0) ci = 0;
  const center = alive[ci];
  const shooterId = state.turnOrder[state.turnIdx];
  const shooter = state.players.find((p) => p.id === shooterId);
  const mine = state.players.find((p) => p.id === me);
  const nameOf = (id?: string) => state.players.find((p) => p.id === id)?.name ?? '???';
  const settings = state.settings ?? DEFAULT_SETTINGS;
  const turnMs = Math.max(5, settings.turnSecs || 30) * 1000;
  // how many games survive the shootout: 'last' = 1, 'duel' = 2, 'cylinder' / 'slide' = cylinderAt
  const finaleN = settings.finale === 'last' ? 1 : settings.finale === 'duel' ? 2 : (settings.cylinderAt ?? 3);
  const finaleTail = settings.finale === 'last' ? 'last one wins' : settings.finale === 'duel' ? 'then a duel'
    : 'then the vote';
  /** the tin star is private: you only ever know about your own */
  const starred = (g?: { shieldedBy?: string[] }) => !!g?.shieldedBy?.includes(me);
  useShotExtras(state, skew);

  // the pause after a shot (server holds the next fuse for SHOT_PAUSE): the carousel stays hushed, the gun holstered
  const shotT = state.lastShot?.t ?? 0;
  const [hush, setHush] = useState(() => Date.now() + skew < shotT + SHOT_PAUSE - 200);
  useEffect(() => {
    const left = shotT + SHOT_PAUSE - 200 - (Date.now() + skew);
    if (left <= 0) { setHush(false); return; }
    setHush(true);
    const t = window.setTimeout(() => setHush(false), left);
    return () => clearTimeout(t);
  }, [shotT]); // eslint-disable-line react-hooks/exhaustive-deps

  const myTurn = shooterId === me && state.turnDeadline > 0;
  const canFire = myTurn && !hush && !!center;
  const revengeOn = myTurn && mine?.revengeOn ? mine.revengeOn : undefined;

  useEffect(() => { if (myTurn && !hush) { sfx.cock(); buzz(BUZZ.myTurn); } }, [myTurn, hush, state.turnIdx]);

  // warm the fine grid for every live game so re-centering never flashes a placeholder
  const aliveKey = alive.map((g) => g.appid).join(',');
  useEffect(() => { for (const g of alive) void pixelize(g.appid, 'box', FINE_W, FINE_H); }, [aliveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const aimAt = useCallback((delta: number) => {
    if (!myTurn || n < 2) return;
    const g = alive[(((ci + delta) % n) + n) % n];
    sfx.whoosh();
    send({ t: 'aim', appid: g.appid });
  }, [myTurn, n, ci, alive, send]);

  // one shot per turn, however it's triggered (pointer release, Space, Enter on the focused gun)
  const turnKey = `${state.turnIdx}:${state.turnDeadline}`;
  const latch = useRef('');
  const [bang, setBang] = useState(0); // recoil / flash animation key
  const fire = useCallback(() => {
    if (!canFire || latch.current === turnKey) return false;
    latch.current = turnKey;
    setBang(Date.now());
    send({ t: 'fire', appid: center.appid });
    return true;
  }, [canFire, turnKey, center, send]);
  // the server didn't take it (socket blip): unlock after a moment if the turn hasn't moved on
  useEffect(() => {
    if (!bang) return;
    const k = turnKey;
    const t = window.setTimeout(() => { if (latch.current === k) latch.current = ''; }, 2500);
    return () => clearTimeout(t);
  }, [bang]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // swipe (touch, pen or mouse): ~30px horizontal flick aims; any real drag cancels the tap-to-aim click
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
  /** a press that started on the protect badge never fires, even if it's released over the box */
  const fromBadge = useRef(false);

  const [epi, setEpi] = useState<number | null>(null);
  const epiGame = dead.find((g) => g.appid === epi);
  const starFree = !!mine && !mine.shieldUsed;
  const pin = (appid: number) => {
    if (!starFree) return;
    sfx.click();
    send({ t: 'shield', appid });
  };

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

  // desktop: the gun sits in flow under the carousel (sticky to the bottom edge). Scroll the stage so the box,
  // its name and the raised gun are all on screen together instead of the gun covering the box.
  const carRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const car = carRef.current;
      if (!car || window.innerWidth <= 640 || window.innerHeight <= 500) return;
      const front = car.closest('.saloon-front') as HTMLElement | null;
      if (!front) return;
      const need = car.getBoundingClientRect().bottom + 40 + 164 + 6 - window.innerHeight;
      if (need > 4) front.scrollBy({ top: need, behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [state.turnIdx, n, !!state.sheriff]); // eslint-disable-line react-hooks/exhaustive-deps

  const shooterName = shooter?.name ?? 'Someone';
  const instr = n <= finaleN ? <span>Finale!</span>
    : hush ? (shooterId === me ? <span className="your-shot">You're up next</span> : <span><b>{shooterName}</b> is up next</span>)
    : myTurn ? <span className="your-shot">{revengeOn ? 'Revenge! ' : 'Your turn: '}shoot a game you <u>DON'T</u> want</span>
    : <span><b>{shooterName}</b> is aiming…</span>;

  return (
    <div className={`veto vt ${myTurn ? 'my-turn' : ''} ${revengeOn ? 'revenge' : ''} ${hush ? 'vt-hushed' : ''}`}>
      <div className="veto-head">
        <div className="veto-status vt-instr" aria-live="polite">{instr}</div>
        <div className="veto-count vt-count"><b>{n}</b> left{n > finaleN && <span> · down to {finaleN}, {finaleTail}</span>}</div>
        {revengeOn && <div className="gp-revenge-tag">REVENGE on {nameOf(revengeOn)}</div>}
        {state.turnDeadline > 0 && <Fuse deadline={state.turnDeadline} skew={skew} mine={myTurn && !hush} turnMs={turnMs} />}
      </div>

      {state.sheriff && <SheriffPanel state={state} me={me} send={send} skew={skew} on={on} finaleN={finaleN} />}

      <div ref={carRef} className={`carousel ${hush ? 'vt-hush' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd}>
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
          const isC = d === 0;
          const mineStar = starred(g);
          return (
            <div
              key={g.appid}
              className={`cbox ${isC ? 'center' : ''} ${isC && canFire ? 'vt-shootable' : ''}`}
              style={style}
              onPointerDownCapture={(e) => { fromBadge.current = !!(e.target as HTMLElement).closest?.('.vt-badge'); }}
              onClick={(e) => {
                if (swiped.current) { swiped.current = false; return; }
                if (fromBadge.current) { fromBadge.current = false; return; }
                // only the box art itself is a trigger (not the name / byline under it)
                if (isC) { if (canFire && (e.target as HTMLElement).closest?.('.gbox')) fire(); return; }
                if (myTurn && !hush) { sfx.whoosh(); send({ t: 'aim', appid: g.appid }); }
              }}
            >
              <div className="cbox-bob">
                <div className={`gbox ${g.cracks ? 'cracked' : ''}`}>
                  {isC
                    ? <PixelArt appid={g.appid} name={g.name} w={FINE_W} h={FINE_H} className="vt-fine" />
                    : <PixelArt appid={g.appid} name={g.name} holes={g.cracks ? 1 : 0} cracked={!!g.cracks} />}
                  {isC && !!g.cracks && <PixelSprite draw={crackFor(g.appid)} w={36} h={54} className="vt-crack" />}
                  {g.tier === 'pitch' && <span className="gbox-pitch">PITCH</span>}
                  {!!g.cracks && <span className="gbox-more">1 more</span>}
                  {(mineStar ? a <= 2 : a <= 1 && starFree) && (
                    <button
                      type="button"
                      className={`vt-badge ${mineStar ? 'pinned' : 'open'} ${isC ? 'big' : 'small'}`}
                      disabled={!mineStar && !starFree}
                      aria-pressed={mineStar}
                      aria-label={mineStar ? `Your star protects ${g.name}` : `Protect ${g.name} (only you'll know)`}
                      title={mineStar ? 'Your star is here (only you know)' : "Protect this game (only you'll know)"}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); if (!mineStar) pin(g.appid); }}
                    >
                      {mineStar && pinning.has(g.appid)
                        ? <span className="px-star-pin vt-badge-pin"><TinStar size={isC ? 40 : 30} /></span>
                        : <TinStar size={isC ? 40 : 30} />}
                    </button>
                  )}
                </div>
                {isC && <div className="cbox-name">{g.name}</div>}
                {isC && <div className="cbox-by">{g.by.length ? `by ${g.by.map(nameOf).join(', ')}` : 'house pick'}</div>}
              </div>
              {isC && <Crosshair hot={canFire} revenge={!!revengeOn} />}
            </div>
          );
        })}
        {n === 0 && <div className="veto-empty">Smoke clears…</div>}
      </div>

      <div className={`vt-gunbar ${canFire ? 'live' : 'idle'}`}>
        <button className="vt-arrow px-btn" disabled={!canFire || n < 2} onPointerEnter={() => sfx.hover()} onClick={() => aimAt(-1)} aria-label="Aim left">◀</button>
        <Revolver
          live={canFire}
          revenge={!!revengeOn}
          bang={bang}
          onFire={fire}
          label={canFire || hush ? '' : `Waiting on ${shooterName}`}
          aimName={center?.name}
        />
        <button className="vt-arrow px-btn" disabled={!canFire || n < 2} onPointerEnter={() => sfx.hover()} onClick={() => aimAt(1)} aria-label="Aim right">▶</button>
        {canFire && <div className="vt-hint">◀ ▶ aim · click or Space fires</div>}
      </div>

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

/** bullet hole + crack overlay for a cracked pitch on the fine grid (drawn at the coarse grid so it reads) */
const crackCache = new Map<number, DrawFn>();
function crackFor(appid: number): DrawFn {
  let f = crackCache.get(appid);
  if (!f) {
    const seed = hashStr(String(appid)) % 997;
    f = (c, w, h) => {
      holeAt(c, 6 + Math.floor(rnd(seed, 0, 3) * (w - 12)), 8 + Math.floor(rnd(seed, 0, 4) * (h - 16)));
      drawCrack(c, w, h);
    };
    crackCache.set(appid, f);
  }
  return f;
}

const CROSS_COLD = crosshairDraw('rgba(232,213,181,.7)');
const CROSS_HOT = crosshairDraw('#ff3b2f');

function Crosshair({ hot, revenge }: { hot: boolean; revenge?: boolean }) {
  return <PixelSprite draw={hot ? CROSS_HOT : CROSS_COLD} w={33} h={33} className={`crosshair ${hot ? 'hot' : ''} ${revenge ? 'revenge' : ''}`} />;
}

/* ---------------- the revolver (fires at the centered game) ---------------- */

const RW = 36, RH = 72;
/** a single-action revolver seen from the side, barrel up: gunmetal frame, fluted cylinder, walnut grip, hammer */
const revolverDraw = (cocked: boolean, red: boolean): DrawFn => (c) => {
  const r = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const M0 = PAL.metal0, M1 = PAL.metal1, M2 = PAL.metal2, M3 = PAL.metal3, M4 = PAL.metal4, INK = PAL.ink;
  // --- barrel (x 15..22) ---
  r(15, 2, 8, 26, INK);
  r(16, 3, 1, 24, M4); r(17, 3, 2, 24, M3); r(19, 3, 2, 24, M2); r(21, 3, 1, 24, M1);
  r(17, 1, 4, 2, INK); r(18, 0, 2, 2, M3); // front sight
  r(17, 3, 4, 2, M0); r(18, 3, 2, 1, INK); // muzzle bore
  for (let y = 6; y < 26; y += 3) if (bayer(17, y) > 0.4) r(17, y, 1, 1, M4); // polish glints
  // ejector housing along the right side
  r(22, 8, 4, 20, INK); r(23, 9, 2, 18, M2); r(23, 9, 1, 18, M3); r(23, 11, 2, 1, M1);
  // barrel band / forcing cone
  r(13, 26, 14, 4, INK); r(14, 27, 12, 2, M2); r(14, 27, 12, 1, M3);
  // --- cylinder (x 11..28, y 30..44) ---
  r(12, 30, 16, 15, INK); r(11, 31, 18, 13, INK);
  r(12, 31, 16, 13, M2);
  r(13, 31, 2, 13, M4); r(15, 31, 2, 13, M3); r(24, 31, 3, 13, M1);
  for (const fx of [18, 22]) { r(fx, 32, 1, 11, M0); r(fx + 1, 32, 1, 11, M3); } // flutes
  r(12, 34, 16, 1, M1); r(12, 40, 16, 1, M1);
  r(14, 32, 1, 1, PAL.white); // specular
  // --- frame / recoil shield (y 44..53) ---
  r(13, 44, 14, 10, INK); r(14, 45, 12, 8, M2); r(14, 45, 12, 1, M3); r(14, 45, 1, 8, M4); r(24, 46, 2, 7, M1);
  r(16, 48, 2, 2, PAL.lamp1); r(16, 48, 1, 1, PAL.lamp0); // brass screw
  // --- hammer (left side) ---
  if (cocked) {
    r(8, 47, 6, 5, INK); r(9, 48, 5, 3, M3); r(9, 48, 5, 1, M4);
    r(4, 50, 6, 4, INK); r(5, 51, 4, 2, M2); r(5, 51, 1, 1, M4); // spur pulled back
  } else {
    r(10, 44, 4, 6, INK); r(11, 45, 3, 4, M3); r(11, 45, 1, 4, M4);
    r(8, 43, 4, 3, INK); r(9, 44, 2, 1, M2); // spur resting forward
  }
  // --- trigger guard + trigger (right side) ---
  r(26, 47, 5, 2, INK); r(30, 47, 2, 10, INK); r(26, 55, 5, 2, INK);
  r(27, 48, 3, 1, M3); r(30, 49, 1, 6, M2);
  if (cocked) { r(26, 50, 2, 1, M3); r(27, 51, 1, 2, M2); } else { r(26, 49, 3, 1, M3); r(28, 50, 1, 3, M2); }
  // --- grip (walnut, angled down-right) ---
  for (let y = 53; y < RH; y++) {
    const off = Math.floor((y - 53) / 6);
    const x0 = 13 + off, x1 = 26 + off;
    r(x0, y, x1 - x0, 1, INK);
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const grain = Math.sin((x - off) * 1.7 + y * 0.35) + (rnd(x, y, 61) - 0.5) * 0.9;
      const checker = (x + y) % 2 === 0 && y > 57 && y < RH - 4 && x > x0 + 2 && x < x1 - 3;
      let col: string = grain > 0.7 ? PAL.wood4 : grain < -0.8 ? PAL.wood2 : PAL.wood3;
      if (checker) col = PAL.wood2;
      if (x === x0 + 1) col = M3; // backstrap
      if (x === x0 + 2 && !checker) col = PAL.wood4;
      c.fillStyle = col; c.fillRect(x, y, 1, 1);
    }
  }
  r(20, 62, 2, 2, PAL.lamp1); r(20, 62, 1, 1, PAL.lamp0); // grip screw
  if (red) { c.fillStyle = 'rgba(255,40,30,.28)'; c.fillRect(11, 26, 18, 28); }
};
const GUN = {
  rest: revolverDraw(false, false), cocked: revolverDraw(true, false),
  restR: revolverDraw(false, true), cockedR: revolverDraw(true, true),
};
const PUFFS = [[0, 0, 0], [-10, -6, 90], [9, -12, 180]];

function Revolver({ live, revenge, bang, onFire, label, aimName }: {
  live: boolean; revenge: boolean; bang: number; onFire: () => boolean; label: string; aimName?: string;
}) {
  const [cocked, setCocked] = useState(false);
  const ptr = useRef<number | null>(null);
  useEffect(() => { if (!live) { setCocked(false); ptr.current = null; } }, [live]);
  // Space / keyboard fire: show the hammer fall too
  const [kick, setKick] = useState(0);
  useEffect(() => {
    if (!bang) return;
    setKick(bang); setCocked(false);
    const t = window.setTimeout(() => setKick((k) => (k === bang ? 0 : k)), 900);
    return () => clearTimeout(t);
  }, [bang]);
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!live || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    ptr.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    setCocked(true);
    sfx.click();
    buzz([8]);
  };
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (ptr.current !== e.pointerId) return;
    ptr.current = null;
    if (!onFire()) setCocked(false);
  };
  const cancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (ptr.current !== e.pointerId) return;
    ptr.current = null;
    setCocked(false);
  };
  const draw = revenge ? (cocked ? GUN.cockedR : GUN.restR) : (cocked ? GUN.cocked : GUN.rest);
  return (
    <div className={`vt-gun ${live ? 'up' : 'down'} ${cocked ? 'cocked' : ''} ${revenge ? 'red' : ''}`}>
      <button
        type="button"
        className="vt-gun-hit"
        disabled={!live}
        aria-label={live ? `Fire at ${aimName ?? 'the centered game'}` : label || 'Holstered'}
        onPointerDown={down} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onFire(); } }}
      >
        <span className="vt-gun-body" key={kick || 'still'} data-kick={kick ? 1 : 0}>
          <PixelSprite draw={draw} w={RW} h={RH} className="vt-gun-sp" />
          {kick > 0 && (
            <>
              <PixelSprite draw={drawFlash} w={21} h={21} className="vt-flash" />
              {PUFFS.map(([x, y, d], i) => <PixelSprite key={i} draw={drawSmoke} w={18} h={14} className="vt-smoke" style={{ '--x': `${x}px`, '--y': `${y}px`, animationDelay: `${d}ms` } as CSSProperties} />)}
            </>
          )}
        </span>
      </button>
      {label && <div className={`vt-gun-lbl ${live ? 'live' : ''}`}>{label}</div>}
    </div>
  );
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
