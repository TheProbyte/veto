import type { Look } from '../../shared/types';
import { PAL, hashStr, hexRgb, rnd } from './palette';
import { bayer, circle, ellipse, line, makeCanvas, px } from './dither';

type Ctx = CanvasRenderingContext2D;

/* ================= gunslinger bust ================= */

export const BUST_W = 48;
export const BUST_H = 56;

// option palettes, indexed exactly like LOOK_LABELS in shared/types
const HAT_COLS = ['#7a5a38', '#1c1612', '#7a3418', '#c9b08a', '#4a1418', '#3a4450', '#d4a52a'];
const HAT_BANDS = [PAL.wood1, PAL.red1, PAL.wood0, PAL.wood2, PAL.parch3, PAL.metal1, '#6b4a0c'];
// 6 poncho (striped serape, base under the stripes), 7 gold vest (white shirt sleeves; vest drawn on top)
const COATS = ['#6b5032', '#1c1d22', '#4a2c1a', '#1e2c4a', '#45454a', '#8a6440', '#8a3a1c', '#cfc2a4'];
// 6 skull (black, white skull), 7 star-spangled (navy + stars + red stripes)
const SCARVES: (string | null)[] = [null, '#a81d1d', '#24345e', '#1a1412', '#b8891d', '#2f6a3a', '#141012', '#24345e'];
const GOLD = ['#6b4a0c', '#a87c18', '#d4a52a', '#f2d36b', '#fff3b8'];
const SKINS: [string, string, string][] = [
  ['#9a6a52', '#d9a383', '#f0c9a8'],
  [PAL.skin1, PAL.skin2, PAL.skin3],
  ['#6e4428', '#a8703f', '#cf9662'],
  [PAL.skin0, PAL.skin1, PAL.skin2],
  ['#2e1a10', '#4f3020', '#76492e'],
];
const HAIRS = ['#120c08', '#4a2c18', '#a0522d', '#c9a050', '#8a8580'];
const GLINTS = [PAL.lamp1, PAL.parch, PAL.blue3, PAL.lamp0];

/** Internal hat codes = LOOK_LABELS.hat: 0 wide brim, 1 bowler, 2 top hat, 3 sombrero, 4 flat cap, 5 no hat (hair),
 * 6 sheriff, 7 gambler's visor, 8 cactus; 9 = legacy bandana wrap */
export interface BustLook {
  hat: number;
  hatCol: string; band: string; coat: string; scarf: string | null;
  skin: [string, string, string]; hair: string;
  facial: number; // LOOK_LABELS.face order: 0 clean, 1 stubble, 2 moustache, 3 full beard, 4 goatee, 5 scarred, 6 eyepatch
  glint: string;
  shine?: boolean; // gold hat
  scarfPat?: 'skull' | 'stars';
  coatPat?: 'poncho' | 'vest';
}

const wrap = (v: number, n: number) => ((Math.floor(v) % n) + n) % n;

/** Character-creator choices -> renderer palette. */
export function lookFromStyle(st: Look, id = ''): BustLook {
  const g = GLINTS[hashStr(id || 'x') % 4];
  return {
    hat: wrap(st.hat, 9),
    hatCol: HAT_COLS[wrap(st.hatColor, HAT_COLS.length)],
    band: HAT_BANDS[wrap(st.hatColor, HAT_BANDS.length)],
    coat: COATS[wrap(st.coat, COATS.length)],
    scarf: SCARVES[wrap(st.bandana, SCARVES.length)],
    skin: SKINS[wrap(st.skin, SKINS.length)],
    hair: HAIRS[wrap(st.hair, HAIRS.length)],
    facial: wrap(st.face, 7),
    glint: g,
    shine: wrap(st.hatColor, HAT_COLS.length) === 6,
    scarfPat: ({ 6: 'skull', 7: 'stars' } as const)[wrap(st.bandana, SCARVES.length) as 6 | 7],
    coatPat: ({ 6: 'poncho', 7: 'vest' } as const)[wrap(st.coat, COATS.length) as 6 | 7],
  };
}

/** Legacy outfit number + hash of the player id -> a full Look (the default before someone uses the creator). */
export function legacyStyle(look: number, id: string): Look {
  const l = wrap(look, 8);
  const h = hashStr(id || String(look));
  const HAT_BY_LOOK = [0, 1, 2, 3, 0, 4, 2, 0];
  const hat = (h >>> 20) % 6 === 0 ? (HAT_BY_LOOK[l] + 1 + ((h >>> 3) % 4)) % 6 : HAT_BY_LOOK[l];
  return {
    hat,
    hatColor: (l + (h & 1)) % 6,
    skin: (h >>> 11) % 5,
    face: [3, 1, 2, 0, 4, 5][(h >>> 17) % 6],
    hair: (h >>> 14) % 5,
    bandana: 1 + ((l + ((h >>> 9) % 3 === 0 ? 3 : 0)) % 5),
    coat: l % 6,
  };
}

