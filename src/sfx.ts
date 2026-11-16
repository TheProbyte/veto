// Sound effects API (Web Audio synthesis, no asset files). Implementation owned by the "sounds+panels" agent.
// All functions are safe to call before user gesture (they no-op until unlock()).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let fxBus: GainNode | null = null; // send into the shared convolution room reverb
let noiseBuf: AudioBuffer | null = null;
let muted = readMuted();
let volume = readVolume();

function readMuted(): boolean {
  try { return localStorage.getItem('nah.muted') === '1'; } catch { return false; }
}
function readVolume(): number {
  try {
    const raw = localStorage.getItem('nah.volume');
    if (raw == null) return 0.7;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
  } catch { return 0.7; }
}
const level = () => (muted ? 0 : volume);
function applyLevel() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(level(), t, 0.05);
}

/** Wooden room impulse: stereo decaying noise with early reflections, darker as it decays. */
function roomImpulse(c: AudioContext, secs = 1.2): AudioBuffer {
  const rate = c.sampleRate;
  const len = Math.floor(rate * secs);
  const buf = c.createBuffer(2, len, rate);
  const taps = [0.011, 0.019, 0.027, 0.041, 0.058, 0.073];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const decay = Math.pow(1 - x, 3.2) * Math.exp(-x * 3);
      const k = 0.25 + 0.7 * x; // progressively darker tail (one-pole lowpass)
      lp += (1 - k) * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * decay * 0.9;
    }
    for (const tp of taps) {
      const at = Math.floor((tp + (ch ? 0.0037 : 0)) * rate);
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.55 - tp * 4);
    }
  }
  return buf;
}

function init(): boolean {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }
  try {
    const AC: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = level();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    master.connect(comp).connect(ctx.destination);

    // shared convolution room
    fxBus = ctx.createGain();
    fxBus.gain.value = 1;
    const pre = ctx.createDelay(0.1);
    pre.delayTime.value = 0.012;
    const conv = ctx.createConvolver();
    conv.buffer = roomImpulse(ctx, 1.2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 140;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 3800;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    fxBus.connect(pre).connect(conv).connect(hp).connect(damp).connect(wet).connect(master);

    // shared 2s white noise buffer
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  } catch {
    ctx = null;
    return false;
  }
}

const ready = () => !!ctx && !!master;
const now = () => ctx!.currentTime;

