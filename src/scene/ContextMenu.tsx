// Themed right-click menu (mouse / pen only). Native menu stays in text fields and on touch long-press.
// Mount <ContextMenu /> on the home page and <ContextMenu room={props} /> in a room; only the most
// recently mounted instance answers, so both can be mounted at once.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import { EMOTES, TAUNTS, type EmoteId } from '../../shared/types';
import { sfx } from '../sfx';
import PixelIcon from '../ui/PixelIcon';

/* ---------- tiny pixel icons (8x8 grids -> crisp SVG) ---------- */
const ICONS: Record<string, string[]> = {
  link: ['........', '..##....', '.#..#...', '.#..#.#.', '..#.#..#', '...#...#', '....#..#', '.....##.'],
  sound: ['....#...', '...##.#.', '.####..#', '.####.#.', '.####..#', '...##.#.', '....#...', '........'],
  mute: ['....#...', '...##...', '.####.#.', '.####..#', '.####.#.', '...##..#', '....#...', '........'],
  emote: ['..####..', '.#....#.', '#.#..#.#', '#......#', '#.#..#.#', '#..##..#', '.#....#.', '..####..'],
  say: ['.######.', '#......#', '#.#.#.##', '#......#', '.######.', '..#.....', '.#......', '........'],
  full: ['###..###', '#......#', '#......#', '........', '........', '#......#', '#......#', '###..###'],
  exit: ['..#..#..', '..#..#..', '###..###', '........', '........', '###..###', '..#..#..', '..#..#..'],
  reload: ['..####.#', '.#....##', '#....###', '#.......', '#.......', '#......#', '.#....#.', '..####..'],
  copied: ['........', '.......#', '......#.', '#....#..', '.#..#...', '..##....', '........', '........'],
};
function Ico({ name }: { name: string }) {
  const g = ICONS[name];
  if (!g) return <span className="cm-ico" aria-hidden>{name}</span>;
  return (
    <svg className="cm-ico" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      {g.flatMap((row, y) => [...row].map((ch, x) => (ch === '#' ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null)))}
    </svg>
  );
}

/* ---------- one instance answers (the newest mounted) ---------- */
const stack: number[] = [];
let seq = 0;
let lastPointer = { type: 'mouse', at: 0 };
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { lastPointer = { type: e.pointerType, at: Date.now() }; }, true);
}
const textField = (t: EventTarget | null) => {
  const el = t instanceof Element ? t : null;
  return !!el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
};

interface Item { id: string; label: string; icon: string; run?: () => void | boolean; sub?: Item[]; disabled?: boolean }

