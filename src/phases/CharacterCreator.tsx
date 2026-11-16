import { useEffect, useRef, useState } from 'react';
import { LOOK_COUNTS, LOOK_LABELS, randomLook, type Look } from '../../shared/types';
import BustPreview from '../pixel/BustPreview';
import { DockActions, play } from '../scene/Dock';
import { sfx } from '../sfx';
import './panels.css';

const FIELDS: { k: keyof Look; label: string }[] = [
  { k: 'hat', label: 'Hat' },
  { k: 'hatColor', label: 'Hat colour' },
  { k: 'skin', label: 'Skin' },
  { k: 'face', label: 'Face' },
  { k: 'hair', label: 'Hair' },
  { k: 'bandana', label: 'Bandana' },
  { k: 'coat', label: 'Coat' },
];

/** approximate swatches for the colour fields (the sprite palette lives in src/pixel) */
const SWATCH: Partial<Record<keyof Look, string[]>> = {
  hatColor: ['#a07a4e', '#2b2422', '#9a4a24', '#e3d3b0', '#6a1c1c', '#55606c'],
  skin: ['#f3d2b8', '#e2b48c', '#c68d5e', '#8e5a36', '#5a3520'],
  hair: ['#1c1412', '#5b3a22', '#b0522a', '#d9b86a', '#9a9590'],
  bandana: ['transparent', '#a3201f', '#22345a', '#1a1414', '#c99a2a', '#3c6a3a'],
  coat: ['#8a6a44', '#22201e', '#6a3a1e', '#34507a', '#66686a', '#a0825a'],
};
const HAT_FIELDS = new Set<keyof Look>(['hat', 'hatColor']);

const mq = (q: string) => { try { return !!window.matchMedia?.(q).matches; } catch { return false; } };

function useScale() {
  const calc = () => (mq('(max-height: 500px) and (orientation: landscape)') ? 2 : mq('(max-width: 640px)') ? (window.innerHeight < 700 ? 2 : 3) : 4);
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

export default function CharacterCreator({ initial, first, onSave, onDone }: {
  initial?: Look; first: boolean; onSave: (l: Look) => void; onDone: () => void;
}) {
  const [draft, setDraft] = useState<Look>(() => (initial ? { ...initial } : randomLook()));
  const [tip, setTip] = useState(false);
  const [puff, setPuff] = useState(0);
  const bustRef = useRef<HTMLDivElement>(null);
  const doneT = useRef(0);
  useEffect(() => () => clearTimeout(doneT.current), []);
  const scale = useScale();
  const reduce = mq('(prefers-reduced-motion: reduce)');

  const kick = (hat: boolean) => {
    setPuff((n) => n + 1);
    if (reduce) return;
    const el = bustRef.current;
    if (!el) return;
    el.animate(hat
      ? [{ transform: 'translateY(-10px)' }, { transform: 'translateY(2px) scaleY(.96)', offset: 0.55 }, { transform: 'translateY(-2px)', offset: 0.8 }, { transform: 'none' }]
      : [{ transform: 'scale(.94)' }, { transform: 'scale(1.03)', offset: 0.6 }, { transform: 'none' }],
    { duration: hat ? 320 : 240, easing: 'steps(5, end)' });
  };

  const cycle = (k: keyof Look, dir: 1 | -1) => {
    if (tip) return;
    sfx.unlock();
    const n = LOOK_COUNTS[k];
    setDraft((d) => ({ ...d, [k]: (d[k] + dir + n) % n }));
    if (!play(HAT_FIELDS.has(k) ? 'hatPop' : 'swish')) sfx.click();
    kick(HAT_FIELDS.has(k));
  };

  const shuffle = () => {
    if (tip) return;
    sfx.unlock();
    setDraft(randomLook());
    if (!play('coin')) sfx.click();
    kick(true);
  };

  const save = () => {
    if (tip) return;
    sfx.unlock();
    onSave(draft);
    setTip(true);
    if (!play('spurs')) sfx.cock();
    doneT.current = window.setTimeout(onDone, reduce ? 350 : 1250);
  };

  return (
    <div className={`cc ${tip ? 'is-tipping' : ''}`}>
      <div className="cc-stage">
        <div className="cc-spot" aria-hidden />
        <div className="cc-bust" ref={bustRef}>
          <BustPreview look={draft} scale={scale} tipHat={tip} className="cc-bust-cv" />
        </div>
        {puff > 0 && <span key={puff} className="cc-puff" aria-hidden><i /><i /><i /><i /><i /></span>}
        <button type="button" className="nh-btn nh-btn-sm cc-random" onClick={shuffle} disabled={tip} aria-label="Random look">
          <span aria-hidden>🎲</span> Random
        </button>
      </div>

      <div className="cc-rows" role="group" aria-label="Outfit">
        {FIELDS.map(({ k, label }) => {
          const sw = SWATCH[k];
          const v = draft[k];
          return (
            <div key={k} className="cc-row">
              <button type="button" className="cc-arrow" onClick={() => cycle(k, -1)} aria-label={`Previous ${label.toLowerCase()}`} disabled={tip}>◀</button>
              <div className="cc-mid">
                <span className="cc-field">{label}</span>
                <b className="cc-val" aria-live="polite">{LOOK_LABELS[k][v]}</b>
                {sw && (
                  <span className="cc-sw" aria-hidden>
                    {sw.map((c, i) => <i key={i} className={`${i === v ? 'on' : ''} ${c === 'transparent' ? 'none' : ''}`} style={{ background: c }} />)}
                  </span>
                )}
              </div>
              <button type="button" className="cc-arrow" onClick={() => cycle(k, 1)} aria-label={`Next ${label.toLowerCase()}`} disabled={tip}>▶</button>
            </div>
          );
        })}
      </div>

      <DockActions>
        <div className="dock-act dock-act-row">
          {!first && <button type="button" className="nh-linkbtn" onClick={() => { sfx.click(); onDone(); }} disabled={tip}>never mind</button>}
          <button type="button" className="nh-btn nh-btn-big cc-save" onClick={save} disabled={tip}>
            {tip ? 'Much obliged…' : "Lookin' good →"}
          </button>
        </div>
      </DockActions>
    </div>
  );
}
