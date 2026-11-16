import { useMemo, useState } from 'react';
import { boxArt, headerArt, MAX_NOMS, type PoolGame, type Player } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { Avatar } from './Lobby';
import Pitches from './Pitches';
import './panels.css';

function Art({ appid, kind }: { appid: number; kind: 'box' | 'header' }) {
  const [stage, setStage] = useState(kind === 'box' ? 0 : 1); // 0 box, 1 header, 2 hidden
  if (stage === 2) return <span className="nh-art-miss" />;
  return <img className="nh-art" loading="lazy" alt="" src={stage === 0 ? boxArt(appid) : headerArt(appid)}
    onError={() => setStage((s) => s + 1)} />;
}

function hrs(h: number) {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k`;
  return `${Math.round(h)}`;
}

export default function Nominate({ state, me, send }: RoomProps) {
  const [coopOnly, setCoopOnly] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [minHours, setMinHours] = useState(0);
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const isHost = !!byId.get(me)?.host;

  const nomBy = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const b of state.board) m.set(b.appid, b.by);
    return m;
  }, [state.board]);
  const myCount = state.board.filter((b) => b.by.includes(me)).length;

  const visible = state.pool.filter((g) => !(coopOnly && g.coop === false) && !(fresh && g.recent) && g.hours >= minHours);
  const all = visible.filter((g) => g.tier === 'all');
  const almost = visible.filter((g) => g.tier === 'almost');

  const toggle = (g: PoolGame) => {
    const mineNow = (nomBy.get(g.appid) || []).includes(me);
    if (!mineNow && myCount >= MAX_NOMS) { sfx.click(); return; }
    sfx.unlock();
    if (mineNow) sfx.whoosh(); else sfx.stamp();
    send({ t: 'nominate', appid: g.appid });
  };

  const card = (g: PoolGame) => {
    const by = nomBy.get(g.appid) || [];
    const mine = by.includes(me);
    const others = by.filter((id) => id !== me).map((id) => byId.get(id)).filter(Boolean) as Player[];
    const full = !mine && myCount >= MAX_NOMS;
    return (
      <button key={g.appid} type="button" className={`nh-game ${mine ? 'is-mine' : ''} ${by.length ? 'is-nom' : ''} ${full ? 'is-full' : ''}`}
        onClick={() => toggle(g)} aria-pressed={mine} title={g.name}>
        <div className="nh-game-art"><Art appid={g.appid} kind="header" />
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

      <div className="nh-filters">
        <label className="nh-toggle"><input type="checkbox" checked={coopOnly} onChange={(e) => { sfx.click(); setCoopOnly(e.target.checked); }} /><span />Multiplayer/co-op only</label>
        <label className="nh-toggle"><input type="checkbox" checked={fresh} onChange={(e) => { sfx.click(); setFresh(e.target.checked); }} /><span />Not played in last 2 weeks</label>
        <label className="nh-select">Group hours ≥
          <select value={minHours} onChange={(e) => { sfx.click(); setMinHours(Number(e.target.value)); }}>
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
              {all.length ? <div className="nh-grid">{all.map(card)}</div>
                : <div className="nh-empty sm">{state.pool.some((g) => g.tier === 'all') ? 'Filters hid them all. Loosen up, partner.' : 'Nothing everybody owns.'}</div>}
            </section>
          )}
          {almost.length > 0 && (
            <section>
              <h3 className="nh-tier alt"><span>Almost</span> short a horse or two <em>{almost.length}</em></h3>
              <div className="nh-grid">{almost.map(card)}</div>
            </section>
          )}
        </div>
      )}

      <Pitches state={state} me={me} send={send} />

      <section className="nh-board">
        <div className="nh-label">On the table <span className="nh-count">{state.board.length}</span></div>
        {state.board.length === 0 ? <div className="nh-board-empty">Felt's bare. Toss something in.</div> : (
          <div className="nh-strip">
            {state.board.map((b) => (
              <div key={b.appid} className={`nh-box ${b.tier === 'pitch' ? 'is-pitch' : ''}`} title={b.name}>
                <div className="nh-box-art"><Art appid={b.appid} kind="box" /><span className="nh-box-name">{b.name}</span>
                  {b.tier === 'pitch' && <span className="nh-ptag">PITCH</span>}</div>
                <div className="nh-box-by">
                  {b.by.length ? b.by.map((id) => <Avatar key={id} p={byId.get(id)} size={16} />) : <small>house</small>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="nh-foot">
        {isHost ? (
          <>
            <button className="nh-btn nh-btn-big nh-btn-red" disabled={state.poolLoading && state.board.length === 0}
              onClick={() => { sfx.unlock(); sfx.cock(); send({ t: 'beginVeto' }); }}>To the guns →</button>
            <div className="nh-hint">Empty spots get dealt by the house (top shared games).</div>
          </>
        ) : <div className="nh-waiting"><i className="nh-spin" /> Waiting on the host…</div>}
      </footer>
    </div>
  );
}
