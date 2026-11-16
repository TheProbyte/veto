// The bartender narrator. The server picks a line for an event and broadcasts {t:'narrate', id, text}.
// Each line id maps to an optional voice file at /voice/<id>.mp3 (recorded in ElevenLabs from NARRATOR_SCRIPT.md).
// Lines are name-free on purpose so one recording works for every table.

import { VOICED } from './voiced';

export type NarrKey =
  | 'open' | 'join' | 'leave' | 'back' | 'bots' | 'dress' | 'deal' | 'house' | 'pitch'
  | 'draw' | 'first_blood' | 'kill' | 'spree' | 'revenge' | 'ricochet' | 'crack' | 'misfire'
  | 'fuse_low' | 'slowmo' | 'cylinder' | 'duel' | 'duel_foul' | 'duel_win'
  | 'result' | 'repeat' | 'never_survive' | 'rematch' | 'kick'
  | 'slide' | 'slide_fall' | 'slide_close' | 'slide_win'
  | 'sheriff' | 'pardon' | 'jail' | 'ousted'
  | 'draft' | 'trade' | 'burn'
  | 'saddle' | 'straggler'
  | 'vote' | 'golf' | 'horse' | 'how_vote' | 'how_golf' | 'how_horse'
  | 'how_lobby' | 'how_nominate' | 'how_draft' | 'how_veto' | 'how_star' | 'how_slide' | 'how_cylinder' | 'how_duel' | 'how_result';

export interface NarrLine { id: string; text: string; direction?: string }

