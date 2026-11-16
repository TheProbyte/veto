// Sound effects API (Web Audio synthesis, no asset files). Implementation owned by the "sounds+panels" agent.
// All functions are safe to call before user gesture (they no-op until unlock()).
export const sfx = {
  unlock() {},            // call on first user click/keydown; resumes AudioContext
  setMuted(_m: boolean) {},
  isMuted(): boolean { return false; },
  ambience(_on: boolean) {}, // low wind + distant saloon piano loop
  shot() {},              // gunshot (veto hit)
  ricochet() {},          // shot deflected by tin star
  stamp() {},             // heavy NAH. stamp thud
  click() {},             // revolver cylinder click / UI tick
  cock() {},              // hammer cocked (your turn starts)
  fuse(_on: boolean) {},  // fuse hiss loop while your turn timer burns (last 10s)
  whoosh() {},            // box sliding / carousel move
  chair() {},             // player sits down
  win() {},               // result reveal sting
  tick() {},              // countdown tick (last 5s)
};
