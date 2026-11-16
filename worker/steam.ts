export interface Env {
  ROOM: DurableObjectNamespace;
  PROFILE: DurableObjectNamespace;
  CACHE: KVNamespace;
  STEAM_API_KEY?: string;
  FAKE_STEAM?: string;
}

export interface OwnedGame { appid: number; name: string; mins: number; mins2w: number }
export interface StoreBits { coop: boolean; price?: string; discount?: number; free?: boolean; shots?: string[] /* up to 6 screenshot thumbnail URLs (Steam CDN only) */ }

const API = 'https://api.steampowered.com';
const UA = { 'User-Agent': 'nah-game-picker/1.0' };

/** `label` names the endpoint in logs; never log `url` (it carries the API key). */
async function getJson(url: string, label: string): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { headers: UA });
  } catch (e) {
    console.error(`steam ${label}: network error`, e instanceof Error ? e.name : 'unknown'); // message could echo the keyed URL
    throw new Error("Couldn't reach Steam. Try again in a minute.");
  }
  if (!r.ok) {
    console.error(`steam ${label}: HTTP ${r.status}`);
    throw new Error(`Steam said ${r.status}`);
  }
  try {
    return await r.json();
  } catch {
    console.error(`steam ${label}: bad JSON (HTTP ${r.status})`);
    throw new Error('Steam sent back gibberish.');
  }
}

export async function resolveSteamId(input: string, key: string): Promise<string> {
  const s = input.trim().replace(/\/+$/, '');
  let m = s.match(/profiles\/(\d{17})/);
  if (m) return m[1];
  if (/^\d{17}$/.test(s)) return s;
  m = s.match(/\/id\/([^/?#]+)/);
  const vanity = m ? m[1] : s.replace(/^https?:\/\//, '').split('/').pop() || s;
  const j = await getJson(`${API}/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(vanity)}`, 'ResolveVanityURL');
  if (j?.response?.success === 1 && j.response.steamid) return j.response.steamid;
  console.log(`steam ResolveVanityURL: no match (success=${j?.response?.success})`);
  throw new Error(`Couldn't find a Steam profile called "${vanity}". Paste your full profile link.`);
}

export async function playerSummary(id: string, key: string) {
  const j = await getJson(`${API}/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${id}`, 'GetPlayerSummaries');
  const p = j?.response?.players?.[0];
  if (!p) throw new Error('That Steam profile came back empty.');
  return { name: p.personaname as string, avatar: p.avatarfull as string };
}

/** null = library private */
export async function ownedGames(id: string, key: string): Promise<OwnedGame[] | null> {
  const j = await getJson(
    `${API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${id}&include_appinfo=1&include_played_free_games=1&format=json`,
    'GetOwnedGames',
  );
  const games = j?.response?.games;
  if (!Array.isArray(games)) {
    console.log('steam GetOwnedGames: no games array (private library?)');
    return null;
  }
  return games.map((g: any) => ({
    appid: g.appid,
    name: g.name ?? `App ${g.appid}`,
    mins: g.playtime_forever ?? 0,
    mins2w: g.playtime_2weeks ?? 0,
  }));
}

const MP_CATS = new Set([1, 9, 20, 24, 27, 36, 37, 38, 39, 47, 48, 49]);

// per-isolate memory in front of KV (KV reads/writes are capped on the free plan)
const BITS = new Map<number, StoreBits>();
const INFLIGHT = new Map<number, Promise<StoreBits | null>>();
const SHOTS_MAX = 6;
const SHOT_HOSTS = ['steamstatic.com', 'steampowered.com'];

/** only https Steam CDN/store hosts (on a dot boundary: never "evilsteamstatic.com") */
export function steamImageUrl(u: unknown): boolean {
  if (typeof u !== 'string' || u.length > 500) return false;
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const h = url.hostname.toLowerCase();
  return SHOT_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

/** appdetails JSON -> what we cache. Pure (unit-tested). */
export function parseAppDetails(appid: number, j: any): StoreBits {
  const d = j?.[appid];
  if (!d?.success || !d.data) return { coop: false, shots: [] };
  const cats: number[] = (d.data.categories ?? []).map((c: any) => c?.id);
  const po = d.data.price_overview;
  const ss: any[] = Array.isArray(d.data.screenshots) ? d.data.screenshots : [];
  const shots = ss.map((x) => x?.path_thumbnail ?? x?.path_full).filter(steamImageUrl).slice(0, SHOTS_MAX) as string[];
  return {
    coop: cats.some((c) => MP_CATS.has(c)),
    free: !!d.data.is_free,
    price: d.data.is_free ? 'Free' : po?.final_formatted,
    discount: po?.discount_percent || undefined,
    shots,
  };
}

/**
 * Store categories/price/screenshots for an app: isolate memory, then KV (`app2:`, 14 days), then Steam.
 * `cacheMiss=false` (public HTTP routes): an app Steam doesn't know is remembered in memory only, never written to KV,
 * so nobody can burn the daily KV write quota by walking random appids.
 */
export function storeBits(env: Env, appid: number, cacheMiss = true): Promise<StoreBits | null> {
  const mem = BITS.get(appid);
  if (mem) return Promise.resolve(mem);
  let p = INFLIGHT.get(appid);
  if (!p) {
    p = loadBits(env, appid, cacheMiss).finally(() => INFLIGHT.delete(appid));
    INFLIGHT.set(appid, p);
  }
  return p;
}

async function loadBits(env: Env, appid: number, cacheMiss: boolean): Promise<StoreBits | null> {
  const k = `app2:${appid}`; // app2: adds screenshots (old app: entries lack them and simply expire)
  const cached = (await env.CACHE.get(k, 'json').catch(() => null)) as StoreBits | null;
  if (cached) { remember(appid, cached); return cached; }
  let bits: StoreBits, known: boolean;
  try {
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`, { headers: UA });
    if (!r.ok) { console.error(`steam appdetails ${appid}: HTTP ${r.status}`); return null; }
    const j: any = await r.json();
    known = !!j?.[appid]?.success;
    bits = parseAppDetails(appid, j);
  } catch (e) {
    console.error(`steam appdetails ${appid}: failed`, e instanceof Error ? e.message : e);
    return null;
  }
  remember(appid, bits);
  if (known || cacheMiss) {
    // a failed put (e.g. the free plan's daily write cap) must not throw away a good answer
    try { await env.CACHE.put(k, JSON.stringify(bits), { expirationTtl: 60 * 60 * 24 * 14 }); }
    catch (e) { console.error(`kv put ${k}: failed`, e instanceof Error ? e.message : e); }
  }
  return bits;
}

function remember(appid: number, b: StoreBits) {
  if (BITS.size > 2000) BITS.delete(BITS.keys().next().value!);
  BITS.set(appid, b);
}
