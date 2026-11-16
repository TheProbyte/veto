# Nah. — build plan

> A dark saloon. Your friends sit around a table. Game boxes float into the middle.
> You take turns shooting them down until one is left.

Name: **Nah.** · package / worker name: `nah`

---

## 0. Step zero: confirm we can deploy (minutes 0–3)
- The cloud container has no Cloudflare login. We need one of these:
  - a `CLOUDFLARE_API_TOKEN` saved through the secure credential form (Workers + KV + DO edit permissions), or
  - you run `npx wrangler login`, `wrangler kv namespace create CACHE`, `wrangler secret put STEAM_API_KEY` and `npx wrangler deploy` on your own machine.
- Confirm the container can reach `api.steampowered.com` and `store.steampowered.com`.
- **Ship a hello-world deploy by about minute 8**, so deploy problems show up early instead of at the end.

## 1. Stack (unchanged from the original brief)
- One Worker serves the Vite + React + TS build (assets binding) and the `/api/*` routes.
- **One Durable Object per room** (`Room`), SQLite-backed (`new_sqlite_classes` migration, required on the free plan).
  - It uses WebSocket hibernation (`ctx.acceptWebSocket`).
  - Turn timeouts run on a **DO alarm** (`setAlarm`). State carries `turnDeadline` so clients draw the countdown themselves.
  - It is the only authority. Clients send intents (`join`, `link`, `nominate`, `fire`, `shield`, `start`) and render the full state it broadcasts. A client that reconnects gets the full state.
- **KV `CACHE`** stores `appdetails` per appid (7-day TTL).
- `STEAM_API_KEY` is a Worker secret, set in `.dev.vars` for local dev. It is never sent to the browser.

## 2. Steam
| Need | Call |
|---|---|
| URL / vanity → SteamID64 | `ISteamUser/ResolveVanityURL` (or parse `/profiles/<id>`) |
| Name + avatar | `ISteamUser/GetPlayerSummaries` |
| Library | `IPlayerService/GetOwnedGames?include_appinfo=1&include_played_free_games=1` |
| Co-op/MP tags, price, header art | `store.steampowered.com/api/appdetails?appids=X` (cached in KV) |
| Launch | `steam://run/<appid>` |

- If the library comes back empty or without `games`, the profile is **private**. Show a "Set Game Details to Public" card with the exact steps: Profile → Edit Profile → Privacy Settings → Game details: Public, and untick "Always keep my total playtime private."
- To stay under the `appdetails` rate limit (about 200 per 5 minutes), only look up the **top ~40** games in the shared and "almost" tiers, ranked by the group's total playtime. Tags fill in as they load.

## 3. Pool logic
- **Everyone owns**: owned by all linked players.
- **Almost**: owned by all but 1–2 players. Shows the faces of the missing players, the price and the discount percentage.
- Ranking: the group's total `playtime_forever`, highest first.
- Filters: multiplayer/co-op only (on by default), and "not played in the last 2 weeks" (from `playtime_2weeks`).

## 4. The saloon: how it looks
Mood reference: the dark pixel-art gunslinger image (wood walls, warm lamp light, red bandana). It's used as reference only and is **not** shipped as an asset.

**2.5D scene in pure CSS/SVG (no Three.js; it won't fit in 40 minutes):**
- Layers: back wall (wood planks, dim windows) → far seats → table (an ellipse with a perspective tilt) → near seats → foreground vignette.
- Seats sit in an arc around the table. Far seats get `filter: blur()`, smaller scale and lower brightness, which gives depth falloff.
- A hanging lamp casts a warm radial glow with a subtle flicker. Dust particles drift through the light.
- **Characters** are layered SVG cowboy silhouettes (hat, coat, bandana), colored per player from a seeded palette. Each has a nameplate and a small Steam avatar pinned like a badge.
- The current shooter's seat is lit by the lamp; everyone else stays in shadow.
- Type: a western slab display font for headings (Rye from Google Fonts) and a clean sans for the UI.

## 5. Mechanics as saloon moments
| Original rule | In the saloon |
|---|---|
| Lobby: name + Steam link | **Pull up a chair**: your character sits in the next empty seat. Linked players show a badge; private profiles show a "?" and the fix instructions. |
| Nominations (2–3 each, auto-fill) | **Toss your boxes on the table**: pick from the pool tiers, and each box slides onto the felt. If nobody nominates, the house deals the top shared games. |
| Shuffled turn order | Seats light up in shuffled order. |
| One veto per turn | **The carousel**: the boxes that are still alive drift through the center one at a time. On your turn you can **let it move on** or **shoot the one in your sights**. You must fire once per turn. |
| 30s timer → random veto | A **burning fuse / pocket watch**. When it runs out, your gun goes off on its own and hits whatever is centered (the server picks). |
| Vetoed card | Muzzle flash, screen shake, the box cracks and spins away, and a big red **"NAH."** stamp slams on it. |
| Shield (1 each) | **Tin star**: place it on a box. The next shot **ricochets** off it with a spark and a ping. |
| Pitched buy needs 2 vetoes | The first shot **cracks** the box; the second destroys it. *(Cut for v1; see below.)* |
| 3 left → roulette | **Revolver cylinder**: 6 chambers, 2 per game, with cover art in each chamber. It spins, clicks and slows; the hammer drops. **The server picks the chamber** and every client animates to the same result. |
| Result | A **WANTED poster** frame with the big header art and a **LAUNCH** button (`steam://run/<id>`). |

Sound: gunshot, ricochet, cylinder clicks, fuse hiss. Short Web Audio blips, so there are no asset files to load.

## 6. State (DO)
```ts
phase: 'lobby' | 'nominate' | 'veto' | 'roulette' | 'result'
players: { id, name, seat, palette, steam?: { id, name, avatar, private }, shieldUsed, connected }[]
pool: { appid, name, owners: string[], missing: string[], hours, price?, discount?, coop?, header? }[]
board: { appid, by: playerId, alive, shielded?: playerId, cracks: number }[]
turnOrder: playerId[], turnIdx, turnDeadline
carouselIdx
roulette?: { chambers: appid[6], target: number, startedAt }
result?: appid
log: { t, actor, action, appid }[]   // feeds the shot animations + stats later
```

## 7. Timeboxed build order (about 40 minutes)
| Minutes | Work |
|---|---|
| 0–8 | Scaffold Vite+React+Worker, `wrangler.jsonc` (assets, DO sqlite migration, KV), hello-world **deploy** |
| 8–16 | DO: rooms, join, WebSocket broadcast, reconnect. Steam link + private detection. |
| 16–22 | Pool merge (everyone owns / almost), appdetails + KV, auto-fill nominations |
| 22–32 | Saloon scene, seats, carousel, **fire** + stamp/shake, fuse + alarm timeout, tin-star shield |
| 32–37 | Revolver roulette + WANTED result screen |
| 37–40 | Final deploy, smoke test with two browser tabs |

## 8. Cut line
**In v1:** lobby, Steam linking with private-profile help, everyone owns + almost tiers, nominations (manual + auto-fill), carousel shooting turns, fuse timeout, tin-star shields, revolver roulette, WANTED result, deploy.

**Cut, in priority order for later:** pitched buys + store search (crack-then-shatter) → room history + the "you played this last 3 times" warning → stats ("fastest draw", "biggest vetoer", "nominations that never survive") → the playtime filter UI → real sound files and sprite art.
