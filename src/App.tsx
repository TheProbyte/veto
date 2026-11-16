import { useState } from 'react';
import { useRoom } from './net';
import Home from './phases/Home';
import NameGate from './phases/NameGate';
import Saloon from './scene/Saloon';
import Lobby from './phases/Lobby';
import Nominate from './phases/Nominate';
import Veto from './phases/Veto';
import Roulette from './phases/Roulette';
import Result from './phases/Result';
import type { RoomProps } from './props';

function getName(): string | null {
  try { return localStorage.getItem('nah.name'); } catch { return null; }
}

export default function App() {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{3,12})/);
  if (!m) return <Home />;
  return <Room code={m[1].toUpperCase()} />;
}

function Room({ code }: { code: string }) {
  const [name, setName] = useState<string | null>(getName());
  const { state, me, send, connected, error, skew } = useRoom(code, name);
  if (!name) {
    return <NameGate code={code} onJoin={(n) => { try { localStorage.setItem('nah.name', n); } catch {} setName(n); }} />;
  }
  if (!state) return <div className="loading">Pushing open the saloon doors…</div>;
  const p: RoomProps = { state, me, send, skew };
  const Phase = { lobby: Lobby, nominate: Nominate, veto: Veto, roulette: Roulette, result: Result }[state.phase];
  return (
    <>
      <Saloon {...p}><Phase {...p} /></Saloon>
      {!connected && <div className="toast warn">Reconnecting…</div>}
      {error && <div className="toast err">{error}</div>}
    </>
  );
}
