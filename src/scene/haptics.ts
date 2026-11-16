import { sfx } from '../sfx';

export const BUZZ = {
  hit: [30, 40, 80],
  ricochet: [15, 30, 15],
  crack: [40],
  myTurn: [20, 60, 20],
  win: [50, 80, 50, 80, 120],
} as const;

/** Best-effort haptics; silent when muted, unsupported, or blocked before a user gesture. */
export function buzz(pattern: readonly number[]) {
  try {
    if (sfx.isMuted()) return;
    navigator.vibrate?.(pattern as number[]);
  } catch { /* ignore */ }
}

const mq = (q: string) => { try { return !!window.matchMedia?.(q).matches; } catch { return false; } };
/** Phone-sized viewport (portrait or landscape). */
export const isPhone = () => mq('(max-width: 640px), (max-height: 500px) and (orientation: landscape)');
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');