/** Back-compat: legacy look number + id. */
export function bustLook(look: number, id: string): BustLook { return lookFromStyle(legacyStyle(look, id), id); }

/** The bust for a player: their creator style when set, else the old hash-of-id default. */
export function bustFor(p: { id: string; look: number; style?: Look }): BustLook {
  return lookFromStyle(p.style ?? legacyStyle(p.look, p.id), p.id);
}
export const styleSig = (p: { look: number; style?: Look }) =>
  p.style ? `s${p.style.hat}.${p.style.hatColor}.${p.style.skin}.${p.style.face}.${p.style.hair}.${p.style.bandana}.${p.style.coat}` : `l${p.look}`;

export interface BustOpts {
  scale: number; // 1 = 48x56
  blink: boolean;
  rimRight: boolean; // lamp is to the right of this player
  lit: boolean; // current shooter
  dim: number; // 0..1 multiplier for distance darkening
  ghost: boolean;
  /** hat offset in bust pixels (negative = above the head) for drop / tip animations */
  hatDy?: number;
  hatDx?: number;
  /** hand raised to the brim (hat tip) */
  hand?: boolean;
  /** revolver: 0 none, 1 raised (aiming), 2 recoil */
  gun?: number;
  /** extra empty rows above the bust (so dropping hats aren't clipped) */
  padTop?: number;
  /** idle / emote pose (ignored while a gun is up) */
  pose?: Pose;
  /** practice bot: a little gear on the hat */
  bot?: boolean;
}

export type PoseArm = 'cards' | 'cards2' | 'cards3' | 'glass' | 'glassUp' | 'clap' | 'clapOpen' | 'shrug';
export interface Pose {
  arm?: PoseArm;
  eyes?: -1 | 0 | 1; // glance left / right
  mouth?: 'open' | 'grin';
  brow?: 'angry' | 'up';
}
export const poseKey = (p?: Pose) => (p ? `${p.arm ?? ''}${p.eyes ?? ''}${p.mouth ?? ''}${p.brow ?? ''}` : '');

