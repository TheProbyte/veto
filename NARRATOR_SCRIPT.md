# Nah. — Barkeep voice script (ElevenLabs)

The narrator is the **Barkeep**: an old, gravel-voiced saloon bartender who has seen a thousand
game nights. Dry, amused, a little theatrical. Think "grizzled cowboy storyteller", not cartoon.

## Recording guide
- **Voice:** older male (or female) Western drawl, low and warm, slight rasp. In ElevenLabs try a
  "narrator / old storyteller" voice, Stability ~35–45%, Similarity ~75%, Style ~30–45%.
- **Keep it short:** each line should be 1–3 seconds. Leave ~150 ms of silence at the start and end.
- **One file per line**, named exactly `<id>.mp3` (e.g. `kill_2.mp3`). MP3, mono is fine, 64–96 kbps.
- **Don't say player or game names** — the lines are written to work at every table.
- Send me the files (or a zip) and I'll drop them into `public/voice/`; the game plays them
  automatically under the Effects volume, with the caption on screen.
- You don't need all of them. Start with the ⭐ ones (they fire the most).

## open: First player opens a new table

| File | Line | Direction |
|---|---|---|
| `open_1.mp3` | Evenin'. Pull up a chair, the night's young. | warm, slow, wiping a glass |
| `open_2.mp3` | Doors are open. Bring your friends and your grudges. |  |
| `open_3.mp3` | Another night, another argument over what to play. |  |

## join: A player sits down

| File | Line | Direction |
|---|---|---|
| ⭐ `join_1.mp3` | Another stranger walks in. |  |
| `join_2.mp3` | Well look what the storm dragged in. |  |
| `join_3.mp3` | Take a seat. Mind the bullet holes. |  |
| `join_4.mp3` | Fresh face. Hope you brought your library. |  |

## leave: A player disconnects

| File | Line | Direction |
|---|---|---|
| `leave_1.mp3` | And just like that, they're gone. Into the rain. |  |
| `leave_2.mp3` | Somebody stepped out for air. |  |

## back: A player reconnects

| File | Line | Direction |
|---|---|---|
| `back_1.mp3` | Look who stumbled back in. |  |
| `back_2.mp3` | Couldn't stay away, could ya. |  |

## bots: Host adds practice bots

| File | Line | Direction |
|---|---|---|
| `bots_1.mp3` | Hired a few hands for practice. They don't talk much. | dry, amused |
| `bots_2.mp3` | These boys work for drinks. Go easy on 'em. |  |

## dress: Someone finishes dressing up

| File | Line | Direction |
|---|---|---|
| `dress_1.mp3` | Lookin’ sharp, partner. |  |
| `dress_2.mp3` | Now that's a hat. |  |

## deal: Host deals: nominations open

| File | Line | Direction |
|---|---|---|
| ⭐ `deal_1.mp3` | Alright. Toss your games on the table. Three apiece. | businesslike, rapping the bar |
| `deal_2.mp3` | Let's see what y'all are bringin' to the fight. |  |

## house: The house auto-fills empty nominations

| File | Line | Direction |
|---|---|---|
| `house_1.mp3` | Nobody's pickin'? Fine. The house deals. |  |
| `house_2.mp3` | House rules: if you won't choose, I will. |  |

## pitch: Someone pitches a game to buy

| File | Line | Direction |
|---|---|---|
| `pitch_1.mp3` | Somebody wants y’all to open your wallets. |  |
| `pitch_2.mp3` | A salesman at my bar. Bold. |  |

## draw: Shootout begins

| File | Line | Direction |
|---|---|---|
| ⭐ `draw_1.mp3` | Hands where I can see em. ...DRAW! | low build to a shout on DRAW |
| `draw_2.mp3` | Last game standing gets played. Make it count. |  |
| `draw_3.mp3` | Nobody leaves till there's one left. |  |

## first_blood: First game of the round is shot down

| File | Line | Direction |
|---|---|---|
| ⭐ `first_1.mp3` | First blood. Somebody had to. |  |
| `first_2.mp3` | And there goes the first one. Won't be the last. |  |

## kill: A game is shot down (pick occasionally, not every shot)

| File | Line | Direction |
|---|---|---|
| ⭐ `kill_1.mp3` | Nah. Ain’t happenin. |  |
| ⭐ `kill_2.mp3` | Cold. Real cold. |  |
| `kill_3.mp3` | That one ain’t gettin’ up. |  |
| `kill_4.mp3` | Somebody fetch a shovel. |  |
| `kill_5.mp3` | Clean shot. |  |

## spree: Same player has 3+ kills this round

| File | Line | Direction |
|---|---|---|
| `spree_1.mp3` | Somebody's on a tear tonight. |  |
| `spree_2.mp3` | Trigger finger’s gettin’ itchy. |  |

## revenge: Revenge shot: shooter avenges their own killed pick

