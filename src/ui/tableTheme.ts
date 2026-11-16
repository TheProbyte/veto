/**
 * Table theme (host-picked felt + card backs) as CSS variables on <html>, so every phase and the dock
 * can paint with them: --felt-base / --felt-light / --felt-dark and --deck-a (back colour) / --deck-b (pattern ink).
 * Defaults live in styles.css :root, so a reload mid-round still has a deck before the first state lands.
 */
import { useEffect } from 'react';
import { DECKS, FELTS, type Settings } from '../../shared/types';

export const feltOf = (i: number | undefined) => FELTS[i ?? 0] ?? FELTS[0];
export const deckOf = (i: number | undefined) => DECKS[i ?? 0] ?? DECKS[0];

export function applyTableTheme(s: Pick<Settings, 'felt' | 'deck'> | undefined) {
  if (typeof document === 'undefined') return;
  const f = feltOf(s?.felt), d = deckOf(s?.deck);
  const st = document.documentElement.style;
  const set = (k: string, v: string) => { if (st.getPropertyValue(k) !== v) st.setProperty(k, v); };
  set('--felt-base', f.base); set('--felt-light', f.light); set('--felt-dark', f.dark);
  set('--deck-a', d.a); set('--deck-b', d.b);
}

export function useTableTheme(s: Pick<Settings, 'felt' | 'deck'> | undefined) {
  const felt = s?.felt ?? 0, deck = s?.deck ?? 0;
  useEffect(() => { applyTableTheme({ felt, deck }); }, [felt, deck]);
}