function noise(loop = false): AudioBufferSourceNode {
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = loop;
  if (!loop) s.loopStart = 0;
  return s;
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function filt(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Route a node into master (and optionally the reverb bus). */
function out(node: AudioNode, wet = 0) {
  node.connect(master!);
  if (wet > 0 && fxBus) {
    const w = ctx!.createGain();
    w.gain.value = wet;
    node.connect(w).connect(fxBus);
  }
}

function noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, dur: number, wet = 0, q = 0.7, offset = Math.random()) {
  const s = noise();
  const f = filt(type, freq, q);
  const g = ctx!.createGain();
  env(g, t, peak, 0.002, dur);
  s.connect(f).connect(g);
  out(g, wet);
  s.start(t, offset, dur + 0.05);
}

function tone(t: number, type: OscillatorType, f0: number, f1: number, peak: number, dur: number, wet = 0, attack = 0.003) {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx!.createGain();
  env(g, t, peak, attack, dur);
  o.connect(g);
  out(g, wet);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
  return o;
}

/** Karplus-Strong pluck, pre-rendered in JS (a DelayNode feedback loop can't go below one render quantum). */
const pluckCache = new Map<number, AudioBuffer>();
function pluckBuf(freq: number, secs = 1.6): AudioBuffer {
  const key = Math.round(freq * 10);
  const hit = pluckCache.get(key);
  if (hit) return hit;
  const rate = ctx!.sampleRate;
  const len = Math.floor(rate * secs);
  const buf = ctx!.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  const N = Math.max(2, Math.round(rate / freq));
  const ring = new Float32Array(N);
  // pick position: slightly lowpassed noise burst
  let prev = 0;
  for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = prev * 0.4 + r * 0.6; ring[i] = prev; }
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const a = ring[idx];
    const b = ring[(idx + 1) % N];
    const y = 0.4985 * (a + b);
    ring[idx] = y;
    d[i] = a;
    idx = (idx + 1) % N;
  }
  pluckCache.set(key, buf);
  return buf;
}
function pluck(t: number, midi: number, peak: number, wet = 0.5) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const src = ctx!.createBufferSource();
  src.buffer = pluckBuf(f);
  const body = filt('peaking', 220, 1.2);
  body.gain.value = 5; // wooden body resonance
  const lp = filt('lowpass', 3600);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  src.connect(body).connect(lp).connect(g);
  out(g, wet);
  src.start(t);
  src.stop(t + 1.6);
}
function bell(t: number, f: number, peak: number, wet = 0.8) {
  for (const [mult, a, d] of [[1, 1, 1.8], [2.76, 0.4, 1.0], [5.4, 0.2, 0.55], [8.93, 0.08, 0.3]] as const) {
    tone(t, 'sine', f * mult, f * mult, peak * a, d, wet, 0.002);
  }
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- loops ----------
let fuseNodes: { stop: () => void } | null = null;
let ambNodes: { stop: () => void } | null = null;
let wantAmbience = false;
let wantFuse = false;

function startFuse() {
  if (!ready() || fuseNodes) return;
  const t = now();
  const s = noise(true);
  const bp = filt('bandpass', 5200, 1.4);
  const hp = filt('highpass', 2000);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.15);
  // wobble the hiss
  const lfo = ctx!.createOscillator();
  lfo.frequency.value = 7;
  const lg = ctx!.createGain();
  lg.gain.value = 0.05;
  lfo.connect(lg).connect(g.gain);
  s.connect(bp).connect(hp).connect(g);
  out(g);
  s.start(t);
  lfo.start(t);
  let alive = true;
  const pop = () => {
    if (!alive || !ready()) return;
    const tt = now();
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) noiseHit(tt + i * 0.018 * Math.random(), 'highpass', 3000 + Math.random() * 3000, 0.25 + Math.random() * 0.3, 0.008 + Math.random() * 0.01);
    timer = window.setTimeout(pop, 40 + Math.random() * 220);
  };
  let timer = window.setTimeout(pop, 60);
  fuseNodes = {
    stop() {
      alive = false;
      clearTimeout(timer);
      const tt = now();
      g.gain.cancelScheduledValues(tt);
      g.gain.setValueAtTime(g.gain.value, tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.12);
      s.stop(tt + 0.2);
      lfo.stop(tt + 0.2);
    },
  };
}

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic, honky-tonk friendly
function pianoNote(t: number, midi: number, vel: number) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = ctx!.createGain();
  const dur = 1.2 + Math.random() * 0.7;
  env(g, t, vel, 0.003, dur);
  const lp = filt('lowpass', 1500 + Math.random() * 700);
  // honky-tonk: detuned pair of strings + a quiet octave partial; tiny hammer knock
  for (const [det, type, mul, lvl] of [[-13, 'triangle', 1, 1], [12 + Math.random() * 8, 'triangle', 1, 1], [4, 'sine', 2, 0.35]] as const) {
    const o = ctx!.createOscillator();
    o.type = type;
    o.frequency.value = f * mul;
    o.detune.value = det;
    const og = ctx!.createGain();
    og.gain.value = lvl;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  lp.connect(g);
  out(g, 0.7);
  noiseHit(t, 'bandpass', 1800, vel * 0.5, 0.012, 0.3, 2);
}
function glassClink(t: number) {
  const f = rnd(2600, 3600);
  const g = 0.012 + Math.random() * 0.012;
  tone(t, 'sine', f, f * 0.995, g, 0.5, 0.9, 0.001);
  tone(t, 'sine', f * 1.51, f * 1.5, g * 0.6, 0.35, 0.9, 0.001);
  if (Math.random() < 0.5) tone(t + rnd(0.06, 0.12), 'sine', f * 1.08, f * 1.07, g * 0.5, 0.3, 0.9, 0.001);
}

