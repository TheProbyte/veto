import { DurableObject } from 'cloudflare:workers';
import { emptyStats, type ProfileStats } from '../shared/types';
import type { Env } from './steam';

/** One per player id (idFromName('p:' + pid)). GET -> stats; POST {delta} -> add, return stats. */
export class Profile extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const st = { ...emptyStats(), ...((await this.ctx.storage.get<ProfileStats>('s')) ?? {}) };
    if (req.method === 'POST') {
      let delta: Partial<ProfileStats> = {};
      try { delta = ((await req.json()) as { delta?: Partial<ProfileStats> }).delta ?? {}; } catch {}
      let changed = false;
      for (const k of Object.keys(st) as (keyof ProfileStats)[]) {
        const v = Math.floor(Number(delta[k]));
        if (Number.isFinite(v) && v > 0 && v <= 1000) { st[k] += v; changed = true; }
      }
      if (changed) await this.ctx.storage.put('s', st);
    }
    return Response.json(st);
  }
}
