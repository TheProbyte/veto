// Sound button (fixed top-right) + popover with Music / Effects / Voice sliders (each with -/+ 5% buttons),
// Mute and Test. Slider positions are shown in %; the gain is position² (see sliderGain in sfx.ts).
// Also drives background music from the game phase: <SoundMenu phase={state.phase} />.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sfx, useMusicForPhase } from '../sfx';
import { hasVoice, playVoice } from '../voice';

const CSS = `
.snd-root { position: fixed; z-index: 80; top: calc(env(safe-area-inset-top, 0px) + 8px); right: calc(env(safe-area-inset-right, 0px) + 8px); font-family: 'Pixelify Sans', 'Silkscreen', monospace; color: #e8d5b5; }
.snd-btn { width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 0; cursor: pointer; touch-action: manipulation;
  background: #3b2416; color: #ffb35c;
  box-shadow: 0 -3px 0 0 #0b0705, 0 3px 0 0 #0b0705, -3px 0 0 0 #0b0705, 3px 0 0 0 #0b0705, inset 0 -3px 0 0 #160d08, inset 0 3px 0 0 #7a5232; }
.snd-btn:hover { background: #5a3a22; }
.snd-btn:active { box-shadow: 0 -3px 0 0 #0b0705, 0 3px 0 0 #0b0705, -3px 0 0 0 #0b0705, 3px 0 0 0 #0b0705, inset 0 3px 0 0 #160d08; }
.snd-btn[aria-pressed="true"] { color: #c9b08a; }
.snd-btn:focus-visible, .snd-pop button:focus-visible, .snd-pop input:focus-visible { outline: 2px dashed #ffb35c; outline-offset: 4px; }
.snd-pop { position: absolute; top: 56px; right: 0; width: min(300px, calc(100vw - 24px)); box-sizing: border-box; padding: 14px 14px 12px;
  background: #2a1a10;
  background-image: repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 2px, transparent 2px 9px);
  box-shadow: 0 -3px 0 0 #0b0705, 0 3px 0 0 #0b0705, -3px 0 0 0 #0b0705, 3px 0 0 0 #0b0705, inset 0 0 0 3px #5a3a22, 6px 6px 0 0 rgba(0,0,0,.45); }
.snd-title { margin: 0 0 10px; font-family: 'Rye', serif; font-weight: 400; font-size: 18px; color: #ffb35c; letter-spacing: .03em; text-shadow: 2px 2px 0 #0b0705; }
.snd-row { margin: 0 0 8px; }
.snd-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 2px 2px; }
.snd-ctl { display: grid; grid-template-columns: 36px 1fr 36px; align-items: center; gap: 10px; }
.snd-step { width: 36px; height: 36px; padding: 0; border: 0; border-radius: 0; cursor: pointer; touch-action: manipulation; font-family: 'Silkscreen', monospace; font-size: 16px; line-height: 1;
  background: #3b2416; color: #ffb35c;
  box-shadow: 0 -2px 0 0 #0b0705, 0 2px 0 0 #0b0705, -2px 0 0 0 #0b0705, 2px 0 0 0 #0b0705, inset 0 -3px 0 0 #160d08, inset 0 3px 0 0 #7a5232; }
.snd-step:hover { background: #5a3a22; }
.snd-step:disabled { opacity: .4; cursor: default; }
.snd-lbl { font-family: 'Silkscreen', 'Pixelify Sans', monospace; font-size: 12px; text-transform: uppercase; color: #c9b08a; }
.snd-val { font-family: 'Silkscreen', monospace; font-size: 12px; text-align: right; color: #ffb35c; }
.snd-range { -webkit-appearance: none; appearance: none; width: 100%; height: 36px; margin: 0; background: transparent; cursor: pointer; touch-action: none; }
.snd-range::-webkit-slider-runnable-track { height: 8px; background: linear-gradient(90deg, #ffb35c 0 var(--snd-p), #160d08 var(--snd-p) 100%); box-shadow: 0 -2px 0 0 #0b0705, 0 2px 0 0 #0b0705, -2px 0 0 0 #0b0705, 2px 0 0 0 #0b0705; }
.snd-range::-moz-range-track { height: 8px; background: #160d08; box-shadow: 0 -2px 0 0 #0b0705, 0 2px 0 0 #0b0705, -2px 0 0 0 #0b0705, 2px 0 0 0 #0b0705; }
.snd-range::-moz-range-progress { height: 8px; background: #ffb35c; }
.snd-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 28px; margin-top: -10px; border: 0; border-radius: 0; background: #e8d5b5;
  box-shadow: 0 -2px 0 0 #0b0705, 0 2px 0 0 #0b0705, -2px 0 0 0 #0b0705, 2px 0 0 0 #0b0705, inset 0 -3px 0 0 #c9b08a; }
.snd-range::-moz-range-thumb { width: 22px; height: 28px; border: 0; border-radius: 0; background: #e8d5b5;
  box-shadow: 0 -2px 0 0 #0b0705, 0 2px 0 0 #0b0705, -2px 0 0 0 #0b0705, 2px 0 0 0 #0b0705, inset 0 -3px 0 0 #c9b08a; }
.snd-range:disabled { opacity: .5; }
.snd-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
.snd-act { min-height: 40px; border: 0; border-radius: 0; cursor: pointer; touch-action: manipulation; font-family: 'Pixelify Sans', monospace; font-size: 15px; font-weight: 600;
  background: #3b2416; color: #e8d5b5;
  box-shadow: 0 -2px 0 0 #0b0705, 0 2px 0 0 #0b0705, -2px 0 0 0 #0b0705, 2px 0 0 0 #0b0705, inset 0 -3px 0 0 #160d08, inset 0 3px 0 0 #7a5232; }
.snd-act:hover { background: #5a3a22; }
.snd-act[aria-pressed="true"] { background: #ffb35c; color: #160d08; box-shadow: 0 -2px 0 0 #0b0705, 0 2px 0 0 #0b0705, -2px 0 0 0 #0b0705, 2px 0 0 0 #0b0705, inset 0 3px 0 0 #b0702c; }
`;