export const NARRATOR: Record<NarrKey, { when: string; lines: NarrLine[] }> = {
  open: { when: 'First player opens a new table', lines: [
    { id: 'open_1', text: "Evenin'. Pull up a chair, the night's young.", direction: 'warm, slow, wiping a glass' },
    { id: 'open_2', text: "Doors are open. Bring your friends and your grudges." },
    { id: 'open_3', text: "Another night, another argument over what to play." },
  ] },
  join: { when: 'A player sits down', lines: [
    { id: 'join_1', text: 'Another stranger walks in.' },
    { id: 'join_2', text: "Well look what the storm dragged in." },
    { id: 'join_3', text: "Take a seat. Mind the bullet holes." },
    { id: 'join_4', text: "Fresh face. Hope you brought your library." },
  ] },
  leave: { when: 'A player disconnects', lines: [
    { id: 'leave_1', text: "And just like that, they're gone. Into the rain." },
    { id: 'leave_2', text: 'Somebody stepped out for air.' },
  ] },
  back: { when: 'A player reconnects', lines: [
    { id: 'back_1', text: 'Look who stumbled back in.' },
    { id: 'back_2', text: "Couldn't stay away, could ya." },
  ] },
  bots: { when: 'Host adds practice bots', lines: [
    { id: 'bots_1', text: "Hired a few hands for practice. They don't talk much.", direction: 'dry, amused' },
    { id: 'bots_2', text: "These boys work for drinks. Go easy on 'em." },
  ] },
  dress: { when: 'Someone finishes dressing up', lines: [
    { id: 'dress_1', text: 'Lookin’ sharp, partner.' },
    { id: 'dress_2', text: "Now that's a hat." },
  ] },
  deal: { when: 'Host deals: nominations open', lines: [
    { id: 'deal_1', text: "Alright. Toss your games on the table. Three apiece.", direction: 'businesslike, rapping the bar' },
    { id: 'deal_2', text: "Let's see what y'all are bringin' to the fight." },
  ] },
  house: { when: 'The house auto-fills empty nominations', lines: [
    { id: 'house_1', text: "Nobody's pickin'? Fine. The house deals." },
    { id: 'house_2', text: "House rules: if you won't choose, I will." },
  ] },
  pitch: { when: 'Someone pitches a game to buy', lines: [
    { id: 'pitch_1', text: 'Somebody wants y’all to open your wallets.' },
    { id: 'pitch_2', text: 'A salesman at my bar. Bold.' },
  ] },
  draw: { when: 'Shootout begins', lines: [
    { id: 'draw_1', text: 'Hands where I can see em. ...DRAW!', direction: 'low build to a shout on DRAW' },
    { id: 'draw_2', text: 'Last game standing gets played. Make it count.' },
    { id: 'draw_3', text: "Nobody leaves till there's one left." },
  ] },
  first_blood: { when: 'First game of the round is shot down', lines: [
    { id: 'first_1', text: 'First blood. Somebody had to.' },
    { id: 'first_2', text: "And there goes the first one. Won't be the last." },
  ] },
  kill: { when: 'A game is shot down (pick occasionally, not every shot)', lines: [
    { id: 'kill_1', text: 'Nah. Ain’t happenin.' },
    { id: 'kill_2', text: 'Cold. Real cold.' },
    { id: 'kill_3', text: 'That one ain’t gettin’ up.' },
    { id: 'kill_4', text: 'Somebody fetch a shovel.' },
    { id: 'kill_5', text: 'Clean shot.' },
  ] },
  spree: { when: 'Same player has 3+ kills this round', lines: [
    { id: 'spree_1', text: "Somebody's on a tear tonight." },
    { id: 'spree_2', text: 'Trigger finger’s gettin’ itchy.' },
  ] },
  revenge: { when: 'Revenge shot: shooter avenges their own killed pick', lines: [
    { id: 'revenge_1', text: 'Oh, that was personal.', direction: 'delighted, leaning in' },
    { id: 'revenge_2', text: 'An eye for an eye. Love to see it.' },
    { id: 'revenge_3', text: "Revenge is a dish best served... at my bar." },
  ] },
  ricochet: { when: 'A hidden tin star blocks a shot (the reveal)', lines: [
    { id: 'ricochet_1', text: 'PING! Somebody was protectin’ that one.', direction: 'surprised laugh' },
    { id: 'ricochet_2', text: 'Ricochet! There was a star on it the whole time.' },
    { id: 'ricochet_3', text: 'Ha! Sneaky. Real sneaky.' },
  ] },
  crack: { when: 'A pitched buy survives its first shot', lines: [
    { id: 'crack_1', text: "It's cracked, but it's still kickin'." },
    { id: 'crack_2', text: 'Store-bought games are tougher. One more shot.' },
  ] },
  misfire: { when: 'Fuse ran out, the gun went off on its own', lines: [
    { id: 'misfire_1', text: 'Fuse ran out. Gun went off on its own.' },
    { id: 'misfire_2', text: 'Too slow, partner. The iron decided for ya.' },
  ] },
  fuse_low: { when: 'Shooter has 5 seconds left', lines: [
    { id: 'fuse_1', text: 'Clock’s tickin’...', direction: 'tense whisper' },
    { id: 'fuse_2', text: 'Any day now.' },
  ] },
  slowmo: { when: 'The shot that brings it to the finale', lines: [
    { id: 'slowmo_1', text: 'And that... changes everything.', direction: 'slow, dramatic' },
  ] },
  cylinder: { when: 'Revolver roulette starts', lines: [
    { id: 'cylinder_1', text: "Can't decide? Let the cylinder decide.", direction: 'spinning the gun, mischievous' },
    { id: 'cylinder_2', text: 'Six chambers. One fate. Spin it.' },
  ] },
  duel: { when: 'Quick-draw duel starts', lines: [
    { id: 'duel_1', text: 'Two games. Two guns. Steady now...', direction: 'hushed, tense' },
    { id: 'duel_2', text: 'Wait for it... wait for it...' },
  ] },
  duel_foul: { when: 'A champion fires before DRAW', lines: [
    { id: 'foul_1', text: 'Jumped the gun! That’s a foul.' },
    { id: 'foul_2', text: 'Too eager. That’ll cost ya.' },
  ] },
  duel_win: { when: 'Duel decided', lines: [
    { id: 'duelwin_1', text: 'Fastest gun in the West.' },
    { id: 'duelwin_2', text: "Didn't even see 'em move." },
  ] },
  result: { when: 'Winner revealed', lines: [
    { id: 'result_1', text: "There it is. Tonight's game. Now go play it.", direction: 'proud, final' },
    { id: 'result_2', text: "Wanted: one good night. Reward: this game." },
    { id: 'result_3', text: 'The dust settles. We have a winner.' },
  ] },
  repeat: { when: 'Winner was also picked last time', lines: [
    { id: 'repeat_1', text: 'This again? Y’all are creatures of habit.', direction: 'teasing' },
    { id: 'repeat_2', text: "Same game as last time. I ain't judgin'. ...I'm judgin'." },
  ] },
  never_survive: { when: 'Result screen: table has a game nominated many times that never wins', lines: [
    { id: 'never_1', text: 'Some games just ain’t meant to make it.' },
  ] },
  rematch: { when: 'Host calls a rematch', lines: [
    { id: 'rematch_1', text: "Rematch! Same games, same grudges." },
    { id: 'rematch_2', text: 'Nobody liked that outcome? Again!' },
  ] },
  kick: { when: 'Host kicks a player or bot', lines: [
    { id: 'kick_1', text: 'And stay out!' },
  ] },
  slide: { when: 'Whiskey Slide finale starts', lines: [
    { id: 'slide_1', text: "Alright, sharpshooters. Let's see how steady them hands really are.", direction: 'sliding a glass down the bar' },
    { id: 'slide_2', text: 'Slide it to the mark. Spill it off the end and you buy the next round.' },
  ] },
  slide_fall: { when: 'A glass slides off the end of the bar', lines: [
    { id: 'slidefall_1', text: 'Aaand it’s on the floor.', direction: 'wincing at the crash' },
    { id: 'slidefall_2', text: "That's comin' out of your tab." },
  ] },
  slide_close: { when: 'A glass stops very near the mark', lines: [
    { id: 'slideclose_1', text: 'Ooh. Right on the money.' },
    { id: 'slideclose_2', text: "Now that's a steady hand." },
  ] },
  slide_win: { when: 'Whiskey Slide decided', lines: [
    { id: 'slidewin_1', text: 'Closest glass wins. Drinks are on the loser.' },
  ] },
  sheriff: { when: 'A Sheriff is appointed for the shootout', lines: [
    { id: 'sheriff_1', text: "There's a new Sheriff in town. Behave.", direction: 'mock-serious' },
    { id: 'sheriff_2', text: 'Somebody pinned on the badge. Lord help us.' },
  ] },
  pardon: { when: 'Sheriff pardons a shot-down game', lines: [
    { id: 'pardon_1', text: 'The Sheriff giveth. Back from the dead!' },
    { id: 'pardon_2', text: 'Pardoned! Dust yourself off, partner.' },
  ] },
  jail: { when: 'Sheriff jails a player', lines: [
    { id: 'jail_1', text: 'Into the cell you go. Sit this one out.' },
  ] },
  ousted: { when: 'The posse runs the Sheriff out of town', lines: [
    { id: 'ousted_1', text: 'The people have spoken. Hand over the badge.', direction: 'gleeful' },
    { id: 'ousted_2', text: 'Run outta town! Didn’t even finish their drink.' },
  ] },
  draft: { when: 'Cards are dealt in draft mode', lines: [
    { id: 'draft_1', text: 'Five cards each. Play em, burn em, or trade em.', direction: 'dealing cards' },
  ] },
  trade: { when: 'Two players complete a trade', lines: [
    { id: 'trade_1', text: 'A deal is struck.' },
    { id: 'trade_2', text: 'Hope you know what you’re doin’ with that one.' },
  ] },
  burn: { when: 'Someone burns a card', lines: [
    { id: 'burn_1', text: 'Into the stove it goes.' },
  ] },
  vote: { when: 'Finale vote opens', lines: [
    { id: 'vote_1', text: "Down to the last few. How we settlin' this?", direction: 'leaning in' },
  ] },
  golf: { when: 'Mini golf finale starts', lines: [
    { id: 'golf_1', text: 'Mini golf. In a saloon. Don’t ask.', direction: 'deadpan' },
  ] },
  horse: { when: 'Horse drop finale starts', lines: [
    { id: 'horse_1', text: 'Up on the roof, cowboys. Mind the horse.', direction: 'amused' },
  ] },
  how_vote: { when: 'EXPLAIN: finale vote', lines: [
    { id: 'how_vote_1', text: 'Pick how we settle it, and which game you play for. Lock it in.', direction: 'clear' },
  ] },
  how_golf: { when: 'EXPLAIN: mini golf', lines: [
    { id: 'how_golf_1', text: 'Drag back to aim, let go to putt. Fewest strokes wins.', direction: 'clear' },
  ] },
  how_horse: { when: 'EXPLAIN: horse drop', lines: [
    { id: 'how_horse_1', text: 'Hold to jump and tuck, let go to open up. Land straight in the saddle.', direction: 'clear' },
  ] },
  how_lobby: { when: 'EXPLAIN (settings.explain): lobby opens', lines: [
    { id: 'how_lobby_1', text: "Pick your look, link your Steam, and wait for the posse.", direction: 'friendly, clear, unhurried' },
  ] },
  how_nominate: { when: 'EXPLAIN: nominations open (browse mode)', lines: [
    { id: 'how_nom_1', text: 'Tap the games you want to play. They land on the table.', direction: 'clear, helpful' },
  ] },
  how_draft: { when: 'EXPLAIN: nominations open (card draft)', lines: [
    { id: 'how_draft_1', text: 'These cards are yours. Play the ones you want. Trade the rest.', direction: 'clear, helpful' },
  ] },
  how_veto: { when: 'EXPLAIN: shootout begins', lines: [
    { id: 'how_veto_1', text: "On your turn, aim at a game you DON'T want, and pull the trigger.", direction: 'clear, slow, emphasis on DON\'T' },
  ] },
  how_star: { when: "EXPLAIN: a few seconds into the first shootout", lines: [
    { id: 'how_star_1', text: "Tap the badge on a game to protect it. Only you'll know.", direction: 'sly whisper' },
  ] },
  how_slide: { when: 'EXPLAIN: whiskey slide starts', lines: [
    { id: 'how_slide_1', text: 'Hold your glass, let go to slide it. Closest to the chalk wins.', direction: 'clear, helpful' },
  ] },
  how_cylinder: { when: 'EXPLAIN: revolver roulette starts', lines: [
    { id: 'how_cyl_1', text: 'Nothing to do but watch. The cylinder picks.', direction: 'calm' },
  ] },
  how_duel: { when: 'EXPLAIN: quick-draw duel starts', lines: [
    { id: 'how_duel_1', text: 'Wait for DRAW. Then tap as fast as you can. Too early, you lose.', direction: 'tense, clear' },
  ] },
  how_result: { when: 'EXPLAIN: result screen', lines: [
    { id: 'how_result_1', text: 'Mark yourself ready, then saddle up together.', direction: 'warm' },
  ] },
  saddle: { when: 'Synced launch countdown starts', lines: [
    { id: 'saddle_1', text: 'Saddle up! Three... two... one...', direction: 'big, rallying' },
  ] },
  straggler: { when: "Launch countdown starts but someone isn't ready", lines: [
    { id: 'straggler_1', text: "Somebody's still downloadin'. Shameful." },
    { id: 'straggler_2', text: 'Some of y’all ain’t got the game. Buy it, partner.' },
  ] },
};

/** Pick a random line for an event (avoid repeating `lastId` when possible). */
export function pickLine(key: NarrKey, lastId?: string): NarrLine {
  // prefer lines that have a recorded voice; fall back to caption-only lines
  const voiced = NARRATOR[key].lines.filter((l) => VOICED.has(l.id));
  const ls = voiced.length ? voiced : NARRATOR[key].lines;
  const pool = ls.length > 1 ? ls.filter((l) => l.id !== lastId) : ls;
  return pool[Math.floor(Math.random() * pool.length)];
}
