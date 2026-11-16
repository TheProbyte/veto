import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { RoomProps } from '../props';
import { BADGES, EMOTES, type Phase, type Player, type RoomEvent, type ShotEvent } from '../../shared/types';
import { sfx } from '../sfx';
import TinStar from './TinStar';
import ShotFX from './ShotFX';
import SoundMenu from './SoundMenu';
import { DockBoard, DockSlot, play } from './Dock';
import { BUZZ, buzz, isPhone, reducedMotion } from './haptics';
import { PixelScene, type SceneApi } from '../pixel/PixelCanvas';
import { computeLayout, seatGeom, type Layout, type SceneData, type SceneFX, type ScenePlayer } from '../pixel/scene';
import { MiniBust } from '../pixel/BustPreview';
import Narrator from './Narrator';
import { playVoice } from '../voice';
import EmoteBar from './EmoteBar';
import ContextMenu from './ContextMenu';
import { useDeskChat } from './ChatPanel';
import { setSceneScale, textUnit } from '../ui/scale';
import '../ui/cursors';
import PixelIcon, { hasPixelIcon } from '../ui/PixelIcon';

/** piano player's tempo per music mode (fallback until sfx.getMusicBpm exists; matches src/music.ts grooves) */
const BPM: Record<string, number> = { lobby: 76, veto: 92, roulette: 92, result: 76, off: 0 };
const EMOTE_SFX: Record<string, () => void> = {
  // recorded barks (public/voice/emote_*.mp3) win over the synth versions when they exist
  tip: () => sfx.swish(), spit: () => sfx.spit(), clap: () => sfx.clap(), shrug: () => sfx.swish(),
  yeehaw: () => { if (!playVoice('emote_yeehaw', 'emote')) sfx.yeehaw(); },
  laugh: () => { playVoice('emote_laugh', 'emote'); },
  drink: () => { if (!playVoice('emote_drink', 'emote')) sfx.glass(); },
  angry: () => { sfx.steam(); playVoice('emote_angry', 'emote'); },
};
/** caption over the head (always) + an optional sound word that pops beside the face (delay ms) */
const EMOTE_TXT: Record<string, { cap: string; word?: string; at?: number }> = {
  tip: { cap: 'tips hat' },
  spit: { cap: 'spits', word: 'PTOO!', at: 300 },
  laugh: { cap: 'laughs', word: 'HA HA', at: 120 },
  yeehaw: { cap: 'hollers', word: 'YEEHAW!', at: 200 },
  clap: { cap: 'slow claps' },
  shrug: { cap: 'shrugs' },
  angry: { cap: 'fumes' },
  drink: { cap: 'drinks', word: 'ahh…', at: 1400 },
};
/** how long the caption stays (the canvas animations run 1.6-2.1s) */
const EMOTE_POP_MS = 2300;
interface Toast { id: number; p: Player; text: string }

const mq = (q: string) => { try { return !!window.matchMedia?.(q).matches; } catch { return false; } };
/** landscape phone: lobby/nominate put the scene on the left half and the panel on the right */
const landPhone = () => mq('(max-height: 500px) and (orientation: landscape)');

/** like usePixelLayout, but the scene can be told to use only the left half of the screen */
function useStageLayout(split: boolean): Layout {
  const calc = () => computeLayout(split ? Math.ceil(window.innerWidth / 2) : window.innerWidth, window.innerHeight);
  const [L, setL] = useState(calc);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { const n = calc(); setL((o) => (o.W === n.W && o.H === n.H && o.P === n.P && o.vw === n.vw ? o : n)); });
    };
    on();
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, [split]); // eslint-disable-line react-hooks/exhaustive-deps
  return L;
}

interface Wipe { id: number; from: Phase; to: Phase; draw: boolean; closing: boolean }
const WIPE = { draw: { close: 420, hold: 640, open: 420 }, soft: { close: 220, hold: 70, open: 260 } };

