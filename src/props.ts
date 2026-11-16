import type { Intent, RoomEvent, RoomState } from '../shared/types';
export type EventListener = (e: RoomEvent) => void;
export interface RoomProps {
  state: RoomState;
  me: string; // my player id
  send: (i: Intent) => void;
  skew: number; // serverNow - clientNow; use useNow(skew) for synced countdowns
  /** subscribe to transient room events (emote / say / narrate). Returns an unsubscribe fn. */
  on: (fn: EventListener) => () => void;
}
