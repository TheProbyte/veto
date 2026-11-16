/**
 * Pixel-art cursors, drawn at runtime from tiny maps onto a canvas (every map pixel = 2x2, so they
 * match the chunky scene) and exposed as CSS variables on <html>:
 *   --cur-default --cur-pointer --cur-text --cur-aim --cur-grab --cur-grabbing --cur-no --cur-wait
 * styles.css declares keyword defaults for each, so `cursor: var(--cur-x)` is always valid; the
 * images are only installed for fine pointers (touch devices never see a cursor anyway).
 *
 * Map legend: '.' clear, k outline, w parchment, s brass, b dark brass, o wood, r red, g glass.
 * Maps are drawn with an automatic 1-pixel dark outline around every filled pixel.
 */

const PAL: Record<string, string> = {
  k: '#0b0705', w: '#f2e3c8', s: '#ffb35c', b: '#c8953f', o: '#7a5232', r: '#e0392b', g: '#3b2416', y: '#ffe7b8',
};

interface Cur { map: string[]; hot: [number, number]; fallback: string }

const arrow: Cur = {
  fallback: 'default', hot: [0, 0],
  map: [
    'w..........',
    'ww.........',
    'wsw........',
    'wssw.......',
    'wsssw......',
    'wssssw.....',
    'wsssssw....',
    'wssssssw...',
    'wsssssssw..',
    'wssssswwww.',
    'wsswssw....',
    'wsw.wssw...',
    'ww..wssw...',
    '.....ww....',
  ],
};

const point: Cur = {
  fallback: 'pointer', hot: [4, 0],
  map: [
    '....ww........',
    '....ww........',
    '....ww........',
    '....wwwwwwww..',
    '....wwkwwkwww.',
    '.ww.wwkwwkwwww',
    '.wwwwwwwwwwwww',
    '..wwwwwwwwwwww',
    '..wwwwwwwwwwww',
    '...wwwwwwwwww.',
    '...wwwwwwwwww.',
    '....ssssssss..',
    '....oooooooo..',
  ],
};

const ibeam: Cur = {
  fallback: 'text', hot: [3, 7],
  map: [
    'www.www',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    '...w...',
    'www.www',
  ],
};

const grab: Cur = {
  fallback: 'grab', hot: [6, 7],
  map: [
    '....w.w.w.....',
    '....w.w.w.w...',
    '..w.w.w.w.w...',
    '..w.w.w.w.w...',
    '..w.w.w.w.w...',
    '..wwwwwwwww...',
    'w.wwwwwwwww...',
    'wwwwwwwwwww...',
    '.wwwwwwwwww...',
    '..wwwwwwwww...',
    '...wwwwwww....',
    '...sssssss....',
    '...ooooooo....',
  ],
};

const grabbing: Cur = {
  fallback: 'grabbing', hot: [6, 6],
  map: [
    '..............',
    '..............',
    '..............',
    '...ww.ww.ww...',
    '..wwwwwwwwwww.',
    '..wwkwwkwwkww.',
    '.wwwwwwwwwwww.',
    '.wwwwwwwwwwww.',
    '..wwwwwwwwww..',
    '...wwwwwwww...',
    '...ssssssss...',
    '...oooooooo...',
  ],
};

/** circle-ish maps built from a distance test (aim ring, no-entry sign) */
function ring(n: number, r: number, paint: (x: number, y: number, d: number) => string): string[] {
  const c = (n - 1) / 2;
  const out: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) row += paint(x, y, Math.round(Math.hypot(x - c, y - c) * 10) / 10) || (Math.abs(Math.hypot(x - c, y - c) - r) < 0.75 ? 'r' : '.');
    out.push(row);
  }
  return out;
}

const aim: Cur = {
  fallback: 'crosshair', hot: [6, 6],
  map: ring(13, 5.2, (x, y) => {
    const c = 6;
    if (x === c && y === c) return 'y';
    if ((x === c && Math.abs(y - c) >= 2 && Math.abs(y - c) <= 3) || (y === c && Math.abs(x - c) >= 2 && Math.abs(x - c) <= 3)) return 'y';
    if ((x === c && (y === 0 || y === 12)) || (y === c && (x === 0 || x === 12))) return 'r';
    return '';
  }),
};

const no: Cur = {
  fallback: 'not-allowed', hot: [6, 6],
  map: ring(13, 5.2, (x, y, d) => (d < 5 && Math.abs(x - y) <= 0.5 && x > 1 && x < 11 ? 'r' : '')),
};

const wait: Cur = {
  fallback: 'wait', hot: [5, 7],
  map: [
    'ooooooooooo',
    '.w.......w.',
    '.wsssssssw.',
    '.wwsssssww.',
    '..wwsssww..',
    '...wwsww...',
    '....wsw....',
    '....wsw....',
    '...ww.ww...',
    '..ww...ww..',
    '.ww..s..ww.',
    '.w..sss..w.',
    '.wsssssssw.',
    'ooooooooooo',
  ],
};

const SCALE = 2;

function draw(c: Cur): string | null {
  const h = c.map.length, w = Math.max(...c.map.map((r) => r.length));
  const W = w + 2, H = h + 2; // one pixel of outline all round
  const cv = document.createElement('canvas');
  cv.width = Math.min(32, W * SCALE); cv.height = Math.min(32, H * SCALE);
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && y < h ? c.map[y][x] ?? '.' : '.');
  const put = (x: number, y: number, col: string) => { ctx.fillStyle = col; ctx.fillRect((x + 1) * SCALE, (y + 1) * SCALE, SCALE, SCALE); };
  // outline: every clear pixel touching (8-way) a filled one
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    if (at(x, y) !== '.') continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const ch = at(x + dx, y + dy); if (ch !== '.' && ch !== 'k') { near = true; break; } }
    if (near) put(x, y, PAL.k);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = at(x, y); if (ch !== '.') put(x, y, PAL[ch] ?? PAL.k); }
  try { return `url("${cv.toDataURL('image/png')}") ${(c.hot[0] + 1) * SCALE} ${(c.hot[1] + 1) * SCALE}, ${c.fallback}`; } catch { return null; }
}

export const CURSORS = { default: arrow, pointer: point, text: ibeam, aim, grab, grabbing, no, wait } as const;

function install() {
  try {
    if (!window.matchMedia?.('(any-pointer: fine)').matches) return;
    const s = document.documentElement.style;
    for (const [k, c] of Object.entries(CURSORS)) {
      const v = draw(c);
      if (v) s.setProperty(`--cur-${k}`, v);
    }
  } catch { /* keyword cursors stay */ }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') install();
