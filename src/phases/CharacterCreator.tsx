import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { LOOK_COUNTS, LOOK_LABELS, LOOK_UNLOCKS, lookUnlocked, type Look, type ProfileStats } from '../../shared/types';
import BustPreview from '../pixel/BustPreview';
import { DockActions, play } from '../scene/Dock';
import { sfx } from '../sfx';
import PixelIcon from '../ui/PixelIcon';
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
  hatColor: ['#a07a4e', '#2b2422', '#9a4a24', '#e3d3b0', '#6a1c1c', '#55606c', '#d9a82a'],
  skin: ['#f3d2b8', '#e2b48c', '#c68d5e', '#8e5a36', '#5a3520'],
  hair: ['#1c1412', '#5b3a22', '#b0522a', '#d9b86a', '#9a9590'],
  bandana: ['transparent', '#a3201f', '#22345a', '#1a1414', '#c99a2a', '#3c6a3a', '#e8e0d0', '#2a4a9a'],
  coat: ['#8a6a44', '#22201e', '#6a3a1e', '#34507a', '#66686a', '#a0825a', '#b0603a', '#d9a82a'],
};
const HAT_FIELDS = new Set<keyof Look>(['hat', 'hatColor']);

const STAT_NOUN: Record<keyof ProfileStats, string> = { rounds: 'rounds', kills: 'kills', wins: 'wins', saves: 'saves', duelsWon: 'duels won', shotAt: 'picks shot' };
const unlockOf = (k: keyof Look, i: number) => LOOK_UNLOCKS.find((u) => u.field === k && u.index === i);

/** random look over the options this player has unlocked */
function randomUnlocked(stats: ProfileStats): Look {
  const o = {} as Look;
  for (const { k } of FIELDS) {
    const ok = Array.from({ length: LOOK_COUNTS[k] }, (_, i) => i).filter((i) => lookUnlocked(k, i, stats));
    o[k] = ok[Math.floor(Math.random() * ok.length)] ?? 0;
  }
  return o;
}

const mq = (q: string) => { try { return !!window.matchMedia?.(q).matches; } catch { return false; } };

/** bust canvas size in bust pixels (BustPreview: 48 wide, 56 + 18 rows of hat headroom) */
const BW = 48;
/**
 * Pixel scale of the preview: a viewport guess, capped so the whole bust (hat brim to shoulders) fits the stage's width with air
 * on both sides. The stage's width never depends on the bust, so measuring it can't feed back.
 */
