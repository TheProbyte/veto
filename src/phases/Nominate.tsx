import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import type { BoardGame, PoolGame, Player } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { Avatar, settingsOf, TableRules } from './Lobby';
import Pitches from './Pitches';
import DraftHand from './DraftHand';
import Cover from '../scene/Cover';
import { DockActions, launchCard, play } from '../scene/Dock';
import './nominate.css';

const SUITS = ['♠', '♥', '♦', '♣'];
const HOURS = [0, 10, 50, 100];
type Tab = 'all' | 'almost' | 'buy';

/** nominate toggle with the thematic bits: my new pick flies onto the dock, a take-back slides off */
export function tossOrTake(appid: number, mineNow: boolean, from: Element | null, send: RoomProps['send']) {
  sfx.unlock();
  if (mineNow) { if (!play('cardSlide')) sfx.whoosh(); }
  else { launchCard(appid, from); play('swish'); }
  send({ t: 'nominate', appid });
}

const reduced = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function hrs(h: number) {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k`;
  return `${Math.round(h)}`;
}

/** the panel's pixel units (CSS --u chrome / --t text), read back in CSS px */
export function units(el: Element | null) {
  if (!el) return { u: 3, t: 3 };
  const cs = getComputedStyle(el);
  return { u: parseFloat(cs.getPropertyValue('--u')) || 3, t: parseFloat(cs.getPropertyValue('--t')) || 3 };
}

/* ---------------- the table area: a fixed box between the nameplates and the dock ---------------- */

/** Sizes the nominate panel to exactly the space below the seated players' nameplates and above the dock (no page scroll). */
function useTableFit(ref: React.RefObject<HTMLElement>, key: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    const front = el?.closest('.saloon-front') as HTMLElement | null;
    if (!el || !front) return;
    const saloon = el.closest('.saloon');
    let raf = 0;
    const fit = () => {
      front.scrollTop = 0;
      el.style.setProperty('--nm-push', '0px');
      const pr = el.getBoundingClientRect();
      let push = 0;
      if (!saloon?.classList.contains('is-split')) {
        // never cover a nameplate that sits above the panel's width
        let plate = 0;
        document.querySelectorAll('.seat-plate').forEach((p) => {
          const r = p.getBoundingClientRect();
          if (r.height > 0 && r.right > pr.left + 6 && r.left < pr.right - 6 && r.top < pr.top + 120) plate = Math.max(plate, r.bottom);
        });
        push = Math.max(0, Math.ceil(plate + 4 - pr.top));
      }
      const fr = front.getBoundingClientRect();
      const pb = parseFloat(getComputedStyle(front).paddingBottom) || 0;
      const h = Math.floor(fr.top + front.clientHeight - pb - (pr.top + push));
      el.style.setProperty('--nm-push', `${push}px`);
      el.style.setProperty('--nm-h', `${Math.max(150, h)}px`);
    };
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    fit();
    const ro = new ResizeObserver(later);
    ro.observe(front);
    const dock = saloon?.querySelector('.dock');
    if (dock) ro.observe(dock);
    window.addEventListener('resize', later);
    // nameplates pop in / settle after a phase change
    const t1 = window.setTimeout(later, 400), t2 = window.setTimeout(later, 1200);
    return () => { ro.disconnect(); window.removeEventListener('resize', later); cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, [ref, key]);
}

/* ---------------- pagination: as many cards as fit, never a scrollbar ---------------- */

export type CellSize = (u: number, t: number, w: number) => { w: number; h: number; ideal: number };

/** measures a grid box and works out cols x rows of cells; `size` gives the min cell width, min height and ideal height (for a given column width) */
export function usePages(n: number, size: CellSize, resetKey: string) {
  const [el, ref] = useState<HTMLDivElement | null>(null); // callback ref: the grid can mount after this hook (tab / search switches)
  const [box, setBox] = useState({ w: 0, h: 0, u: 3, t: 3 });
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => {
      const { u, t } = units(el);
      setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight && b.u === u && b.t === t ? b : { w: el.clientWidth, h: el.clientHeight, u, t }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const gap = Math.max(4, box.u * 2);
  const min = size(box.u, box.t, 0);
  const cols = Math.max(1, Math.floor((box.w + gap) / (min.w + gap)));
  const colW = box.w > 0 ? (box.w - gap * (cols - 1)) / cols : min.w;
  const cell = size(box.u, box.t, colW);
  const rows = Math.max(1, Math.floor((box.h + gap) / (cell.h + gap)));
  const rowH = box.h > 0 ? Math.max(0, Math.min(cell.ideal, Math.floor((box.h - gap * (rows - 1)) / rows))) : cell.h;
  const per = cols * rows;
  const pages = Math.max(1, Math.ceil(n / per));
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(0);
  useEffect(() => { setPage(0); }, [resetKey]);
  const cur = Math.min(page, pages - 1);
  const go = useCallback((d: number) => {
    setPage((p) => {
      const c = Math.min(p, pages - 1);
      const nx = Math.max(0, Math.min(pages - 1, c + d));
      if (nx !== c) { sfx.click(); setDir(d); }
      return nx;
    });
  }, [pages]);
  const jump = useCallback((i: number) => { setPage((p) => { if (i !== p) { sfx.click(); setDir(i > p ? 1 : -1); } return i; }); }, []);
  const style = { '--cols': cols, '--rows': rows, '--row-h': `${rowH}px`, '--gap': `${gap}px` } as CSSProperties;
  return { ref, cols, rows, per, pages, page: cur, go, jump, dir, style, start: cur * per, cellH: rowH };
}

/** the paged card table: the grid plus big ◀ ▶ buttons and a pip row; swipe on touch, arrow keys on desktop */
export function PagedDeck({ pager, children, label, className = '', empty }: {
  pager: ReturnType<typeof usePages>; children: ReactNode; label: string; className?: string; empty?: ReactNode;
}) {
  const { ref, pages, page, go, jump, dir, style } = pager;
  // arrow keys (not while typing or while a dialog is up)
  useEffect(() => {
    if (pages < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      if (document.querySelector('.nm-modal')) return;
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages, go]);
  // swipe: a horizontal flick pages, and swallows the tap it would otherwise be
  const sw = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const down = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') sw.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; swiped.current = false; };
  const up = (e: React.PointerEvent) => {
    const s = sw.current; sw.current = null;
    if (!s || s.id !== e.pointerId || pages < 2) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped.current = true; go(dx < 0 ? 1 : -1); }
  };
  const clickCapture = (e: MouseEvent) => { if (swiped.current) { swiped.current = false; e.stopPropagation(); e.preventDefault(); } };
  return (
    <div className={`nm-deck ${pages > 1 ? 'has-pages' : ''} ${className}`}>
      <div className="nm-deck-row">
        <button type="button" className="nm-page nm-page-prev" disabled={page <= 0} onClick={() => go(-1)} aria-label="Previous page" hidden={pages < 2}><i aria-hidden>◀</i></button>
        <div className="nm-grid" ref={ref} style={style} aria-label={label} role="group"
          onPointerDown={down} onPointerUp={up} onPointerCancel={() => { sw.current = null; }} onClickCapture={clickCapture}>
          <div key={page} className={`nm-grid-in ${dir > 0 ? 'from-r' : dir < 0 ? 'from-l' : ''}`}>{children}</div>
          {empty}
        </div>
        <button type="button" className="nm-page nm-page-next" disabled={page >= pages - 1} onClick={() => go(1)} aria-label="Next page" hidden={pages < 2}><i aria-hidden>▶</i></button>
      </div>
      {pages > 1 && (
        <div className="nm-pips" role="group" aria-label={`Page ${page + 1} of ${pages}`}>
          {pages <= 12 && Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" className={`nm-pip-b ${i === page ? 'on' : ''}`} aria-label={`Page ${i + 1}`} aria-current={i === page} onClick={() => jump(i)} />
          ))}
          <span className="nm-pager-n">page {page + 1}/{pages}</span>
        </div>
      )}
    </div>
  );
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

/** table rules live behind a small button: a pixel dialog over the saloon */
function RulesButton({ state, isHost, send }: Pick<RoomProps, 'state' | 'send'> & { isHost: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const close = () => { sfx.click(); setOpen(false); btn.current?.focus(); };
  const host = btn.current?.closest('.saloon') ?? document.body;
  return (
    <>
      <button ref={btn} type="button" className="nm-rules-btn" aria-haspopup="dialog" aria-expanded={open} title="Table rules" onClick={() => { sfx.click(); setOpen(true); }}>
        <span aria-hidden>⚙</span><span className="nm-rules-lbl">Rules</span>
      </button>
      {open && createPortal(
        <div className="nm-modal" role="dialog" aria-modal="true" aria-label="Table rules" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="nm-modal-box">
            <div className="nm-modal-head">
              <h3>Table rules</h3>
              <button type="button" className="nm-modal-x" onClick={close} aria-label="Close" autoFocus>×</button>
            </div>
            <div className="nm-modal-body"><TableRules state={state} isHost={isHost} send={send} /></div>
          </div>
        </div>, host)}
    </>
  );
}

export default function Nominate({ state, me, send }: RoomProps) {
  const [coopOnly, setCoopOnly] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [blood, setBlood] = useState(false);
  const [minHours, setMinHours] = useState(0);
  const [tabPick, setTabPick] = useState<Tab | null>(null);
  const [tossed, setTossed] = useState<number | null>(null);
  const tossT = useRef(0);
  const slotsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
  const drafting = settingsOf(state).nominations === 'draft' && !!state.draft;

  useTableFit(panelRef, `${state.players.map((p) => p.seat).join(',')}|${drafting}`);

  const filtered = (coopOnly ? 1 : 0) + (fresh ? 1 : 0) + (blood ? 1 : 0) + (minHours ? 1 : 0);
  const visible = state.pool.filter((g) => !(coopOnly && g.coop === false) && !(fresh && g.recent) && !(blood && g.hours > 0) && g.hours >= minHours);
  const lists: Record<'all' | 'almost', PoolGame[]> = { all: visible.filter((g) => g.tier === 'all'), almost: visible.filter((g) => g.tier === 'almost') };
  const hasTier = (t: 'all' | 'almost') => state.pool.some((g) => g.tier === t);
  const tab: Tab = tabPick ?? (drafting ? 'all' : hasTier('all') || !hasTier('almost') ? 'all' : 'almost');
  const tier = tab === 'buy' ? 'all' : tab;
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

  // card cell: art (squashes, never below a sliver) + name + meta (+ missing row on "almost")
  const lines = tier === 'almost' ? 3 : 2;
  const size: CellSize = useCallback((u, t, w) => {
    const text = lines * 8 * t + 7 * u;
    const minW = Math.max(84, 46 * t, 30 * u);
    const art = (w || minW) * 30 / 64;
    return { w: minW, h: Math.round(text + art * 0.42), ideal: Math.round(text + art) };
  }, [lines]);
  const filterKey = `${tier}|${coopOnly}|${fresh}|${blood}|${minHours}`;
  const pager = usePages(list.length, size, filterKey);
  const shown = list.slice(pager.start, pager.start + pager.per);

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
          {g.tier === 'almost' && (
            <span className="nm-miss">
              {missing.length > 0 && <span className="nm-miss-k">Short</span>}
              {missing.slice(0, 2).map((p) => <span key={p.id} className={`nm-miss-p ${p.id === me ? 'is-me' : ''}`}>{p.id === me ? 'You' : p.name}</span>)}
              {missing.length > 2 && <span className="nm-miss-p">+{missing.length - 2}</span>}
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
  const chip = (on: boolean, label: string, short: string, flip: () => void, title?: string) => (
    <button type="button" className={`nm-chip ${on ? 'on' : ''}`} aria-pressed={on} title={title} aria-label={label} onClick={() => { sfx.click(); flip(); }}>
      <span className="nm-long">{label}</span><span className="nm-short" aria-hidden>{short}</span>
    </button>
  );
  const clearFilters = () => { sfx.click(); setCoopOnly(false); setFresh(false); setBlood(false); setMinHours(0); };
  const pickTab = (k: Tab) => { sfx.click(); setTabPick(k); };
  const tabBtn = (k: Tab, label: string, short: string, n: number, dot: boolean) => (
    <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`nm-tab ${k === 'buy' ? 'is-buy' : ''} ${tab === k ? 'on' : ''}`} onClick={() => pickTab(k)}>
      <span className="nm-long">{label}</span><span className="nm-short" aria-hidden>{short}</span><em>{n}</em>{dot && <i className="nm-tab-dot" aria-label="has your picks" />}
    </button>
  );
  const pickedIn = (l: PoolGame[]) => mine.some((b) => l.some((g) => g.appid === b.appid));
  const pitchPicked = mine.some((b) => (state.pitches || []).some((p) => p.appid === b.appid));

  const dealEl = deal && (
    <a className="nm-deal" href={`https://store.steampowered.com/app/${deal.appid}`} target="_blank" rel="noopener noreferrer"
      onClick={() => sfx.click()} title={`Tonight's special: ${deal.name}, ${deal.discount}% off. ${dealWho}. Gift it on Steam`}
      aria-label={`Tonight's special: ${deal.name}, ${deal.discount}% off. ${dealWho}. Gift it on Steam`}>
      <span className="nm-deal-k">Special</span>
      <span className="nm-deal-art"><Cover appid={deal.appid} name={deal.name} kind="header" /></span>
      <span className="nm-deal-txt"><b className="nm-deal-name">{deal.name}</b><span className="nm-deal-who">{dealWho}</span></span>
      <em className="nm-deal-off">-{deal.discount}%</em>
      {deal.price && <span className="nm-deal-price">{deal.price}</span>}
      <span className="nm-deal-go">Gift ↗</span>
    </a>
  );

  return (
    <div className={`nm ${drafting ? 'is-draft' : ''}`} ref={panelRef}>
      <header className="nm-head">
        <div className="nm-titles">
          <h2 className="nm-title">{drafting ? 'Play your hand' : 'Toss your games on the table'}</h2>
          <p className="nm-how">{drafting ? `Play up to ${MAX_NOMS}. Burn a dud or trade.` : `Tap games you want to play. Up to ${MAX_NOMS}.`}</p>
        </div>
        <PickSlots mine={mine} max={MAX_NOMS} me={me} send={send} slotsRef={slotsRef} />
        {state.phase === 'nominate' && <RulesButton state={state} isHost={isHost} send={send} />}
      </header>

      <div className="nm-tabs" role="tablist" aria-label="Which games">
        {drafting
          ? tabBtn('all', 'Your hand', 'Hand', state.draft?.hand?.length ?? 0, false)
          : <>
            {tabBtn('all', 'Everyone has it', 'Everyone', lists.all.length, pickedIn(lists.all))}
            {tabBtn('almost', 'Almost everyone', 'Almost', lists.almost.length, pickedIn(lists.almost))}
          </>}
        {tabBtn('buy', 'Buy something new', 'Buy new', state.pitches.length, pitchPicked)}
      </div>

      <div className="nm-felt" role="tabpanel">
        {tab === 'buy' ? <Pitches state={state} me={me} send={send} /> : drafting ? <DraftHand state={state} me={me} send={send} /> : (
          <>
            <div className="nm-bar">
              <div className="nm-chips" role="group" aria-label="Filters">
                {chip(coopOnly, 'Co-op', 'Co-op', () => setCoopOnly((v) => !v), 'Multiplayer / co-op only')}
                {chip(fresh, 'Not played lately', 'Fresh', () => setFresh((v) => !v), 'Nobody played it in the last 2 weeks')}
                {chip(blood, 'Never played', 'Unplayed', () => setBlood((v) => !v), 'Nobody here has played it yet')}
                {chip(minHours > 0, minHours ? `${minHours}h+ together` : 'Any hours', minHours ? `${minHours}h+` : 'Hours', () => setMinHours((h) => HOURS[(HOURS.indexOf(h) + 1) % HOURS.length]), 'Minimum hours played together')}
              </div>
              {dealEl}
            </div>
            {state.poolLoading && <div className="nm-loading"><i className="nh-spin" /> Reading everyone's libraries…</div>}
            <PagedDeck pager={pager} label={tier === 'all' ? 'Games everyone owns' : 'Games almost everyone owns'}
              empty={empty ? <div className="nm-empty">No games in common. Pitch one under Buy new.</div> : list.length === 0 && !state.poolLoading ? (
                <div className="nm-empty">
                  {hasTier(tier) && filtered ? <>Filters hid them all. <button type="button" className="nm-linkbtn" onClick={clearFilters}>Clear filters</button></>
                    : tier === 'all' ? 'Nothing everyone owns.' : 'Nothing here.'}
                </div>
              ) : null}>
              {shown.map(card)}
            </PagedDeck>
          </>
        )}
      </div>

      <DockActions>
        <div className="dock-act dock-act-row">
          <span className={`nm-mycount ${myCount >= MAX_NOMS ? 'is-full' : ''}`} aria-label={`Your picks: ${myCount} of ${MAX_NOMS}`}>
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
