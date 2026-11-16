import type { Intent, RoomState } from '../shared/types';
export interface RoomProps {
  state: RoomState;
  me: string; // my player id
  send: (i: Intent) => void;
  skew: number; // serverNow - clientNow; use useNow(skew) for synced countdowns
}
