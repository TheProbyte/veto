// Horse Drop physics: a deterministic, fixed-timestep gainer off the saloon roof onto a saddled horse.
// Pure functions of (seed, pid, inputs) so every client replays everyone's jump identically.
//
// World units are scene pixels; y is UP from the street (0), x is forward (away from the building), the roof edge is x = 0.
//
// INPUTS (what goes over the wire, max 16 integers, ascending, ms relative to MY jump start):
//   [pressAt = 0, releaseAt, re-pressAt, re-releaseAt, ...]
// The first press is the take-off; the button is held (TUCK) until inputs[1], open (LAYOUT) until inputs[2], and so on.
// A missing trailing release means the tuck was held to the end.
//
// Controls: total tuck time sets how far you rotate (tuck spins ~2.8x faster than the open layout);
// WHERE you tuck sets the carry: the open layout catches air (horizontal drag), the tuck doesn't, so tucking early
// carries you further out and tucking late drops you shorter. Each player's horse stands at its own spot (from the seed).

export const DT = 5;                 // ms per fixed step (200 Hz)
export const ROOF = 76;              // roof surface height
export const HIP0 = ROOF + 10;       // hip height standing on the roof
export const X0 = -5;                // hip x standing at the edge
export const SADDLE = 21;            // saddle top height
export const SEAT = SADDLE + 3;      // hip height when seated: the landing is judged when the hip reaches this
export const VX0 = 42;               // take-off forward speed (px/s)
export const VY0 = 52;               // take-off upward speed
export const G = 130;                // gravity
export const W_OPEN = 150;           // deg/s backward rotation fully open (layout)
export const TUCK_RATIO = 2.8;       // tuck spins this much faster (moment of inertia ratio)
export const TAU = 60;               // ms: body shape eases toward tuck / open with this time constant
export const DRAG = 0.9;             // 1/s horizontal drag while fully open
export const STRADDLE_DEG = 25;      // within this of upright...
export const STRADDLE_DX = 7;        // ...and this far from the saddle centre = you're on the horse
export const SADDLE_MID = 40;        // nominal saddle centre x: a plain hold-from-take-off lands ~42, a delayed tuck ~31
export const OFFSET_RANGE = 2;       // per-player saddle offset: SADDLE_MID ± this (kept small so a plain hold is fair for everyone)
export const MAX_INPUTS = 16;

export interface Frame { t: number; x: number; y: number; deg: number; tuck: number }
export type Outcome = 'perfect' | 'clean' | 'wobbly' | 'short' | 'long' | 'back' | 'face';
export interface Jump {
  frames: Frame[];      // one per DT, up to and including the landing
  landMs: number;       // ms after take-off when the hip reached saddle height
  err: number;          // deg off upright at landing (negative = under-rotated: pitched forward; positive = over-rotated: leaning back)
  dx: number;           // hip x - saddle centre (negative = short)
  straddled: boolean;
  score: number;        // 0..100 (what the client sends; the server stores x10)
  outcome: Outcome;
  label: string;
}

/** deterministic uint32 hash of a string */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return h >>> 0;
}

/** where this player's horse stands: saddle centre x (integer px) */
export function saddleX(seed: number, pid: string): number {
  const h = hash(`${seed}|${pid}|horse`);
  return SADDLE_MID + (h % (OFFSET_RANGE * 2 + 1)) - OFFSET_RANGE;
}
/** cosmetic per-player randomness (horse coat, idle phase...) */
export function horseVariant(seed: number, pid: string): number { return hash(`${seed}|${pid}|coat`); }

/** sanitize an input timeline: integers, ascending, starts at 0, max 16 */
export function cleanInputs(inp: readonly number[] | undefined): number[] {
  const out: number[] = [0];
  if (!inp) return out;
  for (let i = 1; i < inp.length && out.length < MAX_INPUTS; i++) {
    const v = Math.round(Number(inp[i]));
    if (!Number.isFinite(v) || v < out[out.length - 1]) break;
    out.push(v);
  }
  return out;
}

/** is the button held at ms `t` after take-off */
export function heldAt(inputs: readonly number[], t: number): boolean {
  let held = true;
  for (let i = 1; i < inputs.length; i++) { if (inputs[i] <= t) held = !held; else break; }
  return held;
}

export const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * labels + scores, matching the server's label bands (>=95 Perfect, >=75 Clean, >=40 Wobbly, else Missed):
 * straddled = 40..100 (perfect >= 95, clean >= 75, else wobbly); any miss = 0..10.
 */