function useScale(stage: RefObject<HTMLElement>) {
  const guess = () => (mq('(max-height: 500px) and (orientation: landscape)') ? 2 : mq('(max-width: 640px)') ? (window.innerHeight < 700 ? 2 : 3) : window.innerHeight < 820 ? 3 : 4);
  const calc = () => {
    let s = guess();
    const el = stage.current;
    if (el && el.clientWidth > 0) {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      s = Math.min(s, Math.max(1, Math.floor((w * 0.84) / BW)));
    }
    return s;
  };
  const [s, setS] = useState(guess);
  useLayoutEffect(() => {
    const on = () => setS(calc());
    on();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    if (stage.current) ro?.observe(stage.current);
    window.addEventListener('resize', on);
    return () => { ro?.disconnect(); window.removeEventListener('resize', on); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

export default function CharacterCreator({ initial, first, stats, onSave, onDone }: {
  initial?: Look; first: boolean; stats: ProfileStats; onSave: (l: Look) => void; onDone: () => void;
}) {
  const [draft, setDraft] = useState<Look>(() => (initial ? { ...initial } : randomUnlocked(stats)));
  const [nag, setNag] = useState(false);
  const locked = FIELDS.filter(({ k }) => !lookUnlocked(k, draft[k], stats));
  const [tip, setTip] = useState(false);
  const [puff, setPuff] = useState(0);
  const bustRef = useRef<HTMLDivElement>(null);
  const doneT = useRef(0);
  useEffect(() => () => clearTimeout(doneT.current), []);
  const stageRef = useRef<HTMLDivElement>(null);
  const scale = useScale(stageRef);
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
    setNag(false);
    if (!play(HAT_FIELDS.has(k) ? 'hatPop' : 'swish')) sfx.click();
    kick(HAT_FIELDS.has(k));
  };

  const shuffle = () => {
    if (tip) return;
    sfx.unlock();
    setDraft(randomUnlocked(stats));
    setNag(false);
    if (!play('coin')) sfx.click();
    kick(true);
  };

  const save = () => {
    if (tip) return;
    sfx.unlock();
    if (locked.length) { setNag(true); sfx.click(); return; }
    onSave(draft);
    setTip(true);
    if (!play('spurs')) sfx.cock();
    doneT.current = window.setTimeout(onDone, reduce ? 350 : 1250);
  };

  return (
    <div className={`cc ${tip ? 'is-tipping' : ''}`}>
      <div className="cc-stage" ref={stageRef}>
        <div className="cc-scenery" aria-hidden><i className="cc-sun" /><i className="cc-town" /><i className="cc-walk" /></div>
        <div className="cc-spot" aria-hidden />
        <div className="cc-bust" ref={bustRef}>
          <BustPreview look={draft} scale={scale} tipHat={tip} className="cc-bust-cv" />
        </div>
        {puff > 0 && <span key={puff} className="cc-puff" aria-hidden><i /><i /><i /><i /><i /></span>}
        <button type="button" className="nh-btn nh-btn-sm cc-random" onClick={shuffle} disabled={tip} aria-label="Random look">
          <PixelIcon name="dice" /> Random
        </button>
      </div>

      <div className="cc-rows" role="group" aria-label="Outfit">
        {FIELDS.map(({ k, label }) => {
          const sw = SWATCH[k];
          const v = draft[k];
          const open = lookUnlocked(k, v, stats);
          const u = open ? undefined : unlockOf(k, v);
          return (
            <div key={k} className={`cc-row ${open ? '' : 'is-locked'}`}>
              <button type="button" className="cc-arrow coin" onClick={() => cycle(k, -1)} aria-label={`Previous ${label.toLowerCase()}`} disabled={tip}><PixelIcon name="arrowL" /></button>
              <div className="cc-mid">
                <span className="cc-field">{label}</span>
                <b className="cc-val" aria-live="polite">{!open && <span aria-label="locked">🔒 </span>}{LOOK_LABELS[k][v]}</b>
                {u && <span className="cc-lock">{u.hint} <em>{Math.min(stats[u.stat] ?? 0, u.need)}/{u.need} {STAT_NOUN[u.stat]}</em></span>}
                {sw && (
                  <span className="cc-sw" aria-hidden>
                    {sw.map((c, i) => <i key={i} className={`${i === v ? 'on' : ''} ${c === 'transparent' ? 'none' : ''} ${lookUnlocked(k, i, stats) ? '' : 'lk'}`} style={{ background: c }} />)}
                  </span>
                )}
              </div>
              <button type="button" className="cc-arrow coin" onClick={() => cycle(k, 1)} aria-label={`Next ${label.toLowerCase()}`} disabled={tip}><PixelIcon name="arrowR" /></button>
            </div>
          );
        })}
      </div>

      <div className="cc-record" aria-label="Your record">
        <span className="cc-record-k">Your record</span>
        {([['rounds', 'rounds'], ['kills', 'kills'], ['wins', 'wins'], ['saves', 'saves'], ['duelsWon', 'duels']] as [keyof ProfileStats, string][]).map(([key, label]) => (
          <span key={key} className="cc-stat"><b>{stats[key] ?? 0}</b>{label}</span>
        ))}
      </div>

      <DockActions>
        <div className="dock-act">
        {nag && locked.length > 0 && (
          <div className="cc-nag" role="alert">🔒 {locked.map(({ label }) => label).join(', ')}: locked. Pick another.</div>
        )}
        <div className="dock-act dock-act-row">
          <button type="button" className="nh-btn nh-btn-sm cc-random cc-random-dock" onClick={shuffle} disabled={tip} aria-label="Random look">
            <PixelIcon name="dice" /> Random
          </button>
          {!first && <button type="button" className="nh-linkbtn" onClick={() => { sfx.click(); onDone(); }} disabled={tip}>back</button>}
          <button type="button" className={`nh-btn nh-btn-big cc-save ${locked.length ? 'is-locked' : ''}`} onClick={save} disabled={tip} aria-disabled={locked.length > 0}>
            {tip ? 'Much obliged…' : locked.length ? '🔒 Locked' : "Lookin' good →"}
          </button>
        </div>
        </div>
      </DockActions>
    </div>
  );
}