| File | Line | Direction |
|---|---|---|
| ⭐ `revenge_1.mp3` | Oh, that was personal. | delighted, leaning in |
| `revenge_2.mp3` | An eye for an eye. Love to see it. |  |
| `revenge_3.mp3` | Revenge is a dish best served... at my bar. |  |

## ricochet: A hidden tin star blocks a shot (the reveal)

| File | Line | Direction |
|---|---|---|
| ⭐ `ricochet_1.mp3` | PING! Somebody was protectin’ that one. | surprised laugh |
| `ricochet_2.mp3` | Ricochet! There was a star on it the whole time. |  |
| `ricochet_3.mp3` | Ha! Sneaky. Real sneaky. |  |

## crack: A pitched buy survives its first shot

| File | Line | Direction |
|---|---|---|
| `crack_1.mp3` | It's cracked, but it's still kickin'. |  |
| `crack_2.mp3` | Store-bought games are tougher. One more shot. |  |

## misfire: Fuse ran out, the gun went off on its own

| File | Line | Direction |
|---|---|---|
| ⭐ `misfire_1.mp3` | Fuse ran out. Gun went off on its own. |  |
| `misfire_2.mp3` | Too slow, partner. The iron decided for ya. |  |

## fuse_low: Shooter has 5 seconds left

| File | Line | Direction |
|---|---|---|
| `fuse_1.mp3` | Clock’s tickin’... | tense whisper |
| `fuse_2.mp3` | Any day now. |  |

## slowmo: The shot that brings it to the finale

| File | Line | Direction |
|---|---|---|
| `slowmo_1.mp3` | And that... changes everything. | slow, dramatic |

## cylinder: Revolver roulette starts

| File | Line | Direction |
|---|---|---|
| ⭐ `cylinder_1.mp3` | Can't decide? Let the cylinder decide. | spinning the gun, mischievous |
| `cylinder_2.mp3` | Six chambers. One fate. Spin it. |  |

## duel: Quick-draw duel starts

| File | Line | Direction |
|---|---|---|
| `duel_1.mp3` | Two games. Two guns. Steady now... | hushed, tense |
| ⭐ `duel_2.mp3` | Wait for it... wait for it... |  |

## duel_foul: A champion fires before DRAW

| File | Line | Direction |
|---|---|---|
| `foul_1.mp3` | Jumped the gun! That’s a foul. |  |
| `foul_2.mp3` | Too eager. That’ll cost ya. |  |

## duel_win: Duel decided

| File | Line | Direction |
|---|---|---|
| `duelwin_1.mp3` | Fastest gun in the West. |  |
| `duelwin_2.mp3` | Didn't even see 'em move. |  |

## result: Winner revealed

| File | Line | Direction |
|---|---|---|
| ⭐ `result_1.mp3` | There it is. Tonight's game. Now go play it. | proud, final |
| `result_2.mp3` | Wanted: one good night. Reward: this game. |  |
| `result_3.mp3` | The dust settles. We have a winner. |  |

## repeat: Winner was also picked last time

| File | Line | Direction |
|---|---|---|
| `repeat_1.mp3` | This again? Y’all are creatures of habit. | teasing |
| `repeat_2.mp3` | Same game as last time. I ain't judgin'. ...I'm judgin'. |  |

## never_survive: Result screen: table has a game nominated many times that never wins

| File | Line | Direction |
|---|---|---|
| `never_1.mp3` | Some games just ain’t meant to make it. |  |

## rematch: Host calls a rematch

| File | Line | Direction |
|---|---|---|
| `rematch_1.mp3` | Rematch! Same games, same grudges. |  |
| `rematch_2.mp3` | Nobody liked that outcome? Again! |  |

## kick: Host kicks a player or bot

| File | Line | Direction |
|---|---|---|
| `kick_1.mp3` | And stay out! |  |

## Bonus barks (optional, I can wire these in too)

These aren't narrator lines; they're short one-shot voices that would play on player actions.
Same naming rule: send them as `<id>.mp3`.

| File | Where it goes | Line / sound |
|---|---|---|
| `emote_yeehaw.mp3` | Yeehaw emote | "Yeeeehaw!" |
| `emote_laugh.mp3` | Laugh emote | a short belly laugh, "Ha-HA!" |
| `emote_tip.mp3` | Tip hat emote | "Ma'am." / "Partner." |
| `emote_angry.mp3` | Fume emote | "Why I oughta..." |
| `emote_drink.mp3` | Drink emote | a gulp and "Ahh." |
| `duel_steady.mp3` | Duel countdown | "Steady..." (whispered) |
| `duel_draw.mp3` | Duel DRAW moment | "DRAW!" (sharp shout, no lead-in) |
| `fire_shout.mp3` | Random on FIRE (20%) | "Eat lead!" |
| `star_pin.mp3` | Pinning a tin star | "This one's mine." (whisper) |
| `launch.mp3` | LAUNCH button | "Saddle up." |
