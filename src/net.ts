import { useEffect, useRef, useState, useCallback } from 'react';
import type { Intent, RoomEvent, RoomState, ServerMsg } from '../shared/types';

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
  const listeners = useRef(new Set<(e: RoomEvent) => void>());
  const pid = playerId();

  useEffect(() => {
    if (!name) return;
    let alive = true;
    let retry = 0;
    let timer: number | undefined;
    // keep-alive: the server answers 'ping' with 'pong' without waking the room (free on hibernation)
    const ping = window.setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN && !document.hidden) ws.current.send('ping');
    }, 25_000);
    // phones kill sockets in the background: reconnect right away when the tab comes back
    const revive = () => {
      if (document.hidden || !alive) return;
      const st = ws.current?.readyState;
      if (st === WebSocket.CLOSED || st === WebSocket.CLOSING || st === undefined) {
        clearTimeout(timer);
        retry = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', revive);
    window.addEventListener('online', revive);
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
        if (ev.data === 'pong') return;
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === 'state') {
          setSkew(msg.state.now - Date.now());
          setState(msg.state);
        } else if (msg.t === 'emote' || msg.t === 'say' || msg.t === 'narrate' || msg.t === 'mini') {
          for (const fn of listeners.current) { try { fn(msg); } catch {} }
        } else if (msg.t === 'error') {
          setError(msg.message);
          setTimeout(() => setError(null), 3500);
        }
      };
      sock.onclose = () => {
        if (ws.current !== sock) return; // superseded by a newer socket
        setConnected(false);
        if (!alive) return;
        timer = window.setTimeout(connect, Math.min(5000, 400 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(ping);
      document.removeEventListener('visibilitychange', revive);
      window.removeEventListener('online', revive);
      ws.current?.close();
    };
  }, [code, name, pid]);

  const send = useCallback((i: Intent) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(i));
  }, []);

  const on = useCallback((fn: (e: RoomEvent) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  return { state, me: pid, send, connected, error, skew, on };
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
