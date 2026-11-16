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
import './gameplay.css';

export default function Result({ state, me, send, skew }: RoomProps) {
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

  return (
    <div className="result">
      <div className="result-backdrop" style={{ backgroundImage: `url(${heroArt(res.appid)})` }} />
      <div className="poster-wrap">
        <div className="poster px-poster-in" ref={posterRef}>
          {NAILS.map(([l, t], i) => <PixelSprite key={i} draw={drawNail} w={7} h={7} className={`px-nail ${nails > i ? 'on' : ''}`} style={{ left: l, top: t }} />)}
          <PixelPanel kind="paper" size={4} />
          <div className="poster-wanted">WANTED</div>
          <div className="poster-sub">— TONIGHT —</div>
          <div className="poster-art"><PixelArt appid={res.appid} name={res.name} w={48} h={72} /></div>
          <div className="poster-name">{res.name}</div>
          <div className="poster-reward">REWARD: one good night with the posse</div>
          {res.repeatCount >= 2 && (
            <div className="poster-repeat">You played this the last {res.repeatCount} times</div>
          )}
        </div>
      </div>

      <div className="result-actions">
        <a className="btn-launch px-btn" href={`steam://run/${res.appid}`}>LAUNCH</a>
        <a className="store-link" href={`https://store.steampowered.com/app/${res.appid}`} target="_blank" rel="noreferrer">
          Don't own it? Store page
        </a>
      </div>

      {duelMs !== undefined && duelMs >= 0 && <div className="gp-duelwin">Won by quick-draw (<b>{duelMs} ms</b>)</div>}

      {badgeRows.length > 0 && (
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
      )}

      {(stats.length > 0 || never) && (
        <div className="stat-chips">
          {stats.map((s) => <div className="chip px-box" key={s.label}><span>{s.label}</span><b>{s.value}</b></div>)}
          {never && (
            <div className="chip px-box gp-never"><span>Never survives</span><b>{never.name}: nominated {never.noms}×, never won</b></div>
          )}
        </div>
      )}

      {amHost ? (
        <div className="gp-host">
          <button className="btn-rematch px-btn" onClick={() => send({ t: 'rematch' })} title="Same games, same posse, straight back to the shootout">Rematch: same games</button>
          <button className="btn-again px-btn" onClick={() => send({ t: 'again' })}>Another round</button>
        </div>
      ) : (
        <div className="wait-host">The host can call a rematch or another round.</div>
      )}

      {hasRecord && rec && (
        <div className="gp-record px-box">
          <div className="gp-sec">Posse record</div>
          <div className="gp-record-top"><b>{rec.rounds}</b> round{rec.rounds === 1 ? '' : 's'} played at this table</div>
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
              <div className="gp-streak">Longest losing streak: <b>{longest.name}</b>, {longest.best} rounds without a win{longest.cur === longest.best ? ' (and counting)' : ''}</div>
            )}
          </div>
        </div>
      )}

      {hist.length > 0 && (
        <div className="history px-box">
          <div className="history-label">Lately at this table</div>
          <ol>
            {hist.map((h) => (
              <li key={h.t}><span>{h.name}</span><time>{new Date(h.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></li>
            ))}
          </ol>
        </div>
      )}

    </div>
  );
}
