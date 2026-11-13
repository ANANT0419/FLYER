# Flyer

A wingsuit gliding game: leap off the ridge, ride the glowing line down a canyon at dusk, gather gems, thread gold rings, reach the gate. Or race friends through Razorback Canyon. Grown from Glidepath v6 (kept in `legacy/`).

## Run it

```bash
npm install
npm run dev
```

Open the address it prints. Camera control needs `localhost` or an `https` address.

```bash
npm run build
```

builds the static site into `dist/`, ready for Vercel or GitHub Pages.

## Controls

Pick one on the start screen. All of them can be mixed.

| Control | How it works |
| --- | --- |
| Arrow keys | ↑ climb, ↓ dive, ← → turn, Space boost. W A S D also work. |
| Mouse | Hold and drag: up dive, down climb, sideways turn. Double-click to boost. |
| Two arms | W/S is the left arm, ↑/↓ the right arm. Both up dive, both down climb, one of each turns. |
| Touch | A thumb on each half of the screen, or one-thumb mode. Double-tap to boost. |
| Phone glider | Scan the code on the big screen with your phone, hold the phone flat with its top edge toward the screen, and tilt it: nose up climb, nose down dive, roll to turn, tap to boost. The steadiest control. |
| Camera | Three ways, picked on the camera screen. **Open palm** (default, steadiest): show your palm, raise or lower the hand to climb or dive, tilt it like a steering wheel to turn, fist to boost. **Flat hand**: palm down, fingertips at the screen, tip and roll the hand. **Any object**: raise, lower and tilt something you hold. Press C to set level again. |

Also: V switches view, P or Esc pauses, M mutes.

## The guided line

A glowing ribbon shows the line through every course. Roughly match what its next bend or dip needs and it turns gold, takes over part of the steering, carries you along it and you fly 15% faster. Ignore a bend and you slide off, slow down and have to steer back. **Guide** on the start and pause screens sets how much it helps: Easy (wide window, strong help), Normal, Pro (almost none). In a race room everyone flies with the host's level.

## Racing

Pick **Razorback Canyon** on the start screen (the page reloads into the race canyon). Make a room and share its code, link or QR code; friends who open the link land in the same room. The host starts the race; everyone gets the same 3-2-1. The glowing line leads through every gate: each missed gate adds 3 seconds, each gate you make tops up your boost. Other racers are see-through gliders with name tags, so nobody can knock you off line. Practise alone works offline.

Rooms run on the same Supabase Realtime project as the phone relay (`src/relay-config.js`). `FAKE_RT=1 npm run build` swaps in a same-browser stand-in (`test/fake-supabase.js`) for testing rooms without the service.

## Where things live

| File | Contents |
| --- | --- |
| `index.html` | Screens, HUD, camera setup |
| `src/style.css` | All styling |
| `src/game.js` | World, flight physics, tracks, tutorial, HUD, game flow |
| `src/hand.js` | Camera hand tracking (MediaPipe Hand Landmarker, runs on the device) |
| `src/link.js`, `src/pad.js` | Phone glider: the big-screen side and the phone controller page (direct WebRTC link, introduced through the public PeerJS server) |
| `src/recorder.js` | Records each flight and sends it to the game's Supabase table `flight_logs` for review (switch on the start screen) |
| `src/predict.js` | Cancels the phone delay: gyro rate, clock sync, drawing where the phone is now |
| `test/` | Simulations and browser tests (see the top of each file for how to run it) |
| `src/race.js` | Race rooms: who is in the room, host, start signal, positions of other racers, finish times |
| `src/post.js` | Painterly look: bloom, brushwork filter, colour grade |
| `public/models`, `public/mediapipe` | Hand-tracking model and runtime, served locally |

Add `?view=sky` to see the scenery from high above (menu screen). Add `?fx=0`, `?fx=1` or `?fx=2` to the address to force the effects level (plain, bloom and grade, full brushwork).

The in-game issue log (bottom left) records errors, camera problems and low frame rate.