/** Draws a bust into a fresh offscreen canvas. Rim light computed from the silhouette. */
export function renderBust(L: BustLook, o: BustOpts): HTMLCanvasElement {
  const s = o.scale;
  const pad = Math.round((o.padTop ?? 0) * s);
  const W = Math.max(8, Math.round(BUST_W * s));
  const H = Math.max(8, Math.round(BUST_H * s) + pad);
  const [cv, c] = makeCanvas(W, H);
  c.translate(0, pad);
  const X = (v: number) => Math.round(v * s);
  const R = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(X(x), X(y), Math.max(1, X(x + w) - X(x)), Math.max(1, X(y + h) - X(y)));
  };
  const E = (cx: number, cy: number, rx: number, ry: number, col: string) => ellipse(c, X(cx), X(cy), Math.max(1, X(rx)), Math.max(1, X(ry)), col);
  const [sk0, sk1, sk2] = L.skin;
  const noHat = L.hat === 5;
  const hairTop = noHat || L.hat === 7 || L.hat === 8; // hair shows (visor / cactus sit on it)
  const pose = o.gun ? undefined : o.pose;

  // --- coat / shoulders
  for (let y = 29; y < 56; y++) {
    const t = Math.min(1, (y - 29) / 7);
    const hw = Math.round(9 + 14 * Math.sqrt(t));
    R(24 - hw, y, hw * 2, 1, L.coat);
  }
  const coatD = shade(L.coat, 0.55);
  c.fillStyle = coatD;
  const y38 = X(38), Hb = Math.round(BUST_H * s);
  for (let y = y38; y < Hb; y++) for (let x = 0; x < W; x++) {
    const t = (y - y38) / Math.max(1, Hb - y38);
    const yy = y / s, tt = Math.min(1, (yy - 29) / 7), hw = 9 + 14 * Math.sqrt(Math.max(0, tt));
    if (t * 1.3 > bayer(x, y) && Math.abs(x / s - 24) < hw - 0.5) c.fillRect(x, y, 1, 1);
  }
  R(21, 30, 6, 14, '#1a120c');
  R(22, 31, 4, 12, PAL.parch3);
  line(c, X(19), X(30), X(22), X(46), PAL.ink);
  line(c, X(29), X(30), X(26), X(46), PAL.ink);
  R(24, 39, 1, 1, PAL.metal3);
  R(15, 28, 4, 4, L.coat); R(29, 28, 4, 4, L.coat);
  if (L.coatPat === 'poncho') {
    const ST = ['#8a3a1c', '#d4a52a', '#e8d5b5', '#2f6a3a', '#8a3a1c', '#1e2c4a'];
    for (let y = 28; y < 56; y++) {
      const t = Math.min(1, (y - 28) / 7), hw = Math.round(10 + 14 * Math.sqrt(t));
      R(24 - hw, y, hw * 2, 1, ST[Math.floor((y - 28) / 3) % ST.length]);
      if ((y - 28) % 3 === 2) for (let x = 24 - hw; x < 24 + hw; x += 3) R(x, y, 1, 1, PAL.ink);
    }
    for (let i = 0; i < 5; i++) R(22 + (i % 2), 28 + i, 4 - (i % 2) * 2, 1, PAL.wood1); // neck slit
  } else if (L.coatPat === 'vest') {
    for (let y = 31; y < 56; y++) {
      const t = Math.min(1, (y - 31) / 6), hw = Math.round(6 + 6 * Math.sqrt(t));
      R(24 - hw, y, hw - 1, 1, y % 5 === 0 ? GOLD[1] : GOLD[2]);
      R(25, y, hw - 1, 1, y % 5 === 0 ? GOLD[1] : GOLD[2]);
    }
    R(19, 31, 2, 10, GOLD[3]); R(28, 31, 1, 10, GOLD[4]);
    for (let k = 0; k < 3; k++) { R(22, 36 + k * 4, 1, 1, GOLD[4]); R(26, 36 + k * 4, 1, 1, GOLD[4]); }
    R(16, 44, 4, 1, GOLD[0]);
  }
  R(20, 24, 8, 6, sk0);

  // --- bandana (neck wrap + triangle) or open shirt collar
  if (L.scarf) {
    const sd = shade(L.scarf, 0.6);
    R(17, 27, 14, 2, L.scarf);
    for (let i = 0; i < 7; i++) R(18 + i, 29 + i, Math.max(1, 12 - i * 2), 1, L.scarf);
    R(19, 29, 10, 1, sd);
    R(24, 31, 1, 3, sd);
    R(20, 27, 1, 1, shade(L.scarf, 1.4));
    if (L.scarfPat === 'skull') {
      R(22, 29, 5, 3, PAL.white); R(23, 32, 3, 1, PAL.white);
      R(23, 30, 1, 1, PAL.ink); R(25, 30, 1, 1, PAL.ink); R(24, 32, 1, 1, PAL.ink);
      R(18, 27, 1, 1, PAL.white); R(29, 28, 1, 1, PAL.white);
    } else if (L.scarfPat === 'stars') {
      for (let i = 0; i < 4; i++) R(19 + i, 32 + i, 10 - i * 2, 1, i % 2 ? PAL.parch : PAL.red1);
      for (const [sx, sy] of [[18, 27], [21, 28], [24, 27], [27, 28], [30, 27], [22, 30], [26, 30]]) R(sx, sy, 1, 1, PAL.white);
    }
  } else {
    R(19, 28, 4, 3, PAL.parch2); R(25, 28, 4, 3, PAL.parch2);
    R(23, 29, 2, 3, sk0);
    R(19, 28, 4, 1, PAL.parch);
  }

  // --- head
  E(24, 17, 10, 10, sk1);
  E(24, 25, 7, 3, sk1);
  const brimShadow = noHat || L.hat === 8 ? 12 : L.hat === 9 ? 13 : L.hat === 4 || L.hat === 7 ? 16 : 19;
  for (let y = X(6); y < X(brimShadow + 3); y++) for (let x = X(13); x < X(36); x++) {
    const t = (X(brimShadow + 3) - y) / Math.max(1, X(5));
    if (y < X(brimShadow) || t > bayer(x, y)) { c.fillStyle = sk0; if (inHead(x / s, y / s)) c.fillRect(x, y, 1, 1); }
  }
  R(17, 21, 2, 1, sk2);
  if (noHat || L.hat === 8) { R(20, 14, 2, 1, sk2); R(27, 13, 3, 1, sk2); }
  R(24, 18, 1, 3, sk2); R(25, 21, 1, 1, sk0);
  // eyes + brows
  const patch = L.facial === 6;
  const ex = pose?.eyes ?? 0;
  if (!o.blink) {
    R(19, 16, 3, 1, PAL.ink); if (!patch) R(27, 16, 3, 1, PAL.ink);
    const gx = ex ? (ex > 0 ? 2 : 0) : o.rimRight ? 2 : 0;
    R(19 + gx, 16, 1, 1, L.glint);
    if (!patch) R(27 + gx, 16, 1, 1, L.glint);
  } else {
    R(19, 17, 3, 1, '#2a1a10'); if (!patch) R(27, 17, 3, 1, '#2a1a10');
  }
  if (noHat || L.hat === 4 || L.hat === 8) { R(19, 14, 3, 1, L.hair); R(27, 14, 3, 1, L.hair); }
  if (pose?.brow === 'angry') { R(19, 14, 2, 1, PAL.ink); R(21, 15, 1, 1, PAL.ink); R(28, 14, 2, 1, PAL.ink); R(27, 15, 1, 1, PAL.ink); }
  else if (pose?.brow === 'up') { R(19, 13, 3, 1, L.hair); R(27, 13, 3, 1, L.hair); }
  // facial hair (LOOK_LABELS.face order)
  switch (L.facial) {
    case 1: // stubble
      for (let y = X(21); y < X(29); y++) for (let x = X(16); x < X(33); x++) {
        if (inHead(x / s, y / s) && rnd(x, y, 7) > 0.55) px(c, x, y, L.hair);
      }
      R(22, 24, 5, 1, PAL.ink);
      break;
    case 2: // moustache
      R(20, 22, 9, 2, L.hair); R(19, 23, 1, 2, L.hair); R(29, 23, 1, 2, L.hair);
      R(22, 25, 5, 1, PAL.ink);
      break;
    case 3: // full beard
      E(24, 25, 8, 4, L.hair);
      R(16, 19, 2, 6, L.hair); R(31, 19, 2, 6, L.hair);
      R(21, 23, 7, 1, PAL.ink);
      R(22, 27, 1, 1, shade(L.hair, 1.5));
      break;
    case 4: // goatee + thin moustache
      R(21, 22, 7, 1, L.hair);
      E(24, 27, 3, 2, L.hair); R(23, 29, 3, 1, L.hair);
      R(22, 24, 5, 1, PAL.ink);
      break;
    case 5: // scar across the right eye
      R(22, 24, 5, 1, sk0);
      line(c, X(26), X(12), X(31), X(21), '#d98a7a');
      line(c, X(27), X(12), X(32), X(21), shade(sk0, 0.8));
      for (let k = 0; k < 3; k++) R(27 + k * 1.6, 14 + k * 2.6, 2, 1, '#d98a7a');
      break;
    case 6: // eyepatch over the right eye, strap across the brow
      R(22, 24, 5, 1, sk0);
      R(26, 15, 5, 3, PAL.ink); R(27, 18, 3, 1, PAL.ink); R(27, 15, 2, 1, '#2a2520');
      line(c, X(26), X(15), X(15), X(12), PAL.ink);
      line(c, X(31), X(15), X(33), X(14), PAL.ink);
      break;
    default:
      R(22, 24, 5, 1, sk0);
  }
  if (pose?.mouth === 'open') { R(22, 23, 5, 3, PAL.ink); R(23, 25, 3, 1, PAL.red1); R(22, 23, 5, 1, PAL.white); }
  else if (pose?.mouth === 'grin') { R(21, 24, 7, 1, PAL.ink); R(22, 23, 5, 1, PAL.white); }
  if (L.hat !== 9 && !hairTop) { R(14, 12, 2, 6, L.hair); R(32, 12, 2, 6, L.hair); }
  if (hairTop && !noHat) { // visor / cactus: hair under it
    E(24, 10, 11, 6, L.hair);
    R(13, 10, 3, 7, L.hair); R(32, 10, 3, 7, L.hair);
    R(16, 11, 16, 2, L.hair);
    for (let i = 0; i < 5; i++) R(15 + i * 4, 6 + (i % 2), 2, 1, shade(L.hair, 1.6));
  }

  // --- hat (offset for drop / tip animations)
  const hdy = noHat ? 0 : Math.round((o.hatDy ?? 0) * s), hdx = noHat ? 0 : Math.round((o.hatDx ?? 0) * s);
  let shineAt: [number, number][] = [];
  c.save();
  c.translate(hdx, hdy);
  const hc = L.hatCol;
  const hd = shade(hc, 0.6);
  const hl = shade(hc, 1.45);
  const scarf = L.scarf ?? PAL.red1;
  switch (L.hat) {
    case 0: // wide brim, pinched crown
      E(24, 12, 21, 3, hd);
      E(24, 11, 21, 2, hc);
      R(15, 2, 18, 9, hc);
      R(17, 1, 6, 1, hc); R(26, 1, 6, 1, hc);
      R(23, 2, 3, 2, hd);
      R(15, 8, 18, 2, L.band);
      R(4, 11, 40, 1, hl);
      break;
    case 1: // bowler
      E(24, 9, 10, 8, hc);
      R(13, 9, 22, 3, hc);
      E(24, 12, 13, 2, hd);
      R(14, 9, 20, 2, L.band);
      R(18, 3, 4, 1, hl);
      break;
    case 2: // top hat
      R(16, -4, 16, 15, hc);
      R(16, -4, 16, 1, hl);
      R(16, 7, 16, 3, L.band);
      E(24, 12, 14, 2, hd);
      R(11, 11, 26, 1, hl);
      break;
    case 3: // sombrero
      E(24, 13, 24, 4, hd);
      E(24, 12, 23, 3, hc);
      for (let i = 0; i < 9; i++) R(18 - i * 0.5, 2 + i, 12 + i, 1, hc);
      R(14, 9, 20, 2, L.band);
      R(2, 12, 44, 1, hl);
      for (let x = 4; x < 44; x += 4) R(x, 14, 1, 1, L.band);
      break;
    case 4: // flat cap
      E(24, 9, 11, 5, hc);
      R(13, 9, 22, 3, hc);
      R(14, 6, 9, 1, hl);
      R(24, 5, 1, 4, hd);
      E(24, 13, 12, 2, hd);
      R(13, 12, 22, 1, hl);
      R(14, 11, 20, 1, L.band);
      break;
    case 5: // no hat: hair
      E(24, 10, 11, 6, L.hair);
      R(13, 10, 3, 7, L.hair); R(32, 10, 3, 7, L.hair);
      R(16, 11, 16, 2, L.hair);
      R(21, 5, 1, 6, shade(L.hair, 0.6));
      for (let i = 0; i < 5; i++) R(15 + i * 4, 6 + (i % 2), 2, 1, shade(L.hair, 1.6));
      R(26, 12, 4, 1, L.hair); R(17, 13, 2, 1, L.hair);
      break;
    case 6: { // sheriff: tall cattleman crown, curled brim, tin star on the front
      E(24, 12, 20, 3, hd);
      E(24, 11, 20, 2, hc);
      R(4, 9, 3, 2, hc); R(41, 9, 3, 2, hc); // curled brim ends
      R(15, 0, 18, 11, hc);
      R(16, -1, 7, 1, hc); R(25, -1, 7, 1, hc);
      R(23, 0, 2, 3, hd);
      R(15, 8, 18, 2, L.band);
      R(5, 11, 38, 1, hl);
      // star
      R(23, 3, 3, 3, GOLD[3]); R(24, 2, 1, 5, GOLD[3]); R(22, 4, 5, 1, GOLD[3]);
      R(24, 4, 1, 1, GOLD[4]); R(22, 6, 1, 1, GOLD[1]); R(26, 6, 1, 1, GOLD[1]);
      shineAt = [[16, 1], [17, 2], [8, 11]];
      break;
    }
    case 7: // gambler's visor: green celluloid bill over the hair + a band
      R(13, 10, 22, 2, '#1f4a2a');
      R(13, 10, 22, 1, '#2f6a3a');
      E(24, 13, 12, 2, '#2f8a4a');
      R(13, 13, 22, 1, '#5fc27a');
      R(16, 14, 16, 1, '#1f6a34');
      shineAt = [[18, 13], [30, 13]];
      break;
    case 8: { // cactus: a little potted saguaro balanced on the head
      const g0 = '#1f4a1c', g1 = '#3a7a2a', g2 = '#6fb04a';
      R(19, 6, 10, 4, '#a0522d'); R(19, 6, 10, 1, '#c97a45'); R(20, 9, 8, 1, '#6b3418'); // pot
      R(22, -6, 4, 12, g1); R(22, -6, 1, 12, g2); R(25, -6, 1, 12, g0);
      R(23, -7, 2, 1, g1);
      R(18, -2, 4, 2, g1); R(18, -5, 2, 4, g1); R(18, -5, 1, 3, g2); // left arm
      R(26, 0, 3, 2, g1); R(28, -3, 2, 4, g1); R(29, -3, 1, 4, g0); // right arm
      for (const [sx, sy] of [[21, -4], [26, -5], [21, 1], [26, 3], [17, -3], [30, -2]]) R(sx, sy, 1, 1, PAL.parch);
      R(23, -9, 2, 2, '#e05a8a'); R(23, -9, 1, 1, '#ff9ac0'); // flower
      break;
    }
    default: // legacy bandana-only head wrap
      E(24, 10, 11, 6, scarf);
      R(13, 10, 22, 3, scarf);
      R(13, 12, 22, 1, shade(scarf, 0.6));
      R(34, 11, 3, 2, scarf); R(35, 13, 2, 3, scarf); R(36, 16, 1, 2, shade(scarf, 0.6));
      for (let i = 0; i < 5; i++) R(16 + i * 4, 7 + (i % 2), 1, 1, shade(scarf, 1.5));
  }
  if (L.shine && L.hat !== 7 && L.hat !== 8) {
    const pts = shineAt.length ? shineAt : L.hat === 3 ? [[17, 4], [18, 5], [6, 12]] : L.hat === 1 ? [[18, 4], [19, 5], [16, 10]] : L.hat === 4 ? [[16, 7], [17, 8]] : L.hat === 2 ? [[17, -3], [17, -2], [12, 11]] : [[16, 3], [17, 4], [6, 11]];
    for (const [sx, sy] of pts) R(sx, sy, 1, 1, PAL.white);
    R(32, 3, 1, 1, GOLD[4]);
  }
  if (o.bot && !noHat) { // practice bot: a little brass gear pinned to the band
    const by = L.hat === 1 ? 10 : L.hat === 4 ? 11 : L.hat === 7 ? 10 : L.hat === 8 ? 7 : 8;
    R(29, by - 1, 3, 3, PAL.metal3); R(30, by - 2, 1, 5, PAL.metal3); R(28, by, 5, 1, PAL.metal3);
    R(30, by, 1, 1, PAL.ink); R(29, by - 1, 1, 1, PAL.white);
  }
  c.restore();
  if (o.bot && noHat) { R(29, 7, 3, 3, PAL.metal3); R(30, 6, 1, 5, PAL.metal3); R(28, 8, 5, 1, PAL.metal3); R(30, 8, 1, 1, PAL.ink); R(29, 7, 1, 1, PAL.white); }
  // idle / emote arms
  if (pose?.arm) drawArms(pose.arm, L, R, sk1, sk2);
  // hand at the brim (hat tip)
  if (o.hand) {
    const hy = 10 + (o.hatDy ?? 0);
    R(33, hy, 5, 4, sk1); R(33, hy, 5, 1, sk2); R(34, hy + 4, 3, 6, L.coat); R(37, hy + 1, 1, 3, sk0);
  }
  // revolver, held up by the shooter
  if (o.gun) {
    const rc = o.gun === 2 ? -2 : 0; // recoil kicks the barrel up
    const gx = 34, gy = 33 + rc;
    R(gx - 2, gy + 4, 6, 8, L.coat); // forearm
    R(gx - 1, gy + 2, 5, 4, sk1); R(gx - 1, gy + 2, 5, 1, sk2); // fist
    R(gx + 1, gy - 6 - rc, 3, 9 + rc, PAL.metal1); // barrel, pointing up/forward
    R(gx + 1, gy - 6 - rc, 1, 9 + rc, PAL.metal3);
    R(gx + 1, gy - 7 - rc, 3, 1, PAL.metal0);
    R(gx, gy - 1, 5, 3, PAL.metal2); // cylinder
    R(gx, gy - 1, 5, 1, PAL.metal4);
    R(gx + 3, gy + 2, 2, 3, PAL.wood3); // grip
  }

  // --- post pass: rim light, back light, dim/ghost
  c.setTransform(1, 0, 0, 1, 0, 0);
  const img = c.getImageData(0, 0, W, H);
  const d = img.data;
  const dir = o.rimRight ? 1 : -1;
  const A = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]);
  const rim1 = hexRgb(o.lit ? PAL.lamp0 : PAL.lamp1);
  const rim2 = hexRgb(o.lit ? PAL.lamp1 : PAL.lamp2);
  const back = hexRgb(PAL.blue3);
  const out = new Uint8ClampedArray(d);
  const dim = Math.max(0.25, Math.min(1.2, o.dim));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (!A(x + dir, y)) {
      [r, g, b] = mix([r, g, b], rim1, o.lit ? 0.95 : 0.8);
    } else if (!A(x + 2 * dir, y) || (!A(x + dir, y - 1) && y < H * 0.55)) {
      [r, g, b] = mix([r, g, b], rim2, o.lit ? 0.6 : 0.45);
    } else if (o.lit && !A(x + 3 * dir, y) && bayer(x, y) > 0.5) {
      [r, g, b] = mix([r, g, b], rim2, 0.3);
    } else if (!A(x - dir, y)) {
      [r, g, b] = mix([r, g, b], back, 0.35);
    }
    r *= dim; g *= dim; b *= dim;
    if (o.ghost) { const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.8; r = g = b = l; out[i + 3] = bayer(x, y) > 0.5 ? 150 : 90; }
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
  c.putImageData(new ImageData(out, W, H), 0, 0);
  return cv;
}

