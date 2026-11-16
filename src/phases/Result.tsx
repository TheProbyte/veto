import { useEffect, useMemo } from 'react';
import type { RoomProps } from '../props';
import { heroArt } from '../../shared/types';
import { sfx } from '../sfx';
import { PixelArt, PixelPanel } from '../pixel/PixelCanvas';
import { BUZZ, buzz } from '../scene/haptics';

export default function Result({ state, me, send }: RoomProps) {
  const res = state.result;
  useEffect(() => { sfx.win(); buzz(BUZZ.win); }, []);
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

  return (
    <div className="result">
      <div className="result-backdrop" style={{ backgroundImage: `url(${heroArt(res.appid)})` }} />
      <div className="poster-wrap">
        <div className="poster">
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

      {stats.length > 0 && (
        <div className="stat-chips">
          {stats.map((s) => <div className="chip px-box" key={s.label}><span>{s.label}</span><b>{s.value}</b></div>)}
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

      {amHost ? (
        <button className="btn-again px-btn" onClick={() => send({ t: 'again' })}>Another round</button>
      ) : (
        <div className="wait-host">The host can call another round.</div>
      )}
    </div>
  );
}
