/* The Barkeep: one pixel character drawn by both the saloon scene (standing behind the back bar) and
 * the explain card's BarkeepPortrait. 1 unit = 1 scene pixel. Origin: (x, y) = centre column, top of the hat. */
import { PAL } from './palette';

type Ctx = CanvasRenderingContext2D;

export type BkPose = 'polish' | 'wipe' | 'point' | 'duck' | 'cheers' | 'talk' | 'idle';
export interface BkState {
  pose: BkPose;
  /** animation frame counter (the caller steps it ~every 150ms) */
  f: number;
  /** -1 look / point left, 0 ahead, 1 right */
  dir: -1 | 0 | 1;
  /** 0 shut, 1 a little open, 2 wide */
  mouth: 0 | 1 | 2;
  blink: boolean;
  /** draw the back-bar counter in front of his waist */
  counter?: boolean;
}

export const BK = {
  hat: '#1c1612', hatHi: '#3a3430', brim: '#2a2420', band: PAL.red2,
  hair: '#3a2418', stache: '#5a3420', stacheHi: '#7a4a2c',
  sk0: PAL.skin0, sk1: PAL.skin2, sk2: PAL.skin3,
  shirt: PAL.parch, shirtD: PAL.parch2, vest: '#4a1a1a', vestHi: '#6b2626',
  apron: '#d8ccb0', apronD: '#a89a7e', tie: PAL.red1, tieD: PAL.red2, garter: PAL.red1,
  glass: PAL.metal4, rag: '#e8e0cc',
} as const;

/** his box relative to the origin (for hit tests / placement) */
export const BK_BOX = { x: -14, y: -4, w: 28, h: 38 };
/** head box (what must stay clear of the players' hats) */
export const BK_HEAD = { x: -6, y: 0, w: 12, h: 14 };
/** where the quip bubble's tail points (above the hat) */
export const BK_MOUTH_Y = -2;

