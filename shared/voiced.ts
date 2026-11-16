// Recorded voice files that exist in public/voice/<id>.mp3 (ElevenLabs). Shared so the server's
// narrator prefers lines that have a recording, and the client knows what it can play.
/** "Barkeep explains" lines: how long they talk (recorded length + a breath). The server holds play until they finish. */
export const EXPLAIN_MS: Record<string, number> = {
  how_lobby: 4100, how_nominate: 5400, how_draft: 3900, how_veto: 5600, how_star: 4500,
  how_slide: 5700, how_cylinder: 8100, how_duel: 8300, how_result: 6800,
  how_vote: 4700, how_golf: 4700, how_horse: 6300,
};

export const VOICED = new Set<string>([
  'open_1', 'deal_1', 'draw_1', 'first_1', 'kill_1', 'kill_2', 'revenge_1', 'ricochet_1',
  'misfire_1', 'cylinder_1', 'duel_1', 'result_1',
  // "Barkeep explains" (settings.explain)
  'how_lobby_1', 'how_nom_1', 'how_draft_1', 'how_veto_1', 'how_star_1', 'how_slide_1', 'how_cyl_1', 'how_duel_1', 'how_result_1',
  // finale vote + minigames
  'vote_1', 'how_vote_1', 'vote_revolver_1', 'vote_slide_1', 'vote_golf_1', 'vote_horse_1',
  'golf_1', 'how_golf_1', 'golf_ace_1', 'horse_1', 'how_horse_1', 'horse_perfect_1', 'horse_miss_1', 'mini_win_1',
  // bonus barks
  'launch',
  // emote barks
  'emote_yeehaw', 'emote_laugh', 'emote_drink', 'emote_angry',
  'emote_laugh_2', 'emote_angry_2', 'emote_angry_3', // extra takes: playVoice picks one at random
]);
