// Recorded ambience files that exist under public/sfx/. Only names listed here are ever fetched, so
// a missing file never costs a 404 probe; anything not listed falls back to the Web Audio synth.
// Entries are bare file names (the '/sfx/' prefix is optional), e.g.:
//   'rain.mp3'                          gapless rain loop
//   'thunder_1.mp3' … 'thunder_5.mp3'   regular strikes (any subset)
//   'thunder_far.mp3'                   distant, muffled roll (low intensities + now and then)
//   'thunder_big.mp3'                   the slow-mo / revenge strike (else the loudest regular one)
export const SFX_FILES = new Set<string>([
  'rain.mp3',
  'thunder_1.mp3',
  'thunder_2.mp3',
  'thunder_3.mp3',
  'thunder_big.mp3',
  'thunder_far.mp3',
]);
