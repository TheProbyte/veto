// Lobby target practice: a 20-second solo shooting gallery on the saloon's back bar. Bottles pop up on the shelves,
// the bar and the piano; gold ones are worth 3, the barkeep's coffee pot costs 2. The score (0..99) goes to the
// server once at the end of a round and the table keeps a top 5 (state.record.bottles).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RoomProps } from '../props';
import { PAL, rnd } from '../pixel/palette';
import { bayer, makeCanvas } from '../pixel/dither';
import { PixelSprite } from '../pixel/PixelCanvas';
import { holeAt } from '../pixel/sprites';
import { sfx } from '../sfx';
import { TARGET_ICON, clamp, lerp, spriteFrom } from './pix';
import './fun.css';

const ROUND_MS = 20000;
const READY_MS = 1300;

/* ============================== sprites ============================== */

type Kind = 'brown' | 'green' | 'whiskey' | 'jug' | 'gold' | 'pot';
const PTS: Record<Kind, number> = { brown: 1, green: 1, whiskey: 1, jug: 1, gold: 3, pot: -2 };
const BOTTLE = [
  '..c..',
  '..c..',
  '..m..',
  '..m..',
  '.hmm.',
  'hmmmd',
  'hmmmd',
  'LLLLL',
  'LsLLL',
  'hmmmd',
  'hmmmd',
  'hmmmd',
];
const JUG = [
  '..c..',
  '.hmd.',
  'hmmmmd',
  'hmmmmd',
  'hLLLLd',
  'hLsLsd',
  'hLLLLd',
  'hmmmmd',
  '.hmmd.',
];
const POT = [
  '.....kk.....',
  '....llll....',
  '...hmmmmd...',
  'ss.hmmmmd.kk',
  '.s.hwmmmdk.k',
  '..shmmmwdk.k',
  '...hmmmmdk.k',
  '..hmmwmmmdkk',
  '..hmmmmmmd..',
  '..hmmmmmmd..',
  '..dddddddd..',
];
const SHARDS: Record<Kind, string[]> = {
  brown: ['#5a2e12', '#8a4a1c', '#c47a3a'], green: ['#1f4a22', '#2f6a3a', '#6fae6a'],
  whiskey: ['#c4581f', '#ffb35c', '#e8d5b5'], jug: ['#c9b08a', '#9c8160', '#e8d5b5'],
  gold: ['#a87c18', '#d4a52a', '#fff3b8'], pot: ['#3a5470', '#6f8fae', '#2a1a10'],
};
let SPR: Record<Kind, HTMLCanvasElement> | null = null;
function sprites() {
  if (SPR) return SPR;
  const b = (h: string, m: string, d: string, L: string = PAL.parch, c = '#7a5232') => spriteFrom(BOTTLE, { h, m, d, L, s: PAL.red1, c });
  SPR = {
    brown: b('#c47a3a', '#8a4a1c', '#5a2e12'),
    green: b('#6fae6a', '#2f6a3a', '#1f4a22', PAL.parch2),
    whiskey: b('#ffe7b8', '#ffb35c', '#c4581f', PAL.parch, '#5a3a22'),
    jug: spriteFrom(JUG, { h: PAL.parch, m: PAL.parch2, d: PAL.parch3, L: PAL.wood3, s: PAL.parch, c: '#7a5232' }),
    gold: b('#fff3b8', '#d4a52a', '#a87c18', '#f2d36b', '#6b4a0c'),
    pot: spriteFrom(POT, { h: PAL.blue3, m: PAL.blue2, d: PAL.blue1, w: PAL.white, l: PAL.metal3, k: PAL.metal2, s: PAL.metal2 }),
  };
  return SPR;
}

/* ============================== layout ============================== */

interface Surf { x0: number; x1: number; y: number; kind: 'shelf' | 'bar' | 'piano' }
interface Geo { W: number; H: number; S: number; surfs: Surf[]; bar: number; piano: { x0: number; x1: number; y: number } }

