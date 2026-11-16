import { createRoot } from 'react-dom/client';
import './styles.css';
import Saloon from './scene/Saloon';
import Veto from './phases/Veto';
import Roulette from './phases/Roulette';
import Result from './phases/Result';
import type { RoomState } from '../shared/types';
const ph = (new URLSearchParams(location.search).get('p') || 'veto') as RoomState['phase'];
const ids = [730, 570, 440, 1172470, 252490, 892970, 413150, 105600];
const now = Date.now();
const players = Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: ['Doc', 'Wyatt', 'Calamity', 'Jesse', 'Belle', 'Billy', 'Annie'][i], seat: i, look: i, shieldUsed: i % 3 === 0, connected: i !== 5, host: i === 0 }));
const state: RoomState = {
  code: 'ABC', phase: ph, players, pool: [], poolLoading: false,
  board: ids.map((a, i) => ({ appid: a, name: ['Counter-Strike 2', 'Dota 2', 'Team Fortress 2', 'Apex Legends', 'Rust', 'Valheim', 'Stardew Valley', 'Terraria'][i], tier: 'all', by: ['p1'], alive: i > 2, shieldedBy: i === 4 ? 'p1' : undefined, killedBy: i <= 2 ? 'p2' : undefined })),
  turnOrder: players.map((p) => p.id), turnIdx: 2, turnDeadline: now + 8000, aim: 892970,
  shots: [{ id: 1, t: now - 20000, actor: 'p2', appid: 730, kind: 'hit' }, { id: 2, t: now - 15000, actor: 'p2', appid: 570, kind: 'hit' }],
  roulette: { chambers: [892970, 413150, 105600, 892970, 413150, 105600], target: 2, startedAt: now - 1000, duration: 6000 },
  result: { appid: 413150, name: 'Stardew Valley', repeatCount: 2 },
  history: [{ appid: 413150, name: 'Stardew Valley', t: now - 86400000 }], now,
};
const P = { veto: Veto, roulette: Roulette, result: Result, lobby: Veto, nominate: Veto }[ph];
const p = { state, me: 'p2', send: () => {}, skew: 0 };
const root = createRoot(document.getElementById('root')!);
root.render(<Saloon {...p}><P {...p} /></Saloon>);
const fx = new URLSearchParams(location.search).get('fx') as 'hit' | 'ricochet' | null;
if (fx) setTimeout(() => { const s2 = { ...state, lastShot: { id: 9, t: Date.now(), actor: 'p2', appid: 105600, kind: fx } }; root.render(<Saloon {...p} state={s2}><P {...p} state={s2} /></Saloon>); }, 300);
