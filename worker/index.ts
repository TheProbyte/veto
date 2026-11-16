import type { Env } from './steam';
import { STATIC } from './static.gen';
export { Room } from './room';
export { Profile } from './profile';

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
    const media = url.pathname.match(/^\/media\/([a-z0-9_-]{1,40}\.(?:mp3|m4a|ogg))$/);
    if (media) return serveMedia(req, media[1], env);
    if (url.pathname === '/api/search') return search(url.searchParams.get('q') ?? '', env);
    if (url.pathname === '/api/health') return Response.json({ ok: true, steamKey: !!env.STEAM_API_KEY });
    return serveStatic(req, url.pathname);
  },
} satisfies ExportedHandler<Env>;

// decoded binary assets, per isolate (base64 decode once, not per request)
const BIN = new Map<string, Uint8Array<ArrayBuffer>>();

function serveStatic(req: Request, path: string): Response {
  let f = STATIC[path];
  if (!f) {
    // SPA fallback for routes; real files that aren't embedded (e.g. an unrecorded /voice/<id>.mp3) are a 404
    if (/\.[a-z0-9]{2,5}$/i.test(path)) return new Response('Not found', { status: 404 });
    path = '/index.html';
    f = STATIC[path];
  }
  if (!f) return new Response('Not built', { status: 500 });
  const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : f.b64 ? 'public, max-age=86400' : 'no-cache';
  if (!f.b64) return new Response(f.body, { headers: { 'content-type': f.type, 'cache-control': cache } });
  let bytes = BIN.get(path);
  if (!bytes) {
    bytes = Uint8Array.from(atob(f.body), (c) => c.charCodeAt(0));
    BIN.set(path, bytes);
  }
  const headers = new Headers({ 'content-type': f.type, 'cache-control': cache, 'accept-ranges': 'bytes' });
  // audio elements (iOS Safari especially) ask for byte ranges
  const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  }
  return new Response(bytes, { headers });
}

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
    if (!r.ok) console.error(`steam storesearch: HTTP ${r.status}`);
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
  } catch (e) {
    console.error('steam storesearch failed', e instanceof Error ? e.message : e);
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
  let r: Response;
  try {
    r = await fetch(src, { cf: { cacheTtl: 60 * 60 * 24 * 7, cacheEverything: true } } as RequestInit);
  } catch {
    r = new Response(null, { status: 502 });
  }
  const headers = new Headers({
    'access-control-allow-origin': '*',
    'cache-control': r.ok ? 'public, max-age=604800, immutable' : 'public, max-age=3600',
    'content-type': r.headers.get('content-type') ?? 'image/jpeg',
  });
  return new Response(r.ok ? r.body : null, { status: r.ok ? 200 : 404, headers });
}

// Large audio (music tracks) lives in KV under "media:<file>" (uploaded once with `wrangler kv key put`),
// so it doesn't bloat the Worker bundle (3 MB free-plan limit). Long browser cache, byte ranges for iOS.
const MEDIA = new Map<string, Uint8Array<ArrayBuffer>>();
async function serveMedia(req: Request, file: string, env: Env): Promise<Response> {
  let bytes = MEDIA.get(file);
  if (!bytes) {
    const buf = await env.CACHE.get(`media:${file}`, 'arrayBuffer');
    if (!buf) return new Response('Not found', { status: 404 });
    bytes = new Uint8Array(buf);
    if (MEDIA.size > 6) MEDIA.delete(MEDIA.keys().next().value!);
    MEDIA.set(file, bytes);
  }
  const type = file.endsWith('.m4a') ? 'audio/mp4' : file.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
  const headers = new Headers({ 'content-type': type, 'cache-control': 'public, max-age=604800', 'accept-ranges': 'bytes' });
  const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  }
  return new Response(bytes, { headers });
}
