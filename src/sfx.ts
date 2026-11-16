// Sound effects + music API (Web Audio synthesis; optional recorded rain/thunder from public/sfx, see sfxManifest;
// optional recorded music + win sting from /media, see mediaManifest). All functions are safe to call before a
// user gesture (they no-op until unlock()).
// Graph: effects -> master (effects volume) ──────────────────────┐
//        music (procedural engine | media tracks) -> musicGain -> musicDuck ┤
//        voice clips (src/voice.ts, routed via routeVoice) -> voiceGain ┴> mainOut (mute) -> compressor -> out
// Sliders are 0..1 positions; the gain is position² (perceptual taper) times a per-bus trim.
import { useEffect } from 'react';
import { createMusic, whistle as whistleVoice, type MusicEngine, type MusicMode } from './music';
import { SFX_FILES } from './sfxManifest';
import { MEDIA_FILES } from './mediaManifest';

export type { MusicMode } from './music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;   // effects volume
let mainOut: GainNode | null = null;  // mute
let musicGain: GainNode | null = null; // music volume
let musicDuck: GainNode | null = null; // dips the music under the recorded win sting
let voiceGain: GainNode | null = null; // voice volume (routed voice clips)
let fxBus: GainNode | null = null; // send into the shared convolution room reverb
let noiseBuf: AudioBuffer | null = null;
let impulse: AudioBuffer | null = null;
let engine: MusicEngine | null = null;
let wantMusic: MusicMode = 'off';
// v2 keys: the old 'nah.volume' / 'nah.musicVolume' were linear and much louder; everyone starts at the new defaults
const KEY_FX = 'nah.vol2.fx', KEY_MUSIC = 'nah.vol2.music', KEY_VOICE = 'nah.vol2.voice';
const DEFAULT_FX = 0.35, DEFAULT_MUSIC = 0.25;
let muted = readMuted();
let volume = readLevel(KEY_FX, DEFAULT_FX);
let musicVolume = readLevel(KEY_MUSIC, DEFAULT_MUSIC);
/** null = follows the Effects slider (until the Voice slider is moved) */
let voiceVolume: number | null = readLevel(KEY_VOICE, null);
// overall mix trims on top of the slider curve (effects ~-1.4 dB, music a bit more)
const FX_TRIM = 0.85;
const MUSIC_TRIM = 0.7;    // music sits under the effects at equal slider positions
const VOICE_TRIM = 0.5;    // the recordings are hot (-1.5 dBFS peaks) and pick up the compressor's makeup gain
const MEDIA_TRIM = 0.55;   // recorded music (-13..-16 LUFS, about as loud as the voice files): ~7 dB under the narrator
const STING_TRIM = 0.4;    // recorded win sting, on the effects bus
/** perceptual taper: slider position -> linear gain (0.5 -> -12 dB, 0.35 -> -18 dB, 0.25 -> -24 dB) */
export const sliderGain = (v: number) => v * v;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function readMuted(): boolean {
  try { return localStorage.getItem('nah.muted') === '1'; } catch { return false; }
}
function readLevel<T extends number | null>(key: string, dflt: T): number | T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return dflt;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? clamp01(v) : dflt;
  } catch { return dflt; }
}
function saveLevel(key: string, v: number) {
  try { localStorage.setItem(key, String(Math.round(v * 1000) / 1000)); } catch {}
}
const voicePos = () => voiceVolume ?? volume;
const fxLevel = () => sliderGain(volume) * FX_TRIM;
const voiceLevel = () => sliderGain(voicePos()) * VOICE_TRIM;
const levelListeners = new Set<() => void>();
function applyLevel() {
  for (const f of levelListeners) { try { f(); } catch { /* listener error */ } }
  if (!ctx || !master || !mainOut || !musicGain) return;
  const t = ctx.currentTime;
  // hidden page: also fade the output (a backstop for browsers that don't honour ctx.suspend())
  const pairs: [GainNode | null, number][] = [
    [master, fxLevel()], [mainOut, muted || bgHidden ? 0 : 1], [musicGain, sliderGain(musicVolume) * MUSIC_TRIM], [voiceGain, voiceLevel()],
  ];
  for (const [g, v] of pairs) {
    if (!g) continue;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(v, t, 0.05);
  }
  if (rainBus) { // the rain bed bypasses the compressor: its own volume + mute
    const g = rainBus.out.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(muted || bgHidden ? 0 : fxLevel() * RAIN_MAKEUP, t, 0.05);
  }
}
const musicAudible = () => ((!!engine && engine.playing()) || mediaPlaying()) && !muted && musicVolume > 0.01;

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
    reconcileCtx();
    return true;
  }
  try {
    const AC: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return false;
    // phones: a bigger output buffer ('playback') trades ~50 ms of latency for no audio dropouts
    // (stutter) when the canvas keeps the CPU busy; desktop keeps the snappy default.
    const coarse = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
    try { ctx = new AC(coarse ? { latencyHint: 'playback' } : undefined); } catch { ctx = new AC(); }
    master = ctx.createGain();
    master.gain.value = fxLevel();
    mainOut = ctx.createGain();
    mainOut.gain.value = muted || bgHidden ? 0 : 1;
    musicGain = ctx.createGain();
    musicGain.gain.value = sliderGain(musicVolume) * MUSIC_TRIM;
    musicDuck = ctx.createGain();
    voiceGain = ctx.createGain();
    voiceGain.gain.value = voiceLevel();
    // with the lower levels this is a safety limiter that rarely engages; threshold/knee/ratio are what
    // RAIN_MAKEUP is calibrated against, so only the timing changed (slower attack + release: no pumping)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.3;
    master.connect(mainOut);
    musicGain.connect(musicDuck).connect(mainOut);
    voiceGain.connect(mainOut);
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
    ctx.addEventListener('statechange', reconcileCtx);
    reconcileCtx();
    return true;
  } catch {
    ctx = null;
    return false;
  }
}

