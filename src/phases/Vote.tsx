// Phase 'vote': the table is down to its finalists. Everyone votes how to settle it and picks which finalist they play for.
import { memo, useEffect, useRef, useState } from 'react';
import type { RoomProps } from '../props';
import { FINALES, FINALE_KINDS, type FinaleKind, type Player } from '../../shared/types';
import { useNow } from '../net';
import { sfx } from '../sfx';
import { MiniBust } from '../pixel/BustPreview';
import { PixelCover } from '../pixel/PixelCover';
import { PixelSprite } from '../pixel/PixelCanvas';
import { PAL } from '../pixel/palette';
import { bayer, circle, ellipse } from '../pixel/dither';
import type { DrawFn } from '../pixel/sprites';
import { BUZZ, buzz } from '../scene/haptics';
import './gameplay.css';

/* ---------------- the four little illustrations (40 x 28 art pixels) ---------------- */
const AW = 40, AH = 28;
type R = (x: number, y: number, w: number, h: number, col: string) => void;
const rect = (c: CanvasRenderingContext2D): R => (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
/** night backdrop shared by all four: dithered dark wood wall */
const backdrop = (c: CanvasRenderingContext2D, top: string, bot: string) => {
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    c.fillStyle = y / AH + (bayer(x, y) - 0.5) * 0.35 > 0.55 ? bot : top;
    c.fillRect(x, y, 1, 1);
  }
};

const drawRevolver: DrawFn = (c) => {
  const r = rect(c);
  backdrop(c, PAL.felt1, PAL.felt0);
  const cx = 20, cy = 14, R0 = 11;
  for (let y = -R0; y <= R0; y++) for (let x = -R0; x <= R0; x++) {
    const d = Math.hypot(x, y);
    if (d > R0) continue;
    const l = 0.4 - (x + y) / (R0 * 3.2) - (d / R0) * 0.18 + (bayer(x + 40, y + 40) - 0.5) * 0.16;
    c.fillStyle = d > R0 - 1 ? PAL.metal0 : l > 0.62 ? PAL.metal4 : l > 0.42 ? PAL.metal3 : l > 0.22 ? PAL.metal2 : PAL.metal1;
    c.fillRect(cx + x, cy + y, 1, 1);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const x = Math.round(cx + Math.sin(a) * 6.5), y = Math.round(cy - Math.cos(a) * 6.5);
    circle(c, x, y, 2, PAL.metal0);
    if (k === 0) { r(x - 1, y - 1, 2, 2, PAL.lamp1); r(x - 1, y - 1, 1, 1, PAL.lamp0); } // a live round
  }
  circle(c, cx, cy, 1, PAL.metal0);
  r(cx - 1, 0, 3, 3, PAL.metal0); r(cx, 0, 1, 2, PAL.metal3); // hammer notch on top
};

const drawWhiskey: DrawFn = (c) => {
  const r = rect(c);
  backdrop(c, '#3a0d0b', PAL.red2);
  r(0, 18, AW, 1, PAL.lamp3);            // brass lip
  r(0, 19, AW, 9, PAL.wood3);            // bar top
  r(0, 19, AW, 1, PAL.wood4);
  for (let x = 0; x < AW; x += 9) r(x, 21, 6, 1, PAL.wood4); // varnish streaks
  r(0, 25, AW, 3, PAL.wood2);
  // tumbler
  r(13, 21, 14, 2, 'rgba(0,0,0,.45)');
  r(14, 6, 1, 15, PAL.ink); r(25, 6, 1, 15, PAL.ink); r(14, 20, 12, 1, PAL.ink); r(14, 5, 12, 1, PAL.ink);
  r(15, 6, 10, 14, 'rgba(159,182,196,.45)');
  r(15, 11, 10, 7, PAL.lamp3); r(15, 11, 10, 1, PAL.lamp1); r(19, 14, 4, 2, PAL.lamp2);
  r(15, 18, 10, 2, '#cfe0ea');
  r(16, 12, 3, 3, 'rgba(207,224,234,.85)');
  r(15, 7, 1, 9, 'rgba(255,246,228,.8)'); r(15, 5, 10, 1, '#cfe0ea');
  // the chalk mark further down the bar
  r(31, 22, 7, 1, PAL.white); r(32, 23, 5, 1, PAL.parch2);
};

