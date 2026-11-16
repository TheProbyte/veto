// Shared contract between the Durable Object (server) and the React client.
export type Phase = 'lobby' | 'nominate' | 'veto' | 'roulette' | 'duel' | 'result';

export interface SteamInfo {
  steamid: string;
  name: string;
  avatar: string; // avatarfull URL
  private: boolean; // library hidden (Game Details not public)
  gameCount: number;
}

/** Character creator choices. Each field is an index into the option lists below. */
export interface Look {
  hat: number;      // 0..LOOK_COUNTS.hat-1   (wide brim, bowler, top hat, sombrero, flat cap, bandana-only)
  hatColor: number;
  skin: number;
  face: number;     // clean, stubble, moustache, full beard, goatee, scar
  hair: number;     // hair colour (shows under the hat / in the beard)
  bandana: number;  // includes a "none" option at index 0
  coat: number;
}
/** Base (always available) option counts. Indices >= base are unlockables (see LOOK_UNLOCKS). */
export const LOOK_BASE: Record<keyof Look, number> = {
  hat: 6, hatColor: 6, skin: 5, face: 6, hair: 5, bandana: 6, coat: 6,
};
/** Total option counts including unlockables. */
export const LOOK_COUNTS: Record<keyof Look, number> = {
  hat: 9, hatColor: 7, skin: 5, face: 7, hair: 5, bandana: 8, coat: 8,
};
export const LOOK_LABELS: Record<keyof Look, string[]> = {
  hat: ['Wide brim', 'Bowler', 'Top hat', 'Sombrero', 'Flat cap', 'No hat', "Sheriff's hat", "Gambler's visor", 'Cactus'],
  hatColor: ['Dust', 'Coal', 'Rust', 'Cream', 'Oxblood', 'Slate', 'Gold'],
  skin: ['Pale', 'Fair', 'Tan', 'Brown', 'Deep'],
  face: ['Clean', 'Stubble', 'Moustache', 'Full beard', 'Goatee', 'Scarred', 'Eyepatch'],
  hair: ['Black', 'Brown', 'Ginger', 'Blond', 'Grey'],
  bandana: ['None', 'Blood red', 'Navy', 'Black', 'Mustard', 'Green', 'Skull', 'Star-spangled'],
  coat: ['Duster', 'Black', 'Leather', 'Blue', 'Grey', 'Hide', 'Poncho', 'Gold vest'],
};
/** Random look using only base (always-unlocked) options. */
export const randomLook = (): Look => {
  const o = {} as Look;
  for (const k of Object.keys(LOOK_BASE) as (keyof Look)[]) o[k] = Math.floor(Math.random() * LOOK_BASE[k]);
  return o;
};

/** Lifetime per-player stats (stored in the player's Profile durable object, keyed by their browser id). */
export interface ProfileStats {
  rounds: number;    // rounds finished at any table
  kills: number;     // games shot down (hits + misfires that killed)
  wins: number;      // rounds won by a game you nominated
  saves: number;     // shots your tin star blocked
  duelsWon: number;
  shotAt: number;    // times a game you nominated got shot down
}
export const emptyStats = (): ProfileStats => ({ rounds: 0, kills: 0, wins: 0, saves: 0, duelsWon: 0, shotAt: 0 });

export interface LookUnlock { field: keyof Look; index: number; stat: keyof ProfileStats; need: number; hint: string }
export const LOOK_UNLOCKS: LookUnlock[] = [
  { field: 'hat', index: 6, stat: 'kills', need: 10, hint: 'Shoot down 10 games' },
  { field: 'hat', index: 7, stat: 'wins', need: 3, hint: 'Win 3 rounds with your nominations' },
  { field: 'hat', index: 8, stat: 'rounds', need: 10, hint: 'Finish 10 rounds' },
  { field: 'hatColor', index: 6, stat: 'wins', need: 8, hint: 'Win 8 rounds with your nominations' },
  { field: 'face', index: 6, stat: 'shotAt', need: 10, hint: 'Have your picks shot down 10 times' },
  { field: 'bandana', index: 6, stat: 'kills', need: 25, hint: 'Shoot down 25 games' },
  { field: 'bandana', index: 7, stat: 'saves', need: 3, hint: 'Block 3 shots with your tin star' },
  { field: 'coat', index: 6, stat: 'duelsWon', need: 1, hint: 'Win a quick-draw duel' },
  { field: 'coat', index: 7, stat: 'wins', need: 5, hint: 'Win 5 rounds with your nominations' },
];
/** Is option `index` of `field` available for these stats? Base options always are. */
export const lookUnlocked = (field: keyof Look, index: number, stats?: ProfileStats): boolean => {
  if (index < LOOK_BASE[field]) return true;
  const u = LOOK_UNLOCKS.find((x) => x.field === field && x.index === index);
  return !!u && !!stats && stats[u.stat] >= u.need;
};

