// Shared contract between the Durable Object (server) and the React client.
export type Phase = 'lobby' | 'nominate' | 'veto' | 'vote' | 'roulette' | 'mini' | 'duel' | 'slide' | 'result';

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
  /** how it ends: whiskey slide (skill, default), revolver roulette, quick-draw duel between 2, or shoot down to the last one standing */
  finale: 'slide' | 'cylinder' | 'duel' | 'last';
  cylinderAt: 2 | 3;              // 'slide' and 'cylinder': the finale starts when this many games remain (default 3)
  nominations: 'browse' | 'draft'; // browse the pool (default) or the card-hand draft (dealt 5 cards, play/burn/trade)
  sheriff: boolean;               // Sheriff role during the shootout (Pardon + Jail; posse can run them out of town)
  explain: boolean;               // the Barkeep explains each step out loud (how_* narration). Default on.
  felt: number;                   // table felt theme, index into FELTS (host picks)
  deck: number;                   // card-back theme, index into DECKS (host picks)
}
export const FELTS = [
  { label: 'Classic green', base: '#1f4a2c', light: '#2f6a3e', dark: '#12301c' },
  { label: 'Royal blue', base: '#1d3558', light: '#2b4f80', dark: '#111f36' },
  { label: 'Oxblood', base: '#4a1a1a', light: '#6b2626', dark: '#2c0e0e' },
  { label: 'Purple velvet', base: '#3a2148', light: '#55306a', dark: '#22132b' },
  { label: 'Midnight black', base: '#1c1c20', light: '#2c2c33', dark: '#0e0e11' },
  { label: 'Desert tan', base: '#6b5534', light: '#8a6f45', dark: '#463620' },
] as const;
export const DECKS = [
  { label: 'Saloon red', a: '#9e1b1b', b: '#e8d5b5' },
  { label: 'Midnight blue', a: '#1e2c56', b: '#c9d4f0' },
  { label: 'Gold filigree', a: '#5a3a12', b: '#ffcf5c' },
  { label: 'Cactus', a: '#2c5a2a', b: '#e8d5b5' },
] as const;
export const DEFAULT_SETTINGS: Settings = { turnSecs: 30, picks: 3, finale: 'slide', cylinderAt: 3, nominations: 'browse', sheriff: false, explain: true, felt: 0, deck: 0 };

/**
 * FINALE (in-game, not a setting): when the table is down to settings.cylinderAt games, everyone votes how to settle it
 * and picks which finalist they play for. Most votes wins (ties broken at random).
 */
export type FinaleKind = 'revolver' | 'slide' | 'golf' | 'horse';
export const FINALES: Record<FinaleKind, { label: string; blurb: string }> = {
  revolver: { label: 'Revolver', blurb: 'The cylinder picks. Pure luck.' },
  slide: { label: 'Whiskey Slide', blurb: 'Slide your glass to the chalk.' },
  golf: { label: 'Mini Golf', blurb: 'Fewest strokes wins.' },
  horse: { label: 'Horse Drop', blurb: 'Flip off the roof, land the saddle.' },
};
export const FINALE_KINDS: FinaleKind[] = ['revolver', 'slide', 'golf', 'horse'];

export interface FinaleVote {
  games: number[];                       // the finalist appids (2–3)
  votes: Record<string, FinaleKind>;     // player id -> locked-in vote (humans; bots vote too)
  backs: Record<string, number>;         // player id -> finalist appid they play for (defaults to their own pick)
  deadline: number;                      // ms epoch: unvoted players are ignored after this
  picked?: FinaleKind;                   // set once decided (shown ~2.5 s before the finale starts)
  pickedAt?: number;
}

/**
 * Skill finale everyone plays at once (phase 'mini'). Each player plays for state.mini.backs[pid]; the best score's game wins.
 * score: HIGHER IS BETTER for every kind (the server computes it):
 *  - slide: 1000 − |dist − mark|·1000 (0 if it fell off the end). Server-authoritative from {t:'slide', power}.
 *  - golf:  10000 − strokes·1000 − min(999, seconds·5). Client sends {t:'golfDone', strokes, ms}. DNF (deadline) = 0.
 *  - horse: client physics landing score 0..100 → ×10. Client sends {t:'horseDone', score, inputs}. Miss = 0.
 */
export interface Mini {
  kind: 'slide' | 'golf' | 'horse';
  games: number[];
  backs: Record<string, number>;
  players: string[];                     // everyone playing (connected humans + bots at start)
  startedAt: number;                     // ms epoch: play opens (after the intro / explanation)
  deadline: number;                      // ms epoch: unfinished players score 0
  seed: number;                          // shared randomness (golf course pick, wind, horse positions...)
  map?: number;                          // golf: course 0..4
  mark?: number;                         // slide: target 0..1 along the bar (bar end = 1.0)
  results: Record<string, MiniResult>;   // finished players
  winner?: number;                       // winning appid
  winnerPid?: string;
  decidedAt?: number;                    // result phase follows ~3.5 s later
}
export interface MiniResult {
  score: number;                         // higher is better
  label: string;                         // human readout, e.g. "3 strokes", "9\" short", "Perfect landing!"
  at: number;
  data?: number[];                       // kind-specific replay data (slide: [dist, fell 0/1]; horse: input timeline; golf: [strokes, ms])
}