function Icon({ quiet }: { quiet: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="24" height="24" aria-hidden shapeRendering="crispEdges">
      <path d="M1 4h2v4H1zM3 4h1V3h1V2h1v8H5V9H4V8H3z" fill="currentColor" />
      {quiet
        ? <path d="M8 4h1v1H8zM10 4h1v1h-1zM9 5h1v2H9zM8 7h1v1H8zM10 7h1v1h-1z" fill="currentColor" />
        : <path d="M8 5h1v2H8zM9 3h1v1H9zM10 4h1v4h-1zM9 8h1v1H9z" fill="currentColor" />}
    </svg>
  );
}

interface Slider { id: string; label: string; value: number; set: (v: number) => void; test?: () => void }

export default function SoundMenu({ phase }: { phase?: string } = {}) {
  useMusicForPhase(phase);
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() => sfx.isMuted());
  const [music, setMusic] = useState(() => sfx.getMusicVolume());
  const [fx, setFx] = useState(() => sfx.getVolume());
  const [voice, setVoice] = useState(() => sfx.getVoiceVolume());
  const root = useRef<HTMLDivElement>(null);
  const testT = useRef(0);

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => () => window.clearTimeout(testT.current), []);
  // reopening: pick up anything changed elsewhere
  useEffect(() => {
    if (!open) return;
    setMusic(sfx.getMusicVolume()); setFx(sfx.getVolume()); setVoice(sfx.getVoiceVolume()); setMuted(sfx.isMuted());
  }, [open]);

  const unmute = () => { if (muted) { sfx.setMuted(false); setMuted(false); } };
  // setVolume smooths over ~50ms, so the test click waits for the new level
  const testClick = () => {
    window.clearTimeout(testT.current);
    testT.current = window.setTimeout(() => sfx.click(), 160);
  };
  const toggleMute = () => {
    const m = !muted;
    sfx.unlock();
    sfx.setMuted(m);
    setMuted(m);
  };
  const testVoice = () => {
    window.clearTimeout(testT.current);
    testT.current = window.setTimeout(() => { if (!playVoice('emote_yeehaw', 'emote')) sfx.click(); }, 160);
  };
  const quiet = muted || (fx <= 0 && music <= 0 && voice <= 0);
  const sliders: Slider[] = [
    { id: 'music', label: 'Music', value: music, set: (v) => { setMusic(v); sfx.setMusicVolume(v); } },
    { id: 'fx', label: 'Effects', value: fx, set: (v) => { setFx(v); sfx.setVolume(v); setVoice(sfx.getVoiceVolume()); }, test: testClick },
    { id: 'voice', label: 'Voice', value: voice, set: (v) => { setVoice(v); sfx.setVoiceVolume(v); }, test: hasVoice('emote_yeehaw') ? testVoice : testClick },
  ];
  const change = (s: Slider, v: number) => {
    v = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100; // no float drift from the +/- steps
    s.set(v); sfx.unlock();
    if (v > 0) unmute();
  };

  if (typeof document === 'undefined') return null;
  // portal to <body> so a transformed ancestor (screen shake) can't break position: fixed
  return createPortal(
    <div className="snd-root" ref={root}>
      <style>{CSS}</style>
      <button
        type="button" className="snd-btn" aria-haspopup="dialog" aria-expanded={open} aria-pressed={muted}
        aria-label={muted ? 'Sound settings (muted)' : 'Sound settings'} title="Sound"
        onPointerDown={() => sfx.unlock()}
        onClick={() => { sfx.unlock(); setOpen((o) => !o); }}
      >
        <Icon quiet={quiet} />
      </button>
      {open && (
        <div className="snd-pop" role="dialog" aria-label="Sound">
          <h2 className="snd-title">Sound</h2>
          {sliders.map((sl) => {
            const pct = Math.round(sl.value * 100);
            return (
              <div className="snd-row" key={sl.id}>
                <div className="snd-head">
                  <label className="snd-lbl" htmlFor={`snd-${sl.id}`}>{sl.label}</label>
                  <b className="snd-val">{pct}%</b>
                </div>
                <div className="snd-ctl">
                  <button type="button" className="snd-step" aria-label={`${sl.label} down 5%`} disabled={sl.value <= 0}
                    onClick={() => { change(sl, sl.value - 0.05); sl.test?.(); }}>-</button>
                  <input
                    id={`snd-${sl.id}`} className="snd-range" type="range" min={0} max={1} step={0.01} value={sl.value}
                    style={{ ['--snd-p' as string]: `${pct}%` }}
                    onChange={(e) => change(sl, Number(e.target.value))}
                    onPointerUp={sl.test}
                    onKeyUp={sl.test}
                    aria-label={`${sl.label} volume`} aria-valuetext={`${pct}%`}
                  />
                  <button type="button" className="snd-step" aria-label={`${sl.label} up 5%`} disabled={sl.value >= 1}
                    onClick={() => { change(sl, sl.value + 0.05); sl.test?.(); }}>+</button>
                </div>
              </div>
            );
          })}
          <div className="snd-actions">
            <button type="button" className="snd-act" aria-pressed={muted} onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
            <button type="button" className="snd-act" onClick={() => { sfx.unlock(); unmute(); testClick(); }}>Test</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
