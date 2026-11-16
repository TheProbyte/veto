// Sound effects + music API (Web Audio synthesis, no asset files).
// All functions are safe to call before user gesture (they no-op until unlock()).
// Graph: effects -> master (effects volume) ┐
//        music  -> musicGain (music volume) ┴> mainOut (mute) -> compressor -> out
import { useEffect } from 'react';
import { createMusic, whistle as whistleVoice, type MusicEngine, type MusicMode } from './music';

export type { MusicMode } from './music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;   // effects volume
let mainOut: GainNode | null = null;  // mute
let musicGain: GainNode | null = null; // music volume
let fxBus: GainNode | null = null; // send into the shared convolution room reverb
let noiseBuf: AudioBuffer | null = null;
let impulse: AudioBuffer | null = null;
let engine: MusicEngine | null = null;
let wantMusic: MusicMode = 'off';
let muted = readMuted();
let volume = readVolume();
let musicVolume = readMusicVolume();
const MUSIC_TRIM = 0.85; // music sits under the effects at equal slider positions

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
function readMusicVolume(): number {
  try {
    const raw = localStorage.getItem('nah.musicVolume');
    if (raw == null) return 0.45;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.45;
  } catch { return 0.45; }
}
function applyLevel() {
  if (!ctx || !master || !mainOut || !musicGain) return;
  const t = ctx.currentTime;
  for (const [g, v] of [[master, volume], [mainOut, muted ? 0 : 1], [musicGain, musicVolume * MUSIC_TRIM]] as const) {
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(v, t, 0.05);
  }
}
const musicAudible = () => !!engine && engine.playing() && !muted && musicVolume > 0.01;

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
    master.gain.value = volume;
    mainOut = ctx.createGain();
    mainOut.gain.value = muted ? 0 : 1;
    musicGain = ctx.createGain();
    musicGain.gain.value = musicVolume * MUSIC_TRIM;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    master.connect(mainOut);
    musicGain.connect(mainOut);
    mainOut.connect(comp).connect(ctx.destination);

    // shared convolution room
    fxBus = ctx.createGain();
    fxBus.gain.value = 1;
    const pre = ctx.createDelay(0.1);
    pre.delayTime.value = 0.012;
    const conv = ctx.createConvolver();
    impulse = roomImpulse(ctx, 1.2);
    conv.buffer = impulse;
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

