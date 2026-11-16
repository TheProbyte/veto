// Plays recorded voice files from /voice/<id>.mp3 under the Effects volume.
// Two channels: the narrator (one line at a time) and emote barks (one at a time, can overlap the narrator).
import { sfx } from './sfx';
import { VOICE_IDS } from './voiceManifest';

const channels: Record<'narr' | 'emote', HTMLAudioElement | null> = { narr: null, emote: null };
const cache = new Map<string, HTMLAudioElement>();

export const hasVoice = (id: string) => VOICE_IDS.has(id);

/** returns true if a recording exists and playback was started */
export function playVoice(id: string, channel: 'narr' | 'emote' = 'narr', gain = 1): boolean {
  if (!VOICE_IDS.has(id)) return false;
  if (sfx.isMuted()) return true; // recorded, just muted: callers shouldn't fall back to a synth
  try {
    channels[channel]?.pause();
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
