// Procedural spaghetti-western background music (Web Audio, no files).
// Created lazily by sfx.ts after unlock(); runs on its own bus (music volume) under the shared mute.
// Lookahead scheduler: a 25ms interval schedules every note up to 100ms ahead on AudioContext time.

export type MusicMode = 'off' | 'lobby' | 'veto' | 'roulette' | 'result';
type Kind = Exclude<MusicMode, 'off'>;

export interface MusicDeps {
  ctx: AudioContext;
  dest: AudioNode;                        // music volume bus
  noise: AudioBuffer;                     // shared 2s white noise
  impulse: AudioBuffer;                   // room impulse (own convolver, so the tail follows music volume)
  pluckBuf: (freq: number) => AudioBuffer; // cached Karplus-Strong pluck
  paused?: boolean;                        // start paused (page hidden); see MusicEngine.setPaused
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Whistled note: sine with a scoop, delayed vibrato and bandpassed breath noise. Cleans up after itself. */
export function whistle(
  ctx: AudioContext, noise: AudioBuffer, t: number, midi: number, dur: number, peak: number,
  dest: AudioNode, send?: AudioNode | null, vibrato = 0.012,
) {
  const d = Math.max(0.07, dur);
  const f = mtof(midi);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f * 0.955, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
  const vib = ctx.createOscillator();
  vib.frequency.value = rnd(5.2, 6);
  const vg = ctx.createGain();
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(f * vibrato, t + d);
  vib.connect(vg).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.035);
  g.gain.linearRampToValueAtTime(peak * 0.78, t + d);
  g.gain.setTargetAtTime(0, t + d, 0.045);
  o.connect(g).connect(dest);
  if (send) g.connect(send);
  // breath
  const br = ctx.createBufferSource();
  br.buffer = noise;
  br.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 5;
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0, t);
  bg.gain.linearRampToValueAtTime(peak * 0.22, t + 0.02);
  bg.gain.linearRampToValueAtTime(peak * 0.08, t + d);
  bg.gain.setTargetAtTime(0, t + d, 0.03);
  br.connect(bp).connect(bg).connect(dest);
  const end = t + d + 0.3;
  o.start(t); vib.start(t); br.start(t, Math.random() * 1.5);
  o.stop(end); vib.stop(end); br.stop(end);
  o.onended = () => { g.disconnect(); vg.disconnect(); bg.disconnect(); };
}

// ---------- harmony ----------
// Am – G – F – E, two bars each (8 bars). Voicings: [low string, 5th, octave, 3rd, top].
const CHORDS: number[][] = [
  [45, 52, 57, 60, 64], // Am
  [43, 50, 55, 59, 62], // G
  [41, 48, 53, 57, 60], // F
  [40, 47, 52, 56, 59], // E
];
const VETO_CHORDS: number[][] = [
  [45, 52, 57, 60, 64], // Am
  [43, 50, 55, 59, 62], // G
  [41, 48, 53, 57, 60], // F
  [40, 47, 52, 56, 65], // E(b9): F on top for tension
];
const BASS = [33, 31, 29, 28]; // A1 G1 F1 E1
const PAT_A = [-1, 2, 3, 4, 1, 3, 4, 3]; // fingerpicking (8ths); bass synth covers the thumb on 1
const PAT_B = [-1, 2, 4, 3, 1, 3, 2, 4];
const PAT_VETO = [1, 3, 4, 3, 2, 3, 4, 3];

// whistle line (8th index in the 8-bar cycle -> [midi, length in 8ths])
const MELODY = new Map<number, [number, number]>([
  [0, [76, 2]], [2, [81, 2]], [4, [84, 4]],
  [8, [83, 2]], [10, [81, 2]], [12, [76, 4]],
  [16, [74, 2]], [18, [79, 2]], [20, [83, 4]],
  [24, [81, 2]], [26, [79, 2]], [28, [74, 4]],
  [32, [72, 2]], [34, [77, 2]], [36, [81, 4]],
  [40, [79, 2]], [42, [77, 2]], [44, [76, 4]],
  [48, [76, 3]], [51, [80, 1]], [52, [83, 4]],
  [56, [80, 2]], [58, [76, 5]],
]);

