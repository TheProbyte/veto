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
export function playVoice(id: string, channel: 'narr' | 'emote' = 'narr', gain = 1): boolean {
  if (!VOICE_IDS.has(id)) return false;
  if (sfx.isMuted()) return true; // recorded, just muted: callers shouldn't fall back to a synth
  if (sfx.isBackground()) return true; // page hidden: say nothing (and no synth fallback either)
  try {
    const prev = channels[channel];
    if (prev) { prev.el.pause(); held.delete(prev); }
    let c = cache.get(id);
    // an element made before unlock plays outside Web Audio; once audio is unlocked, make a routed one
    if (c && !c.setGain && sfx.isUnlocked()) { c.el.pause(); c = undefined; }
    if (!c) {
      const el = new Audio(`/voice/${id}.mp3`);
      el.preload = 'auto';
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
