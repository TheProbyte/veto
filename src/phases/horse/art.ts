// Horse Drop pixel art: full-body side-view riders (from the character-creator Look), saddled horses, and the sunny
// street outside the saloon. Riders are drawn as a vector skeleton straight at their flip angle, then snapped to their
// own palette with an ink outline, so they stay crisp at any rotation (no resampled sprites).
import { PAL, rnd } from '../../pixel/palette';
import { bayer, ellipse, makeCanvas } from '../../pixel/dither';
import { shade, type BustLook } from '../../pixel/sprites';

type Ctx = CanvasRenderingContext2D;
const rad = (d: number) => (d * Math.PI) / 180;

/* ============================== rider ============================== */

/** joint angles in degrees. torso/head: from straight up, + leans forward (+x). limbs: from straight down, + swings forward. */
export interface RPose { torso: number; head: number; thigh: number; shin: number; uArm: number; fArm: number }
export const POSES = {
  stand: { torso: 0, head: 0, thigh: 0, shin: 0, uArm: 6, fArm: 14 },
  ready: { torso: 18, head: -6, thigh: 40, shin: -16, uArm: -38, fArm: -22 },
  takeoff: { torso: -8, head: -10, thigh: -6, shin: -8, uArm: 165, fArm: 176 },
  open: { torso: -6, head: -8, thigh: -5, shin: -6, uArm: 112, fArm: 132 },
  tuck: { torso: 34, head: 14, thigh: 128, shin: -12, uArm: 44, fArm: 2 },
  sit: { torso: 2, head: 0, thigh: 66, shin: 4, uArm: 34, fArm: 84 },
  sitUp: { torso: -4, head: -6, thigh: 66, shin: 4, uArm: 150, fArm: 175 }, // hat-waving celebration
  sprawl: { torso: 0, head: 12, thigh: 4, shin: 10, uArm: 150, fArm: 160 },
} satisfies Record<string, RPose>;
export type PoseName = keyof typeof POSES;

export function mixPose(a: RPose, b: RPose, t: number): RPose {
  const m = (x: number, y: number) => x + (y - x) * t;
  return { torso: m(a.torso, b.torso), head: m(a.head, b.head), thigh: m(a.thigh, b.thigh), shin: m(a.shin, b.shin), uArm: m(a.uArm, b.uArm), fArm: m(a.fArm, b.fArm) };
}
export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const TROUSERS = '#3d3226';
const BOOTS = '#24160e';
export const RIDER_C = 48; // canvas size; the hip pivot sits at the centre

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** snap an antialiased canvas to a palette (hard alpha) and add a 1px ink outline */
function snap(c: Ctx, w: number, h: number, pal: string[], outline: string | null) {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const P = pal.map(hexToRgb);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 110) { d[i + 3] = 0; continue; }
    const a = d[i + 3] / 255;
    const r = d[i] / a, g = d[i + 1] / a, b = d[i + 2] / a; // un-premultiply edge pixels
    let best = 0, bd = 1e9;
    for (let k = 0; k < P.length; k++) {
      const dr = r - P[k][0], dg = g - P[k][1], db = b - P[k][2];
      const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (dd < bd) { bd = dd; best = k; }
    }
    d[i] = P[best][0]; d[i + 1] = P[best][1]; d[i + 2] = P[best][2]; d[i + 3] = 255;
  }
  if (outline) {
    const [or, og, ob] = hexToRgb(outline);
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] ? 1 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) {
        d[i * 4] = or; d[i * 4 + 1] = og; d[i * 4 + 2] = ob; d[i * 4 + 3] = 255;
      }
    }
  }
  c.putImageData(img, 0, 0);
}