/** a context exists (unlocked) */
const live = () => !!ctx && !!master;
/** ...and the page is in the foreground: one-shots no-op while hidden (the clock is frozen, they'd burst on resume) */
const ready = () => live() && !bgHidden;

/* ---------- page lifecycle: nothing plays while the page is hidden / frozen ----------
 * Hidden (visibilitychange hidden, pagehide, freeze): the music scheduler pauses, the output fades and the
 * AudioContext is suspended, which freezes every loop (rain, wind, fuse) and any already-scheduled note
 * where it is; voice clips (src/voice.ts) pause via onBackground. Visible again (visibilitychange visible,
 * pageshow, resume): the context resumes, the frozen loops carry on from where they were and whatever was
 * toggled meanwhile is synced (never double-started). iOS / Edge can also leave the context 'interrupted'
 * (a call, another app taking audio): it's resumed on the next state change or user gesture. */
let bgHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
const bgListeners = new Set<(hidden: boolean) => void>();

function reconcileCtx() {
  if (!ctx) return;
  const st = ctx.state as string; // 'interrupted' (Safari) isn't in the TS union
  if (st === 'closed') return;
  if (bgHidden) { if (st === 'running') ctx.suspend().catch(() => {}); }
  else if (st !== 'running') ctx.resume().catch(() => {});
}
function setBackground(hidden: boolean) {
  if (hidden === bgHidden) return;
  bgHidden = hidden;
  engine?.setPaused(hidden);
  if (hidden) { pauseMedia(); applyLevel(); reconcileCtx(); }
  else { reconcileCtx(); applyLevel(); startMusic(); syncLoops(); }
  for (const f of bgListeners) { try { f(hidden); } catch { /* listener error */ } }
}
/** start / stop the loops to match what was asked for while the page was hidden */
function syncLoops() {
  if (!ready()) return;
  if (wantAmbience) startAmbience(); else { ambNodes?.stop(); ambNodes = null; }
  if (wantFuse) startFuse(); else { fuseNodes?.stop(); fuseNodes = null; }
  if (wantRain) startRain(); else stopRain();
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const shown = () => { if (document.visibilityState !== 'hidden') setBackground(false); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') setBackground(true); else shown(); });
  window.addEventListener('pagehide', () => setBackground(true));
  document.addEventListener('freeze', () => setBackground(true));
  window.addEventListener('pageshow', shown);
  document.addEventListener('resume', shown);
  // an 'interrupted' / stray-suspended context comes back on the next tap or key
  const kick = () => {
    if (ctx && !bgHidden && (ctx.state as string) !== 'running') reconcileCtx();
    retryBlockedMedia();
  };
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, kick, { capture: true, passive: true });
}

function startMusic() {
  if (!ready()) return;
  // a recorded track (when listed in mediaManifest and playable) replaces the procedural music for its modes
  const tr = trackFor(wantMusic);
  const useMedia = !!tr && mediaUsable(tr);
  const proc: MusicMode = useMedia ? 'off' : wantMusic;
  if (!engine && proc !== 'off') {
    engine = createMusic({ ctx: ctx!, dest: musicGain!, noise: noiseBuf!, impulse: impulse!, pluckBuf: (f) => pluckBuf(f), paused: bgHidden });
  }
  engine?.setMode(proc); // no-op when already in that mode
  setMediaTrack(useMedia ? tr : null, wantMusic === 'result' ? RESULT_MEDIA_LEVEL : 1);
}
const now = () => ctx!.currentTime;

function noise(loop = false): AudioBufferSourceNode {
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = loop;
  if (!loop) s.loopStart = 0;
  return s;
}

/** looping noise for the long beds (wind, synth rain): the shared 2 s buffer repeats audibly as a
 * rhythmic 'stutter' when it loops under a steady bed, so these get their own ~8.7 s one (made once) */
