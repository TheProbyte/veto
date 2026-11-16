import { useEffect, useRef, useState } from 'react';
import type { RoomProps } from '../props';
import type { Roulette as R } from '../../shared/types';
import { boxArt, headerArt } from '../../shared/types';
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
    <div className="roulette">
      <div className="roulette-spot" />
      <div className="roulette-title">The cylinder decides</div>
      <Cylinder r={r} skew={skew} nameOf={nameOf} />
      <ul className="finalists">
        {finalists.map((a) => <li key={a}>{nameOf(a)}</li>)}
      </ul>
    </div>
  );
}

function Cylinder({ r, skew, nameOf }: { r: R; skew: number; nameOf: (a: number) => string }) {
  const now = useNow(skew);
  const p = Math.max(0, Math.min(1, (now - r.startedAt) / Math.max(1, r.duration)));
  const end = -(r.target * 60 + TURNS * 360);
  const angle = end * ease(p);
  const done = p >= 1;

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

  const winner = r.chambers[r.target];
  return (
    <div className={`cyl-wrap ${done ? 'done' : ''}`}>
      <svg className="cyl" viewBox="-200 -230 400 430" aria-label="revolver cylinder">
        <defs>
          <radialGradient id="cyl-metal" cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#8a8f96" />
            <stop offset=".35" stopColor="#4a4f56" />
            <stop offset=".75" stopColor="#24272b" />
            <stop offset="1" stopColor="#0e0f11" />
          </radialGradient>
          <linearGradient id="cyl-sheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".35" />
            <stop offset=".4" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="cyl-hole" cx="50%" cy="50%" r="50%">
            <stop offset=".78" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".85" />
          </radialGradient>
          {r.chambers.map((_, k) => (
            <clipPath key={k} id={`ch-${k}`}><circle r="44" /></clipPath>
          ))}
          <filter id="cyl-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        {/* hammer */}
        <g className={`hammer ${done ? 'down' : ''}`}>
          <path d="M-18 -228 L18 -228 L22 -170 L-22 -170 Z" fill="#2a2d31" stroke="#0b0c0d" strokeWidth="3" />
          <path d="M-14 -224 L-4 -224 L-6 -176 L-16 -176 Z" fill="#6c727a" opacity=".6" />
          <path d="M-30 -232 L30 -232 L26 -218 L-26 -218 Z" fill="#1a1c1f" />
        </g>

        <g transform={`rotate(${angle})`}>
          <circle r="182" fill="url(#cyl-metal)" stroke="#0a0b0c" strokeWidth="5" />
          {Array.from({ length: 6 }, (_, k) => {
            const a = ((k * 60 + 30) * Math.PI) / 180;
            return <path key={k} d={`M${Math.sin(a) * 120} ${-Math.cos(a) * 120} L${Math.sin(a) * 178} ${-Math.cos(a) * 178}`} stroke="#0d0e10" strokeWidth="14" strokeLinecap="round" opacity=".7" />;
          })}
          <circle r="182" fill="url(#cyl-sheen)" />
          {r.chambers.map((appid, k) => {
            const a = (k * 60 * Math.PI) / 180;
            const x = Math.sin(a) * 112, y = -Math.cos(a) * 112;
            const win = done && k === r.target;
            return (
              <g key={k} transform={`translate(${x} ${y}) rotate(${-angle})`}>
                {win && <circle r="58" fill="#ffb35c" filter="url(#cyl-glow)" className="win-glow" />}
                <circle r="50" fill="#08090a" stroke={win ? '#ffb35c' : '#15171a'} strokeWidth={win ? 5 : 4} />
                <ChamberArt appid={appid} k={k} name={nameOf(appid)} />
                <circle r="44" fill="url(#cyl-hole)" />
              </g>
            );
          })}
          <circle r="34" fill="#1a1c1f" stroke="#0a0b0c" strokeWidth="4" />
          <circle r="12" fill="#3a3e44" />
        </g>
        {/* top pointer notch */}
        <path d="M-10 -168 L10 -168 L0 -150 Z" fill="#ffb35c" opacity=".9" />
      </svg>
      <div className={`cyl-winner ${done ? 'show' : ''}`}>{done ? nameOf(winner) : ' '}</div>
    </div>
  );
}

function ChamberArt({ appid, k, name }: { appid: number; k: number; name: string }) {
  const [fb, setFb] = useState(0); // 0 box art, 1 header art, 2 name only
  const short = name.length > 14 ? name.slice(0, 13) + '…' : name;
  if (fb >= 2) {
    return (
      <g clipPath={`url(#ch-${k})`}>
        <rect x="-44" y="-66" width="88" height="132" fill="#2a1a10" />
        <text textAnchor="middle" y="4" fontFamily="Rye, serif" fontSize="11" fill="#e8d5b5">{short}</text>
      </g>
    );
  }
  return (
    <image
      href={fb ? headerArt(appid) : boxArt(appid)}
      x="-44" y="-66" width="88" height="132"
      preserveAspectRatio="xMidYMid slice"
      clipPath={`url(#ch-${k})`}
      onError={() => setFb((f) => f + 1)}
    >
      <title>{name}</title>
    </image>
  );
}
