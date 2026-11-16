// Quick-draw duel between the two finalists' champions.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import type { Player } from '../../shared/types';
import { useNow } from '../net';
import { sfx } from '../sfx';
import BustPreview from '../pixel/BustPreview';
import { PixelCover } from '../pixel/PixelCover';
import { PixelSprite } from '../pixel/PixelCanvas';
import { drawFlash, legacyStyle } from '../pixel/sprites';
import { BUZZ, buzz } from '../scene/haptics';
import { heartbeat, useShotExtras } from './ShotExtras';
import './gameplay.css';

const FUSE_MS = 6000; // the fuse creeps at a fixed pace; it does NOT reveal when DRAW lands

function useViewport() {
  const get = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

const fmt = (ms?: number) => (ms === undefined ? '—' : ms < 0 ? 'FOUL' : `${ms} ms`);

export default function Duel({ state, me, send, skew }: RoomProps) {
  useShotExtras(state, skew);
  const d = state.duel;
  const now = useNow(skew, !!d && !d.winner);
  const vp = useViewport();
  const drawn = !!d && now >= d.drawAt;
  const decided = !!d?.winner;
  const myIdx = d ? d.champs.indexOf(me) : -1;
  const amChamp = myIdx >= 0;

  const sent = useRef(false);
  const mountedAt = useRef(performance.now());
  const [jumped, setJumped] = useState(false);
  const drawShownAt = useRef<number | null>(null);
  const duelKey = d ? `${d.startedAt}` : '';
  useEffect(() => { sent.current = !!(d && d.taps[me] !== undefined); drawShownAt.current = null; setJumped(false); }, [duelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d && d.taps[me] !== undefined) sent.current = true; }, [d?.taps, me]); // eslint-disable-line react-hooks/exhaustive-deps

  // DRAW! is committed in this render: stamp the time on the first frame that will paint it
  useLayoutEffect(() => {
    if (!drawn || decided) return;
    sfx.cock();
    buzz(BUZZ.myTurn);
    const raf = requestAnimationFrame(() => { if (drawShownAt.current === null) drawShownAt.current = performance.now(); });
    return () => cancelAnimationFrame(raf);
  }, [drawn]); // eslint-disable-line react-hooks/exhaustive-deps

  // slow heartbeat while everyone waits
  useEffect(() => {
    if (!d || drawn || decided) return;
    const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    if (reduce) return;
    heartbeat();
    const id = window.setInterval(heartbeat, 1100);
    return () => clearInterval(id);
  }, [duelKey, drawn, decided]); // eslint-disable-line react-hooks/exhaustive-deps

  // winner reveal sounds
  useEffect(() => {
    if (!decided) return;
    sfx.shot();
    const t = window.setTimeout(() => sfx.stamp(), 450);
    return () => clearTimeout(t);
  }, [decided]);

  // input: tap anywhere / Space / Enter. Taps on the emote bar, sound menu or inputs don't count.
  const bangRef = useRef<() => void>(() => {});
  bangRef.current = () => {
    if (!d || !amChamp || decided || sent.current) return;
    // a leftover tap from the veto FIRE button as the phase flips isn't a foul: ignore input until the standoff begins
    if (Date.now() + skew < d.startedAt || performance.now() - mountedAt.current < 350) return;
    if (d.taps[me] !== undefined) { sent.current = true; return; }
    sent.current = true;
    if (Date.now() + skew < d.drawAt) {
      setJumped(true);
      sfx.click();
      send({ t: 'bang', reaction: -1 });
      return;
    }
    const shown = drawShownAt.current;
    const reaction = shown !== null ? Math.round(performance.now() - shown) : Math.max(1, Math.round(Date.now() + skew - d.drawAt));
    sfx.shot();
    buzz(BUZZ.hit);
    send({ t: 'bang', reaction: Math.max(1, reaction) });
  };
  useEffect(() => {
    const skip = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el?.closest?.('.emo, .sound, input, textarea, select, a');
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (skip(e.target)) return;
      bangRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space' && e.key !== 'Enter') return;
      if (skip(e.target)) return;
      e.preventDefault();
      if (e.repeat) return;
      bangRef.current();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, []);

  if (!d) return createPortal(<div className="duel"><div className="duel-title">Loading the duel…</div></div>, document.body);

  const player = (id: string) => state.players.find((p) => p.id === id);
  const gameName = (a: number) => state.board.find((g) => g.appid === a)?.name ?? `App ${a}`;
  const fuseP = Math.min(1, Math.max(0, (now - d.startedAt) / FUSE_MS));

  // sizing: bust scale + box width that fit two columns side by side (iPhone SE: 375x667)
  const land = vp.h <= 500 && vp.w > vp.h;
  const colW = Math.min(300, (land ? vp.w * 0.6 : vp.w) / 2 - 22);
  const roomH = land ? vp.h - 90 : vp.h - (vp.h < 700 ? 330 : 380); // room left for bust + box after header, names, fuse, button
  const bustScale = Math.max(1, Math.min(4, Math.floor(2 * Math.min(colW / 48, (roomH * 0.4) / 74)) / 2));
  const boxW = Math.max(70, Math.min(colW - 8, ((roomH - bustScale * 74 + 8) / 1.5) | 0, 190));

  const myTap = amChamp ? d.taps[me] : undefined;
  const winIdx = decided ? d.games.indexOf(d.winner!) : -1;

  const side = (k: 0 | 1) => {
    const champ = player(d.champs[k]);
    const appid = d.games[k];
    const tap = d.taps[d.champs[k]];
    const cls = decided ? (k === winIdx ? 'win' : 'lose') : '';
    return (
      <div className={`duel-side ${k ? 'right' : 'left'} ${cls}`} style={{ '--duel-bw': `${boxW}px` } as CSSProperties}>
        <Bust p={champ} scale={bustScale} />
        {decided && k === winIdx && <PixelSprite draw={drawFlash} w={21} h={21} className="duel-gunflash" />}
        <div className="duel-box">
          {decided && k !== winIdx ? (
            <>
              <div className="duel-half duel-l"><PixelCover appid={appid} name={gameName(appid)} kind="box" /></div>
              <div className="duel-half duel-r"><PixelCover appid={appid} name={gameName(appid)} kind="box" /></div>
              <div className="duel-stamp">NAH.</div>
            </>
          ) : <PixelCover appid={appid} name={gameName(appid)} kind="box" />}
        </div>
        <div className="duel-name">{gameName(appid)}</div>
        <div className={`duel-champ ${d.champs[k] === me ? 'me' : ''}`}>{d.champs[k] === me ? 'you' : champ?.name ?? 'a ghost'}</div>
        <div className={`duel-time ${tap !== undefined && tap < 0 ? 'foul' : ''} ${k === winIdx ? 'win' : ''}`}>{decided || tap !== undefined ? fmt(tap) : ''}</div>
      </div>
    );
  };

  const winnerChamp = decided ? player(d.champs[winIdx]) : undefined;
  return createPortal(
    <div className={`duel ${drawn && !decided ? 'drawn' : ''}`} role="main" aria-label="Quick-draw duel">
      <div className="duel-title">Quick-draw</div>
      <div className="duel-ring">
        {side(0)}
        <div className="duel-vs" aria-hidden>vs</div>
        {side(1)}
      </div>
      <div className="duel-hud">
        {!decided && !drawn && <div className="duel-steady">STEADY…</div>}
        {!decided && !drawn && <div className="duel-fuse" aria-hidden><i style={{ width: `${(1 - fuseP) * 100}%` }} /><b style={{ left: `${(1 - fuseP) * 100}%` }} /></div>}
        {decided && (
          <div className="duel-verdict">
            {gameName(d.winner!)} wins{winnerChamp ? `: ${winnerChamp.name} was faster` : ''}
          </div>
        )}
        {amChamp && !decided && (
          <button className="duel-bang px-btn" disabled={myTap !== undefined || jumped} aria-label="Bang">{jumped ? 'FOUL' : myTap !== undefined ? fmt(myTap) : 'BANG!'}</button>
        )}
        {amChamp && !decided && <div className="duel-note">{myTap !== undefined ? 'Waiting on the other gun…' : drawn ? 'NOW!' : 'Wait for DRAW!, then tap.'}</div>}
        {!amChamp && !decided && <div className="duel-spect px-box">SPECTATING</div>}
      </div>
      {drawn && !decided && <div className="duel-flash" />}
      {drawn && !decided && <div className="duel-draw">DRAW!</div>}
      {jumped && !decided && <div className="duel-jump">JUMPED THE GUN!</div>}
    </div>,
    document.body,
  );
}

function Bust({ p, scale }: { p?: Player; scale: number }) {
  if (!p) return <div style={{ height: 74 * scale }} />;
  const look = p.style ?? legacyStyle(p.look, p.id);
  return <BustPreview look={look} scale={scale} />;
}
