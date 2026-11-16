import { useEffect, useState } from 'react';
import { boxArt, headerArt } from '../../shared/types';

/** Steam box art with a single fallback to the header image, then a text placeholder. */
export default function GameArt({ appid, name, className = '' }: { appid: number; name: string; className?: string }) {
  const [fb, setFb] = useState(0);
  useEffect(() => setFb(0), [appid]);
  if (fb >= 2) return <div className={`art-missing ${className}`}><span>{name}</span></div>;
  return (
    <img
      className={`art ${fb === 1 ? 'art-wide' : ''} ${className}`}
      src={fb === 0 ? boxArt(appid) : headerArt(appid)}
      alt={name}
      draggable={false}
      onError={() => setFb((f) => f + 1)}
    />
  );
}
