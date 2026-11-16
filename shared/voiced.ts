// Recorded voice files that exist in public/voice/<id>.mp3 (ElevenLabs). Shared so the server's
// narrator prefers lines that have a recording, and the client knows what it can play.
export const VOICED = new Set<string>([
  'open_1', 'deal_1', 'draw_1', 'first_1', 'kill_1', 'kill_2', 'revenge_1', 'ricochet_1',
  'misfire_1', 'cylinder_1', 'duel_1', 'result_1',
  // emote barks
  'emote_yeehaw', 'emote_laugh', 'emote_drink', 'emote_angry',
]);