type RectFn = (x: number, y: number, w: number, h: number, col: string) => void;
function fist(R: RectFn, x: number, y: number, sk1: string, sk2: string) { R(x, y, 4, 4, sk1); R(x, y, 4, 1, sk2); R(x, y + 3, 4, 1, shade(sk1, 0.7)); }
function card(R: RectFn, x: number, y: number, red: boolean) { R(x - 1, y - 1, 5, 7, PAL.ink); R(x, y, 3, 5, PAL.parch); R(x + 1, y + 2, 1, 1, red ? PAL.red1 : PAL.ink); }
function drawArms(arm: PoseArm, L: BustLook, R: RectFn, sk1: string, sk2: string) {
  const sleeve = L.coatPat === 'vest' ? '#cfc2a4' : L.coatPat === 'poncho' ? '#8a3a1c' : L.coat;
  const forearm = (x: number, y: number, h = 6) => R(x, y, 5, h, sleeve);
  switch (arm) {
    case 'cards': case 'cards2': case 'cards3': {
      forearm(13, 36); forearm(30, 36);
      fist(R, 14, 33, sk1, sk2); fist(R, 30, 33, sk1, sk2);
      if (arm === 'cards') { card(R, 16, 28, true); card(R, 18, 27, false); card(R, 20, 28, true); }
      else if (arm === 'cards2') { card(R, 17, 28, true); card(R, 22, 24, false); card(R, 26, 27, true); }
      else { card(R, 26, 28, true); card(R, 28, 27, false); card(R, 30, 28, true); }
      break;
    }
    case 'glass': forearm(29, 37); fist(R, 29, 33, sk1, sk2); glass(R, 30, 28); break;
    case 'glassUp': forearm(28, 28, 10); glass(R, 24, 20, true); fist(R, 27, 24, sk1, sk2); break;
    case 'clap': forearm(16, 36); forearm(27, 36); R(20, 30, 4, 6, sk1); R(24, 30, 4, 6, sk1); R(23, 30, 2, 6, sk2); break;
    case 'clapOpen': forearm(13, 36); forearm(30, 36); R(15, 30, 4, 6, sk1); R(29, 30, 4, 6, sk1); R(18, 31, 1, 4, sk2); R(29, 31, 1, 4, sk2); break;
    case 'shrug':
      R(13, 26, 6, 4, L.coat); R(29, 26, 6, 4, L.coat);
      R(7, 32, 8, 4, sleeve); R(33, 32, 8, 4, sleeve);
      R(4, 30, 4, 3, sk1); R(40, 30, 4, 3, sk1); R(4, 30, 4, 1, sk2); R(40, 30, 4, 1, sk2);
      break;
  }
}
function glass(R: RectFn, x: number, y: number, tilt = false) {
  if (tilt) { R(x, y, 5, 4, PAL.metal4); R(x + 1, y + 1, 3, 2, PAL.lamp2); R(x, y, 1, 1, PAL.white); return; }
  R(x, y, 5, 6, PAL.metal4); R(x + 1, y + 2, 3, 3, PAL.lamp2); R(x + 1, y + 2, 3, 1, PAL.lamp1); R(x, y, 1, 4, PAL.white);
}