function geo(vw: number, vh: number): Geo {
  const S = clamp(Math.floor(Math.min(vw, vh) / 140), 3, 7);
  const W = Math.ceil(vw / S), H = Math.ceil(vh / S);
  const portrait = H > W * 1.15;
  const bar = Math.round(H * (portrait ? 0.82 : 0.8));
  const surfs: Surf[] = [];
  let piano;
  if (portrait) {
    for (const f of [0.2, 0.33, 0.46]) surfs.push({ x0: 6, x1: W - 6, y: Math.round(H * f), kind: 'shelf' });
    piano = { x0: 6, x1: Math.round(W * 0.62), y: Math.round(H * 0.63) };
  } else {
    for (const f of [0.24, 0.42, 0.6]) surfs.push({ x0: 8, x1: Math.round(W * 0.64), y: Math.round(H * f), kind: 'shelf' });
    piano = { x0: Math.round(W * 0.69), x1: W - 8, y: Math.round(H * 0.52) };
  }
  surfs.push({ x0: piano.x0 + 3, x1: piano.x1 - 3, y: piano.y, kind: 'piano' });
  surfs.push({ x0: 6, x1: W - 6, y: bar, kind: 'bar' });
  return { W, H, S, surfs, bar, piano };
}

function backdrop(g: Geo): HTMLCanvasElement {
  const { W, H } = g;
  const [cv, c] = makeCanvas(W, H);
  // plank wall with a warm lamp glow at the top centre
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const plank = Math.floor(x / 9);
    const seam = x % 9 === 0;
    const glow = Math.max(0, 1 - Math.hypot((x - W / 2) / (W * 0.55), (y - H * 0.05) / (H * 0.7)));
    const n = rnd(plank, Math.floor(y / 3), 7) * 0.25 + glow * 0.9;
    const col = seam ? PAL.wood0 : n > 0.75 + bayer(x, y) * 0.25 ? PAL.wood3 : n > 0.3 + bayer(x, y) * 0.3 ? PAL.wood2 : PAL.wood1;
    c.fillStyle = col; c.fillRect(x, y, 1, 1);
  }
  // hanging lamp
  const lx = Math.round(W / 2);
  c.fillStyle = PAL.ink; c.fillRect(lx, 0, 1, 5);
  c.fillStyle = PAL.metal2; c.fillRect(lx - 3, 5, 7, 2);
  c.fillStyle = PAL.lamp1; c.fillRect(lx - 2, 7, 5, 2);
  c.fillStyle = PAL.lamp0; c.fillRect(lx - 1, 7, 3, 1);
  // shelves (plank + brackets)
  for (const s of g.surfs) {
    if (s.kind !== 'shelf') continue;
    c.fillStyle = PAL.ink; c.fillRect(s.x0 - 2, s.y, s.x1 - s.x0 + 4, 3);
    c.fillStyle = PAL.wood4; c.fillRect(s.x0 - 2, s.y, s.x1 - s.x0 + 4, 1);
    c.fillStyle = PAL.wood3; c.fillRect(s.x0 - 2, s.y + 1, s.x1 - s.x0 + 4, 1);
    for (const bx of [s.x0 + 4, Math.round((s.x0 + s.x1) / 2), s.x1 - 5]) {
      c.fillStyle = PAL.ink; c.fillRect(bx, s.y + 3, 2, 3); c.fillRect(bx + 1, s.y + 6, 1, 1);
    }
  }
  // upright piano
  const p = g.piano;
  const pb = g.bar;
  c.fillStyle = PAL.ink; c.fillRect(p.x0 - 1, p.y - 1, p.x1 - p.x0 + 2, pb - p.y + 1);
  for (let y = p.y; y < pb; y++) for (let x = p.x0; x < p.x1; x++) {
    const edge = x === p.x0 || y === p.y;
    c.fillStyle = edge ? PAL.wood4 : (x + y) % 11 === 0 ? PAL.wood3 : PAL.wood1;
    c.fillRect(x, y, 1, 1);
  }
  c.fillStyle = PAL.wood3; c.fillRect(p.x0, p.y, p.x1 - p.x0, 2);
  const ky = p.y + Math.max(8, Math.round((pb - p.y) * 0.42));
  c.fillStyle = PAL.ink; c.fillRect(p.x0 + 2, ky - 1, p.x1 - p.x0 - 4, 5);
  c.fillStyle = PAL.white; c.fillRect(p.x0 + 3, ky, p.x1 - p.x0 - 6, 3);
  c.fillStyle = PAL.ink;
  for (let x = p.x0 + 4; x < p.x1 - 4; x += 3) { c.fillRect(x, ky, 1, 3); if ((x / 3) % 7 !== 2) c.fillRect(x + 1, ky, 1, 2); }
  // panel inlays above the keys
  c.fillStyle = PAL.wood2; c.fillRect(p.x0 + 4, p.y + 4, p.x1 - p.x0 - 8, Math.max(2, ky - p.y - 8));
  // bar top + front
  c.fillStyle = PAL.ink; c.fillRect(0, pb, W, H - pb);
  c.fillStyle = PAL.wood4; c.fillRect(0, pb, W, 1);
  c.fillStyle = PAL.wood3; c.fillRect(0, pb + 1, W, 2);
  for (let y = pb + 4; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x % 24, inset = px > 2 && px < 21 && y > pb + 6 && y < H - 4;
    c.fillStyle = px === 0 ? PAL.ink : inset ? ((x + y) % 2 ? PAL.wood1 : PAL.wood2) : PAL.wood2;
    c.fillRect(x, y, 1, 1);
  }
  c.fillStyle = PAL.lamp3; c.fillRect(0, pb + Math.round((H - pb) * 0.7), W, 1); // brass foot rail
  c.fillStyle = PAL.lamp1; c.fillRect(0, pb + Math.round((H - pb) * 0.7) - 1, W, 1);
  // vignette
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2));
    if (v > 1.05 && (v - 1.05) * 3 > bayer(x, y)) { c.fillStyle = 'rgba(11,7,5,.55)'; c.fillRect(x, y, 1, 1); }
  }
  return cv;
}

