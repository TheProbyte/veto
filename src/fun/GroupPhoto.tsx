// End-of-round group photo: the whole posse posed around tonight's winning game as one old-timey pixel photograph
// (1200x630 PNG: drawn at low res, sepia-toned with dither + grain, then scaled up by an integer factor).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Player, RoomState } from '../../shared/types';
import type { RoomProps } from '../props';
import { PAL, hashStr, hexRgb, rnd } from '../pixel/palette';
import { bayer, makeCanvas } from '../pixel/dither';
import { bustFor, renderBust, type Pose } from '../pixel/sprites';
import { pixelize } from '../pixel/pixelize';
import { placeholderDraw } from '../pixel/PixelCover';
import { PixelSprite } from '../pixel/PixelCanvas';
import { sfx } from '../sfx';
import { CAMERA_ICON, fontsReady, hardAlpha } from './pix';
import './fun.css';

const OUT_W = 1200, OUT_H = 630;
const SEPIA = ['#140b06', '#2e1c10', '#4d321c', '#6f4c2c', '#94704a', '#b8966a', '#d8bd8e', '#f0dfb8'].map(hexRgb);

const POSES: Pose[] = [
  { arm: 'toast', mouth: 'grin', lids: 'happy' },
  { arm: 'glassUp', mouth: 'open' },
  { mouth: 'grin' },
  { arm: 'clap', mouth: 'wide', lids: 'happy' },
  { arm: 'shrug', mouth: 'grin', brow: 'up' },
  { arm: 'cards', mouth: 'grit' },
  { lids: 'happy', mouth: 'grin', hy: 1 },
  { arm: 'fists', mouth: 'grit', brow: 'angry' },
];

const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'game';

function fitText(c: CanvasRenderingContext2D, text: string, maxW: number, font: (px: number) => string, sizes: number[]): [string, number] {
  for (const s of sizes) { c.font = font(s); if (c.measureText(text).width <= maxW) return [text, s]; }
  const s = sizes[sizes.length - 1];
  c.font = font(s);
  let t = text;
  while (t.length > 1 && c.measureText(`${t}.`).width > maxW) t = t.slice(0, -1);
  return [`${t.trimEnd()}.`, s];
}

interface Shot { blob: Blob; url: string; file: File | null; name: string }

