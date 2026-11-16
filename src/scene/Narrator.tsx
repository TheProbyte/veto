// Bartender narrator: shows the server's {t:'narrate'} lines as a pixel caption,
// and plays /voice/<id>.mp3 when that recording exists (see src/voiceManifest.ts).
import { useEffect, useRef, useState } from 'react';
import type { RoomProps } from '../props';
import { sfx } from '../sfx';
import { VOICE_IDS } from '../voiceManifest';

interface Cap { id: string; text: string; key: number }

let current: HTMLAudioElement | null = null;
function playVoice(id: string) {
  if (!VOICE_IDS.has(id) || sfx.isMuted()) return;
  try {
    current?.pause();
    const a = new Audio(`/voice/${id}.mp3`);
    a.volume = Math.max(0, Math.min(1, sfx.getVolume()));
    current = a;
    a.play().catch(() => {});
  } catch {}
}

export default function Narrator({ on, state }: RoomProps) {
  const [cap, setCap] = useState<Cap | null>(null);
  const [shown, setShown] = useState(0); // typewriter chars
  const timer = useRef<number>();
  const seq = useRef(0);

  useEffect(() => on((e) => {
    if (e.t !== 'narrate') return;
    seq.current += 1;
    setCap({ id: e.id, text: e.text, key: seq.current });
    setShown(0);
    playVoice(e.id);
  }), [on]);

  useEffect(() => {
    if (!cap) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) setShown(cap.text.length);
    let i = reduce ? cap.text.length : 0;
    const tick = window.setInterval(() => {
      i += 2;
      setShown(Math.min(i, cap.text.length));
      if (i >= cap.text.length) clearInterval(tick);
    }, 28);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCap((c) => (c?.key === cap.key ? null : c)), 2600 + cap.text.length * 45);
    return () => clearInterval(tick);
  }, [cap]);

  if (!cap) return null;
  return (
    <div className={`narr${state.phase === 'result' || state.phase === 'duel' ? ' narr-low' : ''}`} key={cap.key} role="status" aria-live="polite">
      <style>{CSS}</style>
      <span className="narr-who">Barkeep</span>
      <span className="narr-text">{cap.text.slice(0, shown)}<span className="narr-ghost">{cap.text.slice(shown)}</span></span>
    </div>
  );
}

const CSS = `
.narr{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 58px);transform:translateX(-50%);z-index:60;
  max-width:min(560px,calc(100vw - 96px));pointer-events:none;display:flex;flex-direction:column;gap:2px;
  padding:7px 12px 8px;background:#160d08ee;color:#e8d5b5;font-family:'Pixelify Sans','Silkscreen',monospace;
  font-size:15px;line-height:1.25;text-align:center;
  box-shadow:0 -2px 0 #5a3a22,0 2px 0 #5a3a22,-2px 0 0 #5a3a22,2px 0 0 #5a3a22,0 0 0 4px #0b0705,0 6px 0 4px #0008;
  animation:narr-in .22s steps(4) both}
.narr-who{font-family:'Silkscreen',monospace;font-size:10px;letter-spacing:.12em;color:#ffb35c;text-transform:uppercase}
.narr-ghost{opacity:0}
@keyframes narr-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}

.narr.narr-low{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 14px)}
@media (max-width:640px){.narr{font-size:13px;top:calc(env(safe-area-inset-top,0px) + 54px);max-width:calc(100vw - 72px)}}
@media (prefers-reduced-motion:reduce){.narr{animation:none}}
`;
