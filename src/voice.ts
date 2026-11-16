// Plays recorded voice files from /voice/<id>.mp3 under the Effects volume.
// Two channels: the narrator (one line at a time) and emote barks (one at a time, can overlap the narrator).
// While the page is hidden / frozen (see sfx.onBackground) playing clips pause and pick up where they were
// once it's back; new lines triggered in the background are skipped.
import { sfx } from './sfx';
import { VOICE_IDS } from './voiceManifest';

const channels: Record<'narr' | 'emote', HTMLAudioElement | null> = { narr: null, emote: null };
const cache = new Map<string, HTMLAudioElement>();
/** clips that were playing when the page went to the background */
const held = new Set<HTMLAudioElement>();

export const hasVoice = (id: string) => VOICE_IDS.has(id);

sfx.onBackground((hidden) => {
  if (hidden) {
    for (const a of Object.values(channels)) {
      if (a && !a.paused && !a.ended) { held.add(a); a.pause(); }
    }
  } else {
    for (const a of held) {
      if (Object.values(channels).includes(a) && !sfx.isMuted()) a.play().catch(() => {});
    }
    held.clear();
  }
});

/** returns true if a recording exists and playback was started */
export function playVoice(id: string, channel: 'narr' | 'emote' = 'narr', gain = 1): boolean {
  if (!VOICE_IDS.has(id)) return false;
  if (sfx.isMuted()) return true; // recorded, just muted: callers shouldn't fall back to a synth
  if (sfx.isBackground()) return true; // page hidden: say nothing (and no synth fallback either)
  try {
    const prev = channels[channel];
    if (prev) { prev.pause(); held.delete(prev); }
    let a = cache.get(id);
    if (!a) { a = new Audio(`/voice/${id}.mp3`); a.preload = 'auto'; cache.set(id, a); }
    a.currentTime = 0;
    a.volume = Math.max(0, Math.min(1, sfx.getVolume() * gain));
    channels[channel] = a;
    a.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
