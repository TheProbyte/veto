import { useId } from 'react';
export default function TinStar({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const pts: string[] = [];
  const tips: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 46 : 20;
    const x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    if (i % 2 === 0) tips.push([x, y]);
  }
  return (
    <svg className={`tinstar ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-label="tin star">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fdf6e3" />
          <stop offset=".45" stopColor="#a9a39a" />
          <stop offset=".6" stopColor="#e9e2d2" />
          <stop offset="1" stopColor="#6d665c" />
        </linearGradient>
      </defs>
      <polygon points={pts.join(' ')} fill={`url(#${id})`} stroke="#3b342c" strokeWidth="3" />
      {tips.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6" fill={`url(#${id})`} stroke="#3b342c" strokeWidth="2.5" />)}
      <circle cx="50" cy="50" r="11" fill="none" stroke="#3b342c" strokeWidth="3" />
    </svg>
  );
}
