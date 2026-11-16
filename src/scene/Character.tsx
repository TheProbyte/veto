import { useId } from 'react';

const HATS = ['#2b1d14', '#15110e', '#4a3220', '#3a2a1e', '#6b5338', '#201812', '#3d2b22', '#55402b'];
const BANDS = ['#5a3b22', '#9e1b1b', '#1b1310', '#c9a227', '#2a1a10', '#7a5a3a', '#3a5470', '#1b1310'];
const COATS = ['#3b2416', '#23262b', '#4a2c1a', '#2c2a22', '#3a1f1a', '#1f2a2e', '#4b3b2a', '#2a1c24'];
const SCARVES = ['#9e1b1b', '#b5651d', '#3a5470', '#7a1414', '#6b1d4a', '#a8841f', '#9e1b1b', '#2f5d3a'];

const CROWNS = [
  'M39 46 C 38 22, 48 15, 60 21 C 72 15, 82 22, 81 46 Z', // cattleman, pinched
  'M41 46 L43 25 L77 25 L79 46 Z', // flat-top gambler
  'M43 46 L45 11 Q60 6 75 11 L77 46 Z', // tall
  'M41 46 C 40 18, 80 18, 79 46 Z', // round
];
const BRIM_W = [36, 30, 28, 44, 34, 40, 31, 38];

const BODY = 'M6 190 C 8 128, 22 102, 46 94 L 74 94 C 98 102, 112 128, 114 190 Z';
const HEAD = 'M46 62 C 46 44, 74 44, 74 62 C 74 76, 68 86, 60 86 C 52 86, 46 76, 46 62 Z';

export default function Character({ look, rimRight, lit }: { look: number; rimRight: boolean; lit: boolean }) {
  const uid = useId().replace(/:/g, '');
  const l = ((look % 8) + 8) % 8;
  const crown = CROWNS[l % 4];
  const bw = BRIM_W[l];
  const brim = `M${60 - bw} 47 Q 60 ${l === 3 ? 36 : 39} ${60 + bw} 47 Q 60 ${l === 5 ? 58 : 54} ${60 - bw} 47 Z`;
  const scarf = 'M42 90 Q60 100 78 90 L76 98 L60 124 L44 98 Z';
  const smoker = l === 0 || l === 5;
  const rim = lit ? '#ffb35c' : '#c97a3a';
  return (
    <svg className="char-svg" viewBox="0 0 120 190" aria-hidden>
      <defs>
        <linearGradient id={`r${uid}`} x1={rimRight ? 1 : 0} x2={rimRight ? 0 : 1} y1="0" y2="0">
          <stop offset="0" stopColor={rim} stopOpacity={lit ? 0.85 : 0.5} />
          <stop offset="0.16" stopColor={rim} stopOpacity={lit ? 0.25 : 0.1} />
          <stop offset="0.4" stopColor={rim} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`s${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.75" />
        </linearGradient>
        <mask id={`m${uid}`}>
          <g fill="#fff">
            <path d={BODY} /><path d={HEAD} /><path d={crown} /><path d={brim} /><path d={scarf} />
          </g>
        </mask>
      </defs>
      <path d={BODY} fill={COATS[l]} />
      <path d="M46 94 L57 140 L60 190 M74 94 L63 140 L60 190" stroke="#000" strokeOpacity=".45" strokeWidth="2" fill="none" />
      <path d="M52 76 L68 76 L70 96 L50 96 Z" fill="#1d120c" />
      <path d={HEAD} fill="#2a1a12" />
      {/* face shadow under the brim */}
      <path d="M46 52 Q60 70 74 52 L74 62 Q60 74 46 62 Z" fill="#000" opacity=".55" />
      <g className="char-eyes">
        <rect x="52" y="60" width="4" height="1.6" fill="#e8d5b5" opacity=".55" />
        <rect x="64" y="60" width="4" height="1.6" fill="#e8d5b5" opacity=".55" />
      </g>
      <path d={scarf} fill={SCARVES[l]} />
      <path d="M44 98 L60 124 L76 98" stroke="#000" strokeOpacity=".3" fill="none" />
      <path d={crown} fill={HATS[l]} />
      <path d={crown} fill={`url(#s${uid})`} opacity=".5" />
      <rect x="40" y="39" width="40" height="6" fill={BANDS[l]} opacity=".9" />
      <path d={brim} fill={HATS[l]} />
      <path d={brim} fill="#000" opacity=".25" />
      {smoker && (
        <g className="char-smoke">
          <line x1="64" y1="78" x2="74" y2="80" stroke="#e8d5b5" strokeWidth="2" />
          <circle className="ember" cx="75" cy="80" r="2" fill="#ff8a3d" />
        </g>
      )}
      <rect x="0" y="0" width="120" height="190" fill={`url(#r${uid})`} mask={`url(#m${uid})`} />
    </svg>
  );
}