const drawGolf: DrawFn = (c) => {
  const r = rect(c);
  backdrop(c, PAL.blue1, PAL.blue0);
  r(30, 4, 1, 1, PAL.moon); r(8, 3, 1, 1, PAL.blue3); r(35, 9, 1, 1, PAL.blue3);
  ellipse(c, 20, 22, 19, 6, PAL.felt2);
  ellipse(c, 20, 22, 16, 5, PAL.felt3);
  for (let x = 6; x < 34; x += 3) if (bayer(x, 20) > 0.5) r(x, 20, 1, 1, '#5d6b33');
  ellipse(c, 24, 23, 2, 1, PAL.ink);   // the cup
  r(24, 4, 1, 19, PAL.parch);           // pole
  r(25, 4, 8, 3, PAL.red1); r(25, 7, 5, 2, PAL.red1); r(25, 4, 8, 1, '#c4413a'); // flag
  r(11, 22, 2, 2, PAL.white); r(11, 22, 1, 1, PAL.parch2); // ball
};

const drawHorse: DrawFn = (c) => {
  const r = rect(c);
  backdrop(c, PAL.blue1, PAL.blue0);
  r(33, 3, 2, 2, PAL.moon);
  // rooftop, top-left
  r(0, 6, 15, 2, PAL.wood4); r(0, 8, 13, 6, PAL.wood2); r(0, 6, 15, 1, PAL.lamp3);
  for (let y = 9; y < 14; y += 2) r(0, y, 13, 1, PAL.wood1);
  // the drop: dotted arc
  for (const [x, y] of [[16, 5], [19, 5], [22, 7], [24, 10], [25, 13]]) r(x, y, 1, 1, PAL.parch2);
  // ground
  r(0, 25, AW, 3, PAL.wood1); r(0, 25, AW, 1, PAL.wood3);
  // horse (facing left)
  r(18, 17, 15, 5, PAL.wood3);           // body
  r(18, 17, 15, 1, PAL.wood4);
  r(14, 13, 5, 6, PAL.wood3); r(12, 14, 3, 3, PAL.wood3); r(12, 16, 2, 1, PAL.ink); // neck + head
  r(15, 12, 2, 2, PAL.wood2); r(13, 15, 1, 1, PAL.ink); // ear, eye
  r(17, 14, 2, 4, PAL.ink);              // mane
  for (const lx of [19, 22, 28, 31]) r(lx, 22, 1, 3, PAL.wood2);
  r(33, 17, 2, 5, PAL.ink);              // tail
  r(22, 15, 6, 2, PAL.red1); r(22, 15, 6, 1, '#c4413a'); // saddle
};

const ART: Record<FinaleKind, DrawFn> = { revolver: drawRevolver, slide: drawWhiskey, golf: drawGolf, horse: drawHorse };

