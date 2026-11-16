import { useEffect, useState } from 'react';
import { useRoom } from './net';
import Home from './phases/Home';
import NameGate from './phases/NameGate';
import Saloon from './scene/Saloon';
import ContextMenu from './scene/ContextMenu';
import Lobby from './phases/Lobby';
import Nominate from './phases/Nominate';
import Veto from './phases/Veto';
import Roulette from './phases/Roulette';
import Result from './phases/Result';
import Duel from './phases/Duel';
import Slide from './phases/Slide';
import Vote from './phases/Vote';
import Mini from './phases/Mini';
import type { RoomProps } from './props';

function getName(): string | null {
  try { return localStorage.getItem('nah.name'); } catch { return null; }
}

export default function App() {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{3,12})/);
  if (!m) return <><Home /><ContextMenu /></>;
  return <Room code={m[1].toUpperCase()} />;
}

function Room({ code }: { code: string }) {
  const [name, setName] = useState<string | null>(getName());
  const { state, me, send, connected, error, skew, on } = useRoom(code, name);
  useWakeLock(state?.phase === 'veto' || state?.phase === 'roulette' || state?.phase === 'duel' || state?.phase === 'slide' || state?.phase === 'vote' || state?.phase === 'mini');
  if (!name) {
    return <><ContextMenu /><NameGate code={code} onJoin={(n) => { try { localStorage.setItem('nah.name', n); } catch {} setName(n); }} /></>;
  }
  if (!state) return <div className="loading">Pushing open the saloon doors…</div>;
  const p: RoomProps = { state, me, send, skew, on };
  const Phase = { lobby: Lobby, nominate: Nominate, veto: Veto, roulette: Roulette, duel: Duel, slide: Slide, vote: Vote, mini: Mini, result: Result }[state.phase];
  return (
    <>
      <Saloon {...p}><Phase {...p} /></Saloon>
      {!connected && <div className="toast warn">Reconnecting…</div>}
      {error && <div className="toast err">{error}</div>}
    </>
  );
}

/** keep phone screens awake during the shootout + spin */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let dead = false;
    const grab = () => {
      if (document.hidden || dead) return;
      nav.wakeLock!.request('screen').then((l) => { if (dead) l.release(); else lock = l; }).catch(() => {});
    };
    grab();
    document.addEventListener('visibilitychange', grab);
    return () => { dead = true; document.removeEventListener('visibilitychange', grab); lock?.release().catch(() => {}); };
  }, [on]);
}