function startMusic() {
  if (!ready()) return;
  if (!engine) {
    if (wantMusic === 'off') return;
    engine = createMusic({ ctx: ctx!, dest: musicGain!, noise: noiseBuf!, impulse: impulse!, pluckBuf: (f) => pluckBuf(f) });
  }
  engine.setMode(wantMusic); // no-op when already in that mode
}
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
function whistle(t: number, midi: number, dur: number, peak: number, wet = 0.6) {
  const w = ctx!.createGain();
  w.gain.value = wet;
  w.connect(fxBus!);
  whistleVoice(ctx!, noiseBuf!, t, midi, dur, peak, master!, w);
  window.setTimeout(() => w.disconnect(), (t - ctx!.currentTime + dur + 1) * 1000);
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
    timer = window.setTimeout(play, 2500 + Math.random() * 4500);
    if (musicAudible()) return; // free-time piano would clash with the music loop; keep wind + glass
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
  // --- music ---
  music(mode: MusicMode) { // background music mode; same mode = no-op; ~1s crossfade; starts only after unlock()
    wantMusic = mode;
    startMusic();
  },
  getMusicMode(): MusicMode { return wantMusic; },
  setMusicVolume(v: number) { // music volume 0..1 (persisted 'nah.musicVolume')
    musicVolume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : musicVolume;
    try { localStorage.setItem('nah.musicVolume', String(Math.round(musicVolume * 1000) / 1000)); } catch {}
    applyLevel();
  },
  getMusicVolume(): number { return musicVolume; },
  unlock() {               // call on first user click/keydown; resumes AudioContext (idempotent)
    if (!init()) return;
    if (wantAmbience) startAmbience();
    if (wantFuse) startFuse();
    startMusic();
  },
  setMuted(m: boolean) {
    muted = m;
    try { localStorage.setItem('nah.muted', m ? '1' : '0'); } catch {}
    applyLevel();
  },
  setVolume(v: number) {   // effects volume 0..1 (persisted 'nah.volume')
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
  chair() {                // player sits down (same as chairScrape)
    sfx.chairScrape();
  },
  chairScrape() {          // wooden chair dragged on boards (stick-slip judder), creak, settle thud
    if (!ready()) return;
    const t = now();
    const v = rnd(0.9, 1.1);
    // stick-slip scrape: resonant bandpassed noise chopped by a speeding-up square
    const s = noise();
    const bp = filt('bandpass', 750 * v, 3.5);
    bp.frequency.setValueAtTime(650 * v, t);
    bp.frequency.linearRampToValueAtTime(980 * v, t + 0.3);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.04);
    g.gain.setValueAtTime(0.3, t + 0.24);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    const chop = ctx!.createGain();
    chop.gain.value = 0.5;
    const am = ctx!.createOscillator();
    am.type = 'square';
    am.frequency.setValueAtTime(22, t);
    am.frequency.linearRampToValueAtTime(48, t + 0.3);
    const amg = ctx!.createGain();
    amg.gain.value = 0.5;
    am.connect(amg).connect(chop.gain);
    s.connect(bp).connect(chop).connect(g);
    out(g, 0.25);
    s.start(t, Math.random(), 0.4);
    am.start(t); am.stop(t + 0.38);
    // creak
    const o = ctx!.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150 * v, t + 0.05);
    o.frequency.linearRampToValueAtTime(210 * v, t + 0.22);
    const cb = filt('bandpass', 1100, 7);
    const cg = ctx!.createGain();
    env(cg, t + 0.05, 0.05, 0.04, 0.2);
    o.connect(cb).connect(cg);
    out(cg, 0.2);
    o.start(t + 0.05); o.stop(t + 0.35);
    // settle
    tone(t + 0.38, 'sine', 120, 55, 0.45, 0.12, 0.2);
    noiseHit(t + 0.38, 'lowpass', 900, 0.25, 0.05, 0.2);
  },
  boots() {                // two footsteps on wooden boards
    if (!ready()) return;
    const t = now() + 0.01;
    [0, 0.34].forEach((at, i) => {
      const tt = t + at + rnd(-0.01, 0.01);
      const v = rnd(0.9, 1.1) * (i ? 0.92 : 1);
      noiseHit(tt, 'highpass', 2400 * v, 0.18, 0.012, 0.1);                  // heel click
      tone(tt + 0.012, 'sine', 130 * v, 60, 0.6, 0.09, 0.25, 0.002);           // board thud
      noiseHit(tt + 0.012, 'bandpass', 380 * v, 0.5, 0.07, 0.3, 1.2);         // wood body
      noiseHit(tt + 0.07, 'bandpass', 900 * v, 0.08, 0.05, 0.1, 2);           // sole scuff
    });
  },
  spurs() {                // spur jingle: two little rattling rowels
    if (!ready()) return;
    const t = now() + 0.01;
    [0, 0.26].forEach((at) => {
      const n = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const tt = t + at + i * rnd(0.022, 0.04);
        const f = rnd(3600, 5200);
        tone(tt, 'sine', f, f * 0.99, rnd(0.03, 0.05), rnd(0.12, 0.22), 0.5, 0.001);
        tone(tt, 'sine', f * 1.47, f * 1.46, 0.015, 0.08, 0.4, 0.001);
        noiseHit(tt, 'highpass', 6000, 0.08, 0.006);
      }
    });
  },
  cardSlap() {             // crisp paper card slapped down on felt
    if (!ready()) return;
    const t = now();
    const v = rnd(0.92, 1.08);
    noiseHit(t, 'bandpass', 2600 * v, 0.7, 0.025, 0.15, 0.9);  // paper snap
    noiseHit(t, 'lowpass', 700, 0.45, 0.04, 0.1);              // air push
    tone(t, 'sine', 190 * v, 90, 0.28, 0.05, 0.1, 0.001);       // felt thump
    noiseHit(t + 0.01, 'highpass', 5000, 0.12, 0.015);          // edge flick
  },
  cardSlide() {            // card sliding back across felt: soft swish
    if (!ready()) return;
    const t = now();
    const s = noise();
    const bp = filt('bandpass', 2800, 1.1);
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.22);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    s.connect(bp).connect(g);
    out(g, 0.1);
    s.start(t, Math.random(), 0.3);
  },
  cardRiffle() {           // deck riffle: a fast burr of card flicks, then the deck squares up
    if (!ready()) return;
    const t0 = now() + 0.01;
    let at = 0;
    let gap = 0.03;
    for (let i = 0; i < 22; i++) {
      const p = rnd(0.85, 1.15);
      noiseHit(t0 + at, 'bandpass', 3400 * p, 0.28 * rnd(0.7, 1), 0.012, 0.1, 1.6);
      at += gap;
      gap = i < 12 ? Math.max(0.012, gap * 0.86) : gap * 1.1;
    }
    noiseHit(t0, 'bandpass', 2000, 0.06, at, 0.1, 0.6);         // paper bed
    noiseHit(t0 + at + 0.03, 'lowpass', 1200, 0.4, 0.03, 0.15); // tap square
    tone(t0 + at + 0.03, 'sine', 170, 90, 0.2, 0.05, 0.1, 0.001);
  },
  clink() {                // tin star pinned: bright metal clink with a short ring
    if (!ready()) return;
    const t = now();
    const v = rnd(0.95, 1.05);
    noiseHit(t, 'highpass', 5000, 0.35, 0.01, 0.2);
    for (const [f, a, d] of [[2950, 0.12, 0.35], [4180, 0.08, 0.25], [6320, 0.05, 0.16], [8900, 0.025, 0.1]] as const) {
      tone(t, 'sine', f * v, f * v * 0.998, a, d, 0.6, 0.001);
    }
    tone(t + 0.07, 'sine', 4180 * v, 4170 * v, 0.03, 0.12, 0.6, 0.001); // tiny bounce
  },
  hammerNail() {           // hammer on a nail into wood: metal tick + wood thunk
    if (!ready()) return;
    const t = now();
    const v = rnd(0.9, 1.1);
    noiseHit(t, 'highpass', 3500, 0.6, 0.012, 0.2);
    tone(t, 'square', 1900 * v, 1500 * v, 0.06, 0.02, 0.2, 0.001);
    tone(t, 'sine', 2600 * v, 2580 * v, 0.05, 0.09, 0.3, 0.001);   // nail ring
    tone(t, 'sine', 170 * v, 65, 0.9, 0.14, 0.4, 0.001);            // wall thunk
    noiseHit(t + 0.004, 'bandpass', 600 * v, 0.6, 0.08, 0.4, 1.4);  // wood knock
  },
  cylinderOpen() {         // revolver cylinder swings out: metal swing + latch click
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'bandpass', 2400, 0.3, 0.015, 0.1, 3); // release
    const s = noise();
    const bp = filt('bandpass', 900, 5);
    bp.frequency.setValueAtTime(900, t + 0.01);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.17);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    s.connect(bp).connect(g);
    out(g, 0.2);
    s.start(t + 0.01, Math.random(), 0.22);
    tone(t + 0.02, 'sine', 1250, 1320, 0.03, 0.18, 0.4, 0.01);     // metal ring
    const tc = t + 0.2;                                            // latch
    noiseHit(tc, 'highpass', 4200, 0.6, 0.012, 0.2);
    tone(tc, 'square', 2200, 1600, 0.06, 0.012);
    tone(tc, 'sine', 300, 150, 0.2, 0.04);
    noiseHit(tc + 0.02, 'bandpass', 2800, 0.2, 0.01, 0.1, 3);
  },
  drawSting() {            // "DRAW!": cymbal swell into a low orchestral hit + one high whistle
    if (!ready()) return;
    const t = now();
    const hit = t + 0.45;
    // cymbal swell (reverse-cymbal style)
    const s = noise();
    const hp = filt('highpass', 5200, 0.7);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, hit - 0.01);
    g.gain.linearRampToValueAtTime(0.0001, hit + 0.02);
    s.connect(hp).connect(g);
    out(g, 0.6);
    s.start(t, Math.random() * 0.5, 0.5);
    // the hit: low drum + brassy stab (Am) + crash
    tone(hit, 'sine', 95, 38, 1.2, 0.7, 0.8, 0.002);
    noiseHit(hit, 'lowpass', 1600, 0.8, 0.25, 0.9);
    noiseHit(hit, 'highpass', 4500, 0.35, 0.8, 0.8);
    const lp = filt('lowpass', 2400, 1);
    lp.frequency.setValueAtTime(2400, hit);
    lp.frequency.exponentialRampToValueAtTime(500, hit + 0.5);
    const sg = ctx!.createGain();
    sg.gain.setValueAtTime(0.0001, hit);
    sg.gain.exponentialRampToValueAtTime(0.16, hit + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, hit + 0.6);
    lp.connect(sg);
    out(sg, 0.8);
    for (const m of [45, 52, 57, 60, 64]) {
      const o = ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      o.detune.value = rnd(-8, 8);
      o.connect(lp);
      o.start(hit); o.stop(hit + 0.65);
    }
    whistle(hit + 0.08, 93, 0.6, 0.12, 0.7); // single high A
  },
  hatPop() {               // hat drops onto a head: soft felt fwump
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'lowpass', 420, 0.55, 0.11, 0.1);
    tone(t, 'sine', 150, 70, 0.35, 0.09, 0.05, 0.004);
    noiseHit(t, 'bandpass', 1200, 0.06, 0.04, 0, 1);
  },
  swish() {                // cloth swish (outfit option)
    if (!ready()) return;
    const t = now();
    const v = rnd(0.85, 1.15);
    const s = noise();
    const bp = filt('bandpass', 1400 * v, 0.9);
    bp.frequency.setValueAtTime(900 * v, t);
    bp.frequency.exponentialRampToValueAtTime(3000 * v, t + 0.08);
    bp.frequency.exponentialRampToValueAtTime(1100 * v, t + 0.17);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(bp).connect(g);
    out(g, 0.1);
    s.start(t, Math.random(), 0.22);
  },
  coin() {                 // coin flipped: thumb flick + spinning ting
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'highpass', 4000, 0.3, 0.008);
    const f = rnd(3900, 4300);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.013);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const spinG = ctx!.createGain();
    spinG.gain.value = 0.6;
    const lfo = ctx!.createOscillator();
    lfo.frequency.setValueAtTime(30, t);
    lfo.frequency.linearRampToValueAtTime(14, t + 0.5);
    const lg = ctx!.createGain();
    lg.gain.value = 0.4;
    lfo.connect(lg).connect(spinG.gain);
    for (const [mul, a] of [[1, 1], [1.53, 0.5], [2.4, 0.25]] as const) {
      const o = ctx!.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const og = ctx!.createGain();
      og.gain.value = a;
      o.connect(og).connect(spinG);
      o.start(t + 0.01); o.stop(t + 0.52);
    }
    spinG.connect(g);
    out(g, 0.5);
    lfo.start(t); lfo.stop(t + 0.52);
  },
  spit() {                 // comic "ptoo" ... ping! into the spittoon
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'lowpass', 1500, 0.4, 0.02);                 // "p"
    const o = ctx!.createOscillator();                        // "too"
    o.type = 'triangle';
    o.frequency.setValueAtTime(720, t + 0.03);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.16);
    const lp = filt('lowpass', 1400, 2);
    const g = ctx!.createGain();
    env(g, t + 0.03, 0.22, 0.01, 0.13);
    o.connect(lp).connect(g);
    out(g, 0.1);
    o.start(t + 0.03); o.stop(t + 0.2);
    noiseHit(t + 0.03, 'bandpass', 900, 0.15, 0.1, 0, 2);     // breathy
    const tp = t + 0.36;                                      // spittoon ping
    tone(tp, 'sine', 1750, 1740, 0.09, 0.4, 0.5, 0.001);
    tone(tp, 'sine', 2730, 2720, 0.04, 0.25, 0.5, 0.001);
    noiseHit(tp, 'bandpass', 2000, 0.12, 0.02, 0.2, 2);
  },
  win() {                  // victory: bright hammer clack -> big low boom -> 3-note rising whistle (<1.8s)
    if (!ready()) return;
    const t = now() + 0.02;
    // hammer clack
    noiseHit(t, 'highpass', 3800, 0.9, 0.014, 0.3);
    tone(t, 'square', 2300, 1500, 0.08, 0.016, 0.2, 0.001);
    noiseHit(t + 0.004, 'bandpass', 2600, 0.35, 0.02, 0.2, 3);
    // boom
    const b = t + 0.11;
    tone(b, 'sine', 96, 36, 1.3, 0.9, 0.7, 0.003);
    tone(b, 'sine', 180, 80, 0.4, 0.18, 0.3, 0.002);
    const n = noise();
    const lp = filt('lowpass', 1400, 0.9);
    lp.frequency.setValueAtTime(1400, b);
    lp.frequency.exponentialRampToValueAtTime(140, b + 0.6);
    const ng = ctx!.createGain();
    ng.gain.setValueAtTime(0.0001, b);
    ng.gain.exponentialRampToValueAtTime(0.9, b + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, b + 0.7);
    n.connect(lp).connect(ng);
    out(ng, 1.0);
    n.start(b, Math.random(), 0.75);
    // rising whistle A5 – C#6 – E6
    const w = t + 0.42;
    whistle(w, 81, 0.12, 0.13, 0.6);
    whistle(w + 0.15, 85, 0.12, 0.13, 0.6);
    whistle(w + 0.3, 88, 0.4, 0.15, 0.6);
  },
  tick() {                 // countdown tick (last 5s)
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'bandpass', 3200, 0.35, 0.015, 0.1, 4);
    tone(t, 'sine', 1900, 1500, 0.08, 0.03);
  },
};

/** Phase -> music mode. Home (undefined) and lobby/nominate -> 'lobby'. */
export function musicForPhase(phase: string | undefined): MusicMode {
  switch (phase) {
    case 'veto': return 'veto';
    case 'roulette': return 'roulette';
    case 'result': return 'result';
    default: return 'lobby';
  }
}

/** Keep background music in step with the game phase. Never turns music off on unmount (avoids fade flicker on remounts). */
export function useMusicForPhase(phase: string | undefined) {
  const mode = musicForPhase(phase);
  useEffect(() => { sfx.music(mode); }, [mode]);
}
