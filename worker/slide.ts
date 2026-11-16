// Whiskey Slide rules (pure: no runtime imports, so it can be unit-tested in node).
import type { Slide } from '../shared/types';

export const SLIDE_TURN_MS = 15_000; // time to release the glass
export const SLIDE_ANIM_MS = 2_600;  // glass travel animation
export const SLIDE_INTRO_MS = 2_500; // first slider waits for the intro
export const SLIDE_RESULT_MS = 3_200; // winner shown this long before the result screen
export const SLIDE_TIE = 0.004;

export const slideMark = () => 0.74 + Math.random() * 0.12;
/** server-side physics: power 0..1 plus a small wobble; off the end of the bar (> 1.0) = fell */
export const slideDist = (power: number, wobble = (Math.random() * 2 - 1) * 0.025) => power * 1.18 * (1 + wobble);

/** Decide among the games currently sliding (`ids`). Either a winner, or the games that must re-slide. */
export function slideOutcome(throws: Slide['throws'], ids: number[], mark: number): { winner: number } | { tied: number[] } {
  const cur = throws.filter((t) => ids.includes(t.game) && !t.fell);
  if (!cur.length) return { tied: [...ids] };
  const best = Math.min(...cur.map((t) => Math.abs(t.dist - mark)));
  const close = cur.filter((t) => Math.abs(t.dist - mark) - best <= SLIDE_TIE);
  if (close.length > 1) return { tied: close.map((t) => t.game) };
  return { winner: close[0].game };
}
