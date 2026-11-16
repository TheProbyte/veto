/**
 * UI pixel scale. The scene is a low-res canvas drawn at an integer scale P (2-6); the HTML UI on
 * top uses the same unit so its borders, steps, bevels and shadows are made of scene-sized pixels.
 *
 *   --pu  chrome pixel: exactly the scene's P (borders, stepped corners, bevels, hard shadows)
 *   --pt  text/icon pixel: pixel fonts and icons are drawn at an integer multiple of their grid
 *         (Silkscreen at 8 * --pt). A full scene pixel (5-6 CSS px on desktop) would make labels
 *         40px+ and breaks every layout, so text uses 2 (3 only on very large screens, P >= 7).
 *
 * Set on <html> so every :root-composed variable (--b, --nh-pxb, dither sizes...) resolves with it.
 * (`--px` is the Pixelify font stack, so the scale lives in --pu / --pt.)
 */
import { useEffect, useState } from 'react';
import { computeLayout } from '../pixel/scene';

let override: number | null = null;
let current = 2;
const subs = new Set<(P: number) => void>();

export const textUnit = (P: number) => (P >= 7 ? 3 : 2);

function apply() {
  if (typeof document === 'undefined') return;
  const P = override ?? computeLayout(window.innerWidth, window.innerHeight).P;
  if (P !== current) { current = P; subs.forEach((f) => f(P)); }
  const s = document.documentElement.style;
  const pu = `${P}px`, pt = `${textUnit(P)}px`;
  if (s.getPropertyValue('--pu') !== pu) s.setProperty('--pu', pu);
  if (s.getPropertyValue('--pt') !== pt) s.setProperty('--pt', pt);
}

/** the saloon knows its exact layout (split landscape uses half the width): it wins while mounted */
export function setSceneScale(P: number | null) {
  override = P;
  apply();
}

if (typeof window !== 'undefined') {
  apply();
  window.addEventListener('resize', () => { if (override === null) apply(); });
}

/** the current chrome pixel (for canvas-drawn UI such as the poster's paper panel) */
export function useUiP(): number {
  const [P, setP] = useState(current);
  useEffect(() => { setP(current); subs.add(setP); return () => { subs.delete(setP); }; }, []);
  return P;
}
