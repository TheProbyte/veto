/** Limited saloon palette. Everything pixel-drawn pulls from here. */
export const PAL = {
  ink: '#0b0705',
  wood0: '#160d08',
  wood1: '#2a1a10',
  wood2: '#3b2416',
  wood3: '#5a3a22',
  wood4: '#7a5232',
  lamp0: '#ffe7b8',
  lamp1: '#ffb35c',
  lamp2: '#ff8a3d',
  lamp3: '#c4581f',
  red1: '#9e1b1b',
  red2: '#5e0f0f',
  parch: '#e8d5b5',
  parch2: '#c9b08a',
  parch3: '#9c8160',
  blue0: '#0f1724',
  blue1: '#1e2c3d',
  blue2: '#3a5470',
  blue3: '#6f8fae',
  moon: '#dfe8f0',
  skin0: '#5a3826',
  skin1: '#8d5a3b',
  skin2: '#c68a5e',
  skin3: '#e0b089',
  felt0: '#141a0e',
  felt1: '#1f2914',
  felt2: '#2e3a1c',
  felt3: '#3f4a24',
  metal0: '#141619',
  metal1: '#2a2e33',
  metal2: '#4a5058',
  metal3: '#7d858f',
  metal4: '#b8bec6',
  white: '#fff6e4',
} as const;

export function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** cheap deterministic hash of a string -> uint32 */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** deterministic 0..1 noise from integer coords */
export function rnd(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
