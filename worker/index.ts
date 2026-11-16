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
    if (url.pathname === '/api/health') return Response.json({ ok: true, steamKey: !!env.STEAM_API_KEY });
    const f = STATIC[url.pathname] ?? STATIC['/index.html'];
    if (!f) return new Response('Not built', { status: 500 });
    const immutable = url.pathname.startsWith('/assets/');
    return new Response(f.body, {
      headers: { 'content-type': f.type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
    });
  },
} satisfies ExportedHandler<Env>;