export interface Settings {
  turnSecs: number;               // 10..90, default 30
  picks: number;                  // nominations per player 1..5, default 3
  finale: 'cylinder' | 'duel' | 'last'; // how it ends: revolver roulette, quick-draw duel between 2, or shoot down to the last one standing
  cylinderAt: 2 | 3;              // with finale 'cylinder': spin when this many remain (default 3)
}
export const DEFAULT_SETTINGS: Settings = { turnSecs: 30, picks: 3, finale: 'cylinder', cylinderAt: 3 };

export const BADGES = {
  trigger: { label: 'Trigger Happy', icon: '🔫', desc: 'Most games shot this round' },
  peacemaker: { label: 'Peacemaker', icon: '⭐', desc: 'Their tin star blocked a shot' },
  sharp: { label: 'Sharpshooter', icon: '🎯', desc: 'Fastest trigger this round' },
  kingmaker: { label: 'Kingmaker', icon: '👑', desc: 'Nominated the winner' },
  avenger: { label: 'Avenger', icon: '🩸', desc: 'Landed a revenge shot' },
  snail: { label: 'Slowpoke', icon: '🐌', desc: 'Let the fuse burn out' },
  duelist: { label: 'Fastest Gun', icon: '⚡', desc: 'Won the quick-draw' },
} as const;
export type BadgeId = keyof typeof BADGES;

export const EMOTES = {
  tip: { label: 'Tip hat', icon: '🎩' },
  spit: { label: 'Spit', icon: '💦' },
  laugh: { label: 'Laugh', icon: '😂' },
  yeehaw: { label: 'Yeehaw!', icon: '🤠' },
  clap: { label: 'Slow clap', icon: '👏' },
  shrug: { label: 'Shrug', icon: '🤷' },
  angry: { label: 'Fume', icon: '😤' },
  drink: { label: 'Drink', icon: '🥃' },
} as const;
export type EmoteId = keyof typeof EMOTES;

export const TAUNTS = [
  "You'll regret that.",
  'Draw, partner.',
  'Not on my watch.',
  'That one had it coming.',
  'Over my dead body.',
  "I've seen better aim from a cactus.",
  "Fine. FINE.",
  'Easy there, cowboy.',
];
export const SAY_MAX = 60;

export interface Player {
  id: string;
  name: string;
  seat: number; // 0..7 seat around the table
  look: number; // 0..7 legacy outfit index (used when style is unset)
  style?: Look; // chosen in the character creator
  steam?: SteamInfo;
  linkError?: string;
  linking?: boolean;
  shieldUsed: boolean; // the tin star (one per player)
  bot?: boolean; // practice-table bot (server plays it)
  stats?: ProfileStats; // lifetime stats (loaded from the Profile DO on hello)
  badges?: BadgeId[]; // earned last round (shown on nameplate until the next round starts)
  revengeOn?: string; // player id who shot down your nomination this round; your next shot is a REVENGE shot
  connected: boolean;
  host: boolean;
}

export interface PoolGame {
  appid: number;
  name: string;
  tier: 'all' | 'almost';
  owners: string[]; // player ids
  missing: string[]; // player ids who don't own it
  hours: number; // group total hours
  hoursBy: Record<string, number>; // player id -> hours (owners only)
  recent: boolean; // someone played in last 2 weeks
  coop?: boolean; // multiplayer/co-op per store categories (undefined = unknown yet)
  price?: string; // formatted current price
  discount?: number; // percent
}

export interface BoardGame {
  appid: number;
  name: string;
  tier: 'all' | 'almost' | 'house' | 'pitch';
  by: string[]; // nominating player ids (empty = house dealt)
  cracks?: number; // pitched buys take 2 shots: first shot cracks (cracks=1), second kills
  alive: boolean;
  shieldedBy?: string[]; // PRIVATE: player ids whose tin stars protect it. The server redacts this per player: you only ever see your own id here. Revealed via ShotEvent.shieldOwner on ricochet.
  lastWords?: string; // farewell line shown once it's shot down
  killedBy?: string;
}

export interface ShotEvent {
  id: number; // monotonically increasing; clients animate when it changes
  t: number;
  actor: string; // player id
  appid: number;
  kind: 'hit' | 'ricochet' | 'misfire' | 'crack'; // misfire = fuse ran out, gun went off on its own; crack = pitched buy survived its first shot (cracks=1)
  revenge?: boolean; // shooter was avenging their own killed nomination
  shieldOwner?: string; // on ricochet: whose hidden tin star blocked it (the reveal)
  lastWords?: string; // on a kill: the game's farewell line
  slowmo?: boolean; // the shot that brought the table down to the finale (play it in slow motion)
}

export interface Roulette {
  chambers: number[]; // 6 appids
  target: number; // chamber index 0..5 that ends under the hammer (server-chosen)
  startedAt: number; // ms epoch
  duration: number; // ms the spin animation should take
}