/** Renders the photo. Exported for reuse (e.g. a share card elsewhere). */
export async function renderGroupPhoto(state: RoomState): Promise<HTMLCanvasElement> {
  const res = state.result!;
  const players = [...state.players].sort((a, b) => a.seat - b.seat).slice(0, 8);
  const n = players.length;
  const k = n <= 4 ? 5 : 3;                       // integer upscale: 240x126 or 400x210
  const W = OUT_W / k, H = OUT_H / k;
  const MT = n <= 4 ? 13 : 15, MB = n <= 4 ? 10 : 12, MS = 6; // card mount: top (caption), bottom (date), sides
  const px0 = MS, py0 = MT, pw = W - MS * 2, ph = H - MT - MB; // the photo itself
  const counterH = n <= 4 ? 13 : 16;
  const counterTop = py0 + ph - counterH;

  // ---------- 1. the scene in colour ----------
  const [cv, c] = makeCanvas(W, H);
  // studio backdrop: painted cloth with soft dithered clouds
  for (let y = py0; y < py0 + ph; y++) for (let x = px0; x < px0 + pw; x++) {
    const u = (x - px0) / pw, v = (y - py0) / ph;
    const cloud = Math.sin(u * 9 + Math.sin(v * 5) * 1.5) * 0.25 + Math.sin(u * 3.3 - v * 4) * 0.25 + rnd(x >> 2, y >> 2, 3) * 0.2;
    const glow = 1 - Math.hypot(u - 0.5, (v - 0.35) * 1.3) * 1.4;
    const t = glow * 0.65 + cloud * 0.35 + 0.15;
    c.fillStyle = t > 0.62 + bayer(x, y) * 0.18 ? PAL.parch3 : t > 0.3 + bayer(x, y) * 0.2 ? PAL.wood4 : t > 0.05 ? PAL.wood3 : PAL.wood2;
    c.fillRect(x, y, 1, 1);
  }
  // bunting strung across the top of the backdrop
  const flags = ['#9e1b1b', '#e8d5b5', '#24345e', '#d4a52a'];
  const sag = Math.max(5, Math.round(ph * 0.08));
  for (let x = px0; x < px0 + pw; x++) {
    const u = (x - px0) / pw;
    const y = py0 + 3 + Math.round(Math.sin(u * Math.PI * 2 % Math.PI) * sag);
    c.fillStyle = PAL.ink; c.fillRect(x, y, 1, 1);
    const fi = Math.floor((x - px0) / 8);
    if ((x - px0) % 8 === 0) for (let r = 0; r < 6; r++) { c.fillStyle = flags[fi % 4]; c.fillRect(x + 1 + (r >> 1), y + 1 + r, Math.max(1, 6 - r * 1.1 | 0), 1); }
  }
  // floor line / rug behind the counter
  c.fillStyle = PAL.wood2; c.fillRect(px0, counterTop - 4, pw, 4);

  // the winning game, framed on an easel
  const coverH = Math.round(Math.min(ph - counterH - (n <= 4 ? 18 : 30), (n <= 4 ? 60 : 96)));
  const coverW = Math.round(coverH * 2 / 3);
  const fx = Math.round(W / 2 - coverW / 2), fy = counterTop - coverH - 6;
  c.fillStyle = PAL.ink; c.fillRect(fx + 3, fy + coverH, 2, counterTop - fy - coverH); c.fillRect(fx + coverW - 5, fy + coverH, 2, counterTop - fy - coverH);
  c.fillStyle = PAL.ink; c.fillRect(fx - 4, fy - 4, coverW + 8, coverH + 8);
  c.fillStyle = '#a87c18'; c.fillRect(fx - 3, fy - 3, coverW + 6, coverH + 6);
  c.fillStyle = '#f2d36b'; c.fillRect(fx - 3, fy - 3, coverW + 6, 1); c.fillRect(fx - 3, fy - 3, 1, coverH + 6);
  c.fillStyle = '#6b4a0c'; c.fillRect(fx - 1, fy - 1, coverW + 2, coverH + 2);
  const art = await pixelize(res.appid, 'box', coverW, coverH).catch(() => null);
  if (art) c.drawImage(art.cv, fx, fy, coverW, coverH);
  else {
    const [ph2, pc] = makeCanvas(coverW, coverH);
    placeholderDraw(hashStr(String(res.appid)) % 997)(pc, coverW, coverH);
    c.drawImage(ph2, fx, fy);
  }

  // the posse: left half and right half of the table, everyone glancing at the game
  const left = players.filter((_, i) => i % 2 === 0), right = players.filter((_, i) => i % 2 === 1);
  const sideW = (pw - (coverW + 10)) / 2;
  const slots: { p: Player; x: number; side: -1 | 1; i: number }[] = [];
  const place = (arr: Player[], side: -1 | 1) => {
    const step = arr.length > 1 ? Math.min(46, (sideW - 44) / (arr.length - 1)) : 0;
    arr.forEach((p, j) => {
      // j = 0 sits next to the game
      const cxFromCentre = coverW / 2 + 5 + 24 + j * step;
      slots.push({ p, x: Math.round(W / 2 + side * cxFromCentre - 24), side, i: j });
    });
  };
  place(left, -1); place(right, 1);
  slots.sort((a, b) => b.i - a.i); // outer ones first, inner ones overlap them
  const bustTop = counterTop - 50 + (n <= 4 ? 4 : 0);
  for (const s of slots) {
    const pose = POSES[hashStr(s.p.id + res.appid) % POSES.length];
    const b = renderBust(bustFor(s.p), { scale: 1, blink: false, rimRight: s.side < 0, lit: false, dim: 1, ghost: false, bot: s.p.bot, padTop: 4,
      pose: { ...pose, eyes: s.side < 0 ? 1 : -1 } });
    c.drawImage(b, s.x, bustTop - 4 + (s.i % 2));
  }
  // the counter in front of everyone
  c.fillStyle = PAL.ink; c.fillRect(px0, counterTop, pw, counterH);
  c.fillStyle = PAL.wood4; c.fillRect(px0, counterTop + 1, pw, 1);
  c.fillStyle = PAL.wood3; c.fillRect(px0, counterTop + 2, pw, 2);
  for (let y = counterTop + 4; y < py0 + ph; y++) for (let x = px0; x < px0 + pw; x++) {
    c.fillStyle = (x - px0) % 20 === 0 ? PAL.wood1 : (rnd(x >> 3, y, 1) > 0.5 ? PAL.wood2 : PAL.wood3);
    c.fillRect(x, y, 1, 1);
  }

  // ---------- 2. develop: sepia ramp + dither + grain + vignette + scratches ----------
  const img = c.getImageData(px0, py0, pw, ph);
  const d = img.data;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const i = (y * pw + x) * 4;
    let l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    l = Math.pow(l, 0.8) * 1.12;
    const vig = Math.hypot((x - pw / 2) / (pw / 2), (y - ph / 2) / (ph / 2));
    l -= Math.max(0, vig - 0.75) * 0.55;
    l += (rnd(x, y, 11) - 0.5) * 0.08;
    const f = Math.max(0, Math.min(SEPIA.length - 1, l * (SEPIA.length - 1) + (bayer(x, y) - 0.5) * 0.9));
    const col = SEPIA[Math.round(f)];
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  // a couple of scratches and dust specks
  const seed = hashStr(state.code + res.appid);
  for (let s = 0; s < 2; s++) {
    let x = Math.floor(rnd(s, 1, seed) * pw);
    const y0 = Math.floor(rnd(s, 2, seed) * ph * 0.5), len = Math.floor(ph * (0.1 + rnd(s, 3, seed) * 0.15));
    for (let y = y0; y < Math.min(ph, y0 + len); y++) {
      if (rnd(x, y, 5) < 0.12) x += rnd(y, x, 6) < 0.5 ? -1 : 1;
      if (x < 0 || x >= pw || rnd(x, y, 9) < 0.25) continue;
      const i = (y * pw + x) * 4; const col = SEPIA[5];
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
    }
  }
  for (let s = 0; s < 14; s++) {
    const x = Math.floor(rnd(s, 7, seed) * pw), y = Math.floor(rnd(s, 8, seed) * ph);
    const i = (y * pw + x) * 4; const col = s % 3 ? SEPIA[0] : SEPIA[7];
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
  }
  c.putImageData(img, px0, py0);

  // ---------- 3. the card mount (after toning) ----------
  const mount = '#2a1a10', mountHi = '#3b2416';
  c.fillStyle = mount;
  c.fillRect(0, 0, W, py0); c.fillRect(0, py0 + ph, W, H - py0 - ph); c.fillRect(0, 0, px0, H); c.fillRect(px0 + pw, 0, W - px0 - pw, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inPhoto = x >= px0 && x < px0 + pw && y >= py0 && y < py0 + ph;
    if (!inPhoto && rnd(x, y, 21) > 0.82) { c.fillStyle = mountHi; c.fillRect(x, y, 1, 1); }
  }
  c.fillStyle = PAL.ink; c.fillRect(0, 0, W, 1); c.fillRect(0, H - 1, W, 1); c.fillRect(0, 0, 1, H); c.fillRect(W - 1, 0, 1, H);
  c.fillStyle = '#d4a52a'; // gilt rule around the print
  c.fillRect(px0 - 2, py0 - 2, pw + 4, 1); c.fillRect(px0 - 2, py0 + ph + 1, pw + 4, 1);
  c.fillRect(px0 - 2, py0 - 2, 1, ph + 4); c.fillRect(px0 + pw + 1, py0 - 2, 1, ph + 4);
  c.fillStyle = PAL.ink;
  c.fillRect(px0 - 1, py0 - 1, pw + 2, 1); c.fillRect(px0 - 1, py0 + ph, pw + 2, 1); c.fillRect(px0 - 1, py0 - 1, 1, ph + 2); c.fillRect(px0 + pw, py0 - 1, 1, ph + 2);
  // photo corners
  for (const [cx, cy, sx, sy] of [[px0, py0, 1, 1], [px0 + pw - 1, py0, -1, 1], [px0, py0 + ph - 1, 1, -1], [px0 + pw - 1, py0 + ph - 1, -1, -1]]) {
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5 - a; b++) { c.fillStyle = a + b === 4 ? PAL.ink : '#1c1612'; c.fillRect(cx + sx * a, cy + sy * b, 1, 1); }
  }
  // name plaques on the counter front
  const plaqueH = n <= 4 ? 8 : 9;
  const plaques: { x: number; w: number; y: number; name: string }[] = [];
  for (const s of slots) plaques.push({ x: s.x + 4, w: 40, y: counterTop + 5, name: s.p.name });
  plaques.sort((a, b) => a.x - b.x);
  const plaqueRects: typeof plaques = [];
  for (let i = 0; i < plaques.length; i++) {
    const p = plaques[i], next = plaques[i + 1];
    // shrink widths so neighbours never overlap
    const w = next ? Math.min(p.w, next.x - p.x - 2) : p.w;
    const q = { ...p, w: Math.max(20, w) };
    plaqueRects.push(q);
    c.fillStyle = PAL.ink; c.fillRect(q.x - 1, q.y - 1, q.w + 2, plaqueH + 2);
    c.fillStyle = '#d4a52a'; c.fillRect(q.x, q.y, q.w, plaqueH);
    c.fillStyle = '#f2d36b'; c.fillRect(q.x, q.y, q.w, 1);
    c.fillStyle = '#8a6418'; c.fillRect(q.x, q.y + plaqueH - 1, q.w, 1);
    c.fillStyle = '#6b4a0c'; c.fillRect(q.x + 1, q.y + (plaqueH >> 1), 1, 1); c.fillRect(q.x + q.w - 2, q.y + (plaqueH >> 1), 1, 1);
  }

  // ---------- 4. upscale (crisp) + pixel text at full res ----------
  const [out, o] = makeCanvas(OUT_W, OUT_H);
  o.imageSmoothingEnabled = false;
  o.drawImage(cv, 0, 0, OUT_W, OUT_H);
  await fontsReady();
  const [tl, t] = makeCanvas(OUT_W, OUT_H);
  const SK = (px: number) => `${px}px "Silkscreen", "Pixelify Sans", monospace`;
  const SKB = (px: number) => `700 ${px}px "Silkscreen", "Pixelify Sans", monospace`;
  t.textBaseline = 'middle';
  const text = (s: string, x: number, y: number, col: string, shadow: string | null, align: CanvasTextAlign, step: number) => {
    t.textAlign = align;
    if (shadow) { t.fillStyle = shadow; t.fillText(s, Math.round(x + step), Math.round(y + step)); }
    t.fillStyle = col; t.fillText(s, Math.round(x), Math.round(y));
  };
  // caption
  const cap = `Tonight we ride: ${res.name}`;
  const [capT, capS] = fitText(t, cap, OUT_W - MS * k * 2 - 20, SKB, [40, 32, 24]);
  t.font = SKB(capS);
  text(capT, OUT_W / 2, (py0 * k) / 2, '#f2d36b', PAL.ink, 'center', capS / 8);
  // footer: table code + date + brand
  const fy2 = (py0 + ph + 1) * k + ((H - py0 - ph - 1) * k) / 2;
  const fs = n <= 4 ? 24 : 16;
  t.font = SK(fs);
  text(`Table ${state.code}`, MS * k, fy2, PAL.parch2, PAL.ink, 'left', fs / 8);
  text(fmtDate(new Date()), OUT_W / 2, fy2, PAL.parch2, PAL.ink, 'center', fs / 8);
  text('Nah.', OUT_W - MS * k, fy2, PAL.parch2, PAL.ink, 'right', fs / 8);
  // plaque names
  const ps = n <= 4 ? 24 : 16;
  for (const q of plaqueRects) {
    const [nm, sz] = fitText(t, q.name.toUpperCase(), (q.w - 4) * k, SKB, [ps]);
    t.font = SKB(sz);
    text(nm, (q.x + q.w / 2) * k, (q.y + plaqueH / 2) * k + 1, '#2a1a10', null, 'center', 0);
  }
  hardAlpha(t, OUT_W, OUT_H);
  o.drawImage(tl, 0, 0);
  return out;
}

