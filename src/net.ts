import { useEffect, useRef, useState, useCallback } from 'react';
import type { Intent, RoomState, ServerMsg } from '../shared/types';

export function playerId(): string {
  let id = '';
  try { id = localStorage.getItem('nah.pid') || ''; } catch {}
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem('nah.pid', id); } catch {}
  }
  return id;
}

export function useRoom(code: string, name: string | null) {
  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0); // serverNow - clientNow
  const ws = useRef<WebSocket | null>(null);
  const pid = playerId();

  useEffect(() => {
    if (!name) return;
    let alive = true;
    let retry = 0;
    let timer: number | undefined;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/api/room/${code}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        setConnected(true);
        sock.send(JSON.stringify({ t: 'hello', pid, name } satisfies Intent));
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === 'state') {
          setSkew(msg.state.now - Date.now());
          setState(msg.state);
        } else if (msg.t === 'error') {
          setError(msg.message);
          setTimeout(() => setError(null), 3500);
        }
      };
      sock.onclose = () => {
        setConnected(false);
        if (!alive) return;
        timer = window.setTimeout(connect, Math.min(5000, 400 * 2 ** retry++));
      };
    };
    connect();
    return () => { alive = false; clearTimeout(timer); ws.current?.close(); };
  }, [code, name, pid]);

  const send = useCallback((i: Intent) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(i));
  }, []);

  return { state, me: pid, send, connected, error, skew };
}

/** Server-synced clock: Date.now() + skew */
export function useNow(skew: number, active = true) {
  const [now, setNow] = useState(Date.now() + skew);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => { setNow(Date.now() + skew); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [skew, active]);
  return now;
}
