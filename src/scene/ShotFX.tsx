import type { BoardGame, Player, ShotEvent } from '../../shared/types';
import GameArt from './GameArt';
import TinStar from './TinStar';

/** Full-screen shot animation. Rendered by Saloon so it survives a phase flip (e.g. last shot -> roulette). */
export default function ShotFX({ shot, board, players }: { shot: ShotEvent; board: BoardGame[]; players: Player[] }) {
  const game = board.find((g) => g.appid === shot.appid);
  const who = players.find((p) => p.id === shot.actor)?.name ?? 'Someone';
  const name = game?.name ?? 'that one';
  const rico = shot.kind === 'ricochet';
  return (
    <div className={`fx fx-${shot.kind}`} aria-live="polite">
      {!rico && <div className="fx-flash" />}
      {shot.kind === 'misfire' && (
        <div className="fx-banner">The fuse ran out, {who}'s gun went off!</div>
      )}
      <div className="fx-box">
        {rico ? (
          <>
            <div className="fx-whole"><GameArt appid={shot.appid} name={name} /></div>
            <div className="fx-sparks">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ['--a' as string]: `${i * 26}deg`, ['--d' as string]: `${60 + (i * 37) % 70}px` }} />)}</div>
            <TinStar size={70} className="fx-star" />
            <div className="fx-ping">PING!</div>
          </>
        ) : (
          <>
            <div className="fx-half fx-left"><GameArt appid={shot.appid} name={name} /></div>
            <div className="fx-half fx-right"><GameArt appid={shot.appid} name={name} /></div>
            <div className="fx-hole" />
            <div className="fx-stamp">NAH.</div>
          </>
        )}
      </div>
      <div className="fx-caption">
        {rico ? <><b>{who}</b> shot <b>{name}</b>… the tin star took the bullet</> : <><b>{who}</b> shot <b>{name}</b></>}
      </div>
    </div>
  );
}
