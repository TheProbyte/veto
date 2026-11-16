// Recorded music served same-origin under /media/ (by the worker, from KV, byte ranges supported). Only names
// listed here are ever fetched; anything not listed falls back to the procedural music / synth sting in
// src/music.ts + src/sfx.ts. Entries are bare file names (the '/media/' prefix is optional):
//   'music_lobby.mp3'            seamless loop: lobby, nominate, result (quieter in result)
//   'music_showdown_intro.mp3'   build-up, played once on entering veto / slide / duel / roulette ...
//   'music_showdown.mp3'         ... then this seamless loop
//   'sting_win.mp3'              short victory sting, replaces the synth win() ding
export const MEDIA_FILES = new Set<string>([
  'music_lobby.mp3',
  'music_showdown_intro.mp3',
  'music_showdown.mp3',
]);
