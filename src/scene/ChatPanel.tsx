// Desktop emotes: a narrow, always-visible vertical rail of the 8 emote buttons at the middle of the
// left edge (no log, no collapse). It overlays the scene and reserves no layout space: phase content
// centres on the full viewport. EmoteBar owns the cooldowns and renders this on wide, mouse-driven screens.
import { useSyncExternalStore, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { EMOTES, type EmoteId } from '../../shared/types';
import { PAL } from '../pixel/palette';
import type { DrawFn } from '../pixel/sprites';
import PixelIcon from '../ui/PixelIcon';
import './scene.css';

/** 13x11 pixel speech bubble with three dots */
export const drawBubble: DrawFn = (c) => {
  c.fillStyle = PAL.ink;
  c.fillRect(1, 0, 11, 1); c.fillRect(0, 1, 1, 6); c.fillRect(12, 1, 1, 6); c.fillRect(1, 7, 11, 1);
  c.fillRect(2, 8, 1, 2); c.fillRect(3, 8, 1, 1); c.fillRect(1, 10, 1, 1);
  c.fillStyle = PAL.parch; c.fillRect(1, 1, 11, 6); c.fillRect(2, 7, 2, 1); c.fillRect(2, 8, 1, 1);
  c.fillStyle = PAL.parch2; c.fillRect(1, 6, 11, 1);
  c.fillStyle = PAL.wood2; c.fillRect(3, 3, 2, 2); c.fillRect(6, 3, 2, 2); c.fillRect(9, 3, 2, 2);
};

/* ---------- desktop detection (wide + fine pointer) ---------- */
const DESK_Q = '(min-width: 1024px) and (pointer: fine)';
const subDesk = (f: () => void) => {
  let m: MediaQueryList | null = null;
  try { m = window.matchMedia(DESK_Q); } catch { return () => {}; }
  m.addEventListener?.('change', f);
  return () => m?.removeEventListener?.('change', f);
};
const isDesk = () => { try { return window.matchMedia(DESK_Q).matches; } catch { return false; } };

/** { desk: wide screen with a mouse } (the rail is always shown there; `open` kept for old callers) */
export function useDeskChat(_phase?: string) {
  const desk = useSyncExternalStore(subDesk, isDesk, () => false);
  return { desk, open: desk };
}

/* ---------- the rail ---------- */
export default function EmoteRail({ emote, emoteCool }: { emote: (id: EmoteId) => void; emoteCool: boolean }) {
  // Space on a focused emote button belongs to the game (FIRE, BANG, slide), not to the button
  const btnKeys = {
    onKeyDown: (e: RKeyboardEvent) => { if (e.key === ' ') e.preventDefault(); },
    onKeyUp: (e: RKeyboardEvent) => { if (e.key === ' ') e.preventDefault(); },
  };
  const blurAfter = (e: RMouseEvent<HTMLButtonElement>) => { if (e.detail > 0) e.currentTarget.blur(); };
  return createPortal(
    // pointer presses stay in the rail (a click here is never a duel BANG)
    <nav className={`emo-rail ${emoteCool ? 'is-cool' : ''}`} aria-label="Emotes" onPointerDown={(e) => e.stopPropagation()}>
      {(Object.keys(EMOTES) as EmoteId[]).map((id) => (
        <button key={id} type="button" className="emo-rail-b" disabled={emoteCool} onClick={(e) => { blurAfter(e); emote(id); }}
          title={EMOTES[id].label} aria-label={EMOTES[id].label} {...btnKeys}>
          <PixelIcon name={id} />
          <span className="emo-rail-tip" aria-hidden>{EMOTES[id].label}</span>
        </button>
      ))}
    </nav>,
    document.body,
  );
}
