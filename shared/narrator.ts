// The bartender narrator. The server picks a line for an event and broadcasts {t:'narrate', id, text}.
// Each line id maps to an optional voice file at /voice/<id>.mp3 (recorded in ElevenLabs from NARRATOR_SCRIPT.md).
// Lines are name-free on purpose so one recording works for every table.

export type NarrKey =
  | 'open' | 'join' | 'leave' | 'back' | 'bots' | 'dress' | 'deal' | 'house' | 'pitch'
  | 'draw' | 'first_blood' | 'kill' | 'spree' | 'revenge' | 'ricochet' | 'crack' | 'misfire'
  | 'fuse_low' | 'slowmo' | 'cylinder' | 'duel' | 'duel_foul' | 'duel_win'
  | 'result' | 'repeat' | 'never_survive' | 'rematch' | 'kick';

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
};

/** Pick a random line for an event (avoid repeating `lastId` when possible). */
export function pickLine(key: NarrKey, lastId?: string): NarrLine {
  const ls = NARRATOR[key].lines;
  const pool = ls.length > 1 ? ls.filter((l) => l.id !== lastId) : ls;
  return pool[Math.floor(Math.random() * pool.length)];
}
