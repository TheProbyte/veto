import { DurableObject } from 'cloudflare:workers';
import type { BadgeId, BoardGame, FinaleKind, Intent, Launch, Mini, MiniResult, Phase, Player, PoolGame, PosseRecord, ProfileStats, RoomEvent, RoomState, ServerMsg, Settings, ShotEvent } from '../shared/types';
import { DEFAULT_SETTINGS, DRAFT_BURNS, DRAFT_HAND, EMOTES, FINALE_KINDS, LOOK_COUNTS, lookUnlocked, randomLook, type EmoteId, type Look } from '../shared/types';
import { EXPLAIN_MS } from '../shared/voiced';
import { SLIDE_ANIM_MS, SLIDE_INTRO_MS, SLIDE_RESULT_MS, SLIDE_TURN_MS, slideDist, slideMark, slideOutcome } from './slide';
import { NARRATOR, pickLine, type NarrKey } from '../shared/narrator';
import { lastWords } from './lastwords';
import { saddleX, simulate } from '../src/phases/horse/sim';
import { ownedGames, playerSummary, resolveSteamId, storeBits, type Env, type OwnedGame } from './steam';

const SHOT_PAUSE = 3200; // ms to let the shot FX + the game's last words land before the next fuse starts
const SPIN_MS = 6500;
const NARR_GAP = 2500;
const VOTE_MS = 25_000;      // finale vote window (plus the how_vote explanation when it plays)
const VOTE_PICK_MS = 2_500;  // the picked finale is shown this long before it starts
const MINI_INTRO_MS = 2_500; // mini: play opens after the intro line (plus the how_* explanation when it plays)
const MINI_MS: Record<Mini['kind'], number> = { slide: 25_000, golf: 90_000, horse: 30_000 };
const MINI_RESULT_MS = 3_500; // mini winner shown this long before the result screen
const STALE_MS = 2_500;       // cosmetic jobs this overdue are dropped (e.g. reloaded from storage after hibernation)
const NARR_HIGH = 6;
// higher wins when several fire at once; >= NARR_HIGH may cut into the 2.5s throttle window
const NARR_PRI: Partial<Record<NarrKey, number>> = {
  kill: 1, crack: 2, misfire: 2, fuse_low: 2, first_blood: 3, spree: 4, slowmo: 5,
  draw: 6, cylinder: 6, rematch: 6, ricochet: 7, revenge: 8, duel: 7, duel_foul: 8, duel_win: 8, result: 9, repeat: 9,
  slide: 7, slide_fall: 7, slide_close: 7, slide_win: 8, vote: 7, golf: 7, horse: 7, sheriff: 6, pardon: 7, jail: 6, ousted: 8,
  draft: 6, trade: 4, burn: 3, saddle: 9, straggler: 7,
  how_lobby: 6, how_nominate: 6, how_draft: 6, how_veto: 6, how_star: 6, how_slide: 6, how_cylinder: 6, how_duel: 7, how_result: 6,
  how_vote: 6, how_golf: 6, how_horse: 6,
};
// phase-change cues always cut in (even over an equal/higher line still ringing)
const CUES = new Set<NarrKey>(['how_lobby', 'how_nominate', 'how_draft', 'how_veto', 'how_star', 'how_slide', 'how_cylinder', 'how_duel', 'how_result', 'how_vote', 'how_golf', 'how_horse', 'vote', 'golf', 'horse', 'draw', 'rematch', 'cylinder', 'duel', 'duel_win', 'duel_foul', 'result', 'repeat', 'slide', 'slide_win', 'saddle', 'ousted', 'draft']);
const BOT_NAMES = ['Dusty Pete', 'One-Eye Jack', 'Calamity Sue', 'Tumbleweed Tim', 'Sagebrush Sal', 'Two-Bit Earl', 'Whiskey Nell', 'Slim Pickens', 'Rattlesnake Ray', 'Biscuit Bill'];
const FAKE_LIB: [number, string][] = [[730, 'Counter-Strike 2'], [252490, 'Rust'], [892970, 'Valheim'], [1966720, 'Lethal Company'],
  [548430, 'Deep Rock Galactic'], [105600, 'Terraria'], [413150, 'Stardew Valley'], [632360, 'Risk of Rain 2'], [739630, 'Phasmophobia'],
  [1086940, "Baldur's Gate 3"], [553850, 'HELLDIVERS 2'], [945360, 'Among Us'], [322330, "Don't Starve Together"], [620, 'Portal 2'],
  [550, 'Left 4 Dead 2'], [1145360, 'Hades'], [381210, 'Dead by Daylight'], [1623730, 'Palworld']];

const shuffle = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** untrusted number list: at most `max` finite numbers, clamped, 2 decimals */
const nums = (a: unknown[], max: number) => a.slice(0, max).map(Number).filter(Number.isFinite).map((v) => Math.round(clamp(v, -1e6, 1e6) * 100) / 100);
// control chars, zero-width and bidi overrides (no regex literals: keeps the source ASCII)
const invisible = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
const isKill = (e: ShotEvent) => e.kind === 'hit' || e.kind === 'misfire';

class Bad extends Error {}
/** game actions held while the Barkeep explains a step (chat, emotes, looks, settings are not) */
const HELD = new Set<Intent['t']>(['nominate', 'draftPlay', 'draftBurn', 'draftOffer', 'draftAccept', 'pitch', 'react',
  'beginVeto', 'fire', 'aim', 'shield', 'slide', 'bang', 'pardon', 'jail', 'oust', 'start', 'finaleVote', 'back', 'golfDone', 'horseDone']);

/** Timed server work (bots, fuse warnings, delayed narration). All driven by the single DO alarm. */
interface Job {
  at: number;
  k: 'bnom' | 'baim' | 'bfire' | 'bstar' | 'bbang' | 'bemote' | 'fuse' | 'narr' | 'bslide' | 'boffer' | 'bpardon' | 'bjail' | 'bready' | 'bvote' | 'bmini';
  ph: Phase; // dropped as soon as the room leaves this phase
  pid?: string;
  seq?: number; // turn sequence (veto turn jobs)
  appid?: number;
  n?: number; // bang reaction ms
  emote?: EmoteId;
  key?: NarrKey;
}
// cosmetic jobs: running them doesn't need a storage write
const TRANSIENT = new Set<Job['k']>(['baim', 'bemote', 'fuse', 'narr']);

/** Server-only state, persisted alongside RoomState under the same key but never broadcast. */
interface X {
  jobs: Job[];
  seq: number;
  turnStart: number;
  fireMs: Record<string, number[]>; // human: ms from turn start to fire, this round
  misfires: string[];
  finaleAt: number; // veto: when to roll into the finale (after the last stamp lands)
  slideAt: number; // slide: when to judge the round (after the last glass stops)
  hands: Record<string, number[]>; // draft: PRIVATE hands (only ever sent to their owner)
  deck: number[]; // draft: remaining deck, top first
  offerSeq: number;
  sheriffRot: number; // sheriff rotation counter
  explained: string[]; // how_* keys already explained at this table (each plays once; resetRecord replays them)
  recentLines: Record<string, number>; // narration line id -> when it last played (cooldown against repeats)
  skips: string[]; // humans who tapped "skip" on the current explanation (reset when a new one starts)
  miniAt: number; // mini: when to judge (everyone's in; slide waits for the last glass to stop)
}
const freshX = (): X => ({ jobs: [], seq: 0, turnStart: 0, fireMs: {}, misfires: [], finaleAt: 0, slideAt: 0, hands: {}, deck: [], offerSeq: 0, sheriffRot: 0, explained: [], recentLines: {}, skips: [], miniAt: 0 });
const emptyRecord = (): PosseRecord => ({ rounds: 0, wins: [], vetoers: [], noms: [], streaks: [] });

function fresh(code: string): RoomState {
  return {
    code, phase: 'lobby', players: [], pool: [], poolLoading: false, pitches: [], board: [],
    settings: { ...DEFAULT_SETTINGS }, record: emptyRecord(),
    turnOrder: [], turnIdx: 0, turnDeadline: 0, shots: [], history: [], now: 0,
  };
}

