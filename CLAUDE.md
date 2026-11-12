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
- Message budget: the Supabase free plan allows ~100 Realtime messages/s for the whole project. The owner's first live race hit it ("MessagePerSecondRateLimitReached", 429s in realtime logs) and phone tilt on the relay was dropped. Now: one shared client per page (`src/rt.js`), nothing sent while disconnected (no REST fallback), relay tilt ≤15/s and only on change, race positions 4/s. Check `realtime_logs` with the Supabase MCP if races stutter again; upgrading the plan or moving race traffic peer-to-peer are the next steps.
- Latency (owner: "finish the delay, not just minimise it", then "make it zero practically"): the phone sends each reading with its gyro rate (units and sign auto-fitted against the change in angle, `src/predict.js`) and its own timestamp. The screen syncs clocks from its pings, dates each reading, and draws where the phone is now plus ~50 ms (display + smoothing). Game easing for phone attitude ~15 ms (camera stays ~70 ms). Simulated (`node test/predict-sim.mjs`): direct Wi-Fi 106 → 4 ms behind, relay 164 → 48 ms. Two-browser link test (`node test/phone-e2e.cjs`, `DELAY=40` adds network delay; needs `npx peerjs --port 9000 --host 127.0.0.1` and vite on 5173): 58 → 1 ms. Not yet felt on a real phone: watch for overshoot when stopping a fast tilt (lead capped at 18° direct / 25° relay). Ghosts are dead-reckoned (race.js). A red HUD chip shows when the phone is on the relay.
- Performance: owner saw fps drops after the terrain work. Far ranges now use per-vertex colours + Lambert (not the per-pixel terrain shader), canyon mesh 81 columns, no crack noise; quality ladder steps down at <50 fps (brushwork, resolution 1.25, 1.0, bloom, 0.8), each step noted in the issue log.
- Phone pairing code is kept in sessionStorage, so switching to the race canyon (a page reload) keeps the phone; the phone retries by itself.
- Racing: Razorback Canyon (`RACE` in game.js, chosen at page load; `?room=CODE` joins a room). Rooms in `src/race.js` on the Supabase project. Owner's choices: room code/link, +3 s per missed gate, a new tight canyon, racers pass through each other. Tested with two tabs against `test/fake-supabase.js`; never tested against the real Supabase service (the cloud sandbox cannot reach supabase.co).

## Guided line (built; owner's choices, asked in two interactive rounds)
Owner's words: the path was completely on the player, too hard with tricky controls; "if the player is doing right enough control, the glide is smooth and on route".
- The route is the old wind current's line (`routePoint` in game.js); in the race canyon it is bent to thread every gate's centre (`gateDh`).
- `guide(dt)`: pure pursuit to a point ~0.8 s ahead gives the tilt the line needs (`needP`, `needT`). If the player's tilt is within the level's window (and leans into any real bend or dip by at least `lean` of what it needs), `G.lock` rises; the line then takes over `str` of the steering and `linePull` draws the glider onto it sideways/vertically. Miss: lock fades, you drift and lose speed.
- Levels (`GUIDE`): Easy window 0.5 / lean 30% / takes 90%; Normal 0.25 / 50% / 60%; Pro 0.1 / 70% / 15%. On the line: +15% speed (`G.flow`). Default Easy. Picked under Guide on the start and pause screens.
- Race rooms: the host's level, sent in the start signal and shown in the lobby (presence carries each player's level). Gates and +3 s stay; the line leads through them.
- The gold ribbon (camera-facing band, `ribbonMat`) replaced the current tube; the current's own steering assists were removed (the line does that now). The HUD chip says ON THE LINE.
- Tests: `node test/guide-sim.cjs [gorge|coaster|race]` flies scripted pilots on each level (needs `npx vite --port 5173`); `node test/race-guide.cjs` checks the host's level reaches a guest (needs `FAKE_RT=1 npx vite --port 5174`). Simulated: hands-off fails on every level; Easy carries even a sloppy pilot in the gorge; Pro needs a good one. Coaster is hardest (big pitch demands). Not yet played by the owner: the numbers need their feel.

## Queue
1. Owner playtest: guided line levels (feel of window/speed), phone delay with prediction, race with friends on the real service, open-palm camera mode.
2. A live tuning panel for camera and phone control (smoothing, dead zone, reach, curve).
3. Visuals: trees and meadows, water, pilot. Maybe a race leaderboard that persists.
