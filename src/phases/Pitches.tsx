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
        setErr("Couldn't reach the store.");
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
    tossOrTake(p.appid, mineNow, e.currentTarget.closest('.nm-pcard')?.querySelector('.nm-art') ?? null, send);
  };

  const voters = (p: Pitch, v: 'buy' | 'nope') =>
    Object.entries(p.votes || {}).filter(([, x]) => x === v).map(([id]) => byId.get(id)).filter(Boolean) as Player[];

  return (
    <section className="nm-buy" aria-label="Buy something new">
      <h3 className="nm-sec-h">Buy something new {state.pitches.length > 0 && <em>{state.pitches.length}</em>}</h3>
      <p className="nm-hint">Pitch a store game. It takes two shots to kill.</p>

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
                  {done ? 'Pitched' : have ? 'Owned' : 'Pitch it'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!busy && !err && q.trim().length >= 2 && hits.length === 0 && <div className="nm-empty sm">Nothing by that name.</div>}

      {state.pitches.length > 0 && (
        <div className="nm-felt nm-felt-buy">
        <div className="nm-grid">
          {state.pitches.map((p) => {
            const by = nomBy.get(p.appid) || [];
            const mine = by.includes(me);
            const full = !mine && myCount >= MAX_NOMS;
            const myVote = p.votes?.[me];
            const buy = voters(p, 'buy');
            const nope = voters(p, 'nope');
            const pitcher = byId.get(p.by);
            const others = by.filter((id) => id !== me).map((id) => byId.get(id)).filter(Boolean) as Player[];
            const names = (l: Player[]) => (l.length ? l.map((v) => (v.id === me ? 'You' : v.name)).join(', ') : 'nobody yet');
            return (
              <div key={p.appid} className={`nm-card nm-pcard ${mine ? 'is-mine' : ''} ${by.length ? 'is-nom' : ''} ${myVote ? `voted-${myVote}` : ''}`}>
                <span className="nm-face">
                  <span className="nm-art">
                    <Cover appid={p.appid} name={p.name} kind="header" />
                    {p.discount ? <span className="nm-disc">-{p.discount}%</span> : null}
                    <span className="nm-ptag">{p.price || '$ ?'}</span>
                    {others.length > 0 && <span className="nm-by">{others.slice(0, 3).map((o) => <Avatar key={o.id} p={o} size={16} />)}</span>}
                  </span>
                  <span className="nm-name" title={p.name}>{p.name}</span>
                  <span className="nm-meta"><span className="nm-hrs">Pitched by <b>{p.by === me ? 'you' : pitcher?.name ?? 'someone'}</b></span>
                    {p.by === me && (
                      <button type="button" className="nm-withdraw" onClick={() => { sfx.unlock(); sfx.whoosh(); send({ t: 'unpitch', appid: p.appid }); }}>withdraw</button>
                    )}
                  </span>
                  <span className="nh-votes">
                    <button type="button" className={`nh-vote buy ${myVote === 'buy' ? 'on' : ''}`} aria-pressed={myVote === 'buy'} title={`Would buy: ${names(buy)}`} onClick={() => vote(p, 'buy')}>
                      I'd buy <b>{buy.length}</b>
                      {burst?.appid === p.appid && burst.v === 'buy' && <span key={burst.n} className="nh-coins" aria-hidden><i /><i /><i /></span>}
                    </button>
                    <button type="button" className={`nh-vote nope ${myVote === 'nope' ? 'on' : ''}`} aria-pressed={myVote === 'nope'} title={`Nope: ${names(nope)}`} onClick={() => vote(p, 'nope')}>
                      Nope <b>{nope.length}</b>
                      {burst?.appid === p.appid && burst.v === 'nope' && <span key={burst.n} className="nh-spit" aria-hidden><i /><i /><i /></span>}
                    </button>
                  </span>
                  <button type="button" className={`nh-btn nh-btn-xs nm-toss ${mine ? 'is-done' : ''}`} disabled={full} onClick={(e) => nominate(p, e)} aria-pressed={mine}>
                    {mine ? 'On the table ✓' : 'Toss it in'}
                  </button>
                  {mine && <span className="nm-stamp" aria-hidden>✓ Yours</span>}
                </span>
              </div>
            );
          })}
        </div>
        </div>
      )}
    </section>
  );
}
