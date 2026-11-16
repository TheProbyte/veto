import type { Env } from './steam';
import { STATIC } from './static.gen';
export { Room } from './room';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{3,12})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const code = m[1].toUpperCase();
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      const fwd = new Request(req);
      fwd.headers.set('x-room', code);
      return stub.fetch(fwd);
    }
    const img = url.pathname.match(/^\/api\/img\/(\d{1,10})\/(box|header|hero|capsule)$/);
    if (img) return art(Number(img[1]), img[2]);
    if (url.pathname === '/api/search') return search(url.searchParams.get('q') ?? '', env);
    if (url.pathname === '/api/health') return Response.json({ ok: true, steamKey: !!env.STEAM_API_KEY });
    const f = STATIC[url.pathname] ?? STATIC['/index.html'];
    if (!f) return new Response('Not built', { status: 500 });
    const immutable = url.pathname.startsWith('/assets/');
    return new Response(f.body, {
      headers: { 'content-type': f.type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
    });
  },
} satisfies ExportedHandler<Env>;

// per-isolate memory cache for store search (free; avoids KV writes)
const SEARCH = new Map<string, { body: string; exp: number }>();

async function search(q: string, _env: Env): Promise<Response> {
  q = q.trim().slice(0, 60);
  if (q.length < 2) return Response.json([]);
  const key = q.toLowerCase();
  const cached = SEARCH.get(key);
  if (cached && cached.exp > Date.now()) return new Response(cached.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } });
  try {
    const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&cc=us&l=en`, {
      headers: { 'User-Agent': 'nah-game-picker/1.0' },
    });
    const j: any = await r.json();
    const hits = (j?.items ?? []).filter((x: any) => x.type === 'app').slice(0, 10).map((x: any) => ({
      appid: x.id,
      name: x.name,
      price: x.price ? `$${(x.price.final / 100).toFixed(2)}` : 'Free',
      img: x.tiny_image,
    }));
    const body = JSON.stringify(hits);
    if (SEARCH.size > 300) SEARCH.delete(SEARCH.keys().next().value!);
    SEARCH.set(key, { body, exp: Date.now() + 3600_000 });
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } });
  } catch {
    return Response.json([]);
  }
}

const ART_FILES: Record<string, string> = {
  box: 'library_600x900.jpg',
  header: 'header.jpg',
  hero: 'library_hero.jpg',
  capsule: 'capsule_231x87.jpg',
};

/** Proxies Steam art with CORS so the client can pixel-process it. Cached at the edge + 7 days in browsers. */
async function art(appid: number, kind: string): Promise<Response> {
  const src = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/${ART_FILES[kind]}`;
  const r = await fetch(src, { cf: { cacheTtl: 60 * 60 * 24 * 7, cacheEverything: true } } as RequestInit);
  const headers = new Headers({
    'access-control-allow-origin': '*',
    'cache-control': r.ok ? 'public, max-age=604800, immutable' : 'public, max-age=3600',
    'content-type': r.headers.get('content-type') ?? 'image/jpeg',
  });
  return new Response(r.ok ? r.body : null, { status: r.ok ? 200 : 404, headers });
}
