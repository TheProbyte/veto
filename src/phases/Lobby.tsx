import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS, emptyStats, type Player, type RoomState, type Settings } from '../../shared/types';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { DockActions } from '../scene/Dock';
import BustPreview from '../pixel/BustPreview';
import CharacterCreator from './CharacterCreator';
import './panels.css';

export function Avatar({ p, size = 32 }: { p?: Player; size?: number }) {
  const [bad, setBad] = useState(false);
  const initial = (p?.name || '?').trim().charAt(0).toUpperCase();
  if (p?.steam?.avatar && !bad) {
    return <img className="nh-av" src={p.steam.avatar} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" decoding="async" onError={() => setBad(true)} />;
  }
  return <span className="nh-av nh-av-blank" style={{ width: size, height: size, fontSize: size * 0.48 }}>{initial}</span>;
}

function Status({ p }: { p: Player }) {
  if (p.bot) return <span className="nh-chip bot">BOT</span>;
  if (!p.connected) return <span className="nh-chip off">Offline</span>;
  if (p.linking) return <span className="nh-chip wait"><i className="nh-spin" /> Checking…</span>;
  if (p.steam?.private) return <span className="nh-chip warn">Private ⚠</span>;
  if (p.steam) return <span className="nh-chip ok">{p.steam.gameCount} games ✓</span>;
  return <span className="nh-chip none">Not linked</span>;
}

const FINALES: { v: Settings['finale']; label: string; short: string }[] = [
  { v: 'slide', label: 'Whiskey slide', short: 'Whiskey slide' },
  { v: 'cylinder', label: 'Revolver roulette', short: 'Roulette' },
  { v: 'duel', label: 'Quick-draw duel', short: 'Duel' },
  { v: 'last', label: 'Last one standing', short: 'Last one standing' },
];
export const settingsOf = (state: Pick<RoomState, 'settings'>): Settings => ({ ...DEFAULT_SETTINGS, ...(state.settings || {}) });
const finaleAt = (f: Settings['finale']) => f === 'slide' || f === 'cylinder';
export function rulesSummary(s: Settings) {
  const short = FINALES.find((f) => f.v === s.finale)?.short ?? 'Whiskey slide';
  const fin = finaleAt(s.finale) ? `${short} at ${s.cylinderAt}` : short;
  const parts = [`${s.turnSecs}s`, `${s.picks} pick${s.picks === 1 ? '' : 's'}`, fin];
  if (s.nominations === 'draft') parts.push('Card draft');
  if (s.sheriff) parts.push('Sheriff');
  if (!s.explain) parts.push('Quiet barkeep');
  return parts.join(' · ');
}