export class Room extends DurableObject<Env> {
  s!: RoomState;
  x!: X;
  libs = new Map<string, OwnedGame[]>();
  poolGen = 0;
  alarmAt = 0; // last alarm we set, so we don't rewrite it on every broadcast (storage writes count on the free plan)
  // in-memory only (fine to lose on eviction)
  narrPending?: { key: NarrKey; pri: number; id?: string };
  narrAt = 0;
  narrPri = 0;
  narrId?: string;
  rate = new Map<string, number>();
  statsLoad = new Map<string, Promise<void>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const raw: RoomState & { _x?: X } = (await ctx.storage.get<RoomState & { _x?: X }>('s')) ?? fresh('');
      this.x = { ...freshX(), ...(raw._x ?? {}) };
      // cosmetic jobs that already ran aren't removed from storage (no write for them): never replay them after a reload
      const now = Date.now();
      this.x.jobs = this.x.jobs.filter((j) => !TRANSIENT.has(j.k) || j.at > now - STALE_MS);
      delete raw._x;
      const s = (this.s = raw);
      s.pitches ??= [];
      s.settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
      s.record ??= emptyRecord();
      for (const g of s.pool) g.hoursBy ??= {};
      if (s.result) s.result.badges ??= {};
      for (const g of s.board) {
        const sb = g.shieldedBy as unknown;
        if (typeof sb === 'string') g.shieldedBy = [sb];
      }
      this.alarmAt = (await ctx.storage.getAlarm()) ?? 0;
    });
    // answered by the runtime without waking the object: keeps phone sockets alive while the room hibernates
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    if (!this.s.code) this.s.code = req.headers.get('x-room') ?? '';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---------- plumbing ----------
  pidOf(ws: WebSocket): string | undefined {
    return (ws.deserializeAttachment() as { pid?: string } | null)?.pid;
  }
  me(pid: string): Player {
    const p = this.s.players.find((x) => x.id === pid);
    if (!p) throw new Bad('Sit down first.');
    return p;
  }
  isHost(pid: string) {
    const host = this.s.players.find((p) => p.host);
    // if the host walked out, any human still at the table can run the show
    if (host?.id === pid) return true;
    if (host?.connected) return false;
    return !!this.s.players.find((p) => p.id === pid && !p.bot);
  }
  humansOnline() { return this.s.players.some((p) => !p.bot && p.connected); }
  alive() { return this.s.board.filter((g) => g.alive); }
  /** how many games remain when the shooting stops */
  threshold() {
    return this.s.settings.cylinderAt === 2 ? 2 : 3; // the finale vote opens at this many games
  }

  /** persist=false for cosmetic/transient updates (aim moves, partial pool loads) to save storage writes */
  broadcast(persist = true) {
    const s = this.s, x = this.x;
    s.now = Date.now();
    if (s.draft) {
      s.draft.hand = [];
      s.draft.handCounts = Object.fromEntries(Object.entries(x.hands).map(([k, h]) => [k, h.length]));
      s.draft.deck = x.deck.length;
    }
    this.schedule();
    if (persist) this.ctx.storage.put('s', { ...s, _x: x });
    // tin stars are private: everyone gets a redacted board; star owners get their own ids back
    const owners = new Set<string>();
    const strip = (g: BoardGame): BoardGame => {
      if (!g.shieldedBy) return g;
      const { shieldedBy, ...r } = g;
      return r;
    };
    for (const g of s.board) g.shieldedBy?.forEach((o) => owners.add(o));
    // draft hands are private too: serialize the draft (minus hand) once and splice each player's own hand in at the end
    const base = JSON.stringify({ ...s, board: s.board.map(strip), draft: undefined }); // serialize once, not once per player
    const draftHead = s.draft ? JSON.stringify({ ...s.draft, hand: undefined }).slice(0, -1) + ',"hand":' : '';
    const withDraft = (json: string, pid: string) => (draftHead ? `${json.slice(0, -1)},"draft":${draftHead}${JSON.stringify(x.hands[pid] ?? [])}}}` : json);
    const variants = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const pid = this.pidOf(ws);
      if (!pid) continue;
      let json = variants.get(pid) ?? '';
      if (!json) {
        json = owners.has(pid)
          ? JSON.stringify({ ...s, draft: undefined, board: s.board.map((g) => (g.shieldedBy?.includes(pid) ? { ...strip(g), shieldedBy: [pid] } : strip(g))) })
          : base;
        json = withDraft(json, pid);
        variants.set(pid, json);
      }
      try { ws.send(`{"t":"state","you":${JSON.stringify(pid)},"state":${json}}`); } catch {}
    }
    this.flushNarr();
  }
  /** transient events: never stored */
  event(ev: RoomEvent) {
    const json = JSON.stringify(ev);
    for (const ws of this.ctx.getWebSockets()) {
      if (!this.pidOf(ws)) continue;
      try { ws.send(json); } catch {}
    }
  }
  /** `id` forces a specific line of that key */
  narr(key: NarrKey, id?: string) {
    const pri = NARR_PRI[key] ?? 1;
    if (!this.narrPending || pri > this.narrPending.pri) this.narrPending = { key, pri, id };
  }
  flushNarr() {
    const n = this.narrPending;
    if (!n) return;
    this.narrPending = undefined;
    const now = Date.now();
    if (now - this.narrAt < NARR_GAP && !(n.pri >= NARR_HIGH && (n.pri > this.narrPri || CUES.has(n.key)))) return;
    const line = (n.id && NARRATOR[n.key].lines.find((l) => l.id === n.id)) || pickLine(n.key, this.narrId);
    // cooldown: don't repeat the same recorded line within 90 s (phase cues and explanations excepted)
    const last = this.x.recentLines[line.id] ?? 0;
    if (!CUES.has(n.key) && now - last < 90_000) return;
    this.x.recentLines[line.id] = now;
    if (n.key.startsWith('how_')) { this.s.explainText = line.text; this.s.explainFrom = now; }
    this.narrAt = now; this.narrPri = n.pri; this.narrId = line.id;
    this.event({ t: 'narrate', id: line.id, text: line.text, at: now });
  }
  job(j: Job) { this.x.jobs.push(j); }
  /** the Barkeep explains a step (settings.explain), a moment after the phase cue so both are heard */
  /** shootout explanation (first shootout at this table): the shot rules, then the hidden star. Returns ms to hold the first turn. */
  vetoExplain(delay: number): number {
    const a = this.explain('how_veto', delay, 'veto');
    const b = a ? this.explain('how_star', delay + a, 'veto') : this.explain('how_star', delay, 'veto');
    return a || b ? delay + a + b : 0;
  }
  /**
   * The Barkeep explains a step, once per table (settings.explain). Everyone is held (explainUntil) until he's done.
   * Returns the hold length in ms from `delay` (0 when not explaining).
   */
  explain(key: NarrKey, delay: number, ph = this.s.phase): number {
    if (!this.s.settings.explain || this.x.explained.includes(key)) return 0;
    this.x.explained.push(key);
    this.x.skips = []; // a new explanation: everyone has to skip again
    const ms = EXPLAIN_MS[key] ?? 5000;
    const s = this.s, now = Date.now();
    // queue behind an explanation that's still running (e.g. the star tip right after the shot rules)
    const from = Math.max(now + delay, s.explainUntil && s.explainUntil > now ? s.explainUntil : 0);
    if (!s.explainUntil || s.explainUntil <= now) { s.explainFrom = from; s.explainText = NARRATOR[key].lines[0].text; }
    s.explainUntil = Math.max(s.explainUntil ?? 0, now + delay + ms);
    this.job({ at: now + delay, k: 'narr', ph, key });
    return ms;
  }

  schedule() {
    const s = this.s, x = this.x;
    x.jobs = x.jobs.filter((j) => j.ph === s.phase);
    const ts = x.jobs.map((j) => j.at);
    if (s.phase === 'veto') {
      if (this.alive().length <= this.threshold()) ts.push(x.finaleAt || Date.now());
      else if (s.turnDeadline) ts.push(s.turnDeadline);
    } else if (s.phase === 'roulette' && s.roulette) {
      ts.push(s.roulette.startedAt + s.roulette.duration + 1500);
    } else if (s.phase === 'duel' && s.duel) {
      ts.push(s.duel.decidedAt ? s.duel.decidedAt + 3000 : s.duel.drawAt + 4000);
    } else if (s.phase === 'slide' && s.slide) {
      const sl = s.slide;
      const t = sl.decidedAt ? sl.decidedAt + SLIDE_RESULT_MS : x.slideAt || sl.turnDeadline;
      if (t) ts.push(t);
    } else if (s.phase === 'vote' && s.vote) {
      ts.push(s.vote.picked ? (s.vote.pickedAt ?? 0) + VOTE_PICK_MS : s.vote.deadline);
    } else if (s.phase === 'mini' && s.mini) {
      const m = s.mini;
      ts.push(m.decidedAt ? m.decidedAt + MINI_RESULT_MS : x.miniAt || m.deadline);
    }
    const at = ts.length ? Math.min(...ts) : 0;
    if (at === this.alarmAt) return;
    this.alarmAt = at;
    if (at) this.ctx.storage.setAlarm(at);
    else this.ctx.storage.deleteAlarm();
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let i: Intent;
    try { i = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
    try {
      if (i.t === 'hello') return this.hello(ws, i.pid, i.name);
      const pid = this.pidOf(ws);
      if (!pid) throw new Bad('Say hello first.');
      await this.handle(pid, i);
    } catch (e) {
      if (!(e instanceof Bad)) console.error('intent failed', i?.t, e);
      const message = e instanceof Error ? e.message : 'Something broke.';
      try { ws.send(JSON.stringify({ t: 'error', message } satisfies ServerMsg)); } catch {}
    }
  }

  async webSocketClose(ws: WebSocket) { this.dropped(ws); }
  async webSocketError(ws: WebSocket) { this.dropped(ws); }
  dropped(ws: WebSocket) {
    const pid = this.pidOf(ws);
    if (!pid) return;
    const still = this.ctx.getWebSockets().some((w) => w !== ws && this.pidOf(w) === pid);
    const p = this.s.players.find((x) => x.id === pid);
    if (p && !still && p.connected) {
      p.connected = false;
      // don't make everyone wait on an empty chair
      if (this.s.phase === 'veto' && this.s.turnOrder[this.s.turnIdx] === pid && this.s.turnDeadline) {
        this.s.turnDeadline = Math.min(this.s.turnDeadline, Date.now() + 4000);
      }
      const sl = this.s.slide;
      if (this.s.phase === 'slide' && sl && !sl.decidedAt && sl.turn < sl.order.length && sl.champs[sl.order[sl.turn]] === pid && sl.turnDeadline) {
        sl.turnDeadline = Math.min(sl.turnDeadline, Math.max(Date.now(), sl.turnDeadline - SLIDE_TURN_MS) + 4000);
      }
      this.narr('leave');
      this.checkVote();
      this.checkMini();
      this.broadcast();
    }
  }

  // ---------- profiles ----------
  profile(pid: string) { return this.env.PROFILE.get(this.env.PROFILE.idFromName('p:' + pid)); }
  loadStats(pid: string) {
    const p = (async () => {
      try {
        const r = await this.profile(pid).fetch('https://profile/');
        const st = (await r.json()) as ProfileStats;
        const q = this.s.players.find((x) => x.id === pid);
        if (q) { q.stats = st; this.broadcast(false); }
      } catch (e) {
        console.error('profile load failed', e);
      } finally {
        this.statsLoad.delete(pid);
      }
    })();
    this.statsLoad.set(pid, p);
    this.ctx.waitUntil(p);
  }
  pushStats(deltas: Map<string, Partial<ProfileStats>>) {
    if (!deltas.size) return;
    this.ctx.waitUntil((async () => {
      let any = false;
      await Promise.all([...deltas].map(async ([pid, delta]) => {
        try {
          const r = await this.profile(pid).fetch('https://profile/', { method: 'POST', body: JSON.stringify({ delta }) });
          const st = (await r.json()) as ProfileStats;
          const q = this.s.players.find((x) => x.id === pid);
          if (q) { q.stats = st; any = true; }
        } catch (e) {
          console.error('profile update failed', e);
        }
      }));
      if (any) this.broadcast(false);
    })());
  }

  // ---------- intents ----------
  hello(ws: WebSocket, pid: string, name: string) {
    if (!pid || typeof pid !== 'string' || pid.length > 64 || pid.startsWith('bot:')) throw new Bad('Bad hello.');
    name = String(name || 'Stranger').trim().slice(0, 20) || 'Stranger';
    let p = this.s.players.find((x) => x.id === pid);
    if (!p) {
      const freshRoom = !this.s.players.length && !this.s.history.length;
      const taken = new Set(this.s.players.map((x) => x.seat));
      let seat = -1;
      for (let k = 0; k < 8; k++) if (!taken.has(k)) { seat = k; break; }
      if (seat < 0) {
        // evict an offline, unlinked ghost (or a bot) if the table is full
        const ghost = this.s.players.find((x) => !x.connected && !x.steam) ?? this.s.players.find((x) => x.bot);
        if (!ghost) throw new Bad('The table is full, partner.');
        seat = ghost.seat;
        this.removePlayer(ghost);
      }
      p = {
        id: pid, name, seat, look: (seat * 3 + Math.floor(Math.random() * 8)) % 8,
        shieldUsed: false, connected: true, host: !this.s.players.some((x) => x.host),
      };
      this.s.players.push(p);
      this.narr(freshRoom ? 'open' : 'join');
      if (freshRoom) this.explain('how_lobby', 3600);
    } else if (!p.connected) {
      this.narr('back');
    }
    p.name = name;
    p.connected = true;
    if (this.s.draft && this.s.phase === 'nominate' && !this.x.hands[pid]) this.dealTo(pid);
    ws.serializeAttachment({ pid });
    this.loadStats(pid);
    this.broadcast();
  }

  limited(key: string, ms: number) {
    const now = Date.now();
    if (now - (this.rate.get(key) ?? 0) < ms) return true;
    this.rate.set(key, now);
    if (this.rate.size > 200) this.rate.delete(this.rate.keys().next().value!);
    return false;
  }

  async handle(pid: string, i: Intent) {
    const s = this.s;
    if (HELD.has(i.t) && s.explainUntil && Date.now() < s.explainUntil - 200) throw new Bad('Hold up. Listen to the Barkeep.');
    switch (i.t) {
      case 'link': return this.link(pid, String(i.profile ?? ''));
      case 'style': {
        const p = this.me(pid);
        if (!p.stats) await this.statsLoad.get(pid);
        const st = {} as Look;
        for (const k of Object.keys(LOOK_COUNTS) as (keyof Look)[]) {
          const v = Number((i.style as Partial<Look> | undefined)?.[k]);
          if (!Number.isInteger(v) || v < 0 || v >= LOOK_COUNTS[k]) throw new Bad('That outfit is not in the store.');
          if (!lookUnlocked(k, v, p.stats)) throw new Bad("You haven't earned that one yet, partner.");
          st[k] = v;
        }
        if (!p.style) this.narr('dress');
        p.style = st;
        this.broadcast();
        return;
      }
      case 'unlink': {
        const p = this.me(pid);
        p.steam = undefined; p.linkError = undefined;
        this.libs.delete(pid);
        await this.ctx.storage.delete(`lib:${pid}`);
        this.broadcast();
        return this.recomputePool();
      }
      case 'resetRecord': {
        if (!this.isHost(pid)) throw new Bad('Only the host can wipe the slate.');
        if (s.phase !== 'lobby' && s.phase !== 'nominate' && s.phase !== 'result') throw new Bad('Finish the round first.');
        s.history = [];
        s.record = emptyRecord();
        this.x.explained = [];
        if (s.result) { s.result.repeatCount = 0; s.result.neverSurvive = undefined; }
        this.broadcast();
        return;
      }
      case 'settings': {
        if (s.phase !== 'lobby' && s.phase !== 'nominate') throw new Bad('Rules are set once the shooting starts.');
        if (!this.isHost(pid)) throw new Bad('Only the host sets the house rules.');
        const n = (i.settings ?? {}) as Partial<Settings>;
        const st = { ...s.settings };
        if (n.turnSecs !== undefined) {
          const v = Math.round(Number(n.turnSecs));
          if (!Number.isFinite(v)) throw new Bad('Bad fuse length.');
          st.turnSecs = clamp(v, 10, 90);
        }
        if (n.picks !== undefined) {
          const v = Math.round(Number(n.picks));
          if (!Number.isFinite(v)) throw new Bad('Bad pick count.');
          st.picks = clamp(v, 1, 5);
        }
        if (n.finale !== undefined) {
          if (n.finale !== 'slide' && n.finale !== 'cylinder' && n.finale !== 'duel' && n.finale !== 'last') throw new Bad('Unknown finale.');
          st.finale = n.finale;
        }
        if (n.cylinderAt !== undefined) {
          const v = Number(n.cylinderAt);
          if (v !== 2 && v !== 3) throw new Bad('Cylinder spins at 2 or 3.');
          st.cylinderAt = v;
        }
        if (n.nominations !== undefined) {
          if (n.nominations !== 'browse' && n.nominations !== 'draft') throw new Bad('Browse or draft, partner.');
          st.nominations = n.nominations;
        }
        if (n.sheriff !== undefined) {
          if (typeof n.sheriff !== 'boolean') throw new Bad('Sheriff on or off.');
          st.sheriff = n.sheriff;
        }
        if (n.explain !== undefined) {
          if (typeof n.explain !== 'boolean') throw new Bad('Explain on or off.');
          st.explain = n.explain;
          if (!n.explain) { // turned off mid-explanation: let everyone go, and drop the explanations still queued
            s.explainUntil = undefined;
            this.x.jobs = this.x.jobs.filter((j) => !(j.k === 'narr' && j.key?.startsWith('how_')));
          }
        }
        const flip = st.nominations !== s.settings.nominations;
        s.settings = st;
        if (flip && s.phase === 'nominate') {
          if (st.nominations === 'draft') this.dealDraft();
          else this.clearDraft();
        }
        this.broadcast();
        return;
      }
      case 'kick': {
        if (!this.isHost(pid)) throw new Bad('Only the host can show folks the door.');
        const t = s.players.find((p) => p.id === i.pid);
        if (!t) throw new Bad('Nobody by that name here.');
        if (t.id === pid) throw new Bad("You can't kick yourself, partner.");
        if (!t.bot && t.connected) throw new Bad("They're still at the table. Only empty chairs and bots get kicked.");
        this.removePlayer(t);
        this.narr('kick');
        this.broadcast();
        return this.recomputePool();
      }
      case 'bots': {
        if (s.phase !== 'lobby') throw new Bad('Hire hands in the lobby.');
        if (!this.isHost(pid)) throw new Bad('Only the host hires hands.');
        const n = Math.floor(Number(i.n));
        if (!Number.isFinite(n) || n < 0 || n > 3) throw new Bad('1 to 3 bots at a time.');
        if (n === 0) {
          for (const b of s.players.filter((p) => p.bot)) this.removePlayer(b);
        } else {
          const added = await this.addBots(pid, n);
          if (!added) throw new Bad('No empty chairs.');
          this.narr('bots');
        }
        this.broadcast();
        return this.recomputePool();
      }
      case 'emote': {
        this.me(pid);
        if (typeof i.emote !== 'string' || !Object.hasOwn(EMOTES, i.emote)) throw new Bad('Unknown emote.');
        if (this.limited('e:' + pid, 1200)) return;
        this.event({ t: 'emote', pid, emote: i.emote, at: Date.now() });
        return;
      }
      case 'say': return; // chat text was removed from the client: accepted, dropped silently
      case 'skipExplain': return this.skipExplain(pid);
      case 'finaleVote': {
        const v = s.vote;
        if (s.phase !== 'vote' || !v) throw new Bad('No vote right now.');
        if (v.picked) throw new Bad('Too late, partner. It\u2019s decided.');
        this.me(pid);
        const kind = i.kind as FinaleKind;
        if (!FINALE_KINDS.includes(kind)) throw new Bad('Unknown finale.');
        if (v.votes[pid] === kind) return;
        v.votes[pid] = kind;
        this.checkVote();
        this.broadcast();
        return;
      }
      case 'back': {
        const appid = Number(i.appid);
        this.me(pid);
        if (s.phase === 'vote' && s.vote) {
          if (s.vote.picked) throw new Bad('Too late to switch sides.');
          if (!s.vote.games.includes(appid)) throw new Bad('Only a finalist can be backed.');
          s.vote.backs[pid] = appid;
        } else if (s.phase === 'mini' && s.mini) {
          const m = s.mini;
          if (!m.players.includes(pid)) throw new Bad("You're watching this one.");
          if (m.decidedAt || m.results[pid]) throw new Bad('Too late to switch sides.');
          if (!m.games.includes(appid)) throw new Bad('Only a finalist can be backed.');
          m.backs[pid] = appid;
        } else throw new Bad('Nothing to back right now.');
        this.broadcast();
        return;
      }
      case 'golfDone': {
        const m = this.miniFor(pid, 'golf');
        const strokes = Number(i.strokes), ms = Number(i.ms);
        if (!Number.isFinite(strokes) || !Number.isFinite(ms)) throw new Bad('Bad scorecard.');
        this.miniGolf(m, pid, strokes, ms);
        this.broadcast();
        return;
      }
      case 'horseDone': {
        const m = this.miniFor(pid, 'horse');
        const score = Number(i.score);
        if (!Number.isFinite(score)) throw new Bad('Bad landing.');
        this.miniHorse(m, pid, score, Array.isArray(i.inputs) ? i.inputs : []);
        this.broadcast();
        return;
      }
      case 'miniMove': {
        const m = s.mini;
        if (s.phase !== 'mini' || !m || m.decidedAt || !m.players.includes(pid)) return;
        if (!Array.isArray(i.data) || this.limited('m:' + pid, 120)) return;
        this.event({ t: 'mini', pid, data: nums(i.data, 16), at: Date.now() });
        return;
      }
      case 'start': {
        if (s.phase !== 'lobby') throw new Bad('Already dealt.');
        if (!this.isHost(pid)) throw new Bad('Only the host deals.');
        if (!s.players.some((p) => p.steam && !p.steam.private)) throw new Bad('Nobody has a public library linked yet.');
        s.phase = 'nominate';
        this.openNominations();
        this.broadcast();
        return;
      }
      case 'nominate': {
        if (s.phase !== 'nominate') throw new Bad('Not tossing games right now.');
        const b = s.board.find((x) => x.appid === i.appid);
        const pitched = s.pitches.some((x) => x.appid === i.appid);
        if (b?.by.includes(pid)) {
          b.by = b.by.filter((x) => x !== pid);
          if (!b.by.length) s.board = s.board.filter((x) => x !== b);
          // pulling a played card back puts it in your hand again
          if (s.draft && !pitched && b.tier !== 'pitch') (this.x.hands[pid] ??= []).push(b.appid);
        } else {
          if (s.draft && !pitched) throw new Bad('Play a card from your hand.');
          this.addNom(pid, i.appid);
        }
        this.broadcast();
        return;
      }
      case 'draftPlay': {
        const d = this.draftFor(pid);
        const appid = Number(i.appid);
        if (!d.includes(appid)) throw new Bad("That card ain't in your hand.");
        this.addNom(pid, appid); // throws at the pick limit before the card leaves the hand
        this.dropCard(pid, appid);
        this.broadcast();
        return;
      }
      case 'draftBurn': {
        const d = this.draftFor(pid);
        const appid = Number(i.appid);
        if (!d.includes(appid)) throw new Bad("That card ain't in your hand.");
        const used = s.draft!.burns[pid] ?? 0;
        if (used >= DRAFT_BURNS) throw new Bad(DRAFT_BURNS === 1 ? 'You already burned a card.' : `Only ${DRAFT_BURNS} burns apiece.`);
        s.draft!.burns[pid] = used + 1;
        this.dropCard(pid, appid);
        this.draw(pid);
        this.narr('burn');
        this.broadcast();
        return;
      }
      case 'draftOffer': {
        const d = this.draftFor(pid);
        const appid = Number(i.appid);
        const to = String(i.to ?? '');
        if (!d.includes(appid)) throw new Bad("That card ain't in your hand.");
        if (to === pid || !this.x.hands[to] || !s.players.some((p) => p.id === to)) throw new Bad('Nobody to trade with there.');
        const offers = s.draft!.offers;
        if (offers.some((o) => o.from === pid && o.give === appid)) throw new Bad('Already offered that card.');
        if (offers.filter((o) => o.from === pid).length >= 3) throw new Bad('Three offers on the table already.');
        const o = { id: ++this.x.offerSeq, from: pid, to, give: appid, at: Date.now() };
        offers.push(o);
        if (s.players.find((p) => p.id === to)?.bot) this.job({ at: Date.now() + rnd(2000, 5000), k: 'boffer', ph: 'nominate', pid: to, n: o.id });
        this.broadcast();
        return;
      }
      case 'draftAccept': {
        const d = this.draftFor(pid);
        this.acceptOffer(pid, Number(i.offer), Number(i.give), d);
        this.broadcast();
        return;
      }
      case 'draftDecline': {
        this.draftFor(pid);
        const offers = s.draft!.offers;
        const o = offers.find((x) => x.id === Number(i.offer));
        if (!o) throw new Bad('That offer is gone.');
        if (o.to !== pid && o.from !== pid) throw new Bad("That ain't your deal.");
        s.draft!.offers = offers.filter((x) => x !== o);
        this.broadcast();
        return;
      }
      case 'pardon': {
        const sh = this.sheriffPowers(pid);
        if (sh.pardonUsed) throw new Bad('You already used your pardon.');
        if (this.alive().length <= this.threshold()) throw new Bad('Too late for pardons. The finale decides now.');
        const g = s.board.find((x) => x.appid === Number(i.appid));
        if (!g || g.alive) throw new Bad('Only the dead need pardons.');
        this.pardon(sh, g);
        this.broadcast();
        return;
      }
      case 'jail': {
        const sh = this.sheriffPowers(pid);
        if (sh.jailUsed) throw new Bad('The cell is already spoken for.');
        const t = String(i.pid ?? '');
        if (t === pid || !s.turnOrder.includes(t)) throw new Bad("Can't jail that one.");
        if (sh.jailed === t) throw new Bad('Already behind bars.');
        this.jail(sh, t);
        this.broadcast();
        return;
      }
      case 'oust': {
        const sh = s.sheriff;
        if (s.phase !== 'veto' || !sh) throw new Bad('No Sheriff to run out of town.');
        if (sh.ousted) throw new Bad('Already run out of town.');
        const p = this.me(pid);
        if (p.bot || pid === sh.pid) throw new Bad("You can't vote on yourself, Sheriff.");
        sh.votes = sh.votes.includes(pid) ? sh.votes.filter((v) => v !== pid) : [...sh.votes, pid];
        this.checkOust();
        this.broadcast();
        return;
      }
      case 'slide': {
        if (s.phase === 'mini') {
          const m = this.miniFor(pid, 'slide');
          const power = Number(i.power);
          if (!Number.isFinite(power)) throw new Bad('Bad slide.');
          this.miniSlide(m, pid, power);
          this.broadcast();
          return;
        }
        const sl = s.slide;
        if (s.phase !== 'slide' || !sl || sl.decidedAt || this.x.slideAt || sl.turn >= sl.order.length) throw new Bad('No glass to slide right now.');
        if (sl.champs[sl.order[sl.turn]] !== pid) throw new Bad("Not your glass, partner.");
        if (Date.now() < sl.turnDeadline - SLIDE_TURN_MS - 250) throw new Bad('Steady... wait for it.');
        const power = Number(i.power);
        if (!Number.isFinite(power)) throw new Bad('Bad slide.');
        this.slideGlass(power);
        this.broadcast();
        return;
      }
      case 'ready': {
        if (s.phase !== 'result' || !s.launch) throw new Bad('Nothing to saddle up for yet.');
        const p = this.me(pid);
        if (p.bot) return;
        if (i.status !== 'ready' && i.status !== 'buy' && i.status !== 'download') throw new Bad('Bad status.');
        if (s.launch.ready[pid] === i.status) return;
        s.launch.ready[pid] = i.status;
        this.broadcast();
        return;
      }
      case 'saddleUp': {
        const l = s.launch;
        if (s.phase !== 'result' || !l) throw new Bad('Nothing to saddle up for yet.');
        if (!this.isHost(pid)) throw new Bad('Only the host calls saddle up.');
        const now = Date.now();
        if (l.launchAt && now < l.launchAt + 2000) throw new Bad('Already saddlin’ up.');
        l.launchAt = now + 4000;
        this.narr('saddle');
        if (s.players.some((p) => !p.bot && p.connected && l.ready[p.id] !== 'ready')) {
          this.job({ at: now + 3000, k: 'narr', ph: 'result', key: 'straggler' });
        }
        this.broadcast();
        return;
      }
      case 'pitch': {
        if (s.phase !== 'lobby' && s.phase !== 'nominate') throw new Bad('Too late to pitch.');
        this.me(pid);
        const appid = Number(i.appid);
        if (!Number.isInteger(appid) || appid <= 0) throw new Bad('Bad game.');
        if (s.pitches.some((x) => x.appid === appid)) throw new Bad('Already pitched.');
        if (s.pool.some((x) => x.appid === appid && x.tier === 'all')) throw new Bad('Everybody already owns that one!');
        if (s.pitches.length >= 12) throw new Bad('Too many pitches on the table.');
        const pitch = {
          appid, name: String(i.name ?? '').slice(0, 80) || `App ${appid}`, by: pid,
          price: i.price ? String(i.price).slice(0, 20) : undefined, votes: { [pid]: 'buy' as const } as Record<string, 'buy' | 'nope'>,
        };
        s.pitches.push(pitch);
        this.narr('pitch');
        this.broadcast();
        const bits = await storeBits(this.env, appid);
        const live = s.pitches.find((x) => x.appid === appid);
        if (bits && live) { live.price = bits.price ?? live.price; live.discount = bits.discount; this.broadcast(); }
        return;
      }
      case 'unpitch': {
        const pt = s.pitches.find((x) => x.appid === i.appid);
        if (!pt) return;
        if (pt.by !== pid && !this.isHost(pid)) throw new Bad('Only whoever pitched it can pull it.');
        if (s.phase !== 'lobby' && s.phase !== 'nominate') throw new Bad('Too late.');
        s.pitches = s.pitches.filter((x) => x !== pt);
        s.board = s.board.filter((b) => !(b.appid === pt.appid && b.tier === 'pitch'));
        this.broadcast();
        return;
      }
      case 'react': {
        const pt = s.pitches.find((x) => x.appid === i.appid);
        if (!pt) throw new Bad('No such pitch.');
        this.me(pid);
        if (i.vote !== 'buy' && i.vote !== 'nope') return;
        if (pt.votes[pid] === i.vote) delete pt.votes[pid];
        else pt.votes[pid] = i.vote;
        this.broadcast();
        return;
      }
      case 'beginVeto': {
        if (s.phase !== 'nominate') throw new Bad('Not now.');
        if (!this.isHost(pid)) throw new Bad('Only the host calls the draw.');
        const added = this.autofill();
        if (!s.board.length) throw new Bad('Nothing on the table to shoot at.');
        this.clearDraft();
        let hold: number;
        if (added) {
          this.narr('house');
          this.job({ at: Date.now() + 2600, k: 'narr', ph: 'veto', key: 'draw' }); hold = this.vetoExplain(5400);
        } else { this.narr('draw'); hold = this.vetoExplain(2900); }
        this.startVeto(pid, hold);
        this.broadcast();
        return;
      }
      case 'rematch': {
        if (s.phase !== 'result') throw new Bad('Finish this round first.');
        if (!this.isHost(pid)) throw new Bad('Only the host calls a rematch.');
        if (!s.board.length) throw new Bad('Nothing to rematch.');
        this.narr('rematch');
        this.job({ at: Date.now() + 2600, k: 'narr', ph: 'veto', key: 'draw' });
        this.startVeto(pid, this.vetoExplain(5400));
        this.broadcast();
        return;
      }
      case 'aim': {
        this.assertTurn(pid);
        if (!s.board.some((g) => g.appid === i.appid && g.alive)) return;
        s.aim = i.appid;
        this.broadcast(false);
        return;
      }
      case 'fire': {
        this.assertTurn(pid);
        const g = s.board.find((x) => x.appid === i.appid);
        if (!g || !g.alive) throw new Bad("That one's already dead.");
        this.fire(pid, g);
        this.broadcast();
        return;
      }
      case 'shield': {
        if (s.phase !== 'veto') throw new Bad('No stars outside a shootout.');
        const p = this.me(pid);
        if (p.shieldUsed) throw new Bad('You already pinned your tin star.');
        const g = s.board.find((x) => x.appid === i.appid);
        if (!g || !g.alive) throw new Bad("Can't protect the dead.");
        this.pinStar(p, g);
        this.broadcast();
        return;
      }
      case 'bang': {
        const d = s.duel;
        if (s.phase !== 'duel' || !d) throw new Bad('No duel right now.');
        if (!d.champs.includes(pid)) throw new Bad("This ain't your duel.");
        this.bang(pid, Number(i.reaction));
        this.broadcast();
        return;
      }
      case 'again': {
        if (s.phase !== 'result') throw new Bad('Finish this round first.');
        if (!this.isHost(pid)) throw new Bad('Only the host can deal again.');
        s.phase = 'nominate';
        s.board = []; s.shots = []; s.lastShot = undefined; s.roulette = undefined; s.result = undefined; s.duel = undefined;
        s.slide = undefined; s.sheriff = undefined; s.launch = undefined; this.x.slideAt = 0;
        s.vote = undefined; s.mini = undefined; this.x.miniAt = 0;
        s.turnOrder = []; s.turnIdx = 0; s.turnDeadline = 0; s.aim = undefined;
        for (const p of s.players) p.revengeOn = undefined;
        this.openNominations();
        this.broadcast();
        return;
      }
      default: throw new Bad('Unknown move.');
    }
  }

  addNom(pid: string, appid: number) {
    const s = this.s;
    const pg = s.pool.find((x) => x.appid === appid);
    const pt = s.pitches.find((x) => x.appid === appid);
    const g = pg ?? (pt && { appid: pt.appid, name: pt.name, tier: 'pitch' as const });
    if (!g) throw new Bad("That game isn't in the pool.");
    const b = s.board.find((x) => x.appid === appid);
    if (b?.by.includes(pid)) return;
    const mine = s.board.filter((x) => x.by.includes(pid)).length;
    const max = s.settings.picks;
    if (mine >= max) throw new Bad(`You've already tossed in ${max}. Pull one back first.`);
    if (b) b.by.push(pid);
    else s.board.push({ appid: g.appid, name: g.name, tier: g.tier, by: [pid], alive: true });
  }

  // ---------- draft ----------
  openNominations() {
    this.s.explainUntil = undefined; // a leftover hold from the previous screen doesn't carry over
    if (this.s.settings.nominations === 'draft') { this.dealDraft(); if (!this.explain('how_draft', 400)) this.narr('draft'); }
    else { this.clearDraft(); if (!this.explain('how_nominate', 400)) this.narr('deal'); }
    this.scheduleBotNoms();
  }

  dealDraft() {
    const s = this.s, x = this.x;
    const onBoard = new Set(s.board.map((b) => b.appid));
    const grp = (tier: PoolGame['tier'], coop: boolean) => shuffle(s.pool.filter((g) => g.tier === tier && (g.coop !== false) === coop && !onBoard.has(g.appid)).map((g) => g.appid));
    x.deck = [...grp('all', true), ...grp('all', false), ...grp('almost', true), ...grp('almost', false)];
    x.hands = {};
    s.draft = { hand: [], handCounts: {}, burns: {}, deck: 0, offers: [] };
    // deal round-robin so a small pool still spreads evenly
    const seats = s.players.filter((p) => p.connected).map((p) => (x.hands[p.id] = [] as number[]));
    for (let k = 0; k < DRAFT_HAND; k++) for (const h of seats) { const a = this.top(); if (a !== undefined) h.push(a); }
  }

  dealTo(pid: string) {
    const h = (this.x.hands[pid] = this.x.hands[pid] ?? []);
    while (h.length < DRAFT_HAND && this.draw(pid)) { /* deal */ }
  }

  /** top of the deck into pid's hand (skipping anything that ended up on the board); false if the deck is empty */
  draw(pid: string): boolean {
    const a = this.top();
    if (a === undefined) return false;
    (this.x.hands[pid] ??= []).push(a);
    return true;
  }
  top(): number | undefined {
    const x = this.x;
    while (x.deck.length) {
      const a = x.deck.shift()!;
      if (!this.s.board.some((b) => b.appid === a)) return a;
    }
    return undefined;
  }

  clearDraft() {
    this.s.draft = undefined;
    this.x.hands = {};
    this.x.deck = [];
  }

  /** my hand, or throws if no draft is running */
  draftFor(pid: string): number[] {
    if (this.s.phase !== 'nominate' || !this.s.draft) throw new Bad('No cards on the table.');
    this.me(pid);
    return this.x.hands[pid] ?? [];
  }

  /** remove a card from a hand and any open offers of it */
  dropCard(pid: string, appid: number) {
    const h = this.x.hands[pid];
    if (h) this.x.hands[pid] = h.filter((a) => a !== appid);
    if (this.s.draft) this.s.draft.offers = this.s.draft.offers.filter((o) => !(o.from === pid && o.give === appid));
  }

  acceptOffer(pid: string, id: number, give: number, mine: number[]) {
    const s = this.s, x = this.x;
    const offers = s.draft!.offers;
    const o = offers.find((q) => q.id === id);
    if (!o) throw new Bad('That offer is gone.');
    if (o.to !== pid) throw new Bad("That offer ain't for you.");
    if (!mine.includes(give)) throw new Bad("That card ain't in your hand.");
    const theirs = x.hands[o.from] ?? [];
    if (!theirs.includes(o.give)) { s.draft!.offers = offers.filter((q) => q !== o); throw new Bad('They already parted with that card.'); }
    x.hands[o.from] = [...theirs.filter((a) => a !== o.give), give];
    x.hands[pid] = [...mine.filter((a) => a !== give), o.give];
    s.draft!.offers = offers.filter((q) => q.give !== o.give && q.give !== give);
    this.narr('trade');
  }

  // ---------- sheriff ----------
  appointSheriff() {
    const s = this.s;
    s.sheriff = undefined;
    if (!s.settings.sheriff) return;
    const cands = s.players.filter((p) => p.connected && s.turnOrder.includes(p.id)).sort((a, b) => a.seat - b.seat);
    if (!cands.length) return;
    const sh = cands[this.x.sheriffRot++ % cands.length];
    s.sheriff = { pid: sh.id, pardonUsed: false, jailUsed: false, votes: [], ousted: false };
    const now = Date.now();
    this.job({ at: now + 6000, k: 'narr', ph: 'veto', key: 'sheriff' });
    if (sh.bot && Math.random() < 0.3) this.job({ at: now + rnd(6000, 20000), k: 'bjail', ph: 'veto', pid: sh.id });
  }

  sheriffPowers(pid: string) {
    const sh = this.s.sheriff;
    if (this.s.phase !== 'veto' || !sh) throw new Bad('No Sheriff in this town.');
    if (sh.pid !== pid) throw new Bad("You ain't the Sheriff.");
    if (sh.ousted) throw new Bad('You were run out of town. No badge, no powers.');
    return sh;
  }

  pardon(sh: NonNullable<RoomState['sheriff']>, g: BoardGame) {
    sh.pardonUsed = true;
    g.alive = true; g.killedBy = undefined; g.lastWords = undefined; g.cracks = 0;
    this.narr('pardon');
  }

  jail(sh: NonNullable<RoomState['sheriff']>, t: string) {
    sh.jailUsed = true;
    sh.jailed = t;
    this.narr('jail');
  }

  checkOust() {
    const s = this.s, sh = s.sheriff;
    if (!sh || sh.ousted) return;
    const voters = s.players.filter((p) => !p.bot && p.connected && p.id !== sh.pid).map((p) => p.id);
    sh.votes = sh.votes.filter((v) => voters.includes(v));
    if (!voters.length || sh.votes.length < Math.floor(voters.length / 2) + 1) return;
    sh.ousted = true;
    sh.jailed = undefined; // their powers (and an unserved sentence) go with the badge
    this.narr('ousted');
    if (s.turnOrder[s.turnIdx] === sh.pid && this.alive().length > this.threshold() && s.turnDeadline) {
      this.skipBlocked(true);
      this.armTurn(0);
    }
  }

  /** move the turn off players who must sit out (jailed once, ousted Sheriff always). Bounded: never loops forever. */
  skipBlocked(step: boolean) {
    const s = this.s, n = s.turnOrder.length;
    if (!n) return;
    let idx = step ? (s.turnIdx + 1) % n : s.turnIdx % n;
    for (let k = 0; k < n; k++) {
      const id = s.turnOrder[idx], sh = s.sheriff;
      if (sh?.ousted && id === sh.pid) { idx = (idx + 1) % n; continue; }
      if (sh?.jailed === id) { sh.jailed = undefined; idx = (idx + 1) % n; continue; }
      break;
    }
    s.turnIdx = idx;
  }

  pinStar(p: Player, g: BoardGame) {
    // private: stacking is allowed and reveals nothing; each star blocks one shot, first in first out
    g.shieldedBy = [...(g.shieldedBy ?? []), p.id];
    p.shieldUsed = true;
  }

  removePlayer(t: Player) {
    const s = this.s;
    const id = t.id;
    s.players = s.players.filter((p) => p !== t);
    const k = s.turnOrder.indexOf(id);
    if (k >= 0) {
      const wasShooter = k === s.turnIdx;
      s.turnOrder.splice(k, 1);
      if (k < s.turnIdx) s.turnIdx--;
      if (!s.turnOrder.length && s.phase === 'veto') s.turnOrder = s.players.filter((p) => p.connected).map((p) => p.id);
      s.turnIdx = s.turnOrder.length ? s.turnIdx % s.turnOrder.length : 0;
      if (wasShooter && s.phase === 'veto' && s.turnDeadline && this.alive().length > this.threshold()) { this.skipBlocked(false); this.armTurn(0); }
    }
    for (const g of s.board) {
      if (g.by.includes(id)) {
        g.by = g.by.filter((x) => x !== id);
        if (!g.by.length && g.tier !== 'pitch') g.tier = 'house'; // their picks stay as house picks
      }
      if (g.shieldedBy) {
        g.shieldedBy = g.shieldedBy.filter((x) => x !== id);
        if (!g.shieldedBy.length) g.shieldedBy = undefined;
      }
    }
    for (const p of s.players) if (p.revengeOn === id) p.revengeOn = undefined;
    for (const pt of s.pitches) delete pt.votes[id];
    if (s.draft) {
      const h = this.x.hands[id];
      delete this.x.hands[id];
      if (h) this.x.deck.push(...h); // their cards go back under the deck
      s.draft.offers = s.draft.offers.filter((o) => o.from !== id && o.to !== id);
      delete s.draft.burns[id];
    }
    if (s.sheriff) {
      s.sheriff.votes = s.sheriff.votes.filter((v) => v !== id);
      if (s.sheriff.jailed === id) s.sheriff.jailed = undefined;
      if (s.sheriff.pid === id) s.sheriff = undefined;
      else this.checkOust();
    }
    if (s.launch) delete s.launch.ready[id];
    if (s.vote) { delete s.vote.votes[id]; delete s.vote.backs[id]; }
    if (s.mini && !s.mini.decidedAt && !s.mini.results[id]) { s.mini.players = s.mini.players.filter((p) => p !== id); delete s.mini.backs[id]; }
    this.x.jobs = this.x.jobs.filter((j) => j.pid !== id);
    this.libs.delete(id);
    this.ctx.storage.delete(`lib:${id}`);
    if (t.host) {
      const n = s.players.find((q) => !q.bot && q.connected) ?? s.players.find((q) => !q.bot);
      if (n) n.host = true;
    }
    this.checkVote();
    this.checkMini();
  }

  // ---------- bots ----------
  async addBots(hostPid: string, n: number) {
    const s = this.s;
    const hostLib = await this.lib(hostPid);
    const base = hostLib && hostLib.length >= 4 ? hostLib.map((g) => [g.appid, g.name] as [number, string]) : FAKE_LIB;
    let added = 0;
    for (let k = 0; k < n; k++) {
      const taken = new Set(s.players.map((x) => x.seat));
      let seat = -1;
      for (let q = 0; q < 8; q++) if (!taken.has(q)) { seat = q; break; }
      if (seat < 0) break;
      const used = new Set(s.players.map((p) => p.name));
      const name = pick(BOT_NAMES.filter((x) => !used.has(x)).concat(used.size >= BOT_NAMES.length ? ['Nameless Drifter'] : []));
      const id = 'bot:' + Math.random().toString(36).slice(2, 10);
      let games = base.filter(() => Math.random() < 0.75);
      if (games.length < 3) games = base.slice(0, 3);
      const lib: OwnedGame[] = games.map(([appid, gname]) => ({ appid, name: gname, mins: rnd(0, 6000), mins2w: Math.random() < 0.15 ? 60 : 0 }));
      this.libs.set(id, lib);
      await this.ctx.storage.put(`lib:${id}`, lib);
      s.players.push({
        id, name, seat, look: seat % 8, style: randomLook(), bot: true, connected: true, host: false, shieldUsed: false,
        steam: { steamid: id, name, avatar: '', private: false, gameCount: lib.length },
      });
      added++;
    }
    return added;
  }

  scheduleBotNoms() {
    const now = Date.now();
    for (const b of this.s.players.filter((p) => p.bot)) {
      const n = rnd(1, this.s.settings.picks);
      for (let k = 0; k < n; k++) this.job({ at: now + rnd(1500, 5000), k: 'bnom', ph: 'nominate', pid: b.id });
    }
  }

  /** returns true if the job changed persistent state */
  runJob(j: Job): boolean {
    const s = this.s;
    if (j.k === 'narr') { if (j.key) this.narr(j.key); return false; }
    // bots wait for the Barkeep to finish explaining, like everyone else
    if (j.k !== 'bready' && j.k !== 'bemote' && j.k !== 'bvote' && j.k[0] === 'b' && s.explainUntil && Date.now() < s.explainUntil) {
      this.job({ ...j, at: s.explainUntil + rnd(400, 1600) });
      return false;
    }
    if (j.k === 'fuse') {
      if (s.phase === 'veto' && j.seq === this.x.seq && s.turnDeadline > Date.now()) this.narr('fuse_low');
      return false;
    }
    const b = s.players.find((p) => p.id === j.pid);
    if (!b?.bot || !this.humansOnline()) return false; // bots only play while someone's watching
    switch (j.k) {
      case 'bemote':
        if (j.emote) this.event({ t: 'emote', pid: b.id, emote: j.emote, at: Date.now() });
        return false;
      case 'bnom': {
        if (s.phase !== 'nominate') return false;
        if (s.board.filter((x) => x.by.includes(b.id)).length >= s.settings.picks) return false;
        if (s.draft) {
          const h = this.x.hands[b.id];
          if (!h?.length) return false;
          const a = pick(h);
          this.addNom(b.id, a);
          this.dropCard(b.id, a);
          return true;
        }
        const opts = s.pool.slice(0, 20).filter((g) => !s.board.some((x) => x.appid === g.appid && x.by.includes(b.id)));
        if (!opts.length) return false;
        this.addNom(b.id, pick(opts).appid);
        return true;
      }
      case 'baim': {
        if (s.phase !== 'veto' || j.seq !== this.x.seq) return false;
        if (s.board.some((g) => g.appid === j.appid && g.alive)) s.aim = j.appid;
        return false;
      }
      case 'bfire': {
        if (s.phase !== 'veto' || j.seq !== this.x.seq || s.turnOrder[s.turnIdx] !== b.id) return false;
        if (this.alive().length <= this.threshold()) return false;
        const alive = this.alive();
        const g = alive.find((x) => x.appid === j.appid) ?? pick(alive);
        this.fire(b.id, g);
        return true;
      }
      case 'bstar': {
        if (s.phase !== 'veto' || b.shieldUsed) return false;
        const alive = this.alive();
        if (!alive.length) return false;
        const mine = alive.filter((g) => g.by.includes(b.id));
        this.pinStar(b, mine.length && Math.random() < 0.7 ? pick(mine) : pick(alive));
        return true;
      }
      case 'bbang': {
        if (s.phase !== 'duel' || !s.duel || s.duel.decidedAt) return false;
        this.bang(b.id, j.n ?? 400);
        return true;
      }
      case 'bslide': {
        const sl = s.slide;
        if (s.phase !== 'slide' || !sl || sl.decidedAt || this.x.slideAt || sl.turn >= sl.order.length) return false;
        if (j.seq !== sl.round * 100 + sl.turn || sl.champs[sl.order[sl.turn]] !== b.id) return false;
        // aim for the mark with a shaky hand (sum of 3 uniforms ~ gaussian, sd ~0.05)
        const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 0.1;
        this.slideGlass(clamp(sl.mark / 1.18 + noise, 0, 1));
        return true;
      }
      case 'boffer': {
        const d = s.draft;
        const o = d?.offers.find((q) => q.id === j.n && q.to === b.id);
        if (!d || !o) return false;
        const h = this.x.hands[b.id] ?? [];
        if (h.length && Math.random() < 0.5) {
          try { this.acceptOffer(b.id, o.id, pick(h), h); } catch { d.offers = d.offers.filter((q) => q !== o); }
        } else d.offers = d.offers.filter((q) => q !== o);
        return true;
      }
      case 'bpardon': {
        const sh = s.sheriff;
        if (s.phase !== 'veto' || !sh || sh.pid !== b.id || sh.ousted || sh.pardonUsed) return false;
        if (this.alive().length <= this.threshold()) return false;
        const dead = s.board.filter((g) => !g.alive);
        if (!dead.length) return false;
        this.pardon(sh, pick(dead));
        return true;
      }
      case 'bjail': {
        const sh = s.sheriff;
        if (s.phase !== 'veto' || !sh || sh.pid !== b.id || sh.ousted || sh.jailUsed) return false;
        const humans = s.turnOrder.filter((id) => id !== b.id && !s.players.find((p) => p.id === id)?.bot);
        if (!humans.length) return false;
        this.jail(sh, pick(humans));
        return true;
      }
      case 'bready': {
        if (s.phase !== 'result' || !s.launch) return false;
        s.launch.ready[b.id] = 'ready';
        return true;
      }
      case 'bvote': {
        const v = s.vote;
        if (s.phase !== 'vote' || !v || v.picked || v.votes[b.id]) return false;
        v.votes[b.id] = pick(FINALE_KINDS);
        this.checkVote();
        return true;
      }
      case 'bmini': {
        const m = s.mini;
        if (s.phase !== 'mini' || !m || m.decidedAt || !m.players.includes(b.id) || m.results[b.id] || Date.now() >= m.deadline) return false;
        if (m.kind === 'slide') {
          const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 0.1;
          this.miniSlide(m, b.id, clamp((m.mark ?? 0.8) / 1.18 + noise, 0, 1));
        } else if (m.kind === 'golf') {
          this.miniGolf(m, b.id, rnd(2, 6), Math.max(0, Date.now() - m.startedAt));
        } else {
          // a real jump through the client's deterministic sim, so replays match the score
          const saddle = saddleX(m.seed, b.id);
          let best = 525, bs = -1;
          for (let r = 120; r <= 900; r += 10) { const sc = simulate([0, r], saddle).score; if (sc > bs) { bs = sc; best = r; } }
          const r = clamp(Math.round(best + (Math.random() + Math.random() + Math.random() - 1.5) * 70), 80, 1300);
          this.miniHorse(m, b.id, simulate([0, r], saddle).score, [0, r]);
        }
        return true;
      }
    }
    return false;
  }

  // ---------- veto ----------
  assertTurn(pid: string) {
    const s = this.s;
    if (s.phase !== 'veto') throw new Bad('No shootout right now.');
    if (this.alive().length <= this.threshold()) throw new Bad('Holster it. The finale decides now.');
    if (s.turnOrder[s.turnIdx] !== pid) throw new Bad("Not your turn, cowboy.");
    if (Date.now() < this.x.turnStart - 150) throw new Bad('Hold your fire. Listen to the Barkeep.');
  }

  startVeto(pid: string, hold = 0) {
    const s = this.s, x = this.x;
    if (!hold) s.explainUntil = undefined;
    for (const p of s.players) { p.shieldUsed = false; p.revengeOn = undefined; p.badges = undefined; }
    s.board.forEach((g) => { g.alive = true; g.killedBy = undefined; g.shieldedBy = undefined; g.cracks = 0; g.lastWords = undefined; });
    s.shots = []; s.lastShot = undefined; s.roulette = undefined; s.duel = undefined; s.result = undefined;
    s.slide = undefined; s.launch = undefined; s.vote = undefined; s.mini = undefined;
    this.clearDraft();
    x.fireMs = {}; x.misfires = []; x.finaleAt = 0; x.slideAt = 0; x.miniAt = 0;
    s.turnOrder = shuffle(s.players.filter((p) => p.connected).map((p) => p.id));
    if (!s.turnOrder.length) s.turnOrder = [pid];
    s.turnIdx = 0;
    s.phase = 'veto';
    this.appointSheriff();
    if (s.board.length <= this.threshold()) {
      this.enterFinale();
      return;
    }
    s.aim = s.board[0].appid;
    this.armTurn(hold);
    const now = Date.now();
    for (const b of s.players.filter((p) => p.bot && s.turnOrder.includes(p.id))) {
      if (Math.random() < 0.3) this.job({ at: now + rnd(1500, 9000), k: 'bstar', ph: 'veto', pid: b.id });
    }
  }

  armTurn(delay: number) {
    const s = this.s, x = this.x;
    x.seq++;
    x.jobs = x.jobs.filter((j) => j.k !== 'baim' && j.k !== 'bfire' && j.k !== 'fuse');
    const shooter = s.players.find((p) => p.id === s.turnOrder[s.turnIdx]);
    const live = !!shooter?.connected && (!shooter.bot || this.humansOnline());
    const ms = live ? s.settings.turnSecs * 1000 : 4000;
    const start = Date.now() + delay;
    s.turnDeadline = start + ms;
    x.turnStart = start;
    const alive = this.alive();
    if (!alive.some((g) => g.appid === s.aim)) s.aim = alive[0]?.appid;
    if (!shooter || !live) return;
    if (shooter.bot) {
      const total = rnd(2500, 6000);
      const own = alive.filter((g) => !g.by.includes(shooter.id));
      const cands = shuffle(own.length ? own : alive).slice(0, rnd(1, 3));
      cands.forEach((g, k) => this.job({ at: start + Math.round((total * k) / cands.length) + 300, k: 'baim', ph: 'veto', pid: shooter.id, seq: x.seq, appid: g.appid }));
      this.job({ at: start + total, k: 'bfire', ph: 'veto', pid: shooter.id, seq: x.seq, appid: cands[cands.length - 1]?.appid });
    } else if (s.settings.turnSecs >= 15) {
      this.job({ at: s.turnDeadline - 5000, k: 'fuse', ph: 'veto', seq: x.seq });
    }
  }

  /** a deliberate trigger pull (human or bot) */
  fire(pid: string, g: BoardGame) {
    const p = this.s.players.find((x) => x.id === pid);
    let revenge = false;
    if (p?.revengeOn) { revenge = true; p.revengeOn = undefined; }
    if (p && !p.bot) (this.x.fireMs[pid] ??= []).push(Math.max(0, Date.now() - this.x.turnStart));
    this.shoot(pid, g, 'hit', revenge);
    if (p?.bot && Math.random() < 0.1) {
      this.job({ at: Date.now() + 900, k: 'bemote', ph: this.s.phase, pid, emote: pick(['laugh', 'yeehaw', 'tip'] as EmoteId[]) });
    }
  }

  shoot(actor: string, g: BoardGame, kind: ShotEvent['kind'], revenge = false) {
    const s = this.s;
    const ev: ShotEvent = { id: (s.lastShot?.id ?? 0) + 1, t: Date.now(), actor, appid: g.appid, kind };
    if (revenge) { ev.revenge = true; this.narr('revenge'); }
    if (kind === 'misfire') { this.x.misfires.push(actor); this.narr('misfire'); }
    if (g.shieldedBy?.length) {
      ev.shieldOwner = g.shieldedBy.shift();
      if (!g.shieldedBy.length) g.shieldedBy = undefined;
      ev.kind = 'ricochet';
      this.narr('ricochet');
    } else if (g.tier === 'pitch' && !g.cracks) {
      g.cracks = 1; // pitched buys need two shots
      ev.kind = 'crack';
      this.narr('crack');
    } else {
      const firstBlood = !s.shots.some(isKill);
      const kills = s.shots.filter((e) => e.actor === actor && isKill(e)).length + 1;
      g.alive = false;
      g.killedBy = actor;
      g.lastWords = ev.lastWords = lastWords();
      for (const nom of g.by) {
        if (nom === actor) continue;
        const p = s.players.find((x) => x.id === nom);
        if (p) p.revengeOn = actor; // latest grudge wins
      }
      if (this.alive().length === this.threshold()) { ev.slowmo = true; this.narr('slowmo'); }
      if (firstBlood) this.narr('first_blood');
      if (kills === 3) this.narr('spree');
      if (Math.random() < 0.2) this.narr('kill');
    }
    s.lastShot = ev;
    s.shots.push(ev);
    this.skipBlocked(true);
    const sh = s.sheriff;
    if (sh && !sh.ousted && !sh.pardonUsed && g.killedBy === actor && !g.alive && s.shots.filter(isKill).length === 3
      && s.players.find((p) => p.id === sh.pid)?.bot && Math.random() < 0.35) {
      this.job({ at: Date.now() + rnd(2500, 5000), k: 'bpardon', ph: 'veto', pid: sh.pid });
    }
    if (this.alive().length <= this.threshold()) {
      s.turnDeadline = 0; // alarm rolls into the finale after the stamp lands
      this.x.finaleAt = Date.now() + SHOT_PAUSE + 600;
      this.x.jobs = this.x.jobs.filter((j) => j.k !== 'baim' && j.k !== 'bfire' && j.k !== 'fuse');
    } else {
      this.armTurn(SHOT_PAUSE);
    }
  }

  enterFinale() {
    const s = this.s;
    this.x.finaleAt = 0;
    s.turnDeadline = 0;
    const alive = this.alive();
    if (alive.length <= 1) return this.finish((alive[0] ?? s.board[0]).appid);
    // settings.finale (duel / legacy slide / last) no longer picks the finale: the table votes
    this.startVote(alive);
  }

  // ---------- finale vote ----------
  /** players without a valid back get one: their own (latest) nomination first, then the finalist with the fewest backers */
  assignBacks(games: number[], backs: Record<string, number>, pids: string[]) {
    const s = this.s;
    for (const pid of pids) {
      if (games.includes(backs[pid])) continue;
      delete backs[pid];
      const mine = s.board.filter((g) => games.includes(g.appid) && g.by.includes(pid));
      if (mine.length) backs[pid] = mine[mine.length - 1].appid;
    }
    for (const pid of shuffle(pids)) {
      if (backs[pid] !== undefined) continue;
      const n = (a: number) => Object.values(backs).filter((b) => b === a).length;
      const least = Math.min(...games.map(n));
      backs[pid] = pick(games.filter((a) => n(a) === least));
    }
  }

  startVote(alive: BoardGame[]) {
    const s = this.s, now = Date.now();
    s.explainUntil = undefined; // a leftover hold (e.g. a shootout that never started) doesn't carry over
    s.phase = 'vote';
    const games = alive.map((g) => g.appid);
    const backs: Record<string, number> = {};
    this.assignBacks(games, backs, s.players.map((p) => p.id));
    const hold = this.explain('how_vote', 2600);
    s.vote = { games, votes: {}, backs, deadline: now + VOTE_MS + (hold ? 2600 + hold : 0) };
    this.narr('vote');
    for (const b of s.players.filter((p) => p.bot)) this.job({ at: now + rnd(2000, 6000), k: 'bvote', ph: 'vote', pid: b.id });
  }

  /** every connected human has voted: decide now */
  checkVote() {
    const s = this.s, v = s.vote;
    if (s.phase !== 'vote' || !v || v.picked) return;
    const humans = s.players.filter((p) => !p.bot && p.connected);
    if (!humans.length || !humans.every((p) => v.votes[p.id])) return;
    // the humans are in: bots that haven't voted yet vote right now, so their votes still count
    for (const b of s.players) if (b.bot && !v.votes[b.id]) v.votes[b.id] = pick(FINALE_KINDS);
    this.decideVote();
  }

  decideVote() {
    const v = this.s.vote;
    if (!v || v.picked) return;
    const tally = new Map<FinaleKind, number>();
    for (const k of Object.values(v.votes)) if (FINALE_KINDS.includes(k)) tally.set(k, (tally.get(k) ?? 0) + 1);
    const best = Math.max(0, ...tally.values());
    const tied = [...tally].filter(([, n]) => n === best).map(([k]) => k);
    v.picked = tied.length ? pick(tied) : pick(FINALE_KINDS); // tie or nobody voted: random
    v.pickedAt = Date.now();
    this.x.jobs = this.x.jobs.filter((j) => j.k !== 'bvote');
  }

  /** the picked finale starts (VOTE_PICK_MS after the decision) */
  startPicked() {
    const s = this.s, v = s.vote;
    if (!v?.picked) return;
    const games = s.board.filter((g) => v.games.includes(g.appid));
    if (!games.length) return this.finish(v.games[0]);
    if (v.picked === 'revolver') return this.startRoulette(games);
    this.startMini(v.picked, games.map((g) => g.appid));
  }

  // ---------- minigames (everyone plays at once) ----------
  startMini(kind: Mini['kind'], games: number[]) {
    const s = this.s, x = this.x, now = Date.now();
    const humans = this.humansOnline();
    const players = s.players.filter((p) => p.connected && (!p.bot || humans)).map((p) => p.id);
    const backs: Record<string, number> = {};
    for (const pid of players) if (s.vote?.backs[pid] !== undefined) backs[pid] = s.vote.backs[pid];
    this.assignBacks(games, backs, players);
    s.phase = 'mini';
    s.explainUntil = undefined;
    const how: NarrKey = kind === 'slide' ? 'how_slide' : kind === 'golf' ? 'how_golf' : 'how_horse';
    const hold = this.explain(how, MINI_INTRO_MS);
    const startedAt = now + MINI_INTRO_MS + (hold ? hold + 300 : 0);
    const seed = Math.floor(Math.random() * 2 ** 32) >>> 0;
    const m: Mini = { kind, games, backs, players, startedAt, deadline: startedAt + MINI_MS[kind], seed, results: {} };
    if (kind === 'golf') m.map = seed % 5;
    if (kind === 'slide') m.mark = Math.round(slideMark() * 1e4) / 1e4;
    s.mini = m;
    x.miniAt = 0;
    this.narr(kind);
    const win: [number, number] = kind === 'slide' ? [3000, 12000] : kind === 'golf' ? [15000, 60000] : [6000, 20000];
    for (const b of s.players.filter((p) => p.bot && players.includes(p.id))) {
      this.job({ at: startedAt + rnd(win[0], win[1]), k: 'bmini', ph: 'mini', pid: b.id });
    }
  }

  /** the running minigame, if pid may post a result to it now */
  miniFor(pid: string, kind: Mini['kind']): Mini {
    const s = this.s, m = s.mini;
    if (s.phase !== 'mini' || !m || m.kind !== kind) throw new Bad('Not that game, partner.');
    if (!m.players.includes(pid)) throw new Bad("You're watching this one.");
    if (m.decidedAt || Date.now() > m.deadline) throw new Bad('Time\u2019s up.');
    if (m.results[pid]) throw new Bad('You already had your go.');
    if (Date.now() < m.startedAt - 250) throw new Bad('Steady... wait for it.');
    return m;
  }

  miniResult(m: Mini, pid: string, r: Omit<MiniResult, 'at'>) {
    m.results[pid] = { ...r, at: Date.now() };
    this.checkMini();
  }

  miniSlide(m: Mini, pid: string, power: number) {
    const now = Date.now();
    const dist = slideDist(clamp(power, 0, 1));
    const fell = dist > 1.0;
    const mark = m.mark ?? 0.8;
    const off = Math.abs(dist - mark);
    const inches = Math.round(off * 100);
    const label = fell ? 'Off the end' : inches === 0 ? 'Dead on!' : `${inches}" ${dist < mark ? 'short' : 'past'}`;
    // one Barkeep remark at a time, however many glasses are flying
    if ((fell || off < 0.02) && !this.limited('mini:narr', 3000)) {
      this.job({ at: now + SLIDE_ANIM_MS - (fell ? 400 : 300), k: 'narr', ph: 'mini', key: fell ? 'slide_fall' : 'slide_close' });
    }
    this.miniResult(m, pid, { score: fell ? 0 : Math.max(0, Math.round(1000 - off * 1000)), label, data: [Math.round(dist * 1e4) / 1e4, fell ? 1 : 0] });
  }

  miniGolf(m: Mini, pid: string, strokes: number, ms: number) {
    strokes = clamp(Math.round(strokes), 1, 12);
    ms = Math.max(0, Math.round(ms));
    const score = 10000 - strokes * 1000 - Math.min(999, Math.round((ms / 1000) * 5));
    this.miniResult(m, pid, { score, label: `${strokes} stroke${strokes === 1 ? '' : 's'}`, data: [strokes, ms] });
  }

  miniHorse(m: Mini, pid: string, score: number, inputs: unknown[]) {
    score = clamp(Math.round(score), 0, 100);
    const label = score >= 95 ? 'Perfect landing!' : score >= 75 ? 'Clean landing' : score >= 40 ? 'Wobbly' : 'Missed the horse';
    this.miniResult(m, pid, { score: score * 10, label, data: nums(inputs, 64) });
  }

  /** everyone still at the table has played: judge (slide waits for the last glass to stop) */
  checkMini() {
    const s = this.s, m = s.mini, x = this.x;
    if (s.phase !== 'mini' || !m || m.decidedAt || x.miniAt) return;
    const live = (id: string) => !!s.players.find((p) => p.id === id)?.connected;
    if (m.players.some((id) => !m.results[id] && live(id))) return;
    const last = Math.max(0, ...Object.values(m.results).map((r) => r.at));
    const at = m.kind === 'slide' ? last + SLIDE_ANIM_MS : 0;
    if (at > Date.now() + 50) x.miniAt = at;
    else this.decideMini();
  }

  decideMini() {
    const s = this.s, m = s.mini;
    this.x.miniAt = 0;
    if (!m || m.decidedAt) return;
    const now = Date.now();
    for (const id of m.players) m.results[id] ??= { score: 0, label: 'No show', at: now };
    // anyone who finished beats a no-show (golf scores can dip below 0)
    const fin = m.players.filter((id) => m.results[id] && m.results[id].label !== 'No show');
    const ids = fin.length ? fin : m.players;
    const best = Math.max(...ids.map((id) => m.results[id].score));
    const top = ids.filter((id) => m.results[id].score === best);
    const wp = top.length ? pick(top) : undefined;
    m.winnerPid = wp;
    m.winner = wp !== undefined && m.games.includes(m.backs[wp]) ? m.backs[wp] : pick(m.games);
    m.decidedAt = now;
    this.x.jobs = this.x.jobs.filter((j) => j.k !== 'bmini');
    if (m.kind === 'slide') this.narr('slide_win');
    else this.narr('result', 'result_3'); // "The dust settles. We have a winner." (result_1 is saved for the result screen)
  }

  // ---------- explanation skip ----------
  skipExplain(pid: string) {
    const s = this.s, x = this.x, now = Date.now();
    const p = this.me(pid);
    if (p.bot || !s.explainUntil || s.explainUntil <= now) return;
    if (!x.skips.includes(pid)) x.skips.push(pid);
    const humans = s.players.filter((q) => !q.bot && q.connected);
    if (!humans.length || !humans.every((q) => x.skips.includes(q.id))) return;
    // everyone's heard enough: end the hold, drop explanations still queued, and pull forward whatever waited on it
    const cut = s.explainUntil - now;
    s.explainUntil = undefined;
    x.skips = [];
    x.jobs = x.jobs.filter((j) => !(j.k === 'narr' && j.key?.startsWith('how_')));
    const pull = (t: number) => Math.max(now + 600, t - cut);
    let shift = cut;
    if (s.phase === 'veto' && s.turnDeadline && x.turnStart > now + 600 && this.alive().length > this.threshold()) {
      this.armTurn(pull(x.turnStart) - now); // re-arms the bots' aim/fire for the new start
    } else if (s.phase === 'vote' && s.vote && !s.vote.picked) {
      s.vote.deadline = Math.max(now + 1000, s.vote.deadline - cut);
    } else if (s.phase === 'mini' && s.mini && !s.mini.decidedAt && s.mini.startedAt > now + 600) {
      const m = s.mini;
      shift = m.startedAt - pull(m.startedAt);
      m.startedAt -= shift; m.deadline -= shift;
    } else if (s.phase === 'duel' && s.duel && !s.duel.decidedAt && s.duel.startedAt > now + 600) {
      const d = s.duel;
      shift = d.startedAt - pull(d.startedAt);
      d.startedAt -= shift; d.drawAt -= shift;
    }
    // bot moves that were waiting on the Barkeep come forward too
    for (const j of x.jobs) {
      if (j.k[0] !== 'b' || j.k === 'bfire' || j.k === 'baim' || j.at <= now) continue;
      j.at = Math.max(now + 400 + rnd(0, 800), j.at - shift);
    }
    this.broadcast();
  }

  startRoulette(alive: BoardGame[]) {
    const s = this.s;
    const chambers: number[] = [];
    for (let k = 0; k < 6; k++) chambers.push(alive[k % alive.length].appid);
    s.roulette = { chambers: shuffle(chambers), target: Math.floor(Math.random() * 6), startedAt: Date.now() + 400, duration: SPIN_MS };
    s.phase = 'roulette';
    this.narr('cylinder');
    this.explain('how_cylinder', 3000);
  }

  // ---------- whiskey slide ----------
  startSlide(games: BoardGame[]): boolean {
    const s = this.s;
    const humans = this.humansOnline();
    const pool = s.players.filter((p) => p.connected && (!p.bot || humans)).map((p) => p.id);
    if (!pool.length) return false;
    const champs: (string | undefined)[] = games.map(() => undefined);
    const used = new Set<string>();
    // 1) each game's (latest) nominator, distinct  2) a free player  3) doubling up: a nominator, else anyone
    games.forEach((g, k) => {
      const c = [...g.by].reverse().find((id) => !used.has(id) && pool.includes(id));
      if (c) { champs[k] = c; used.add(c); }
    });
    games.forEach((g, k) => {
      if (champs[k]) return;
      const free = pool.filter((id) => !used.has(id));
      const c = free.length ? pick(free) : ([...g.by].reverse().find((id) => pool.includes(id)) ?? pick(pool));
      champs[k] = c; used.add(c);
    });
    const now = Date.now();
    s.phase = 'slide';
    const hold = this.explain('how_slide', 2600);
    s.slide = {
      games: games.map((g) => g.appid), champs: champs as string[], order: shuffle(games.map((_, k) => k)),
      turn: 0, turnDeadline: now + SLIDE_INTRO_MS + (hold ? 2600 + hold - SLIDE_INTRO_MS + 400 : 0) + SLIDE_TURN_MS, mark: slideMark(), throws: [], round: 1,
    };
    this.x.slideAt = 0;
    this.narr('slide');
    this.botSlide();
    return true;
  }

  /** queue the current slider's release if it's a bot */
  botSlide() {
    const sl = this.s.slide;
    if (!sl || sl.turn >= sl.order.length) return;
    const c = sl.champs[sl.order[sl.turn]];
    if (!this.s.players.find((p) => p.id === c)?.bot) return;
    this.job({ at: sl.turnDeadline - SLIDE_TURN_MS + rnd(2000, 4500), k: 'bslide', ph: 'slide', pid: c, seq: sl.round * 100 + sl.turn });
  }

  slideGlass(power: number) {
    const sl = this.s.slide!;
    const now = Date.now();
    power = clamp(power, 0, 1);
    const dist = slideDist(power);
    const fell = dist > 1.0;
    sl.throws.push({ game: sl.games[sl.order[sl.turn]], power: Math.round(power * 1e4) / 1e4, dist: Math.round(dist * 1e4) / 1e4, fell, at: now });
    if (fell) this.job({ at: now + SLIDE_ANIM_MS - 400, k: 'narr', ph: 'slide', key: 'slide_fall' });
    else if (Math.abs(dist - sl.mark) < 0.02) this.job({ at: now + SLIDE_ANIM_MS - 300, k: 'narr', ph: 'slide', key: 'slide_close' });
    sl.turn++;
    if (sl.turn < sl.order.length) {
      sl.turnDeadline = now + SLIDE_ANIM_MS + SLIDE_TURN_MS;
      this.botSlide();
    } else {
      sl.turnDeadline = 0;
      this.x.slideAt = now + SLIDE_ANIM_MS; // judge once the last glass stops
    }
  }

  /** everyone has slid and the last glass has stopped: crown a winner or re-slide the tied (or all, if everyone fell) */
  decideSlide() {
    const sl = this.s.slide;
    this.x.slideAt = 0;
    if (!sl || sl.decidedAt) return;
    const ids = sl.order.map((k) => sl.games[k]);
    const r = slideOutcome(sl.throws, ids, sl.mark);
    const now = Date.now();
    if ('winner' in r) {
      sl.winner = r.winner;
      sl.decidedAt = now;
      this.narr('slide_win');
      return;
    }
    sl.round++;
    sl.throws = sl.throws.filter((t) => !r.tied.includes(t.game));
    sl.order = shuffle(r.tied.map((a) => sl.games.indexOf(a)));
    sl.turn = 0;
    sl.mark = slideMark();
    sl.turnDeadline = now + SLIDE_INTRO_MS + SLIDE_TURN_MS;
    this.narr('slide');
    this.botSlide();
  }

  // ---------- duel ----------
  startDuel(a: BoardGame, b: BoardGame): boolean {
    const s = this.s;
    const humans = this.humansOnline();
    const pool = s.players.filter((p) => p.connected && (!p.bot || humans));
    if (pool.length < 2) return false;
    const champs: string[] = [];
    for (const g of [a, b]) {
      const c = [...g.by].reverse().find((id) => !champs.includes(id) && pool.some((p) => p.id === id))
        ?? pick(pool.filter((p) => !champs.includes(p.id))).id;
      champs.push(c);
    }
    // when the Barkeep explains the duel (~8 s line), hold the standoff until he's done talking
    const dHold = this.explain('how_duel', 700, 'duel');
    const startedAt = Date.now() + (dHold ? 700 + dHold + 200 : 1200);
    const drawAt = startedAt + rnd(2500, 5000);
    s.duel = { games: [a.appid, b.appid], champs: [champs[0], champs[1]], startedAt, drawAt, taps: {} };
    s.phase = 'duel';
    this.narr('duel');
    for (const c of champs) {
      if (!s.players.find((p) => p.id === c)?.bot) continue;
      const r = rnd(260, 520);
      this.job({ at: drawAt + r, k: 'bbang', ph: 'duel', pid: c, n: r });
    }
    return true;
  }

  bang(pid: string, reaction: number) {
    const d = this.s.duel;
    if (!d || d.decidedAt || pid in d.taps) return;
    const now = Date.now();
    d.taps[pid] = now < d.drawAt - 150 || !Number.isFinite(reaction) || reaction < 80 ? -1 : clamp(Math.round(reaction), 80, 3000);
    if (d.champs.every((c) => c in d.taps)) this.decideDuel();
  }

  decideDuel() {
    const d = this.s.duel;
    if (!d || d.decidedAt) return;
    const [ta, tb] = d.champs.map((c) => d.taps[c]);
    const fa = ta === -1, fb = tb === -1;
    const va = ta !== undefined && ta > 0, vb = tb !== undefined && tb > 0;
    let w: number;
    let foul = false;
    if (fa !== fb) { w = fa ? 1 : 0; foul = true; }
    else if (va && vb) w = ta < tb ? 0 : tb < ta ? 1 : rnd(0, 1);
    else if (va !== vb) w = va ? 0 : 1;
    else w = rnd(0, 1);
    d.winner = d.games[w];
    d.decidedAt = Date.now();
    this.narr(foul ? 'duel_foul' : 'duel_win');
  }

  // ---------- result ----------
  finish(appid: number) {
    const s = this.s;
    const winner = s.board.find((x) => x.appid === appid);
    const name = winner?.name ?? s.pool.find((x) => x.appid === appid)?.name ?? `App ${appid}`;
    let repeat = 0;
    for (let k = s.history.length - 1; k >= 0 && s.history[k].appid === appid; k--) repeat++;

    // per-player tallies for this round
    const kills: Record<string, number> = {};
    const saves: Record<string, number> = {};
    const avengers = new Set<string>();
    for (const e of s.shots) {
      if (isKill(e)) kills[e.actor] = (kills[e.actor] ?? 0) + 1;
      if (e.shieldOwner) saves[e.shieldOwner] = (saves[e.shieldOwner] ?? 0) + 1;
      if (e.revenge) avengers.add(e.actor);
    }
    const duelist = s.duel?.winner === appid ? s.duel.champs[s.duel.games.indexOf(appid)] : undefined;
    const slider = s.slide?.winner === appid ? s.slide.champs[s.slide.games.indexOf(appid)] : undefined; // counts as a duel won (no badge)
    const miniWinner = s.phase === 'mini' && s.mini?.winner === appid ? s.mini.winnerPid : undefined; // minigame winner: badge + a duel won
    const badges: Record<string, BadgeId[]> = {};
    const give = (pid: string, b: BadgeId) => { if (s.players.some((p) => p.id === pid)) (badges[pid] ??= []).includes(b) || badges[pid].push(b); };
    const maxKills = Math.max(0, ...Object.values(kills));
    if (maxKills >= 2) for (const [pid, k] of Object.entries(kills)) if (k === maxKills) give(pid, 'trigger');
    for (const pid of Object.keys(saves)) give(pid, 'peacemaker');
    let sharp: string | undefined, best = Infinity;
    for (const [pid, ms] of Object.entries(this.x.fireMs)) {
      if (ms.length < 2) continue;
      const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
      if (avg < best) { best = avg; sharp = pid; }
    }
    if (sharp) give(sharp, 'sharp');
    for (const pid of winner?.by ?? []) give(pid, 'kingmaker');
    for (const pid of avengers) give(pid, 'avenger');
    for (const pid of this.x.misfires) give(pid, 'snail');
    if (duelist) give(duelist, 'duelist');
    if (miniWinner) give(miniWinner, 'duelist');
    for (const p of s.players) p.badges = badges[p.id];

    // posse record
    const rec = s.record;
    const humanName = new Map(s.players.filter((p) => !p.bot).map((p) => [p.id, p.name]));
    rec.rounds++;
    const w = rec.wins.find((x) => x.appid === appid);
    if (w) { w.count++; w.name = name; } else rec.wins.push({ appid, name, count: 1 });
    rec.wins = rec.wins.sort((a, b) => b.count - a.count).slice(0, 10);
    for (const v of rec.vetoers) { const n = humanName.get(v.pid); if (n) v.name = n; }
    for (const [pid, k] of Object.entries(kills)) {
      const n = humanName.get(pid);
      if (!n) continue;
      const v = rec.vetoers.find((x) => x.pid === pid);
      if (v) v.kills += k; else rec.vetoers.push({ pid, name: n, kills: k });
    }
    rec.vetoers = rec.vetoers.sort((a, b) => b.kills - a.kills).slice(0, 10);
    const nominators = new Set<string>();
    for (const g of s.board) {
      if (!g.by.length) continue;
      g.by.forEach((pid) => humanName.has(pid) && nominators.add(pid));
      let e = rec.noms.find((x) => x.appid === g.appid);
      if (!e) rec.noms.push((e = { appid: g.appid, name: g.name, noms: 0, deaths: 0, wins: 0 }));
      e.name = g.name; e.noms++;
      if (!g.alive && g.killedBy) e.deaths++;
      if (g.appid === appid) e.wins++;
    }
    rec.noms = rec.noms.sort((a, b) => b.noms - a.noms).slice(0, 30);
    for (const pid of nominators) {
      let st = rec.streaks.find((x) => x.pid === pid);
      if (!st) rec.streaks.push((st = { pid, name: '', cur: 0, best: 0 }));
      st.name = humanName.get(pid)!;
      st.cur = winner?.by.includes(pid) ? 0 : st.cur + 1;
      st.best = Math.max(st.best, st.cur);
    }
    rec.streaks = rec.streaks.sort((a, b) => b.cur - a.cur || b.best - a.best).slice(0, 30);
    const ns = rec.noms.filter((x) => x.noms >= 2 && x.wins === 0).sort((a, b) => b.noms - a.noms)[0];

    s.result = { appid, name, repeatCount: repeat, badges, ...(ns ? { neverSurvive: { appid: ns.appid, name: ns.name, noms: ns.noms } } : {}) };
    s.history.push({ appid, name, t: Date.now() });
    s.history = s.history.slice(-20);
    s.phase = 'result';
    s.turnDeadline = 0;
    s.sheriff = undefined;
    s.launch = { ready: {} } satisfies Launch;
    for (const b of s.players.filter((p) => p.bot)) this.job({ at: Date.now() + rnd(1000, 3000), k: 'bready', ph: 'result', pid: b.id });
    this.narr(repeat > 0 ? 'repeat' : 'result');
    this.explain('how_result', 7200);
    if (ns && Math.random() < 0.5) this.job({ at: Date.now() + 4500, k: 'narr', ph: 'result', key: 'never_survive' });

    // lifetime stats (humans only)
    const deltas = new Map<string, Partial<ProfileStats>>();
    for (const p of s.players) {
      if (p.bot) continue;
      const played = s.turnOrder.includes(p.id) || s.board.some((g) => g.by.includes(p.id));
      if (!played) continue;
      deltas.set(p.id, {
        rounds: 1,
        kills: kills[p.id] ?? 0,
        wins: winner?.by.includes(p.id) ? 1 : 0,
        saves: saves[p.id] ?? 0,
        duelsWon: duelist === p.id || slider === p.id || miniWinner === p.id ? 1 : 0,
        shotAt: s.board.filter((g) => g.by.includes(p.id) && !g.alive && g.killedBy).length,
      });
    }
    this.pushStats(deltas);
  }

  // ---------- timers ----------
  async alarm() {
    this.alarmAt = 0; // it just fired
    let persist = true;
    try {
      persist = this.tick();
    } catch (e) {
      console.error('alarm failed', e);
    }
    this.broadcast(persist);
  }

  tick(): boolean {
    const s = this.s, x = this.x;
    const now = Date.now();
    let persist = false;
    const due = x.jobs.filter((j) => j.at <= now + 25).sort((a, b) => a.at - b.at);
    if (due.length) {
      x.jobs = x.jobs.filter((j) => !due.includes(j));
      for (const j of due) {
        if (j.ph !== s.phase) continue;
        if (TRANSIENT.has(j.k) && j.at < now - STALE_MS) continue; // stale cosmetic job (e.g. reloaded after hibernation): never replay
        if (!TRANSIENT.has(j.k)) persist = true;
        try { if (this.runJob(j)) persist = true; } catch (e) { if (!(e instanceof Bad)) console.error('job failed', j.k, e); }
      }
    }
    if (s.phase === 'veto') {
      const alive = this.alive();
      if (alive.length <= this.threshold()) {
        if (!x.finaleAt || now >= x.finaleAt - 50) { this.enterFinale(); persist = true; }
      } else if (s.turnDeadline && now >= s.turnDeadline - 100) {
        const target = alive.find((g) => g.appid === s.aim) ?? pick(alive);
        this.shoot(s.turnOrder[s.turnIdx], target, 'misfire');
        persist = true;
      }
    } else if (s.phase === 'roulette' && s.roulette) {
      if (now >= s.roulette.startedAt + s.roulette.duration + 1000) {
        this.finish(s.roulette.chambers[s.roulette.target]);
        persist = true;
      }
    } else if (s.phase === 'duel' && s.duel) {
      const d = s.duel;
      if (!d.decidedAt && now >= d.drawAt + 4000 - 50) { this.decideDuel(); persist = true; }
      if (d.decidedAt && d.winner && now >= d.decidedAt + 3000 - 50) { this.finish(d.winner); persist = true; }
    } else if (s.phase === 'slide' && s.slide) {
      const sl = s.slide;
      if (sl.decidedAt) {
        if (sl.winner !== undefined && now >= sl.decidedAt + SLIDE_RESULT_MS - 50) { this.finish(sl.winner); persist = true; }
      } else if (x.slideAt) {
        if (now >= x.slideAt - 50) { this.decideSlide(); persist = true; }
      } else if (sl.turn < sl.order.length && sl.turnDeadline && now >= sl.turnDeadline - 50) {
        this.slideGlass(0.45 + Math.random() * 0.5); // fuse ran out: the glass slips at a random push
        persist = true;
      }
    } else if (s.phase === 'vote' && s.vote) {
      const v = s.vote;
      if (v.picked) {
        if (now >= (v.pickedAt ?? 0) + VOTE_PICK_MS - 50) { this.startPicked(); persist = true; }
      } else if (now >= v.deadline - 50) { this.decideVote(); persist = true; }
    } else if (s.phase === 'mini' && s.mini) {
      const m = s.mini;
      if (m.decidedAt) {
        if (m.winner !== undefined && now >= m.decidedAt + MINI_RESULT_MS - 50) { this.finish(m.winner); persist = true; }
      } else if ((x.miniAt && now >= x.miniAt - 50) || now >= m.deadline - 50) {
        // a glass slid just before the whistle is still travelling: judge once it stops
        const last = Math.max(0, ...Object.values(m.results).map((r) => r.at));
        if (!x.miniAt && m.kind === 'slide' && last + SLIDE_ANIM_MS > now + 50) x.miniAt = last + SLIDE_ANIM_MS;
        else this.decideMini();
        persist = true;
      }
    }
    return persist;
  }

  autofill(): number {
    const s = this.s;
    const want = Math.min(5, s.pool.length);
    let added = 0;
    if (s.board.length >= want) return 0;
    const ranked = [
      ...s.pool.filter((g) => g.tier === 'all' && g.coop !== false),
      ...s.pool.filter((g) => g.tier === 'all' && g.coop === false),
      ...s.pool.filter((g) => g.tier === 'almost' && g.coop !== false),
    ];
    for (const g of ranked) {
      if (s.board.length >= want) break;
      if (s.board.some((b) => b.appid === g.appid)) continue;
      s.board.push({ appid: g.appid, name: g.name, tier: 'house', by: [], alive: true });
      added++;
    }
    return added;
  }

  // ---------- steam ----------
  async link(pid: string, profile: string) {
    const key = this.env.STEAM_API_KEY;
    const p = this.me(pid);
    if (p.bot) throw new Bad('Bots bring their own.');
    if (this.env.FAKE_STEAM === '1' && profile.startsWith('fake:')) return this.fakeLink(pid, profile.slice(5));
    if (!key) throw new Bad('The server has no STEAM_API_KEY set yet.');
    if (!profile.trim()) throw new Bad('Paste your Steam profile link.');
    p.linking = true; p.linkError = undefined;
    this.broadcast(false);
    try {
      const id = await resolveSteamId(profile, key);
      const [sum, games] = await Promise.all([playerSummary(id, key), ownedGames(id, key)]);
      const q = this.me(pid);
      q.steam = { steamid: id, name: sum.name, avatar: sum.avatar, private: games === null, gameCount: games?.length ?? 0 };
      if (games) {
        this.libs.set(pid, games);
        await this.ctx.storage.put(`lib:${pid}`, games);
      } else {
        this.libs.delete(pid);
        await this.ctx.storage.delete(`lib:${pid}`);
      }
      q.linking = false;
    } catch (e) {
      const q = this.me(pid);
      q.linking = false;
      q.linkError = e instanceof Error ? e.message : 'Steam link failed.';
      console.log('steam link failed:', q.linkError);
    }
    this.broadcast();
    await this.recomputePool();
  }

  // dev only (FAKE_STEAM=1 in .dev.vars): lets the whole flow run without Steam access
  async fakeLink(pid: string, nick: string) {
    const games = FAKE_LIB.filter(() => Math.random() < 0.75).map(([appid, name]) => ({ appid, name, mins: Math.floor(Math.random() * 9000), mins2w: Math.random() < 0.2 ? 60 : 0 }));
    const p = this.me(pid);
    p.steam = { steamid: '7656119' + Math.floor(Math.random() * 1e10), name: nick || p.name, avatar: '', private: nick === 'private', gameCount: games.length };
    if (nick !== 'private') { this.libs.set(pid, games); await this.ctx.storage.put(`lib:${pid}`, games); }
    this.broadcast();
    await this.recomputePool();
  }

  async lib(pid: string) {
    let l = this.libs.get(pid);
    if (!l) {
      l = (await this.ctx.storage.get<OwnedGame[]>(`lib:${pid}`)) ?? undefined;
      if (l) this.libs.set(pid, l);
    }
    return l;
  }

  async recomputePool() {
    const gen = ++this.poolGen;
    const s = this.s;
    const linked: { pid: string; games: OwnedGame[] }[] = [];
    for (const p of s.players) {
      if (!p.steam || p.steam.private) continue;
      const games = await this.lib(p.id);
      if (games) linked.push({ pid: p.id, games });
    }
    if (gen !== this.poolGen) return;
    const n = linked.length;
    if (!n) { s.pool = []; s.poolLoading = false; this.broadcast(); return; }

    type Agg = { name: string; owners: string[]; mins: number; by: Record<string, number>; recent: boolean };
    const agg = new Map<number, Agg>();
    for (const { pid, games } of linked) {
      for (const g of games) {
        let a = agg.get(g.appid);
        if (!a) agg.set(g.appid, (a = { name: g.name, owners: [], mins: 0, by: {}, recent: false }));
        a.owners.push(pid);
        a.mins += g.mins;
        a.by[pid] = Math.round(g.mins / 60);
        if (g.mins2w > 0) a.recent = true;
      }
    }
    const ids = linked.map((l) => l.pid);
    const mk = (appid: number, a: Agg, tier: PoolGame['tier']): PoolGame => ({
      appid, name: a.name, tier, owners: a.owners, missing: ids.filter((x) => !a.owners.includes(x)),
      hours: Math.round(a.mins / 60), hoursBy: a.by, recent: a.recent,
    });
    const all: PoolGame[] = [];
    const almost: PoolGame[] = [];
    for (const [appid, a] of agg) {
      if (a.owners.length === n) all.push(mk(appid, a, 'all'));
      else if (n >= 2 && a.owners.length >= Math.max(1, n - 2)) almost.push(mk(appid, a, 'almost'));
    }
    // a solo player "owns everything", so keep it to their most-played stuff
    all.sort((x, y) => y.hours - x.hours);
    almost.sort((x, y) => y.owners.length - x.owners.length || y.hours - x.hours);
    const pool = [...all.slice(0, 48), ...almost.slice(0, 24)];

    // keep known store bits from previous pool
    const prev = new Map(s.pool.map((g) => [g.appid, g]));
    for (const g of pool) {
      const o = prev.get(g.appid);
      if (o) { g.coop = o.coop; g.price = o.price; g.discount = o.discount; }
    }
    s.pool = pool;
    s.poolLoading = true;
    this.broadcast();

    // enrich with store categories/price, bounded + cached in KV
    const todo = pool.filter((g) => g.coop === undefined).slice(0, 48);
    let idx = 0;
    const worker = async () => {
      while (idx < todo.length) {
        const g = todo[idx++];
        const b = await storeBits(this.env, g.appid);
        if (b) { g.coop = b.coop; g.price = b.price; g.discount = b.discount; }
      }
    };
    let last = Date.now();
    const ticker = async () => {
      // stream partial results every ~1.5s
      while (idx < todo.length && gen === this.poolGen) {
        await new Promise((r) => setTimeout(r, 1500));
        if (gen === this.poolGen && Date.now() - last > 1400) { last = Date.now(); this.broadcast(false); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker(), ticker()]);
    if (gen !== this.poolGen) return;
    s.poolLoading = false;
    this.broadcast();
  }
}