export default function Saloon({ children, ...rp }: RoomProps & { children: ReactNode }) {
  const { state, me } = rp;
  const [fx, setFx] = useState<ShotEvent | null>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const [land, setLand] = useState(landPhone);
  useEffect(() => {
    const on = () => setLand(landPhone());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // ---- phase-change wipe: detected during render so the new phase never paints before the iris closes
  const [seenPhase, setSeenPhase] = useState<Phase>(state.phase);
  const [wipe, setWipe] = useState<Wipe | null>(null);
  if (seenPhase !== state.phase) {
    setSeenPhase(state.phase);
    const draw = seenPhase === 'nominate' && state.phase === 'veto';
    setWipe(reducedMotion() ? (draw ? { id: Date.now(), from: seenPhase, to: state.phase, draw, closing: false } : null)
      : { id: Date.now(), from: seenPhase, to: state.phase, draw, closing: true });
  }
  const frozen = useRef<ReactNode>(children);
  const closing = !!wipe?.closing;
  // (a render that just detected the phase change is thrown away and redone; never let it snapshot the new phase)
  if (!closing && seenPhase === state.phase) frozen.current = children;
  const phase: Phase = closing ? wipe!.from : state.phase;
  useEffect(() => {
    if (!wipe) return;
    const T = wipe.draw ? WIPE.draw : WIPE.soft;
    const timers: number[] = [];
    // drawSting lands ~0.45s after the call, i.e. right as DRAW! slams in at T.close
    if (wipe.draw) { play('cardRiffle'); timers.push(window.setTimeout(() => { if (!play('drawSting')) sfx.shot(); }, Math.max(0, T.close - 450))); }
    if (wipe.closing) timers.push(window.setTimeout(() => setWipe((w) => (w && w.id === wipe.id ? { ...w, closing: false } : w)), T.close + T.hold / 2));
    timers.push(window.setTimeout(() => setWipe((w) => (w && w.id === wipe.id ? null : w)), T.close + T.hold + T.open + 40));
    return () => timers.forEach(clearTimeout);
  }, [wipe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const split = land && (phase === 'lobby' || phase === 'nominate');
  const layout = useStageLayout(split);
  // the UI's pixel unit follows the scene's (see src/ui/scale.ts)
  useLayoutEffect(() => { setSceneScale(layout.P); }, [layout.P]);
  useLayoutEffect(() => () => setSceneScale(null), []);
  const shotRef = useRef<SceneData['shot']>(undefined);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // ---- scene FX bus (emotes, lightning, doors, slow-mo): the canvas loop drains the queue
  const sceneFx = useRef<SceneFX>(null as unknown as SceneFX);
  if (!sceneFx.current) sceneFx.current = {
    queue: [],
    tempo: () => {
      if (sfx.isMuted() || sfx.getMusicVolume() < 0.01) return 0;
      // the audio side knows the real tempo (recorded or procedural); fall back to the procedural grooves
      const bpm = (sfx as unknown as { getMusicBpm?: () => number }).getMusicBpm?.();
      return typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : BPM[sfx.getMusicMode()] ?? 0;
    },
    onBolt: (big) => { window.setTimeout(() => sfx.thunder(big ? 0.85 : 0.3 + Math.random() * 0.35), big ? 500 : 900 + Math.random() * 1800); },
    onCat: (e) => { if (e === 'shatter') sfx.shatter(); },
  };
  const push = (e: SceneFX['queue'][number]) => { const q = sceneFx.current.queue; q.push(e); if (q.length > 24) q.splice(0, q.length - 24); };
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;
  // the storm keeps going through the result (the result sits in the same stormy saloon)
  const unlocked = useRef(false);

  // ---- emotes (transient room events). Typed 'say' lines are ignored: the saloon is emotes only.
  const [pops, setPops] = useState<Record<string, { emote: string; id: number }>>({});
  useEffect(() => rp.on((e: RoomEvent) => {
    if (e.t !== 'emote' || !(e.emote in EMOTES)) return;
    push({ k: 'emote', pid: e.pid, emote: e.emote, at: performance.now() });
    EMOTE_SFX[e.emote]?.();
    const id = Date.now() + Math.random();
    setPops((m) => ({ ...m, [e.pid]: { emote: e.emote, id } }));
    window.setTimeout(() => setPops((m) => { if (m[e.pid]?.id !== id) return m; const n = { ...m }; delete n[e.pid]; return n; }), EMOTE_POP_MS);
  }), [rp.on]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- doors + reconnect toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const conn = useRef<Map<string, Player> | null>(null);
  useEffect(() => {
    const prev = conn.current;
    conn.current = new Map(state.players.map((p) => [p.id, p]));
    if (!prev) return;
    let door: 0 | 1 | 2 = 0; // 1 join, 2 leave
    const add: Toast[] = [];
    for (const p of state.players) {
      const o = prev.get(p.id);
      if (!o) { door = door || 1; continue; }
      if (o.connected !== p.connected && p.id !== me && !p.bot) {
        add.push({ id: Date.now() + Math.random(), p, text: p.connected ? `${p.name} is back` : `${p.name} stepped out` });
        door = p.connected ? door || 1 : 2;
      }
    }
    for (const id of prev.keys()) if (!conn.current.has(id)) door = 2;
    if (door) { push({ k: 'doors', leave: door === 2, at: performance.now() }); sfx.doors(); }
    if (!add.length) return;
    setToasts((ts) => [...ts, ...add].slice(-2));
    for (const tt of add) window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== tt.id)), 2500);
  }, [state.players]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the shelf cat: tap / click it (only on bare background: never steals a press from the UI)
  const sceneApi = useRef<SceneApi | null>(null);
  useEffect(() => {
    const BARE = '.px-scene, .scene, .seats, .saloon, .saloon-ui, .saloon-front, .saloon-stage, .front-top';
    const bare = (t: EventTarget | null) => t instanceof Element && t.matches(BARE);
    const busy = () => !!document.querySelector('.wipe, .fx, .duel');
    let down: { id: number; x: number; y: number; at: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.isPrimary && e.button === 0 && bare(e.target) ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down; down = null;
      if (!d || d.id !== e.pointerId || performance.now() - d.at > 700 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
      if (busy()) return;
      const k = sceneApi.current?.pokeCat(e.clientX, e.clientY, e.pointerType !== 'mouse');
      if (!k) return;
      sfx.unlock();
      if (k === 'meow') sfx.meow();
      else if (k === 'hiss') window.setTimeout(() => sfx.hiss(), 120);
      else if (k === 'leap') window.setTimeout(() => sfx.swish(), 160);
      else if (k === 'knock') sfx.meow(true);
    };
    const onCancel = () => { down = null; };
    // hover cursor (mouse): on <html>, since React owns .saloon's className
    let raf = 0, mx = 0, my = 0, tgt: EventTarget | null = null;
    const root = document.documentElement;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      mx = e.clientX; my = e.clientY; tgt = e.target;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; root.classList.toggle('cat-hover', bare(tgt) && !busy() && !!sceneApi.current?.catAt(mx, my)); });
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('pointermove', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('pointermove', onMove, true);
      cancelAnimationFrame(raf); root.classList.remove('cat-hover');
    };
  }, []);

  // ---- slow-mo vignette
  const [slow, setSlow] = useState(0);

  // first gesture: unlock audio + start ambience (+ the rain, unless the storm already cleared)
  useEffect(() => {
    const go = () => { sfx.unlock(); sfx.ambience(true); unlocked.current = true; sfx.rain(true); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  }, []);

  // chair scrape + nameplate pop when someone new sits down
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const ids = new Set(state.players.map((p) => p.id));
    const added: string[] = [];
    if (seen.current) for (const id of ids) if (!seen.current.has(id)) added.push(id);
    seen.current = ids;
    if (!added.length) return;
    sfx.chair();
    setFresh((f) => new Set([...f, ...added]));
    const t = window.setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((id) => n.delete(id)); return n; }), 1400);
    return () => clearTimeout(t);
  }, [state.players]);

  // shot animations (never on first mount)
  const lastId = useRef<number | undefined>(state.lastShot?.id);
  useEffect(() => {
    const s = state.lastShot;
    if (!s || s.id === lastId.current) return;
    lastId.current = s.id;
    shotRef.current = { at: performance.now(), actor: s.actor, kind: s.kind };
    setFx(s);
    const timers: number[] = [];
    const P = layout.P;
    // phones get a shorter FX (CSS uses --fxd too) and no shake of the scrolling overlay:
    // a transform there would re-anchor the fixed action bar mid-animation.
    const phone = isPhone();
    const dur = phone ? 1600 : 2700; // the CSS animation (--fxd)
    const life = Math.max(dur, 3000); // the overlay stays up through the server's pause between shots (last words)
    // big lightning + thunder on the finale shot and on revenge; the scene slows down for the finale
    if (s.slowmo || s.revenge) {
      push({ k: 'bolt', big: true, at: performance.now() });
      timers.push(window.setTimeout(() => sfx.thunder(s.slowmo ? 1 : 0.85), s.slowmo ? 420 : 300));
    }
    if (s.slowmo) {
      push({ k: 'slowmo', at: performance.now() });
      const sid = s.id;
      setSlow(sid);
      timers.push(window.setTimeout(() => setSlow((x) => (x === sid ? 0 : x)), 1600));
    }
    const shake = !phone && !reducedMotion();
    const stepKf = (pts: [number, number][]): Keyframe[] => pts.map(([x, y]) => ({ transform: `translate(${x * P}px, ${y * P}px)`, easing: 'steps(1, end)' }));
    if (s.kind === 'ricochet') {
      sfx.ricochet();
      buzz(BUZZ.ricochet);
      if (shake) frontRef.current?.animate(stepKf([[0, 0], [-1, 0], [1, 0], [-1, 0], [0, 0]]), { duration: 260 });
    } else {
      sfx.shot();
      buzz(s.kind === 'crack' ? BUZZ.crack : BUZZ.hit);
      if (shake) frontRef.current?.animate(stepKf([[0, 0], [-3, 2], [3, -2], [-2, 1], [2, -1], [-1, 0], [0, 0]]), { duration: 440 });
      if (s.kind !== 'crack') timers.push(window.setTimeout(() => sfx.stamp(), Math.round(dur * 0.252)));
    }
    timers.push(window.setTimeout(() => setFx((f) => (f && f.id === s.id ? null : f)), life));
    return () => timers.forEach(clearTimeout);
  }, [state.lastShot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const veto = state.phase === 'veto';
  const shooter = veto ? state.turnOrder[state.turnIdx] : undefined;

  // the "LAST TIME" poster: the previous round's game (at the result, the newest entry is this round's)
  const hist = state.history ?? [];
  const posterId = hist[hist.length - (state.phase === 'result' && state.result ? 2 : 1)]?.appid ?? 0;
  const data: SceneData = useMemo(() => ({
    players: state.players.map((p) => ({ id: p.id, seat: p.seat, look: p.look, style: p.style, connected: p.connected, bot: p.bot }) as ScenePlayer),
    shooter,
    // the result is shown in the normal poker room: no dawn sky (scene.ts keys dawn off 'result'), barely dimmed
    phase: state.phase === 'result' ? 'lobby' : state.phase,
    shot: shotRef.current,
    dimAll: state.phase === 'roulette' ? 0.45 : state.phase === 'result' ? 0.9 : 1,
    fx: sceneFx.current,
    poster: posterId,
  }), [state.players, shooter, state.phase, fx, posterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stageTop = layout.tableTop * layout.P + (layout.portrait ? 30 : 44);
  const seats = useMemo(() => state.players.map((p) => p.seat), [state.players]);
  const table = phase === 'lobby' || phase === 'nominate';
  const chat = useDeskChat(state.phase);

  return (
    <div className={`saloon phase-${phase} ${shooter ? 'has-shooter' : ''} ${table ? 'has-dock' : ''} ${split ? 'is-split' : ''} ${chat.desk ? (chat.open ? 'has-chat' : 'has-chat-tab') : ''}`} style={{ '--P': `${layout.P}px`, '--stage-top': `${stageTop}px` } as CSSProperties}>
      <div className="scene">
        <PixelScene layout={layout} data={data} api={sceneApi} />
        <div className={`seats ${layout.portrait && state.players.length > 4 ? 'has-back' : ''}`}>
          {state.players.map((p) => (
            <Seat key={p.id} p={p} me={me} L={layout} seats={seats} shooter={shooter} order={veto ? state.turnOrder.indexOf(p.id) : -1} turnIdx={state.turnIdx} n={state.turnOrder.length} fresh={fresh.has(p.id)} pop={pops[p.id]} />
          ))}
        </div>
      </div>
      {slow > 0 && <div className="slowmo-vig" aria-hidden />}

      <div className="saloon-ui">
        <div className="front-top" aria-hidden />
        <div className="saloon-front" ref={frontRef}>
          <DockSlot.Provider value={slot}>
            <div className="saloon-stage">{closing ? frozen.current : children}</div>
          </DockSlot.Provider>
        </div>
        {table && (
          <div className="dock" role="region" aria-label="The dealer's table">
            <div className="dock-in">
              {phase === 'nominate' && <DockBoard board={state.board} players={state.players} me={me} />}
              <div className="dock-actions" ref={setSlot} />
            </div>
          </div>
        )}
        <Narrator {...rp} />
        <EmoteBar {...rp} />
      </div>

      {toasts.length > 0 && (
        <div className="px-toasts" role="status">
          {toasts.map((t) => (
            <div key={t.id} className={`px-toast ${t.p.connected ? 'in' : 'out'}`}>
              <MiniBust p={t.p} />
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {fx && <ShotFX key={fx.id} shot={fx} board={state.board} players={state.players} />}

      {wipe && <PhaseWipe key={wipe.id} w={wipe} />}

      <SoundMenu phase={state.phase} />
      <ContextMenu room={rp} />
    </div>
  );
}

/** pixel iris: black tiles close in rings toward the centre, then open from it (opacity only) */
function PhaseWipe({ w }: { w: Wipe }) {
  const T = w.draw ? WIPE.draw : WIPE.soft;
  const tiles = useMemo(() => {
    if (!w.closing) return [];
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = Math.max(26, Math.ceil(Math.max(vw, vh) / 26));
    const cols = Math.ceil(vw / size), rows = Math.ceil(vh / size);
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    const maxD = Math.hypot(cx, cy) || 1;
    const out: { x: number; y: number; d: number }[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      // quantize into rings so it reads as a stepped pixel iris
      const d = Math.round((Math.hypot((x - cx) * 1.0, (y - cy) * 1.0) / maxD) * 7) / 7;
      out.push({ x, y, d });
    }
    return out.map((t) => ({ ...t, size }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`wipe ${w.draw ? 'is-draw' : ''} ${w.closing ? '' : 'is-instant'}`} aria-hidden style={{ '--wc': `${T.close}ms`, '--wh': `${T.hold}ms`, '--wo': `${T.open}ms` } as CSSProperties}>
      {tiles.map((t, i) => (
        <i key={i} style={{ left: t.x * t.size, top: t.y * t.size, width: t.size + 1, height: t.size + 1,
          '--d1': `${Math.round((1 - t.d) * T.close * 0.85)}ms`, '--d2': `${Math.round(T.close + T.hold + t.d * T.open * 0.85)}ms` } as CSSProperties} />
      ))}
      {w.draw && <div className="draw-title"><span>DRAW!</span></div>}
    </div>
  );
}

function Seat({ p, me, L, seats, shooter, order, turnIdx, n, fresh, pop }: { p: Player; me: string; L: Layout; seats: number[]; shooter?: string; order: number; turnIdx: number; n: number; fresh?: boolean; pop?: { emote: string; id: number } }) {
  const g = seatGeom(L, p.seat, seats);
  const lit = shooter === p.id;
  const dark = !!shooter && !lit;
  const rel = order >= 0 && n > 0 ? (order - turnIdx + n) % n : -1;
  const P = L.P;
  const style = {
    left: g.x * P,
    top: g.top * P,
    width: g.w * P,
    height: (g.edge - g.top) * P,
    zIndex: Math.round((1 - g.depth) * 10) + (lit ? 20 : 0),
    ...(g.slot ? { '--slot': `${Math.floor(g.slot * P) - 6}px` } : {}),
  } as CSSProperties;
  return (
    <div className={`seat ${lit ? 'lit' : ''} ${dark ? 'dark' : ''} ${p.connected ? '' : 'ghost'} ${p.id === me ? 'me' : ''} ${g.back ? 'back' : ''} ${g.slot ? 'row' : ''} ${fresh ? 'fresh' : ''}`} style={style}>
      {p.steam?.avatar && <img className="seat-avatar" src={p.steam.avatar} alt="" draggable={false} />}
      <div className="seat-plate">
        {!p.shieldUsed && <TinStar size={textUnit(P) * 6} />}
        {p.host && <PixelIcon name="host" className="seat-host" title="Host" />}
        <span className="seat-name">{p.name}{p.id === me && <span className="seat-you"> (you)</span>}</span>
        {p.bot && <span className="seat-bot" title="Practice bot">BOT</span>}
        {!!p.badges?.length && (
          <span className="seat-badges">
            {p.badges.slice(0, 3).map((b) => BADGES[b] && <i key={b} className="seat-badge" title={`${BADGES[b].label}: ${BADGES[b].desc}`} aria-label={BADGES[b].label}><PixelIcon name={b} /></i>)}
          </span>
        )}
      </div>
      {pop && <EmotePop key={pop.id} emote={pop.emote} name={p.name} cx={g.x * P} high={rel >= 0 || !!g.back} flip={g.x * P > window.innerWidth * 0.5}
        lift={pop.emote === 'tip' ? Math.round(13 * g.scale * P) : 0} />}
      {rel >= 0 && <div className={`seat-order ${rel === 0 ? 'now' : rel === 1 ? 'next' : ''}`}>{rel === 0 ? 'SHOOTING' : rel === 1 ? 'NEXT' : `#${rel + 1}`}</div>}
      {!p.connected && <div className="seat-away">stepped out</div>}
    </div>
  );
}

/** caption + icon over the head (clamped to the viewport), and a bouncing sound word beside the face */
function EmotePop({ emote, name, cx, high, flip, lift }: { emote: string; name: string; cx: number; high: boolean; flip: boolean; lift: number }) {
  const t = EMOTE_TXT[emote];
  const icon = EMOTES[emote as keyof typeof EMOTES]?.icon;
  const vw = window.innerWidth;
  return (
    <>
      <div className={`seat-pop emote-${emote} ${high ? 'high' : ''}`} role="status" aria-label={`${name} ${t?.cap ?? emote}`}
        style={{ '--cx': `${Math.round(cx)}px`, '--rx': `${Math.round(vw - cx)}px`, '--lift': `${lift}px` } as CSSProperties}>
        <div className="seat-pop-in">
          <span className="seat-pop-icon" aria-hidden>{hasPixelIcon(emote) ? <PixelIcon name={emote} /> : icon}</span>
          <span className="seat-pop-cap" aria-hidden>{t?.cap ?? emote}</span>
        </div>
      </div>
      {t?.word && (
        <div className={`seat-word emote-${emote} ${flip ? 'flip' : ''}`} aria-hidden style={{ '--at': `${t.at ?? 0}ms` } as CSSProperties}>
          {[...t.word].map((ch, i) => <i key={i} style={{ '--i': i } as CSSProperties}>{ch === ' ' ? '\u00a0' : ch}</i>)}
        </div>
      )}
    </>
  );
}
