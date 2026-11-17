// Saddle Up: ready check under LAUNCH, then a synced 3-2-1 that opens the game for everyone who's ready.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import type { Launch } from '../../shared/types';
import { useNow } from '../net';
import { MiniBust } from '../pixel/BustPreview';
import { sfx } from '../sfx';
import { BUZZ, buzz } from '../scene/haptics';
import { playVoice } from '../voice';
import './gameplay.css';
import PixelIcon from '../ui/PixelIcon';

type Status = Launch['ready'][string];
const CHIP: Record<Status | 'wait', { icon: string; label: string }> = {
  ready: { icon: '✓', label: 'Ready' },
  download: { icon: '⬇', label: 'Downloading' },
  buy: { icon: '💲', label: 'Need to buy' },
  wait: { icon: '…', label: 'waiting' },
};

/** module-level: a remount or re-render never opens Steam twice for the same launch */
let launchedFor = 0;
let drummedFor = '';
let barkedAt = 0;
/** the recorded "launch" bark: LAUNCH press or RIDE!, never twice for the same player within a few seconds */
export function barkLaunch() {
  const now = Date.now();
  if (now - barkedAt < 5000) return;
  barkedAt = now;
  playVoice('launch', 'emote');
}

/**
 * children: the host's other result buttons (Rematch / Another round), laid out in one row with Saddle up!
 * slim: the result page's one-line strip (my status toggle, the posse's mini busts with their status, the host's Saddle up!).
 * Either way it owns the synced 3-2-1 overlay and the steam://run for everyone who's ready (guests included).
 */
