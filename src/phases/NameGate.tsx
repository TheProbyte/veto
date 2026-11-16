import { useState } from 'react';
export default function NameGate({ code, onJoin }: { code: string; onJoin: (n: string) => void }) {
  const [n, setN] = useState('');
  return <form className="gate" onSubmit={(e) => { e.preventDefault(); if (n.trim()) onJoin(n.trim().slice(0, 20)); }}>
    <h1>Table {code}</h1><input value={n} onChange={(e) => setN(e.target.value)} placeholder="Your name, stranger" /><button>Sit down</button></form>;
}