function startAmbience() {
  if (!ready() || ambNodes) return;
  const t = now();
  const s = noise(true);
  const lp = filt('lowpass', 420, 2.2);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.045, t + 3);
  // slow gusts: modulate filter and gain
  const lfo = ctx!.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoF = ctx!.createGain();
  lfoF.gain.value = 260;
  lfo.connect(lfoF).connect(lp.frequency);
  const lfo2 = ctx!.createOscillator();
  lfo2.frequency.value = 0.13;
  const lfoG = ctx!.createGain();
  lfoG.gain.value = 0.018;
  lfo2.connect(lfoG).connect(g.gain);
  s.connect(lp).connect(g);
  out(g);
  s.start(t);
  lfo.start(t);
  lfo2.start(t);

  let alive = true;
  let timer = 0;
  let glassTimer = 0;
  const play = () => {
    if (!alive || !ready()) return;
    const tt = now() + 0.02;
    const root = 55 + 12 * Math.floor(Math.random() * 2); // G3 / G4
    const pick = () => root + PENTA[Math.floor(Math.random() * PENTA.length)] + (Math.random() < 0.25 ? 12 : 0);
    const n = 2 + Math.floor(Math.random() * 3); // 2..4 note phrase
    let at = tt;
    for (let i = 0; i < n; i++) {
      pianoNote(at, pick(), 0.02 + Math.random() * 0.018);
      at += Math.random() < 0.5 ? 0.22 : 0.33;
    }
    if (Math.random() < 0.35) { pianoNote(tt, root - 12, 0.02); pianoNote(tt, root - 5, 0.014); }
    timer = window.setTimeout(play, 2500 + Math.random() * 4500);
  };
  const clink = () => {
    if (!alive || !ready()) return;
    glassClink(now() + 0.02);
    glassTimer = window.setTimeout(clink, 7000 + Math.random() * 14000);
  };
  timer = window.setTimeout(play, 1500);
  glassTimer = window.setTimeout(clink, 5000 + Math.random() * 6000);
  ambNodes = {
    stop() {
      alive = false;
      clearTimeout(timer);
      clearTimeout(glassTimer);
      const tt = now();
      g.gain.cancelScheduledValues(tt);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 1);
      s.stop(tt + 1.1);
      lfo.stop(tt + 1.1);
      lfo2.stop(tt + 1.1);
    },
  };
}