function PhotoModal({ state, onClose }: { state: RoomState; onClose: () => void }) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [err, setErr] = useState(false);
  const [note, setNote] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const res = state.result!;

  useEffect(() => {
    let alive = true, url = '';
    (async () => {
      try {
        const cv = await renderGroupPhoto(state);
        const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
        if (!blob) throw new Error('toBlob');
        url = URL.createObjectURL(blob);
        const name = `nah-${state.code.toLowerCase()}-${slug(res.name)}.png`;
        let file: File | null = null;
        try { file = new File([blob], name, { type: 'image/png' }); } catch { /* old Safari */ }
        if (alive) { setShot({ blob, url, file, name }); sfx.click(); } else URL.revokeObjectURL(url);
      } catch (e) { console.warn('group photo', e); if (alive) setErr(true); }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    // a photo is a snapshot: take it once per open
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const canShareFile = !!(shot?.file && typeof navigator.canShare === 'function' && (() => { try { return navigator.canShare({ files: [shot.file!] }); } catch { return false; } })());
  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

  const save = () => {
    if (!shot) return;
    sfx.click();
    const a = document.createElement('a');
    a.href = shot.url; a.download = shot.name;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const share = () => {
    if (!shot) return;
    sfx.click();
    if (canShareFile) {
      navigator.share({ files: [shot.file!], title: 'Nah.', text: `Tonight we ride: ${res.name}` }).catch((e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') setNote('Could not share. Try Save image.');
      });
    } else if (canCopy) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': shot.blob })]).then(() => setNote('Copied to clipboard.'), () => setNote('Could not copy. Try Save image.'));
    }
  };

  return (
    <div className="fun-modal" role="dialog" aria-modal="true" aria-label="Group photo" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fun-photo px-box">
        <div className="fun-photo-head">
          <b>Group photo</b>
          <button ref={closeRef} type="button" className="px-btn px-btn-sm fun-x" onClick={() => { sfx.click(); onClose(); }} aria-label="Close">✕</button>
        </div>
        <div className="fun-photo-frame">
          {shot ? <img src={shot.url} alt={`Group photo: the posse around ${res.name}`} width={OUT_W} height={OUT_H} />
            : <div className="fun-photo-dev" aria-busy={!err}>{err ? 'The plate cracked. Try again.' : 'Hold still… developing…'}</div>}
        </div>
        <div className="fun-photo-acts">
          <button type="button" className="px-btn px-btn-sm" disabled={!shot} onClick={save}>Save image</button>
          {(canShareFile || canCopy) && <button type="button" className="px-btn px-btn-sm" disabled={!shot} onClick={share}>{canShareFile ? 'Share' : 'Copy image'}</button>}
          {note && <span className="fun-photo-note" role="status">{note}</span>}
        </div>
      </div>
    </div>
  );
}

export default function GroupPhoto({ state }: RoomProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!state.result) return null;
  return (
    <>
      <button type="button" className="px-btn px-btn-sm fun-btn" onClick={() => { sfx.click(); setOpen(true); }}>
        <PixelSprite draw={CAMERA_ICON.draw} w={CAMERA_ICON.w} h={CAMERA_ICON.h} className="fun-ico" style={{ width: `calc(var(--pt) * ${CAMERA_ICON.w})`, height: `calc(var(--pt) * ${CAMERA_ICON.h})` }} />
        <span>Group photo</span>
      </button>
      {open && createPortal(<PhotoModal state={state} onClose={close} />, document.body)}
    </>
  );
}