/* ============================== game state ============================== */

interface Tgt { id: number; kind: Kind; surf: number; x: number; y: number; born: number; life: number; vx: number; toss?: { vy: number; g: number; y0: number } }
interface Bit { x: number; y: number; vx: number; vy: number; col: string; t: number; life: number }
interface Game {
  g: Geo; bg: HTMLCanvasElement; decal: HTMLCanvasElement;
  start: number; tgts: Tgt[]; bits: Bit[]; nextSpawn: number; id: number;
  score: number; hits: number; combo: number; best: number; flash: { x: number; y: number; t: number } | null; kick: number;
  lastTick: number; ended: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function spawn(G: Game, now: number) {
  const t = clamp((now - G.start) / ROUND_MS, 0, 1);
  const spr = sprites();
  const live = G.tgts.length;
  if (live >= 3 + Math.round(t * 3)) return;
  const potLive = G.tgts.some((q) => q.kind === 'pot');
  const r = Math.random();
  const kind: Kind = r < 0.12 && !potLive && t > 0.08 ? 'pot' : r < 0.23 ? 'gold'
    : (['brown', 'green', 'whiskey', 'jug', 'brown', 'green'] as Kind[])[Math.floor(Math.random() * 6)];
  const sp = spr[kind];
  // a tossed bottle flying up from behind the bar (later in the round)
  if (kind !== 'pot' && t > 0.25 && Math.random() < 0.16) {
    const gg = G.g.H * 2.2, air = rand(1.0, 1.35);
    G.tgts.push({ id: ++G.id, kind, surf: -1, x: rand(G.g.W * 0.15, G.g.W * 0.85), y: G.g.bar + sp.height, born: now, life: air * 1000,
      vx: rand(-0.2, 0.2) * G.g.W, toss: { vy: gg * air / 2, g: gg, y0: G.g.bar + sp.height } });
    return;
  }
  // weight surfaces by width
  const ws = G.g.surfs.map((s) => s.x1 - s.x0);
  let pick = Math.random() * ws.reduce((a, b) => a + b, 0), si = 0;
  for (; si < ws.length - 1; si++) { pick -= ws[si]; if (pick <= 0) break; }
  const s = G.g.surfs[si];
  let x = 0;
  for (let k = 0; k < 6; k++) {
    x = rand(s.x0 + sp.width / 2 + 1, s.x1 - sp.width / 2 - 1);
    if (!G.tgts.some((q) => q.surf === si && Math.abs(q.x - x) < sp.width + 4)) break;
  }
  const life = clamp(lerp(1400, 1000, t) + rand(-250, 100), 600, 1400);
  const slide = kind !== 'pot' && Math.random() < (s.kind === 'bar' ? 0.55 : 0.22) * (0.5 + t);
  G.tgts.push({ id: ++G.id, kind, surf: si, x, y: s.y, born: now, life, vx: slide ? (Math.random() < 0.5 ? -1 : 1) * rand(0.12, 0.22) * G.g.W : 0 });
}

function burst(G: Game, x: number, y: number, kind: Kind) {
  const cols = SHARDS[kind];
  const n = kind === 'pot' ? 14 : 18;
  for (let i = 0; i < n; i++) {
    const a = rand(-Math.PI, 0) + rand(-0.4, 0.4), v = rand(20, 75);
    G.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, col: cols[i % cols.length], t: 0, life: rand(400, 800) });
  }
  if (kind === 'pot') for (let i = 0; i < 10; i++) G.bits.push({ x, y, vx: rand(-15, 15), vy: rand(-30, 0), col: i % 2 ? '#3b2416' : '#5a3a22', t: 0, life: rand(500, 900) });
}

