// Phase 'mini': routes to the skill finale everyone plays at once (state.mini.kind).
// Golf and Horse are code-split: their code only downloads when that finale starts (faster first load on phones).
import { lazy, Suspense } from 'react';
import type { RoomProps } from '../props';
import Slide from './Slide';
import LoadingScreen from '../ui/LoadingScreen';

const Golf = lazy(() => import('./golf/Golf'));
const Horse = lazy(() => import('./horse/Horse'));

export default function Mini(p: RoomProps) {
  const k = p.state.mini?.kind;
  if (k === 'golf') return <Suspense fallback={<LoadingScreen label="Fetching the putters…" />}><Golf {...p} /></Suspense>;
  if (k === 'horse') return <Suspense fallback={<LoadingScreen label="Saddling the horses…" />}><Horse {...p} /></Suspense>;
  return <Slide {...p} />;
}
