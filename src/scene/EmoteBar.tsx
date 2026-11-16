// Emote wheel + taunts + free-text speech (sends {t:'emote'} / {t:'say'}). Bottom-left, above whatever owns the bottom edge.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import { EMOTES, SAY_MAX, TAUNTS, type EmoteId } from '../../shared/types';
import { PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import type { DrawFn } from '../pixel/sprites';
import { sfx } from '../sfx';
import { useShotExtras } from '../phases/ShotExtras';
import '../phases/gameplay.css';

const EMOTE_CD = 1200, SAY_CD = 2000;

/** 13x11 pixel speech bubble with three dots */
const drawBubble: DrawFn = (c) => {
  c.fillStyle = PAL.ink;
  c.fillRect(1, 0, 11, 1); c.fillRect(0, 1, 1, 6); c.fillRect(12, 1, 1, 6); c.fillRect(1, 7, 11, 1);
  c.fillRect(2, 8, 1, 2); c.fillRect(3, 8, 1, 1); c.fillRect(1, 10, 1, 1);
  c.fillStyle = PAL.parch; c.fillRect(1, 1, 11, 6); c.fillRect(2, 7, 2, 1); c.fillRect(2, 8, 1, 1);
  c.fillStyle = PAL.parch2; c.fillRect(1, 6, 11, 1);
  c.fillStyle = PAL.wood2; c.fillRect(3, 3, 2, 2); c.fillRect(6, 3, 2, 2); c.fillRect(9, 3, 2, 2);
};

export default function EmoteBar({ state, send, skew }: RoomProps) {
  useShotExtras(state, skew); // always mounted: catches the finale shot even if the phase flips with it
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [cd, setCd] = useState<{ emote: number; say: number }>({ emote: 0, say: 0 });
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
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); toggle(); }
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
    const end = Math.max(cd.emote, cd.say) - Date.now();
    if (end <= 0) return;
    const t = window.setTimeout(() => force((x) => x + 1), end + 20);
    return () => clearTimeout(t);
  }, [cd]);

  const now = Date.now();
  const emoteCool = cd.emote > now, sayCool = cd.say > now;

  const emote = (id: EmoteId) => {
    if (Date.now() < cd.emote) return;
    send({ t: 'emote', emote: id });
    setCd((c) => ({ ...c, emote: Date.now() + EMOTE_CD }));
    setRingKey({ k: Date.now(), ms: EMOTE_CD });
    setOpen(false);
  };
  const say = (raw: string) => {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, SAY_MAX);
    if (!t || Date.now() < cd.say) return;
    send({ t: 'say', text: t });
    setCd((c) => ({ ...c, say: Date.now() + SAY_CD }));
    setRingKey({ k: Date.now(), ms: SAY_CD });
    setText('');
    setOpen(false);
  };

  return createPortal(
    <div className={`emo ph-${phase}`} ref={rootRef}>
      {open && (
        <div className="emo-wheel px-box" role="dialog" aria-label="Emotes and taunts">
          <div className="emo-grid">
            {(Object.keys(EMOTES) as EmoteId[]).map((id) => (
              <button key={id} className="emo-e px-btn" disabled={emoteCool} onClick={() => emote(id)} title={EMOTES[id].label}>
                <span aria-hidden>{EMOTES[id].icon}</span><span>{EMOTES[id].label}</span>
              </button>
            ))}
          </div>
          <form className="emo-say" onSubmit={(e) => { e.preventDefault(); say(text); }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, SAY_MAX))}
              maxLength={SAY_MAX}
              enterKeyHint="send"
              placeholder="Say something…"
              aria-label="Say something"
              autoComplete="off"
            />
            <button type="submit" className="px-btn" disabled={sayCool || !text.trim()}>Say</button>
          </form>
          <div className="emo-sec">TAUNTS</div>
          <div className="emo-taunts">
            {TAUNTS.map((t) => <button key={t} className="emo-t px-btn" disabled={sayCool} onClick={() => say(t)}>{t}</button>)}
          </div>
          <div className="emo-cool">{emoteCool || sayCool ? 'catching your breath…' : ''}</div>
        </div>
      )}
      <button
        className={`emo-btn px-btn ${open ? 'open' : ''}`}
        onClick={() => toggle()}
        aria-label="Emotes and taunts (E)"
        aria-expanded={open}
        title="Emotes & taunts (E)"
      >
        <PixelSprite draw={drawBubble} w={13} h={11} className="emo-ico" />
        {ringKey && (emoteCool || sayCool) && (
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
