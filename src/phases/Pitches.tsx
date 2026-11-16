import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { headerArt, type Pitch, type Player, type StoreHit } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { Avatar } from './Lobby';
import Cover from '../scene/Cover';
import { play } from '../scene/Dock';
import { tossOrTake } from './Nominate';
import { settingsOf } from './Lobby';
import './panels.css';

function PixImg({ src, className }: { src: string; className: string }) {
  const [bad, setBad] = useState(false);
  if (bad || !src) return <span className={`${className} nh-art-miss`} />;
  return <img className={className} src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />;
}

export default function Pitches({ state, me, send }: Pick<RoomProps, 'state' | 'me' | 'send'>) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<StoreHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const pitched = useMemo(() => new Set(state.pitches.map((p) => p.appid)), [state.pitches]);
  const owned = useMemo(() => new Set(state.pool.map((g) => g.appid)), [state.pool]);
  const nomBy = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const b of state.board) m.set(b.appid, b.by);
    return m;
  }, [state.board]);
  const myCount = state.board.filter((b) => b.by.includes(me)).length;
  const MAX_NOMS = settingsOf(state).picks;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setBusy(false); setErr(''); return; }
    const ac = new AbortController();
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(term), { signal: ac.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data: unknown = await res.json();
        if (ac.signal.aborted) return;
        setHits(Array.isArray(data) ? (data as StoreHit[]).filter((h) => h && typeof h.appid === 'number') : []);
        setErr('');
      } catch (e) {
        if (ac.signal.aborted) return;
        setHits([]);
        setErr("Couldn't reach the general store.");
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 350);
    return () => { ac.abort(); clearTimeout(timer); };
  }, [q]);

  const pitch = (h: StoreHit) => {
    if (pitched.has(h.appid)) return;
    sfx.unlock(); sfx.stamp();
    send({ t: 'pitch', appid: h.appid, name: h.name, price: h.price });
  };

  // coin / spit micro-animation on the button I just tapped
  const [burst, setBurst] = useState<{ appid: number; v: 'buy' | 'nope'; n: number } | null>(null);
  const burstN = useRef(0);
  const vote = (p: Pitch, v: 'buy' | 'nope') => {
    sfx.unlock();
    const turningOn = p.votes?.[me] !== v;
    if (turningOn) {
      setBurst({ appid: p.appid, v, n: ++burstN.current });
      if (!play(v === 'buy' ? 'coin' : 'spit')) sfx.click();
    } else sfx.click();
    send({ t: 'react', appid: p.appid, vote: v });
  };

  const nominate = (p: Pitch, e: MouseEvent<HTMLElement>) => {
    const mineNow = (nomBy.get(p.appid) || []).includes(me);
    if (!mineNow && myCount >= MAX_NOMS) { sfx.click(); return; }
    tossOrTake(p.appid, mineNow, e.currentTarget.closest('.nh-pcard')?.querySelector('.nh-game-art') ?? null, send);
  };

  const voters = (p: Pitch, v: 'buy' | 'nope') =>
    Object.entries(p.votes || {}).filter(([, x]) => x === v).map(([id]) => byId.get(id)).filter(Boolean) as Player[];

  return (
    <section className="nh-pitches">
      <h3 className="nh-tier pitch"><span>Pitched buys:</span> worth the money? <em>{state.pitches.length}</em></h3>
      <div className="nh-sub nh-pitch-note">Nobody owns it yet? Pitch a store game. Pitched buys need two shots to kill.</div>

      <div className="nh-psearch">
        <input className="nh-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the Steam store…"
          spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="none" inputMode="search" enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          aria-label="Search the Steam store" />
        {busy && <i className="nh-spin" />}
      </div>
      {err && <div className="nh-err">{err}</div>}
      {hits.length > 0 && (
        <ul className="nh-hits">
          {hits.slice(0, 8).map((h) => {
            const done = pitched.has(h.appid);
            const have = owned.has(h.appid);
            return (
              <li key={h.appid} className="nh-hit">
                <PixImg className="nh-hit-img" src={h.img || headerArt(h.appid)} />
                <span className="nh-hit-name" title={h.name}>{h.name}</span>
                {h.price && <span className="nh-hit-price">{h.price}</span>}
                <button type="button" className="nh-btn nh-btn-xs" disabled={done || have} onClick={() => pitch(h)}>
                  {done ? 'Pitched' : have ? 'In pool' : 'Pitch it'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!busy && !err && q.trim().length >= 2 && hits.length === 0 && <div className="nh-empty sm">Store's got nothing by that name.</div>}

      {state.pitches.length > 0 && (
        <div className="nh-pgrid">
          {state.pitches.map((p) => {
            const by = nomBy.get(p.appid) || [];
            const mine = by.includes(me);
            const full = !mine && myCount >= MAX_NOMS;
            const myVote = p.votes?.[me];
            const buy = voters(p, 'buy');
            const nope = voters(p, 'nope');
            const pitcher = byId.get(p.by);
            const others = by.filter((id) => id !== me).map((id) => byId.get(id)).filter(Boolean) as Player[];
            return (
              <div key={p.appid} className={`nh-pcard ${mine ? 'is-mine' : ''} ${by.length ? 'is-nom' : ''} ${myVote ? `voted-${myVote}` : ''}`}>
                <div className="nh-game-art">
                  <Cover appid={p.appid} name={p.name} kind="header" />
                  {mine && <span className="nh-ribbon">YOURS</span>}
                  {p.discount ? <span className="nh-disc">-{p.discount}%</span> : null}
                  <span className="nh-ptag">PITCH</span>
                </div>
                <div className="nh-game-body">
                  <div className="nh-game-name" title={p.name}>{p.name}</div>
                  <div className="nh-game-meta">
                    <span className="nh-price">{p.price || 'Price ?'}</span>
                    <span className="nh-pby"><Avatar p={pitcher} size={14} /> {pitcher?.name ?? 'someone'}</span>
                  </div>
                  <div className="nh-votes">
                    <button type="button" className={`nh-vote buy ${myVote === 'buy' ? 'on' : ''}`} aria-pressed={myVote === 'buy'} onClick={() => vote(p, 'buy')}>
                      I'd buy it <b>{buy.length}</b>
                      {burst?.appid === p.appid && burst.v === 'buy' && <span key={burst.n} className="nh-coins" aria-hidden><i /><i /><i /></span>}
                    </button>
                    <button type="button" className={`nh-vote nope ${myVote === 'nope' ? 'on' : ''}`} aria-pressed={myVote === 'nope'} onClick={() => vote(p, 'nope')}>
                      Nope <b>{nope.length}</b>
                      {burst?.appid === p.appid && burst.v === 'nope' && <span key={burst.n} className="nh-spit" aria-hidden><i /><i /><i /></span>}
                    </button>
                  </div>
                  {(buy.length > 0 || nope.length > 0) && (
                    <div className="nh-voters">
                      {buy.map((v) => <span key={v.id} className="nh-voter buy" title={`${v.name}: buy`}><Avatar p={v} size={16} /></span>)}
                      {nope.map((v) => <span key={v.id} className="nh-voter nope" title={`${v.name}: nope`}><Avatar p={v} size={16} /></span>)}
                    </div>
                  )}
                  {others.length > 0 && (
                    <div className="nh-noms">{others.map((o) => <Avatar key={o.id} p={o} size={16} />)}<small>tossed in</small></div>
                  )}
                  <div className="nh-pacts">
                    <button type="button" className={`nh-btn nh-btn-xs ${mine ? 'is-done' : ''}`} disabled={full} onClick={(e) => nominate(p, e)} aria-pressed={mine}>
                      {mine ? 'On the table ✓' : 'Toss it in'}
                    </button>
                    {p.by === me && (
                      <button type="button" className="nh-linkbtn" onClick={() => { sfx.unlock(); sfx.whoosh(); send({ t: 'unpitch', appid: p.appid }); }}>withdraw</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
