// STUB: the pixel-art agent replaces this with a real canvas preview of a bust for a given Look.
import type { Look } from '../../shared/types';
export default function BustPreview(_p: { look: Look; scale?: number; className?: string; tipHat?: boolean }) {
  return <div className={_p.className} style={{ width: 96, height: 112 }} />;
}
