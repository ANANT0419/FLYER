# Flyer: notes for whoever continues this

Wingsuit gliding game (three.js r128 + Vite). Live at https://flyer-aspiring-yogi.vercel.app; every push to `main` redeploys on Vercel (project `flyer`, team `aspiring-yogi`). See README.md for the file map and controls.

## How the owner works
- Wants to be asked for input on real design choices, then have it built; gives feedback in short bullet rounds after playtesting on laptop and iPhone.
- Controls are the top priority: they must feel as smooth as possible. Visuals come after.
- Keep the in-game issue log working in everything.
- Test before handing over, and say plainly what could not be tested (no GPU, camera or real phone in the cloud sandbox).
- Explain in plain language; the owner is not a programmer.

## State
- Controls: arrow keys, mouse, two arms, touch, phone glider (`src/link.js`, `src/pad.js`, relay in `src/relay.js`), camera with bare hand or any object (`src/hand.js`, `src/objtrack.js`).
- Phone glider: direct WebRTC via public PeerJS, with a Supabase Realtime relay fallback (project `flyer`, ap-south-1). The relay has never been tested against the real service.
- Bare-hand tracking (hand flat, fingertips toward the screen) was reported jittery; reworked once, not yet re-tested by the owner.
- Any-object tracking and the relay are untested on real hardware.

## Queue
1. Fix whatever the owner's playtest of phone glider, relay and object tracking turns up.
2. A live tuning panel for camera and phone control (smoothing, dead zone, reach, curve) so feel can be tuned in seconds.
3. Visuals, in this order: terrain and cliffs, trees and meadows, water, pilot.
