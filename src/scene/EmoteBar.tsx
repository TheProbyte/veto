// Emotes only (sends {t:'emote'}; no typed text or taunts). Phones: a bottom-left button + wheel.
// Desktop (wide + mouse): the always-visible EmoteRail (ChatPanel.tsx) at the middle of the left edge. Always mounted (also runs the shot extras).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import { EMOTES, type EmoteId } from '../../shared/types';
import { PixelSprite } from '../pixel/PixelCanvas';
import { sfx } from '../sfx';
import EmoteRail, { drawBubble, useDeskChat } from './ChatPanel';
import { useShotExtras } from '../phases/ShotExtras';
import '../phases/gameplay.css';
import PixelIcon from '../ui/PixelIcon';

const EMOTE_CD = 1200;

export default function EmoteBar(rp: RoomProps) {
  const { state, send, skew } = rp;
  useShotExtras(state, skew); // always mounted: catches the finale shot even if the phase flips with it
  const { desk } = useDeskChat(state.phase);
  const deskRef = useRef(desk);
  deskRef.current = desk;
  const [open, setOpen] = useState(false);
  const [cd, setCd] = useState(0);
  const [ringKey, setRingKey] = useState<{ k: number; ms: number } | null>(null);
  const [, force] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const phase = state.phase;

  const toggle = useCallback((v?: boolean) => {
    setOpen((o) => {
      const n = v ?? !o;
      if (n && !o) sfx.click();
      return n;
    });
  }, []);

  // E opens on desktop, Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape') { setOpen(false); return; }
      if (typing || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); if (deskRef.current) (document.querySelector('.emo-rail-b:not(:disabled)') as HTMLElement | null)?.focus(); else toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // click outside closes
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // re-render when a cooldown ends (to re-enable buttons)
  useEffect(() => {
    const end = cd - Date.now();
    if (end <= 0) return;
    const t = window.setTimeout(() => force((x) => x + 1), end + 20);
    return () => clearTimeout(t);
  }, [cd]);

  const now = Date.now();
  const emoteCool = cd > now;

  const emote = (id: EmoteId) => {
    if (Date.now() < cd) return;
    send({ t: 'emote', emote: id });
    setCd(Date.now() + EMOTE_CD);
    setRingKey({ k: Date.now(), ms: EMOTE_CD });
    setOpen(false);
  };

  // full-screen minigames / the duel own the whole screen: no rail over them (the rail sits at z 64, under the .fun- overlays at 400)
  if (desk) return phase === 'mini' || phase === 'duel' ? null : <EmoteRail emote={emote} emoteCool={emoteCool} />;

  return createPortal(
    <div className={`emo ph-${phase}`} ref={rootRef}>
      {open && (
        <div className="emo-wheel px-box" role="dialog" aria-label="Emotes">
          <div className="emo-grid">
            {(Object.keys(EMOTES) as EmoteId[]).map((id) => (
              <button key={id} className="emo-e px-btn" disabled={emoteCool} onClick={() => emote(id)} title={EMOTES[id].label}>
                <span aria-hidden><PixelIcon name={id} /></span><span>{EMOTES[id].label}</span>
              </button>
            ))}
          </div>
          <div className="emo-cool">{emoteCool ? 'Catch your breath…' : ''}</div>
        </div>
      )}
      <button
        className={`emo-btn px-btn ${open ? 'open' : ''}`}
        onClick={() => toggle()}
        // Space belongs to the game (FIRE / BANG) even while this button has focus; E / Enter / tap open it
        onKeyDown={(e) => { if (e.key === ' ') e.preventDefault(); }}
        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
        aria-label="Emotes (E)"
        aria-expanded={open}
        title="Emotes (E)"
      >
        <PixelSprite draw={drawBubble} w={13} h={11} className="emo-ico" />
        {ringKey && emoteCool && (
          <svg key={ringKey.k} className="emo-ring" viewBox="0 0 36 36" aria-hidden style={{ '--cd': `${ringKey.ms}ms` } as CSSProperties}>
            <circle cx="18" cy="18" r="15.9" pathLength={100} />
          </svg>
        )}
        <span className="emo-key" aria-hidden>E</span>
      </button>
    </div>,
    document.body,
  );
}