let bedNoise: AudioBuffer | null = null;
function bedNoiseSrc(): AudioBufferSourceNode {
  if (!bedNoise) {
    const len = Math.round(ctx!.sampleRate * 8.7);
    bedNoise = ctx!.createBuffer(1, len, ctx!.sampleRate);
    const d = bedNoise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx!.createBufferSource();
  s.buffer = bedNoise;
  s.loop = true;
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

/** The loudest one-shots (shot, stamp, draw sting) used to slam the compressor (-10 dB of gain reduction that
 * pumped the whole mix and squashed them down). At the new, lower levels the compressor mostly idles, so these
 * are tamed at the source instead: they keep about the same balance against the rest as before, peaking lower. */
const HOT_TRIM = 0.55;
let outScale = 1;
function hot(build: () => void) {
  outScale = HOT_TRIM;
  try { build(); } finally { outScale = 1; }
}
/** Route a node into master (and optionally the reverb bus). */
function out(node: AudioNode, wet = 0) {
  let src = node;
  if (outScale !== 1) {
    const s = ctx!.createGain();
    s.gain.value = outScale;
    node.connect(s);
    src = s;
  }
  src.connect(master!);
  if (wet > 0 && fxBus) {
    const w = ctx!.createGain();
    w.gain.value = wet;
    src.connect(w).connect(fxBus);
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
    if (!alive || !live()) return;
    timer = window.setTimeout(pop, 40 + Math.random() * 220);
    if (bgHidden) return;
    const tt = now();
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) noiseHit(tt + i * 0.018 * Math.random(), 'highpass', 3000 + Math.random() * 3000, 0.25 + Math.random() * 0.3, 0.008 + Math.random() * 0.01);
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
  const s = bedNoiseSrc();
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
    if (!alive || !live()) return;
    timer = window.setTimeout(play, 2500 + Math.random() * 4500);
    if (bgHidden || musicAudible()) return; // free-time piano would clash with the music loop; keep wind + glass
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
    if (!alive || !live()) return;
    glassTimer = window.setTimeout(clink, 7000 + Math.random() * 14000);
    if (!bgHidden) glassClink(now() + 0.02);
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
    duckRain();
  },
  getMusicMode(): MusicMode { return wantMusic; },
  setMusicVolume(v: number) { // music slider position 0..1 (gain = v², persisted 'nah.vol2.music')
    musicVolume = Number.isFinite(v) ? clamp01(v) : musicVolume;
    saveLevel(KEY_MUSIC, musicVolume);
    applyLevel();
  },
  getMusicVolume(): number { return musicVolume; },
  /** voice slider position 0..1 (barkeep + emote barks); until it's set it follows the effects slider */
  setVoiceVolume(v: number) {
    voiceVolume = Number.isFinite(v) ? clamp01(v) : voicePos();
    saveLevel(KEY_VOICE, voiceVolume);
    applyLevel();
  },
  getVoiceVolume(): number { return voicePos(); },
  /** for voice clips that aren't routed through Web Audio: the HTMLAudioElement.volume to use (0 when muted).
   * Includes the compressor's makeup gain the routed path gets, so both paths sound the same. */
  voiceElementVolume(): number { return muted ? 0 : clamp01(voiceLevel() * RAIN_MAKEUP); },
  /** route a voice clip through the voice bus (voice volume + mute + output chain). Only once per element; after
   * that the element is silent outside Web Audio. Returns a per-clip gain setter, or null before unlock(). */
  routeVoice(el: HTMLMediaElement): ((gain: number) => void) | null {
    if (!live() || !voiceGain) return null;
    try {
      const src = ctx!.createMediaElementSource(el);
      const g = ctx!.createGain();
      src.connect(g).connect(voiceGain);
      return (v: number) => { g.gain.value = Math.max(0, v); };
    } catch { return null; }
  },
  /** called whenever a level or mute changes (slider moves); returns an unsubscribe */
  onLevels(f: () => void): () => void { levelListeners.add(f); return () => { levelListeners.delete(f); }; },
  isUnlocked(): boolean { return live(); },
  unlock() {               // call on first user click/keydown; resumes AudioContext (idempotent)
    if (!init()) return;
    preloadFiles();
    primeMedia();
    if (wantAmbience) startAmbience();
    if (wantFuse) startFuse();
    startMusic();
  },
  setMuted(m: boolean) {
    muted = m;
    try { localStorage.setItem('nah.muted', m ? '1' : '0'); } catch {}
    applyLevel();
  },
  setVolume(v: number) {   // effects slider position 0..1 (gain = v², persisted 'nah.vol2.fx')
    volume = Number.isFinite(v) ? clamp01(v) : volume;
    saveLevel(KEY_FX, volume);
    applyLevel();
  },
  getVolume(): number { return volume; },
  isMuted(): boolean { return muted; },
  /** true while the page is hidden / frozen (all audio paused) */
  isBackground(): boolean { return bgHidden; },
  /** called with true when the page goes to the background, false when it's back; returns an unsubscribe */
  onBackground(f: (hidden: boolean) => void): () => void { bgListeners.add(f); return () => { bgListeners.delete(f); }; },
  ambience(on: boolean) {  // low wind + distant saloon piano loop
    wantAmbience = on;
    if (!ready()) return;
    if (on) startAmbience();
    else { ambNodes?.stop(); ambNodes = null; }
  },
  shot() {                 // gunshot (veto hit): crack + body + sub thump, echoing in the room
    if (!ready()) return;
    hot(() => {
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
    });
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
    hot(() => {
      const t = now();
      tone(t, 'sine', 140, 48, 1.3, 0.26, 0.35, 0.002);
      tone(t, 'triangle', 260, 120, 0.4, 0.07, 0.2, 0.001);
      noiseHit(t, 'bandpass', 520, 0.9, 0.09, 0.4, 1.4);   // wood knock
      noiseHit(t, 'lowpass', 1800, 0.5, 0.025, 0.2);         // contact snap
      noiseHit(t + 0.012, 'bandpass', 230, 0.45, 0.16, 0.3, 2); // hollow box
    });
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
    hot(() => {
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
    });
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
  spit() {                 // comic "ptoo" ... ping! into the spittoon (after a 0.3s cheek-puff wind-up; lands at ~0.85s like the scene)
    if (!ready()) return;
    const t = now() + 0.3;
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
    const tp = t + 0.55;                                      // spittoon ping
    tone(tp, 'sine', 1750, 1740, 0.09, 0.4, 0.5, 0.001);
    tone(tp, 'sine', 2730, 2720, 0.04, 0.25, 0.5, 0.001);
    noiseHit(tp, 'bandpass', 2000, 0.12, 0.02, 0.2, 2);
  },
  win() {                  // victory: the recorded sting if there is one, else a soft two-note bell "ding-ding" (<1 s)
    if (!ready()) return;
    if (playSting()) return;
    synthWin();
  },
  tick() {                 // countdown tick (last 5s)
    if (!ready()) return;
    const t = now();
    noiseHit(t, 'bandpass', 3200, 0.35, 0.015, 0.1, 4);
    tone(t, 'sine', 1900, 1500, 0.08, 0.03);
  },
  // ---- saloon scene (storm, doors, emotes) ----
  thunder(intensity = 0.6) { // distant-to-close thunder: crackle (close only) + long low rumble; intensity 0..1
    if (!ready()) return;
    const k = Math.max(0.1, Math.min(1, intensity));
    if (recordedThunder(k)) return;
    const t = now() + 0.02;
    if (k > 0.6) { noiseHit(t, 'highpass', 1800, 0.25 * k, 0.12, 0.6); noiseHit(t + 0.05, 'bandpass', 900, 0.3 * k, 0.25, 0.8, 0.8); }
    const dur = 1.8 + k * 2.2;
    const s = noise(true);
    const lp = filt('lowpass', 160 + k * 260, 0.9);
    lp.frequency.setValueAtTime(160 + k * 320, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * k + 0.08, t + 0.08 + (1 - k) * 0.3);
    // a couple of rolling swells
    g.gain.exponentialRampToValueAtTime(0.18 * k + 0.03, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.32 * k + 0.04, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(g);
    out(g, 0.6);
    s.start(t, Math.random());
    s.stop(t + dur + 0.1);
    tone(t + 0.04, 'sine', 52, 34, 0.35 * k, dur * 0.6, 0.4, 0.05);
  },
  rain(on: boolean) {      // quiet rain on the roof + windows (loop); call after unlock()
    wantRain = on;
    if (!ready()) return;
    if (on) startRain(); else stopRain();
  },
  doors() {                // batwing doors flung open: wind gust + double wooden creak + flap-flap
    if (!ready()) return;
    const t = now() + 0.01;
    const s = noise();
    const bp = filt('bandpass', 500, 0.8);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(400, t + 1.1);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    s.connect(bp).connect(g);
    out(g, 0.3);
    s.start(t, Math.random(), 1.3);
    for (const [d, f] of [[0.05, 380], [0.12, 290]] as const) {
      const o = ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t + d);
      o.frequency.linearRampToValueAtTime(f * 1.35, t + d + 0.22);
      const lp = filt('bandpass', f * 3, 3);
      const cg = ctx!.createGain();
      env(cg, t + d, 0.05, 0.03, 0.22);
      o.connect(lp).connect(cg);
      out(cg, 0.4);
      o.start(t + d); o.stop(t + d + 0.3);
    }
    for (let i = 0; i < 4; i++) noiseHit(t + 0.42 + i * 0.19 * (1 + i * 0.25), 'bandpass', 700, 0.3 / (1 + i), 0.05, 0.4, 1.5);
  },
  yeehaw() {               // short whooping "yee-HAW" synth: rising yelp then a falling holler
    if (!ready()) return;
    const t = now() + 0.01;
    const voice = (t0: number, f0: number, f1: number, f2: number, dur: number, peak: number) => {
      const o = ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.35);
      o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      const vib = ctx!.createOscillator(); vib.frequency.value = 7;
      const vg = ctx!.createGain(); vg.gain.value = f1 * 0.03;
      vib.connect(vg).connect(o.frequency);
      const f1n = filt('bandpass', 800, 4), f2n = filt('bandpass', 1300, 5);
      const g = ctx!.createGain();
      env(g, t0, peak, 0.03, dur);
      o.connect(f1n).connect(g); o.connect(f2n).connect(g);
      out(g, 0.4);
      o.start(t0); o.stop(t0 + dur + 0.1); vib.start(t0); vib.stop(t0 + dur + 0.1);
    };
    voice(t, 380, 620, 560, 0.18, 0.35);
    voice(t + 0.22, 520, 760, 300, 0.55, 0.45);
  },
  clap() {                 // a slow clap: wind-up, then three hand claps at 0.25 / 0.67 / 1.09s (the scene's palms meet on these)
    if (!ready()) return;
    const t = now() + 0.25;
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.42;
      noiseHit(tt, 'bandpass', 1300, 0.55, 0.05, 0.5, 1.2);
      noiseHit(tt + 0.008, 'bandpass', 2400, 0.3, 0.03, 0.4, 2);
    }
  },
  blip() {                 // tiny speech-bubble typewriter blip
    if (!ready()) return;
    const t = now();
    const f = rnd(560, 720);
    tone(t, 'square', f, f * 0.94, 0.025, 0.035, 0, 0.002);
  },
  heartbeat() {            // lub-dub (slow-mo)
    if (!ready()) return;
    const t = now() + 0.01;
    tone(t, 'sine', 70, 42, 0.8, 0.16, 0.2, 0.004);
    tone(t + 0.2, 'sine', 62, 38, 0.55, 0.18, 0.2, 0.004);
  },
  glass() {                // whiskey glass set down / clinked
    if (!ready()) return;
    glassClink(now() + 0.01);
    noiseHit(now() + 0.01, 'lowpass', 900, 0.12, 0.03);
  },
  steam() {                // angry kettle: two short hisses
    if (!ready()) return;
    const t = now() + 0.01;
    noiseHit(t, 'highpass', 4000, 0.18, 0.25, 0.1);
    noiseHit(t + 0.38, 'highpass', 4600, 0.15, 0.3, 0.1);
    tone(t, 'sine', 1900, 2300, 0.02, 0.3);
  },
};

