import { PixelSprite } from '../pixel/PixelCanvas';
import { drawStar } from '../pixel/sprites';

/** Pixel-art tin star. `size` is the CSS size; it's drawn at ~1/3 resolution. */
export default function TinStar({ size = 24, className = '' }: { size?: number; className?: string }) {
  const res = Math.max(9, Math.min(23, Math.round(size / 2.2) | 1));
  return <PixelSprite draw={drawStar} w={res} h={res} className={`tinstar ${className}`} style={{ width: size, height: size }} />;
}
