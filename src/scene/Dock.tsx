import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BoardGame, Player } from '../../shared/types';
import { sfx } from '../sfx';
import Cover from './Cover';
import { Avatar } from '../phases/Lobby';

/** Optional sound hooks the audio agent adds; returns false when the sound does not exist (yet). */
export function play(name: string): boolean {
  try {
    const f = (sfx as unknown as Record<string, unknown>)[name];
    if (typeof f === 'function') { (f as () => void).call(sfx); return true; }
  } catch { /* ignore */ }
  return false;
}

const reduced = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/* ---------- the action slot: phases portal their main buttons into the dock ---------- */
export const DockSlot = createContext<HTMLElement | null>(null);
export function DockActions({ children }: { children: ReactNode }) {
  const el = useContext(DockSlot);
  return el ? createPortal(children, el) : null;
}

/* ---------- card flights: list card -> dock ---------- */
const pending = new Map<number, { rect: DOMRect; at: number }>();
/** Call right before sending a nomination of my own: the dock card flies in from `from`. */
export function launchCard(appid: number, from: Element | null | undefined) {
  if (!from) return;
  pending.set(appid, { rect: from.getBoundingClientRect(), at: performance.now() });
}

function cloneWithCanvases(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  const src = el.querySelectorAll('canvas');
  const dst = c.querySelectorAll('canvas');
  src.forEach((s, i) => {
    const d = dst[i];
    if (!d) return;
    d.width = s.width; d.height = s.height;
    try { d.getContext('2d')?.drawImage(s, 0, 0); } catch { /* tainted */ }
  });
  return c;
}

function fly(card: HTMLElement, from: DOMRect, done: () => void) {
  const to = card.getBoundingClientRect();
  if (!to.width || reduced()) { done(); return; }
  const ghost = cloneWithCanvases(card);
  ghost.classList.add('dock-ghost');
  Object.assign(ghost.style, { position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, margin: '0', zIndex: '95', pointerEvents: 'none' });
  document.body.appendChild(ghost);
  const s = Math.max(0.6, Math.min(3, from.width / to.width));
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const lift = Math.min(160, Math.abs(dy) * 0.45 + 40);
  card.style.visibility = 'hidden';
  const a = ghost.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-6deg)`, opacity: 0.9 },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(${(s + 1) / 2 + 0.15}) rotate(10deg)`, opacity: 1, offset: 0.5 },
    { transform: 'translate(0, -4px) scale(1.12) rotate(-3deg)', offset: 0.86 },
    { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
  ], { duration: 560, easing: 'cubic-bezier(.3,.1,.4,1)' });
  const end = () => { ghost.remove(); card.style.visibility = ''; done(); };
  a.onfinish = end; a.oncancel = end;
}

/* ---------- the dealer's table ---------- */
interface Shown { g: BoardGame; leaving?: boolean }

function DockCard({ g, leaving, byId, me }: { g: BoardGame; leaving?: boolean; byId: Map<string, Player>; me: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [landed, setLanded] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const p = pending.get(g.appid);
    pending.delete(g.appid);
    if (!el) return;
    if (p && performance.now() - p.at < 2000) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      fly(el, p.rect, () => { if (!play('cardSlap')) sfx.stamp(); setLanded(true); });
    } else setLanded(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = g.by.includes(me);
  return (
    <div ref={ref} className={`dock-card ${leaving ? 'is-leaving' : ''} ${landed ? 'is-landed' : ''} ${mine ? 'is-mine' : ''} ${g.tier === 'pitch' ? 'is-pitch' : ''}`} title={g.name}>
      <div className="dock-card-art"><Cover appid={g.appid} name={g.name} kind="box" />{g.tier === 'pitch' && <span className="dock-ptag">$</span>}</div>
      <div className="dock-card-by">
        {g.by.length ? g.by.slice(0, 3).map((id) => <Avatar key={id} p={byId.get(id)} size={14} />) : <small>house</small>}
        {g.by.length > 3 && <small>+{g.by.length - 3}</small>}
      </div>
    </div>
  );
}

export function DockBoard({ board, players, me }: { board: BoardGame[]; players: Player[]; me: string }) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const prev = useRef<BoardGame[]>(board);
  const [leaving, setLeaving] = useState<BoardGame[]>([]);
  useLayoutEffect(() => {
    const now = new Set(board.map((b) => b.appid));
    const gone = prev.current.filter((b) => !now.has(b.appid));
    prev.current = board;
    if (!gone.length) return;
    setLeaving((l) => [...l.filter((x) => !now.has(x.appid) && !gone.some((g) => g.appid === x.appid)), ...gone]);
    const t = window.setTimeout(() => setLeaving((l) => l.filter((x) => !gone.some((g) => g.appid === x.appid))), 380);
    return () => clearTimeout(t);
  }, [board]);
  const shown: Shown[] = [...board.map((g) => ({ g })), ...leaving.filter((x) => !board.some((b) => b.appid === x.appid)).map((g) => ({ g, leaving: true }))];
  return (
    <div className="dock-board">
      <div className="dock-label">On the table <b>{board.length}</b></div>
      {shown.length === 0 ? <div className="dock-empty">Felt's bare. Toss something in.</div> : (
        <div className="dock-row">
          {shown.map(({ g, leaving: l }) => <DockCard key={g.appid} g={g} leaving={l} byId={byId} me={me} />)}
        </div>
      )}
    </div>
  );
}
