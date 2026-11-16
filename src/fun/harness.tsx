// TEMP harness (delete after verification)
import { createRoot } from 'react-dom/client';
import type { Intent, Player, RoomState } from '../../shared/types';
import TargetPractice from './TargetPractice';
import GroupPhoto from './GroupPhoto';
import '../styles.css';

const q = new URLSearchParams(location.search);
const n = Number(q.get('n') ?? 6);
const names = ['Dusty', 'Calamity Jane Longname', 'Doc', 'Rattlesnake Pete', 'Ma', 'Kid', 'Sundance', 'Bart'];
const players: Player[] = Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: names[i], seat: i, look: i, connected: true, host: i === 0, shieldUsed: false, bot: i === 5,
  style: i % 3 === 2 ? undefined : { hat: (i * 2) % 9, hatColor: i % 7, skin: i % 5, face: i % 7, hair: i % 5, bandana: i % 8, coat: (i * 3) % 8 },
}));
const state = {
  code: 'GHST', phase: q.get('phase') ?? 'lobby', players, now: Date.now(),
  record: { rounds: 3, wins: [], vetoers: [], noms: [], streaks: [], bottles: q.get('empty') ? [] : [
    { pid: 'p3', name: 'Rattlesnake Pete', score: 41 }, { pid: 'p0', name: 'Dusty', score: 33 }, { pid: 'p1', name: 'Calamity Jane Longname', score: 20 },
  ] },
  result: { appid: 1, name: q.get('title') ?? 'Deep Rock Galactic', repeatCount: 0, badges: {} },
  history: [],
} as unknown as RoomState;
(window as unknown as { sent: Intent[] }).sent = [];
const props = { state, me: 'p0', skew: 0, on: () => () => {}, send: (i: Intent) => { (window as unknown as { sent: Intent[] }).sent.push(i); } };
createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 360 }}>
    <div className="px-box" style={{ padding: 12 }}><TargetPractice {...props} /></div>
    <div style={{ display: 'flex', gap: 12 }}><GroupPhoto {...props} /></div>
  </div>,
);
