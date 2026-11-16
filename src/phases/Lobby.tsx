import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Player } from '../../shared/types';
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
  if (!p.connected) return <span className="nh-chip off">Offline</span>;
  if (p.linking) return <span className="nh-chip wait"><i className="nh-spin" /> Checking…</span>;
  if (p.steam?.private) return <span className="nh-chip warn">Private library ⚠</span>;
  if (p.steam) return <span className="nh-chip ok">Linked ({p.steam.gameCount} games) ✓</span>;
  return <span className="nh-chip none">Not linked yet</span>;
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
  const canStart = ready.length >= 1;
  const steam = mine?.steam;

  const outfitSec = (
      <section className="nh-sec">
        <div className="nh-label">Your outfit</div>
        <div className="nh-me nh-me-look">
          {mine?.style ? <BustPreview look={mine.style} scale={1} className="nh-me-bust" /> : <Avatar p={mine} size={44} />}
          <div className="nh-me-txt"><b>{mine?.name}</b><span>{mine?.style ? 'Dressed for the occasion' : 'Still in travelling clothes'}</span></div>
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
              <span>{steam.private ? 'Library hidden' : `${steam.gameCount} games in the saddlebag`}</span>
            </div>
            <button type="button" className="nh-linkbtn" onClick={() => { sfx.click(); send({ t: 'unlink' }); }}>unlink</button>
          </div>
        )}
        {mine?.linkError && <div className="nh-err">{mine.linkError}</div>}
        {steam?.private && (
          <div className="nh-help">
            <b>Your game library is hidden.</b>
            <p>On Steam: <em>Profile → Edit Profile → Privacy Settings</em> → set <em>'Game details'</em> to <strong>Public</strong> (and untick <em>'Always keep my total playtime private'</em>). Then hit Re-check.</p>
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
            <div className="nh-sub">Pick your look. Everyone at the table sees it.</div>
          </header>
          <CharacterCreator initial={mine?.style} first={!mine?.style}
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

        </>
      )}

      <section className="nh-sec">
        <div className="nh-label">The posse <span className="nh-count">{state.players.length}</span></div>
        <ul className="nh-posse">
          {state.players.map((p) => (
            <li key={p.id} className={`${p.connected ? '' : 'is-off'} ${p.id === me ? 'is-me' : ''}`}>
              {p.style ? <span className="nh-posse-bust"><BustPreview look={p.style} scale={1} /></span> : <Avatar p={p} size={32} />}
              <span className="nh-pname">
                {p.name}{p.id === me && <small> (you)</small>}
                {p.host && <span className="nh-tag">HOST</span>}
              </span>
              <span className={`nh-dressed ${p.style ? 'on' : ''}`} title={p.style ? 'Dressed' : 'Still choosing an outfit'}>{p.style ? '✓ dressed' : '… dressing'}</span>
              <Status p={p} />
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
                {canStart
                  ? `${ready.length} of ${state.players.length} ready. Stragglers can still link later.`
                  : 'Somebody needs a linked, public Steam library before we deal.'}
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
