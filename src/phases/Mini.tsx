// Phase 'mini': routes to the skill finale everyone plays at once (state.mini.kind).
import type { RoomProps } from '../props';
import Slide from './Slide';
import Golf from './golf/Golf';
import Horse from './horse/Horse';

export default function Mini(p: RoomProps) {
  const k = p.state.mini?.kind;
  if (k === 'golf') return <Golf {...p} />;
  if (k === 'horse') return <Horse {...p} />;
  return <Slide {...p} />;
}