export function drawBarkeep(c: Ctx, x: number, y: number, s: BkState) {
  x = Math.round(x); y = Math.round(y);
  const R = (dx: number, dy: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x + dx, y + dy, w, h); };
  const P = (dx: number, dy: number, col: string) => R(dx, dy, 1, 1, col);
  const duck = s.pose === 'duck';
  const dy0 = duck ? 5 : s.pose === 'wipe' ? 1 : 0; // ducking behind the bar / leaning in to wipe
  const by = dy0; // body offset
  const f = s.f;

  // ---- torso (under the head, so the collar overlaps cleanly)
  R(-6, 14 + by, 12, 20, PAL.ink); // outline block
  R(-5, 14 + by, 10, 1, BK.shirt); // shoulders
  R(-5, 15 + by, 10, 19, BK.shirt);
  // waistcoat with a V opening that closes at the chest
  for (let r = 15; r < 34; r++) {
    const v = Math.max(0, 3 - Math.floor((r - 15) / 2));
    R(-5, r + by, 5 - v, 1, BK.vest);
    R(v, r + by, 5 - v, 1, BK.vest);
  }
  R(-5, 15 + by, 1, 10, BK.vestHi);
  P(0, 22 + by, '#d4a52a'); P(0, 25 + by, '#d4a52a');
  // apron: bib straps + the apron from the waist down
  R(-3, 16 + by, 1, 6, BK.apron); R(2, 16 + by, 1, 6, BK.apron);
  R(-5, 22 + by, 10, 12, BK.apron);
  R(-5, 22 + by, 10, 1, BK.apronD);
  R(-6, 23 + by, 1, 1, BK.apronD); R(5, 23 + by, 1, 1, BK.apronD); // strings
  R(-4, 28 + by, 8, 1, BK.apronD);

  // ---- head
  const hy = by + (s.pose === 'talk' && f % 4 === 1 ? -1 : 0);
  const look = s.dir;
  R(-5, 5 + hy, 10, 9, PAL.ink); // head outline
  R(-4, 5 + hy, 8, 8, BK.sk1);
  R(-4, 5 + hy, 8, 1, BK.sk0); // brim shadow
  R(-4, 12 + hy, 8, 1, BK.sk0); // jaw
  R(-3, 13 + hy, 6, 1, BK.sk0);
  R(-5, 7 + hy, 1, 2, BK.sk0); R(4, 7 + hy, 1, 2, BK.sk0); // ears
  R(-4, 6 + hy, 1, 4, BK.hair); R(3, 6 + hy, 1, 4, BK.hair); // sideburns
  // brows + eyes (pupils follow `dir`)
  const ex = look;
  R(-3 + ex, 7 + hy, 2, 1, BK.hair); R(1 + ex, 7 + hy, 2, 1, BK.hair);
  if (s.blink || duck) { R(-3 + ex, 8 + hy, 2, 1, BK.sk0); R(1 + ex, 8 + hy, 2, 1, BK.sk0); }
  else {
    P(-3 + ex, 8 + hy, PAL.white); P(-2 + ex, 8 + hy, PAL.ink);
    P(1 + ex, 8 + hy, PAL.white); P(2 + ex, 8 + hy, PAL.ink);
    if (look < 0) { P(-3 + ex, 8 + hy, PAL.ink); P(-2 + ex, 8 + hy, PAL.white); P(1 + ex, 8 + hy, PAL.ink); P(2 + ex, 8 + hy, PAL.white); }
  }
  // nose
  P(look >= 0 ? 0 : -1, 9 + hy, BK.sk2); P(look >= 0 ? -1 : 0, 10 + hy, BK.sk0);
  // mouth (under the moustache)
  if (s.mouth === 2) { R(-1, 11 + hy, 2, 2, PAL.ink); P(0, 12 + hy, PAL.red1); }
  else if (s.mouth === 1) R(-1, 11 + hy, 2, 1, PAL.ink);
  else R(-1, 12 + hy, 2, 1, BK.sk0);
  if (s.pose === 'cheers') { R(-2, 12 + hy, 4, 1, PAL.ink); P(-2, 11 + hy, PAL.ink); P(1, 11 + hy, PAL.ink); }
  // handlebar moustache with curled tips
  R(-3, 10 + hy, 6, 1, BK.stache); R(-2, 10 + hy, 1, 1, BK.stacheHi);
  P(-4, 10 + hy, BK.stache); P(3, 10 + hy, BK.stache);
  P(-5, 9 + hy, BK.stache); P(4, 9 + hy, BK.stache);
  if (s.mouth === 2) R(-2, 11 + hy, 1, 1, BK.stache); // lip lifts, the moustache bunches

  // ---- wing collar + bowtie
  R(-3, 13 + by, 2, 2, BK.shirt); R(1, 13 + by, 2, 2, BK.shirt);
  P(-3, 15 + by, BK.tie); P(2, 15 + by, BK.tie);
  R(-2, 14 + by, 4, 1, BK.tie); R(-1, 14 + by, 2, 1, BK.tieD);
  P(-2, 13 + by, BK.tie); P(1, 13 + by, BK.tie); P(-2, 15 + by, BK.tie); P(1, 15 + by, BK.tie);

  // ---- bowler hat (pushed down when he ducks)
  const ty = hy + (duck ? 1 : 0);
  R(-3, 0 + ty, 6, 1, PAL.ink);
  R(-4, 1 + ty, 8, 3, PAL.ink);
  R(-3, 1 + ty, 6, 3, BK.hat); R(-2, 0 + ty, 4, 1, BK.hat);
  P(-2, 1 + ty, BK.hatHi);
  R(-3, 3 + ty, 6, 1, BK.band);
  R(-6, 4 + ty, 12, 1, BK.brim); R(-5, 5 + ty, 10, 1, PAL.ink);

  // ---- arms (2px sleeves, a red garter, skin hands)
  const sleeve = (x0: number, y0: number, x1: number, y1: number) => {
    // stepped 2px-wide limb from (x0,y0) to (x1,y1)
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const xx = Math.round(x0 + ((x1 - x0) * i) / n), yy = Math.round(y0 + ((y1 - y0) * i) / n);
      R(xx - 1, yy - 1, 3, 3, PAL.ink);
    }
    for (let i = 0; i <= n; i++) {
      const xx = Math.round(x0 + ((x1 - x0) * i) / n), yy = Math.round(y0 + ((y1 - y0) * i) / n);
      R(xx, yy, 2, 2, i === Math.round(n / 2) ? BK.garter : BK.shirt);
    }
  };
  const hand = (hx: number, hy2: number) => { R(hx - 1, hy2 - 1, 4, 4, PAL.ink); R(hx, hy2, 2, 2, BK.sk1); P(hx, hy2, BK.sk2); };
  const glassAt = (gx: number, gy: number, full = true) => {
    R(gx - 1, gy - 1, 5, 6, PAL.ink); R(gx, gy, 3, 4, BK.glass); P(gx, gy, PAL.white);
    if (full) { R(gx, gy + 2, 3, 2, PAL.lamp2); P(gx + 1, gy + 2, PAL.lamp1); }
  };
  const rag = (rx: number, ry: number) => { R(rx - 1, ry - 1, 5, 4, PAL.ink); R(rx, ry, 3, 2, BK.rag); P(rx + 2, ry + 1, PAL.parch2); };

  const L = { x: -6, y: 16 + by }, Rt = { x: 4, y: 16 + by };
  switch (s.pose) {
    case 'polish': { // turning a glass in the rag at his chest
      const k = f % 4;
      sleeve(L.x, L.y, -3, 21 + by); sleeve(Rt.x, Rt.y, 2, 21 + by);
      glassAt(-1, 17 + by - (k === 2 ? 1 : 0), false);
      rag(k < 2 ? -4 : 0, 20 + by);
      hand(-3, 21 + by); hand(1, 21 + by);
      break;
    }
    case 'wipe': { // rag on the counter, sweeping side to side
      const sweep = [0, 2, 4, 2, 0, -2, -4, -2][f % 8];
      sleeve(L.x, L.y, -6, 23 + by); hand(-7, 23 + by);
      sleeve(Rt.x, Rt.y, 4 + sweep, 24 + by);
      rag(3 + sweep, 25);
      hand(4 + sweep, 23 + by);
      break;
    }
    case 'point': { // arm out at the shooter
      const d = s.dir || 1;
      const sx = d > 0 ? Rt.x : L.x;
      sleeve(sx, 16 + by, sx + d * 7, 15 + by);
      hand(sx + d * 8 - (d < 0 ? 1 : 0), 14 + by);
      R(sx + d * 10 - (d < 0 ? 1 : 0), 15 + by, 2, 1, BK.sk1); // finger
      R(sx + d * 10 - (d < 0 ? 1 : 0), 14 + by, 2, 1, PAL.ink);
      const ox = d > 0 ? L : Rt;
      sleeve(ox.x, ox.y, ox.x + (d > 0 ? 2 : -1), 22 + by); hand(ox.x + (d > 0 ? 2 : -2), 22 + by);
      break;
    }
    case 'duck': { // hands up over the hat
      sleeve(L.x, L.y, -7, 4 + by); hand(-8, 2 + by);
      sleeve(Rt.x, Rt.y, 6, 4 + by); hand(6, 2 + by);
      break;
    }
    case 'cheers': { // glass raised high
      sleeve(Rt.x, Rt.y, 8, 6 + by); hand(8, 5 + by); glassAt(8, 0 + by);
      sleeve(L.x, L.y, -4, 22 + by); hand(-4, 22 + by);
      if (f % 2) { P(13, -1 + by, '#fff3b8'); P(12, -2 + by, '#fff3b8'); }
      break;
    }
    case 'talk': { // one hand making the point
      const up = [0, 2, 1, 3][f % 4];
      sleeve(Rt.x, Rt.y, 7, 18 + by - up); hand(7, 16 + by - up);
      sleeve(L.x, L.y, -4, 22 + by); hand(-4, 22 + by);
      break;
    }
    default: {
      sleeve(L.x, L.y, -5, 22 + by); sleeve(Rt.x, Rt.y, 3, 22 + by);
      hand(-5, 22 + by); hand(3, 22 + by);
    }
  }

  // ---- the back-bar counter in front of his waist
  if (s.counter !== false) {
    R(-14, 26, 28, 1, PAL.wood4);
    R(-14, 27, 28, 2, PAL.wood3);
    R(-14, 29, 28, 1, PAL.ink);
    R(-13, 30, 26, 4, PAL.wood1);
    for (let i = -12; i < 13; i += 6) R(i, 31, 1, 3, PAL.wood0);
    if (s.pose !== 'wipe' && s.pose !== 'cheers') { // a glass waiting on the bar
      R(-11, 22, 4, 4, PAL.ink); R(-10, 23, 2, 3, BK.glass); P(-10, 24, PAL.lamp2);
    }
    // a bottle at the end of the bar
    R(9, 19, 3, 7, '#1f3318'); R(10, 17, 1, 2, '#1f3318'); P(9, 20, '#3e6630'); R(9, 22, 3, 2, PAL.parch3);
  }
}
