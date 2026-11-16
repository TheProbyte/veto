// Plays recorded voice files from /voice/<id>.mp3 on the Voice volume (sfx.getVoiceVolume: follows the Effects
// slider until the Voice slider is moved). After unlock() clips are routed through Web Audio (the voice bus, so
// the level and mute work everywhere, iOS included, where HTMLMediaElement.volume is read-only); before that
// they fall back to element.volume.
// Two channels: the narrator (one line at a time) and emote barks (one at a time, can overlap the narrator).
// While the page is hidden / frozen (see sfx.onBackground) playing clips pause and pick up where they were
// once it's back; new lines triggered in the background are skipped.
import { sfx } from './sfx';
import { VOICE_IDS } from './voiceManifest';

interface Clip { el: HTMLAudioElement; setGain: ((g: number) => void) | null; gain: number }
const channels: Record<'narr' | 'emote', Clip | null> = { narr: null, emote: null };
const cache = new Map<string, Clip>();
/** clips that were playing when the page went to the background */
const held = new Set<Clip>();

export const hasVoice = (id: string) => VOICE_IDS.has(id);

const applyGain = (c: Clip) => {
  if (c.setGain) { c.setGain(c.gain); c.el.volume = 1; }
  else c.el.volume = Math.max(0, Math.min(1, sfx.voiceElementVolume() * c.gain));
};

sfx.onBackground((hidden) => {
  if (hidden) {
    for (const c of Object.values(channels)) {
      if (c && !c.el.paused && !c.el.ended) { held.add(c); c.el.pause(); }
    }
  } else {
    for (const c of held) {
      if (Object.values(channels).includes(c) && !sfx.isMuted()) c.el.play().catch(() => {});
    }
    held.clear();
  }
});
// slider moved / mute toggled: unrouted clips that are playing follow (routed ones follow the bus by themselves)
sfx.onLevels(() => {
  for (const c of Object.values(channels)) if (c && !c.setGain) applyGain(c);
});

/** returns true if a recording exists and playback was started */
/** recorded alternate takes: "emote_laugh" may also have "emote_laugh_2", "emote_laugh_3"… */
const lastTake = new Map<string, string>();
function pickTake(id: string): string {
  const takes = [id];
  for (let n = 2; VOICE_IDS.has(`${id}_${n}`); n++) takes.push(`${id}_${n}`);
  if (takes.length === 1) return id;
  const fresh = takes.filter((t) => t !== lastTake.get(id));
  const t = fresh[Math.floor(Math.random() * fresh.length)];
  lastTake.set(id, t);
  return t;
}

/** narrator lines queue behind the one still talking (instead of cutting it off); stale ones are dropped */
const narrQueue: { id: string; gain: number; at: number }[] = [];
const MAX_WAIT = 9000;
function narrBusy() {
  const c = channels.narr;
  return !!c && !c.el.paused && !c.el.ended && c.el.currentTime < (c.el.duration || Infinity) - 0.05;
}
function drainNarr() {
  const next = narrQueue.shift();
  if (!next) return;
  if (Date.now() - next.at > MAX_WAIT) return drainNarr();
  start(next.id, 'narr', next.gain);
}

export function playVoice(id: string, channel: 'narr' | 'emote' = 'narr', gain = 1): boolean {
  if (!VOICE_IDS.has(id)) return false;
  id = pickTake(id);
  if (sfx.isMuted()) return true; // recorded, just muted: callers shouldn't fall back to a synth
  if (sfx.isBackground()) return true; // page hidden: say nothing (and no synth fallback either)
  if (channel === 'narr' && narrBusy()) {
    narrQueue.push({ id, gain, at: Date.now() });
    if (narrQueue.length > 2) narrQueue.shift(); // keep only the freshest two waiting
    return true;
  }
  return start(id, channel, gain);
}

function start(id: string, channel: 'narr' | 'emote', gain: number): boolean {
  try {
    const prev = channels[channel];
    if (prev) { prev.el.pause(); held.delete(prev); }
    let c = cache.get(id);
    // an element made before unlock plays outside Web Audio; once audio is unlocked, make a routed one
    if (c && !c.setGain && sfx.isUnlocked()) { c.el.pause(); c = undefined; }
    if (!c) {
      const el = new Audio(`/voice/${id}.mp3`);
      el.preload = 'auto';
      el.addEventListener('ended', () => { if (channels.narr?.el === el) drainNarr(); });
      c = { el, setGain: sfx.routeVoice(el), gain };
      cache.set(id, c);
    }
    c.gain = gain;
    c.el.currentTime = 0;
    applyGain(c);
    channels[channel] = c;
    c.el.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