interface Section {
  kind: Kind;
  out: GainNode;     // dry fader
  wet: GainNode;     // reverb-send fader (faded with out, so tails don't linger at full level)
  next: number;      // audio time of the next step
  step: number;
  stepDur: number;
  stopAt: number;    // no new steps at/after this time (Infinity while current)
  melody?: boolean;  // lobby groove: whistle the tune every other cycle (off in the result phase)
  play(t: number, step: number): void;
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
}

export interface MusicEngine {
  setMode(m: MusicMode): void;
  mode(): MusicMode;
  playing(): boolean;
  /** page hidden / frozen: stop scheduling and fade the bus out (the owner also suspends the AudioContext) */
  setPaused(p: boolean): void;
}

export function createMusic(d: MusicDeps): MusicEngine {
  const { ctx } = d;
  let paused = !!d.paused;
  const bus = ctx.createGain(); // ducks while the page is hidden
  bus.gain.value = paused ? 0 : 1;
  bus.connect(d.dest);
  const verbIn = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = d.impulse;
  const vhp = ctx.createBiquadFilter(); vhp.type = 'highpass'; vhp.frequency.value = 180;
  const vlp = ctx.createBiquadFilter(); vlp.type = 'lowpass'; vlp.frequency.value = 3400;
  const vwet = ctx.createGain(); vwet.gain.value = 0.5;
  verbIn.connect(conv).connect(vhp).connect(vlp).connect(vwet).connect(bus);

  let requested: MusicMode = 'off';
  let cur: Section | null = null;
  let fading: Section[] = [];
  let timer = 0;
  let broken = false;

  const gain = (v: number, to: AudioNode, nodes: AudioNode[]) => {
    const g = ctx.createGain(); g.gain.value = v; g.connect(to); nodes.push(g); return g;
  };
  const biquad = (type: BiquadFilterType, f: number, q: number, to: AudioNode, nodes: AudioNode[]) => {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(to); nodes.push(b); return b;
  };

  function pluck(t: number, midi: number, vel: number, to: AudioNode, ring = 1.4) {
    const src = ctx.createBufferSource();
    src.buffer = d.pluckBuf(mtof(midi));
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    src.connect(g).connect(to);
    src.start(t);
    src.stop(t + ring + 0.05);
    src.onended = () => g.disconnect();
  }
  function bassNote(t: number, midi: number, vel: number, dur: number, to: AudioNode) {
    const f = mtof(midi);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; // carries on small speakers
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vel * 0.4, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o2.connect(g2).connect(g); g.connect(to);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
    o.onended = () => { g.disconnect(); g2.disconnect(); };
  }
  function noiseHit(t: number, peak: number, dur: number, to: AudioNode) {
    const s = ctx.createBufferSource(); s.buffer = d.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(g).connect(to);
    s.start(t, Math.random() * 1.5, dur + 0.02);
    s.onended = () => g.disconnect();
  }
  function kick(t: number, peak: number, to: AudioNode) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(to);
    o.start(t); o.stop(t + 0.3);
    o.onended = () => g.disconnect();
  }
  function strum(t: number, notes: number[], vel: number, to: AudioNode, down = true, spread = 0.022) {
    const ns = down ? notes : [...notes].reverse();
    ns.forEach((m, i) => pluck(t + i * spread, m, vel * rnd(0.85, 1.08), to, 1.8));
  }
  // ---------- sections ----------
  /** result phase: the lobby groove, quieter and without the whistle (no cadence; the win ding is enough) */
  const RESULT_LEVEL = 0.6;
  const levelFor = (m: Kind) => (m === 'result' ? RESULT_LEVEL : 1);
  function groove(kind: 'lobby' | 'veto', t0: number): Section {
    const veto = kind === 'veto';
    const bpm = veto ? 92 : 76;
    const stepDur = 60 / bpm / 4; // 16ths
    const nodes: AudioNode[] = [];
    const srcs: AudioScheduledSourceNode[] = [];
    const out = gain(0, bus, nodes);
    const wet = gain(0, verbIn, nodes);
    const send = gain(veto ? 0.25 : 0.35, wet, nodes);
    const trem = gain(1, out, nodes);
    trem.connect(send);
    const gLp = biquad('lowpass', veto ? 2600 : 3300, 0.7, trem, nodes);
    const gtr = biquad('peaking', 220, 1.2, gLp, nodes);
    gtr.gain.value = 4; // wooden body
    if (veto) {
      trem.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = bpm / 15; // 16th-note tremolo
      const depth = ctx.createGain(); depth.gain.value = 0.4;
      lfo.connect(depth).connect(trem.gain); nodes.push(depth);
      lfo.start(t0); srcs.push(lfo);
    }
    const bassLp = biquad('lowpass', 520, 0.8, out, nodes);
    const hat = veto ? biquad('highpass', 7000, 0.7, out, nodes) : null;
    const wsend = gain(0.55, wet, nodes);
    const chords = veto ? VETO_CHORDS : CHORDS;
    const sec: Section = {
      kind, out, wet, next: t0, step: 0, stepDur, stopAt: Infinity, nodes, srcs, melody: true,
      play(t, step) {
        const s = step % 16;
        const bar = Math.floor(step / 16) % 8;
        const cycle = Math.floor(step / 128);
        const ci = bar >> 1;
        const chord = chords[ci];
        const hum = rnd(-0.006, 0.006);
        if (s % 2 === 0) {
          const e = s >> 1;
          const idx = (veto ? PAT_VETO : bar % 2 ? PAT_B : PAT_A)[e];
          if (idx >= 0) pluck(t + hum, chord[idx], (veto ? 0.2 : 0.17) * rnd(0.8, 1.1) * (e === 4 ? 1.15 : 1), gtr, veto ? 0.9 : 1.4);
        }
        // lobby: little strum flourish into the turnaround
        if (!veto && bar === 7 && s === 12) strum(t, chord.slice(1), 0.12, gtr, false, 0.03);
        // bass on beats 1 and 3
        if (s === 0) bassNote(t, BASS[ci], veto ? 0.42 : 0.36, stepDur * 7, bassLp);
        if (s === 8) bassNote(t, chord[1] - 12, veto ? 0.3 : 0.26, stepDur * 7, bassLp);
        if (veto) {
          if (s === 0) kick(t, 0.55, out);           // heartbeat: 1 ...
          if (s === 6) kick(t, 0.36, out);           // ... and 2&
          if (s % 2 === 0) noiseHit(t, s % 4 === 2 ? 0.07 : 0.04, 0.03, hat!);
          else if (s === 15) noiseHit(t, 0.025, 0.02, hat!);
        } else if (sec.melody && cycle % 2 === 1 && s % 2 === 0) {
          const n = MELODY.get(bar * 8 + (s >> 1));
          if (n) whistle(ctx, d.noise, t, n[0], n[1] * stepDur * 2 * 0.92, 0.075, out, wsend);
        }
      },
    };
    return sec;
  }

  function roulette(t0: number): Section {
    const nodes: AudioNode[] = [];
    const srcs: AudioScheduledSourceNode[] = [];
    const out = gain(0, bus, nodes);
    const wet = gain(0, verbIn, nodes);
    const send = gain(0.4, wet, nodes);
    const snare = biquad('bandpass', 2300, 0.7, out, nodes);
    snare.connect(send);
    // low drone: A1 + E2 saws and an A2 triangle through a slowly breathing lowpass
    const dg = gain(0, out, nodes);
    dg.gain.setValueAtTime(0, t0);
    dg.gain.linearRampToValueAtTime(0.16, t0 + 2.5);
    const dlp = biquad('lowpass', 260, 3, dg, nodes);
    for (const [f, type, det] of [[55, 'sawtooth', -6], [82.4, 'sawtooth', 5], [110, 'triangle', 0]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      o.connect(dlp); o.start(t0); srcs.push(o);
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.18;
    const lg = ctx.createGain(); lg.gain.value = 90; nodes.push(lg);
    lfo.connect(lg).connect(dlp.frequency); lfo.start(t0); srcs.push(lfo);
    const ROLL = 6.5;
    const stepDur = 0.02;
    let phase = 0.99;
    return {
      kind: 'roulette', out, wet, next: t0, step: 0, stepDur, stopAt: Infinity, nodes, srcs,
      play(t) {
        const el = t - t0; // audio time, so a resume does not restart the roll
        if (el < 0 || el >= ROLL) return;
        const x = el / ROLL;
        phase += 5 * Math.pow(30 / 5, x) * stepDur; // 5 -> 30 hits/s
        if (phase >= 1) {
          phase -= 1;
          noiseHit(t + rnd(0, 0.004), 0.03 + 0.3 * x * x, 0.05, snare);
          if (Math.random() < 0.12 + x * 0.2) kick(t, 0.06 + 0.2 * x, out); // timpani-ish rumble under it
        }
      },
    };
  }

  // ---------- engine ----------
  function fadeOut(sec: Section | null, t: number) {
    if (!sec) return;
    for (const g of [sec.out.gain, sec.wet.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 1);
    }
    sec.stopAt = t + 1;
    fading.push(sec);
  }
  function dispose(sec: Section) {
    for (const s of sec.srcs) { try { s.stop(); } catch { /* already stopped */ } }
    for (const n of sec.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
  }
  function start(kind: Kind) {
    const t = ctx.currentTime + 0.05;
    fadeOut(cur, t);
    const sec = kind === 'roulette' ? roulette(t) : groove(kind === 'veto' ? 'veto' : 'lobby', t);
    sec.melody = kind !== 'result';
    const lvl = levelFor(kind);
    for (const g of [sec.out.gain, sec.wet.gain]) {
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(lvl, t + 1);
    }
    cur = sec;
    ensureTimer();
  }
  /** lobby <-> result: same groove, only the level and the whistle change (no restart) */
  function relevel(sec: Section, kind: Kind) {
    const t = ctx.currentTime + 0.02;
    sec.melody = kind !== 'result';
    for (const g of [sec.out.gain, sec.wet.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(levelFor(kind), t + 1.5);
    }
  }

  function tick() {
    if (broken) return;
    try {
      const now = ctx.currentTime;
      const horizon = now + 0.1;
      for (const sec of cur ? [cur, ...fading] : fading) {
        if (sec.next < now - 0.05) { // stalled (timer throttled / resumed): skip ahead, never burst
          const n = Math.ceil((now - sec.next) / sec.stepDur);
          sec.next += n * sec.stepDur;
          sec.step += n;
        }
        while (sec.next < horizon && sec.next < sec.stopAt) {
          sec.play(sec.next, sec.step);
          sec.next += sec.stepDur;
          sec.step++;
        }
      }
      if (fading.length) {
        fading = fading.filter((s) => {
          if (now < s.stopAt + 2.5) return true;
          dispose(s);
          return false;
        });
      }
      if (!cur && !fading.length) stopTimer();
    } catch {
      broken = true; // never take the app down over music
      stopTimer();
      try { bus.disconnect(); } catch { /* ignore */ }
    }
  }
  function ensureTimer() {
    if (timer || broken || paused) return;
    timer = window.setInterval(tick, 25);
    tick();
  }
  function stopTimer() {
    if (timer) window.clearInterval(timer);
    timer = 0;
  }
  // driven by sfx.ts (visibilitychange / pagehide / freeze and back)
  function setPaused(p: boolean) {
    if (p === paused) return;
    paused = p;
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    if (p) {
      stopTimer();
      bus.gain.linearRampToValueAtTime(0, t + 0.15);
    } else {
      bus.gain.linearRampToValueAtTime(1, t + 0.4);
      if (cur || fading.length) ensureTimer();
    }
  }

  return {
    setMode(m) {
      if (broken || m === requested) return;
      requested = m;
      if (m === 'off') {
        fadeOut(cur, ctx.currentTime + 0.02);
        cur = null;
        ensureTimer(); // keep ticking to dispose the faded section
        return;
      }
      // lobby <-> result share the lobby groove: keep it playing, just move the level
      if ((m === 'lobby' || m === 'result') && cur?.kind === 'lobby') { relevel(cur, m); return; }
      start(m);
    },
    mode: () => requested,
    playing: () => !!cur && !broken,
    setPaused,
  };
}
