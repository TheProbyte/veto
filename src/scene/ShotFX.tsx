import type { CSSProperties } from 'react';
import type { BoardGame, Player, ShotEvent } from '../../shared/types';
import { PixelArt, PixelSprite } from '../pixel/PixelCanvas';
import { drawCrack, drawFlash, drawHole, drawSmoke } from '../pixel/sprites';
import TinStar from './TinStar';
import { FINE_H, FINE_W } from '../pixel/pixelize';

const SPARKS = Array.from({ length: 12 }, (_, i) => ({ a: i * 30 + ((i * 17) % 13), d: 60 + ((i * 37) % 70) }));
const PUFFS = [[-30, 10, 0], [26, -6, 80], [4, 30, 160], [-12, -26, 220]];

/** Full-screen shot animation. Rendered by Saloon so it survives a phase flip (e.g. last shot -> roulette). */
export default function ShotFX({ shot, board, players }: { shot: ShotEvent; board: BoardGame[]; players: Player[] }) {
  const game = board.find((g) => g.appid === shot.appid);
  const who = players.find((p) => p.id === shot.actor)?.name ?? 'Someone';
  const name = game?.name ?? 'that one';
  const rico = shot.kind === 'ricochet';
  const crack = shot.kind === 'crack';
  return (
    <div className={`fx fx-${shot.kind}`} aria-live="polite">
      {!rico && <div className="fx-flash" />}
      {shot.kind === 'misfire' && <div className="fx-banner px-box">Fuse ran out! {who}'s gun went off</div>}
      <div className="fx-box">
        {rico ? (
          <>
            <div className="fx-whole"><PixelArt appid={shot.appid} name={name} w={FINE_W} h={FINE_H} /></div>
            <div className="fx-sparks">{SPARKS.map((s, i) => <i key={i} style={{ '--a': `${s.a}deg`, '--d': `${s.d}px` } as CSSProperties} />)}</div>
            <TinStar size={70} className="fx-star" />
            <div className="fx-ping">PING!</div>
          </>
        ) : crack ? (
          <>
            <div className="fx-whole fx-shudder"><PixelArt appid={shot.appid} name={name} w={FINE_W} h={FINE_H} /><PixelSprite draw={drawCrack} w={36} h={54} className="fx-crackov" /></div>
            <PixelSprite draw={drawFlash} w={21} h={21} className="fx-muzzle" />
            {PUFFS.map(([x, y, d], i) => <PixelSprite key={i} draw={drawSmoke} w={18} h={14} className="fx-smoke" style={{ '--x': `${x}px`, '--y': `${y}px`, animationDelay: `${d}ms` } as CSSProperties} />)}
            <div className="fx-cracked">CRACKED!<small>1 more</small></div>
          </>
        ) : (
          <>
            <div className="fx-half fx-left"><PixelArt appid={shot.appid} name={name} w={FINE_W} h={FINE_H} /></div>
            <div className="fx-half fx-right"><PixelArt appid={shot.appid} name={name} w={FINE_W} h={FINE_H} /></div>
            <PixelSprite draw={drawHole} w={13} h={13} className="fx-hole" />
            <PixelSprite draw={drawFlash} w={21} h={21} className="fx-muzzle" />
            {PUFFS.map(([x, y, d], i) => <PixelSprite key={i} draw={drawSmoke} w={18} h={14} className="fx-smoke" style={{ '--x': `${x}px`, '--y': `${y}px`, animationDelay: `${d}ms` } as CSSProperties} />)}
            <div className="fx-stamp">NAH.</div>
          </>
        )}
      </div>
      <div className="fx-caption px-box">
        {rico ? <><b>{name}</b> had a tin star. Ricochet!</>
          : crack ? <><b>{who}</b> cracked <b>{name}</b>. One more shot.</>
          : <><b>{who}</b> shot <b>{name}</b></>}
      </div>
    </div>
  );
}
