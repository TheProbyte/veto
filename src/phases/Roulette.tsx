import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RoomProps } from '../props';
import type { Roulette as R } from '../../shared/types';
import { PixelArt, PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import { bayer, circle, ellipse } from '../pixel/dither';
import { drawFlash, type DrawFn } from '../pixel/sprites';
import { PixelCover } from '../pixel/PixelCover';
import '../pixel/pixel.css';
import { useNow } from '../net';
import { sfx } from '../sfx';
import { useShotExtras } from './ShotExtras';

const TURNS = 6;

/** "3 left": the carousel boxes slide away and the cylinder slides in (only when we arrive at the start of the spin). */
function Intro({ r, skew, finalists, nameOf }: { r: R; skew: number; finalists: number[]; nameOf: (a: number) => string }) {
  const [show] = useState(() => Date.now() + skew - r.startedAt < 600);
  const [on, setOn] = useState(show);
  useEffect(() => {
    if (!show) return;
    sfx.cylinderOpen();
    const t = window.setTimeout(() => setOn(false), 800);
    return () => clearTimeout(t);
  }, [show]);
  if (!on) return null;
  return (
    <div className="px-intro-boxes" aria-hidden>
      {finalists.slice(0, 3).map((a) => <div key={a}><PixelArt appid={a} name={nameOf(a)} /></div>)}
    </div>
  );
}
const ease = (p: number) => 1 - Math.pow(1 - p, 4);

export default function Roulette({ state, skew }: RoomProps) {
  const r = state.roulette;
  useShotExtras(state, skew);
  const nameOf = (appid: number) => state.board.find((g) => g.appid === appid)?.name ?? `App ${appid}`;
  if (!r) return <div className="roulette"><div className="roulette-title">Loading the cylinder…</div></div>;
  const finalists = Array.from(new Set(r.chambers));
  return (
    <div className={`roulette n${finalists.length}`}>
      <div className="roulette-spot" />
      <Intro r={r} skew={skew} finalists={finalists} nameOf={nameOf} />
      <div className="roulette-title">The cylinder decides</div>
      <Cylinder r={r} skew={skew} nameOf={nameOf} />
      <ul className="finalists">
        {finalists.map((a) => <li className="px-box" key={a}>{nameOf(a)}</li>)}
      </ul>
    </div>
  );
}

const drawCylinder: DrawFn = (c, w) => {
  const cx = (w - 1) / 2, R = w / 2 - 1;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cx, d = Math.hypot(dx, dy);
    if (d > R) continue;
    // lit from top-left: dithered gunmetal bands
    const l = 0.32 - (dx + dy) / (w * 1.6) - (d / R) * 0.2 + (bayer(x, y) - 0.5) * 0.18;
    const col = d > R - 1.2 ? PAL.metal0 : l > 0.72 ? PAL.metal4 : l > 0.5 ? PAL.metal3 : l > 0.26 ? PAL.metal2 : l > 0.04 ? PAL.metal1 : PAL.metal0;
    c.fillStyle = col; c.fillRect(x, y, 1, 1);
  }
  // flutes between chambers
  for (let k = 0; k < 6; k++) {
    const a = ((k * 60 + 30) * Math.PI) / 180;
    for (let r = R * 0.86; r < R - 1; r += 0.5) {
      const x = Math.round(cx + Math.sin(a) * r), y = Math.round(cx - Math.cos(a) * r);
      c.fillStyle = PAL.metal0; c.fillRect(x - 1, y - 1, 3, 3);
      c.fillStyle = PAL.metal2; c.fillRect(x - 1, y - 1, 1, 1);
    }
  }
  // chamber sockets
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 * Math.PI) / 180;
    circle(c, Math.round(cx + Math.sin(a) * w * 0.33), Math.round(cx - Math.cos(a) * w * 0.33), Math.round(w * 0.155), PAL.metal0);
  }
  circle(c, Math.round(cx), Math.round(cx), Math.round(w * 0.09), PAL.metal0);
  circle(c, Math.round(cx), Math.round(cx), Math.round(w * 0.06), PAL.metal2);
  c.fillStyle = PAL.metal4; c.fillRect(Math.round(cx) - 1, Math.round(cx) - 1, 1, 1);
};

const ringDraw = (col: string, hi: string): DrawFn => (c, w) => {
  const cx = (w - 1) / 2;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cx);
    if (d > w / 2 - 2.2 && d <= w / 2) { c.fillStyle = (x + y) < w * 0.8 ? hi : col; c.fillRect(x, y, 1, 1); }
  }
};
const RING = ringDraw(PAL.metal0, PAL.metal1);
const RING_WIN = ringDraw(PAL.lamp2, PAL.lamp0);

