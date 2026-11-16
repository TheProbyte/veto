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
- ✅ = already recorded (thanks!). 🆕 = new "Barkeep explains" lines: these teach new players what to do, so they're the most useful to record next. Then the ⭐ ones (they fire the most).

## open: First player opens a new table

| File | Line | Direction |
|---|---|---|
| ✅ `open_1.mp3` | Evenin'. Pull up a chair, the night's young. | warm, slow, wiping a glass |
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
| ✅ `deal_1.mp3` | Alright. Toss your games on the table. Three apiece. | businesslike, rapping the bar |
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
| ✅ `draw_1.mp3` | Hands where I can see em. ...DRAW! | low build to a shout on DRAW |
| `draw_2.mp3` | Last game standing gets played. Make it count. |  |
| `draw_3.mp3` | Nobody leaves till there's one left. |  |

## first_blood: First game of the round is shot down

| File | Line | Direction |
|---|---|---|
| ✅ `first_1.mp3` | First blood. Somebody had to. |  |
| `first_2.mp3` | And there goes the first one. Won't be the last. |  |

## kill: A game is shot down (pick occasionally, not every shot)

| File | Line | Direction |
|---|---|---|
| ✅ `kill_1.mp3` | Nah. Ain’t happenin. |  |
| ✅ `kill_2.mp3` | Cold. Real cold. |  |
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
| ✅ `revenge_1.mp3` | Oh, that was personal. | delighted, leaning in |
| `revenge_2.mp3` | An eye for an eye. Love to see it. |  |
| `revenge_3.mp3` | Revenge is a dish best served... at my bar. |  |

## ricochet: A hidden tin star blocks a shot (the reveal)

| File | Line | Direction |
|---|---|---|
| ✅ `ricochet_1.mp3` | PING! Somebody was protectin’ that one. | surprised laugh |
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
| ✅ `misfire_1.mp3` | Fuse ran out. Gun went off on its own. |  |
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
| ✅ `cylinder_1.mp3` | Can't decide? Let the cylinder decide. | spinning the gun, mischievous |
| `cylinder_2.mp3` | Six chambers. One fate. Spin it. |  |

## duel: Quick-draw duel starts

| File | Line | Direction |
|---|---|---|
| ✅ `duel_1.mp3` | Two games. Two guns. Steady now... | hushed, tense |
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
| ✅ `result_1.mp3` | There it is. Tonight's game. Now go play it. | proud, final |
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

## slide: Whiskey Slide finale starts

| File | Line | Direction |
|---|---|---|
| `slide_1.mp3` | Alright, sharpshooters. Let's see how steady them hands really are. | sliding a glass down the bar |
| `slide_2.mp3` | Slide it to the mark. Spill it off the end and you buy the next round. |  |

## slide_fall: A glass slides off the end of the bar

| File | Line | Direction |
|---|---|---|
| `slidefall_1.mp3` | Aaand it’s on the floor. | wincing at the crash |
| `slidefall_2.mp3` | That's comin' out of your tab. |  |

## slide_close: A glass stops very near the mark

| File | Line | Direction |
|---|---|---|
| `slideclose_1.mp3` | Ooh. Right on the money. |  |
| `slideclose_2.mp3` | Now that's a steady hand. |  |

## slide_win: Whiskey Slide decided

| File | Line | Direction |
|---|---|---|
| `slidewin_1.mp3` | Closest glass wins. Drinks are on the loser. |  |

## sheriff: A Sheriff is appointed for the shootout

| File | Line | Direction |
|---|---|---|
| `sheriff_1.mp3` | There's a new Sheriff in town. Behave. | mock-serious |
| `sheriff_2.mp3` | Somebody pinned on the badge. Lord help us. |  |

## pardon: Sheriff pardons a shot-down game

| File | Line | Direction |
|---|---|---|
| `pardon_1.mp3` | The Sheriff giveth. Back from the dead! |  |
| `pardon_2.mp3` | Pardoned! Dust yourself off, partner. |  |

## jail: Sheriff jails a player

| File | Line | Direction |
|---|---|---|
| `jail_1.mp3` | Into the cell you go. Sit this one out. |  |

## ousted: The posse runs the Sheriff out of town

| File | Line | Direction |
|---|---|---|
| `ousted_1.mp3` | The people have spoken. Hand over the badge. | gleeful |
| `ousted_2.mp3` | Run outta town! Didn’t even finish their drink. |  |

## draft: Cards are dealt in draft mode

| File | Line | Direction |
|---|---|---|
| `draft_1.mp3` | Five cards each. Play em, burn em, or trade em. | dealing cards |

## trade: Two players complete a trade

| File | Line | Direction |
|---|---|---|
| `trade_1.mp3` | A deal is struck. |  |
| `trade_2.mp3` | Hope you know what you’re doin’ with that one. |  |

## burn: Someone burns a card

| File | Line | Direction |
|---|---|---|
| `burn_1.mp3` | Into the stove it goes. |  |

## how_lobby: EXPLAIN (settings.explain): lobby opens

| File | Line | Direction |
|---|---|---|
| 🆕 `how_lobby_1.mp3` | Pick your look, link your Steam, and wait for the posse. | friendly, clear, unhurried |

## how_nominate: EXPLAIN: nominations open (browse mode)

| File | Line | Direction |
|---|---|---|
| 🆕 `how_nom_1.mp3` | Tap the games you want to play. They land on the table. | clear, helpful |

## how_draft: EXPLAIN: nominations open (card draft)

| File | Line | Direction |
|---|---|---|
| 🆕 `how_draft_1.mp3` | These cards are yours. Play the ones you want. Trade the rest. | clear, helpful |

## how_veto: EXPLAIN: shootout begins

| File | Line | Direction |
|---|---|---|
| 🆕 `how_veto_1.mp3` | On your turn, aim at a game you DON'T want, and pull the trigger. | clear, slow, emphasis on DON'T |

## how_star: EXPLAIN: a few seconds into the first shootout

| File | Line | Direction |
|---|---|---|
| 🆕 `how_star_1.mp3` | Tap the badge on a game to protect it. Only you'll know. | sly whisper |

## how_slide: EXPLAIN: whiskey slide starts

| File | Line | Direction |
|---|---|---|
| 🆕 `how_slide_1.mp3` | Hold your glass, let go to slide it. Closest to the chalk wins. | clear, helpful |

## how_cylinder: EXPLAIN: revolver roulette starts

| File | Line | Direction |
|---|---|---|
| 🆕 `how_cyl_1.mp3` | Nothing to do but watch. The cylinder picks. | calm |

## how_duel: EXPLAIN: quick-draw duel starts

| File | Line | Direction |
|---|---|---|
| 🆕 `how_duel_1.mp3` | Wait for DRAW. Then tap as fast as you can. Too early, you lose. | tense, clear |

## how_result: EXPLAIN: result screen

| File | Line | Direction |
|---|---|---|
| 🆕 `how_result_1.mp3` | Mark yourself ready, then saddle up together. | warm |

## saddle: Synced launch countdown starts

| File | Line | Direction |
|---|---|---|
| `saddle_1.mp3` | Saddle up! Three... two... one... | big, rallying |

## straggler: Launch countdown starts but someone isn't ready

| File | Line | Direction |
|---|---|---|
| `straggler_1.mp3` | Somebody's still downloadin'. Shameful. |  |
| `straggler_2.mp3` | Some of y’all ain’t got the game. Buy it, partner. |  |

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