/** Whiskey Slide finale (legacy champion version; superseded by Mini kind 'slide'): each finalist game has a champion who slides a glass down the bar; closest to the mark without going off the end wins. */
export interface Slide {
  games: number[];               // 2–3 finalist appids
  champs: string[];              // champion player id per game (same index; a player may champion more than one)
  order: number[];               // slide order as indices into games
  turn: number;                  // index into order of the current slider (order.length = everyone has slid)
  turnDeadline: number;          // ms epoch; on timeout the glass is slid at a random power
  mark: number;                  // target position along the bar, 0..1 (e.g. 0.8); the bar ends at 1.0 (off the end = fell)
  throws: { game: number; power: number; dist: number; fell: boolean; at: number }[]; // dist 0..~1.15 (server-computed from power + small wobble)
  round: number;                 // 1, or 2+ for a tie-break re-slide
  winner?: number;               // winning appid once decided
  decidedAt?: number;
}

/** Card-hand draft (settings.nominations === 'draft'). Hands are PRIVATE: the server sends each player only their own hand. */
export interface Draft {
  hand: number[];                       // MY cards (appids from the pool); empty for others' views
  handCounts: Record<string, number>;   // player id -> cards in hand (public)
  burns: Record<string, number>;        // player id -> burns used (max DRAFT_BURNS)
  deck: number;                         // cards left in the deck
  offers: { id: number; from: string; to: string; give: number; at: number }[]; // open trade offers (public): "from" offers card "give" to "to"
}
export const DRAFT_HAND = 5;
export const DRAFT_BURNS = 1;

/** Sheriff role (settings.sheriff): rotates each round. */
export interface Sheriff {
  pid: string;
  pardonUsed: boolean;   // one Pardon: bring a shot-down game back (not once the finale has started)
  jailUsed: boolean;     // one Jail: the jailed player's next turn is skipped
  jailed?: string;       // player currently in jail (cleared after their skipped turn)
  votes: string[];       // players voting to run the Sheriff out of town (majority of other connected humans = ousted)
  ousted: boolean;       // run out of town: loses unused powers and their remaining turns are skipped
}

/** Saddle Up (result screen): ready check + synced launch. */
export interface Launch {
  ready: Record<string, 'ready' | 'buy' | 'download'>; // player id -> status
  launchAt?: number;     // ms epoch: synced 3-2-1 ends here; clients open steam://run/<appid>
}

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
  lastPlayed?: number; // ms epoch of the most recent time ANY owner played it (0/undefined = never or unknown)
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
  bottles?: { pid: string; name: string; score: number }[];                      // lobby target practice: top 5 at this table
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
  slide?: Slide;
  vote?: FinaleVote;  // phase 'vote'
  mini?: Mini;        // phase 'mini'
  draft?: Draft;     // present during nomination when settings.nominations === 'draft' (hand redacted per player)
  sheriff?: Sheriff; // present during the shootout when settings.sheriff
  launch?: Launch;   // present in the result phase
  /** ms epoch: the Barkeep is explaining this step until then; actions are held and clients show the big explain card */
  explainUntil?: number;
  explainText?: string; // the line being explained (for the big card)
  explainFrom?: number; // ms epoch: when that line starts
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
  | { t: 'bang'; reaction: number }
  | { t: 'slide'; power: number } // whiskey slide: current champion releases the glass; power 0..1 from the client's charge meter
  | { t: 'draftPlay'; appid: number } // play a card from my hand onto the table (counts as a nomination)
  | { t: 'draftBurn'; appid: number } // discard a card and draw a new one (max DRAFT_BURNS)
  | { t: 'draftOffer'; to: string; appid: number } // offer one of my cards to a player
  | { t: 'draftAccept'; offer: number; give: number } // accept an offer to me, giving back one of my cards
  | { t: 'draftDecline'; offer: number } // decline an offer to me (or withdraw my own)
  | { t: 'pardon'; appid: number } // Sheriff: revive a shot-down game
  | { t: 'jail'; pid: string } // Sheriff: skip that player's next turn
  | { t: 'oust' } // toggle my vote to run the Sheriff out of town
  | { t: 'ready'; status: 'ready' | 'buy' | 'download' } // Saddle Up ready check
  | { t: 'saddleUp' } // host: start the synced 3-2-1 launch
  | { t: 'resetRecord' } // host: wipe this table's history + posse record ("Lately at this table")
  | { t: 'finaleVote'; kind: FinaleKind } // lock in my vote for how to settle the finale (can change until everyone's in)
  | { t: 'back'; appid: number } // which finalist I play for (vote phase, or mini before I've played)
  | { t: 'golfDone'; strokes: number; ms: number } // mini golf: I holed out
  | { t: 'horseDone'; score: number; inputs: number[] } // horse drop: my landing score 0..100 + input timeline for replays
  | { t: 'miniMove'; data: number[] } // transient: my live state for others' ghosts (golf ball rest pos, etc.); relayed as RoomEvent 'mini'
  | { t: 'skipExplain' } // I've heard enough: when every connected human skips, the explanation hold ends
  | { t: 'bottles'; score: number }; // lobby target practice finished (0..99); keeps the table's top 5 // duel: champ fires; reaction = ms between DRAW appearing on their screen and the tap (client-measured); sent before DRAW = foul

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
  | { t: 'mini'; pid: string; data: number[]; at: number } // relayed miniMove (not stored)

export const TURN_MS = 30_000;
export const MAX_NOMS = 3;

export const boxArt = (appid: number) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`;
export const headerArt = (appid: number) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
export const heroArt = (appid: number) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`;

/** Steam screenshots of a game: GET /api/shots/<appid> → string[] of same-origin, CORS-enabled image URLs (cached). */
export const shotsUrl = (appid: number) => `/api/shots/${appid}`;

/** Same-origin, CORS-enabled proxy of Steam art (so canvases can read pixels for pixel-art processing). */
export type ArtKind = 'box' | 'header' | 'hero' | 'capsule';
export const pxArt = (appid: number, kind: ArtKind) => `/api/img/${appid}/${kind}`;