function bounds(t: Tgt): [number, number, number, number] {
  const sp = sprites()[t.kind];
  return [Math.round(t.x - sp.width / 2), Math.round(t.y - sp.height), sp.width, sp.height];
}

function tick(G: Game, now: number, dt: number, spawning: boolean) {
  if (spawning && now >= G.nextSpawn && now - G.start < ROUND_MS - 400) {
    spawn(G, now);
    const t = clamp((now - G.start) / ROUND_MS, 0, 1);
    G.nextSpawn = now + lerp(450, 280, t) + rand(0, 120);
  }
  for (const q of G.tgts) {
    if (q.toss) {
      const s = (now - q.born) / 1000;
      q.y = q.toss.y0 - (q.toss.vy * s - (q.toss.g * s * s) / 2);
      q.x += q.vx * dt;
    } else if (q.vx) {
      const s = G.g.surfs[q.surf], hw = sprites()[q.kind].width / 2;
      q.x += q.vx * dt;
      if (q.x < s.x0 + hw) { q.x = s.x0 + hw; q.vx = -q.vx; }
      if (q.x > s.x1 - hw) { q.x = s.x1 - hw; q.vx = -q.vx; }
    }
  }
  G.tgts = G.tgts.filter((q) => now - q.born < q.life);
  for (const b of G.bits) { b.t += dt * 1000; b.vy += 160 * dt; b.x += b.vx * dt; b.y += b.vy * dt; }
  G.bits = G.bits.filter((b) => b.t < b.life && b.y < G.g.H + 4);
  G.kick = Math.max(0, G.kick - dt * 30);
}