const drawHammer: DrawFn = (c) => {
  c.fillStyle = PAL.metal0; c.fillRect(3, 0, 10, 3); c.fillRect(4, 3, 8, 12);
  c.fillStyle = PAL.metal2; c.fillRect(4, 0, 8, 2); c.fillRect(5, 3, 6, 11);
  c.fillStyle = PAL.metal3; c.fillRect(5, 3, 2, 11);
  for (let y = 0; y < 2; y++) for (let x = 4; x < 12; x += 2) { c.fillStyle = PAL.metal1; c.fillRect(x + y, y, 1, 1); }
  ellipse(c, 8, 15, 3, 1, PAL.metal1);
};
const drawNotch: DrawFn = (c) => {
  for (let y = 0; y < 4; y++) { c.fillStyle = y === 0 ? PAL.lamp0 : PAL.lamp1; c.fillRect(y, y, 7 - y * 2, 1); }
};

function Cylinder({ r, skew, nameOf }: { r: R; skew: number; nameOf: (a: number) => string }) {
  const now = useNow(skew);
  const p = Math.max(0, Math.min(1, (now - r.startedAt) / Math.max(1, r.duration)));
  const end = -(r.target * 60 + TURNS * 360);
  const angle = end * ease(p);
  const done = p >= 1;
  const q = Math.round(angle / 6) * 6; // rotate in 6deg steps for a pixel feel

  const passed = Math.floor(-angle / 60 + 0.5);
  const lastPassed = useRef(passed);
  useEffect(() => {
    if (passed > lastPassed.current) sfx.click();
    lastPassed.current = passed;
  }, [passed]);
  const wasDone = useRef(done);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (done && !wasDone.current) {
      sfx.cock();
      setLanded(true);
      const t = window.setTimeout(() => setLanded(false), 600);
      wasDone.current = done;
      return () => clearTimeout(t);
    }
    wasDone.current = done;
  }, [done]);
  // ratchet spin sound once at the start (not when joining mid-spin)
  useEffect(() => {
    const dt = r.startedAt - (Date.now() + skew);
    if (dt < -600) return;
    const t = window.setTimeout(() => sfx.spin(), Math.max(0, dt));
    return () => clearTimeout(t);
  }, [r.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const [intro] = useState(() => Date.now() + skew - r.startedAt < 600);
  const winner = r.chambers[r.target];
  const under = ((passed % 6) + 6) % 6; // chamber under the hammer right now
  const spinning = p > 0 && !done;
  return (
    <div className={`cyl-wrap px-cyl ${done ? 'done' : ''}`}>
      <div className={`px-readout ${done ? 'locked' : spinning && passed % 2 ? 'flick' : ''}`} aria-live={done ? 'polite' : 'off'}>
        <span className="arrow">▶</span>{nameOf(done ? winner : r.chambers[under])}
      </div>
      <div className={`cyl-stage ${intro ? 'px-cyl-in' : ''}`} aria-label="revolver cylinder">
        <PixelSprite draw={drawHammer} w={16} h={16} className={`hammer ${done ? 'down' : ''}`} />
        <PixelSprite draw={drawNotch} w={7} h={4} className="cyl-notch" />
        {landed && <PixelSprite draw={drawFlash} w={21} h={21} className="px-hammer-flash" />}
        <Chambers chambers={r.chambers} q={q} win={done ? r.target : -1} under={done ? -1 : under} nameOf={nameOf} />
      </div>
      {landed && <div className="px-cyl-flash" />}
      <div className={`cyl-winner ${done ? 'show' : ''}`}>{done ? nameOf(winner) : '\u00a0'}</div>
    </div>
  );
}

/** Everything that turns with the cylinder. Memoised so the per-frame clock above only re-renders it on 6deg steps. */
const Chambers = memo(function Chambers({ chambers, q, win, under, nameOf }: { chambers: number[]; q: number; win: number; under: number; nameOf: (a: number) => string }) {
  return (
    <div className="cyl-rot" style={{ transform: `rotate(${q}deg)` }}>
      <PixelSprite draw={drawCylinder} w={96} h={96} className="cyl-body" />
      {chambers.map((appid, k) => {
        const a = (k * 60 * Math.PI) / 180;
        const isWin = k === win;
        const style = { left: `${50 + 33 * Math.sin(a)}%`, top: `${50 - 33 * Math.cos(a)}%`, transform: `translate(-50%, -50%) rotate(${-q}deg)` } as CSSProperties;
        return (
          <div key={k} className={`px-chamber ${isWin ? 'win' : ''} ${k === under ? 'under' : ''}`} style={style} title={nameOf(appid)}>
            <div className="px-chamber-art"><PixelCover appid={appid} name={nameOf(appid)} kind="square" /></div>
            <PixelSprite draw={isWin ? RING_WIN : RING} w={25} h={25} className="px-chamber-ring" />
            <span className="px-chamber-label">{nameOf(appid)}</span>
          </div>
        );
      })}
    </div>
  );
});
