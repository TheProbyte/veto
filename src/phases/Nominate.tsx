import { useEffect, useMemo, useRef, useState, type MouseEvent, type Ref } from 'react';
import type { BoardGame, PoolGame, Player } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { Avatar, settingsOf, TableRules } from './Lobby';
import Pitches from './Pitches';
import DraftHand from './DraftHand';
import Cover from '../scene/Cover';
import { DockActions, launchCard, play } from '../scene/Dock';
import './panels.css';

const SUITS = ['♠', '♥', '♦', '♣'];
const HOURS = [0, 10, 50, 100];
type Tier = 'all' | 'almost';

/** nominate toggle with the thematic bits: my new pick flies onto the dock, a take-back slides off */
export function tossOrTake(appid: number, mineNow: boolean, from: Element | null, send: RoomProps['send']) {
  sfx.unlock();
  if (mineNow) { if (!play('cardSlide')) sfx.whoosh(); }
  else { launchCard(appid, from); play('swish'); }
  send({ t: 'nominate', appid });
}

const isPhone = () => { try { return !!window.matchMedia?.('(max-width: 640px)').matches; } catch { return false; } };
const reduced = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function hrs(h: number) {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k`;
  return `${Math.round(h)}`;
}

/** my picks as card slots that fill up; a filled slot takes the pick back */
export function PickSlots({ mine, max, me, send, slotsRef }: { mine: BoardGame[]; max: number; me: string; send: RoomProps['send']; slotsRef?: Ref<HTMLDivElement> }) {
  return (
    <div className={`nm-slots ${mine.length >= max ? 'is-full' : ''}`} ref={slotsRef} role="group" aria-label={`Your picks: ${mine.length} of ${max}`}>
      {Array.from({ length: max }, (_, i) => {
        const g = mine[i];
        if (!g) return <span key={`e${i}`} className="nm-slot" aria-hidden><b>{SUITS[i % 4]}</b></span>;
        const others = g.by.filter((id) => id !== me).length;
        return (
          <button key={g.appid} type="button" className="nm-slot is-filled" onClick={() => tossOrTake(g.appid, true, null, send)}
            aria-label={`Take back ${g.name}`} title={`${g.name}: tap to take back`}>
            <Cover appid={g.appid} name={g.name} kind="box" />
            {others > 0 && <i className="nm-slot-n" aria-hidden>+{others}</i>}
            <i className="nm-slot-x" aria-hidden>×</i>
          </button>
        );
      })}
      <span className="nm-slots-n" aria-hidden><b>{mine.length}</b>/{max}</span>
    </div>
  );
}

export default function Nominate({ state, me, send }: RoomProps) {
  const [coopOnly, setCoopOnly] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [blood, setBlood] = useState(false);
  const [minHours, setMinHours] = useState(0);
  const [tierPick, setTierPick] = useState<Tier | null>(null);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [tossed, setTossed] = useState<number | null>(null);
  const tossT = useRef(0);
  const slotsRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(tossT.current), []);
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const isHost = !!byId.get(me)?.host;

  const nomBy = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const b of state.board) m.set(b.appid, b.by);
    return m;
  }, [state.board]);
  const mine = state.board.filter((b) => b.by.includes(me));
  const myCount = mine.length;
  const MAX_NOMS = settingsOf(state).picks;
  const [phone] = useState(isPhone);
  const CAP = phone ? 10 : 15; // cards per tier before "Show more" (keeps the DOM light on phones)

  const filtered = (coopOnly ? 1 : 0) + (fresh ? 1 : 0) + (blood ? 1 : 0) + (minHours ? 1 : 0);
  const visible = state.pool.filter((g) => !(coopOnly && g.coop === false) && !(fresh && g.recent) && !(blood && g.hours > 0) && g.hours >= minHours);
  const lists: Record<Tier, PoolGame[]> = { all: visible.filter((g) => g.tier === 'all'), almost: visible.filter((g) => g.tier === 'almost') };
  const hasTier = (t: Tier) => state.pool.some((g) => g.tier === t);
  const tier: Tier = tierPick ?? (hasTier('all') || !hasTier('almost') ? 'all' : 'almost');
  const list = lists[tier];

  // deal of the night: the biggest discount (>= 30%) on something the posse is short on, from the unfiltered pool + pitches
  const deal = useMemo(() => {
    type D = { appid: number; name: string; discount: number; price?: string; missing: string[] | null };
    let best: D | null = null;
    for (const g of state.pool) if (g.tier === 'almost' && (g.discount ?? 0) >= 30 && (!best || g.discount! > best.discount)) best = { appid: g.appid, name: g.name, discount: g.discount!, price: g.price, missing: g.missing };
    for (const p of state.pitches || []) if ((p.discount ?? 0) >= 30 && (!best || p.discount! > best.discount)) best = { appid: p.appid, name: p.name, discount: p.discount!, price: p.price, missing: null };
    return best;
  }, [state.pool, state.pitches]);
  const dealNames = deal?.missing ? deal.missing.map((id) => (id === me ? 'You' : byId.get(id)?.name)).filter(Boolean) as string[] : null;
  const dealWho = !deal ? '' : !dealNames ? 'Nobody owns it' : !dealNames.length ? 'Somebody needs it'
    : `${dealNames.join(', ')} need${dealNames.length === 1 && dealNames[0] !== 'You' ? 's' : ''} it`;

  // first CAP cards, plus anything already on the table so it can always be taken back
  const capped = (l: PoolGame[], key: string) => (more[key] ? l : l.filter((g, i) => i < CAP || nomBy.has(g.appid)));
  const hidden = list.length - capped(list, tier).length;

  const toggle = (g: PoolGame, e: MouseEvent<HTMLElement>) => {
    const mineNow = (nomBy.get(g.appid) || []).includes(me);
    if (!mineNow && myCount >= MAX_NOMS) {
      sfx.click();
      if (!reduced()) slotsRef.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 320, easing: 'steps(5, end)' });
      return;
    }
    if (!mineNow) {
      setTossed(g.appid);
      clearTimeout(tossT.current);
      tossT.current = window.setTimeout(() => setTossed(null), 450);
    }
    tossOrTake(g.appid, mineNow, e.currentTarget.querySelector('.nm-art') ?? e.currentTarget, send);
  };

  /** hover detail: who's put hours in */
  const hoursTitle = (g: PoolGame) => {
    const hb = g.hoursBy || {};
    const rows = g.owners.map((id) => ({ id, h: hb[id] ?? 0 })).sort((a, b) => b.h - a.h);
    return `${g.name}\n${rows.map(({ id, h }) => `${id === me ? 'You' : byId.get(id)?.name ?? '?'} ${hrs(h)}h`).join(' · ')}`;
  };

  const card = (g: PoolGame) => {
    const by = nomBy.get(g.appid) || [];
    const isMine = by.includes(me);
    const others = by.filter((id) => id !== me).map((id) => byId.get(id)).filter(Boolean) as Player[];
    const full = !isMine && myCount >= MAX_NOMS;
    const missing = g.tier === 'almost' ? g.missing.map((id) => byId.get(id)).filter(Boolean) as Player[] : [];
    return (
      <button key={g.appid} type="button" className={`nm-card ${isMine ? 'is-mine' : ''} ${others.length ? 'is-nom' : ''} ${full ? 'is-full' : ''} ${tossed === g.appid ? 'is-tossed' : ''}`}
        onClick={(e) => toggle(g, e)} aria-pressed={isMine} title={hoursTitle(g)}>
        <span className="nm-face">
          <span className="nm-art">
            <Cover appid={g.appid} name={g.name} kind="header" />
            {g.discount ? <span className="nm-disc">-{g.discount}%</span> : null}
            {others.length > 0 && (
              <span className="nm-by" aria-label={`Also picked by ${others.map((p) => p.name).join(', ')}`}>
                {others.slice(0, 3).map((p) => <Avatar key={p.id} p={p} size={16} />)}{others.length > 3 && <small>+{others.length - 3}</small>}
              </span>
            )}
          </span>
          <span className="nm-name">{g.name}</span>
          <span className="nm-meta">
            <span className="nm-hrs">{g.hours > 0 ? <><b>{hrs(g.hours)}h</b> together</> : 'Never played'}</span>
            {g.coop === true && <span className="nm-tag co">Co-op</span>}
            {g.recent && <span className="nm-tag rec">Recent</span>}
          </span>
          {missing.length > 0 && (
            <span className="nm-miss">
              <span className="nm-miss-k">Missing</span>
              {missing.slice(0, 3).map((p) => <span key={p.id} className={`nm-miss-p ${p.id === me ? 'is-me' : ''}`}>{p.id === me ? 'You' : p.name}</span>)}
              {missing.length > 3 && <span className="nm-miss-p">+{missing.length - 3}</span>}
              {g.price && <span className="nm-price">{g.price}</span>}
            </span>
          )}
          <span className={`nm-pip s${g.appid % 4}`} aria-hidden>{SUITS[g.appid % 4]}</span>
          {isMine && <span className="nm-stamp" aria-hidden>✓ Yours</span>}
        </span>
      </button>
    );
  };

  const empty = !state.poolLoading && state.pool.length === 0;
  const drafting = settingsOf(state).nominations === 'draft' && !!state.draft;
  const chip = (on: boolean, label: string, flip: () => void, title?: string) => (
    <button type="button" className={`nm-chip ${on ? 'on' : ''}`} aria-pressed={on} title={title} onClick={() => { sfx.click(); flip(); }}>{label}</button>
  );
  const clearFilters = () => { sfx.click(); setCoopOnly(false); setFresh(false); setBlood(false); setMinHours(0); };

  return (
    <div className="nh-panel nh-wood nh-nom nm">
      <i className="nh-nail tl" /><i className="nh-nail tr" /><i className="nh-nail bl" /><i className="nh-nail br" />
      <header className="nm-head">
        <h2 className="nh-h nm-title">{drafting ? 'Play your hand' : 'Toss your games on the table'}</h2>
        <p className="nm-how">{drafting ? `Play up to ${MAX_NOMS}. Burn a dud or trade.` : `Tap games you want to play. Up to ${MAX_NOMS}.`}</p>
        <PickSlots mine={mine} max={MAX_NOMS} me={me} send={send} slotsRef={slotsRef} />
      </header>

      {drafting ? <>
        <DraftHand state={state} me={me} send={send} />
      </> : (
        <>
          {deal && (
            <a className="nm-deal" href={`https://store.steampowered.com/app/${deal.appid}`} target="_blank" rel="noopener noreferrer"
              onClick={() => sfx.click()} aria-label={`Tonight's special: ${deal.name}, ${deal.discount}% off. Gift it on Steam`}>
              <span className="nm-deal-k">Tonight's special</span>
              <span className="nm-deal-art"><Cover appid={deal.appid} name={deal.name} kind="header" /></span>
              <span className="nm-deal-txt">
                <b className="nm-deal-name">{deal.name}</b>
                <span className="nm-deal-who">{dealWho}</span>
              </span>
              <span className="nm-deal-price"><em>-{deal.discount}%</em>{deal.price && <span>{deal.price}</span>}</span>
              <span className="nm-deal-go">Gift it ↗</span>
            </a>
          )}

          {empty ? <div className="nm-empty">No games in common. Pitch one below.</div> : (
            <section className="nm-pool" aria-label="Games you own together">
              <div className="nm-chips" role="group" aria-label="Filters">
                {chip(coopOnly, 'Co-op', () => setCoopOnly((v) => !v), 'Multiplayer / co-op only')}
                {chip(fresh, 'Not played lately', () => setFresh((v) => !v), 'Nobody played it in the last 2 weeks')}
                {chip(blood, 'Never played', () => setBlood((v) => !v), 'Nobody here has played it yet')}
                {chip(minHours > 0, minHours ? `${minHours}h+ together` : 'Any hours', () => setMinHours((h) => HOURS[(HOURS.indexOf(h) + 1) % HOURS.length]), 'Minimum hours played together')}
              </div>
              <div className="nm-tabs" role="tablist" aria-label="Who owns it">
                {([['all', 'Everyone has it'], ['almost', 'Almost everyone']] as const).map(([k, label]) => {
                  const picked = mine.some((b) => lists[k].some((g) => g.appid === b.appid));
                  return (
                    <button key={k} type="button" role="tab" aria-selected={tier === k} className={`nm-tab ${tier === k ? 'on' : ''}`}
                      onClick={() => { sfx.click(); setTierPick(k); }}>
                      <span>{label}</span><em>{lists[k].length}</em>{picked && <i className="nm-tab-dot" aria-label="has your picks" />}
                    </button>
                  );
                })}
              </div>
              <div className="nm-felt" role="tabpanel">
                {state.poolLoading && <div className="nm-loading"><i className="nh-spin" /> Reading everyone's libraries…</div>}
                {list.length > 0 ? <div className="nm-grid">{capped(list, tier).map(card)}</div> : !state.poolLoading && (
                  <div className="nm-empty sm">
                    {hasTier(tier) && filtered ? <>Filters hid them all. <button type="button" className="nh-linkbtn" onClick={clearFilters}>Clear filters</button></>
                      : tier === 'all' ? 'Nothing everyone owns.' : 'Nothing here.'}
                  </div>
                )}
                {hidden > 0 && (
                  <button type="button" className="nh-btn nh-btn-sm nh-more" onClick={() => { sfx.click(); setMore((m) => ({ ...m, [tier]: true })); }}>
                    Show {hidden} more
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <Pitches state={state} me={me} send={send} />

      {state.phase === 'nominate' && <div className="nh-nom-rules"><TableRules state={state} isHost={isHost} send={send} collapsible /></div>}

      <DockActions>
        <div className="dock-act dock-act-row">
          <span className={`nh-mycount ${myCount >= MAX_NOMS ? 'is-full' : ''}`} aria-label={`Your picks: ${myCount} of ${MAX_NOMS}`}>
            Your picks <b>{myCount}/{MAX_NOMS}</b>
          </span>
          {isHost ? (
            <button type="button" className="nh-btn nh-btn-big nh-btn-red" disabled={state.poolLoading && state.board.length === 0}
              title="Empty spots get dealt by the house"
              onClick={() => { sfx.unlock(); sfx.cock(); send({ t: 'beginVeto' }); }}>To the guns →</button>
          ) : <div className="nh-waiting"><i className="nh-spin" /> Waiting on the host…</div>}
        </div>
      </DockActions>
    </div>
  );
}
