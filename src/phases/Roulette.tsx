import { memo, useEffect, useRef, type CSSProperties } from 'react';
import type { RoomProps } from '../props';
import type { Roulette as R } from '../../shared/types';
import { PixelArt, PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import { bayer, circle, ellipse } from '../pixel/dither';
import type { DrawFn } from '../pixel/sprites';
import { useNow } from '../net';
import { sfx } from '../sfx';

const TURNS = 6;
const ease = (p: number) => 1 - Math.pow(1 - p, 4);

export default function Roulette({ state, skew }: RoomProps) {
  const r = state.roulette;
  const nameOf = (appid: number) => state.board.find((g) => g.appid === appid)?.name ?? `App ${appid}`;
  if (!r) return <div className="roulette"><div className="roulette-title">Loading the cylinder…</div></div>;
  const finalists = Array.from(new Set(r.chambers));
  return (
    <div className={`roulette n${finalists.length}`}>
      <div className="roulette-spot" />
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
    for (let r = R * 0.62; r < R - 1; r += 0.5) {
      const x = Math.round(cx + Math.sin(a) * r), y = Math.round(cx - Math.cos(a) * r);
      c.fillStyle = PAL.metal0; c.fillRect(x - 1, y - 1, 3, 3);
      c.fillStyle = PAL.metal2; c.fillRect(x - 1, y - 1, 1, 1);
    }
  }
  // chamber sockets
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 * Math.PI) / 180;
    circle(c, Math.round(cx + Math.sin(a) * w * 0.28), Math.round(cx - Math.cos(a) * w * 0.28), Math.round(w * 0.135), PAL.metal0);
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
  useEffect(() => {
    if (done && !wasDone.current) sfx.cock();
    wasDone.current = done;
  }, [done]);
  // ratchet spin sound once at the start (not when joining mid-spin)
  useEffect(() => {
    const dt = r.startedAt - (Date.now() + skew);
    if (dt < -600) return;
    const t = window.setTimeout(() => sfx.spin(), Math.max(0, dt));
    return () => clearTimeout(t);
  }, [r.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const winner = r.chambers[r.target];
  return (
    <div className={`cyl-wrap ${done ? 'done' : ''}`}>
      <div className="cyl-stage" aria-label="revolver cylinder">
        <PixelSprite draw={drawHammer} w={16} h={16} className={`hammer ${done ? 'down' : ''}`} />
        <PixelSprite draw={drawNotch} w={7} h={4} className="cyl-notch" />
        <Chambers chambers={r.chambers} q={q} win={done ? r.target : -1} nameOf={nameOf} />
      </div>
      <div className={`cyl-winner ${done ? 'show' : ''}`}>{done ? nameOf(winner) : '\u00a0'}</div>
    </div>
  );
}

/** Everything that turns with the cylinder. Memoised so the per-frame clock above only re-renders it on 6deg steps. */
const Chambers = memo(function Chambers({ chambers, q, win, nameOf }: { chambers: number[]; q: number; win: number; nameOf: (a: number) => string }) {
  return (
    <div className="cyl-rot" style={{ transform: `rotate(${q}deg)` }}>
      <PixelSprite draw={drawCylinder} w={72} h={72} className="cyl-body" />
      {chambers.map((appid, k) => {
        const a = (k * 60 * Math.PI) / 180;
        const isWin = k === win;
        const style = { left: `${50 + 28 * Math.sin(a)}%`, top: `${50 - 28 * Math.cos(a)}%`, transform: `translate(-50%, -50%) rotate(${-q}deg)` } as CSSProperties;
        return (
          <div key={k} className={`chamber ${isWin ? 'win' : ''}`} style={style} title={nameOf(appid)}>
            <PixelArt appid={appid} name={nameOf(appid)} w={20} h={30} className="chamber-art" />
            <PixelSprite draw={isWin ? RING_WIN : RING} w={21} h={21} className="chamber-ring" />
          </div>
        );
      })}
    </div>
  );
});
