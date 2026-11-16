// Sound effects API (Web Audio synthesis, no asset files). Implementation owned by the "sounds+panels" agent.
// All functions are safe to call before user gesture (they no-op until unlock()).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let fxBus: GainNode | null = null; // into a small reverb-ish feedback delay
let noiseBuf: AudioBuffer | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try { return localStorage.getItem('nah.muted') === '1'; } catch { return false; }
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
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // tail: feedback delay with damping, a cheap saloon room
    fxBus = ctx.createGain();
    fxBus.gain.value = 1;
    const d1 = ctx.createDelay(1);
    d1.delayTime.value = 0.083;
    const d2 = ctx.createDelay(1);
    d2.delayTime.value = 0.127;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    fxBus.connect(d1);
    d1.connect(damp).connect(d2).connect(fb).connect(d1);
    d2.connect(wet).connect(master);

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

const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic
function pianoNote(t: number, midi: number, vel: number) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = ctx!.createGain();
  env(g, t, vel, 0.004, 1.1 + Math.random() * 0.6);
  const lp = filt('lowpass', 1800 + Math.random() * 600);
  // honky-tonk: detuned pair
  for (const det of [-14, 11 + Math.random() * 8]) {
    const o = ctx!.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(lp);
    o.start(t);
    o.stop(t + 2);
  }
  lp.connect(g);
  out(g, 0.6);
}

