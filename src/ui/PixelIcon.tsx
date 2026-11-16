/**
 * Tiny pixel icons (8x8 maps -> crisp SVG) that replace colour emoji in the UI. Sized in CSS by
 * `.pxi` to 8 text-pixels (--pt), so they sit on the same grid as the pixel fonts.
 * Legend: k ink, w parchment, s amber, b brass, o wood, r red, R dark red, g green, B blue, y pale, G grey.
 */
import type { CSSProperties } from 'react';

const COL: Record<string, string> = {
  k: '#0b0705', w: '#e8d5b5', s: '#ffb35c', b: '#c8953f', o: '#7a5232', O: '#3b2416', r: '#e0392b', R: '#9e1b1b',
  g: '#8fcf5e', B: '#8fd0ff', y: '#fff3c4', G: '#9aa3ad',
};

const MAPS: Record<string, string[]> = {
  // emotes
  tip: ['........', '..kkkk..', '..kOOk..', '..kOOk..', '..kssk..', 'kkkkkkkk', 'kOOOOOOk', 'kkkkkkkk'],
  spit: ['...k....', '..kBk...', '..kBk...', '.kBBBk..', '.kBByk..', '.kBBBk..', '..kkk.kk', '......kB'],
  laugh: ['.kkkkkk.', 'kssssssk', 'kskssksk', 'kssssssk', 'kkkkkkkk', 'kRwwwwRk', '.kRRRRk.', '..kkkk..'],
  yeehaw: ['..kkkk..', '.kooook.', 'kkooookk', 'ooooooooo'.slice(0, 8), 'kkkkkkkk', '.kssssk.', '.kskksk.', '..kssk..'],
  clap: ['.k...k..', 'k.k.k.k.', '..kk....', '.kwwk...', 'kwwwwk..', 'kwwwwwk.', '.kwwwwk.', '..kkkk..'],
  shrug: ['...kk...', '..kssk..', '..kssk..', 'k..kk..k', 'wk.kk.kw', '.kkoookk', '...oo...', '...kk...'],
  angry: ['.kkkkkk.', 'krrrrrrk', 'krkrrkrk', 'krrkkrrk', 'krrrrrrk', 'krkkkkrk', 'krrrrrrk', '.kkkkkk.'],
  drink: ['........', 'kyyyyyyk', 'kwyyyywk', 'kssssssk', 'kssssssk', 'kbssssbk', 'kbbbbbbk', '.kkkkkk.'],
  // badges
  trigger: ['........', 'kkkkkkkk', 'kGGGGGGk', 'kkkkGGkk', '...kook.', '...kook.', '...koOk.', '...kkkk.'],
  peacemaker: ['...kk...', '...ss...', 'kkssssk.', '.kssssk.', '..ssss..', '.kskksk.', '.ks..sk.', '.k....k.'],
  sharp: ['.kkkkkk.', 'kwwwwwwk', 'kwrrrrwk', 'kwrwwrwk', 'kwrwwrwk', 'kwrrrrwk', 'kwwwwwwk', '.kkkkkk.'],
  kingmaker: ['........', 'k..k..k.', 'ks.s.sk.', 'ksssssk.', 'ksrsrsk.', 'ksssssk.', 'kkkkkkk.', '........'],
  avenger: ['...k....', '..kRk...', '..kRk...', '.kRRRk..', 'kRRrRRk.', 'kRrRRRk.', '.kRRRk..', '..kkk...'],
  snail: ['........', '..kkkk..', '.kobbok.', 'kobookbk', 'kobbkobk', '.kookk.k', 'kgggggggk'.slice(0, 8), '.kkkkkkk'],
  duelist: ['....kkk.', '...kssk.', '..kssk..', '.kssskk.', 'kkksssk.', '..kssk..', '.kssk...', '.kkk....'],
  // seat: the host's pennant
  host: ['.kkkk...', '.krrrkk.', '.krrrrrk', '.krrrkk.', '.kkkk...', '.k......', '.k......', 'kkk.....'],
  // saddle-up chips
  ready: ['........', '.......k', '......kg', 'k....kgk', 'gk..kgk.', 'kgkkgk..', '.kggk...', '..kk....'],
  download: ['..kkk...', '..kBk...', '..kBk...', 'kkkBkkk.', '.kBBBk..', '..kBk...', '...k....', 'kkkkkkk.'],
  buy: ['...k....', '.kkskk..', 'kssssk..', 'ksk.....', '.kssk...', '...ksk..', 'kssssk..', '..kkk...'],
  wait: ['........', '........', '........', '........', '.k.k.k..', '.s.s.s..', '........', '........'],
  // UI: arrow glyphs for the brass coin buttons, the dice for Random
  arrowL: ['........', '....kk..', '...kOk..', '..kOOkkk', '.kOOOOOk', '..kOOkkk', '...kOk..', '....kk..'],
  arrowR: ['........', '..kk....', '..kOk...', 'kkkOOk..', 'kOOOOOk.', 'kkkOOk..', '..kOk...', '..kk....'],
  dice: ['.kkkkkk.', 'kwwwwwwk', 'kwkwwwwk', 'kwwwwwwk', 'kwwwkwwk', 'kwwwwwwk', 'kwwwwwkk', '.kkkkkk.'],
};

export const hasPixelIcon = (name: string) => name in MAPS;

export default function PixelIcon({ name, className = '', title, style }: { name: string; className?: string; title?: string; style?: CSSProperties }) {
  const g = MAPS[name];
  if (!g) return null;
  return (
    <svg className={`pxi ${className}`} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} style={style}>
      {g.flatMap((row, y) => [...row.slice(0, 8)].map((ch, x) => (ch === '.' || !COL[ch] ? null : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={COL[ch]} />)))}
    </svg>
  );
}