export interface Pitch {
  appid: number;
  name: string;
  by: string; // player id who pitched it
  price?: string;
  discount?: number;
  votes: Record<string, 'buy' | 'nope'>; // player id -> vote
}

export interface StoreHit { appid: number; name: string; price?: string; img: string }

export interface Duel {
  games: [number, number];       // the two finalist appids
  champs: [string, string];      // player id championing each game (same index)
  startedAt: number;             // ms epoch: duel screen begins ("steady...")
  drawAt: number;                // ms epoch: DRAW! appears (random 2.5–5s after start, server-chosen)
  taps: Record<string, number>;  // champ id -> reaction ms after DRAW (-1 = jumped the gun / foul)
  winner?: number;               // winning appid once decided
  decidedAt?: number;
}

export interface PosseRecord {
  rounds: number;
  wins: { appid: number; name: string; count: number }[];                       // top games picked, desc
  vetoers: { pid: string; name: string; kills: number }[];                       // all-time kills at this table, desc
  noms: { appid: number; name: string; noms: number; deaths: number; wins: number }[]; // nomination history ("never survives" = high noms, 0 wins)
  streaks: { pid: string; name: string; cur: number; best: number }[];           // rounds in a row without their nomination winning
}

export interface HistoryEntry { appid: number; name: string; t: number }

export interface RoomState {
  code: string;
  phase: Phase;
  players: Player[];
  pool: PoolGame[];
  poolLoading: boolean;
  pitches: Pitch[];
  settings: Settings;
  duel?: Duel;
  record: PosseRecord; // persists for this table code across rounds and nights
  board: BoardGame[];
  turnOrder: string[];
  turnIdx: number;
  turnDeadline: number; // ms epoch, 0 when no turn running
  aim?: number; // appid currently centered in the shooter's sights
  lastShot?: ShotEvent;
  shots: ShotEvent[];
  roulette?: Roulette;
  result?: {
    appid: number; name: string; repeatCount: number;
    badges: Record<string, BadgeId[]>;    // player id -> badges earned this round
    neverSurvive?: { appid: number; name: string; noms: number }; // this table's most-nominated game that has never won
  };
  history: HistoryEntry[];
  now: number; // server time when broadcast (for clock skew)
}

// client -> server intents
export type Intent =
  | { t: 'hello'; pid: string; name: string }
  | { t: 'link'; profile: string }
  | { t: 'style'; style: Look } // character creator
  | { t: 'unlink' }
  | { t: 'start' } // host: lobby -> nominate
  | { t: 'nominate'; appid: number } // toggle, max 3 per player (pool games or pitched buys)
  | { t: 'pitch'; appid: number; name: string; price?: string } // pitch a store game (from GET /api/search?q=)
  | { t: 'unpitch'; appid: number }
  | { t: 'react'; appid: number; vote: 'buy' | 'nope' } // toggle vote on a pitch
  | { t: 'beginVeto' } // host: nominate -> veto (auto-fills)
  | { t: 'aim'; appid: number } // shooter moves carousel
  | { t: 'fire'; appid: number }
  | { t: 'shield'; appid: number }
  | { t: 'again' } // host: back to nominate
  | { t: 'rematch' } // host (result): same games, same posse, straight back to the shootout
  | { t: 'settings'; settings: Partial<Settings> } // host, lobby/nominate only
  | { t: 'kick'; pid: string } // host: remove an offline player or a bot
  | { t: 'bots'; n: number } // host, lobby only: add n practice bots (1..3); n=0 removes all bots
  | { t: 'emote'; emote: EmoteId } // broadcast as an event, rate limited
  | { t: 'say'; text: string } // speech bubble (<= SAY_MAX chars), rate limited
  | { t: 'bang'; reaction: number }; // duel: champ fires; reaction = ms between DRAW appearing on their screen and the tap (client-measured); sent before DRAW = foul

// server -> client
export type ServerMsg =
  | { t: 'state'; state: RoomState; you: string }
  | { t: 'error'; message: string }
  | RoomEvent;

/** Transient events (not part of state; not persisted). */
export type RoomEvent =
  | { t: 'emote'; pid: string; emote: EmoteId; at: number }
  | { t: 'say'; pid: string; text: string; at: number }
  | { t: 'narrate'; id: string; text: string; at: number } // bartender line (see shared/narrator.ts); id matches /voice/<id>.mp3

export const TURN_MS = 30_000;
export const MAX_NOMS = 3;

export const boxArt = (appid: number) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`;
export const headerArt = (appid: number) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
export const heroArt = (appid: number) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`;

/** Same-origin, CORS-enabled proxy of Steam art (so canvases can read pixels for pixel-art processing). */
export type ArtKind = 'box' | 'header' | 'hero' | 'capsule';
export const pxArt = (appid: number, kind: ArtKind) => `/api/img/${appid}/${kind}`;
