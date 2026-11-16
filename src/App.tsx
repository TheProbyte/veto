import { useEffect, useState } from 'react';
import { useRoom } from './net';
import Home from './phases/Home';
import NameGate from './phases/NameGate';
import Saloon from './scene/Saloon';
import ContextMenu from './scene/ContextMenu';
import LoadingScreen from './ui/LoadingScreen';
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
import { usePath } from './nav';
import './enter.css';
import { sfx } from './sfx';
import { prefetchVoices } from './voice';
import { replayRecentNarration } from './scene/Narrator';

function getName(): string | null {
  try { return localStorage.getItem('nah.name'); } catch { return null; }
}

export default function App() {
  const path = usePath();
  const m = path.match(/^\/r\/([A-Za-z0-9]{3,12})/);
  if (!m) return <><Home /><ContextMenu /></>;
  return <Room code={m[1].toUpperCase()} />;
}

function Room({ code }: { code: string }) {
  const [name, setName] = useState<string | null>(getName());
  // browsers only allow sound after a click on the page: arriving from the home menu that click already happened;
  // arriving straight from a link, a "tap to enter" card collects it (and replays the Barkeep's opening line)
  const [entered, setEntered] = useState(() => sfx.isUnlocked());
  useEffect(() => { if (entered) prefetchVoices(); }, [entered]);
  const enter = () => { sfx.unlock(); setEntered(true); setTimeout(() => replayRecentNarration(), 150); };
  const { state, me, send, connected, error, skew, on } = useRoom(code, name);
  useWakeLock(state?.phase === 'veto' || state?.phase === 'roulette' || state?.phase === 'duel' || state?.phase === 'slide' || state?.phase === 'vote' || state?.phase === 'mini');
  if (!name) {
    return <><ContextMenu /><NameGate code={code} onJoin={(n) => { try { localStorage.setItem('nah.name', n); } catch {} sfx.unlock(); setEntered(true); setName(n); }} /></>;
  }
  if (!state) return <LoadingScreen label="Pushing open the saloon doors…" />;
  const p: RoomProps = { state, me, send, skew, on };
  const Phase = { lobby: Lobby, nominate: Nominate, veto: Veto, roulette: Roulette, duel: Duel, slide: Slide, vote: Vote, mini: Mini, result: Result }[state.phase];
  return (
    <>
      <Saloon {...p}><Phase {...p} /></Saloon>
      {!entered && (
        <button type="button" className="enter-gate" onClick={enter} autoFocus>
          <span className="enter-gate-box">
            <span className="enter-gate-title">Table {code}</span>
            <span className="enter-gate-btn">Push open the doors</span>
            <span className="enter-gate-sub">tap anywhere to enter · sound on</span>
          </span>
        </button>
      )}
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
