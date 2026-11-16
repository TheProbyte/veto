import { PixelArt } from '../pixel/PixelCanvas';

/** Steam box art, pixelated (box art -> header art -> pixel placeholder with the name). */
export default function GameArt({ appid, name, className = '', holes = 0, cracked = false }: { appid: number; name: string; className?: string; holes?: number; cracked?: boolean }) {
  return <PixelArt appid={appid} name={name} className={className} holes={holes} cracked={cracked} />;
}