function inHead(x: number, y: number) {
  const dx = (x - 24) / 10.5, dy = (y - 17.5) / 11;
  return dx * dx + dy * dy <= 1.05 || (y > 22 && y < 29 && Math.abs(x - 24) < 8.5);
}

function mix(a: number[], b: number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(hex: string, k: number): string {
  const [r, g, b] = hexRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/* ================= small FX / UI sprites (for PixelSprite) ================= */

export type DrawFn = (c: Ctx, w: number, h: number) => void;

export const drawHole: DrawFn = (c, w, h) => {
  const cx = w >> 1, cy = h >> 1;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3, r = 4 + (i % 3);
    line(c, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PAL.parch3);
  }
  circle(c, cx, cy, 3, PAL.wood2);
  circle(c, cx, cy, 2, PAL.ink);
  px(c, cx - 2, cy - 3, PAL.parch);
};

export const drawSmoke: DrawFn = (c, w, h) => {
  const cx = w / 2, cy = h / 2;
  const blobs: [number, number, number][] = [[0, 0, 0.42], [-0.22, 0.12, 0.3], [0.24, 0.1, 0.3], [0.05, -0.2, 0.28]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (const [bx, by, br] of blobs) {
      const dx = (x - cx) / w - bx, dy = (y - cy) / h - by;
      v = Math.max(v, 1 - Math.sqrt(dx * dx + dy * dy) / br);
    }
    if (v <= 0) continue;
    if (v * 1.6 > bayer(x, y)) px(c, x, y, v > 0.55 ? '#b9ab98' : v > 0.3 ? '#8a7e70' : '#5b5249');
  }
};

export const drawStar: DrawFn = (c, w, h) => {
  const cx = (w - 1) / 2, cy = (h - 1) / 2, R = w * 0.48, r = w * 0.2;
  const poly: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : r;
    poly.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inPoly(x + 0.5, y + 0.5, poly)) continue;
    const t = (x + y) / (w + h);
    const col = t < 0.35 ? PAL.metal4 : t < 0.5 ? PAL.white : t < 0.7 ? PAL.metal3 : PAL.metal2;
    px(c, x, y, col);
  }
  // outline
  const img = c.getImageData(0, 0, w, h);
  const a = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && img.data[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!a(x, y) && (a(x + 1, y) || a(x - 1, y) || a(x, y + 1) || a(x, y - 1))) px(c, x, y, '#2a2520');
  }
  circle(c, Math.round(cx), Math.round(cy), Math.max(1, Math.round(w * 0.1)), PAL.metal2);
};

