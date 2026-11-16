import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RoomProps } from '../props';
import { BADGES, FINALES, type BadgeId } from '../../shared/types';
import { sfx } from '../sfx';
import { PixelArt, PixelPanel, PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import type { DrawFn } from '../pixel/sprites';
import '../pixel/pixel.css';
import PixelIcon from '../ui/PixelIcon';
import { useUiP } from '../ui/scale';

const drawNail: DrawFn = (c) => {
  c.fillStyle = 'rgba(42,26,16,.55)'; c.fillRect(2, 5, 5, 2);
  c.fillStyle = PAL.metal0; c.fillRect(1, 1, 5, 5);
  c.fillStyle = PAL.metal2; c.fillRect(1, 1, 4, 4);
  c.fillStyle = PAL.metal3; c.fillRect(2, 2, 2, 2);
  c.fillStyle = PAL.metal4; c.fillRect(2, 2, 1, 1);
};
const NAILS: [string, string][] = [['8px', '8px'], ['calc(100% - 22px)', '8px'], ['calc(50% - 7px)', '4px']];
import { BUZZ, buzz } from '../scene/haptics';
import { useShotExtras } from './ShotExtras';
import { PosseRecordCard } from './Lobby';
import GroupPhoto from '../fun/GroupPhoto';
import './panels.css';

/** The end page: the winner big on a WANTED poster, one line on how it was won, a few badges, this table's record, the host's buttons. */
export default function Result(props: RoomProps) {
  const { state, me, send, skew } = props;
  const res = state.result;
  useShotExtras(state, skew);
  const uiP = useUiP();
  useEffect(() => { sfx.win(); buzz(BUZZ.win); }, []);
  // the winning chamber zooms in, becomes the poster, then gets nailed up (3 hits)
  const [nails, setNails] = useState(0);
  const posterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    if (reduce) { setNails(3); return; }
    const ts = [950, 1250, 1550].map((ms, i) => window.setTimeout(() => {
      setNails(i + 1);
      sfx.hammerNail();
      const el = posterRef.current;
      if (el) { el.classList.remove('px-poster-thunk'); void el.offsetWidth; el.classList.add('px-poster-thunk'); }
    }, ms));
    return () => ts.forEach(clearTimeout);
  }, []);
  const amHost = !!state.players.find((p) => p.id === me)?.host;
  const nameOf = (id: string) => (id === me ? 'You' : state.players.find((p) => p.id === id)?.name ?? '???');

  if (!res) return <div className="rs"><div className="roulette-title">Counting the bounty…</div></div>;

  // how it was won: the finale that actually ran (never a stale setting) + who tossed it in
  const duel = state.duel;
  const duelMs = duel?.winner === res.appid ? duel.taps[duel.champs[duel.games.indexOf(res.appid)]] : undefined;
  const slide = state.slide?.winner === res.appid ? state.slide : undefined;
  const mini = state.mini?.winner === res.appid ? state.mini : undefined;
  const voted = state.vote?.picked;
  const how = duel?.winner === res.appid ? (duelMs !== undefined && duelMs >= 0 ? `Quick-draw in ${duelMs} ms` : 'Quick-draw')
    : mini ? FINALES[mini.kind].label
    : slide ? 'Whiskey slide'
    : state.roulette ? 'Revolver roulette'
    : voted ? FINALES[voted].label
    : 'Last one standing';
  const winBy = state.board.find((b) => b.appid === res.appid)?.by ?? [];
  const by = winBy.length ? `tossed in by ${winBy.map((id) => (id === me ? 'you' : nameOf(id))).join(', ')}` : 'dealt by the house';

  // up to 4 badges, mine first
  const order = [...state.players].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  const chips = order.flatMap((p) => ((res.badges ?? {})[p.id] ?? []).filter((b): b is BadgeId => b in BADGES).map((b) => ({ p, b }))).slice(0, 4);

  return (
    <div className="rs">
      <div className="rs-poster poster-wrap">
        <div className="poster px-poster-in" ref={posterRef}>
          {NAILS.map(([l, t], i) => <PixelSprite key={i} draw={drawNail} w={7} h={7} className={`px-nail ${nails > i ? 'on' : ''}`} style={{ left: l, top: t }} />)}
          <PixelPanel kind="paper" size={uiP} />
          <div className="poster-body">
            <div className="poster-wanted">WANTED</div>
            <div className="poster-art"><PixelArt appid={res.appid} name={res.name} w={48} h={72} /></div>
            <div className="poster-name">{res.name}</div>
          </div>
          {res.repeatCount >= 2 && <div className="poster-repeat">Played the last {res.repeatCount} times</div>}
        </div>
      </div>

      <div className="rs-side">
        <div className="rs-how">
          <span className="rs-k">Won by</span>
          <b className="rs-how-b">{how}</b>
          <span className="rs-how-sub">{by}</span>
        </div>
        {chips.length > 0 && (
          <div className="rs-badges" aria-label="Badges">
            {chips.map(({ p, b }, k) => (
              <span key={`${p.id}:${b}`} className="rs-badge" title={BADGES[b].desc} style={{ '--dl': `${1700 + k * 220}ms` } as CSSProperties}>
                <i aria-hidden><PixelIcon name={b} /></i>
                <span className="rs-badge-t"><b>{BADGES[b].label}</b><small>{p.id === me ? 'You' : p.name}</small></span>
              </span>
            ))}
          </div>
        )}
        <PosseRecordCard state={state} />
        <div className="rs-acts">
          {amHost ? <>
            <button type="button" className="nh-btn nh-btn-big rs-again" onClick={() => { sfx.unlock(); sfx.cock(); send({ t: 'again' }); }}>Another round</button>
            <button type="button" className="nh-btn rs-rematch" title="Same games, same posse, straight back to the shootout" onClick={() => { sfx.unlock(); sfx.click(); send({ t: 'rematch' }); }}>Rematch</button>
          </> : <div className="nh-waiting rs-wait"><i className="nh-spin" /> Waiting on the host…</div>}
          <span className="rs-photo"><GroupPhoto {...props} /></span>
        </div>
      </div>
    </div>
  );
}