export function judge(err: number, dx: number): { straddled: boolean; score: number; outcome: Outcome; label: string } {
  const ae = Math.abs(err), ad = Math.abs(dx);
  const straddled = ae <= STRADDLE_DEG && ad <= STRADDLE_DX;
  if (straddled) {
    const s = Math.max(40, Math.min(100, Math.round(100 - 55 * Math.pow(ae / STRADDLE_DEG, 1.3) - 20 * Math.pow(ad / STRADDLE_DX, 2))));
    const outcome: Outcome = s >= 95 ? 'perfect' : s >= 75 ? 'clean' : 'wobbly';
    const label = outcome === 'perfect' ? 'Perfect landing!' : outcome === 'clean' ? 'Clean landing' : 'Wobbly';
    return { straddled, score: s, outcome, label };
  }
  const over = Math.max(0, ae - STRADDLE_DEG) / 60 + Math.max(0, ad - STRADDLE_DX) / 12;
  const score = Math.max(0, Math.min(10, Math.round(10 * (1 - over))));
  let outcome: Outcome;
  if (ad > STRADDLE_DX && (ae <= STRADDLE_DEG || ad - STRADDLE_DX > (ae - STRADDLE_DEG) / 6)) outcome = dx < 0 ? 'short' : 'long';
  else outcome = err < 0 ? 'face' : 'back'; // under-rotated = still pitching forward = faceplant
  const label = outcome === 'short' ? 'Missed the horse' : outcome === 'long' ? 'Overshot the horse' : outcome === 'back' ? 'Landed on his back' : 'Faceplant';
  return { straddled, score, outcome, label };
}

/**
 * Simulate a jump. `upTo` (ms) stops early for live rendering (state at that time); otherwise runs to the landing.
 * The trajectory up to t only depends on inputs <= t, so re-simulating each frame from scratch is consistent.
 */
export function simulate(inputsRaw: readonly number[], saddle: number, upTo = Infinity): Jump {
  const inputs = cleanInputs(inputsRaw);
  const frames: Frame[] = [];
  let x = X0, y = HIP0, vx = VX0, vy = VY0, deg = 0, tuck = 0;
  const dt = DT / 1000;
  const k = 1 - Math.exp(-DT / TAU);
  const wTuck = W_OPEN * TUCK_RATIO;
  let t = 0;
  frames.push({ t, x, y, deg, tuck });
  let landMs = -1;
  for (let i = 0; i < 2000; i++) {
    const held = heldAt(inputs, t);
    tuck += ((held ? 1 : 0) - tuck) * k;
    const w = W_OPEN + (wTuck - W_OPEN) * tuck; // L / I(tuck), L conserved
    vx *= Math.exp(-DRAG * (1 - tuck) * dt);
    const ny = y + vy * dt - 0.5 * G * dt * dt;
    vy -= G * dt;
    const nx = x + vx * dt;
    const nd = deg + w * dt;
    t += DT;
    if (ny <= SEAT && vy < 0) {
      // interpolate to the exact crossing so the landing doesn't snap to the step grid
      const f = (y - SEAT) / Math.max(1e-6, y - ny);
      x = x + (nx - x) * f; deg = deg + (nd - deg) * f; y = SEAT;
      landMs = t - DT + DT * f;
      frames.push({ t: landMs, x, y, deg, tuck });
      break;
    }
    x = nx; y = ny; deg = nd;
    frames.push({ t, x, y, deg, tuck });
    if (t >= upTo) break;
  }
  const last = frames[frames.length - 1];
  const err = wrapDeg(last.deg);
  const dx = last.x - saddle;
  const j = judge(err, dx);
  return { frames, landMs, err, dx, ...j };
}

/** body state at ms `t` of a simulated jump (interpolated); clamps to the landing frame */
export function frameAt(j: Jump, t: number): Frame {
  const f = j.frames;
  if (t <= 0) return f[0];
  const i = Math.floor(t / DT);
  if (i >= f.length - 1) return f[f.length - 1];
  const a = f[i], b = f[i + 1];
  const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, deg: a.deg + (b.deg - a.deg) * u, tuck: a.tuck + (b.tuck - a.tuck) * u };
}

/**
 * A stand-in timeline whose landing matches a stored score (bots: the server rolls a random score and a random
 * timeline). Searches a plain hold [0, r] for the closest score with the same on/off-the-horse result.
 */
export function fakeInputsFor(score100: number, saddle: number): number[] {
  const want = score100 >= 40;
  let best: number[] = [0, 525], bd = Infinity;
  for (let r = 80; r <= 1300; r += 5) {
    const j = simulate([0, r], saddle);
    const d = Math.abs(j.score - score100) + (j.straddled === want ? 0 : 1000);
    if (d < bd) { bd = d; best = [0, r]; }
  }
  return best;
}