/* ---- recorded ambience (public/sfx/*, listed in sfxManifest) with the synth as the fallback ---- */

const fileName = (n: string) => n.replace(/^\/?sfx\//, '');
const hasFile = (n: string) => SFX_FILES.has(n) || SFX_FILES.has('/sfx/' + n) || SFX_FILES.has('sfx/' + n);
const THUNDERS = [1, 2, 3, 4, 5].map((i) => `thunder_${i}.mp3`);
const loading = new Map<string, Promise<AudioBuffer | null>>();
const decoded = new Map<string, { buf: AudioBuffer; peak: number }>();

/** fetch + decode once (cached); resolves null when unlisted or on any failure */
function loadFile(n: string): Promise<AudioBuffer | null> {
  n = fileName(n);
  if (!ctx || !hasFile(n)) return Promise.resolve(null);
  let p = loading.get(n);
  if (!p) {
    const c = ctx;
    p = fetch(`/sfx/${n}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      // callback form: older Safari has no promise-returning decodeAudioData
      .then((ab) => new Promise<AudioBuffer>((res, rej) => { const q = c.decodeAudioData(ab, res, rej); if (q && typeof q.catch === 'function') q.catch(rej); }))
      .then((buf) => {
        let peak = 0;
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i += 7) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
        decoded.set(n, { buf, peak });
        return buf;
      })
      .catch(() => null);
    loading.set(n, p);
  }
  return p;
}
/** after unlock(): decode whatever recordings exist, off the gesture's critical path */
function preloadFiles() {
  if (loading.size) return;
  window.setTimeout(() => { for (const n of ['rain.mp3', ...THUNDERS, 'thunder_big.mp3', 'thunder_far.mp3']) if (hasFile(n)) loadFile(n); }, 50);
}

let lastThunder = '';
let rolling: { g: GainNode; s: AudioBufferSourceNode } | null = null;
/** plays a recorded strike if one is decoded; false = use the synth (and keep decoding for next time).
 * >= 0.8: thunder_big (else the loudest regular); < 0.35: thunder_far; otherwise a random regular roll
 * (thunder_far mixed in now and then), never the same file twice in a row. */
function recordedThunder(k: number): boolean {
  const regs = THUNDERS.filter(hasFile);
  const far = hasFile('thunder_far.mp3') ? 'thunder_far.mp3' : '';
  if (!regs.length && !far && !hasFile('thunder_big.mp3')) return false;
  const ready = (ns: string[]) => ns.filter((n) => decoded.has(n));
  let pick: string | undefined;
  if (k >= 0.8) {
    if (decoded.has('thunder_big.mp3')) pick = 'thunder_big.mp3';
    else if (!hasFile('thunder_big.mp3')) {
      let best = -1;
      for (const n of ready(regs)) { const e = decoded.get(n)!; if (e.peak > best) { best = e.peak; pick = n; } }
    }
  } else {
    const pool = ready(k < 0.35 && far ? [far] : [...regs, ...(far && Math.random() < 0.3 ? [far] : [])]);
    const fresh = pool.filter((n) => n !== lastThunder);
    const from = fresh.length ? fresh : pool;
    pick = from[Math.floor(Math.random() * from.length)];
  }
  const e = pick ? decoded.get(pick) : undefined;
  if (!e || !pick) { preloadFiles(); return false; }
  lastThunder = pick;
  const t = now();
  // the long rolls overlap: let the previous one die away instead of piling up
  if (rolling) {
    const o = rolling;
    o.g.gain.cancelScheduledValues(t);
    o.g.gain.setValueAtTime(Math.max(0.0001, o.g.gain.value), t);
    o.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    try { o.s.stop(t + 0.65); } catch { /* already stopped */ }
  }
  const s = ctx!.createBufferSource();
  s.buffer = e.buf;
  // files are peak-normalized (-0.4 dBFS): scale by intensity, a touch duller when distant
  const lp = filt('lowpass', 2500 + k * k * 12000, 0.5);
  const g = ctx!.createGain();
  g.gain.value = (0.3 + 0.55 * k) * (k >= 0.8 ? 0.7 : 0.85); // the big one peaks lower now
  s.connect(lp).connect(g);
  out(g, 0.2);
  s.start(t);
  const me = { g, s };
  rolling = me;
  s.onended = () => { if (rolling === me) rolling = null; };
  return true;
}

/* ---- rain: one bed, heard from inside the saloon ----
 * source(s) -> own fade -> rain bus: lowpass (12 dB/oct, ~1.15 kHz) + a little low-mid warmth -> duck -> own
 * volume/mute -> output (not through the compressor, so loud one-shots don't pump it).
 * rain(true) is idempotent: an existing bed is kept (a fading-out one is ramped back up), never restarted. */
interface RainNodes { kind: 'file' | 'synth'; stopping: boolean; stop: () => void; revive: () => void }
let rainNodes: RainNodes | null = null;
let wantRain = false;
let rainGen = 0;
let rainBus: { input: GainNode; duck: GainNode; out: GainNode } | null = null;
const RAIN_FILE_GAIN = 0.36;  // the file is normalized to ~-1 dBFS; after the muffling this sits a bit under the old bed
const RAIN_SYNTH_GAIN = 0.03;
const RAIN_MAKEUP = 1.7; // the main compressor's automatic makeup gain (+4.6 dB at this level) that the bypass misses
const RAIN_FADE = 1.5;
/** rain sits lower under the veto music */
const rainDuck = () => (wantMusic === 'veto' ? 0.6 : 1);

function rainChain() {
  if (rainBus) return rainBus;
  const input = ctx!.createGain();
  const lp = filt('lowpass', 1150, 0.6);       // gentle (no resonant bump): through walls and the roof
  const warm = ctx!.createBiquadFilter();       // a touch of low-mid body (the roof boards)
  warm.type = 'peaking'; warm.frequency.value = 280; warm.Q.value = 0.8; warm.gain.value = 2.5;
  const duck = ctx!.createGain();
  duck.gain.value = rainDuck();
  // effects volume + mute, but after the compressor: shots / thunder would otherwise pump the steady bed
  // (a shot pulled the whole mix down ~12 dB for half a second, which is heard as the rain stuttering)
  const o = ctx!.createGain();
  o.gain.value = muted || bgHidden ? 0 : fxLevel() * RAIN_MAKEUP;
  input.connect(lp).connect(warm).connect(duck).connect(o).connect(ctx!.destination);
  rainBus = { input, duck, out: o };
  return rainBus;
}
/** glide to the current duck level (veto music) over ~2 s: no step, and a new call just re-aims the glide */
function duckRain() {
  if (!rainBus || !ctx) return;
  const g = rainBus.duck.gain, t = now();
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.setTargetAtTime(rainDuck(), t, 0.6);
}
/** a bed's own fade in / out; stop() fades and only then frees the nodes, so rain(true) inside the fade revives it */
function rainFader(kind: RainNodes['kind'], fade: GainNode, level: number, free: () => void): RainNodes {
  const t = now();
  fade.gain.setValueAtTime(0, t);
  fade.gain.setTargetAtTime(level, t, RAIN_FADE / 3);
  let timer = 0;
  const node: RainNodes = {
    kind,
    stopping: false,
    stop() {
      if (node.stopping) return;
      node.stopping = true;
      const tt = now();
      fade.gain.cancelScheduledValues(tt);
      fade.gain.setValueAtTime(fade.gain.value, tt);
      fade.gain.setTargetAtTime(0, tt, RAIN_FADE / 4);
      timer = window.setTimeout(() => { free(); if (rainNodes === node) rainNodes = null; }, RAIN_FADE * 1000 + 600);
    },
    revive() {
      if (!node.stopping) return;
      node.stopping = false;
      clearTimeout(timer);
      const tt = now();
      fade.gain.cancelScheduledValues(tt);
      fade.gain.setValueAtTime(fade.gain.value, tt);
      fade.gain.setTargetAtTime(level, tt, RAIN_FADE / 3);
    },
  };
  return node;
}

function stopRain() {
  rainGen++;
  rainNodes?.stop(); // stays in rainNodes until the fade is done (revivable)
}
function startRain() {
  if (!ready()) return;
  rainNodes?.revive();
  const rec = decoded.get('rain.mp3');
  if (rainNodes && (rainNodes.kind === 'file' || !rec)) return; // already raining: only the gain moved
  if (rec) {
    // the recording replaces the synth stand-in (crossfade)
    const old = rainNodes;
    rainNodes = recordedRain(rec.buf);
    old?.stop();
    return;
  }
  rainNodes = synthRain();
  if (hasFile('rain.mp3')) {
    // not decoded yet: the synth plays meanwhile; swap once it lands (if rain is still wanted)
    const gen = rainGen;
    loadFile('rain.mp3').then((buf) => { if (buf && gen === rainGen && wantRain) startRain(); });
  }
}

/** rain.mp3 is a 30 s loop with 0.25 s of matching padding at both ends. Decoders disagree about MP3
 * encoder delay / padding, so the length of the decoded buffer can't be trusted for the loop end: find the
 * exact period by matching the material at loopStart against the tail, then crossfade the last 0.2 s of the
 * loop into the padding that precedes loopStart (in place, once), so the wrap is sample-continuous even
 * where the lossy codec made the two copies differ. */
const RAIN_PAD = 0.25, RAIN_PERIOD = 30;
const rainLoops = new WeakMap<AudioBuffer, { start: number; end: number }>();
function rainLoop(buf: AudioBuffer): { start: number; end: number } {
  let lp = rainLoops.get(buf);
  if (lp) return lp;
  const sr = buf.sampleRate, n = buf.length, pad = Math.round(RAIN_PAD * sr);
  if (n < pad * 2 + sr) { lp = { start: 0, end: buf.duration }; rainLoops.set(buf, lp); return lp; }
  const x = buf.getChannelData(0);
  const W = 2048, span = Math.round(0.06 * sr);
  const expect = Math.min(n - 2 * pad, Math.round(RAIN_PERIOD * sr));
  let P = expect, bestE = Infinity;
  for (let p = expect - span; p <= expect + span; p++) {
    if (pad + p + W > n) break;
    let e = 0;
    for (let k = 0; k < W && e < bestE; k++) { const d = x[pad + k] - x[pad + p + k]; e += d * d; }
    if (e < bestE) { bestE = e; P = p; }
  }
  const F = Math.min(Math.round(0.2 * sr), pad, P >> 2);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < F; i++) {
      const j = pad + P - F + i, w = (i + 0.5) / F; // linear: the two copies are strongly correlated
      d[j] = d[j] * (1 - w) + d[j - P] * w;
    }
  }
  lp = { start: pad / sr, end: (pad + P) / sr };
  rainLoops.set(buf, lp);
  return lp;
}

/** gapless loop of the recording */
function recordedRain(buf: AudioBuffer): RainNodes {
  const t = now();
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const lp = rainLoop(buf);
  s.loopStart = lp.start;
  s.loopEnd = lp.end;
  const fade = ctx!.createGain();
  s.connect(fade).connect(rainChain().input);
  s.start(t, lp.start);
  return rainFader('file', fade, RAIN_FILE_GAIN, () => { try { s.stop(); } catch { /* already stopped */ } fade.disconnect(); });
}

/** stand-in until the recording is decoded (or when there is none): filtered noise + soft drips on the roof */
function synthRain(): RainNodes {
  const t = now();
  const s = bedNoiseSrc();
  const hp = filt('highpass', 120);
  const lp = filt('lowpass', 1600, 0.5);
  const g = ctx!.createGain();
  g.gain.value = RAIN_SYNTH_GAIN;
  const lfo = ctx!.createOscillator(); lfo.frequency.value = 0.09;
  const lg = ctx!.createGain(); lg.gain.value = RAIN_SYNTH_GAIN * 0.3;
  lfo.connect(lg).connect(g.gain);
  const fade = ctx!.createGain();
  s.connect(hp).connect(lp).connect(g).connect(fade).connect(rainChain().input);
  s.start(t, Math.random() * 8); lfo.start(t);
  let alive = true;
  const drip = () => {
    if (!alive || !live()) return;
    timer = window.setTimeout(drip, 60 + Math.random() * 260);
    if (bgHidden) return;
    const tt = now() + 0.01;
    const n = noise();
    const f = filt('bandpass', 700 + Math.random() * 900, 2.5);
    const dg = ctx!.createGain();
    env(dg, tt, 0.02 + Math.random() * 0.03, 0.002, 0.03);
    n.connect(f).connect(dg).connect(fade);
    n.start(tt, Math.random(), 0.08);
  };
  let timer = window.setTimeout(drip, 300);
  return rainFader('synth', fade, 1, () => {
    alive = false; clearTimeout(timer);
    try { s.stop(); lfo.stop(); } catch { /* already stopped */ }
    fade.disconnect();
  });
}

/* ---- win: soft two-note bell "ding-ding" (G5 -> C6), short decays and a small reverb send, < 1 s ---- */
function synthWin() {
  const t = now() + 0.02;
  const ding = (at: number, midi: number, peak: number) => {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    for (const [mul, a, d] of [[1, 1, 0.72], [2, 0.3, 0.38], [3.01, 0.1, 0.2], [4.17, 0.04, 0.1]] as const) {
      tone(at, 'sine', f * mul, f * mul, peak * a, d, 0.12, 0.004);
    }
  };
  ding(t, 79, 0.085);
  ding(t + 0.17, 84, 0.075);
}

/* ---- recorded music + win sting (/media/*, listed in mediaManifest), streamed, never decoded whole ----
 * Each listed file gets one <audio> element -> MediaElementAudioSourceNode -> own gain -> music bus.
 *  'lobby' (lobby / nominate / result, quieter in result): music_lobby.mp3, a seamless loop.
 *  'showdown' (veto / slide / duel / roulette): music_showdown_intro.mp3 once (from the top every time the mode
 *    is entered), handed off ~0.12 s before its end (polled, with a 150 ms crossfade) to music_showdown.mp3, a
 *    seamless loop. Lobby <-> showdown crossfade over 1.5 s.
 * The lobby file is fetched at unlock(); the showdown files when first needed or ~5 s after unlock.
 * The sting plays on the effects bus and dips the music under it.
 * Hidden page: elements pause (and resume where they were). A load / decode error ('error' event) falls back to
 * the procedural music for that mode (and to the synth ding for the sting); a play() refused by the autoplay
 * policy falls back too, until the next tap / key, which retries the recording. */
type Track = 'lobby' | 'showdown';
const F_LOBBY = 'music_lobby.mp3', F_INTRO = 'music_showdown_intro.mp3', F_LOOP = 'music_showdown.mp3';
const STING_FILE = 'sting_win.mp3';
const MUSIC_FILES = [F_LOBBY, F_INTRO, F_LOOP];
const MEDIA_FADE = 1.5;
const HANDOFF_LEAD = 0.12, HANDOFF_FADE = 0.15;
const RESULT_MEDIA_LEVEL = 0.6;
const hasMedia = (n: string) => MEDIA_FILES.has(n) || MEDIA_FILES.has('/media/' + n) || MEDIA_FILES.has('media/' + n);
const trackFor = (m: MusicMode): Track | null =>
  m === 'off' ? null : m === 'lobby' || m === 'result' ? 'lobby' : 'showdown';
interface MediaEl { el: HTMLAudioElement; g: GainNode; failed: boolean; blocked: boolean; stopTimer: number; target: number }
const mediaEls = new Map<string, MediaEl>();
let mediaBus: GainNode | null = null;
let mediaCur: Track | null = null;
let sdStage: 'intro' | 'loop' = 'intro';
let sdPoll = 0;

function mediaEl(file: string, dest: AudioNode, loop: boolean): MediaEl | null {
  let m = mediaEls.get(file);
  if (m) return m;
  if (!live() || !hasMedia(file)) return null;
  try {
    const el = new Audio();
    el.preload = 'auto';
    el.loop = loop;
    el.src = `/media/${file}`;
    const src = ctx!.createMediaElementSource(el);
    const g = ctx!.createGain();
    g.gain.value = 0;
    src.connect(g).connect(dest);
    const me: MediaEl = { el, g, failed: false, blocked: false, stopTimer: 0, target: 0 };
    el.addEventListener('error', () => { me.failed = true; if (dest !== master) startMusic(); });
    if (file === F_INTRO) el.addEventListener('ended', () => { if (mediaCur === 'showdown' && sdStage === 'intro') handoff(); });
    mediaEls.set(file, me);
    return me;
  } catch { return null; }
}
/** the element for a music file (created, and so fetched, on first call) */
function musicEl(file: string): MediaEl | null {
  if (!live() || !hasMedia(file)) return null;
  if (!mediaBus) {
    mediaBus = ctx!.createGain();
    mediaBus.gain.value = MEDIA_TRIM;
    mediaBus.connect(musicGain!);
  }
  return mediaEl(file, mediaBus, file !== F_INTRO);
}
const ok = (file: string) => { const m = musicEl(file); return !!m && !m.failed && !m.blocked; };
/** the recording(s) for this track are listed and playable */
function mediaUsable(tr: Track): boolean {
  if (tr === 'lobby') return ok(F_LOBBY);
  if (mediaCur === 'showdown' && sdStage === 'loop') return ok(F_LOOP);
  return ok(F_INTRO) || ok(F_LOOP);
}
/** the element(s) that should be audible for a track right now */
function activeFiles(tr: Track | null): string[] {
  if (tr === 'lobby') return [F_LOBBY];
  if (tr === 'showdown') return [sdStage === 'intro' ? F_INTRO : F_LOOP];
  return [];
}
function mediaPlaying(): boolean {
  return activeFiles(mediaCur).some((f) => { const m = mediaEls.get(f); return !!m && !m.failed && !m.el.paused; });
}
function fadeTo(m: MediaEl, v: number, secs = MEDIA_FADE) {
  const t = now(), g = m.g.gain;
  m.target = v;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(v, t + secs);
}
function stopAfter(m: MediaEl, ms: number) {
  clearTimeout(m.stopTimer);
  m.stopTimer = window.setTimeout(() => {
    m.stopTimer = 0;
    if (m.target === 0) { m.el.pause(); try { m.el.currentTime = 0; } catch { /* not seekable yet */ } }
  }, ms);
}
function playEl(m: MediaEl, onFail: () => void) {
  const p = m.el.play();
  if (p && typeof p.catch === 'function') p.catch((e: unknown) => {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') return; // a pause() racing the play() isn't a failure
    if (name === 'NotAllowedError') m.blocked = true; // autoplay policy: retried on the next gesture
    else m.failed = true;
    onFail();
  });
}
/** crossfade to `tr` (null = no recorded music) at `level` */
function setMediaTrack(tr: Track | null, level: number) {
  if (!live()) return;
  const prev = mediaCur;
  mediaCur = tr;
  if (tr === 'showdown') {
    if (prev !== 'showdown') {
      // (re)entering: the build-up from the top, the loop parked at its start
      sdStage = ok(F_INTRO) ? 'intro' : 'loop';
      for (const f of [F_INTRO, F_LOOP]) {
        const m = mediaEls.get(f);
        if (m && !m.failed) {
          clearTimeout(m.stopTimer); m.stopTimer = 0;
          m.el.pause(); m.target = 0;
          m.g.gain.cancelScheduledValues(now()); m.g.gain.setValueAtTime(0, now());
          try { m.el.currentTime = 0; } catch { /* not loaded yet */ }
        }
      }
    } else if (sdStage === 'intro' && !ok(F_INTRO)) sdStage = 'loop'; // the intro broke: straight to the loop
  }
  const want = activeFiles(tr);
  for (const f of MUSIC_FILES) {
    const m = want.includes(f) ? musicEl(f) : mediaEls.get(f);
    if (!m) continue;
    if (want.includes(f) && !m.failed && !m.blocked) {
      clearTimeout(m.stopTimer); m.stopTimer = 0;
      if (m.target !== level) fadeTo(m, level);
      if (m.el.paused && !bgHidden) playEl(m, () => { if (mediaCur === tr) startMusic(); });
    } else if (m.target > 0 || (!m.el.paused && !m.stopTimer)) {
      fadeTo(m, 0);
      stopAfter(m, MEDIA_FADE * 1000 + 150);
    }
  }
  if (tr === 'showdown' && sdStage === 'intro' && !sdPoll) sdPoll = window.setInterval(pollIntro, 40);
}
/** while the intro plays: start the loop just before the intro's end ('ended' fires too late for gapless) */
function pollIntro() {
  if (mediaCur !== 'showdown' || sdStage !== 'intro') { clearInterval(sdPoll); sdPoll = 0; return; }
  const m = mediaEls.get(F_INTRO);
  if (!m || m.el.paused || bgHidden) return;
  const d = m.el.duration;
  if (Number.isFinite(d) && d > 0 && m.el.currentTime >= d - HANDOFF_LEAD) handoff();
}
function handoff() {
  clearInterval(sdPoll); sdPoll = 0;
  sdStage = 'loop';
  const intro = mediaEls.get(F_INTRO);
  const level = wantMusic === 'result' ? RESULT_MEDIA_LEVEL : 1;
  if (!ok(F_LOOP)) { if (intro) { fadeTo(intro, 0, HANDOFF_FADE); stopAfter(intro, 300); } startMusic(); return; }
  const loop = musicEl(F_LOOP)!;
  clearTimeout(loop.stopTimer); loop.stopTimer = 0;
  try { loop.el.currentTime = 0; } catch { /* not loaded yet */ }
  loop.g.gain.cancelScheduledValues(now()); loop.g.gain.setValueAtTime(0, now());
  fadeTo(loop, level, HANDOFF_FADE);
  if (!bgHidden) playEl(loop, () => { if (mediaCur === 'showdown') startMusic(); });
  if (intro) { fadeTo(intro, 0, HANDOFF_FADE); stopAfter(intro, HANDOFF_FADE * 1000 + 150); }
}
/** page hidden: pause every element where it is (startMusic() resumes the current one on return) */
function pauseMedia() {
  for (const m of mediaEls.values()) if (!m.el.paused) m.el.pause();
}
/** a tap / key after the autoplay policy refused a recording: try it again inside the gesture */
function retryBlockedMedia() {
  let any = false;
  for (const m of mediaEls.values()) if (m.blocked) { m.blocked = false; any = true; }
  if (any && ready()) startMusic();
}
/** in the unlock gesture: the lobby track starts (startMusic), the sting is primed (muted play + pause, so iOS
 * lets it play later); the showdown files are fetched ~5 s later unless needed sooner */
let primed = false;
function primeMedia() {
  if (!live() || primed) return;
  primed = true;
  const sting = stingEl();
  if (sting && sting.el.paused && !stingBusy) {
    const p = sting.el.play();
    if (p && typeof p.then === 'function') p.then(() => { if (!stingBusy) sting.el.pause(); }).catch(() => {});
  }
  window.setTimeout(() => { for (const f of [F_INTRO, F_LOOP]) musicEl(f); }, 5000);
}
let stingBusy = false;
let stingTimer = 0;
function stingEl(): MediaEl | null {
  return live() && hasMedia(STING_FILE) ? mediaEl(STING_FILE, master!, false) : null;
}
/** plays the recorded win sting; false = not listed / failed (use the synth) */
function playSting(): boolean {
  const m = stingEl();
  if (!m || m.failed) return false;
  try { m.el.currentTime = 0; } catch { /* not loaded yet */ }
  const t = now();
  m.g.gain.cancelScheduledValues(t);
  m.g.gain.setValueAtTime(STING_TRIM, t);
  m.target = STING_TRIM;
  stingBusy = true;
  duckMusic(true);
  const done = () => { stingBusy = false; clearTimeout(stingTimer); duckMusic(false); };
  m.el.onended = done;
  clearTimeout(stingTimer);
  stingTimer = window.setTimeout(done, 8000); // backstop if 'ended' never fires
  playEl(m, () => { done(); if (ready()) synthWin(); });
  return true;
}
function duckMusic(on: boolean) {
  if (!musicDuck || !ctx) return;
  const g = musicDuck.gain, t = now();
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.setTargetAtTime(on ? 0.35 : 1, t, on ? 0.08 : 0.6);
}

/** Phase -> music mode. Home (undefined) and lobby/nominate -> 'lobby'. */
export function musicForPhase(phase: string | undefined): MusicMode {
  switch (phase) {
    case 'veto': case 'slide': case 'duel': return 'veto'; // tense groove (rain ducks under it like in veto)
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
