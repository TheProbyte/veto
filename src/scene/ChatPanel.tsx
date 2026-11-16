// Desktop chat: an always-open side panel (the emote buttons and a log of emotes + the barkeep's lines). No typed text.
// EmoteBar owns the cooldowns + the event subscription and renders this on wide, mouse-driven screens.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import { EMOTES, type EmoteId, type Look, type RoomEvent } from '../../shared/types';
import { MiniBust } from '../pixel/BustPreview';
import { computeLayout } from '../pixel/scene';
import { PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import type { DrawFn } from '../pixel/sprites';
import { sfx } from '../sfx';
import PixelIcon from '../ui/PixelIcon';

/** 13x11 pixel speech bubble with three dots */
export const drawBubble: DrawFn = (c) => {
  c.fillStyle = PAL.ink;
  c.fillRect(1, 0, 11, 1); c.fillRect(0, 1, 1, 6); c.fillRect(12, 1, 1, 6); c.fillRect(1, 7, 11, 1);
  c.fillRect(2, 8, 1, 2); c.fillRect(3, 8, 1, 1); c.fillRect(1, 10, 1, 1);
  c.fillStyle = PAL.parch; c.fillRect(1, 1, 11, 6); c.fillRect(2, 7, 2, 1); c.fillRect(2, 8, 1, 1);
  c.fillStyle = PAL.parch2; c.fillRect(1, 6, 11, 1);
  c.fillStyle = PAL.wood2; c.fillRect(3, 3, 2, 2); c.fillRect(6, 3, 2, 2); c.fillRect(9, 3, 2, 2);
};

/* ---------- desktop + open/collapsed (shared by Saloon for layout and EmoteBar for rendering) ---------- */
const DESK_Q = '(min-width: 1024px) and (pointer: fine)';
const KEY = 'nah.chat';
let open = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** opened by hand while the slide had it tucked away (lasts until collapsed or the next phase) */
let peek = false;
export function setChatOpen(v: boolean) {
  if (peek !== v) { peek = v; emit(); }
  if (v === open) return;
  open = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch {}
  emit();
}
const subOpen = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const subDesk = (f: () => void) => {
  let m: MediaQueryList | null = null;
  try { m = window.matchMedia(DESK_Q); } catch { return () => {}; }
  m.addEventListener?.('change', f);
  return () => m?.removeEventListener?.('change', f);
};
const isDesk = () => { try { return window.matchMedia(DESK_Q).matches; } catch { return false; } };

const subWide = (f: () => void) => { window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); };
/** the whiskey slide's bar spans most of the screen: below this width the panel tucks itself away for it */
const SLIDE_MIN_W = 1600;
const wideForSlide = () => window.innerWidth >= SLIDE_MIN_W;

/** { desk: wide screen with a mouse, open: the panel is expanded (tucked, not closed, while the slide needs the room) } */
export function useDeskChat(phase?: string) {
  const desk = useSyncExternalStore(subDesk, isDesk, () => false);
  const o = useSyncExternalStore(subOpen, () => open, () => true);
  const wide = useSyncExternalStore(subWide, wideForSlide, () => true);
  const pk = useSyncExternalStore(subOpen, () => peek, () => false);
  useEffect(() => { if (peek) { peek = false; emit(); } }, [phase]);
  return { desk, open: o && (phase !== 'slide' || wide || pk) };
}

/* ---------- the log ---------- */
export interface LogEntry {
  id: number; kind: 'emote' | 'narrate'; at: number; text: string;
  who?: { id: string; name: string; look: number; style?: Look; bot?: boolean; me: boolean };
}
const LOG_MAX = 80;
// seeded from the clock so ids stay unique even if this module is re-evaluated (hot reload) under a live log
let logSeq = Date.now();

/** collects emote / narrate events (with a snapshot of who sent them); typed 'say' lines are ignored */
export function useChatLog({ on, state, me }: RoomProps) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const players = useRef(state.players);
  players.current = state.players;
  useEffect(() => on((e: RoomEvent) => {
    let ent: LogEntry | null = null;
    if (e.t === 'narrate') ent = { id: ++logSeq, kind: 'narrate', at: e.at || Date.now(), text: String(e.text) };
    else if (e.t === 'emote' && e.emote in EMOTES) {
      const p = players.current.find((x) => x.id === e.pid);
      const who = p ? { id: p.id, name: p.name, look: p.look, style: p.style, bot: p.bot, me: p.id === me } : undefined;
      ent = { id: ++logSeq, kind: 'emote', at: e.at || Date.now(), text: e.emote, who };
    }
    if (ent) { const x = ent; setLog((l) => [...l.slice(-(LOG_MAX - 1)), x]); }
  }), [on, me]);
  return log;
}

/** what an emote reads like in the log */
const EMOTE_LOG: Record<string, string> = {
  tip: 'tips hat', spit: 'spits', laugh: 'laughs', yeehaw: 'hollers', clap: 'slow claps', shrug: 'shrugs', angry: 'fumes', drink: 'drinks',
};

