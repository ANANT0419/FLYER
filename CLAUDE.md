# Flyer: notes for whoever continues this

Wingsuit gliding game (three.js r128 + Vite). Live at https://flyer-aspiring-yogi.vercel.app; every push to `main` redeploys on Vercel (project `flyer`, team `aspiring-yogi`). See README.md for the file map and controls.

## How the owner works
- Wants to be asked for input on real design choices, then have it built; gives feedback in short bullet rounds after playtesting on laptop and iPhone.
- Controls are the top priority: they must feel as smooth as possible. Visuals come after.
- Keep the in-game issue log working in everything.
- Test before handing over, and say plainly what could not be tested (no GPU, camera or real phone in the cloud sandbox).
- Explain in plain language; the owner is not a programmer.

## State
- Controls: arrow keys, mouse, two arms, touch, phone glider (`src/link.js`, `src/pad.js`, relay in `src/relay.js`), camera with open palm (default), flat hand or any object (`src/hand.js`, `src/objtrack.js`).
- Phone glider: direct WebRTC via public PeerJS, Supabase Realtime relay fallback (project `flyer`, ap-south-1). Owner confirmed it connects; reported lag and that the setup screen's move list never ticked. Fixed: list ticks, tilt sent per sensor reading, screen leads slightly between messages, delay shown on setup screen. Not yet re-tested by the owner.
- Open-palm camera mode is new and untested on a real camera. The flat-hand mode was reported jittery.
- Terrain: cliffs with ledges, rim crags, ridged mountain ranges (replaced the cone mountains). `?view=sky` for an overhead check.
- Racing: Razorback Canyon (`RACE` in game.js, chosen at page load; `?room=CODE` joins a room). Rooms in `src/race.js` on the Supabase project. Owner's choices: room code/link, +3 s per missed gate, a new tight canyon, racers pass through each other. Tested with two tabs against `test/fake-supabase.js`; never tested against the real Supabase service (the cloud sandbox cannot reach supabase.co).

## Queue
1. Owner playtest: race with friends on the real service, phone lag, open-palm camera mode.
2. A live tuning panel for camera and phone control (smoothing, dead zone, reach, curve).
3. Visuals: trees and meadows, water, pilot. Maybe a race leaderboard that persists.