export const sfx = {
  // --- music (stub API; implemented by the audio agent) ---
  music(_mode: 'off' | 'lobby' | 'veto' | 'roulette' | 'result') {},
  setMusicVolume(_v: number) {},
  getMusicVolume(): number { return 0.5; },
  unlock() {               // call on first user click/keydown; resumes AudioContext
    if (!init()) return;
    if (wantAmbience) startAmbience();
    if (wantFuse) startFuse();
  },
  setMuted(m: boolean) {
    muted = m;
    try { localStorage.setItem('nah.muted', m ? '1' : '0'); } catch {}
    applyLevel();
  },
  setVolume(v: number) {   // master volume 0..1 (persisted)
    volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : volume;
    try { localStorage.setItem('nah.volume', String(Math.round(volume * 1000) / 1000)); } catch {}
    applyLevel();
  },
  getVolume(): number { return volume; },
  isMuted(): boolean { return muted; },
  ambience(on: boolean) {  // low wind + distant saloon piano loop
    wantAmbience = on;
    if (!ready()) return;
    if (on) startAmbience();
    else { ambNodes?.stop(); ambNodes = null; }
  },
  shot() {                 // gunshot (veto hit): crack + body + sub thump, echoing in the room
    if (!ready()) return;
    const t = now();
    const v = rnd(0.88, 1.12); // per-shot variation
    // crack: sharp highpassed transient
    const c = noise();
    const hp = filt('highpass', 2200 * v, 0.8);
    const cg = ctx!.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(1.6, t + 0.0012);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    c.connect(hp).connect(cg);
    out(cg, 0.8);
    c.start(t, Math.random(), 0.08);
    // body: lowpassed noise with a falling cutoff
    const b = noise();
    const lp = filt('lowpass', 5000 * v, 1.1);
    lp.frequency.setValueAtTime(5000 * v, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.3);
    const bg = ctx!.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(1.3, t + 0.003);
    bg.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    b.connect(lp).connect(bg);
    out(bg, 1.0);
    b.start(t, Math.random(), 0.5);
    // sub thump 50-60Hz + a punchier upper knock
    const sub = rnd(50, 60);
    tone(t, 'sine', sub * 2.2, sub, 1.25, 0.32, 0.15, 0.002);
    tone(t, 'sine', 160 * v, 70, 0.6, 0.09, 0, 0.001);
    // late room slap off the far wall
    noiseHit(t + rnd(0.07, 0.1), 'bandpass', 900 * v, 0.12, 0.25, 0.9, 0.8);
  },
  ricochet() {             // shot deflected by tin star: metallic ping with a fast downward sweep
    if (!ready()) return;
    const t = now();
    const v = rnd(0.92, 1.08);
    noiseHit(t, 'highpass', 3800, 0.7, 0.03, 0.4);
    // two detuned sines sweeping down, with a little ring
    for (const [f0, det, a] of [[3400 * v, 0, 0.22], [3400 * v, 23, 0.16]] as const) {
      const o = ctx!.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.32, t + 0.42);
      o.detune.value = det;
      const g = ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.006);
      g.gain.exponentialRampToValueAtTime(a * 0.3, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      o.connect(g);
      out(g, 0.9);
      o.start(t);
      o.stop(t + 0.7);
    }
    // inharmonic ring
    for (const [f, a] of [[5230, 0.05], [7180, 0.03]] as const) tone(t, 'sine', f * v, f * v * 0.97, a, 0.4, 0.8, 0.002);
  },
  stamp() {                // thick wooden THUNK
    if (!ready()) return;
    const t = now();
    tone(t, 'sine', 140, 48, 1.3, 0.26, 0.35, 0.002);
    tone(t, 'triangle', 260, 120, 0.4, 0.07, 0.2, 0.001);
    noiseHit(t, 'bandpass', 520, 0.9, 0.09, 0.4, 1.4);   // wood knock
    noiseHit(t, 'lowpass', 1800, 0.5, 0.025, 0.2);         // contact snap
    noiseHit(t + 0.012, 'bandpass', 230, 0.45, 0.16, 0.3, 2); // hollow box
  },
  click() {                // revolver cylinder click / UI tick
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'highpass', 4200, 0.55, 0.012);
    tone(t, 'square', 2400, 1800, 0.05, 0.012);
    noiseHit(t + 0.018, 'bandpass', 2600, 0.2, 0.01, 0, 3);
  },
  spin() {                 // ratcheting cylinder spin: rapid clicks slowing over ~1s
    if (!ready()) return;
    const t0 = now() + 0.01;
    noiseHit(t0, 'bandpass', 900, 0.18, 0.5, 0.2, 0.8); // whirr
    let at = 0;
    let gap = 0.026;
    while (at < 1.05) {
      const tt = t0 + at;
      const p = rnd(0.9, 1.1);
      noiseHit(tt, 'highpass', 4000 * p, 0.4, 0.008, 0.15);
      tone(tt, 'square', 2600 * p, 2000 * p, 0.03, 0.008);
      at += gap;
      gap *= 1.12;
    }
    noiseHit(t0 + at, 'bandpass', 2200, 0.5, 0.02, 0.3, 2); // seat into place
  },
  hover() {                // tiny tick for button hover
    if (!ready()) return;
    const t = now();
    tone(t, 'sine', 3200, 2600, 0.025, 0.012, 0, 0.001);
    noiseHit(t, 'highpass', 6000, 0.05, 0.006);
  },
  cock() {                 // hammer cocked (your turn starts)
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'bandpass', 1800, 0.5, 0.02, 0.1, 2);
    tone(t, 'square', 900, 600, 0.06, 0.02);
    noiseHit(t + 0.13, 'highpass', 3000, 0.8, 0.018, 0.2);
    tone(t + 0.13, 'square', 1600, 1100, 0.08, 0.015);
    tone(t + 0.13, 'sine', 220, 120, 0.25, 0.05);
  },
  fuse(on: boolean) {      // fuse hiss loop while your turn timer burns (last 10s)
    wantFuse = on;
    if (!ready()) return;
    if (on) startFuse();
    else { fuseNodes?.stop(); fuseNodes = null; }
  },
  whoosh() {               // box sliding / carousel move
    if (!ready()) return;
    const t = now();
    const s = noise();
    const bp = filt('bandpass', 400, 1.2);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.28);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    s.connect(bp).connect(g);
    out(g, 0.2);
    s.start(t, Math.random(), 0.35);
  },
  chair() {                // player sits down
    if (!ready()) return;
    const t = now();
    // creak: buzzy saw with wobbling pitch through a resonant bandpass
    const o = ctx!.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(190, t + 0.18);
    o.frequency.linearRampToValueAtTime(120, t + 0.4);
    const bp = filt('bandpass', 900, 6);
    const am = ctx!.createOscillator();
    am.type = 'square';
    am.frequency.value = 34;
    const amg = ctx!.createGain();
    amg.gain.value = 0.06;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    am.connect(amg).connect(g.gain);
    o.connect(bp).connect(g);
    out(g, 0.3);
    o.start(t); am.start(t);
    o.stop(t + 0.45); am.stop(t + 0.45);
    // scrape + settle thud
    noiseHit(t + 0.05, 'bandpass', 1200, 0.12, 0.25, 0, 2);
    tone(t + 0.42, 'sine', 110, 55, 0.4, 0.12);
    noiseHit(t + 0.42, 'lowpass', 900, 0.2, 0.05);
  },
  win() {                  // Western sting: whistle over a strummed chord, ending on a bell
    if (!ready()) return;
    const t = now() + 0.03;
    // strummed chords (A minor -> E -> A), Karplus-Strong plucks
    const strum = (at: number, notes: number[], vel: number, down = true) => {
      const ns = down ? notes : [...notes].reverse();
      ns.forEach((m, i) => pluck(t + at + i * 0.022, m, vel * rnd(0.85, 1.1)));
    };
    strum(0, [45, 52, 57, 60, 64], 0.32);
    strum(0.45, [45, 52, 57, 60, 64], 0.2, false);
    strum(0.9, [40, 47, 52, 56, 59], 0.3);
    strum(1.35, [45, 52, 57, 61, 64], 0.36);
    // whistled melody: sine + vibrato + breath noise
    const notes: [number, number, number][] = [
      [76, 0.0, 0.16], [81, 0.18, 0.16], [84, 0.36, 0.28], [83, 0.68, 0.14], [79, 0.84, 0.14], [81, 1.02, 0.9],
    ];
    for (const [m, at, dur] of notes) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      const st = t + at;
      const o = ctx!.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 0.96, st); // scoop into the note
      o.frequency.exponentialRampToValueAtTime(f, st + 0.04);
      const vib = ctx!.createOscillator();
      vib.frequency.value = 5.8;
      const vg = ctx!.createGain();
      vg.gain.setValueAtTime(0, st);
      vg.gain.linearRampToValueAtTime(f * 0.014, st + dur);
      vib.connect(vg).connect(o.frequency);
      const g = ctx!.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.16, st + 0.03);
      g.gain.setValueAtTime(0.14, st + dur * 0.75);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur + 0.14);
      o.connect(g);
      out(g, 0.7);
      o.start(st); vib.start(st);
      o.stop(st + dur + 0.2); vib.stop(st + dur + 0.2);
      // breath
      const br = noise();
      const bp = filt('bandpass', f, 6);
      const bg = ctx!.createGain();
      env(bg, st, 0.05, 0.02, dur);
      br.connect(bp).connect(bg);
      out(bg, 0.5);
      br.start(st, Math.random(), dur + 0.1);
    }
    // bell on the resolve + a low boom
    const bt = t + 1.35;
    bell(bt, 1320, 0.22);
    tone(bt, 'sine', 110, 55, 0.45, 0.6, 0.4);
  },
  tick() {                 // countdown tick (last 5s)
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'bandpass', 3200, 0.35, 0.015, 0.1, 4);
    tone(t, 'sine', 1900, 1500, 0.08, 0.03);
  },
};
