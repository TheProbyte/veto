import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { headerArt, type Pitch, type Player, type StoreHit } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { Avatar } from './Lobby';
import Cover from '../scene/Cover';
import { play } from '../scene/Dock';
import { PagedDeck, tossOrTake, usePages, type CellSize } from './Nominate';
import { settingsOf } from './Lobby';
import './nominate.css';

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

  // search results replace the pitched cards while there's a query; both page instead of scrolling
  const searching = q.trim().length >= 2;
  const hitSize: CellSize = useCallback((u, t) => ({ w: Math.max(200, 92 * t), h: 10 * t + 4 * u, ideal: 10 * t + 4 * u }), []);
  const cardSize: CellSize = useCallback((u, t, w) => {
    const text = 8 * t * 2 + 11 * t + 8 * u;
    const minW = Math.max(120, 56 * t, 34 * u);
    const art = (w || minW) * 30 / 64;
    return { w: minW, h: Math.round(text + art * 0.3), ideal: Math.round(text + art) };
  }, []);
  const hitList = hits.slice(0, 24);
  const hitPager = usePages(hitList.length, hitSize, q.trim());
  const cardPager = usePages(state.pitches.length, cardSize, 'pitches');

  const hitRow = (h: StoreHit) => {
    const done = pitched.has(h.appid);
    const have = owned.has(h.appid);
    return (
      <div key={h.appid} className="nm-hit">
        <PixImg className="nm-hit-img" src={h.img || headerArt(h.appid)} />
        <span className="nm-hit-name" title={h.name}>{h.name}</span>
        {h.price && <span className="nm-hit-price">{h.price}</span>}
        <button type="button" className="nm-btn nm-btn-sm" disabled={done || have} onClick={() => pitch(h)}>
          {done ? 'Pitched' : have ? 'Owned' : 'Pitch'}
        </button>
      </div>
    );
  };

  const pitchCard = (p: Pitch) => {
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
          <span className="nm-meta"><span className="nm-hrs">by <b>{p.by === me ? 'you' : pitcher?.name ?? 'someone'}</b></span>
            {p.by === me && (
              <button type="button" className="nm-withdraw" onClick={() => { sfx.unlock(); sfx.whoosh(); send({ t: 'unpitch', appid: p.appid }); }}>withdraw</button>
            )}
          </span>
          <span className="nm-votes">
            <button type="button" className={`nm-vote buy ${myVote === 'buy' ? 'on' : ''}`} aria-pressed={myVote === 'buy'} title={`Would buy: ${names(buy)}`} aria-label={`I'd buy: ${buy.length}`} onClick={() => vote(p, 'buy')}>
              Buy <b>{buy.length}</b>
              {burst?.appid === p.appid && burst.v === 'buy' && <span key={burst.n} className="nm-coins" aria-hidden><i /><i /><i /></span>}
            </button>
            <button type="button" className={`nm-vote nope ${myVote === 'nope' ? 'on' : ''}`} aria-pressed={myVote === 'nope'} title={`Nope: ${names(nope)}`} aria-label={`Nope: ${nope.length}`} onClick={() => vote(p, 'nope')}>
              Nope <b>{nope.length}</b>
              {burst?.appid === p.appid && burst.v === 'nope' && <span key={burst.n} className="nm-spit" aria-hidden><i /><i /><i /></span>}
            </button>
            <button type="button" className={`nm-vote nm-toss ${mine ? 'is-done' : ''}`} disabled={full} onClick={(e) => nominate(p, e)} aria-pressed={mine}
              title={mine ? 'On the table: tap to take it back' : 'Toss it on the table'}>
              {mine ? '✓ In' : 'Toss'}
            </button>
          </span>
          {mine && <span className="nm-stamp" aria-hidden>✓ Yours</span>}
        </span>
      </div>
    );
  };

  return (
    <section className="nm-buy" aria-label="Buy something new">
      <div className="nm-bar nm-psearch">
        <input className="nm-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the Steam store…"
          spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="none" inputMode="search" enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); } }}
          aria-label="Search the Steam store" />
        {busy && <i className="nh-spin" />}
        {searching
          ? <button type="button" className="nm-chip" onClick={() => { sfx.click(); setQ(''); }}>Done</button>
          : <span className="nm-hint">Pitch a store game. Two shots kill it.</span>}
      </div>
      {searching ? (
        <PagedDeck pager={hitPager} label="Store search results" className="is-hits"
          empty={err ? <div className="nm-empty"><span className="nm-err">{err}</span></div> : !busy && hits.length === 0 ? <div className="nm-empty">Nothing by that name.</div> : null}>
          {hitList.slice(hitPager.start, hitPager.start + hitPager.per).map(hitRow)}
        </PagedDeck>
      ) : (
        <PagedDeck pager={cardPager} label="Pitched games" className="is-pitches"
          empty={state.pitches.length === 0 ? <div className="nm-empty">Nothing pitched yet. Search the store above.</div> : null}>
          {state.pitches.slice(cardPager.start, cardPager.start + cardPager.per).map(pitchCard)}
        </PagedDeck>
      )}
    </section>
  );
}
