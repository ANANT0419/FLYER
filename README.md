# Flyer

A wingsuit gliding game: leap off the ridge, ride the glowing wind current down a canyon at dusk, gather gems, thread gold rings, reach the gate. Grown from Glidepath v6 (kept in `legacy/`).

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
| Camera | Your flat hand is the glider. Fingertips up climb, down dive, tilt to turn, close a fist to boost. Either hand; swap any time. Press C to set level again. |

Also: V switches view, P or Esc pauses, M mutes.

## Where things live

| File | Contents |
| --- | --- |
| `index.html` | Screens, HUD, camera setup |
| `src/style.css` | All styling |
| `src/game.js` | World, flight physics, tracks, tutorial, HUD, game flow |
| `src/hand.js` | Camera hand tracking (MediaPipe Hand Landmarker, runs on the device) |
| `src/link.js`, `src/pad.js` | Phone glider: the big-screen side and the phone controller page (direct WebRTC link, introduced through the public PeerJS server) |
| `src/post.js` | Painterly look: bloom, brushwork filter, colour grade |
| `public/models`, `public/mediapipe` | Hand-tracking model and runtime, served locally |

Add `?fx=0`, `?fx=1` or `?fx=2` to the address to force the effects level (plain, bloom and grade, full brushwork).

The in-game issue log (bottom left) records errors, camera problems and low frame rate.
