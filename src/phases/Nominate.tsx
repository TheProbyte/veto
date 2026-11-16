import { useMemo, useState, type MouseEvent } from 'react';
import type { PoolGame, Player } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { Avatar, settingsOf, TableRules } from './Lobby';
import Pitches from './Pitches';
import Cover from '../scene/Cover';
import { DockActions, launchCard, play } from '../scene/Dock';
import './panels.css';

const CAP = 12; // cards per tier before "Show more" (keeps the DOM light on phones)

/** nominate toggle with the thematic bits: my new pick flies onto the dock, a take-back slides off */
export function tossOrTake(appid: number, mineNow: boolean, from: Element | null, send: RoomProps['send']) {
  sfx.unlock();
  if (mineNow) { if (!play('cardSlide')) sfx.whoosh(); }
  else { launchCard(appid, from); play('swish'); }
  send({ t: 'nominate', appid });
}

const isPhone = () => { try { return !!window.matchMedia?.('(max-width: 640px)').matches; } catch { return false; } };

function hrs(h: number) {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k`;
  return `${Math.round(h)}`;
}

export default function Nominate({ state, me, send }: RoomProps) {
  const [coopOnly, setCoopOnly] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [blood, setBlood] = useState(false);
  const [minHours, setMinHours] = useState(0);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const isHost = !!byId.get(me)?.host;

  const nomBy = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const b of state.board) m.set(b.appid, b.by);
    return m;
  }, [state.board]);
  const myCount = state.board.filter((b) => b.by.includes(me)).length;
  const MAX_NOMS = settingsOf(state).picks;
  const [phone] = useState(isPhone);

  const visible = state.pool.filter((g) => !(coopOnly && g.coop === false) && !(fresh && g.recent) && !(blood && g.hours > 0) && g.hours >= minHours);

  // deal of the night: the biggest discount (>= 30%) on something the posse is short on, from the unfiltered pool + pitches
  const deal = useMemo(() => {
    type D = { appid: number; name: string; discount: number; price?: string; missing: string[] | null };
    let best: D | null = null;
    for (const g of state.pool) if (g.tier === 'almost' && (g.discount ?? 0) >= 30 && (!best || g.discount! > best.discount)) best = { appid: g.appid, name: g.name, discount: g.discount!, price: g.price, missing: g.missing };
    for (const p of state.pitches || []) if ((p.discount ?? 0) >= 30 && (!best || p.discount! > best.discount)) best = { appid: p.appid, name: p.name, discount: p.discount!, price: p.price, missing: null };
    return best;
  }, [state.pool, state.pitches]);
  const dealNames = deal?.missing ? deal.missing.map((id) => (id === me ? 'You' : byId.get(id)?.name)).filter(Boolean) as string[] : null;
  const dealWho = !deal ? '' : !dealNames ? 'Everyone needs it' : !dealNames.length ? 'Somebody needs it'
    : `${dealNames.join(', ')} need${dealNames.length === 1 && dealNames[0] !== 'You' ? 's' : ''} it`;
  const all = visible.filter((g) => g.tier === 'all');
  const almost = visible.filter((g) => g.tier === 'almost');

  // first CAP cards, plus anything already on the table so it can always be taken back
  const capped = (list: PoolGame[], key: string) =>
    more[key] ? list : list.filter((g, i) => i < CAP || nomBy.has(g.appid));
  const moreBtn = (list: PoolGame[], key: string) => {
    const hidden = list.length - capped(list, key).length;
    if (hidden <= 0) return null;
    return (
      <button type="button" className="nh-btn nh-btn-sm nh-more" onClick={() => { sfx.click(); setMore((m) => ({ ...m, [key]: true })); }}>
        Show {hidden} more
      </button>
    );
  };

  const toggle = (g: PoolGame, e: MouseEvent<HTMLElement>) => {
    const mineNow = (nomBy.get(g.appid) || []).includes(me);
    if (!mineNow && myCount >= MAX_NOMS) { sfx.click(); return; }
    tossOrTake(g.appid, mineNow, e.currentTarget.querySelector('.nh-game-art') ?? e.currentTarget, send);
  };

  /** "Bo 300h · You 2h · Dee 0h": owners by hours, most first (missing players are listed under Short) */
  const hoursRows = (g: PoolGame) => {
    const hb = g.hoursBy || {};
    const rows = g.owners.map((id) => ({ id, h: hb[id] ?? 0 })).sort((a, b) => b.h - a.h || (a.id === me ? -1 : b.id === me ? 1 : 0));
    if (!rows.length || !g.hoursBy) return null;
    const cap = phone ? 3 : 5;
    const shown = rows.slice(0, cap);
    return (
      <div className="nh-hby" aria-label="Hours played">
        {shown.map(({ id, h }) => (
          <span key={id} className={`nh-hby-p ${id === me ? 'is-me' : ''} ${h === 0 ? 'is-zero' : ''}`}>
            {id === me ? 'You' : byId.get(id)?.name ?? '?'} <b>{hrs(h)}h</b>
          </span>
        ))}
        {rows.length > cap && <span className="nh-hby-more">+{rows.length - cap}</span>}
      </div>
    );
  };

  const card = (g: PoolGame) => {
    const by = nomBy.get(g.appid) || [];
    const mine = by.includes(me);
    const others = by.filter((id) => id !== me).map((id) => byId.get(id)).filter(Boolean) as Player[];
    const full = !mine && myCount >= MAX_NOMS;
    return (
      <button key={g.appid} type="button" className={`nh-game ${mine ? 'is-mine' : ''} ${by.length ? 'is-nom' : ''} ${full ? 'is-full' : ''}`}
        onClick={(e) => toggle(g, e)} aria-pressed={mine} title={g.name}>
        <div className="nh-game-art"><Cover appid={g.appid} name={g.name} kind="header" />
          {mine && <span className="nh-ribbon">YOURS</span>}
          {g.discount ? <span className="nh-disc">-{g.discount}%</span> : null}
        </div>
        <div className="nh-game-body">
          <div className="nh-game-name">{g.name}</div>
          <div className="nh-game-meta">
            <span className="nh-hrs">{g.hours > 0 ? `${hrs(g.hours)}h together` : 'Fresh meat'}</span>
            {g.coop === true && <span className="nh-mini co">Co-op</span>}
            {g.recent && <span className="nh-mini rec">Recent</span>}
          </div>
          {hoursRows(g)}
          {g.tier === 'almost' && g.missing.length > 0 && (
            <div className="nh-missing">
              <span>Short:</span>
              {g.missing.map((id) => byId.get(id)).filter(Boolean).map((p) => (
                <span key={p!.id} className="nh-miss-p"><Avatar p={p!} size={16} />{p!.name}</span>
              ))}
              {g.price && <span className="nh-price">{g.price}</span>}
            </div>
          )}
          {others.length > 0 && (
            <div className="nh-noms">
              {others.map((p) => <Avatar key={p.id} p={p} size={18} />)}
              <small>tossed in</small>
            </div>
          )}
        </div>
      </button>
    );
  };

  const empty = !state.poolLoading && state.pool.length === 0;

  return (
    <div className="nh-panel nh-wood nh-nom">
      <i className="nh-nail tl" /><i className="nh-nail tr" /><i className="nh-nail bl" /><i className="nh-nail br" />
      <header className="nh-head nh-nom-head">
        <div>
          <h2 className="nh-h">Toss your games on the table</h2>
          <div className="nh-sub">Pick up to {MAX_NOMS}. Tap again to take one back.</div>
        </div>
        <div className={`nh-tally ${myCount >= MAX_NOMS ? 'is-full' : ''}`} aria-label="Your nominations">
          {Array.from({ length: MAX_NOMS }, (_, i) => <i key={i} className={i < myCount ? 'on' : ''} />)}
          <b>{myCount}/{MAX_NOMS}</b>
        </div>
      </header>

      {state.phase === 'nominate' && <div className="nh-nom-rules"><TableRules state={state} isHost={isHost} send={send} collapsible /></div>}

      {deal && (
        <a className="nh-deal" href={`https://store.steampowered.com/app/${deal.appid}`} target="_blank" rel="noopener noreferrer"
          onClick={() => sfx.click()} aria-label={`Deal of the night: ${deal.name}, ${deal.discount}% off. Gift it on Steam`}>
          <span className="nh-deal-art"><Cover appid={deal.appid} name={deal.name} kind="header" /></span>
          <span className="nh-deal-txt">
            <span className="nh-deal-k">Deal of the night</span>
            <b className="nh-deal-name">{deal.name}</b>
            <span className="nh-deal-line">{dealWho} · <em>-{deal.discount}%</em>{deal.price ? <> · {deal.price}</> : null}</span>
          </span>
          <span className="nh-deal-go">Gift it ↗</span>
        </a>
      )}

      <div className="nh-filters">
        <label className="nh-toggle"><input type="checkbox" checked={coopOnly} onChange={(e) => { sfx.click(); setCoopOnly(e.target.checked); }} /><span />Multiplayer/co-op only</label>
        <label className="nh-toggle"><input type="checkbox" checked={fresh} onChange={(e) => { sfx.click(); setFresh(e.target.checked); }} /><span />Not played in last 2 weeks</label>
        <button type="button" className={`nh-fchip ${blood ? 'on' : ''}`} aria-pressed={blood} onClick={() => { sfx.click(); setBlood((b) => !b); }}
          title="Only games nobody here has played yet">🩸 Fresh blood</button>
        <label className="nh-select">Group hours ≥
          <select value={minHours} aria-label="Minimum group hours" onChange={(e) => { sfx.click(); setMinHours(Number(e.target.value)); }}>
            <option value={0}>Any</option>
            <option value={10}>10h</option>
            <option value={50}>50h</option>
            <option value={100}>100h</option>
          </select>
        </label>
      </div>

      {state.poolLoading && <div className="nh-loading"><i className="nh-spin" /> Rifling through everyone's libraries…</div>}

      {empty && <div className="nh-empty">No games in common. Somebody's gotta buy something.</div>}

      {!empty && (
        <div className="nh-pool">
          {(all.length > 0 || !state.poolLoading) && (
            <section>
              <h3 className="nh-tier"><span>Everyone owns it</span> ready to ride <em>{all.length}</em></h3>
              {all.length ? <><div className="nh-grid">{capped(all, 'all').map(card)}</div>{moreBtn(all, 'all')}</>
                : <div className="nh-empty sm">{state.pool.some((g) => g.tier === 'all') ? 'Filters hid them all. Loosen up, partner.' : 'Nothing everybody owns.'}</div>}
            </section>
          )}
          {almost.length > 0 && (
            <section>
              <h3 className="nh-tier alt"><span>Almost</span> short a horse or two <em>{almost.length}</em></h3>
              <div className="nh-grid">{capped(almost, 'almost').map(card)}</div>{moreBtn(almost, 'almost')}
            </section>
          )}
        </div>
      )}

      <Pitches state={state} me={me} send={send} />

      <DockActions>
        <div className="dock-act dock-act-row">
          <span className={`nh-mycount ${myCount >= MAX_NOMS ? 'is-full' : ''}`} aria-label={`Your picks: ${myCount} of ${MAX_NOMS}`}>
            Your picks <b>{myCount}/{MAX_NOMS}</b>
          </span>
          {isHost ? (
            <button type="button" className="nh-btn nh-btn-big nh-btn-red" disabled={state.poolLoading && state.board.length === 0}
              title="Empty spots get dealt by the house (top shared games)."
              onClick={() => { sfx.unlock(); sfx.cock(); send({ t: 'beginVeto' }); }}>To the guns →</button>
          ) : <div className="nh-waiting"><i className="nh-spin" /> Waiting on the host…</div>}
        </div>
      </DockActions>
    </div>
  );
}