export default function SaddleUp({ state, me, send, skew, children, slim }: RoomProps & { children?: ReactNode; slim?: boolean }) {
  const res = state.result;
  const launch = state.launch;
  const ready = launch?.ready ?? {};
  const launchAt = launch?.launchAt ?? 0;
  const counting = launchAt > 0;
  const now = useNow(skew, counting && Date.now() + skew < launchAt + 3000);
  const meP = state.players.find((p) => p.id === me);
  const amHost = !!meP?.host;
  const appid = res?.appid ?? 0;
  const pool = state.pool.find((g) => g.appid === appid);
  const pitched = state.board.find((g) => g.appid === appid)?.tier === 'pitch';
  const owned = !pitched && !!pool?.owners.includes(me);
  const myStatus = ready[me] as Status | undefined;
  const store = `https://store.steampowered.com/app/${appid}`;

  // synced countdown: a drum hit on each number, then ride out
  const left = launchAt - now;
  const n = Math.ceil(left / 1000);
  const show = counting && left > -2500 && left < 4600;
  const stale = counting && Date.now() + skew - launchAt > 2500;
  useEffect(() => {
    if (!show || stale) return;
    const k = `${launchAt}:${n}`;
    if (drummedFor === k) return;
    drummedFor = k;
    if (n >= 1 && n <= 3) { sfx.stamp(); buzz(BUZZ.myTurn); }
    else if (n === 0) { sfx.shot(); sfx.yeehaw(); buzz(BUZZ.win); barkLaunch(); }
  }, [n, show, stale, launchAt]);
  useEffect(() => {
    if (!counting || left > 0 || stale || launchedFor === launchAt) return;
    launchedFor = launchAt;
    if (ready[me] === 'ready' && appid) {
      try { window.location.href = `steam://run/${appid}`; } catch { /* no Steam handler */ }
    }
  }, [counting, left <= 0, stale, launchAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!res) return null;
  const humans = state.players.filter((p) => !p.bot);
  const readyN = humans.filter((p) => ready[p.id] === 'ready').length;
  const set = (status: Status) => { sfx.click(); send({ t: 'ready', status }); };

  const others = humans.filter((p) => p.id !== me);
  const goDisabled = counting && !stale && left > -2000;
  const goTitle = '3-2-1, then Steam opens for everyone ready';

  const countdown = show && !stale && createPortal(
    <div className="sad-cd" role="alert" aria-live="assertive">
      <div className="sad-cd-game">{res.name}</div>
      {n > 3 ? <div className="sad-cd-big small">Saddle up…</div>
        : n >= 1 ? <div className="sad-cd-big" key={n}>{n}</div>
        : <div className="sad-cd-big go" key="go">RIDE!</div>}
      {n <= 0 && (ready[me] === 'ready'
        ? <div className="sad-cd-sub">Opening Steam…</div>
        : <a className="px-btn sad-cd-store" href={store} target="_blank" rel="noreferrer">Get it on Steam</a>)}
      {n > 0 && ready[me] !== 'ready' && <div className="sad-cd-sub">Not ready: Steam won't open for you.</div>}
    </div>,
    document.body,
  );

  if (slim) {
    const mine = launch && meP && !meP.bot;
    const opts: Status[] = ['ready', 'download', 'buy'];
    return (
      <div className="sadl" role="group" aria-label={`Saddle up: ${readyN} of ${humans.length} ready`}>
        <span className="sadl-k"><span className="sadl-t">Saddle up</span><b>{readyN}/{humans.length}</b></span>
        {mine && (
          <span className="sadl-seg" role="group" aria-label="Your status">
            {opts.map((o) => (
              <button key={o} type="button" className={`sadl-b ${o} ${myStatus === o ? 'on' : ''} ${o === 'buy' && !owned && !myStatus ? 'hint' : ''}`}
                aria-pressed={myStatus === o} aria-label={CHIP[o].label} title={CHIP[o].label} onClick={() => set(o)}>
                <PixelIcon name={o} />{o === 'ready' && <span className="sadl-lbl">Ready</span>}
              </button>
            ))}
          </span>
        )}
        <span className="sadl-posse">
          {humans.map((p) => {
            const st = (ready[p.id] as Status | undefined) ?? 'wait';
            return (
              <span key={p.id} className={`sadl-pc ${st} ${p.id === me ? 'me' : ''} ${p.connected ? '' : 'off'}`} title={`${p.id === me ? 'You' : p.name}: ${CHIP[st].label}`}
                role="img" aria-label={`${p.id === me ? 'You' : p.name}: ${CHIP[st].label}`}>
                <MiniBust p={p} className="sadl-bust" /><i aria-hidden><PixelIcon name={st} /></i>
              </span>
            );
          })}
        </span>
        {!owned && <a className="sadl-buy" href={store} target="_blank" rel="noreferrer" title={pitched ? 'Nobody owns it yet: buy or gift it on Steam' : 'Buy or gift it on Steam'}>Buy ↗</a>}
        {amHost && launch && (
          <button type="button" className="px-btn sadl-go" title={goTitle} disabled={goDisabled} onClick={() => { sfx.spurs(); send({ t: 'saddleUp' }); }}>
            Saddle up!
          </button>
        )}
        {countdown}
      </div>
    );
  }

  return (
    <div className="sad px-box">
      <div className="sad-head">
        <span className="gp-sec">Saddle up</span>
        <span className="sad-count">{readyN}/{humans.length} ready</span>
        {others.length > 0 && (
          <span className="sad-posse">
            {others.map((p) => {
              const st = (ready[p.id] as Status | undefined) ?? 'wait';
              return (
                <span key={p.id} className={`sad-pc ${st} ${p.connected ? '' : 'off'}`} title={`${p.name}: ${CHIP[st].label}`} role="img" aria-label={`${p.name}: ${CHIP[st].label}`}>
                  <MiniBust p={p} className="sad-pc-bust" /><i aria-hidden><PixelIcon name={st} /></i>
                </span>
              );
            })}
          </span>
        )}
      </div>
      <div className="sad-rows">
        {humans.map((p) => {
          const st = (ready[p.id] as Status | undefined) ?? 'wait';
          return (
            <div key={p.id} className={`sad-row ${p.id === me ? 'me' : ''} ${p.connected ? '' : 'off'}`}>
              <MiniBust p={p} className="sad-bust" />
              <span className="sad-name">{p.id === me ? 'You' : p.name}</span>
              <span className={`sad-chip ${st}`}><i aria-hidden><PixelIcon name={st} /></i>{CHIP[st].label}</span>
            </div>
          );
        })}
      </div>
      {launch && meP && !meP.bot && (
        <div className="sad-mine sad-seg" role="group" aria-label="Your status">
          <button className={`px-btn px-btn-sm sad-b ${myStatus === 'ready' ? 'on' : ''}`} aria-pressed={myStatus === 'ready'} aria-label="Ready" onClick={() => set('ready')}><i className="sad-ico" aria-hidden><PixelIcon name="ready" /></i> Ready</button>
          <button className={`px-btn px-btn-sm sad-b ${myStatus === 'download' ? 'on' : ''}`} aria-pressed={myStatus === 'download'} aria-label="Downloading" title="Downloading" onClick={() => set('download')}><i className="sad-ico" aria-hidden><PixelIcon name="download" /></i><span className="sad-lbl"> Downloading</span></button>
          <button className={`px-btn px-btn-sm sad-b ${myStatus === 'buy' ? 'on' : ''} ${!owned && !myStatus ? 'hint' : ''}`} aria-pressed={myStatus === 'buy'} aria-label="Need to buy" title="Need to buy" onClick={() => set('buy')}><i className="sad-ico" aria-hidden><PixelIcon name="buy" /></i><span className="sad-lbl"> Need to buy</span></button>
        </div>
      )}
      {!owned && (
        <div className="sad-buy">
          <span>{pitched ? 'Nobody owns it yet.' : !meP?.steam || meP.steam.private ? 'Own it?' : 'Not in your library.'}</span>
          <a href={store} target="_blank" rel="noreferrer">Buy on Steam</a>
          <a href={`${store}#game_area_purchase`} target="_blank" rel="noreferrer" title="Use 'Purchase as a gift' on the store page">Gift a copy</a>
        </div>
      )}
      {amHost ? (
        <div className="sad-host">
          {launch && (
            <button className="px-btn sad-go" title={goTitle} disabled={goDisabled} onClick={() => { sfx.spurs(); send({ t: 'saddleUp' }); }}>
              Saddle up! <small>Launches for everyone ready</small>
            </button>
          )}
          {children}
        </div>
      ) : (
        <div className="wait-host sad-wait">
          Waiting on the host.
        </div>
      )}

      {countdown}
    </div>
  );
}
