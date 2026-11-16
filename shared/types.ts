// Shared contract between the Durable Object (server) and the React client.
export type Phase = 'lobby' | 'nominate' | 'veto' | 'roulette' | 'result';

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
export const LOOK_COUNTS: Record<keyof Look, number> = {
  hat: 6, hatColor: 6, skin: 5, face: 6, hair: 5, bandana: 6, coat: 6,
};
export const LOOK_LABELS: Record<keyof Look, string[]> = {
  hat: ['Wide brim', 'Bowler', 'Top hat', 'Sombrero', 'Flat cap', 'No hat'],
  hatColor: ['Dust', 'Coal', 'Rust', 'Cream', 'Oxblood', 'Slate'],
  skin: ['Pale', 'Fair', 'Tan', 'Brown', 'Deep'],
  face: ['Clean', 'Stubble', 'Moustache', 'Full beard', 'Goatee', 'Scarred'],
  hair: ['Black', 'Brown', 'Ginger', 'Blond', 'Grey'],
  bandana: ['None', 'Blood red', 'Navy', 'Black', 'Mustard', 'Green'],
  coat: ['Duster', 'Black', 'Leather', 'Blue', 'Grey', 'Hide'],
};
export const randomLook = (): Look => {
  const o = {} as Look;
  for (const k of Object.keys(LOOK_COUNTS) as (keyof Look)[]) o[k] = Math.floor(Math.random() * LOOK_COUNTS[k]);
  return o;
};

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
  shieldedBy?: string; // player id whose tin star protects it
  killedBy?: string;
}

export interface ShotEvent {
  id: number; // monotonically increasing; clients animate when it changes
  t: number;
  actor: string; // player id
  appid: number;
  kind: 'hit' | 'ricochet' | 'misfire' | 'crack'; // misfire = fuse ran out, gun went off on its own; crack = pitched buy survived its first shot (cracks=1)
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

export interface HistoryEntry { appid: number; name: string; t: number }

export interface RoomState {
  code: string;
  phase: Phase;
  players: Player[];
  pool: PoolGame[];
  poolLoading: boolean;
  pitches: Pitch[];
  board: BoardGame[];
  turnOrder: string[];
  turnIdx: number;
  turnDeadline: number; // ms epoch, 0 when no turn running
  aim?: number; // appid currently centered in the shooter's sights
  lastShot?: ShotEvent;
  shots: ShotEvent[];
  roulette?: Roulette;
  result?: { appid: number; name: string; repeatCount: number };
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
  | { t: 'again' }; // host: back to nominate

// server -> client
export type ServerMsg =
  | { t: 'state'; state: RoomState; you: string }
  | { t: 'error'; message: string };

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
