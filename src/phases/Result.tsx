import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RoomProps } from '../props';
import { BADGES, heroArt, type BadgeId } from '../../shared/types';
import { sfx } from '../sfx';
import { PixelArt, PixelPanel, PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import type { DrawFn } from '../pixel/sprites';
import '../pixel/pixel.css';

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
import SaddleUp, { barkLaunch } from './SaddleUp';
import { settingsOf } from './Lobby';
import './gameplay.css';
import './panels.css';

type Tab = 'badges' | 'stats' | 'record' | 'history';

export default function Result({ state, me, send, skew, on }: RoomProps) {
  const res = state.result;
  useShotExtras(state, skew);
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
  const [tab, setTab] = useState<Tab | null>(null);
  // phones: a tapped section opens below the fold, so bring it into view
  useEffect(() => {
    if (!tab) return;
    const el = document.getElementById(`rx-${tab}`);
    if (!el || !matchMedia('(max-width: 640px)').matches) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }));
  }, [tab]);
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '???';

  const stats = useMemo(() => {
    const out: { label: string; value: string }[] = [];
    const shots = [...state.shots].sort((a, b) => a.t - b.t);
    const by = new Map<string, number>();
    for (const s of shots) if (s.kind !== 'misfire') by.set(s.actor, (by.get(s.actor) ?? 0) + 1);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 1) out.push({ label: 'Biggest vetoer', value: `${nameOf(top[0])} · ${top[1]} shots` });
    let best: { actor: string; dt: number } | null = null;
    for (let i = 1; i < shots.length; i++) {
      const s = shots[i];
      if (s.kind === 'misfire') continue;
      const dt = s.t - shots[i - 1].t;
      if (dt > 0 && (!best || dt < best.dt)) best = { actor: s.actor, dt };
    }
    if (best) out.push({ label: 'Quickest trigger', value: `${nameOf(best.actor)} · ${(best.dt / 1000).toFixed(1)}s` });
    const rico = shots.filter((s) => s.kind === 'ricochet').length;
    if (rico) out.push({ label: 'Ricochets', value: `${rico} PING${rico > 1 ? 's' : ''}` });
    const mis = shots.filter((s) => s.kind === 'misfire').length;
    if (mis) out.push({ label: 'Misfires', value: `${mis}` });
    return out.slice(0, 3);
  }, [state.shots, state.players]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!res) return <div className="result"><div className="roulette-title">Counting the bounty…</div></div>;
  const hist = [...state.history].sort((a, b) => b.t - a.t).slice(0, 5);
  // the duel decided it?
  const duel = state.duel;
  const duelMs = duel?.winner === res.appid ? duel.taps[duel.champs[duel.games.indexOf(res.appid)]] : undefined;
  // badges earned this round, in player order
  const badgeRows = state.players
    .map((p) => ({ p, list: ((res.badges ?? {})[p.id] ?? []).filter((b): b is BadgeId => b in BADGES) }))
    .filter((r) => r.list.length);
  const never = res.neverSurvive;
  const rec = state.record;
  const longest = rec?.streaks?.length ? [...rec.streaks].sort((a, b) => b.best - a.best)[0] : undefined;
  const hasRecord = !!rec && rec.rounds > 0;
  let badgeN = 0;

  // how it was won: the finale that decided it, who tossed it in, what it survived
  const fin = settingsOf(state).finale;
  const slide = state.slide?.winner === res.appid ? state.slide : undefined;
  const how = duel?.winner === res.appid ? (duelMs !== undefined && duelMs >= 0 ? `Quick-draw · ${duelMs} ms` : 'Quick-draw')
    : slide ? 'Whiskey slide'
    : fin === 'cylinder' && state.roulette ? 'Revolver roulette'
    : fin === 'last' ? 'Last one standing'
    : ({ slide: 'Whiskey slide', cylinder: 'Revolver roulette', duel: 'Quick-draw' } as const)[fin];
  const slider = slide ? slide.champs[slide.games.indexOf(res.appid)] : undefined;
  const winBy = state.board.find((b) => b.appid === res.appid)?.by ?? [];
  const dodged = state.shots.filter((s) => s.appid === res.appid && (s.kind === 'ricochet' || s.kind === 'crack')).length;
  const fired = state.shots.filter((s) => s.kind !== 'misfire').length;
  const wonBits = [
    winBy.length ? `Tossed in by ${winBy.map((id) => (id === me ? 'you' : nameOf(id))).join(', ')}` : 'Dealt by the house',
    slider ? `slid by ${slider === me ? 'you' : nameOf(slider)}` : '',
    dodged ? `dodged ${dodged} shot${dodged === 1 ? '' : 's'}` : '',
    fired ? `${fired} shot${fired === 1 ? '' : 's'} fired` : '',
  ].filter(Boolean);

  // phones: everything past the first screen sits behind a small tab strip (CSS shows every panel on desktop)
  const tabs: { k: Tab; label: string; n?: number }[] = [];
  if (badgeRows.length) tabs.push({ k: 'badges', label: 'Badges', n: badgeRows.reduce((a, r) => a + r.list.length, 0) });
  tabs.push({ k: 'stats', label: 'Stats' });
  if (hasRecord) tabs.push({ k: 'record', label: 'Record' });
  if (hist.length) tabs.push({ k: 'history', label: 'History' });
  const panel = (k: Tab) => ({ id: `rx-${k}`, className: `rx-panel ${tab === k ? 'open' : ''}` });

  return (
    <div className={`result gp-result ${tab ? 'rx-has-open' : ''}`}>
      <div className="result-backdrop" style={{ backgroundImage: `url(${heroArt(res.appid)})` }} />
      <div className="poster-wrap">
        <div className="poster px-poster-in" ref={posterRef}>
          {NAILS.map(([l, t], i) => <PixelSprite key={i} draw={drawNail} w={7} h={7} className={`px-nail ${nails > i ? 'on' : ''}`} style={{ left: l, top: t }} />)}
          <PixelPanel kind="paper" size={4} />
          <div className="poster-body">
            <div className="poster-wanted">WANTED</div>
            <div className="poster-sub">— TONIGHT —</div>
            <div className="poster-art"><PixelArt appid={res.appid} name={res.name} w={48} h={72} /></div>
            <div className="poster-name">{res.name}</div>
            <div className="poster-reward">REWARD: one good night with the posse</div>
          </div>
          {res.repeatCount >= 2 && (
            <div className="poster-repeat">You played this the last {res.repeatCount} times</div>
          )}
        </div>
      </div>

      <div className="result-actions">
        <a className="btn-launch px-btn" href={`steam://run/${res.appid}`} onClick={() => { sfx.unlock(); barkLaunch(); }}>LAUNCH</a>
        <a className="store-link" href={`https://store.steampowered.com/app/${res.appid}`} target="_blank" rel="noreferrer">
          Store page
        </a>
      </div>

      <SaddleUp state={state} me={me} send={send} skew={skew} on={on}>
        {amHost && <>
          <button className="btn-rematch px-btn" onClick={() => send({ t: 'rematch' })} title="Same games, same posse, straight back to the shootout">Rematch<span className="rx-long">: same games</span></button>
          <button className="btn-again px-btn" onClick={() => send({ t: 'again' })}>Another round</button>
        </>}
      </SaddleUp>

      {tabs.length > 0 && (
        <div className="rx-tabs" role="group" aria-label="More from this round">
          {tabs.map(({ k, label, n }) => (
            <button key={k} type="button" className={`rx-tab ${tab === k ? 'on' : ''}`} aria-expanded={tab === k} aria-controls={`rx-${k}`}
              onClick={() => { sfx.click(); setTab((t) => (t === k ? null : k)); }}>
              {label}{n ? <em>{n}</em> : null}<i aria-hidden>{tab === k ? '▴' : '▾'}</i>
            </button>
          ))}
        </div>
      )}

      <div className="rx-side">
      <div {...panel('stats')}>
        <div className="rx-won px-box">
          <div className="gp-sec">How it was won</div>
          <b className="rx-won-how">{how}</b>
          <span className="rx-won-sub">{wonBits.join(' · ')}</span>
        </div>
        {(stats.length > 0 || never) && (
          <div className="stat-chips">
            {stats.map((s) => <div className="chip px-box" key={s.label}><span>{s.label}</span><b>{s.value}</b></div>)}
            {never && (
              <div className="chip px-box gp-never"><span>Never survives</span><b>{never.name}: {never.noms}× tossed, 0 wins</b></div>
            )}
          </div>
        )}
      </div>

      {badgeRows.length > 0 && (
        <div {...panel('badges')}>
          <div className="gp-badges px-box">
            <div className="gp-sec">Badges</div>
            {badgeRows.map(({ p, list }) => (
              <div className="gp-badge-row" key={p.id}>
                <b>{p.id === me ? 'You' : p.name}</b>
                {list.map((b) => {
                  const k = badgeN++;
                  return (
                    <span key={b} className="gp-badge" title={BADGES[b].desc} style={{ '--dl': `${1700 + k * 220}ms`, '--rot': `${(k * 37) % 7 - 3}deg` } as CSSProperties}>
                      <i aria-hidden>{BADGES[b].icon}</i>{BADGES[b].label}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasRecord && rec && (
        <div {...panel('record')}>
          <div className="gp-record px-box">
            <div className="gp-sec">Posse record</div>
            <div className="gp-record-top"><b>{rec.rounds}</b> round{rec.rounds === 1 ? '' : 's'} here</div>
            <div className="gp-record-grid">
              {rec.wins?.length > 0 && (
                <div>
                  <h4>TOP GAMES</h4>
                  <ol>{rec.wins.slice(0, 3).map((w) => <li key={w.appid}><span>{w.name}</span><em>{w.count} win{w.count === 1 ? '' : 's'}</em></li>)}</ol>
                </div>
              )}
              {rec.vetoers?.length > 0 && (
                <div>
                  <h4>BIGGEST VETOERS</h4>
                  <ol>{rec.vetoers.slice(0, 3).map((v) => <li key={v.pid}><span>{v.name}</span><em>{v.kills} kill{v.kills === 1 ? '' : 's'}</em></li>)}</ol>
                </div>
              )}
              {longest && longest.best > 1 && (
                <div className="gp-streak">Longest dry spell: <b>{longest.name}</b>, {longest.best} rounds{longest.cur === longest.best ? ' and counting' : ''}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {hist.length > 0 && (
        <div {...panel('history')}>
          <div className="history px-box">
            <div className="history-label">Lately at this table</div>
            <ol>
              {hist.map((h) => (
                <li key={h.t}><span>{h.name}</span><time>{new Date(h.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></li>
              ))}
            </ol>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
