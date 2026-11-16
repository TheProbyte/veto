import { DurableObject } from 'cloudflare:workers';
import type { BoardGame, Intent, Player, PoolGame, RoomState, ServerMsg, ShotEvent } from '../shared/types';
import { MAX_NOMS, TURN_MS } from '../shared/types';
import { ownedGames, playerSummary, resolveSteamId, storeBits, type Env, type OwnedGame } from './steam';

const SHOT_PAUSE = 1600; // ms to let the stamp animation land before the next fuse starts
const SPIN_MS = 6500;

const shuffle = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

class Bad extends Error {}

function fresh(code: string): RoomState {
  return {
    code, phase: 'lobby', players: [], pool: [], poolLoading: false, board: [],
    turnOrder: [], turnIdx: 0, turnDeadline: 0, shots: [], history: [], now: 0,
  };
}

export class Room extends DurableObject<Env> {
  s!: RoomState;
  libs = new Map<string, OwnedGame[]>();
  poolGen = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<RoomState>('s')) ?? fresh('');
    });
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
    // if the host walked out, anyone still at the table can run the show
    return host?.id === pid || !host?.connected;
  }
  broadcast() {
    this.s.now = Date.now();
    this.ctx.storage.put('s', this.s);
    const body = this.s;
    for (const ws of this.ctx.getWebSockets()) {
      const pid = this.pidOf(ws);
      if (!pid) continue;
      try { ws.send(JSON.stringify({ t: 'state', state: body, you: pid } satisfies ServerMsg)); } catch {}
    }
    this.schedule();
  }
  schedule() {
    const s = this.s;
    let at = 0;
    if (s.phase === 'veto') {
      at = s.board.filter((g) => g.alive).length <= 3 ? Date.now() + SHOT_PAUSE + 600 : s.turnDeadline;
    } else if (s.phase === 'roulette' && s.roulette) {
      at = s.roulette.startedAt + s.roulette.duration + 1500;
    }
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
    if (p && !still) {
      p.connected = false;
      // don't make everyone wait 30s on an empty chair
      if (this.s.phase === 'veto' && this.s.turnOrder[this.s.turnIdx] === pid) {
        this.s.turnDeadline = Math.min(this.s.turnDeadline, Date.now() + 4000);
      }
      this.broadcast();
    }
  }

  // ---------- intents ----------
  hello(ws: WebSocket, pid: string, name: string) {
    if (!pid || typeof pid !== 'string') throw new Bad('Bad hello.');
    name = String(name || 'Stranger').trim().slice(0, 20) || 'Stranger';
    let p = this.s.players.find((x) => x.id === pid);
    if (!p) {
      const taken = new Set(this.s.players.map((x) => x.seat));
      let seat = -1;
      for (let k = 0; k < 8; k++) if (!taken.has(k)) { seat = k; break; }
      if (seat < 0) {
        // evict an offline, unlinked ghost if the table is full
        const ghost = this.s.players.find((x) => !x.connected && !x.steam);
        if (!ghost) throw new Bad('The table is full, partner.');
        this.s.players = this.s.players.filter((x) => x !== ghost);
        seat = ghost.seat;
      }
      p = {
        id: pid, name, seat, look: (seat * 3 + Math.floor(Math.random() * 8)) % 8,
        shieldUsed: false, connected: true, host: !this.s.players.some((x) => x.host),
      };
      this.s.players.push(p);
    }
    p.name = name;
    p.connected = true;
    ws.serializeAttachment({ pid });
    this.broadcast();
  }

  async handle(pid: string, i: Intent) {
    const s = this.s;
    switch (i.t) {
      case 'link': return this.link(pid, String(i.profile ?? ''));
      case 'unlink': {
        const p = this.me(pid);
        p.steam = undefined; p.linkError = undefined;
        this.libs.delete(pid);
        await this.ctx.storage.delete(`lib:${pid}`);
        this.broadcast();
        return this.recomputePool();
      }
      case 'start': {
        if (s.phase !== 'lobby') throw new Bad('Already dealt.');
        if (!this.isHost(pid)) throw new Bad('Only the host deals.');
        if (!s.players.some((p) => p.steam && !p.steam.private)) throw new Bad('Nobody has a public library linked yet.');
        s.phase = 'nominate';
        this.broadcast();
        return;
      }
      case 'nominate': {
        if (s.phase !== 'nominate') throw new Bad('Not tossing games right now.');
        const g = s.pool.find((x) => x.appid === i.appid);
        if (!g) throw new Bad("That game isn't in the pool.");
        const b = s.board.find((x) => x.appid === i.appid);
        const mine = s.board.filter((x) => x.by.includes(pid)).length;
        if (b?.by.includes(pid)) {
          b.by = b.by.filter((x) => x !== pid);
          if (!b.by.length) s.board = s.board.filter((x) => x !== b);
        } else {
          if (mine >= MAX_NOMS) throw new Bad(`You've already tossed in ${MAX_NOMS}. Pull one back first.`);
          if (b) b.by.push(pid);
          else s.board.push({ appid: g.appid, name: g.name, tier: g.tier, by: [pid], alive: true });
        }
        this.broadcast();
        return;
      }
      case 'beginVeto': {
        if (s.phase !== 'nominate') throw new Bad('Not now.');
        if (!this.isHost(pid)) throw new Bad('Only the host calls the draw.');
        this.autofill();
        if (!s.board.length) throw new Bad('Nothing on the table to shoot at.');
        for (const p of s.players) p.shieldUsed = false;
        s.board.forEach((g) => { g.alive = true; g.killedBy = undefined; g.shieldedBy = undefined; });
        s.shots = []; s.lastShot = undefined;
        s.turnOrder = shuffle(s.players.filter((p) => p.connected).map((p) => p.id));
        if (!s.turnOrder.length) s.turnOrder = [pid];
        s.turnIdx = 0;
        s.phase = 'veto';
        if (s.board.length <= 3) {
          this.startRoulette();
        } else {
          s.aim = s.board[0].appid;
          this.armTurn(0);
        }
        this.broadcast();
        return;
      }
      case 'aim': {
        this.assertTurn(pid);
        if (!s.board.some((g) => g.appid === i.appid && g.alive)) return;
        s.aim = i.appid;
        this.broadcast();
        return;
      }
      case 'fire': {
        this.assertTurn(pid);
        const g = s.board.find((x) => x.appid === i.appid);
        if (!g || !g.alive) throw new Bad("That one's already dead.");
        this.shoot(pid, g, 'hit');
        this.broadcast();
        return;
      }
      case 'shield': {
        if (s.phase !== 'veto') throw new Bad('No stars outside a shootout.');
        const p = this.me(pid);
        if (p.shieldUsed) throw new Bad('You already pinned your tin star.');
        const g = s.board.find((x) => x.appid === i.appid);
        if (!g || !g.alive) throw new Bad("Can't protect the dead.");
        if (g.shieldedBy) throw new Bad('Already wearing a star.');
        g.shieldedBy = pid;
        p.shieldUsed = true;
        this.broadcast();
        return;
      }
      case 'again': {
        if (s.phase !== 'result') throw new Bad('Finish this round first.');
        if (!this.isHost(pid)) throw new Bad('Only the host can deal again.');
        s.phase = 'nominate';
        s.board = []; s.shots = []; s.lastShot = undefined; s.roulette = undefined; s.result = undefined;
        s.turnOrder = []; s.turnIdx = 0; s.turnDeadline = 0; s.aim = undefined;
        this.broadcast();
        return;
      }
      default: throw new Bad('Unknown move.');
    }
  }

  assertTurn(pid: string) {
    const s = this.s;
    if (s.phase !== 'veto') throw new Bad('No shootout right now.');
    if (s.board.filter((g) => g.alive).length <= 3) throw new Bad('Holster it. The cylinder decides now.');
    if (s.turnOrder[s.turnIdx] !== pid) throw new Bad("Not your turn, cowboy.");
  }

  armTurn(delay: number) {
    const s = this.s;
    const shooter = s.players.find((p) => p.id === s.turnOrder[s.turnIdx]);
    const ms = shooter?.connected ? TURN_MS : 4000;
    s.turnDeadline = Date.now() + delay + ms;
    const alive = s.board.filter((g) => g.alive);
    if (!alive.some((g) => g.appid === s.aim)) s.aim = alive[0]?.appid;
  }

  shoot(actor: string, g: BoardGame, kind: ShotEvent['kind']) {
    const s = this.s;
    if (g.shieldedBy) {
      g.shieldedBy = undefined;
      kind = 'ricochet';
    } else {
      g.alive = false;
      g.killedBy = actor;
    }
    const ev: ShotEvent = { id: (s.lastShot?.id ?? 0) + 1, t: Date.now(), actor, appid: g.appid, kind };
    s.lastShot = ev;
    s.shots.push(ev);
    s.turnIdx = (s.turnIdx + 1) % s.turnOrder.length;
    if (s.board.filter((x) => x.alive).length <= 3) {
      s.turnDeadline = 0; // alarm will roll the cylinder after the stamp lands
    } else {
      this.armTurn(SHOT_PAUSE);
    }
  }

  startRoulette() {
    const s = this.s;
    const alive = s.board.filter((g) => g.alive);
    if (alive.length === 1) return this.finish(alive[0].appid);
    const chambers: number[] = [];
    for (let k = 0; k < 6; k++) chambers.push(alive[k % alive.length].appid);
    s.roulette = { chambers: shuffle(chambers), target: Math.floor(Math.random() * 6), startedAt: Date.now() + 400, duration: SPIN_MS };
    s.phase = 'roulette';
    s.turnDeadline = 0;
  }

  finish(appid: number) {
    const s = this.s;
    const g = s.board.find((x) => x.appid === appid) ?? s.pool.find((x) => x.appid === appid);
    const name = g?.name ?? `App ${appid}`;
    let repeat = 0;
    for (let k = s.history.length - 1; k >= 0 && s.history[k].appid === appid; k--) repeat++;
    s.result = { appid, name, repeatCount: repeat };
    s.history.push({ appid, name, t: Date.now() });
    s.history = s.history.slice(-20);
    s.phase = 'result';
    s.turnDeadline = 0;
  }

  async alarm() {
    const s = this.s;
    const now = Date.now();
    if (s.phase === 'veto') {
      const alive = s.board.filter((g) => g.alive);
      if (alive.length <= 3) {
        this.startRoulette();
      } else if (s.turnDeadline && now >= s.turnDeadline - 100) {
        const target = alive.find((g) => g.appid === s.aim) ?? alive[Math.floor(Math.random() * alive.length)];
        this.shoot(s.turnOrder[s.turnIdx], target, 'misfire');
      }
    } else if (s.phase === 'roulette' && s.roulette) {
      if (now >= s.roulette.startedAt + s.roulette.duration + 1000) {
        this.finish(s.roulette.chambers[s.roulette.target]);
      }
    }
    this.broadcast();
  }

  autofill() {
    const s = this.s;
    const want = Math.min(5, s.pool.length);
    if (s.board.length >= want) return;
    const ranked = [
      ...s.pool.filter((g) => g.tier === 'all' && g.coop !== false),
      ...s.pool.filter((g) => g.tier === 'all' && g.coop === false),
      ...s.pool.filter((g) => g.tier === 'almost' && g.coop !== false),
    ];
    for (const g of ranked) {
      if (s.board.length >= want) break;
      if (s.board.some((b) => b.appid === g.appid)) continue;
      s.board.push({ appid: g.appid, name: g.name, tier: 'house', by: [], alive: true });
    }
  }

  // ---------- steam ----------
  async link(pid: string, profile: string) {
    const key = this.env.STEAM_API_KEY;
    const p = this.me(pid);
    if (this.env.FAKE_STEAM === '1' && profile.startsWith('fake:')) return this.fakeLink(pid, profile.slice(5));
    if (!key) throw new Bad('The server has no STEAM_API_KEY set yet.');
    if (!profile.trim()) throw new Bad('Paste your Steam profile link.');
    p.linking = true; p.linkError = undefined;
    this.broadcast();
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
    }
    this.broadcast();
    await this.recomputePool();
  }

  // dev only (FAKE_STEAM=1 in .dev.vars): lets the whole flow run without Steam access
  async fakeLink(pid: string, nick: string) {
    const ids: [number, string][] = [[730, 'Counter-Strike 2'], [252490, 'Rust'], [892970, 'Valheim'], [1966720, 'Lethal Company'],
      [548430, 'Deep Rock Galactic'], [105600, 'Terraria'], [413150, 'Stardew Valley'], [632360, 'Risk of Rain 2'], [739630, 'Phasmophobia'],
      [1086940, "Baldur's Gate 3"], [553850, 'HELLDIVERS 2'], [945360, 'Among Us'], [322330, "Don't Starve Together"], [620, 'Portal 2'],
      [550, 'Left 4 Dead 2'], [1145360, 'Hades'], [381210, 'Dead by Daylight'], [1623730, 'Palworld']];
    const games = ids.filter(() => Math.random() < 0.75).map(([appid, name]) => ({ appid, name, mins: Math.floor(Math.random() * 9000), mins2w: Math.random() < 0.2 ? 60 : 0 }));
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
    const n = linked.length;
    if (!n) { s.pool = []; s.poolLoading = false; this.broadcast(); return; }

    const agg = new Map<number, { name: string; owners: string[]; mins: number; recent: boolean }>();
    for (const { pid, games } of linked) {
      for (const g of games) {
        let a = agg.get(g.appid);
        if (!a) agg.set(g.appid, (a = { name: g.name, owners: [], mins: 0, recent: false }));
        a.owners.push(pid);
        a.mins += g.mins;
        if (g.mins2w > 0) a.recent = true;
      }
    }
    const ids = linked.map((l) => l.pid);
    const mk = (appid: number, a: { name: string; owners: string[]; mins: number; recent: boolean }, tier: PoolGame['tier']): PoolGame => ({
      appid, name: a.name, tier, owners: a.owners, missing: ids.filter((x) => !a.owners.includes(x)),
      hours: Math.round(a.mins / 60), recent: a.recent,
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
        if (gen === this.poolGen && Date.now() - last > 1400) { last = Date.now(); this.broadcast(); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker(), ticker()]);
    if (gen !== this.poolGen) return;
    s.poolLoading = false;
    this.broadcast();
  }
}