function startAmbience() {
  if (!ready() || ambNodes) return;
  const t = now();
  const s = noise(true);
  const lp = filt('lowpass', 420, 2.2);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 3);
  // slow gusts: modulate filter and gain
  const lfo = ctx!.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoF = ctx!.createGain();
  lfoF.gain.value = 260;
  lfo.connect(lfoF).connect(lp.frequency);
  const lfo2 = ctx!.createOscillator();
  lfo2.frequency.value = 0.13;
  const lfoG = ctx!.createGain();
  lfoG.gain.value = 0.025;
  lfo2.connect(lfoG).connect(g.gain);
  s.connect(lp).connect(g);
  out(g);
  s.start(t);
  lfo.start(t);
  lfo2.start(t);

  let alive = true;
  let timer = 0;
  const play = () => {
    if (!alive || !ready()) return;
    const tt = now() + 0.02;
    const root = 50 + 12 * Math.floor(Math.random() * 2); // D3 / D4
    const pick = () => root + PENTA[Math.floor(Math.random() * PENTA.length)] + (Math.random() < 0.3 ? 12 : 0);
    pianoNote(tt, pick(), 0.035 + Math.random() * 0.03);
    if (Math.random() < 0.4) pianoNote(tt + 0.18 + Math.random() * 0.2, pick(), 0.025);
    if (Math.random() < 0.15) pianoNote(tt, root - 12, 0.03);
    timer = window.setTimeout(play, 1000 + Math.random() * 3000);
  };
  timer = window.setTimeout(play, 1500);
  ambNodes = {
    stop() {
      alive = false;
      clearTimeout(timer);
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
  unlock() {               // call on first user click/keydown; resumes AudioContext
    if (!init()) return;
    if (wantAmbience) startAmbience();
    if (wantFuse) startFuse();
  },
  setMuted(m: boolean) {
    muted = m;
    try { localStorage.setItem('nah.muted', m ? '1' : '0'); } catch {}
    if (ctx && master) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(m ? 0 : 0.8, t, 0.05);
    }
  },
  isMuted(): boolean { return muted; },
  ambience(on: boolean) {  // low wind + distant saloon piano loop
    wantAmbience = on;
    if (!ready()) return;
    if (on) startAmbience();
    else { ambNodes?.stop(); ambNodes = null; }
  },
  shot() {                 // gunshot (veto hit)
    if (!ready()) return;
    const t = now();
    // crack: noise through a sweeping lowpass
    const s = noise();
    const lp = filt('lowpass', 9000, 0.9);
    lp.frequency.setValueAtTime(9000, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.35);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.4, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(lp).connect(g);
    out(g, 0.9);
    s.start(t, Math.random(), 0.6);
    // body thump
    tone(t, 'sine', 120, 45, 1.1, 0.28);
    tone(t, 'sine', 62, 38, 0.8, 0.4);
    // decaying room tail
    noiseHit(t + 0.03, 'bandpass', 700, 0.18, 0.9, 0.5, 0.6);
  },
  ricochet() {             // shot deflected by tin star
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'highpass', 3500, 0.6, 0.04);
    // metallic ping: inharmonic partials
    for (const [f, a] of [[3150, 0.18], [4720, 0.1], [6230, 0.06]] as const) tone(t, 'sine', f, f * 0.98, a, 0.35, 0.4);
    // pyeeew
    const o = ctx!.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2000, t + 0.02);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.7);
    const vib = ctx!.createOscillator();
    vib.frequency.value = 28;
    const vg = ctx!.createGain();
    vg.gain.value = 40;
    vib.connect(vg).connect(o.frequency);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(g);
    out(g, 0.7);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.8);
    vib.stop(t + 0.8);
  },
  stamp() {                // heavy NAH. stamp thud
    if (!ready()) return;
    const t = now();
    tone(t, 'sine', 90, 40, 1.2, 0.32, 0.3);
    tone(t, 'triangle', 180, 70, 0.3, 0.08);
    noiseHit(t, 'lowpass', 2600, 0.7, 0.05, 0.3);
    noiseHit(t, 'bandpass', 400, 0.4, 0.12, 0.2, 1.2);
  },
  click() {                // revolver cylinder click / UI tick
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'highpass', 4200, 0.55, 0.012);
    tone(t, 'square', 2400, 1800, 0.05, 0.012);
    noiseHit(t + 0.018, 'bandpass', 2600, 0.2, 0.01, 0, 3);
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
  win() {                  // result reveal sting
    if (!ready()) return;
    const t = now() + 0.02;
    // A minor pentatonic whistle resolving up: E A C D E . A'
    const notes: [number, number, number][] = [
      [64, 0, 0.14], [69, 0.15, 0.14], [72, 0.3, 0.14], [74, 0.45, 0.22], [76, 0.7, 0.18], [81, 0.92, 0.9],
    ];
    for (const [m, at, dur] of notes) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      const st = t + at;
      const vib = ctx!.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx!.createGain();
      vg.gain.setValueAtTime(0, st);
      vg.gain.linearRampToValueAtTime(f * 0.012, st + dur);
      vib.connect(vg);
      const g = ctx!.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.22, st + 0.025);
      g.gain.setValueAtTime(0.2, st + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur + 0.12);
      const lp = filt('lowpass', 3200);
      const types: [OscillatorType, number][] = [['triangle', 1], ['square', 0.18]];
      for (const [ty, lvl] of types) {
        const o = ctx!.createOscillator();
        o.type = ty;
        o.frequency.value = f;
        vg.connect(o.frequency);
        const og = ctx!.createGain();
        og.gain.value = lvl;
        o.connect(og).connect(lp);
        o.start(st);
        o.stop(st + dur + 0.2);
      }
      lp.connect(g);
      out(g, 0.6);
      vib.start(st);
      vib.stop(st + dur + 0.2);
    }
    // bell ding on the resolve
    const bt = t + 0.92;
    for (const [mult, a, d] of [[1, 0.25, 1.6], [2.76, 0.1, 0.9], [5.4, 0.05, 0.5]] as const) tone(bt, 'sine', 1320 * mult, 1320 * mult, a, d, 0.8, 0.002);
    // low boom under it
    tone(bt, 'sine', 110, 55, 0.5, 0.6, 0.4);
  },
  tick() {                 // countdown tick (last 5s)
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'bandpass', 3200, 0.35, 0.015, 0.1, 4);
    tone(t, 'sine', 1900, 1500, 0.08, 0.03);
  },
};
