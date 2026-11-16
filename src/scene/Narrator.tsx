// Bartender narrator: shows the server's {t:'narrate'} lines as a pixel caption,
// and plays /voice/<id>.mp3 when that recording exists (see src/voiceManifest.ts).
import { useEffect, useRef, useState } from 'react';
import type { RoomProps } from '../props';
import { playVoice, stopNarrator } from '../voice';

interface Cap { id: string; text: string; key: number }

/**
 * The Barkeep's explain card: while the server holds play for an explanation (state.explainUntil), cover the
 * screen with his line in big pixel text so nobody can act until he's done. Taps and keys are swallowed.
 */
function ExplainCard({ state, skew, send }: { state: RoomProps['state']; skew: number; send: RoomProps['send'] }) {
  const until = state.explainUntil ?? 0;
  const from = state.explainFrom ?? 0;
  const [now, setNow] = useState(() => Date.now() + skew);
  // tapping the card skips it for me (stops his voice); the server lets play continue once everyone has skipped
  const [skipped, setSkipped] = useState(0);
  const active = !!state.explainText && until > now && skipped !== until;
  const skip = () => { stopNarrator(); setSkipped(until); send({ t: 'skipExplain' }); };
  useEffect(() => {
    if (until <= Date.now() + skew) return;
    const t = window.setInterval(() => setNow(Date.now() + skew), 100);
    return () => clearInterval(t);
  }, [until, skew]);
  // swallow keys (Space would fire, Enter would submit) while he talks
  useEffect(() => {
    if (!active) return;
    const stop = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return; // chat still works
      if (e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow')) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', stop, true);
    window.addEventListener('keyup', stop, true);
    return () => { window.removeEventListener('keydown', stop, true); window.removeEventListener('keyup', stop, true); };
  }, [active]);
  if (!active) return null;
  const total = Math.max(1, until - Math.min(from || until, now));
  const left = Math.max(0, Math.min(1, (until - now) / Math.max(1, until - (from || now))));
  void total;
  return (
    <div className="xcard" role="dialog" aria-live="assertive" aria-label="The Barkeep explains"
      onPointerDownCapture={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); skip(); }}>
      <div className="xcard-box">
        <div className="xcard-who">The Barkeep</div>
        <div className="xcard-text">{state.explainText}</div>
        <div className="xcard-bar"><span style={{ transform: `scaleX(${left})` }} /></div>
        <div className="xcard-skip">tap to skip</div>
      </div>
    </div>
  );
}

export default function Narrator({ on, state, skew, send }: RoomProps) {
  const [cap, setCap] = useState<Cap | null>(null);
  const [shown, setShown] = useState(0); // typewriter chars
  const timer = useRef<number>();
  const seq = useRef(0);

  useEffect(() => on((e) => {
    if (e.t !== 'narrate') return;
    playVoice(e.id, 'narr');
    if (e.id.startsWith('how_')) return; // shown on the big explain card instead
    seq.current += 1;
    setCap({ id: e.id, text: e.text, key: seq.current });
    setShown(0);
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

  const card = <ExplainCard state={state} skew={skew} send={send} />;
  if (!cap) return <>{card}<style>{CSS}</style></>;
  return (
    <>{card}
    <div className={`narr${state.phase === 'result' || state.phase === 'duel' ? ' narr-low' : ''}`} key={cap.key} role="status" aria-live="polite">
      <style>{CSS}</style>
      <span className="narr-who">Barkeep</span>
      <span className="narr-text">{cap.text.slice(0, shown)}<span className="narr-ghost">{cap.text.slice(shown)}</span></span>
    </div>
    </>
  );
}

const CSS = `
.narr{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);transform:translateX(-50%);z-index:60;
  max-width:min(560px,calc(100vw - 140px));pointer-events:none;display:flex;flex-direction:column;gap:2px;
  padding:calc(var(--pu,2px)*3) calc(var(--pu,2px)*5);background:#160d08ee;color:#e8d5b5;font-family:'Pixelify Sans','Silkscreen',monospace;
  font-size:calc(var(--pt,2px)*8);line-height:1.25;-webkit-font-smoothing:none;text-align:center;
  box-shadow:0 calc(var(--pu,2px)*-1) 0 #5a3a22,0 var(--pu,2px) 0 #5a3a22,calc(var(--pu,2px)*-1) 0 0 #5a3a22,var(--pu,2px) 0 0 #5a3a22,0 0 0 calc(var(--pu,2px)*2) #0b0705,0 calc(var(--pu,2px)*3) 0 calc(var(--pu,2px)*2) #0008;
  animation:narr-in .22s steps(4) both}
.narr-who{font-family:'Silkscreen',monospace;font-size:calc(var(--pt,2px)*5);letter-spacing:.12em;color:#ffb35c;text-transform:uppercase}
.narr-ghost{opacity:0}
@keyframes narr-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}

.narr.narr-low{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 14px)}
/* phones: a compact strip up at the ceiling, between the chat (left) and sound (right) buttons,
   so it never sits on anyone's face */
@media (max-width:640px){
  .narr{top:calc(env(safe-area-inset-top,0px) + 8px);left:64px;right:64px;transform:none;max-width:none;
    font-size:calc(var(--pt,2px)*7);line-height:1.2;padding:calc(var(--pu,2px)*2) calc(var(--pu,2px)*4);gap:1px;
    display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
  .narr-who{display:inline;font-size:calc(var(--pt,2px)*4);margin-right:4px}
  .narr-text{display:inline}
  .narr.narr-low{top:auto}
  @keyframes narr-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
}
@media (prefers-reduced-motion:reduce){.narr{animation:none}}
/* ---- big explain card ---- */
.xcard{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:calc(var(--pu,3px)*6);
  background:#0b0705b8;cursor:var(--cur-wait,wait);animation:xcard-in .25s steps(4) both}
.xcard-box{max-width:min(720px,92vw);padding:calc(var(--pu,3px)*6) calc(var(--pu,3px)*8);background:#2a1a10;color:#e8d5b5;text-align:center;
  box-shadow:0 calc(var(--pu,3px)*-1) 0 #5a3a22,0 var(--pu,3px) 0 #5a3a22,calc(var(--pu,3px)*-1) 0 0 #5a3a22,var(--pu,3px) 0 0 #5a3a22,
    0 0 0 calc(var(--pu,3px)*2) #0b0705,0 calc(var(--pu,3px)*3) 0 calc(var(--pu,3px)*2) #0008}
.xcard-who{font-family:'Silkscreen',monospace;font-size:calc(var(--pt,3px)*5);letter-spacing:.14em;color:#ffb35c;text-transform:uppercase;
  margin-bottom:calc(var(--pu,3px)*3);-webkit-font-smoothing:none}
.xcard-text{font-family:'Pixelify Sans','Silkscreen',monospace;font-size:clamp(22px,calc(var(--pt,3px)*11),44px);line-height:1.2;-webkit-font-smoothing:none}
.xcard-bar{margin:calc(var(--pu,3px)*5) auto 0;height:calc(var(--pu,3px)*2);width:60%;background:#160d08;
  box-shadow:0 0 0 var(--pu,3px) #5a3a22}
.xcard-skip{margin-top:calc(var(--pu,3px)*3);font-family:'Silkscreen',monospace;font-size:calc(var(--pt,2px)*5);color:#e8d5b5a0;letter-spacing:.1em;text-transform:uppercase}
.xcard{cursor:var(--cur-pointer,pointer)}
.xcard-bar span{display:block;height:100%;background:#ffb35c;transform-origin:left center}
@keyframes xcard-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.xcard{animation:none}}
`;