/** Host-editable table rules (lobby + nominate before the deal). Non-hosts get a one-line summary. */
export function TableRules({ state, isHost: host, send, collapsible }: { state: RoomState; isHost: boolean; send: RoomProps['send']; collapsible?: boolean }) {
  const server = settingsOf(state);
  // the server lets anyone edit the rules while the host is away
  const isHost = host || !state.players.some((p) => p.host && p.connected);
  const [draft, setDraft] = useState<Settings>(server);
  const [open, setOpen] = useState(!collapsible);
  const pend = useRef<Partial<Settings> | null>(null);
  const t = useRef(0);
  const sendRef = useRef(send); sendRef.current = send;
  const flush = () => {
    clearTimeout(t.current);
    if (pend.current) { sendRef.current({ t: 'settings', settings: pend.current }); pend.current = null; }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  // follow the server unless I have an edit in flight
  const sk = `${server.turnSecs}|${server.picks}|${server.finale}|${server.cylinderAt}|${server.nominations}|${server.sheriff}|${server.explain}`;
  useEffect(() => { if (!pend.current) setDraft(server); }, [sk]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Settings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    pend.current = { ...(pend.current || {}), ...patch };
    clearTimeout(t.current);
    t.current = window.setTimeout(flush, 250);
  };
  const s = isHost ? draft : server;
  if (!isHost) {
    return <div className="nh-rules-ro"><span className="nh-rules-k">Table rules</span> {rulesSummary(server)}</div>;
  }
  const head = collapsible ? (
    <button type="button" className="nh-rules-toggle" aria-expanded={open} onClick={() => { sfx.click(); setOpen((o) => !o); }}>
      <span className="nh-rules-k">Table rules</span><span className="nh-rules-sum">{rulesSummary(s)}</span><i aria-hidden>{open ? '▴' : '▾'}</i>
    </button>
  ) : <div className="nh-label">Table rules</div>;
  return (
    <section className={`nh-sec nh-rules ${collapsible ? 'is-card' : ''}`}>
      {head}
      {open && (
        <div className="nh-rules-body">
          <label className="nh-rule-row">
            <span className="nh-rule-name">Turn timer</span>
            <input type="range" className="nh-range" min={10} max={90} step={5} value={s.turnSecs}
              onChange={(e) => set({ turnSecs: Number(e.target.value) })} aria-label="Turn timer in seconds" />
            <b className="nh-rule-val">{s.turnSecs}s</b>
          </label>
          <div className="nh-rule-row">
            <span className="nh-rule-name">Picks each</span>
            <div className="nh-seg" role="group" aria-label="Picks per player">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={s.picks === n ? 'on' : ''} aria-pressed={s.picks === n} onClick={() => { sfx.click(); set({ picks: n }); }}>{n}</button>
              ))}
            </div>
          </div>
          <div className="nh-rule-row nh-rule-wide">
            <span className="nh-rule-name">Finale</span>
            <div className="nh-seg nh-seg-wrap" role="group" aria-label="Finale">
              {FINALES.map((f) => (
                <button key={f.v} type="button" className={s.finale === f.v ? 'on' : ''} aria-pressed={s.finale === f.v} onClick={() => { sfx.click(); set({ finale: f.v }); }}>{f.label}</button>
              ))}
            </div>
          </div>
          {finaleAt(s.finale) && (
            <div className="nh-rule-row">
              <span className="nh-rule-name">Finale at</span>
              <div className="nh-seg" role="group" aria-label="Start the finale when this many games are left">
                {([3, 2] as const).map((n) => (
                  <button key={n} type="button" className={s.cylinderAt === n ? 'on' : ''} aria-pressed={s.cylinderAt === n} onClick={() => { sfx.click(); set({ cylinderAt: n }); }}>{n} left</button>
                ))}
              </div>
            </div>
          )}
          <div className="nh-rule-row nh-rule-wide">
            <span className="nh-rule-name">Nominations</span>
            <div className="nh-seg nh-seg-wrap" role="group" aria-label="How games get nominated">
              {([['browse', 'Browse the pool'], ['draft', 'Card draft']] as const).map(([v, label]) => (
                <button key={v} type="button" className={s.nominations === v ? 'on' : ''} aria-pressed={s.nominations === v} onClick={() => { sfx.click(); set({ nominations: v }); }}>{label}</button>
              ))}
            </div>
            {s.nominations === 'draft' && <small className="nh-rule-help">Dealt 5 cards: play, burn or trade</small>}
          </div>
          <div className="nh-rule-row nh-rule-wide">
            <span className="nh-rule-name">Sheriff</span>
            <div className="nh-seg" role="group" aria-label="Sheriff role">
              {([[false, 'Off'], [true, 'On']] as const).map(([v, label]) => (
                <button key={label} type="button" className={s.sheriff === v ? 'on' : ''} aria-pressed={s.sheriff === v} onClick={() => { sfx.click(); set({ sheriff: v }); }}>{label}</button>
              ))}
            </div>
            {s.sheriff && <small className="nh-rule-help">One Pardon, one Jail. The posse can vote 'em out.</small>}
          </div>
          <div className="nh-rule-row">
            <span className="nh-rule-name">Barkeep</span>
            <div className="nh-seg" role="group" aria-label="Barkeep explains each step">
              {([[true, 'Explains'], [false, 'Quiet']] as const).map(([v, label]) => (
                <button key={label} type="button" className={s.explain === v ? 'on' : ''} aria-pressed={s.explain === v} onClick={() => { sfx.click(); set({ explain: v }); }}>{label}</button>
              ))}
            </div>
          </div>
          {host && (
            <div className="nh-rule-row nh-rule-reset">
              <span className="nh-rule-name">Table history</span>
              <ResetBtn empty={!state.history.length && !(state.record?.rounds > 0)} onReset={() => send({ t: 'resetRecord' })} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** 2-step kick: first tap arms it, second tap kicks; disarms itself after a few seconds */
function KickBtn({ name, onKick }: { name: string; onKick: () => void }) {
  const [armed, setArmed] = useState(false);
  const t = useRef(0);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <button type="button" className={`nh-kick ${armed ? 'is-armed' : ''}`} aria-label={armed ? `Confirm kicking ${name}` : `Kick ${name}`}
      onClick={() => {
        sfx.unlock(); sfx.click();
        if (armed) { clearTimeout(t.current); setArmed(false); onKick(); return; }
        setArmed(true); clearTimeout(t.current); t.current = window.setTimeout(() => setArmed(false), 2600);
      }}>{armed ? 'Sure?' : 'Kick'}</button>
  );
}

/** 2-tap reset of the table's history + posse record (host only) */
function ResetBtn({ empty, onReset }: { empty: boolean; onReset: () => void }) {
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const t = useRef(0);
  useEffect(() => () => clearTimeout(t.current), []);
  useEffect(() => { if (!empty) setDone(false); }, [empty]);
  if (done && empty) return <span className="nh-reset-done">Wiped clean ✓</span>;
  return (
    <button type="button" className={`nh-btn nh-btn-sm nh-reset ${armed ? 'is-armed' : ''}`} disabled={empty}
      aria-label={armed ? 'Confirm: reset table history' : 'Reset table history'}
      onClick={() => {
        sfx.unlock(); sfx.click();
        clearTimeout(t.current);
        if (armed) { setArmed(false); setDone(true); onReset(); return; }
        setArmed(true); t.current = window.setTimeout(() => setArmed(false), 3000);
      }}>{empty ? 'Nothing to reset' : armed ? 'Tap again to wipe' : 'Reset history'}</button>
  );
}

function PosseRecordCard({ state }: { state: RoomState }) {
  const r = state.record;
  if (!r || !(r.rounds > 0)) return null;
  const top = r.wins?.[0];
  const dead = r.vetoers?.[0];
  return (
    <section className="nh-record" aria-label="This table's record">
      <span className="nh-rules-k">This table</span>
      <span><b>{r.rounds}</b> round{r.rounds === 1 ? '' : 's'}</span>
      {top && <span>Top pick: <b>{top.name}</b> ({top.count}×)</span>}
      {dead && dead.kills > 0 && <span>Deadliest: <b>{dead.name}</b> ({dead.kills} kill{dead.kills === 1 ? '' : 's'})</span>}
    </section>
  );
}

export default function Lobby({ state, me, send }: RoomProps) {
  const mine = state.players.find((p) => p.id === me);
  const host = state.players.find((p) => p.host);
  const isHost = !!mine?.host;
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState('');
  const copyT = useRef(0);
  useEffect(() => () => clearTimeout(copyT.current), []);
  // step 1 is the character creator until I've picked a look; local state so the save echo doesn't yank it mid hat-tip
  const [dressing, setDressing] = useState(() => !mine?.style);

  const copy = async () => {
    sfx.unlock(); sfx.click();
    const url = location.href;
    try { await navigator.clipboard.writeText(url); }
    catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      } catch { /* ignore */ }
    }
    setCopied(true);
    clearTimeout(copyT.current);
    copyT.current = window.setTimeout(() => setCopied(false), 1800);
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    sfx.unlock(); sfx.click();
    try { await navigator.share({ title: 'Nah.', text: 'Pull up a chair', url: location.href }); }
    catch { /* cancelled or unsupported */ }
  };

  const link = (e: FormEvent) => {
    e.preventDefault();
    const v = profile.trim();
    if (!v || mine?.linking) return;
    sfx.unlock(); sfx.cock();
    send({ t: 'link', profile: v });
  };

  const ready = state.players.filter((p) => p.steam && !p.steam.private);
  const bots = state.players.filter((p) => p.bot).length;
  const canStart = ready.length >= 1;
  const steam = mine?.steam;

  const outfitSec = (
      <section className="nh-sec">
        <div className="nh-label">Your outfit</div>
        <div className="nh-me nh-me-look">
          {mine?.style ? <span className="nh-me-bust"><BustPreview look={mine.style} scale={1} /></span> : <Avatar p={mine} size={44} />}
          <div className="nh-me-txt"><b>{mine?.name}</b></div>
          <button type="button" className="nh-btn nh-btn-sm" onClick={() => { sfx.unlock(); sfx.click(); setDressing(true); }}>Change outfit</button>
        </div>
      </section>
  );
  const steamSec = (
      <section className="nh-sec">
        <div className="nh-label">{steam ? 'Your Steam' : <>Step 2 of 2 <span className="nh-label-q">Link your Steam</span></>}</div>
        {!steam ? (
          <form className="nh-link" onSubmit={link}>
            <input className="nh-input" value={profile} onChange={(e) => setProfile(e.target.value)}
              placeholder="Steam profile URL or custom name" disabled={!!mine?.linking} spellCheck={false} autoComplete="off"
              inputMode="url" autoCapitalize="none" autoCorrect="off" enterKeyHint="go" aria-label="Steam profile URL or custom name" />
            <button type="submit" className="nh-btn nh-btn-sm" disabled={!profile.trim() || !!mine?.linking}>
              {mine?.linking ? <><i className="nh-spin" /> Linking</> : 'Link'}
            </button>
          </form>
        ) : (
          <div className="nh-me">
            <Avatar p={mine} size={44} />
            <div className="nh-me-txt">
              <b>{steam.name}</b>
              <span>{steam.private ? 'Library hidden' : `${steam.gameCount} games`}</span>
            </div>
            <button type="button" className="nh-linkbtn" onClick={() => { sfx.click(); send({ t: 'unlink' }); }}>unlink</button>
          </div>
        )}
        {mine?.linkError && <div className="nh-err">{mine.linkError}</div>}
        {steam?.private && (
          <div className="nh-help">
            <p><b>Library hidden.</b> Steam → <em>Edit Profile → Privacy</em>: set <em>Game details</em> to <strong>Public</strong>, then Re-check.</p>
            <button type="button" className="nh-btn nh-btn-sm" disabled={!!mine?.linking}
              onClick={() => { sfx.unlock(); sfx.cock(); send({ t: 'link', profile: steam.steamid }); }}>
              {mine?.linking ? <><i className="nh-spin" /> Checking</> : 'Re-check'}
            </button>
          </div>
        )}
      </section>
  );

  return (
    <div className="nh-panel nh-wood nh-lobby">
      <i className="nh-nail tl" /><i className="nh-nail tr" /><i className="nh-nail bl" /><i className="nh-nail br" />
      {dressing ? (
        <>
          <header className="nh-head">
            <div className="nh-kicker">Table {state.code} <span className="nh-step">Step 1 of 2</span></div>
            <h2 className="nh-h">Who are you, stranger?</h2>
          </header>
          <CharacterCreator initial={mine?.style} first={!mine?.style} stats={mine?.stats ?? emptyStats()}
            onSave={(style) => send({ t: 'style', style })} onDone={() => { setDressing(false); document.querySelector('.saloon-front')?.scrollTo({ top: 0 }); }} />
        </>
      ) : (
        <>
      <header className="nh-head">
        <div className="nh-kicker">Table {state.code}</div>
        <h2 className="nh-h">Round up the posse</h2>
      </header>

      {steam ? <>{outfitSec}{steamSec}</> : <>{steamSec}{outfitSec}</>}
      <section className="nh-sec">
        <div className="nh-label">Invite your crew</div>
        <div className={`nh-invite ${canShare ? 'can-share' : ''}`}>
          <span className="nh-invite-code" aria-label={`Table code ${state.code}`}>{state.code}</span>
          <input className="nh-input nh-input-mono nh-invite-url" readOnly value={location.href} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
          <button type="button" className={`nh-btn nh-btn-sm nh-copy ${copied ? 'is-done' : ''}`} onClick={copy}>{copied ? 'Copied!' : 'Copy invite'}</button>
          {canShare && <button type="button" className="nh-btn nh-btn-sm nh-share" onClick={share}>Share</button>}
        </div>
      </section>

      <TableRules state={state} isHost={isHost} send={send} />

      {isHost && (
        <section className="nh-sec nh-practice">
          <div className="nh-label">Practice table</div>
          <div className="nh-practice-row">
            <div className="nh-seg" role="group" aria-label="Hire practice bots">
              <span className="nh-seg-k">Hire</span>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" onClick={() => { sfx.unlock(); sfx.click(); send({ t: 'bots', n }); }} aria-label={`Hire ${n} practice bot${n === 1 ? '' : 's'}`}>{n}</button>
              ))}
            </div>
            {bots > 0 && (
              <button type="button" className="nh-btn nh-btn-sm nh-bots-home" onClick={() => { sfx.unlock(); sfx.whoosh(); send({ t: 'bots', n: 0 }); }}>
                Send bots home ({bots})
              </button>
            )}
          </div>
        </section>
      )}

      <PosseRecordCard state={state} />
        </>
      )}

      <section className="nh-sec">
        <div className="nh-label">The posse <span className="nh-count">{state.players.length}</span></div>
        <ul className="nh-posse">
          {state.players.map((p) => (
            <li key={p.id} className={`${p.connected || p.bot ? '' : 'is-off'} ${p.id === me ? 'is-me' : ''} ${p.bot ? 'is-bot' : ''}`}>
              {p.style ? <span className="nh-posse-bust"><BustPreview look={p.style} scale={1} /></span> : <Avatar p={p} size={32} />}
              <span className="nh-pname">
                {p.name}{p.id === me && <small> (you)</small>}
                {p.host && <span className="nh-tag">HOST</span>}
              </span>
              <span className={`nh-dressed ${p.style ? 'on' : ''}`} title={p.style ? 'Dressed' : 'Still choosing an outfit'}>{p.style ? '✓ dressed' : '… dressing'}</span>
              <Status p={p} />
              {isHost && p.id !== me && (p.bot || !p.connected) && <KickBtn name={p.name} onKick={() => send({ t: 'kick', pid: p.id })} />}
            </li>
          ))}
        </ul>
      </section>

      {!dressing && (
        <DockActions>
          {isHost ? (
            <div className="dock-act">
              <button type="button" className="nh-btn nh-btn-big" disabled={!canStart} onClick={() => { sfx.unlock(); sfx.cock(); send({ t: 'start' }); }}>
                Deal 'em in →
              </button>
              <div className="nh-hint">
                {canStart ? `${ready.length}/${state.players.length} linked` : 'Link a public Steam library first'}
              </div>
            </div>
          ) : (
            <div className="nh-waiting"><i className="nh-spin" /> Waiting on {host?.name ?? 'the host'} to deal…</div>
          )}
        </DockActions>
      )}
    </div>
  );
}
