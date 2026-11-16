// Sheriff strip for the shootout: badge + name, the Sheriff's Pardon / Jail, the posse's "run 'em out of town" vote,
// a compact turn order with JAILED tags, and the pardoned game rising from Boot Hill.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import type { BoardGame } from '../../shared/types';
import { MiniBust } from '../pixel/BustPreview';
import { PixelArt, PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import type { DrawFn } from '../pixel/sprites';
import { sfx } from '../sfx';
import './gameplay.css';

/** 13x13 tin sheriff's badge: a six-point star with ball tips */
const inStar = (x: number, y: number) => {
  const dx = x - 6, dy = y - 6, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx) + Math.PI / 2;
  const k = Math.max(0, Math.cos(3 * th));
  return d <= 2.9 + 3.4 * k * k * k;
};
const drawBadge: DrawFn = (c) => {
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
    if (!inStar(x, y)) continue;
    const edge = !inStar(x - 1, y) || !inStar(x + 1, y) || !inStar(x, y - 1) || !inStar(x, y + 1);
    c.fillStyle = edge ? PAL.ink : x + y < 10 ? PAL.metal4 : x + y < 14 ? PAL.metal3 : PAL.metal2;
    c.fillRect(x, y, 1, 1);
  }
  c.fillStyle = PAL.metal1; c.fillRect(5, 5, 3, 3);
  c.fillStyle = PAL.lamp1; c.fillRect(6, 6, 1, 1);
};

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export default function SheriffPanel({ state, me, send, finaleN }: RoomProps & { finaleN: number }) {
  const sh = state.sheriff;
  const [open, setOpen] = useState(() => { try { return window.innerWidth > 640; } catch { return true; } });
  const [pick, setPick] = useState<'pardon' | 'jail' | null>(null);

  // a pardoned game climbs out of Boot Hill (only when pardonUsed flips in the same update the game came back)
  const prev = useRef<{ dead: Set<number>; used: boolean } | null>(null);
  const [risen, setRisen] = useState<BoardGame | null>(null);
  const deadKey = state.board.filter((g) => !g.alive).map((g) => g.appid).join(',');
  useEffect(() => {
    const dead = new Set(state.board.filter((g) => !g.alive).map((g) => g.appid));
    const used = !!sh?.pardonUsed;
    const p = prev.current;
    prev.current = { dead, used };
    if (!p || !used || p.used) return;
    const back = state.board.find((g) => g.alive && p.dead.has(g.appid));
    if (!back) return;
    setRisen(back);
    sfx.drawSting();
  }, [deadKey, sh?.pardonUsed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!risen) return;
    const t = window.setTimeout(() => setRisen(null), reduced() ? 1400 : 2400);
    return () => clearTimeout(t);
  }, [risen]);

  if (!sh) return null;
  const sheriff = state.players.find((p) => p.id === sh.pid);
  const amSheriff = sh.pid === me;
  const mine = state.players.find((p) => p.id === me);
  const nameOf = (id?: string) => (id === me ? 'You' : state.players.find((p) => p.id === id)?.name ?? '???');
  const dead = state.board.filter((g) => !g.alive);
  const aliveN = state.board.filter((g) => g.alive).length;
  const voters = state.players.filter((p) => !p.bot && p.connected && p.id !== sh.pid);
  const need = Math.floor(voters.length / 2) + 1;
  const votes = sh.votes.filter((v) => voters.some((p) => p.id === v)).length;
  const myVote = sh.votes.includes(me);
  const canPardon = amSheriff && !sh.ousted && !sh.pardonUsed && dead.length > 0 && aliveN > finaleN;
  const canJail = amSheriff && !sh.ousted && !sh.jailUsed;
  const jailable = state.turnOrder.filter((id) => id !== me && id !== sh.jailed);
  // upcoming shooters (the next few from the current turn)
  const order = state.turnOrder.length ? Array.from({ length: Math.min(state.turnOrder.length, 6) }, (_, k) => state.turnOrder[(state.turnIdx + k) % state.turnOrder.length]) : [];

  const choose = (k: 'pardon' | 'jail') => { sfx.click(); setPick((x) => (x === k ? null : k)); setOpen(true); };

  return (
    <div className={`sher ${open ? 'open' : ''} ${sh.ousted ? 'ousted' : ''}`}>
      <button className="sher-head" onClick={() => { sfx.click(); setOpen((o) => !o); setPick(null); }} aria-expanded={open} aria-label="Sheriff panel">
        <PixelSprite draw={drawBadge} w={13} h={13} className="sher-badge" />
        {sheriff && <MiniBust p={sheriff} className="sher-bust" />}
        <span className="sher-name">Sheriff: <b>{amSheriff ? 'You' : sheriff?.name ?? '???'}</b></span>
        {!open && sh.jailed && <span className="sher-jail-chip" title={`${nameOf(sh.jailed)} is in jail: next turn skipped`}>⛓ {nameOf(sh.jailed)}</span>}
        {sh.ousted ? <span className="sher-out">RUN OUT OF TOWN</span>
          : votes > 0 && <span className="sher-votes" title="Votes to run the Sheriff out of town">{votes}/{need}</span>}
        <span className="sher-chev" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="sher-body">
          <div className="sher-acts">
            {amSheriff && !sh.ousted && (
              <>
                <button className={`px-btn px-btn-sm sher-act ${pick === 'pardon' ? 'on' : ''}`} disabled={!canPardon} onClick={() => choose('pardon')}
                  title={sh.pardonUsed ? 'Pardon used' : aliveN <= finaleN ? 'Too late: the finale decides now' : dead.length ? 'Bring one game back from Boot Hill' : 'Nobody on Boot Hill yet'}>
                  {sh.pardonUsed ? 'Pardoned' : 'Pardon'}
                </button>
                <button className={`px-btn px-btn-sm sher-act ${pick === 'jail' ? 'on' : ''}`} disabled={!canJail} onClick={() => choose('jail')}
                  title={sh.jailUsed ? 'Jail used' : "Skip a player's next turn"}>
                  {sh.jailUsed ? 'Jailed' : 'Jail'}
                </button>
              </>
            )}
            {amSheriff && sh.ousted && <span className="sher-note">They ran you out of town. No badge, no powers.</span>}
            {!amSheriff && !sh.ousted && mine && !mine.bot && (
              <button className={`px-btn px-btn-sm sher-act sher-oust ${myVote ? 'on' : ''}`} onClick={() => { sfx.click(); send({ t: 'oust' }); }} aria-pressed={myVote}>
                {myVote ? "✓ Run 'em out" : "Run 'em out of town"} <small>{votes}/{need} votes</small>
              </button>
            )}
            {!amSheriff && sh.ousted && <span className="sher-note">The posse ran the Sheriff out of town.</span>}
          </div>

          {pick === 'pardon' && canPardon && (
            <div className="sher-pick">
              <div className="sher-pick-lbl">Pardon who from Boot Hill?</div>
              <div className="sher-pick-row">
                {dead.map((g) => (
                  <button key={g.appid} className="sher-grave" onClick={() => { sfx.coin(); send({ t: 'pardon', appid: g.appid }); setPick(null); }} title={g.name}>
                    <PixelArt appid={g.appid} name={g.name} w={24} h={36} />
                    <span>{g.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {pick === 'jail' && canJail && (
            <div className="sher-pick">
              <div className="sher-pick-lbl">Lock up who? Their next turn is skipped.</div>
              <div className="sher-pick-row">
                {jailable.map((id) => {
                  const p = state.players.find((x) => x.id === id);
                  if (!p) return null;
                  return (
                    <button key={id} className="sher-pl" onClick={() => { sfx.hammerNail(); send({ t: 'jail', pid: id }); setPick(null); }}>
                      <MiniBust p={p} className="sher-pl-bust" />
                      <span>{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {order.length > 1 && (
            <div className="sher-order" aria-label="Turn order">
              {order.map((id, k) => {
                const p = state.players.find((x) => x.id === id);
                const jailed = sh.jailed === id;
                const out = sh.ousted && id === sh.pid;
                return (
                  <span key={`${id}${k}`} className={`sher-o ${k === 0 ? 'now' : ''} ${jailed ? 'jailed' : ''} ${out ? 'out' : ''}`}>
                    {p && <MiniBust p={p} className="sher-o-bust" />}
                    <em>{nameOf(id)}</em>
                    {jailed && <b>JAILED</b>}
                    {out && <b>RUN OUT</b>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {risen && createPortal(
        <div className="sher-rise" aria-live="polite">
          <div className="sher-rise-box" style={{ '--d': reduced() ? '0s' : '2.4s' } as CSSProperties}>
            <i className="sher-halo" aria-hidden />
            <PixelArt appid={risen.appid} name={risen.name} w={36} h={54} />
          </div>
          <div className="sher-rise-lbl"><b>PARDONED</b>{risen.name} rises from Boot Hill</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
