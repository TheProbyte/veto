// TEMP harness (delete)
import { createRoot } from 'react-dom/client';
import './styles.css';
import Saloon from './scene/Saloon';
import Vote from './phases/Vote';
import { DEFAULT_SETTINGS, randomLook, type Player, type RoomState } from '../shared/types';
const NG = +(new URLSearchParams(location.search).get('g') || 3);
const held = new URLSearchParams(location.search).get('held') === '1';
const names = ['Dusty', 'Clem', 'Hank', 'Mabel', 'Jo', 'Wyatt', 'Belle', 'Ike'];
const players: Player[] = names.map((n, i) => ({ id: 'p' + i, name: n, seat: i, look: i, style: randomLook(), shieldUsed: false, connected: true, host: i === 0, bot: i >= 3 }));
const games = [620, 1145360, 413150].slice(0, NG);
const now = Date.now();
const st: RoomState = { code: 'T', phase: 'vote', players, pool: [], poolLoading: false, pitches: [], settings: DEFAULT_SETTINGS, record: { rounds: 0, wins: [], vetoers: [], noms: [], streaks: [] },
  board: games.map((a, i) => ({ appid: a, name: ['Portal 2', 'Hades', 'Stardew Valley'][i], tier: 'all' as const, by: ['p' + i], alive: true })), turnOrder: [], turnIdx: 0, turnDeadline: 0, shots: [], history: [], now,
  explainUntil: held ? now + 60000 : undefined,
  vote: { games, votes: { p1: 'golf', p3: 'slide', p4: 'slide' }, backs: Object.fromEntries(players.map((p, i) => [p.id, games[i % NG]])), deadline: now + 25000 } };
const p = { state: st, me: 'p0', send: () => {}, skew: 0, on: () => () => {} };
createRoot(document.getElementById('root')!).render(<Saloon {...p}><Vote {...p} /></Saloon>);
