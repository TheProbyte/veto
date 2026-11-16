import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DRAFT_BURNS, DRAFT_HAND, type Draft, type Player, type PoolGame } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import Cover from '../scene/Cover';
import { launchCard, play } from '../scene/Dock';
import { Avatar, settingsOf } from './Lobby';
import { units } from './Nominate';
import './nominate.css';

const reduced = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const SUITS = ['♠', '♥', '♦', '♣'];
const BURN_MS = 950;

function hrs(h: number) { return h >= 1000 ? `${(h / 1000).toFixed(1)}k` : `${Math.round(h)}`; }

/** a little stack of face-down cards (others' hands, the deck) */
export function CardBacks({ n, max = 5, big }: { n: number; max?: number; big?: boolean }) {
  const shown = Math.max(0, Math.min(max, n));
  return (
    <span className={`dh-backs ${big ? 'is-big' : ''} ${n === 0 ? 'is-empty' : ''}`} aria-hidden>
      {shown === 0 ? <i className="dh-back is-ghost" /> : Array.from({ length: shown }, (_, i) => <i key={i} className="dh-back" style={{ '--i': i } as CSSProperties} />)}
    </span>
  );
}

type Mode = null | { k: 'offer' } | { k: 'give'; offer: number };

/** Card-hand draft (settings.nominations === 'draft'): my private hand + trades. */
export default function DraftHand({ state, me, send }: Pick<RoomProps, 'state' | 'me' | 'send'>) {
  const draft = state.draft as Draft;
  const hand = draft.hand || [];
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const poolBy = useMemo(() => new Map(state.pool.map((g) => [g.appid, g])), [state.pool]);
  const pitchBy = useMemo(() => new Map((state.pitches || []).map((p) => [p.appid, p.name])), [state.pitches]);
  const nameOf = (appid: number) => poolBy.get(appid)?.name ?? pitchBy.get(appid) ?? state.board.find((b) => b.appid === appid)?.name ?? 'A mystery game';
  const who = (id: string) => (id === me ? 'You' : byId.get(id)?.name ?? 'Somebody');
  const picks = settingsOf(state).picks;
  const myCount = state.board.filter((b) => b.by.includes(me)).length;
  const burnsLeft = Math.max(0, DRAFT_BURNS - (draft.burns?.[me] ?? 0));
  const offers = draft.offers || [];
  const incoming = offers.filter((o) => o.to === me);
  const outgoing = offers.filter((o) => o.from === me);
  const others = state.players.filter((p) => p.id !== me);
  const targets = others.filter((p) => p.connected || p.bot);
  const full = myCount >= picks;

  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [burning, setBurning] = useState<{ appid: number; idx: number }[]>([]);
  const [playing, setPlaying] = useState<Set<number>>(() => new Set());
  const timers = useRef<number[]>([]);
  const hiss = useRef(false);
  useEffect(() => () => { timers.current.forEach(clearTimeout); if (hiss.current) sfx.fuse(false); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  // reconcile local UI with the server: a selected card that left my hand, an offer that's gone
  const handKey = hand.join(',');
  useEffect(() => {
    if (sel != null && !hand.includes(sel)) setSel(null);
  }, [handKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const offerKey = offers.map((o) => o.id).join(',');
  useEffect(() => {
    if (mode?.k === 'give' && !offers.some((o) => o.id === mode.offer && o.to === me)) setMode(null);
  }, [offerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode?.k === 'offer' && sel == null) setMode(null); }, [sel, mode]);

  /* ---- cards sized to the table: the whole hand fits, no scrolling ---- */
  const fanRef = useRef<HTMLDivElement>(null);
  const [fanBox, setFanBox] = useState({ w: 0, h: 0, u: 3, t: 3 });
  useLayoutEffect(() => {
    const el = fanRef.current;
    if (!el) return;
    const read = () => { const { u, t } = units(el); setFanBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight && b.u === u && b.t === t ? b : { w: el.clientWidth, h: el.clientHeight, u, t })); };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- new cards slide in from the deck ---- */
  const deckRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<number, HTMLElement>());
  const prevHand = useRef<number[] | null>(null);
  useLayoutEffect(() => {
    const prev = prevHand.current;
    prevHand.current = hand;
    const fresh = hand.filter((a) => !(prev || []).includes(a));
    if (!fresh.length) return;
    const many = fresh.length > 1;
    if (many) { if (!play('cardRiffle')) sfx.whoosh(); } else if (!play('cardSlide')) sfx.whoosh();
    if (reduced()) return;
    const deck = deckRef.current?.getBoundingClientRect();
    fresh.forEach((appid, i) => {
      const el = cardEls.current.get(appid);
      if (!el || !deck) return;
      const r = el.getBoundingClientRect();
      const dx = deck.left + deck.width / 2 - (r.left + r.width / 2);
      const dy = deck.top + deck.height / 2 - (r.top + r.height / 2);
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.55) rotate(-14deg)`, opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 18}px) scale(.9) rotate(4deg)`, offset: 0.65 },
        { transform: 'none' },
      ], { duration: 420, delay: many ? i * 110 : 0, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'backwards' });
      if (many && i > 0) later(() => play('cardSlide'), i * 110);
    });
  }, [handKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- actions ---- */
  const pick = (appid: number) => {
    sfx.unlock(); sfx.click();
    if (mode?.k === 'offer') setMode(null);
    setSel((s) => (s === appid ? null : appid));
  };
  const doPlay = (appid: number) => {
    if (full) return;
    sfx.unlock();
    const el = cardEls.current.get(appid);
    launchCard(appid, el?.querySelector('.dh-card-art') ?? el ?? null);
    play('swish');
    setPlaying((s) => new Set(s).add(appid));
    later(() => setPlaying((s) => { const n = new Set(s); n.delete(appid); return n; }), 2000);
    setSel(null);
    send({ t: 'draftPlay', appid });
  };
  const doBurn = (appid: number) => {
    if (burnsLeft <= 0) return;
    sfx.unlock();
    sfx.fuse(true); hiss.current = true; // a short fuse hiss while it burns
    later(() => { sfx.fuse(false); hiss.current = false; }, BURN_MS - 200);
    setSel(null);
    if (!reduced()) {
      const idx = hand.indexOf(appid);
      setBurning((b) => [...b.filter((x) => x.appid !== appid), { appid, idx }]);
      later(() => setBurning((b) => b.filter((x) => x.appid !== appid)), BURN_MS);
    }
    send({ t: 'draftBurn', appid });
  };
  const doOffer = (to: string) => {
    if (sel == null) return;
    sfx.unlock(); if (!play('cardSlide')) sfx.whoosh();
    send({ t: 'draftOffer', to, appid: sel });
    setMode(null); setSel(null);
  };
  const doGive = (offer: number) => {
    if (sel == null) return;
    sfx.unlock(); if (!play('cardSlap')) sfx.stamp();
    send({ t: 'draftAccept', offer, give: sel });
    setMode(null); setSel(null);
  };
  const decline = (offer: number) => {
    sfx.unlock(); sfx.click();
    if (mode?.k === 'give' && mode.offer === offer) setMode(null);
    send({ t: 'draftDecline', offer });
  };

  /* ---- the cards shown: my hand, plus burning ghosts the server already took away ---- */
  const slots: { appid: number; burn: boolean }[] = hand.map((appid) => ({ appid, burn: burning.some((b) => b.appid === appid) }));
  for (const b of burning) {
    if (hand.includes(b.appid)) continue;
    slots.splice(Math.max(0, Math.min(slots.length, b.idx)), 0, { appid: b.appid, burn: true });
  }
  const n = slots.length;
  const { u, t } = fanBox;
  const textH = 16 * t + 5 * u; // two name lines + face padding / gaps
  const lift = 6 * u; // room for a selected card to rise
  // the fan tilts its cards a few degrees: leave slack so tilted corners stay inside the table
  const cwH = (fanBox.h - textH - lift - 7 * u) / 1.62; // 6u bottom padding: outer cards dip by up to 4u
  const deckW = Math.max(24, Math.min(cwH * 0.6, 60));
  const cwW = (fanBox.w - deckW - 3 * u * Math.max(1, n) - 6 * u) / (Math.max(1, n) * 1.1);
  const cw = Math.floor(Math.max(24, Math.min(cwH, cwW, Math.max(40 * t, 26 * u))));
  const giving = mode?.k === 'give' ? offers.find((o) => o.id === mode.offer) : undefined;
  const onOffer = new Map(outgoing.map((o) => [o.give, o.to]));

  const card = ({ appid, burn }: { appid: number; burn: boolean }, i: number) => {
    const g: PoolGame | undefined = poolBy.get(appid);
    const name = nameOf(appid);
    const missing = (g?.missing || []).map((id) => byId.get(id)).filter(Boolean) as Player[];
    const c = i - (n - 1) / 2;
    const isSel = sel === appid && !burn;
    const offeredTo = onOffer.get(appid);
    return (
      <button key={appid} type="button" ref={(el) => { if (el) cardEls.current.set(appid, el); else cardEls.current.delete(appid); }}
        className={`dh-card ${isSel ? 'is-sel' : ''} ${burn ? 'is-burning' : ''} ${playing.has(appid) ? 'is-playing' : ''} ${giving ? 'is-giving' : ''}`}
        style={{ '--r': `${c * 3}deg`, '--y': `${Math.round(Math.abs(c) * Math.abs(c) * u)}px` } as CSSProperties}
        disabled={burn} aria-pressed={isSel} onClick={() => pick(appid)}
        aria-label={`${name}${g ? `, ${g.hours > 0 ? `${hrs(g.hours)} hours together` : 'nobody has played it'}` : ''}${missing.length ? `, ${missing.length} short` : ''}`}>
        <span className="dh-face">
          <span className="dh-pip" aria-hidden>{SUITS[appid % 4]}</span>
          <span className="dh-card-art"><Cover appid={appid} name={name} kind="box" />
            <span className="dh-art-hrs" aria-hidden>{g ? (g.hours > 0 ? `${hrs(g.hours)}h` : 'New') : '$'}</span>
            {missing.length > 0 && <span className="dh-art-short" aria-hidden title={`Short: ${missing.map((p) => p.name).join(', ')}`}>-{missing.length}</span>}
          </span>
          <span className="dh-card-name">{name}</span>
          <span className="dh-card-meta">
            <b>{g ? (g.hours > 0 ? `${hrs(g.hours)}h` : 'Fresh') : '$ Pitch'}</b>
            {missing.length > 0 && (
              <span className="dh-short" title={`Short: ${missing.map((p) => p.name).join(', ')}`}>
                {missing.slice(0, 2).map((p) => <Avatar key={p.id} p={p} size={12} />)}
                {missing.length > 2 && <small>+{missing.length - 2}</small>}
              </span>
            )}
          </span>
          {offeredTo && <span className="dh-tag">→ {who(offeredTo)}</span>}
        </span>
        {burn && (
          <span className="dh-fire" aria-hidden>
            <i /><i /><i /><i /><i /><i />
          </span>
        )}
      </button>
    );
  };

  const selName = sel != null ? nameOf(sel) : '';
  let bar: JSX.Element | null;
  if (giving) {
    bar = (
      <div className="dh-bar is-give">
        <span className="dh-bar-txt">{sel != null ? <>Give <b>{who(giving.from)}</b> your <b>{selName}</b>?</> : <>Pick a card to give <b>{who(giving.from)}</b></>}</span>
        <button type="button" className="nm-btn nm-btn-sm" disabled={sel == null} onClick={() => doGive(giving.id)}>Trade</button>
        <button type="button" className="nm-btn nm-btn-sm is-ghost" onClick={() => { sfx.click(); setMode(null); setSel(null); }}>Cancel</button>
      </div>
    );
  } else if (mode?.k === 'offer' && sel != null) {
    bar = (
      <div className="dh-bar is-offer">
        <span className="dh-bar-txt">Offer <b>{selName}</b> to</span>
        <div className="dh-targets" role="group" aria-label="Offer to which player">
          {targets.length === 0 && <span className="dh-bar-txt">nobody's here</span>}
          {targets.map((p) => (
            <button key={p.id} type="button" className="dh-target" onClick={() => doOffer(p.id)}>
              <Avatar p={p} size={18} /><span>{p.name}</span>
            </button>
          ))}
        </div>
        <button type="button" className="nm-btn nm-btn-sm is-ghost" onClick={() => { sfx.click(); setMode(null); }}>Cancel</button>
      </div>
    );
  } else if (sel != null) {
    bar = (
      <div className="dh-bar">
        <button type="button" className="nm-btn nm-btn-sm dh-play" disabled={full} onClick={() => doPlay(sel)} title={full ? `You've played all ${picks}` : 'Play it onto the table'}>
          {full ? 'Picks full' : 'Play'}
        </button>
        <button type="button" className="nm-btn nm-btn-sm is-red dh-burn" disabled={burnsLeft <= 0} onClick={() => doBurn(sel)} title={draft.deck <= 0 ? "Deck's empty: you won't draw a new one" : 'Discard it and draw a new one'}>
          Burn{burnsLeft > 0 ? '' : ' (used)'}
        </button>
        <button type="button" className="nm-btn nm-btn-sm dh-offer" disabled={targets.length === 0} onClick={() => { sfx.click(); setMode({ k: 'offer' }); }}>Offer to…</button>
      </div>
    );
  } else if (incoming.length > 0) {
    bar = null; // the trade strip above the fan says it all
  } else {
    bar = (
      <div className="dh-bar is-idle">
        <span className="dh-bar-txt">{hand.length ? (full ? 'Picks are in. Trade or sit tight.' : 'Tap a card: play, burn or trade.') : 'Hand empty.'}</span>
        <span className="dh-stat">Burns <b>{burnsLeft}</b></span>
      </div>
    );
  }

  const seatsRow = (
    <div className="nm-bar dh-table" aria-label="Hands at the table" role="group">
      {others.map((p) => {
        const c = draft.handCounts?.[p.id] ?? 0;
        return (
          <span key={p.id} className={`dh-seat ${p.connected || p.bot ? '' : 'is-off'}`} title={`${p.name}: ${c} card${c === 1 ? '' : 's'}`}>
            <Avatar p={p} size={16} /><span className="dh-seat-name">{p.name}</span><CardBacks n={c} /><b>{c}</b>
          </span>
        );
      })}
    </div>
  );

  // trades: one compact banner (an offer to me wins over my own pending offer)
  const inOffer = !giving && sel == null ? incoming[0] : undefined;
  const outOffer = !inOffer && !giving ? outgoing[0] : undefined;
  const banner = inOffer ? (
    <div className="dh-trade" aria-live="polite" role="group" aria-label="Trade offer to you">
      <span className="dh-trade-art"><Cover appid={inOffer.give} name={nameOf(inOffer.give)} kind="box" /></span>
      <span className="dh-trade-txt"><span className="dh-trade-k">Trade</span> <b>{who(inOffer.from)}</b> offers <b>{nameOf(inOffer.give)}</b>{incoming.length > 1 && <span className="dh-more"> +{incoming.length - 1} more</span>}</span>
      <span className="dh-trade-btns">
        <button type="button" className="nm-btn nm-btn-sm" disabled={hand.length === 0}
          onClick={() => { sfx.unlock(); sfx.click(); setSel(null); setMode({ k: 'give', offer: inOffer.id }); }}>Accept…</button>
        <button type="button" className="nm-btn nm-btn-sm is-ghost" onClick={() => decline(inOffer.id)}>Decline</button>
      </span>
    </div>
  ) : outOffer ? (
    <div className="dh-trade is-out" role="group" aria-label="Your trade offer">
      <span className="dh-trade-art"><Cover appid={outOffer.give} name={nameOf(outOffer.give)} kind="box" /></span>
      <span className="dh-trade-txt"><span className="dh-trade-k">Your offer</span> <b>{nameOf(outOffer.give)}</b> → {who(outOffer.to)} <i className="nh-spin" />{outgoing.length > 1 && <span className="dh-more"> +{outgoing.length - 1} more</span>}</span>
      <span className="dh-trade-btns">
        <button type="button" className="nm-btn nm-btn-sm is-ghost" onClick={() => decline(outOffer.id)}>Withdraw</button>
      </span>
    </div>
  ) : null;

  return (
    <section className={`dh ${giving ? 'is-give' : ''}`} aria-label="Your hand">
      {seatsRow}
      {banner}
      <div className="dh-fan" ref={fanRef} role="group" aria-label={`Your hand: ${hand.length} of ${DRAFT_HAND} cards`} style={{ '--cw': `${cw}px` } as CSSProperties}>
        <div className="dh-deck" ref={deckRef} title={`${draft.deck} left in the deck`}>
          <CardBacks n={draft.deck} max={4} big />
          <span className="dh-deck-n"><b>{draft.deck}</b>deck</span>
        </div>
        {slots.map(card)}
        {n === 0 && <div className="dh-none">No cards</div>}
      </div>
      {bar ?? <div className="dh-bar is-idle"><span className="dh-bar-txt">Answer the trade above.</span></div>}
    </section>
  );
}
