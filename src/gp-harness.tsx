// TEMPORARY gameplay test harness (deleted after verification)
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './styles.css';
import Saloon from './scene/Saloon';
import Veto from './phases/Veto';
import Roulette from './phases/Roulette';
import Result from './phases/Result';
import Duel from './phases/Duel';
import EmoteBar from './scene/EmoteBar';
import Lobby from './phases/Lobby';
import type { Intent, RoomEvent, RoomState } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

const W = window as unknown as { __st: RoomState; __set: (f: (s: RoomState) => RoomState) => void; __sent: Intent[]; __emit: (e: RoomEvent) => void };
const G = [[620, 'Portal 2'], [570, 'Dota 2'], [730, 'Counter-Strike 2'], [413150, 'Stardew Valley'], [1086940, "Baldur's Gate 3"], [892970, 'Valheim']] as const;
const mk = (): RoomState => ({
  code: 'TEST', phase: 'veto', now: Date.now(),
  players: [
    { id: 'a', name: 'Ada', seat: 0, look: 0, shieldUsed: false, connected: true, host: true, style: { hat: 1, hatColor: 2, skin: 3, face: 2, hair: 1, bandana: 1, coat: 2 } },
    { id: 'b', name: 'Bo', seat: 1, look: 1, shieldUsed: false, connected: true, host: false },
    { id: 'c', name: 'Cyrus the Long', seat: 2, look: 2, shieldUsed: false, connected: true, host: false },
    { id: 'd', name: 'Dee', seat: 3, look: 3, shieldUsed: false, connected: true, host: false },
  ],
  pool: [], poolLoading: false, pitches: [], settings: { ...DEFAULT_SETTINGS },
  record: { rounds: 0, wins: [], vetoers: [], noms: [], streaks: [] },
  board: G.map(([appid, name], i) => ({ appid, name, tier: 'all', by: [['a', 'b', 'c', 'd'][i % 4]], alive: true })),
  turnOrder: ['a', 'b', 'c', 'd'], turnIdx: 0, turnDeadline: Date.now() + 30000, aim: 620, shots: [], history: [],
});
W.__st = mk();
W.__sent = [];
let rerender: () => void = () => {};
W.__set = (f) => { W.__st = { ...f(W.__st), now: Date.now() }; rerender(); };
const listeners = new Set<(e: RoomEvent) => void>();
W.__emit = (e) => listeners.forEach((l) => l(e));

function App() {
  const [, force] = useState(0);
  useEffect(() => { rerender = () => force((x) => x + 1); }, []);
  const state = W.__st;
  const p = { state, me: new URLSearchParams(location.search).get('me') || 'a', send: (i: Intent) => { W.__sent.push(i); console.log('SEND', JSON.stringify(i)); }, skew: 0, on: (fn: (e: RoomEvent) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const Phase = { lobby: Lobby, nominate: Lobby, veto: Veto, roulette: Roulette, duel: Duel, result: Result }[state.phase];
  return <><Saloon {...p}><Phase {...p} /></Saloon><EmoteBar {...p} /></>;
}
createRoot(document.getElementById('root')!).render(<App />);
