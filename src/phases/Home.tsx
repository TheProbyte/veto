import { useMemo, useState, type FormEvent } from 'react';
import { sfx } from '../sfx';
import './panels.css';

export default function Home() {
  const [code, setCode] = useState('');
  const go = () => {
    sfx.unlock(); sfx.click();
    const c = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    setTimeout(() => { location.href = `/r/${c}`; }, 120);
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 3) return;
    sfx.unlock(); sfx.click();
    setTimeout(() => { location.href = `/r/${c}`; }, 120);
  };
  const dust = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    left: Math.random() * 100, top: 20 + Math.random() * 80,
    size: 1 + Math.random() * 2.5, dur: 9 + Math.random() * 14, delay: -Math.random() * 20, i,
  })), []);
  return (
    <div className="nh-home">
      <div className="nh-planks" aria-hidden />
      <div className="nh-lamp nh-lamp-l" aria-hidden />
      <div className="nh-lamp nh-lamp-r" aria-hidden />
      <div className="nh-dust" aria-hidden>
        {dust.map((d) => <span key={d.i} style={{ left: `${d.left}%`, top: `${d.top}%`, width: d.size, height: d.size, animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s` }} />)}
      </div>
      <div className="nh-counter" aria-hidden />
      <div className="nh-vignette" aria-hidden />
      <div className="nh-grain" aria-hidden />

      <main className="nh-home-main">
        <div className="nh-kicker">~ Est. tonight ~ Games &amp; Grievances ~</div>
        <h1 className="nh-title"><span>Nah.</span></h1>
        <p className="nh-tagline">Pick tonight's game. Shoot down the rest.</p>

        <ol className="nh-steps">
          <li><b>I</b><span>Pull up a chair</span><small>Send the link, link your Steam.</small></li>
          <li><b>II</b><span>Toss in your games</span><small>We find what y'all own together.</small></li>
          <li><b>III</b><span>Shoot 'em down</span><small>Take turns. Last box standing wins.</small></li>
        </ol>

        <button type="button" className="nh-btn nh-btn-big nh-open" onClick={go} onMouseEnter={() => sfx.hover()}>Open a table</button>

        <form className="nh-join" onSubmit={join}>
          <label htmlFor="nh-code">Got a code?</label>
          <div className="nh-join-row">
            <input id="nh-code" className="nh-input nh-input-code" value={code} maxLength={12}
              onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE" autoComplete="off" spellCheck={false}
              autoCapitalize="characters" autoCorrect="off" inputMode="text" enterKeyHint="go" aria-label="Table code" />
            <button type="submit" className="nh-btn nh-btn-sm" disabled={code.trim().length < 3} onMouseEnter={() => sfx.hover()}>Join</button>
          </div>
        </form>
      </main>
    </div>
  );
}
