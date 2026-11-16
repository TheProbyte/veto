import { navigate } from '../nav';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { sfx } from '../sfx';
import { PixelScene, usePixelLayout } from '../pixel/PixelCanvas';
import type { SceneData } from '../pixel/scene';
import './panels.css';

type Item = 'open' | 'join' | 'howto';
const ITEMS: { k: Item; label: string }[] = [
  { k: 'open', label: 'Open a table' },
  { k: 'join', label: 'Join with code' },
  { k: 'howto', label: 'How to play' },
];

const STEPS: { n: string; t: string; d: string }[] = [
  { n: 'I', t: 'Pull up a chair', d: 'Open a table and send the code to your posse.' },
  { n: 'II', t: 'Link Steam', d: "The barkeep finds the games y'all own." },
  { n: 'III', t: 'Toss in games', d: 'Everyone nominates a few for tonight.' },
  { n: 'IV', t: "Shoot 'em down", d: 'Take turns vetoing. The last one standing gets played.' },
];

/** pixel hand pointing right (10x7), the menu's selector */
const HAND = ['..kkk.....', '.kwwwkkkkk', 'kwwwwwwwwk', 'kwwwwkkkk.', 'kwwwwwk...', '.kwwwwk...', '..kkkk....'];
function Hand() {
  return (
    <svg className="nh-tt-hand" viewBox="0 0 10 7" shapeRendering="crispEdges" aria-hidden>
      {HAND.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={c === 'k' ? '#0b0705' : '#e8d5b5'} />)))}
    </svg>
  );
}

const go = (c: string) => { sfx.unlock(); setTimeout(() => navigate(`/r/${c}`), 120); };

export default function Home() {
  const L = usePixelLayout();
  const scene: SceneData = useMemo(() => ({ players: [], phase: 'lobby', dimAll: 0.85, fx: { queue: [], tempo: () => 0 } }), []);
  const [sel, setSel] = useState(0);
  const [joining, setJoining] = useState(false);
  const [howto, setHowto] = useState(false);
  const [code, setCode] = useState('');
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const codeRef = useRef<HTMLInputElement>(null);

  const open = () => {
    sfx.unlock(); sfx.click();
    go(Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X'));
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 3) return;
    sfx.unlock(); sfx.click();
    go(c);
  };
  const activate = (k: Item) => {
    setSel(ITEMS.findIndex((i) => i.k === k));
    if (k === 'open') return open();
    sfx.unlock(); sfx.click();
    if (k === 'join') setJoining((j) => !j);
    else setHowto(true);
  };
  const pick = (i: number) => { if (i !== sel) { setSel(i); sfx.hover(); } };

  useEffect(() => { if (joining) codeRef.current?.focus(); }, [joining]);

  // ↑/↓ moves the hand, Enter picks (a focused button / the code field handle their own Enter)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (howto) {
        if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); sfx.click(); setHowto(false); btns.current[2]?.focus(); }
        return;
      }
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && a.tagName === 'INPUT';
      if (e.key === 'Escape' && joining) { e.preventDefault(); setJoining(false); btns.current[1]?.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (typing && e.key === 'ArrowUp') { e.preventDefault(); btns.current[1]?.focus(); setSel(1); sfx.hover(); return; }
        if (typing) return;
        e.preventDefault();
        setSel((s) => {
          const n = (s + (e.key === 'ArrowDown' ? 1 : ITEMS.length - 1)) % ITEMS.length;
          btns.current[n]?.focus();
          return n;
        });
        sfx.hover();
        return;
      }
      if (e.key === 'Enter' && !typing && a?.tagName !== 'BUTTON') { e.preventDefault(); activate(ITEMS[sel].k); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="nh-home nh-tt">
      <div className="nh-tt-scene" aria-hidden><PixelScene layout={L} data={scene} /></div>
      <div className="nh-tt-shade" aria-hidden />

      <main className="nh-tt-main">
        <div className="nh-kicker">~ Games &amp; Grievances ~</div>
        <h1 className="nh-title nh-tt-logo"><span>Nah.</span></h1>
        <p className="nh-tt-tag">Pick tonight's Steam game together.</p>

        <nav className="nh-tt-menu" aria-label="Main menu">
          {ITEMS.map((it, i) => (
            <div key={it.k} className={`nh-tt-row ${sel === i ? 'is-sel' : ''}`}>
              <button type="button" ref={(el) => { btns.current[i] = el; }} className={`nh-tt-item ${it.k === 'open' ? 'is-main' : ''}`}
                aria-expanded={it.k === 'join' ? joining : undefined} aria-haspopup={it.k === 'howto' ? 'dialog' : undefined}
                onMouseEnter={() => pick(i)} onFocus={() => setSel(i)} onClick={() => activate(it.k)}>
                <Hand /><span>{it.label}</span>
              </button>
              {it.k === 'join' && joining && (
                <form className="nh-tt-join" onSubmit={join}>
                  <input ref={codeRef} className="nh-input nh-input-code" value={code} maxLength={12}
                    onChange={(e) => setCode(e.target.value.toUpperCase())} onFocus={() => setSel(1)} placeholder="ABCDE" autoComplete="off" spellCheck={false}
                    autoCapitalize="characters" autoCorrect="off" inputMode="text" enterKeyHint="go" aria-label="Table code" />
                  <button type="submit" className="nh-btn nh-btn-sm" disabled={code.trim().length < 3} onMouseEnter={() => sfx.hover()}>Join</button>
                </form>
              )}
            </div>
          ))}
        </nav>

        <footer className="nh-tt-foot"><span className="nh-tt-keys">↑↓ choose · Enter pick · </span>No sign-up. Just Steam and friends.</footer>
      </main>

      {howto && (
        <div className="nh-tt-modal" role="dialog" aria-modal="true" aria-label="How to play" onPointerDown={(e) => { if (e.target === e.currentTarget) { sfx.click(); setHowto(false); } }}>
          <div className="nh-tt-card">
            <h2>How to play</h2>
            <ol>
              {STEPS.map((s) => <li key={s.n}><b>{s.n}</b><span><strong>{s.t}</strong><small>{s.d}</small></span></li>)}
            </ol>
            <button type="button" className="nh-btn nh-btn-sm nh-tt-ok" autoFocus onClick={() => { sfx.click(); setHowto(false); btns.current[2]?.focus(); }}>Got it</button>
          </div>
        </div>
      )}
    </div>
  );
}