function stroke(c: Ctx, w: number, col: string, ...pts: [number, number][]) {
  c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.stroke();
}
function disc(c: Ctx, x: number, y: number, r: number, col: string) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function oval(c: Ctx, x: number, y: number, rx: number, ry: number, col: string) { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
function box(c: Ctx, x: number, y: number, w: number, h: number, col: string) { c.fillStyle = col; c.fillRect(x, y, w, h); }

/** hat in head-local space (head centre at 0,0, facing +x, top of the skull at y≈-3) */
function drawHat(c: Ctx, L: BustLook) {
  const hc = L.hatCol, hd = shade(hc, 0.62), band = L.band;
  switch (L.hat) {
    case 0: // wide brim
      box(c, -6.5, -3.2, 13.5, 1.4, hd); box(c, -3.2, -7.2, 6.6, 4.2, hc); box(c, -3.2, -4.4, 6.6, 1.2, band); box(c, -1, -7.6, 2, 1, hd);
      break;
    case 1: // bowler
      box(c, -4.6, -3, 9.6, 1.2, hd); oval(c, 0.2, -4.2, 3.4, 2.8, hc); box(c, -3.2, -3.9, 6.8, 0.9, band);
      break;
    case 2: // top hat
      box(c, -4.8, -3.1, 10, 1.3, hd); box(c, -3, -10.5, 6.2, 7.6, hc); box(c, -3, -5, 6.2, 1.3, band);
      break;
    case 3: // sombrero
      box(c, -8.5, -3, 17.5, 1.6, hd); oval(c, 0.3, -5.6, 3, 3.2, hc); box(c, -3, -4.2, 6.4, 1.1, band);
      box(c, -8.5, -4, 1.2, 1.2, hd); box(c, 7.9, -4, 1.2, 1.2, hd);
      break;
    case 4: // flat cap
      oval(c, -0.3, -3.6, 3.8, 1.8, hc); box(c, 1.5, -3.2, 4.2, 1, hd);
      break;
    case 5: // no hat: hair
      oval(c, -0.6, -2.6, 3.4, 1.8, L.hair);
      break;
    case 6: // sheriff's hat (curled brim + star)
      box(c, -6, -3.2, 12.5, 1.4, hd); box(c, -6.6, -4.4, 1.3, 1.6, hd); box(c, 5.8, -4.4, 1.3, 1.6, hd);
      box(c, -3, -7.4, 6.4, 4.4, hc); box(c, -3, -4.4, 6.4, 1.2, band); box(c, 0.6, -6.4, 1.4, 1.4, '#f2d36b');
      break;
    case 7: // gambler's visor
      oval(c, -0.6, -2.6, 3.4, 1.8, L.hair); box(c, -3, -3.6, 6.2, 1, '#2f6a3a'); box(c, 2, -3.4, 4.6, 1.2, '#4f9a5a');
      break;
    case 8: // cactus
      oval(c, -0.6, -2.6, 3.4, 1.8, L.hair); box(c, -1.2, -10, 2.8, 7, '#3f7a34'); box(c, -4, -8, 1.6, 3.4, '#3f7a34');
      box(c, -4, -5.8, 3, 1.4, '#3f7a34'); box(c, 2.8, -9, 1.6, 3, '#3f7a34'); box(c, 1.4, -7.2, 3, 1.4, '#3f7a34');
      box(c, -0.2, -10.6, 1, 0.8, '#e05a8a');
      break;
    default:
      box(c, -4, -4, 8, 2, L.scarf ?? PAL.red1);
  }
}

function drawHead(c: Ctx, L: BustLook, blink: boolean) {
  const [s0, s1, s2] = L.skin;
  oval(c, -1.2, -0.2, 3, 3.1, L.hair);           // back of the head
  disc(c, 0.3, 0, 3.1, s1);                       // face
  box(c, 3, -0.4, 1.3, 1.6, s1);                  // nose
  box(c, -0.6, -0.8, 1.2, 1.2, s0);               // ear
  box(c, 0.6, -3, 3, 0.9, s0);                    // brim shadow
  if (L.facial === 6) { box(c, 1.1, -1.7, 1.9, 1.6, PAL.ink); stroke(c, 0.8, PAL.ink, [1.4, -1], [-2.6, -2.6]); }
  else if (!blink) { box(c, 1.6, -1.4, 1.1, 1.3, PAL.ink); box(c, 2.2, -1.4, 0.6, 0.6, s2); }
  else box(c, 1.3, -0.8, 1.6, 0.6, PAL.ink);
  switch (L.facial) {
    case 1: for (let i = 0; i < 5; i++) box(c, 0.2 + (i % 3) * 1, 1.2 + Math.floor(i / 3), 0.7, 0.7, L.hair); break;
    case 2: box(c, 1.8, 1, 2.6, 0.9, L.hair); box(c, 1.4, 1.6, 0.8, 0.9, L.hair); break;
    case 3: oval(c, 1.1, 2, 2.6, 1.6, L.hair); box(c, -1, 0.2, 1.4, 2.4, L.hair); break;
    case 4: box(c, 2, 1, 2.2, 0.7, L.hair); box(c, 2, 2.2, 1.4, 1.6, L.hair); break;
    case 5: stroke(c, 0.7, '#d98a7a', [0.6, -2.4], [2.6, 0.6]); break;
  }
  box(c, 2.4, 1.6, 1.4, 0.6, s0); // mouth line
  drawHat(c, L);
}

/** draw the rider in body space (hip at 0,0, facing +x, y down) */
function drawBody(c: Ctx, L: BustLook, p: RPose, farLeg: boolean, blink: boolean) {
  const up = (a: number, len: number, o: [number, number]): [number, number] => [o[0] + Math.sin(rad(a)) * len, o[1] - Math.cos(rad(a)) * len];
  const dn = (a: number, len: number, o: [number, number]): [number, number] => [o[0] + Math.sin(rad(a)) * len, o[1] + Math.cos(rad(a)) * len];
  const hip: [number, number] = [0, 0];
  const sh = up(p.torso, 7.5, hip);
  const headC = up(p.torso + p.head, 4.2, sh);
  const coat = L.coatPat === 'vest' ? '#e8e0cc' : L.coat;
  const coatD = shade(L.coat, 0.6);
  // far arm + far leg (darker, a pixel behind)
  const elbF = dn(p.uArm - 12, 4.4, [sh[0] - 0.8, sh[1]]);
  const handF = dn(p.fArm - 12, 3.8, elbF);
  stroke(c, 2.2, shade(coat, 0.6), [sh[0] - 0.8, sh[1]], elbF, handF);
  disc(c, handF[0], handF[1], 1, L.skin[0]);
  if (farLeg) {
    const kF = dn(p.thigh - 10, 5, [-0.8, 0]);
    const fF = dn(p.shin - 10, 4.6, kF);
    stroke(c, 2.6, shade(TROUSERS, 0.7), [-0.8, 0], kF, fF);
    stroke(c, 2.6, PAL.ink, dn(p.shin - 10, -1.4, fF), fF);
  }
  // duster / leather coat tails
  if (L.coatPat !== 'vest' && (L.coat === '#6b5032' || L.coat === '#4a2c1a' || L.coat === '#1c1d22')) {
    stroke(c, 3, coatD, [-0.6, -1], dn(p.thigh * 0.45 - 8, 6, [-1.2, -0.5]));
  }
  // near leg
  const knee = dn(p.thigh, 5, hip);
  const foot = dn(p.shin, 4.6, knee);
  stroke(c, 3, TROUSERS, hip, knee, foot);
  const sx = Math.sin(rad(p.shin)), sy = Math.cos(rad(p.shin));
  stroke(c, 3, BOOTS, [foot[0] - sx * 1.6, foot[1] - sy * 1.6], foot, [foot[0] + sy * 1.6, foot[1] - sx * 1.6]);
  // torso
  stroke(c, 5.2, coat, [hip[0], hip[1] - 0.5], sh);
  if (L.coatPat === 'vest') stroke(c, 3, '#d4a52a', up(p.torso, 1, [0.9, 0]), up(p.torso, 6, [0.9, 0]));
  if (L.coatPat === 'poncho') { stroke(c, 6, '#8a3a1c', up(p.torso, 2.5, hip), sh); stroke(c, 1.2, '#d4a52a', up(p.torso, 4, [-2.6, 0]), up(p.torso, 4, [2.6, 0])); }
  stroke(c, 1.2, '#2a1a10', dn(p.torso + 90, 2.4, [0, -0.6]), dn(p.torso - 90, 2.4, [0, -0.6])); // belt
  // neck + bandana
  stroke(c, 2.4, L.skin[0], sh, up(p.torso + p.head, 2, sh));
  if (L.scarf) { disc(c, sh[0] + 0.4, sh[1] - 0.2, 1.9, L.scarf); const t = dn(p.torso + 70, 2.2, sh); disc(c, t[0], t[1], 1.1, L.scarf); }
  // head + hat
  c.save(); c.translate(headC[0], headC[1]); c.rotate(rad(p.torso + p.head)); drawHead(c, L, blink); c.restore();
  // near arm
  const elb = dn(p.uArm, 4.4, sh);
  const hand = dn(p.fArm, 3.8, elb);
  stroke(c, 2.4, coat, sh, elb, hand);
  disc(c, hand[0], hand[1], 1.1, L.skin[1]);
}

const riderCache = new Map<string, HTMLCanvasElement>();
/**
 * A rider sprite (RIDER_C x RIDER_C) with the hip at the centre, rotated `deg` BACKWARD (counter-clockwise on screen,
 * facing right). `sig` must identify the look.
 */
export function riderSprite(sig: string, L: BustLook, p: RPose, deg: number, opts: { farLeg?: boolean; blink?: boolean } = {}): HTMLCanvasElement {
  const q = (v: number, s: number) => Math.round(v / s) * s;
  const dq = q(((deg % 360) + 360) % 360, 4);
  const pk = `${q(p.torso, 3)},${q(p.head, 4)},${q(p.thigh, 4)},${q(p.shin, 4)},${q(p.uArm, 5)},${q(p.fArm, 5)}`;
  const key = `${sig}|${pk}|${dq}|${opts.farLeg === false ? 0 : 1}${opts.blink ? 1 : 0}`;
  const hit = riderCache.get(key);
  if (hit) return hit;
  const [cv, c] = makeCanvas(RIDER_C, RIDER_C);
  c.imageSmoothingEnabled = true;
  c.translate(RIDER_C / 2, RIDER_C / 2);
  c.rotate(-rad(dq));
  c.translate(0, -2); // spin about the chest-ish centre of mass rather than the hip
  c.translate(0, 2);
  drawBody(c, L, { torso: q(p.torso, 3), head: q(p.head, 4), thigh: q(p.thigh, 4), shin: q(p.shin, 4), uArm: q(p.uArm, 5), fArm: q(p.fArm, 5) }, opts.farLeg !== false, !!opts.blink);
  c.setTransform(1, 0, 0, 1, 0, 0);
  const pal = [L.coat, shade(L.coat, 0.6), L.coatPat === 'vest' ? '#e8e0cc' : L.coat, shade(L.coatPat === 'vest' ? '#e8e0cc' : L.coat, 0.6),
    ...L.skin, L.hair, L.hatCol, shade(L.hatCol, 0.62), L.band, TROUSERS, shade(TROUSERS, 0.7), BOOTS, PAL.ink, '#2a1a10',
    ...(L.scarf ? [L.scarf] : []), '#d4a52a', '#8a3a1c', '#f2d36b', '#2f6a3a', '#4f9a5a', '#3f7a34', '#e05a8a', '#d98a7a'];
  snap(c, RIDER_C, RIDER_C, pal, PAL.ink);
  if (riderCache.size > 900) riderCache.clear();
  riderCache.set(key, cv);
  return cv;
}

/* ============================== horse ============================== */

const HORSE_COATS: { body: string; mane: string; paint?: boolean }[] = [
  { body: '#7a4424', mane: '#1a120c' },   // bay
  { body: '#a0552a', mane: '#5e2a12' },   // chestnut
  { body: '#2e2522', mane: '#0f0b09' },   // black
  { body: '#a39d94', mane: '#4a4540' },   // grey
  { body: '#d1a24a', mane: '#f3e6c4' },   // palomino
  { body: '#e8dcc8', mane: '#3a2a1c', paint: true }, // paint
];
const BLANKETS = ['#9e1b1b', '#24345e', '#2f6a3a', '#b8891d'];
export const HORSE_W = 56, HORSE_H = 38;
/** sprite anchor: the saddle centre at the hooves' ground line */
export const HORSE_AX = 26, HORSE_AY = 36;

export type HorseMode = 'idle' | 'thud' | 'gallop' | 'rear';
const horseCache = new Map<string, HTMLCanvasElement>();
/** a horse facing right. frame: gallop leg frame (0..3) / tail swish (0..2) */
export function horseSprite(variant: number, mode: HorseMode, frame: number): HTMLCanvasElement {
  const key = `${variant}|${mode}|${frame}`;
  const hit = horseCache.get(key);
  if (hit) return hit;
  const [cv, c] = makeCanvas(HORSE_W, HORSE_H);
  const coat = HORSE_COATS[variant % HORSE_COATS.length];
  const blanket = BLANKETS[(variant >>> 4) % BLANKETS.length];
  const C = coat.body, D = shade(C, 0.68), Lh = shade(C, 1.22), M = coat.mane;
  const R = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const gy = HORSE_AY - 1; // hoof row
  const dip = mode === 'thud' ? 1 : 0;
  const rear = mode === 'rear' ? 1 : 0;
  // legs: [hipX, phase]
  const legs: [number, number, boolean][] = [[16, 0, false], [19, 2, true], [33, 1, false], [36, 3, true]];
  const legDx = (ph: number) => {
    if (mode === 'gallop') return [-4, -1, 3, 1][(ph + frame) & 3];
    return 0;
  };
  const legLift = (ph: number) => (mode === 'gallop' ? [0, 2, 1, 0][(ph + frame) & 3] : 0);
  for (const [lx, ph, near] of legs) {
    if (near) continue;
    const dx = legDx(ph), lift = legLift(ph) + rear * (lx > 25 ? 3 : 0);
    for (let y = 23 + dip; y <= gy - lift; y++) {
      const t = (y - 23) / (gy - 23);
      R(Math.round(lx + dx * t), y, 2, 1, D);
    }
    R(Math.round(lx + dx), gy - lift, 3, 1, PAL.ink);
  }
  // tail
  const sw = mode === 'gallop' ? -3 : [0, 1, -1][frame % 3];
  for (let i = 0; i < 11; i++) {
    const x = Math.round(10 - i * 0.35 + (sw * i) / 10), y = 15 + i + dip;
    R(x, y, 2, 1, M);
  }
  // body
  ellipse(c, 25, 20 + dip, 11, 5, C);
  ellipse(c, 15, 19 + dip, 6, 5, C);
  ellipse(c, 35, 19 + dip - rear, 5, 5, C);
  R(14, 23 + dip, 24, 1, D); // belly shade
  R(17, 15 + dip, 6, 1, Lh); // rump highlight
  if (coat.paint) {
    for (let y = 14; y < 26; y++) for (let x = 10; x < 41; x++) {
      if (rnd(Math.floor(x / 4), Math.floor(y / 3), variant) > 0.55 && c.getImageData(x, y + dip, 1, 1).data[3]) R(x, y + dip, 1, 1, '#7a4424');
    }
  }
  // neck + head
  const hy = (mode === 'gallop' ? -1 + (frame & 1) : 0) + dip - rear * 3;
  for (let i = 0; i <= 8; i++) {
    const x = 35 + i * 0.95, y = 17 - i * 1.15 + hy * (i / 8);
    ellipse(c, Math.round(x), Math.round(y), 2, 2, C);
  }
  R(41, 5 + hy, 8, 5, C);       // head
  R(47, 7 + hy, 4, 4, D);       // muzzle
  R(50, 9 + hy, 1, 1, PAL.ink); // nostril
  R(44, 6 + hy, 1, 1, PAL.ink); // eye
  R(42, 3 + hy, 2, 2, D);       // ear
  for (let i = 0; i <= 8; i++) R(Math.round(34 + i * 0.95), Math.round(14 - i * 1.15 + hy * (i / 8)), 2, 1, M); // mane
  R(42, 4 + hy, 2, 1, M);
  // bridle + reins
  R(45, 9 + hy, 4, 1, '#3a2010'); R(43, 5 + hy, 1, 5, '#3a2010');
  for (let i = 0; i < 12; i++) R(Math.round(31 + i * 1.2), Math.round(13 + (hy - 3) * (i / 12) + Math.sin(i / 3) * 1.2 + dip), 1, 1, '#3a2010');
  // saddle blanket + saddle
  R(18, 15 + dip, 14, 4, blanket); R(18, 17 + dip, 14, 1, shade(blanket, 0.6)); R(18, 15 + dip, 14, 1, shade(blanket, 1.3));
  R(19, 13 + dip, 12, 3, '#5a3018'); R(21, 14 + dip, 8, 1, '#7a4a28');
  R(19, 11 + dip, 2, 3, '#5a3018'); // cantle
  R(30, 10 + dip, 2, 4, '#5a3018'); R(30, 10 + dip, 2, 1, '#8a5a30'); // horn
  R(25, 16 + dip, 1, 7, '#3a2010'); R(24, 23 + dip, 3, 1, PAL.metal3); // stirrup
  // near legs
  for (const [lx, ph, near] of legs) {
    if (!near) continue;
    const dx = legDx(ph), lift = legLift(ph) + rear * (lx > 25 ? 3 : 0);
    for (let y = 22 + dip; y <= gy - lift; y++) {
      const t = (y - 22) / (gy - 22);
      R(Math.round(lx + dx * t), y, 2, 1, y > gy - 4 ? shade(C, 0.85) : C);
    }
    R(Math.round(lx + dx), gy - lift, 3, 1, PAL.ink);
  }
  // ink outline for readability against the street
  const img = c.getImageData(0, 0, HORSE_W, HORSE_H), d = img.data, sol = new Uint8Array(HORSE_W * HORSE_H);
  for (let i = 0; i < sol.length; i++) sol[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  for (let y = 0; y < HORSE_H; y++) for (let x = 0; x < HORSE_W; x++) {
    const i = y * HORSE_W + x; if (sol[i]) continue;
    if ((x > 0 && sol[i - 1]) || (x < HORSE_W - 1 && sol[i + 1]) || (y > 0 && sol[i - HORSE_W]) || (y < HORSE_H - 1 && sol[i + HORSE_W])) {
      d[i * 4] = 11; d[i * 4 + 1] = 7; d[i * 4 + 2] = 5; d[i * 4 + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  horseCache.set(key, cv);
  return cv;
}

/* ============================== scenery ============================== */

const SKY = ['#3f8fd6', '#5aa6e2', '#7fbfea', '#a9d6ee', '#d6ecec'];
const STREET = ['#c9a46a', '#b8915a', '#a37c4a'];
const FONT: Record<string, string[]> = {
  S: ['111', '100', '111', '001', '111'], A: ['010', '101', '111', '101', '101'], L: ['100', '100', '100', '100', '111'],
  O: ['111', '101', '101', '101', '111'], N: ['101', '111', '111', '111', '101'],
};
function text3x5(c: Ctx, s: string, x: number, y: number, col: string) {
  for (const ch of s) {
    const g = FONT[ch];
    if (g) for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '1') { c.fillStyle = col; c.fillRect(x + k, y + r, 1, 1); }
    x += 4;
  }
}

export interface Geo { W: number; H: number; ox: number; oy: number; lanes: number; dx: number; dy: number }
/** world (x right, y up from the front lane's street line) -> canvas pixels, for depth lane k */
export const toScreen = (g: Geo, x: number, y: number, k = 0): [number, number] => [g.ox + x + k * g.dx, g.oy - y - k * g.dy];

/** the static backdrop: sky, mesas, town, street, the saloon's side wall + roof (clouds/sun are drawn live) */
export function renderBackdrop(g: Geo, roof: number): HTMLCanvasElement {
  const { W, H, ox, oy, lanes, dx, dy } = g;
  const [cv, c] = makeCanvas(W, H);
  const R = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const depth = (lanes - 1) * dy;
  const horizon = oy - depth - 22;
  // sky (dithered bands)
  for (let y = 0; y < horizon + 2; y++) {
    const f = Math.min(0.999, Math.max(0, (y - (horizon - 150)) / 150)) * (SKY.length - 1);
    const i = Math.floor(f), t = f - i;
    for (let x = 0; x < W; x++) R(x, y, 1, 1, t > bayer(x, y) ? SKY[Math.min(SKY.length - 1, i + 1)] : SKY[i]);
  }
  // distant mesas
  const mesa = (base: number, col: string, top: string, seed: number, hgt: number) => {
    let h = 0;
    for (let x = 0; x < W; x++) {
      const n = rnd(Math.floor((x + seed * 31) / 23), 0, seed);
      const target = n > 0.55 ? hgt * (0.6 + n * 0.5) : hgt * 0.15 * n;
      h += (target - h) * (Math.abs(target - h) > 3 ? 0.35 : 1);
      const hh = Math.round(h);
      R(x, base - hh, 1, hh + 1, col);
      if (hh > 4) R(x, base - hh, 1, 1, top);
    }
  };
  mesa(horizon, '#c98a5a', '#e0a878', 3, 26);
  mesa(horizon + 2, '#a8582e', '#c4703c', 7, 16);
  // far town silhouettes
  for (let i = 0; i < 9; i++) {
    const bx = ox + 70 + i * 26 + Math.round(rnd(i, 4, 9) * 10), bw = 12 + Math.round(rnd(i, 5, 9) * 10), bh = 8 + Math.round(rnd(i, 6, 9) * 9);
    if (bx > W) break;
    R(bx, horizon + 2 - bh, bw, bh, '#8a6a4a'); R(bx, horizon + 2 - bh, bw, 1, '#a88866'); R(bx + 3, horizon - bh + 6, 2, 2, '#4a3426');
  }
  // street
  for (let y = horizon + 2; y < H; y++) {
    const f = Math.min(1, (y - horizon) / Math.max(10, H - horizon)) * (STREET.length - 1);
    const i = Math.min(STREET.length - 2, Math.floor(f)), t = f - i;
    for (let x = 0; x < W; x++) {
      let col = t > bayer(x, y) ? STREET[i + 1] : STREET[i];
      const n = rnd(x, y, 5);
      if (n > 0.985) col = '#8a6a40'; else if (n < 0.012) col = '#e0c08a';
      R(x, y, 1, 1, col);
    }
  }
  // wheel ruts
  for (const ry of [horizon + 6, oy + 6]) for (let x = 0; x < W; x++) if (rnd(x, ry, 2) > 0.25) R(x, ry, 1, 1, '#9a7444');
  // hitching post (behind the horses)
  {
    const [hx, hy] = toScreen(g, 66, 0, lanes);
    R(hx, hy - 13, 2, 13, '#5a3a22'); R(hx + 24, hy - 13, 2, 13, '#5a3a22'); R(hx - 1, hy - 13, 28, 2, '#7a5232'); R(hx - 1, hy - 11, 28, 1, '#3b2416');
    R(hx + 9, hy - 11, 1, 3, '#3a2010');
  }
  // the saloon: side wall (clapboard), corner face receding into depth, roof, false front
  const [wx, wy] = toScreen(g, 0, 0, 0); // front-bottom corner of the roof edge
  const top = wy - roof;
  // corner face (street side, in depth)
  for (let k = 0; k <= depth; k++) {
    const x = wx + Math.round((k * dx) / dy);
    R(x, top - k, 1, roof + 1, k % 4 === 0 ? '#5a3a22' : '#6b4424');
  }
  // roof top (receding)
  for (let k = 0; k <= depth + 3; k++) {
    const x1 = wx + Math.round((k * dx) / dy);
    R(0, top - k - 1, Math.max(0, x1 + 1), 1, k === 0 ? '#3b2416' : k % 5 === 0 ? '#4a4038' : '#5c5048');
  }
  // side wall (front)
  for (let y = top; y < wy; y++) {
    const r = (y - top) % 4;
    for (let x = 0; x < wx; x++) R(x, y, 1, 1, r === 0 ? '#5a3a22' : rnd(Math.floor(x / 9), y, 1) > 0.85 ? '#8a5a32' : '#7a4c2a');
  }
  R(0, top, wx, 1, '#3b2416'); R(0, top + 1, wx, 1, '#a0703e'); // eave trim
  R(wx - 1, top, 2, roof, '#4a2c18');
  // windows on the side wall
  for (let i = 0; i < 4; i++) {
    const x = wx - 22 - i * 34;
    if (x < -14) break;
    const y = top + Math.round(roof * 0.28);
    R(x - 1, y - 1, 12, 16, '#3b2416'); R(x, y, 10, 14, '#2a3a4a'); R(x, y, 10, 2, '#6f8fae'); R(x + 4, y, 2, 14, '#3b2416'); R(x, y + 6, 10, 1, '#3b2416');
    R(x - 4, y - 1, 3, 16, '#5a7a3a'); R(x + 11, y - 1, 3, 16, '#5a7a3a'); // shutters
  }
  // painted sign on the wall
  if (wx > 60) {
    const sx = wx - 58, sy = top + Math.round(roof * 0.62);
    R(sx - 2, sy - 2, 28, 9, '#e8d5b5'); R(sx - 1, sy - 1, 26, 7, '#9e1b1b');
    text3x5(c, 'SALOON', sx, sy, '#e8d5b5');
  }
  // false front at the far end of the roof (stepped parapet, seen edge-on)
  {
    const fx = wx - 46;
    if (fx > -8) {
      for (let k = 0; k <= depth + 3; k++) {
        const x = fx + Math.round((k * dx) / dy);
        R(x, top - k - 22, 4, 22, k % 3 ? '#8a5a32' : '#7a4c2a');
      }
      R(fx, top - 24, 4 + Math.round(((depth + 3) * dx) / dy), 2, '#3b2416');
      R(fx - 2, top - 26, 8, 2, '#5a3a22');
    }
  }
  // porch shadow at the base + water trough in front of the horses
  for (let x = 0; x < wx; x++) R(x, wy, 1, 2, '#8a6a40');
  {
    const [tx, ty] = toScreen(g, 12, -5, 0);
    R(tx, ty - 7, 16, 7, '#5a3a22'); R(tx + 1, ty - 6, 14, 2, '#3a6a8a'); R(tx + 1, ty - 6, 14, 1, '#7fbfea'); R(tx, ty - 7, 16, 1, '#7a5232');
    R(tx + 1, ty, 2, 1, '#3b2416'); R(tx + 13, ty, 2, 1, '#3b2416');
  }
  // a cactus far right
  {
    const [kx, ky] = toScreen(g, 104, 0, lanes + 1);
    if (kx < W - 4) { R(kx, ky - 16, 4, 16, '#3f7a34'); R(kx - 4, ky - 11, 3, 6, '#3f7a34'); R(kx - 4, ky - 6, 5, 2, '#3f7a34'); R(kx + 5, ky - 13, 3, 6, '#3f7a34'); R(kx + 3, ky - 8, 4, 2, '#3f7a34'); R(kx + 1, ky - 16, 1, 16, '#5a9a4a'); }
  }
  return cv;
}

/** sun + drifting clouds (cheap; drawn every frame) */
export function drawSky(c: Ctx, g: Geo, ms: number) {
  const R = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const sx = g.W - 26, sy = 18;
  ellipse(c, sx, sy, 10, 10, '#fff3b8');
  ellipse(c, sx, sy, 7, 7, '#fffbe6');
  for (let a = 0; a < 8; a++) { const t = (a / 8) * Math.PI * 2 + ms / 6000; if (bayer(a, 0) > 0.2) R(sx + Math.cos(t) * 14, sy + Math.sin(t) * 14, 1, 1, '#fff3b8'); }
  for (let i = 0; i < 5; i++) {
    const w = 18 + Math.round(rnd(i, 1, 4) * 22);
    const span = g.W + w + 20;
    const x = ((rnd(i, 2, 4) * span + ms / (900 + i * 300)) % span) - w;
    const y = 8 + Math.round(rnd(i, 3, 4) * 40);
    R(x, y + 3, w, 4, '#ffffff'); R(x + 3, y + 1, w - 8, 2, '#ffffff'); R(x + 6, y - 1, Math.max(4, w / 3), 2, '#ffffff');
    R(x + 2, y + 7, w - 4, 1, '#cfe6f2');
  }
}