export function ContextMenu({ room }: { room?: RoomProps }) {
  const [at, setAt] = useState<{ x: number; y: number; key: number } | null>(null);
  const [subOpen, setSubOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, force] = useState(0);
  const id = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const kbSub = useRef(false); // submenu opened from the keyboard: focus its first item
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    id.current = ++seq;
    stack.push(id.current);
    const onCtx = (e: MouseEvent) => {
      if (stack[stack.length - 1] !== id.current) return;
      if (textField(e.target)) return; // keep copy / paste / spellcheck
      // touch long-press keeps the platform's own behaviour
      const pt = (e as MouseEvent & { pointerType?: string }).pointerType;
      if (pt === 'touch' || (lastPointer.type === 'touch' && Date.now() - lastPointer.at < 2000)) return;
      if ((e.target as Element | null)?.closest?.('.cm')) { e.preventDefault(); return; }
      e.preventDefault();
      let x = e.clientX, y = e.clientY;
      if (!x && !y && document.activeElement && document.activeElement !== document.body) {
        // keyboard (Menu key / Shift+F10): open by the focused element
        const r = document.activeElement.getBoundingClientRect();
        x = r.left + Math.min(24, r.width / 2); y = r.bottom;
      }
      prevFocus.current = document.activeElement;
      setCopied(false);
      setSubOpen(null);
      setAt({ x, y, key: Date.now() });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => {
      document.removeEventListener('contextmenu', onCtx);
      const i = stack.indexOf(id.current);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);

  const close = (restore = true) => {
    setAt(null); setSubOpen(null);
    const p = prevFocus.current as HTMLElement | null;
    if (restore && p && typeof p.focus === 'function' && document.contains(p)) p.focus({ preventScroll: true });
  };

  const fsOk = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const items: Item[] = [];
  if (room) {
    items.push({
      id: 'copy', label: copied ? 'Copied!' : 'Copy invite link', icon: copied ? 'copied' : 'link',
      run: () => {
        const url = `${location.origin}/r/${room.state.code}`;
        const done = () => { setCopied(true); window.setTimeout(() => close(), 650); };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => { window.prompt('Invite link', url); close(); });
        else { window.prompt('Invite link', url); close(); }
        return true; // keep open for the "Copied!" flash
      },
    });
  }
  const muted = sfx.isMuted();
  items.push({ id: 'mute', label: muted ? 'Unmute' : 'Mute', icon: muted ? 'sound' : 'mute', run: () => { sfx.unlock(); sfx.setMuted(!sfx.isMuted()); force((n) => n + 1); } });
  if (room) {
    items.push({
      id: 'emote', label: 'Emote', icon: 'emote',
      sub: (Object.keys(EMOTES) as EmoteId[]).map((k) => ({ id: `e-${k}`, label: EMOTES[k].label, icon: `px:${k}`, run: () => roomRef.current?.send({ t: 'emote', emote: k }) })),
    });
    items.push({
      id: 'say', label: 'Say a taunt', icon: 'say',
      sub: TAUNTS.map((t, i) => ({ id: `t-${i}`, label: t, icon: '', run: () => roomRef.current?.send({ t: 'say', text: t }) })),
    });
  }
  if (fsOk) {
    const fs = !!document.fullscreenElement;
    items.push({
      id: 'fs', label: fs ? 'Exit fullscreen' : 'Fullscreen', icon: fs ? 'exit' : 'full',
      run: () => { (fs ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); },
    });
  }
  items.push({ id: 'reload', label: 'Reload', icon: 'reload', run: () => location.reload() });

  const activate = (it: Item) => {
    if (it.disabled) return;
    if (it.sub) { setSubOpen(it.id); return; }
    sfx.click();
    const keep = it.run?.();
    if (keep !== true) close();
  };

  // position inside the viewport
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [subPos, setSubPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!at) { setPos(null); return; }
    const el = menuRef.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, m = 8;
    setPos({ x: Math.max(m, Math.min(at.x, vw - w - m)), y: Math.max(m, Math.min(at.y, vh - h - m)) });
  }, [at?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // focus the first item once it's placed (a hidden element can't take focus)
  useLayoutEffect(() => {
    if (pos && !menuRef.current?.contains(document.activeElement)) menuRef.current?.querySelector<HTMLElement>('.cm-item')?.focus({ preventScroll: true });
  }, [pos]);
  useLayoutEffect(() => {
    if (!subOpen || !pos) { setSubPos(null); return; }
    const host = menuRef.current?.querySelector<HTMLElement>(`[data-id="${subOpen}"]`), el = subRef.current;
    if (!host || !el) return;
    const r = host.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, m = 8;
    const right = r.right + 2;
    const x = right + w + m <= vw ? right : Math.max(m, r.left - w - 2);
    setSubPos({ x, y: Math.max(m, Math.min(r.top - 6, vh - h - m)) });
  }, [subOpen, pos]);

  // close on outside press, scroll, resize, blur; keys are owned by the menu while it is open
  useEffect(() => {
    if (!at) return;
    const inside = (t: EventTarget | null) => t instanceof Node && (!!menuRef.current?.contains(t) || !!subRef.current?.contains(t));
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) close(false); };
    const onScroll = (e: Event) => { if (!inside(e.target)) close(false); };
    const onBlur = () => close(false);
    const onKey = (e: KeyboardEvent) => {
      // nothing reaches the game (Space = FIRE, E = emotes) while the menu is up
      e.stopImmediatePropagation();
      const inSub = !!subRef.current?.contains(document.activeElement);
      const list = [...((inSub ? subRef.current : menuRef.current)?.querySelectorAll<HTMLElement>('.cm-item:not(:disabled)') ?? [])];
      const i = list.indexOf(document.activeElement as HTMLElement);
      const focus = (k: number) => { e.preventDefault(); list[(k + list.length) % list.length]?.focus(); };
      switch (e.key) {
        case 'Escape': e.preventDefault(); if (inSub) { setSubOpen(null); menuRef.current?.querySelector<HTMLElement>(`[data-id="${subOpen}"]`)?.focus(); } else close(); break;
        case 'ArrowDown': focus(i + 1); break;
        case 'ArrowUp': focus(i < 0 ? -1 : i - 1); break;
        case 'Home': focus(0); break;
        case 'End': focus(-1); break;
        case 'ArrowRight': {
          e.preventDefault();
          const sid = (document.activeElement as HTMLElement | null)?.dataset?.sub;
          if (!inSub && sid) { kbSub.current = true; setSubOpen(sid); }
          break;
        }
        case 'ArrowLeft':
          e.preventDefault();
          if (inSub) { const s = subOpen; setSubOpen(null); menuRef.current?.querySelector<HTMLElement>(`[data-id="${s}"]`)?.focus(); }
          break;
        case 'Tab': e.preventDefault(); close(); break;
        case 'Enter': case ' ': {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.click();
          break;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { e.stopImmediatePropagation(); if (e.key === ' ') e.preventDefault(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('wheel', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onBlur);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('wheel', onScroll, true);
      window.removeEventListener('resize', onBlur);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [at, subOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // a submenu opened from the keyboard takes focus
  useEffect(() => {
    if (!subPos) return;
    if (menuRef.current?.contains(document.activeElement) && (document.activeElement as HTMLElement).dataset.sub === subOpen && kbSub.current) {
      subRef.current?.querySelector<HTMLElement>('.cm-item')?.focus({ preventScroll: true });
    }
    kbSub.current = false;
  }, [subPos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!at) return null;
  const sub = items.find((it) => it.id === subOpen)?.sub;
  const row = (it: Item, inSub: boolean): ReactNode => (
    <button
      key={it.id} type="button" role="menuitem" className={`cm-item ${it.sub ? 'has-sub' : ''} ${subOpen === it.id ? 'is-open' : ''}`}
      data-id={it.id} data-sub={it.sub ? it.id : undefined} disabled={it.disabled} tabIndex={-1}
      aria-haspopup={it.sub ? 'menu' : undefined} aria-expanded={it.sub ? subOpen === it.id : undefined}
      onClick={(e) => { if (it.sub) kbSub.current = e.detail === 0; activate(it); }}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') { if (!inSub) setSubOpen(it.sub ? it.id : null); e.currentTarget.focus({ preventScroll: true }); } }}
    >
      {it.icon ? it.icon.startsWith('px:') ? <PixelIcon name={it.icon.slice(3)} className="cm-ico" /> : (/^[a-z]+$/.test(it.icon) ? <Ico name={it.icon} /> : <span className="cm-ico cm-emoji" aria-hidden>{it.icon}</span>) : <span className="cm-ico cm-quote" aria-hidden>“</span>}
      <span className="cm-label">{it.label}</span>
      {it.sub && <span className="cm-arrow" aria-hidden>▸</span>}
    </button>
  );
  return createPortal(
    <>
      <div ref={menuRef} className="cm" role="menu" aria-label="Menu" onContextMenu={(e) => e.preventDefault()}
        style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, visibility: pos ? 'visible' : 'hidden' } as CSSProperties}>
        {items.map((it) => [
          (it.id === 'emote' || it.id === (fsOk ? 'fs' : 'reload')) && <div key={`s-${it.id}`} className="cm-sep" role="separator" />,
          row(it, false),
        ])}
      </div>
      {sub && (
        <div ref={subRef} className={`cm cm-sub ${subOpen === 'say' ? 'cm-taunts' : ''}`} role="menu" aria-label={subOpen === 'say' ? 'Taunts' : 'Emotes'}
          onContextMenu={(e) => e.preventDefault()}
          style={{ left: subPos?.x ?? -999, top: subPos?.y ?? -999, visibility: subPos ? 'visible' : 'hidden' } as CSSProperties}>
          {sub.map((it) => row(it, true))}
        </div>
      )}
    </>,
    document.body,
  );
}

export default ContextMenu;
