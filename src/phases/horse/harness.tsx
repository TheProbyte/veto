// TEMPORARY dev harness (delete after screenshots)
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '../../styles.css';
import Horse from './Horse';
import type { Intent, Mini, RoomEvent, RoomState, Player } from '../../../shared/types';
import { saddleX, simulate } from './sim';

const q = new URLSearchParams(location.search);
const now0 = Date.now();
const seed = 4242;
const pre = Number(q.get('pre') ?? 0);
const mk = (id: string, name: string, style?: Player['style'], bot = false): Player => ({ id, name, seat: 0, look: 2, style, shieldUsed: false, connected: true, host: false, bot });
const players: Player[] = [
  mk('me', 'Dusty', { hat: 0, hatColor: 0, skin: 1, face: 2, hair: 1, bandana: 1, coat: 0 }),
  mk('p2', 'Calamity', { hat: 3, hatColor: 2, skin: 3, face: 0, hair: 0, bandana: 4, coat: 6 }),
  mk('p3', 'Doc', { hat: 2, hatColor: 1, skin: 0, face: 3, hair: 4, bandana: 0, coat: 1 }),
  mk('p4', 'Nostyle'),
  mk('bot1', 'Bot Bill', { hat: 6, hatColor: 6, skin: 2, face: 4, hair: 2, bandana: 7, coat: 7 }, true),
];
const n = Number(q.get('n') ?? 5);
const ps = players.slice(0, n);
const games = [570, 730, 440];
/** best [0,r,p,p+d] for a saddle */
function best(pid: string) {
  const s = saddleX(seed, pid); let b = { sc: -1, inp: [0] as number[] };
  for (let r = 1; r <= 700; r += 10) { const j = simulate([0, r], s); if (j.score > b.sc) b = { sc: j.score, inp: [0, r] };
    for (let p = r + 10; p <= 900; p += 20) for (let d = 300; d <= 700; d += 10) { const k = simulate([0, r, p, p + d], s); if (k.score > b.sc) b = { sc: k.score, inp: [0, r, p, p + d] }; } }
  return b;
}
const bestMe = best('me');
(window as any).__best = bestMe;
const reps: Record<string, number[]> = { p2: best('p2').inp, p3: [0, 200], p4: [0, 380, 600, 760] };

function App() {
  const listeners = useRef(new Set<(e: RoomEvent) => void>());
  const [mini, setMini] = useState<Mini>({ kind: 'horse', games, backs: { me: 570, p2: 730, p3: 440, p4: 570, bot1: 730 }, players: ps.map((p) => p.id), startedAt: now0 + pre, deadline: now0 + pre + 30000, seed, results: q.get('botdone') ? { bot1: { score: 640, label: 'Solid landing', at: now0 } } : {} });
  const send = (i: Intent) => {
    (window as any).__sent = [...((window as any).__sent ?? []), i];
    if (i.t === 'horseDone') setMini((m) => {
      const res = { ...m.results, me: { score: i.score * 10, label: '', at: Date.now(), data: i.inputs } };
      return { ...m, results: res };
    });
  };
  useEffect(() => {
    if (!q.get('others')) return;
    const ids = ['p2', 'p3', 'p4'].filter((x) => ps.some((p) => p.id === x));
    const ts = ids.map((pid, k) => window.setTimeout(() => {
      const data = reps[pid];
      listeners.current.forEach((f) => f({ t: 'mini', pid, data, at: Date.now() }));
      window.setTimeout(() => setMini((m) => {
        const j = simulate(data, saddleX(seed, pid));
        return { ...m, results: { ...m.results, [pid]: { score: j.score * 10, label: j.label, at: Date.now(), data } } };
      }), 1600);
    }, pre + 400 + k * 500));
    if (q.get('winner')) ts.push(window.setTimeout(() => setMini((m) => ({ ...m, winner: 730, winnerPid: 'p2', results: { ...m.results, bot1: m.results.bot1 ?? { score: 640, label: 'Solid landing', at: Date.now() } } })), pre + 4500));
    return () => ts.forEach(clearTimeout);
  }, []);
  const state = { code: 'TEST', phase: 'mini', players: ps, pool: [], poolLoading: false, pitches: [], settings: {} as any, mini,
    record: {} as any, board: [{ appid: 570, name: 'Dota 2', tier: 'all', by: [], alive: true }, { appid: 730, name: 'Counter-Strike 2', tier: 'all', by: [], alive: true }, { appid: 440, name: 'Team Fortress 2', tier: 'all', by: [], alive: true }],
    turnOrder: [], turnIdx: 0, turnDeadline: 0, shots: [] } as unknown as RoomState;
  return <Horse state={state} me="me" send={send} skew={0} on={(fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); }} />;
}
createRoot(document.getElementById('root')!).render(<App />);
