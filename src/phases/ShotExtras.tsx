// Shot "extras" layered over the scene's ShotFX: revenge slam, hidden-star reveal, last words, slow motion.
// Rendered into a body-level root so it survives a phase flip (the finale shot can end the veto phase).
import { useEffect, useState, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RoomState, ShotEvent } from '../../shared/types';
import { PixelArt } from '../pixel/PixelCanvas';
import { FINE_H, FINE_W } from '../pixel/pixelize';
import TinStar from '../scene/TinStar';
import { sfx } from '../sfx';
import './gameplay.css';

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** heartbeat thump (sfx.heartbeat if the sound agent added one, else a soft wooden thunk) */
export function heartbeat() {
  const h = (sfx as unknown as { heartbeat?: () => void }).heartbeat;
  if (typeof h === 'function') h(); else sfx.stamp();
}

let handled = '';
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let clearT = 0;

function mount(node: JSX.Element, ms: number) {
  if (!host) { host = document.createElement('div'); host.className = 'gpx-host'; document.body.appendChild(host); }
  if (!root) root = createRoot(host);
  root.render(node);
  clearTimeout(clearT);
  clearT = window.setTimeout(() => root?.render(<></>), ms);
}

/** Call from any phase component (and the always-mounted EmoteBar): plays the extras for a fresh lastShot once. */
export function useShotExtras(state: RoomState, skew: number) {
  const s = state.lastShot;
  const key = s ? `${s.id}:${s.t}` : '';
  useEffect(() => {
    if (!s || key === handled) return;
    handled = key;
    if (Date.now() + skew - s.t > 2500) return; // stale: reload / late join
    const special = s.slowmo || s.revenge || (s.kind === 'ricochet' && s.shieldOwner) || s.lastWords;
    if (!special) return;
    const nameOf = (id?: string) => state.players.find((p) => p.id === id)?.name ?? 'Someone';
    const game = state.board.find((g) => g.appid === s.appid);
    const words = s.lastWords ?? (s.kind === 'hit' || s.kind === 'misfire' ? game?.lastWords : undefined);
    const reduce = reduced();
    const slowMs = s.slowmo ? (reduce ? 1100 : 1800) : 0;
    const wordsAt = s.slowmo ? 500 : 300;
    const wordsMs = 2800; // the server waits 3.2s before the next fuse: room to read
    const total = Math.max(slowMs + 100, words ? wordsAt + wordsMs + 100 : 0, s.revenge ? 1800 : 0, s.kind === 'ricochet' ? 2100 : 0);
    if (s.slowmo && !reduce) { heartbeat(); window.setTimeout(heartbeat, 620); window.setTimeout(heartbeat, 1240); }
    mount(
      <Extras key={key} shot={s} name={game?.name ?? 'that one'} actor={nameOf(s.actor)} owner={s.shieldOwner ? nameOf(s.shieldOwner) : ''}
        words={words} slowMs={slowMs} wordsAt={wordsAt} wordsMs={wordsMs} />,
      total,
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

const SHARDS = Array.from({ length: 14 }, (_, i) => ({ a: i * 26 + ((i * 19) % 11), d: 50 + ((i * 41) % 90) }));

function Extras({ shot, name, actor, owner, words, slowMs, wordsAt, wordsMs }: {
  shot: ShotEvent; name: string; actor: string; owner: string; words?: string; slowMs: number; wordsAt: number; wordsMs: number;
}) {
  const [showWords, setShowWords] = useState(false);
  useEffect(() => {
    if (!words) return;
    const t = window.setTimeout(() => setShowWords(true), wordsAt);
    return () => clearTimeout(t);
  }, [words, wordsAt]);
  const rico = shot.kind === 'ricochet';
  return (
    <div className="gpx" aria-live="polite">
      {slowMs > 0 && (
        <div className="gpx-slow" style={{ '--sd': `${slowMs}ms` } as CSSProperties}>
          <div className="gpx-slow-label">{name} · last one out</div>
          <div className="gpx-slow-box">
            <div className="gpx-half gpx-l"><PixelArt appid={shot.appid} name={name} w={FINE_W} h={FINE_H} /></div>
            <div className="gpx-half gpx-r"><PixelArt appid={shot.appid} name={name} w={FINE_W} h={FINE_H} /></div>
            <div className="gpx-shards">{SHARDS.map((x, i) => <i key={i} style={{ '--a': `${x.a}deg`, '--d': `${x.d}px` } as CSSProperties} />)}</div>
            <div className="gpx-bullet" />
            <div className="gpx-slow-stamp">NAH.</div>
          </div>
        </div>
      )}
      {shot.revenge && !rico && (
        <div className="gpx-revenge" style={slowMs ? { animationDelay: '300ms' } : undefined}>REVENGE!<small>{actor} settles the score</small></div>
      )}
      {rico && owner && (
        <div className="gpx-reveal px-box"><TinStar size={30} /><span><b>{owner}</b>'s hidden star!</span></div>
      )}
      {words && showWords && <LastWords text={words} name={name} ms={wordsMs} slow={slowMs > 0} />}
    </div>
  );
}

/** pixel speech bubble with a typewriter line */
export function LastWords({ text, name, ms, slow }: { text: string; name: string; ms: number; slow?: boolean }) {
  const [n, setN] = useState(() => (reduced() ? text.length : 0));
  useEffect(() => {
    if (n >= text.length) return;
    // a touch slower than before, but every quip is fully typed by ~1.3s so the rest of the bubble's life is reading time
    const step = Math.max(18, Math.min(55, 1300 / Math.max(1, text.length)));
    const t = window.setTimeout(() => setN((k) => k + 1), step);
    if (n % 3 === 0) sfx.click();
    return () => clearTimeout(t);
  }, [n, text]);
  return (
    <div className={`gpx-words ${slow ? 'slow' : ''}`} style={{ '--wd': `${ms}ms` } as CSSProperties}>
      <small>{name}:</small>
      {text.slice(0, n)}<span className="caret">{n < text.length ? '▌' : ''}</span>
    </div>
  );
}
