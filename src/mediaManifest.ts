// Recorded music served same-origin under /media/ (by the worker, from KV). Only names listed here are
// ever fetched; anything not listed falls back to the procedural music / synth sting in src/music.ts + src/sfx.ts.
// Entries are bare file names (the '/media/' prefix is optional):
//   'music_lobby.mp3'      looping groove: lobby, nominate, result (quieter in result)
//   'music_showdown.mp3'   looping tension: veto, slide, duel, roulette
//   'sting_win.mp3'        short victory sting, replaces the synth win() ding
export const MEDIA_FILES = new Set<string>([]);
