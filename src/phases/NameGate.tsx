import { useState } from 'react';
import { sfx } from '../sfx';
import './panels.css';

export default function NameGate({ code, onJoin }: { code: string; onJoin: (n: string) => void }) {
  const [n, setN] = useState('');
  return (
    <div className="nh-home nh-gate-wrap">
      <div className="nh-planks" aria-hidden />
      <div className="nh-lamp nh-lamp-c" aria-hidden />
      <div className="nh-vignette" aria-hidden />
      <div className="nh-grain" aria-hidden />
      <form className="nh-card nh-parch nh-gate" onSubmit={(e) => {
        e.preventDefault();
        const v = n.trim();
        if (!v) return;
        sfx.unlock(); sfx.chair();
        onJoin(v.slice(0, 20));
      }}>
        <i className="nh-nail tl" /><i className="nh-nail tr" /><i className="nh-nail bl" /><i className="nh-nail br" />
        <div className="nh-kicker dark">Table</div>
        <h1 className="nh-gate-code">{code}</h1>
        <div className="nh-rule" />
        <label htmlFor="nh-name" className="nh-gate-q">Your name, stranger?</label>
        <input id="nh-name" className="nh-input nh-input-parch" autoFocus value={n} maxLength={20}
          onChange={(e) => setN(e.target.value)} placeholder="Your name" autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
        <button type="submit" className="nh-btn nh-btn-big" disabled={!n.trim()}>Pull up a chair</button>
      </form>
    </div>
  );
}
