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
- Latency (owner: "finish the delay, not just minimise it"): the game itself eased attitude like a heavy plane (~0.3 s pitch, ~0.25 s roll, camera +0.15 s). Phone and camera controls now skip that (`direct` rates in update(): ~70 ms). Ghosts are dead-reckoned to the present from sender-timestamped states (sim: avg 1.4 m off vs 22 m before). Relay tilt up to 30/s on change. A red HUD chip shows when the phone is on the relay. The relay can never be near-zero; the direct link (same Wi‑Fi) is the real answer.
- Owner's phone was on the relay (red chip) when it felt delayed. Added `src/rtc.js`: our own WebRTC link whose handshake goes through the relay room, so a direct link forms even when the public PeerJS server fails (tested: relay first, direct after ~4 s). Without TURN, two devices on different networks behind strict NATs still end up on the relay. Next step if that happens: a TURN server near India.
- Performance: owner saw fps drops after the terrain work. Far ranges now use per-vertex colours + Lambert (not the per-pixel terrain shader), canyon mesh 81 columns, no crack noise; quality ladder steps down at <50 fps (brushwork, resolution 1.25, 1.0, bloom, 0.8), each step noted in the issue log.
- Phone pairing code is kept in sessionStorage, so switching to the race canyon (a page reload) keeps the phone; the phone retries by itself.
- Racing: Razorback Canyon (`RACE` in game.js, chosen at page load; `?room=CODE` joins a room). Rooms in `src/race.js` on the Supabase project. Owner's choices: room code/link, +3 s per missed gate, a new tight canyon, racers pass through each other. Tested with two tabs against `test/fake-supabase.js`; never tested against the real Supabase service (the cloud sandbox cannot reach supabase.co).

## Next: "Guided line" gameplay (owner's decisions, asked in an interactive round)
Owner's words: the path is completely on the player today, which with an already tricky control scheme is too hard; "if the player is doing right enough control, the glide is smooth and on route".
- Style: **Guided line**. The glider rides the route by itself; the player's tilt only has to roughly match what the next bend or dip needs, inside a forgiving window. Match: glide locks smoothly onto the line and gains speed. Miss: slide off the line, slow down, must correct.
- Where: **everywhere, with levels** (Easy strong help, Normal, Pro almost none). In a race room everyone uses the host's level.
- Feedback: **glowing route ribbon** ahead showing the line, gold while on it, fading when drifting. (Not chosen: flow meter, phone buzz, sound.)
- Still to ask the owner before or while building: how wide the "right enough" window is per level, how much speed being on line gives, whether gates in races still matter when the line leads through them, and whether the ribbon replaces the gorge's glowing current.

## Queue
1. Owner playtest: race with friends on the real service, phone lag, open-palm camera mode.
2. A live tuning panel for camera and phone control (smoothing, dead zone, reach, curve).
3. Visuals: trees and meadows, water, pilot. Maybe a race leaderboard that persists.