/** top of the phase UI (same as Saloon's --stage-top): the panel starts a nameplate's height below it */
const stageTop = () => { const L = computeLayout(window.innerWidth, window.innerHeight); return L.tableTop * L.P + (L.portrait ? 30 : 44); };
function useStageTop() {
  const [t, setT] = useState(stageTop);
  useEffect(() => { const on = () => setT(stageTop()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  return t;
}

const time = (t: number) => { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

/* ---------- the panel ---------- */
export default function ChatPanel({ log, emote, emoteCool, open: isOpen, focusKey }: {
  log: LogEntry[]; emote: (id: EmoteId) => void; emoteCool: boolean; open: boolean; focusKey: number;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef(log.length ? log[log.length - 1].id : 0);
  const [unread, setUnread] = useState(0);
  const top = useStageTop();

  // E (from EmoteBar) opens the panel (or collapses it again); a remount with an already-handled key does nothing
  const handledKey = useRef(focusKey);
  useEffect(() => {
    if (!focusKey || focusKey === handledKey.current) return;
    handledKey.current = focusKey;
    setChatOpen(!isOpen);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the log pinned to the newest line (unless you scrolled up); count unread while collapsed
  useLayoutEffect(() => {
    const last = log.length ? log[log.length - 1].id : 0;
    if (isOpen) {
      seen.current = last; setUnread(0);
      const el = logRef.current;
      if (el && stick.current) el.scrollTop = el.scrollHeight;
    } else {
      setUnread(log.filter((l) => l.id > seen.current && l.kind !== 'narrate').length);
    }
  }, [log, isOpen]);

  // Space on a focused emote button belongs to the game (FIRE, BANG, slide), not to the button
  const btnKeys = {
    onKeyDown: (e: RKeyboardEvent) => { if (e.key === ' ') e.preventDefault(); },
    onKeyUp: (e: RKeyboardEvent) => { if (e.key === ' ') e.preventDefault(); },
  };
  const blurAfter = (e: RMouseEvent<HTMLButtonElement>) => { if (e.detail > 0) e.currentTarget.blur(); };

  if (!isOpen) {
    return createPortal(
      <button type="button" className="chat-tab" onClick={() => { sfx.click(); setChatOpen(true); }} aria-label={`Open emotes${unread ? ` (${unread} new)` : ''}`} title="Emotes (E)" {...btnKeys}>
        <PixelSprite draw={drawBubble} w={13} h={11} className="chat-tab-ico" />
        <span className="chat-tab-txt">Emotes</span>
        {unread > 0 && <span className="chat-tab-n">{unread > 9 ? '9+' : unread}</span>}
      </button>,
      document.body,
    );
  }

  return createPortal(
    // pointer presses stay in the panel (a click here is never a duel BANG)
    <aside className="chat px-box" aria-label="Emotes" style={{ '--stage-top': `${top}px` } as CSSProperties} onPointerDown={(e) => e.stopPropagation()}>
      <div className="chat-head">
        <span className="chat-title">Emotes</span>
        <span className="chat-key" aria-hidden>E</span>
        <button type="button" className="chat-min" onClick={(e) => { blurAfter(e); setChatOpen(false); }} aria-label="Collapse emotes" title="Collapse" {...btnKeys}>◂</button>
      </div>
      <div className="chat-emotes" role="group" aria-label="Emotes">
        {(Object.keys(EMOTES) as EmoteId[]).map((id) => (
          <button key={id} type="button" className="chat-e px-btn" disabled={emoteCool} onClick={(e) => { blurAfter(e); emote(id); }} title={EMOTES[id].label} aria-label={EMOTES[id].label} {...btnKeys}>
            <span className="chat-e-ico" aria-hidden><PixelIcon name={id} /></span>
            <span className="chat-e-lbl">{EMOTES[id].label}</span>
          </button>
        ))}
      </div>
      <div className="chat-log" ref={logRef} role="log" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {!log.length && <div className="chat-empty">Quiet in here.</div>}
        {log.map((l) => <Line key={l.id} l={l} />)}
      </div>
    </aside>,
    document.body,
  );
}

function Line({ l }: { l: LogEntry }) {
  if (l.kind === 'narrate') {
    return <div className="chat-line is-narr" title={time(l.at)}><span className="chat-who">Barkeep</span><span className="chat-txt">{l.text}</span></div>;
  }
  const w = l.who;
  const name = w ? (w.me ? 'You' : w.name) : 'Someone';
  return (
    <div className={`chat-line is-${l.kind} ${w?.me ? 'is-me' : ''}`} title={time(l.at)}>
      {w ? <MiniBust p={{ id: w.id, look: w.look, style: w.style, bot: w.bot }} className="chat-bust" style={{ height: 30, width: 'auto' } as CSSProperties} /> : <span className="chat-bust" />}
      <div className="chat-body">
        <span className="chat-who">{name}</span>
        <span className="chat-txt chat-act"><i aria-hidden><PixelIcon name={l.text} /></i> {EMOTE_LOG[l.text] ?? l.text}</span>
      </div>
    </div>
  );
}