/* ---------------- countdown (own component: the per-frame clock never re-renders the board) ---------------- */
function Countdown({ deadline, skew, done }: { deadline: number; skew: number; done: boolean }) {
  const now = useNow(skew, !done);
  const secs = Math.max(0, Math.ceil((deadline - now) / 1000));
  const hot = !done && secs > 0 && secs <= 5;
  useEffect(() => { if (hot) sfx.tick(); }, [secs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (done || !deadline) return null;
  return <div className={`fv-clock ${hot ? 'hot' : ''}`} aria-label={`${secs} seconds left`}>{secs}<small>s</small></div>;
}

const Busts = memo(function Busts({ ps, max }: { ps: Player[]; max: number }) {
  const shown = ps.slice(0, max);
  return (
    <span className="fv-busts">
      {shown.map((p) => <MiniBust key={p.id} p={p} className="fv-bust" />)}
      {ps.length > max && <em>+{ps.length - max}</em>}
    </span>
  );
});

export default function Vote({ state, me, send, skew }: RoomProps) {
  const v = state.vote;
  const picked = v?.picked;
  const nameOf = (a: number) => state.board.find((g) => g.appid === a)?.name ?? state.pool.find((g) => g.appid === a)?.name ?? `App ${a}`;

  // optimistic local echo so the tap feels instant; the server's state wins as soon as it arrives
  const [pend, setPend] = useState<{ kind?: FinaleKind; back?: number }>({});
  const voteKey = v ? JSON.stringify(v.votes[me] ?? '') + ':' + (v.backs[me] ?? '') : '';
  useEffect(() => { setPend({}); }, [voteKey]);
  const myVote = pend.kind ?? v?.votes[me];
  const myBack = pend.back ?? v?.backs[me];

  // the fanfare when the vote is decided (once; not for a late join)
  const fanfared = useRef(0);
  useEffect(() => {
    if (!v?.picked || !v.pickedAt || fanfared.current === v.pickedAt) return;
    fanfared.current = v.pickedAt;
    if (Date.now() + skew - v.pickedAt > 1500) return;
    sfx.drawSting();
    const t = window.setTimeout(() => sfx.stamp(), 380);
    buzz(BUZZ.win);
    return () => clearTimeout(t);
  }, [v?.pickedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return <div className="fv"><div className="fv-title">Settling up…</div></div>;

  const votes: Record<string, FinaleKind> = myVote ? { ...v.votes, [me]: myVote } : v.votes;
  const backs: Record<string, number> = myBack !== undefined ? { ...v.backs, [me]: myBack } : v.backs;
  const voters = state.players.filter((p) => p.connected || p.bot || votes[p.id]);
  const byKind = (k: FinaleKind) => voters.filter((p) => votes[p.id] === k);
  const deciding = voters.filter((p) => !votes[p.id]);
  const iVote = state.players.some((p) => p.id === me);

  const vote = (k: FinaleKind) => {
    if (picked || !iVote) return;
    sfx.click(); buzz([8]);
    setPend((x) => ({ ...x, kind: k }));
    send({ t: 'finaleVote', kind: k });
  };
  const back = (a: number) => {
    if (picked || myBack === a) return;
    sfx.cardSlap();
    setPend((x) => ({ ...x, back: a }));
    send({ t: 'back', appid: a });
  };

  return (
    <div className={`fv n${v.games.length} ${picked ? 'decided' : ''}`} role="main" aria-label="Finale vote">
      <div className="fv-head">
        <div className="fv-title">{picked ? <>Settled: <b>{FINALES[picked].label}</b></> : 'How do we settle it?'}</div>
        <Countdown deadline={v.deadline} skew={skew} done={!!picked} />
      </div>

      <div className="fv-games" role="radiogroup" aria-label="Play for">
        <span className="fv-games-lbl">Play for</span>
        {v.games.map((a) => {
          const backers = voters.filter((p) => backs[p.id] === a);
          const mine = myBack === a;
          return (
            <button key={a} type="button" role="radio" aria-checked={mine} className={`fv-game ${mine ? 'mine' : ''}`} disabled={!!picked} onClick={() => back(a)} onPointerEnter={() => sfx.hover()}>
              <span className="fv-game-art"><PixelCover appid={a} name={nameOf(a)} kind="box" /></span>
              <span className="fv-game-txt">
                <span className="fv-game-name">{nameOf(a)}</span>
                <Busts ps={backers} max={4} />
              </span>
              {mine && <span className="fv-game-me">YOU</span>}
            </button>
          );
        })}
      </div>

      <div className="fv-cards">
        {FINALE_KINDS.map((k) => {
          const mine = myVote === k;
          const ps = byKind(k);
          const win = picked === k, lose = !!picked && !win;
          return (
            <button
              key={k} type="button"
              className={`fv-card fv-${k} ${mine ? 'mine' : ''} ${win ? 'win' : ''} ${lose ? 'lose' : ''}`}
              aria-pressed={mine}
              disabled={!!picked}
              onClick={() => vote(k)}
              onPointerEnter={() => { if (!picked) sfx.hover(); }}
            >
              <PixelSprite draw={ART[k]} w={AW} h={AH} className="fv-art" />
              <span className="fv-card-txt">
                <span className="fv-lbl">{FINALES[k].label}</span>
                <span className="fv-blurb">{FINALES[k].blurb}</span>
              </span>
              <span className="fv-tally">
                <b>{ps.length}</b>
                <Busts ps={ps} max={4} />
              </span>
              {mine && !picked && <span className="fv-lock">Locked in ✓</span>}
              {win && <span className="fv-stamp">PICKED</span>}
            </button>
          );
        })}
      </div>

      <div className="fv-foot" aria-live="polite">
        {picked ? <span className="fv-go">Saddle up…</span>
          : deciding.length ? <><span>Deciding:</span><Busts ps={deciding} max={6} /><span className="fv-names">{deciding.map((p) => (p.id === me ? 'you' : p.name)).join(', ')}</span></>
          : <span>Everyone's in.</span>}
      </div>
    </div>
  );
}