export const drawFlash: DrawFn = (c, w, h) => {
  const cx = w >> 1, cy = h >> 1;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + 0.2;
    const r = (i % 2 ? 0.3 : 0.5) * w;
    line(c, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, PAL.lamp1);
  }
  circle(c, cx, cy, Math.round(w * 0.22), PAL.lamp2);
  circle(c, cx, cy, Math.round(w * 0.16), PAL.lamp1);
  circle(c, cx, cy, Math.round(w * 0.09), PAL.white);
};

export const drawCrack: DrawFn = (c, w, h) => {
  const cx = Math.round(w * 0.55), cy = Math.round(h * 0.4);
  const rays: [number, number][] = [[-0.9, -0.8], [0.7, -0.9], [1, 0.2], [0.4, 1], [-0.6, 0.9], [-1, 0.1]];
  for (const [dx, dy] of rays) {
    let x = cx, y = cy;
    for (let k = 0; k < 4; k++) {
      const nx = x + dx * w * 0.12 + (rnd(x, y, k) - 0.5) * 4, ny = y + dy * h * 0.1 + (rnd(y, x, k) - 0.5) * 4;
      line(c, x, y, nx, ny, PAL.ink);
      line(c, x + 1, y, nx + 1, ny, 'rgba(232,213,181,.55)');
      x = nx; y = ny;
    }
  }
  circle(c, cx, cy, 2, PAL.ink);
};

export const crosshairDraw = (col: string): DrawFn => (c, w, h) => {
  const cx = w >> 1, cy = h >> 1, r = Math.round(w * 0.3);
  for (let a = 0; a < 360; a += 3) {
    const t = (a * Math.PI) / 180;
    px(c, Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), col);
  }
  c.fillStyle = col;
  c.fillRect(cx, 2, 1, cy - r - 1); c.fillRect(cx, cy + r + 2, 1, h - cy - r - 4);
  c.fillRect(2, cy, cx - r - 1, 1); c.fillRect(cx + r + 2, cy, w - cx - r - 4, 1);
  c.fillRect(cx, cy, 1, 1);
};

/** one bullet-hole decal drawn straight into a box-art canvas */
export function holeAt(c: Ctx, x: number, y: number) {
  px(c, x - 1, y - 2, PAL.parch3); px(c, x + 2, y + 1, PAL.parch3); px(c, x - 2, y + 1, PAL.parch3);
  c.fillStyle = PAL.wood2; c.fillRect(x - 1, y - 1, 3, 3);
  c.fillStyle = PAL.ink; c.fillRect(x, y - 1, 1, 3); c.fillRect(x - 1, y, 3, 1);
}

function inPoly(x: number, y: number, poly: [number, number][]) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