function draw(c: CanvasRenderingContext2D, G: Game, now: number) {
  const k = Math.round(G.kick);
  c.setTransform(1, 0, 0, 1, 0, k);
  c.drawImage(G.bg, 0, 0);
  c.drawImage(G.decal, 0, 0);
  const spr = sprites();
  for (const q of G.tgts) {
    const sp = spr[q.kind];
    const [x, y, w, h] = bounds(q);
    const age = now - q.born, left = q.life - age;
    // pop up from behind the surface / sink back down (tossed bottles fly up from behind the bar)
    const rise = q.toss ? 1 : Math.min(1, age / 90, left / 110);
    const dy = Math.round(h * (1 - Math.max(0, rise)));
    c.save();
    c.beginPath(); c.rect(x - 2, -2, w + 4, (q.toss ? G.g.bar : q.y) + 3); c.clip();
    c.drawImage(sp, x, y + dy);
    c.restore();
    if (q.kind === 'gold' && Math.floor(now / 140) % 3 === 0) { c.fillStyle = PAL.white; c.fillRect(x + 1, y + dy + 7, 1, 1); c.fillRect(x + w - 2, y + dy + 3, 1, 1); }
    if (q.kind === 'pot' && rise >= 1) { // steam wisps
      const f = Math.floor(now / 120);
      c.fillStyle = 'rgba(232,213,181,.7)';
      c.fillRect(x + 1 - (f % 2), y - 2 - (f % 3), 1, 1);
      c.fillRect(x + (f % 2), y - 4 - (f % 2), 1, 1);
    }
  }
  for (const b of G.bits) {
    c.fillStyle = b.col;
    c.fillRect(Math.round(b.x), Math.round(b.y), b.t < b.life * 0.5 ? 2 : 1, 1);
  }
  if (G.flash && now - G.flash.t < 80) {
    const { x, y } = G.flash, r = now - G.flash.t < 40 ? 5 : 3;
    c.fillStyle = PAL.lamp2;
    for (let i = -r; i <= r; i++) { c.fillRect(x + i, y, 1, 1); c.fillRect(x, y + i, 1, 1); }
    for (let i = -(r >> 1); i <= r >> 1; i++) { c.fillRect(x + i, y + i, 1, 1); c.fillRect(x + i, y - i, 1, 1); }
    c.fillStyle = PAL.lamp1; c.fillRect(x - 1, y - 1, 3, 3);
    c.fillStyle = PAL.white; c.fillRect(x, y, 1, 1);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

/* ============================== component ============================== */

type Phase = 'ready' | 'play' | 'over';

function Gallery({ onClose, onSubmit, tableBest }: { onClose: () => void; onSubmit: (score: number) => void; tableBest: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ score: 0, combo: 0, hits: 0 });
  const [final, setFinal] = useState<{ score: number; hits: number; best: number; record: boolean } | null>(null);
  const [canAct, setCanAct] = useState(false);
  const [round, setRound] = useState(0);
  const coarse = useRef(false);
  const submitRef = useRef(onSubmit); submitRef.current = onSubmit;
  const bestRef = useRef(tableBest); bestRef.current = tableBest;

  useEffect(() => {
    try { coarse.current = matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
  }, []);

  // one round per `round` value
  useEffect(() => {
    const cv = cvRef.current, el = wrap.current; if (!cv || !el) return;
    const c = cv.getContext('2d'); if (!c) return;
    let dead = false, raf = 0, sent = false;
    const setup = () => {
      const g = geo(el.clientWidth || innerWidth, el.clientHeight || innerHeight);
      cv.width = g.W; cv.height = g.H;
      cv.style.width = `${g.W * g.S}px`; cv.style.height = `${g.H * g.S}px`;
      c.imageSmoothingEnabled = false;
      const [decal] = makeCanvas(g.W, g.H);
      const prev = game.current;
      if (prev && prev.g.W === g.W && prev.g.H === g.H) return;
      const t0 = performance.now();
      game.current = prev
        ? { ...prev, g, bg: backdrop(g), decal, tgts: [], bits: [] }
        : { g, bg: backdrop(g), decal, start: t0 + READY_MS, tgts: [], bits: [], nextSpawn: t0 + READY_MS + 150, id: 0,
          score: 0, hits: 0, combo: 0, best: 0, flash: null, kick: 0, lastTick: 99, ended: false };
    };
    game.current = null;
    setup();
    setPhase('ready'); setFinal(null); setCanAct(false); setHud({ score: 0, combo: 0, hits: 0 });
    let readyShown = true;
    const onResize = () => setup();
    addEventListener('resize', onResize);
    let last = performance.now();
    const loop = () => {
      if (dead) return;
      const G = game.current!;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (now >= G.start && readyShown) { readyShown = false; setPhase('play'); sfx.cock(); }
      if (now >= G.start) tick(G, now, dt, !G.ended);
      const el2 = now - G.start;
      if (barRef.current) barRef.current.style.transform = `scaleX(${clamp(1 - el2 / ROUND_MS, 0, 1)})`;
      const secLeft = Math.ceil((ROUND_MS - el2) / 1000);
      if (!G.ended && el2 > 0 && secLeft <= 5 && secLeft >= 1 && secLeft < G.lastTick) { G.lastTick = secLeft; sfx.tick(); }
      if (!G.ended && el2 >= ROUND_MS) {
        G.ended = true;
        G.tgts = [];
        const score = clamp(Math.round(G.score), 0, 99);
        if (!sent) { sent = true; submitRef.current(score); }
        setFinal({ score, hits: G.hits, best: G.best, record: score > 0 && score > bestRef.current });
        setPhase('over');
        if (score > 0) sfx.win();
        window.setTimeout(() => { if (!dead) setCanAct(true); }, 650);
      }
      draw(c, G, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { dead = true; cancelAnimationFrame(raf); removeEventListener('resize', onResize); };
  }, [round]);

  const popup = (x: number, y: number, text: string, cls: string) => {
    const fx = fxRef.current, G = game.current; if (!fx || !G) return;
    const s = document.createElement('span');
    s.className = `fun-tp-pop ${cls}`;
    s.textContent = text;
    s.style.left = `${x * G.g.S}px`; s.style.top = `${y * G.g.S}px`;
    fx.appendChild(s);
    window.setTimeout(() => s.remove(), 750);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const G = game.current, cv = cvRef.current; if (!G || !cv) return;
    const now = performance.now();
    if (now < G.start || G.ended) return;
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / G.g.S), y = Math.floor((e.clientY - r.top) / G.g.S);
    G.flash = { x, y, t: now };
    G.kick = 1.5;
    sfx.shot();
    const pad = coarse.current || e.pointerType === 'touch' ? 4 : 1;
    let hit: Tgt | null = null, hd = 1e9;
    for (const q of G.tgts) {
      const [bx, by, bw, bh] = bounds(q);
      if (q.toss && y > G.g.bar) continue; // the part behind the bar is hidden
      if (x >= bx - pad && x < bx + bw + pad && y >= by - pad && y < by + bh + pad) {
        if (!q.toss && now - q.born < 50) continue; // not up yet
        const d = Math.hypot(x - (bx + bw / 2), y - (by + bh / 2));
        if (d < hd) { hd = d; hit = q; }
      }
    }
    if (hit) {
      const [bx, by, bw, bh] = bounds(hit);
      G.tgts = G.tgts.filter((q) => q !== hit);
      burst(G, bx + bw / 2, by + bh / 2, hit.kind);
      const pts = PTS[hit.kind];
      if (pts < 0) {
        G.combo = 0;
        G.score = Math.max(0, G.score + pts);
        sfx.steam();
        popup(bx + bw / 2, by, `${pts} the coffee!`, 'bad');
      } else {
        G.combo++; G.hits++;
        G.best = Math.max(G.best, G.combo);
        let add = pts;
        const bonus = G.combo > 0 && G.combo % 5 === 0;
        if (bonus) add += 1;
        G.score = Math.min(99, G.score + add);
        sfx.shatter();
        if (hit.kind === 'gold') sfx.coin();
        popup(bx + bw / 2, by, bonus ? `+${add} combo!` : `+${add}`, hit.kind === 'gold' ? 'gold' : '');
      }
    } else {
      G.combo = 0;
      const dc = G.decal.getContext('2d');
      if (dc && y < G.g.H - 2) holeAt(dc, x, y);
    }
    setHud({ score: Math.round(G.score), combo: G.combo, hits: G.hits });
  };

  // Esc quits (no submit)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="fun-tp-overlay" ref={wrap} role="dialog" aria-modal="true" aria-label="Target practice">
      <canvas ref={cvRef} className="fun-tp-canvas" onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()} />
      <div className="fun-tp-fx" ref={fxRef} aria-hidden />
      <div className="fun-tp-hud">
        <div className="fun-tp-score px-box"><b>{hud.score}</b><span>pts</span></div>
        <div className="fun-tp-timer px-box" aria-hidden><div ref={barRef} /></div>
        <div className={`fun-tp-combo px-box ${hud.combo >= 2 ? 'on' : ''}`} aria-live="polite">{hud.combo >= 2 ? `x${hud.combo} combo` : `${hud.hits} hit`}</div>
        <button type="button" className="px-btn px-btn-sm fun-x" onClick={() => { sfx.click(); onClose(); }} aria-label="Quit target practice (no score)">✕</button>
      </div>
      {phase === 'ready' && (
        <div className="fun-tp-banner px-box">
          <b>Target practice</b>
          <span>Shoot the bottles. Gold = 3. Leave the coffee pot alone (−2).</span>
        </div>
      )}
      {phase === 'over' && final && (
        <div className="fun-tp-end px-box">
          <div className="fun-tp-big">{final.score} {final.score === 1 ? 'bottle' : 'bottles'}</div>
          <div className="fun-tp-sub">{final.hits} hits · best combo x{final.best}</div>
          {final.record && <div className="fun-tp-rec">New table record!</div>}
          <div className="fun-tp-acts">
            <button type="button" className="px-btn px-btn-sm" disabled={!canAct} onClick={() => { sfx.click(); setRound((r) => r + 1); }}>Again</button>
            <button type="button" className="px-btn px-btn-sm" disabled={!canAct} onClick={() => { sfx.click(); onClose(); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BottleBoard({ rows, me, limit = 5 }: { rows: { pid: string; name: string; score: number }[]; me: string; limit?: number }) {
  if (!rows.length) return <p className="fun-board-empty">No marks yet. Be the first.</p>;
  return (
    <ol className="fun-board">
      {rows.slice(0, limit).map((r, i) => (
        <li key={`${r.pid}-${i}`} className={r.pid === me ? 'me' : ''}>
          <span className="n">{i + 1}.</span>
          <span className="nm">{r.name}</span>
          <span className="sc">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

export default function TargetPractice({ state, me, send }: RoomProps) {
  const [open, setOpen] = useState(false);
  const rows = state.record?.bottles ?? [];
  const best = rows.reduce((m, r) => Math.max(m, r.score), 0);
  const close = useCallback(() => setOpen(false), []);
  const submit = useCallback((score: number) => send({ t: 'bottles', score }), [send]);
  // the round ends with the lobby: close if the phase moves on
  useEffect(() => { if (state.phase !== 'lobby') setOpen(false); }, [state.phase]);
  return (
    <div className="fun-tp">
      <button type="button" className="px-btn px-btn-sm fun-btn" onClick={() => { sfx.click(); setOpen(true); }}>
        <PixelSprite draw={TARGET_ICON.draw} w={TARGET_ICON.w} h={TARGET_ICON.h} className="fun-ico" style={{ width: `calc(var(--pt) * ${TARGET_ICON.w})`, height: `calc(var(--pt) * ${TARGET_ICON.h})` }} />
        <span>Target practice</span>
      </button>
      <div className="fun-board-wrap">
        <div className="fun-board-h">Best shots at this table</div>
        <BottleBoard rows={rows} me={me} />
      </div>
      {open && createPortal(<Gallery onClose={close} onSubmit={submit} tableBest={best} />, document.body)}
    </div>
  );
}
